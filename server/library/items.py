"""画像アイテムの CRUD。

書き込み順序は「ファイル → meta.json → インデックス」で統一する
（途中でクラッシュしてもインデックス再構築で復旧できる）。
"""

from __future__ import annotations

import io
import shutil
import time
from pathlib import Path
from typing import Any

from PIL import Image

from server.library import index_db, paths, png_meta
from server.library.meta import load_meta, new_meta, now_iso, save_meta
from server.library.thumbs import make_thumb


class LibraryError(Exception):
    pass


class NotFound(LibraryError):
    pass


def _retry_fs(fn, attempts: int = 4, wait: float = 0.3):
    """Windows の一時的なファイルロック（WinError 5/32）を短時間リトライする。"""
    for i in range(attempts):
        try:
            return fn()
        except PermissionError:
            if i == attempts - 1:
                raise LibraryError(
                    "ファイルが使用中のため操作できません。"
                    "エクスプローラーのウィンドウや再生中の動画を閉じてから再試行してください。"
                )
            time.sleep(wait)


def _folder_of(d: Path) -> str:
    """アイテムフォルダから所属フォルダの相対パスを求める（ルートは ""）。"""
    folder = d.parent.relative_to(paths.get_library_root()).as_posix()
    return "" if folder == "." else folder


def _save_and_index(d: Path, meta: dict[str, Any]) -> dict[str, Any]:
    """meta.json を書いてインデックスを更新し、folder 付きの meta を返す。"""
    save_meta(d, meta)
    folder = _folder_of(d)
    index_db.upsert_item(meta, folder)
    meta["folder"] = folder
    return meta


def item_dir(item_id: str) -> Path:
    """ID からアイテムフォルダを引く（インデックス → 全走査フォールバック）。"""
    row = index_db.get_item_row(item_id)
    if row is not None:
        d = paths.resolve_rel(row["folder"]) / item_id
        if paths.is_item_dir(d):
            return d
    root = paths.get_library_root()
    stack = [root]
    while stack:
        current = stack.pop()
        for child in current.iterdir():
            if not child.is_dir() or child.name.startswith("."):
                continue
            if child.name == item_id and paths.is_item_dir(child):
                return child
            if not paths.is_item_dir(child):
                stack.append(child)
    raise NotFound(f"item not found: {item_id}")


def get_item(item_id: str) -> dict[str, Any]:
    d = item_dir(item_id)
    meta = load_meta(d)
    root = paths.get_library_root()
    folder = d.parent.relative_to(root).as_posix()
    meta["folder"] = "" if folder == "." else folder
    return meta


def create_item(
    folder_rel: str,
    image_bytes: bytes,
    *,
    ext: str = ".png",
    prompt: str = "",
    negative_prompt: str = "",
    seed: int | None = None,
    params: dict[str, Any] | None = None,
    tags: list[str] | None = None,
    caption: str = "",
    source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    folder_rel = paths.normalize_rel(folder_rel)
    folder = paths.resolve_rel(folder_rel)
    if not folder.is_dir():
        raise LibraryError(f"folder not found: {folder_rel!r}")
    if paths.is_item_dir(folder):
        raise LibraryError("cannot create an item inside another item")

    item_id = paths.new_item_id()
    d = folder / item_id
    d.mkdir()
    image_file = f"image{ext}"
    try:
        (d / image_file).write_bytes(image_bytes)
        make_thumb(image_bytes, d / "thumb.jpg")
        meta = new_meta(
            item_id,
            image_file=image_file,
            prompt=prompt,
            negative_prompt=negative_prompt,
            seed=seed,
            params=params,
            tags=tags,
            caption=caption,
            source=source,
        )
        save_meta(d, meta)
    except Exception:
        shutil.rmtree(d, ignore_errors=True)
        raise
    index_db.upsert_item(meta, folder_rel)
    meta["folder"] = folder_rel
    return meta


def import_image(folder_rel: str, image_bytes: bytes, filename: str = "") -> dict[str, Any]:
    """既存の画像ファイルを取り込む。PNG メタデータからプロンプト等を読み取る。"""
    ext = Path(filename).suffix.lower() or ".png"
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        raise LibraryError(f"unsupported image type: {ext}")
    prompt = negative = ""
    seed = None
    params: dict[str, Any] = {}
    try:
        with Image.open(io.BytesIO(image_bytes)) as im:
            info = png_meta.read_a1111_metadata(im) or png_meta.read_comfyui_metadata(im)
        if info:
            prompt = info.get("positive") or ""
            negative = info.get("negative") or ""
            seed = info.get("seed")
            params = {
                k: v
                for k, v in info.items()
                if k not in ("positive", "negative", "seed", "size") and v is not None
            }
    except Exception:
        pass
    return create_item(
        folder_rel,
        image_bytes,
        ext=ext,
        prompt=prompt,
        negative_prompt=negative,
        seed=seed,
        params=params,
    )


def update_item(item_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    d = item_dir(item_id)
    meta = load_meta(d)
    for key in (
        "prompt",
        "negative_prompt",
        "caption",
        "seed",
        "params",
        "tags",
        "video_settings",
        "edit_settings",
    ):
        if key in fields:
            meta[key] = fields[key]
    if "favorite" in fields:
        meta["favorite"] = bool(fields["favorite"])
    save_meta(d, meta)
    root = paths.get_library_root()
    folder = d.parent.relative_to(root).as_posix()
    folder = "" if folder == "." else folder
    index_db.upsert_item(meta, folder)
    meta["folder"] = folder
    return meta


def place_before(item_id: str, ref_item_id: str) -> dict[str, Any]:
    """item を ref_item のすぐ上（sort_order 降順で直前＝グリッドの左隣）に配置する。

    一覧は「新しいものほど左・上」なので、生成結果は元画像の直前に入れる。
    同じ ref から複数回生成しても sort_order が同値になるだけで、
    created_at 降順のタイブレークにより新しいものほど ref から離れた左側に並ぶ
    （＝新しい順が保たれる）。
    """
    ref = get_item(ref_item_id)
    d = item_dir(item_id)
    meta = load_meta(d)
    meta["sort_order"] = float(ref.get("sort_order") or 0) + 1e-6
    save_meta(d, meta)
    root = paths.get_library_root()
    folder = d.parent.relative_to(root).as_posix()
    folder = "" if folder == "." else folder
    index_db.upsert_item(meta, folder)
    meta["folder"] = folder
    return meta


def reorder(folder_rel: str, ordered_ids: list[str]) -> None:
    """フォルダ内アイテムを ordered_ids の並び（先頭が上）に並べ替える。

    先頭が最大の sort_order を持つよう、現在時刻を基準に降順で振り直す。
    新規生成物（sort_order=time.time()）は以後も先頭に来る。
    """
    folder_rel = paths.normalize_rel(folder_rel)
    base = time.time()
    for i, item_id in enumerate(ordered_ids):
        try:
            d = item_dir(item_id)
        except NotFound:
            continue
        # 対象が本当にこのフォルダのアイテムか確認
        root = paths.get_library_root()
        folder = d.parent.relative_to(root).as_posix()
        folder = "" if folder == "." else folder
        if folder != folder_rel:
            continue
        meta = load_meta(d)
        meta["sort_order"] = base - i * 0.001
        save_meta(d, meta)
        index_db.upsert_item(meta, folder)


def delete_item(item_id: str) -> None:
    d = item_dir(item_id)
    _retry_fs(lambda: shutil.rmtree(d))
    index_db.remove_item(item_id)


def move_item(item_id: str, dest_folder_rel: str) -> dict[str, Any]:
    dest_rel = paths.normalize_rel(dest_folder_rel)
    dest_folder = paths.resolve_rel(dest_rel)
    if not dest_folder.is_dir():
        raise LibraryError(f"folder not found: {dest_folder_rel!r}")
    if paths.is_item_dir(dest_folder):
        raise LibraryError("cannot move an item inside another item")
    d = item_dir(item_id)
    dest = dest_folder / item_id
    if dest.exists():
        raise LibraryError(f"destination already exists: {dest}")
    _retry_fs(lambda: shutil.move(str(d), str(dest)))
    meta = load_meta(dest)
    index_db.upsert_item(meta, dest_rel)
    meta["folder"] = dest_rel
    return meta


def add_video(
    item_id: str,
    video_bytes: bytes,
    *,
    ext: str = ".mp4",
    prompt: str = "",
    workflow: str = "",
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    d = item_dir(item_id)
    meta = load_meta(d)
    videos_dir = d / paths.VIDEOS_DIR_NAME
    videos_dir.mkdir(exist_ok=True)
    n = 1
    while (videos_dir / f"v{n:03d}{ext}").exists():
        n += 1
    file_rel = f"{paths.VIDEOS_DIR_NAME}/v{n:03d}{ext}"
    (d / file_rel).write_bytes(video_bytes)
    entry = {
        "file": file_rel,
        "prompt": prompt,
        "workflow": workflow,
        "created_at": now_iso(),
    }
    if settings:
        entry["settings"] = settings
    meta.setdefault("videos", []).append(entry)
    save_meta(d, meta)
    root = paths.get_library_root()
    folder = d.parent.relative_to(root).as_posix()
    folder = "" if folder == "." else folder
    index_db.upsert_item(meta, folder)
    meta["folder"] = folder
    return meta


def update_video(item_id: str, file_name: str, fields: dict[str, Any]) -> dict[str, Any]:
    """動画エントリのプロンプト・設定・お気に入りを更新する。"""
    d = item_dir(item_id)
    meta = load_meta(d)
    name = file_name.replace("\\", "/").split("/")[-1]
    file_rel = f"{paths.VIDEOS_DIR_NAME}/{name}"
    target = None
    for v in meta.get("videos") or []:
        if v.get("file") == file_rel:
            target = v
            break
    if target is None:
        raise NotFound(f"video not found: {file_rel}")
    if "prompt" in fields:
        target["prompt"] = fields["prompt"]
    if "workflow" in fields:
        target["workflow"] = fields["workflow"]
    if "settings" in fields and isinstance(fields["settings"], dict):
        target["settings"] = {**(target.get("settings") or {}), **fields["settings"]}
    if "favorite" in fields:
        target["favorite"] = bool(fields["favorite"])
    save_meta(d, meta)
    root = paths.get_library_root()
    folder = d.parent.relative_to(root).as_posix()
    folder = "" if folder == "." else folder
    index_db.upsert_item(meta, folder)
    meta["folder"] = folder
    return meta


def remove_video(item_id: str, file_name: str) -> dict[str, Any]:
    """動画を削除する。file_name は ``videos/v001.mp4`` またはファイル名のみ。"""
    d = item_dir(item_id)
    meta = load_meta(d)
    name = file_name.replace("\\", "/").split("/")[-1]
    if "/" in name or name in ("", ".", ".."):
        raise LibraryError(f"invalid video file name: {file_name!r}")
    file_rel = f"{paths.VIDEOS_DIR_NAME}/{name}"
    videos = meta.get("videos") or []
    kept = [v for v in videos if v.get("file") != file_rel]
    if len(kept) == len(videos):
        raise NotFound(f"video not found: {file_rel}")
    target = d / file_rel
    if target.is_file():
        _retry_fs(target.unlink)
    thumb = target.with_suffix(".thumb.jpg")
    if thumb.is_file():
        _retry_fs(thumb.unlink)
    meta["videos"] = kept
    save_meta(d, meta)
    root = paths.get_library_root()
    folder = d.parent.relative_to(root).as_posix()
    folder = "" if folder == "." else folder
    index_db.upsert_item(meta, folder)
    meta["folder"] = folder
    return meta


# ---------------------------------------------------------------------------
# 編集画像（スタイル変換などの派生画像）
#
# 動画と同じくアイテムに紐づくサブアセットとして持つ。試行を何枚も並べて比べる
# ものなので、そのままではグリッドに出さない。動画を作りたくなったときなど、
# 画像アイテムとしての機能が必要になったら promote_edit で独立アイテムにする。
# ---------------------------------------------------------------------------


def _edit_entry(meta: dict[str, Any], file_name: str) -> tuple[str, dict[str, Any]]:
    """``edits/e001.png`` またはファイル名のみから meta 内のエントリを引く。"""
    name = file_name.replace("\\", "/").split("/")[-1]
    if "/" in name or name in ("", ".", ".."):
        raise LibraryError(f"invalid edit file name: {file_name!r}")
    file_rel = f"{paths.EDITS_DIR_NAME}/{name}"
    for e in meta.get("edits") or []:
        if e.get("file") == file_rel:
            return file_rel, e
    raise NotFound(f"edit not found: {file_rel}")


def add_edit(
    item_id: str,
    image_bytes: bytes,
    *,
    ext: str = ".png",
    prompt: str = "",
    workflow: str = "",
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    d = item_dir(item_id)
    meta = load_meta(d)
    edits_dir = d / paths.EDITS_DIR_NAME
    edits_dir.mkdir(exist_ok=True)
    n = 1
    while (edits_dir / f"e{n:03d}{ext}").exists():
        n += 1
    file_rel = f"{paths.EDITS_DIR_NAME}/e{n:03d}{ext}"
    (d / file_rel).write_bytes(image_bytes)
    # 一覧用サムネイル（動画と同じ .thumb.jpg 規約）
    thumb_rel = f"{paths.EDITS_DIR_NAME}/e{n:03d}.thumb.jpg"
    try:
        make_thumb(image_bytes, d / thumb_rel)
    except OSError:
        thumb_rel = ""  # サムネイルを作れなくても本体の登録は続行する
    entry = {
        "file": file_rel,
        "thumb": thumb_rel,
        "prompt": prompt,
        "workflow": workflow,
        "created_at": now_iso(),
    }
    if settings:
        entry["settings"] = settings
    meta.setdefault("edits", []).append(entry)
    return _save_and_index(d, meta)


def update_edit(item_id: str, file_name: str, fields: dict[str, Any]) -> dict[str, Any]:
    """編集画像のプロンプト・設定・お気に入りを更新する。"""
    d = item_dir(item_id)
    meta = load_meta(d)
    _, target = _edit_entry(meta, file_name)
    if "prompt" in fields:
        target["prompt"] = fields["prompt"]
    if "workflow" in fields:
        target["workflow"] = fields["workflow"]
    if "settings" in fields and isinstance(fields["settings"], dict):
        target["settings"] = {**(target.get("settings") or {}), **fields["settings"]}
    if "favorite" in fields:
        target["favorite"] = bool(fields["favorite"])
    return _save_and_index(d, meta)


def remove_edit(item_id: str, file_name: str) -> dict[str, Any]:
    """編集画像を削除する。file_name は ``edits/e001.png`` またはファイル名のみ。"""
    d = item_dir(item_id)
    meta = load_meta(d)
    file_rel, target = _edit_entry(meta, file_name)
    for rel in (file_rel, target.get("thumb") or ""):
        if not rel:
            continue
        path = d / rel
        if path.is_file():
            _retry_fs(path.unlink)
    meta["edits"] = [e for e in (meta.get("edits") or []) if e is not target]
    return _save_and_index(d, meta)


def promote_edit(item_id: str, file_name: str) -> dict[str, Any]:
    """編集画像を独立した画像アイテムとして複製する（元の編集画像は残す）。

    昇格すると通常の画像アイテムになるため、動画生成・検索・シーケンス投入など
    画像としての機能がそのまま使えるようになる。並びは元画像の隣（直前）。
    """
    d = item_dir(item_id)
    meta = load_meta(d)
    file_rel, target = _edit_entry(meta, file_name)
    src = d / file_rel
    if not src.is_file():
        raise NotFound(f"edit file not found: {file_rel}")

    settings = target.get("settings") or {}
    params = {
        "backend": "ComfyUI",
        "workflow": target.get("workflow") or settings.get("workflow") or "",
        "source_item": item_id,
        "source_edit": file_rel,
    }
    for key in ("width", "height"):
        if settings.get(key):
            params[key] = settings[key]
    seed = settings.get("seed")
    new_item = create_item(
        _folder_of(d),
        src.read_bytes(),
        ext=src.suffix or ".png",
        prompt=target.get("prompt") or "",
        seed=seed if isinstance(seed, int) and seed >= 0 else None,
        params=params,
        source={
            "item_id": item_id,
            "kind": "edit",
            "file": file_rel,
            "workflow": target.get("workflow") or "",
        },
    )
    try:
        new_item = place_before(new_item["id"], item_id)
    except LibraryError:
        pass  # 並び替えに失敗しても昇格自体は成功として扱う
    # 昇格済みであることを元の編集エントリにも残す（UI で二重昇格を避けるため）
    target["promoted_to"] = new_item["id"]
    _save_and_index(d, meta)
    return new_item
