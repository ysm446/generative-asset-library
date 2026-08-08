"""スニペットの自動振り分け（ローカル LLM）。

2 段階で「整理案」を作り、適用は別 API に分ける。

1. カテゴリ設計: 現在のファイル一覧とサンプルを渡し、カテゴリ（＝ファイル）一覧を出させる。
2. 振り分け: カテゴリ一覧を固定して、スニペットをバッチごとに割り当てさせる。

LLM にファイルを直接書かせることはしない。``build_plan`` は読み取りのみで、
``apply_plan`` がユーザーの確認後に呼ばれてはじめてファイルを書き換える。
"""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from server.generation import llm_client
from server.library import snippets

BASE_DIR = Path(__file__).resolve().parent.parent.parent
BACKUP_DIR = BASE_DIR / "data" / "snippet_backups"

# 1 回の推論で振り分けるスニペット数（n_ctx 8192 でも余裕がある大きさ）
BATCH_SIZE = 40
# カテゴリ設計時に 1 ファイルから見せるサンプル数
SAMPLES_PER_FILE = 20
MAX_CATEGORIES = 40


class OrganizeError(Exception):
    pass


# --- 収集 -------------------------------------------------------------------


def collect_entries() -> list[dict[str, str]]:
    """全ファイルのスニペットを (source, name) 付きで集める。body は捨てない。"""
    result: list[dict[str, str]] = []
    for f in snippets.list_files():
        try:
            entries = snippets.parse_entries(f["path"])
        except snippets.SnippetError:
            continue
        for e in entries:
            result.append({**e, "source": f["path"]})
    return result


def _label(entry: dict[str, str]) -> str:
    """振り分けの判断材料。prefix が空なら name、それも空なら body の先頭を使う。"""
    text = (entry.get("prefix") or entry.get("name") or "").strip()
    if not text:
        text = (entry.get("body") or "").splitlines()[0][:60] if entry.get("body") else ""
    desc = (entry.get("description") or "").strip()
    return f"{text} / {desc}" if desc else text


# --- カテゴリ名の正規化 -----------------------------------------------------


def _normalize_file_name(raw: str) -> str:
    name = (raw or "").strip().replace("\\", "/")
    name = name.rsplit("/", 1)[-1]  # サブフォルダは作らせない
    if name.endswith(".code-snippets"):
        name = name[: -len(".code-snippets")]
    name = name.lower().replace(" ", "_").replace("-", "_")
    name = re.sub(r"[^a-z0-9_]", "", name)
    name = re.sub(r"_+", "_", name).strip("_")
    if not name:
        return ""
    return f"{name}.code-snippets"


# --- フェーズ 1: カテゴリ設計 -----------------------------------------------

_CATEGORY_SYSTEM = """\
あなたは Stable Diffusion 用プロンプト断片（スニペット）のライブラリを整理する司書です。
現在のファイル構成とスニペットの例を見て、整理後のカテゴリ一覧を設計してください。

ルール:
- カテゴリ 1 つ = ファイル 1 つ。file は英小文字・数字・アンダースコアのみ（例: sd_character_pose）。
- 既存のファイル名は、意味が妥当ならそのまま残してください。
- 項目数が多すぎるカテゴリは、意味のある単位に分割してください。
- 項目数が少なく似ているカテゴリは、統合してください。
- カテゴリ数は最大 {max_categories} 個。すべてのスニペットがどれかに入るようにしてください。
- description は日本語で、そのカテゴリに何を入れるかを 1 行で書いてください。
- JSON のみを出力してください。
"""

_CATEGORY_SCHEMA = {
    "type": "object",
    "properties": {
        "categories": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "file": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["file", "description"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["categories"],
    "additionalProperties": False,
}


def _overview_text(entries: list[dict[str, str]]) -> str:
    by_source: dict[str, list[dict[str, str]]] = {}
    for e in entries:
        by_source.setdefault(e["source"], []).append(e)
    lines: list[str] = []
    for source in sorted(by_source):
        items = by_source[source]
        step = max(1, len(items) // SAMPLES_PER_FILE)
        samples = [_label(e) for e in items[::step]][:SAMPLES_PER_FILE]
        lines.append(f"## {source}（{len(items)} 件）")
        lines.append("例: " + " / ".join(s for s in samples if s))
    return "\n".join(lines)


def design_categories(
    entries: list[dict[str, str]],
    instruction: str = "",
    max_categories: int = MAX_CATEGORIES,
) -> list[dict[str, str]]:
    system = _CATEGORY_SYSTEM.format(max_categories=max_categories)
    user = _overview_text(entries)
    if instruction.strip():
        user += f"\n\n追加の方針: {instruction.strip()}"
    user += "\n\n整理後のカテゴリ一覧を JSON で出力してください。"

    data = llm_client.chat_json(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        _CATEGORY_SCHEMA,
        max_tokens=2048,
    )
    raw = data.get("categories") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        raise OrganizeError("カテゴリ一覧を生成できませんでした")

    categories: list[dict[str, str]] = []
    seen: set[str] = set()
    for c in raw:
        if not isinstance(c, dict):
            continue
        file = _normalize_file_name(str(c.get("file", "")))
        if not file or file in seen:
            continue
        seen.add(file)
        categories.append({"file": file, "description": str(c.get("description", "")).strip()})
        if len(categories) >= max_categories:
            break
    if not categories:
        raise OrganizeError("有効なカテゴリ名が 1 つも得られませんでした")
    return categories


# --- フェーズ 2: 振り分け ---------------------------------------------------

_ASSIGN_SYSTEM = """\
あなたは Stable Diffusion 用プロンプト断片（スニペット）を分類する司書です。
各スニペットを、次のカテゴリのどれか 1 つに割り当ててください。

カテゴリ:
{categories_text}

ルール:
- category には上の番号を使ってください。
- どのカテゴリにも当てはまらないものだけ -1 にしてください（できるだけ避ける）。
- 迷ったら、意味がいちばん近いカテゴリを選んでください。
- 入力のすべての id について、過不足なく 1 件ずつ出力してください。
- JSON のみを出力してください。
"""

_ASSIGN_SCHEMA = {
    "type": "object",
    "properties": {
        "assignments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "category": {"type": "integer"},
                },
                "required": ["id", "category"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["assignments"],
    "additionalProperties": False,
}


def _assign_batch(
    batch: list[tuple[int, dict[str, str]]],
    categories: list[dict[str, str]],
) -> dict[int, int]:
    categories_text = "\n".join(
        f"{i}: {c['file'][: -len('.code-snippets')]} — {c['description']}"
        for i, c in enumerate(categories)
    )
    lines = [
        json.dumps(
            {"id": idx, "text": _label(e), "now": e["source"][: -len(".code-snippets")]},
            ensure_ascii=False,
        )
        for idx, e in batch
    ]
    messages = [
        {"role": "system", "content": _ASSIGN_SYSTEM.format(categories_text=categories_text)},
        {"role": "user", "content": "\n".join(lines) + "\n\n割り当てを JSON で出力してください。"},
    ]
    data = llm_client.chat_json(messages, _ASSIGN_SCHEMA, max_tokens=32 * len(batch) + 256)
    raw = data.get("assignments") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        raise OrganizeError("割り当て結果を解釈できませんでした")

    valid_ids = {idx for idx, _ in batch}
    result: dict[int, int] = {}
    for a in raw:
        if not isinstance(a, dict):
            continue
        try:
            idx = int(a.get("id"))
            cat = int(a.get("category"))
        except (TypeError, ValueError):
            continue
        if idx in valid_ids and 0 <= cat < len(categories):
            result[idx] = cat
    return result


# --- 整理案の組み立て -------------------------------------------------------


def build_plan(
    send: Callable[[dict], None],
    instruction: str = "",
    max_categories: int = MAX_CATEGORIES,
    batch_size: int = BATCH_SIZE,
) -> dict[str, Any]:
    """整理案（moves / categories）を作って返す。ファイルは一切書き換えない。"""
    entries = collect_entries()
    if not entries:
        raise OrganizeError("スニペットが 1 件もありません")

    send({"type": "status", "content": f"{len(entries)} 件のスニペットからカテゴリを設計中..."})
    categories = design_categories(entries, instruction, max_categories)
    send({"type": "categories", "categories": categories})

    existing = {f["path"] for f in snippets.list_files()}
    assigned: dict[int, int] = {}
    total = len(entries)
    failed_batches = 0

    for start in range(0, total, batch_size):
        batch = [(i, entries[i]) for i in range(start, min(start + batch_size, total))]
        try:
            assigned.update(_assign_batch(batch, categories))
        except Exception as e:
            failed_batches += 1
            send({"type": "warning", "content": f"{start + 1}〜{start + len(batch)} 件目の振り分けに失敗しました: {e}"})
        send(
            {
                "type": "progress",
                "done": min(start + batch_size, total),
                "total": total,
                "content": f"振り分け中... {min(start + batch_size, total)}/{total}",
            }
        )

    moves: list[dict[str, str]] = []
    unassigned = 0
    for idx, e in enumerate(entries):
        cat = assigned.get(idx)
        if cat is None:
            unassigned += 1
            continue
        target = categories[cat]["file"]
        if target == e["source"]:
            continue
        moves.append(
            {
                "name": e["name"],
                "prefix": e.get("prefix", ""),
                "from": e["source"],
                "to": target,
            }
        )

    # 移動後のファイルごとの件数を数え、空になるファイルと新規ファイルを出す
    counts: dict[str, int] = {f["path"]: f["count"] for f in snippets.list_files()}
    for m in moves:
        counts[m["from"]] = counts.get(m["from"], 0) - 1
        counts[m["to"]] = counts.get(m["to"], 0) + 1

    emptied = sorted(p for p, n in counts.items() if n <= 0 and p in existing)
    created = sorted(p for p in counts if p not in existing and counts[p] > 0)
    touched = sorted({m["from"] for m in moves} | {m["to"] for m in moves})

    return {
        "categories": categories,
        "moves": moves,
        "counts": counts,
        "created": created,
        "emptied": emptied,
        "touched": touched,
        "total": total,
        "unassigned": unassigned,
        "failed_batches": failed_batches,
    }


# --- 適用 -------------------------------------------------------------------


def _entries_to_json(entries: list[dict[str, str]]) -> str:
    obj: dict[str, Any] = {}
    used: set[str] = set()
    for i, e in enumerate(entries):
        base = (e.get("name") or e.get("prefix") or "").strip() or f"entry_{i + 1}"
        key = base
        n = 2
        while key in used:
            key = f"{base}_{n}"
            n += 1
        used.add(key)
        obj[key] = {
            "prefix": e.get("prefix", ""),
            "body": (e.get("body") or "").split("\n"),
            "description": e.get("description", ""),
        }
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def backup() -> str:
    """スニペットフォルダを data/snippet_backups/<日時>/ にコピーする。"""
    src = snippets.snippets_dir()
    dest = BACKUP_DIR / datetime.now().strftime("%Y%m%d_%H%M%S")
    dest.mkdir(parents=True, exist_ok=True)
    for path in sorted(src.rglob("*.code-snippets")):
        rel = path.relative_to(src)
        (dest / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest / rel)
    return str(dest)


def apply_plan(
    moves: list[dict[str, str]],
    delete_emptied: bool = True,
    make_backup: bool = True,
) -> dict[str, Any]:
    """整理案を適用する。書き換えるのは、移動が発生したファイルだけ。

    書き込みの前に必ずスニペットフォルダをバックアップする。元ファイルの ``//``
    コメントは、書き換え対象になったファイルでは失われる（バックアップには残る）。
    """
    if not moves:
        raise OrganizeError("適用する移動がありません")

    # 現在の中身を読み込む（不正な JSON のファイルがあれば中断する）
    files = {f["path"] for f in snippets.list_files()}
    current: dict[str, list[dict[str, str]]] = {}
    for path in files:
        try:
            current[path] = snippets.parse_entries(path)
        except snippets.SnippetError as e:
            raise OrganizeError(f"{path} を読み込めません: {e}")

    # 移動を (from, name) で引けるようにする。案を作ったあとにファイルが編集されて
    # いることがあるため、いま実在する項目だけを対象にする。
    existing_names = {(path, e["name"]) for path, entries in current.items() for e in entries}
    wanted: dict[tuple[str, str], str] = {}
    for m in moves:
        src = str(m.get("from", ""))
        dst = _normalize_file_name(str(m.get("to", "")))
        name = str(m.get("name", ""))
        if not src or not dst or not name or dst == src:
            continue
        if (src, name) not in existing_names:
            continue
        snippets._resolve(dst)  # ルート外・拡張子違いはここで弾く
        wanted[(src, name)] = dst

    if not wanted:
        raise OrganizeError("適用できる移動がありません（ファイルが変更された可能性があります）")

    moved = 0
    additions: dict[str, list[dict[str, str]]] = {}
    for path, entries in current.items():
        kept: list[dict[str, str]] = []
        for e in entries:
            dst = wanted.get((path, e["name"]))
            if dst is None or dst == path:
                kept.append(e)
                continue
            additions.setdefault(dst, []).append(e)
            moved += 1
        current[path] = kept

    # 移動先へ追加（新規ファイルもここで作られる）
    for dst, entries in additions.items():
        current.setdefault(dst, []).extend(entries)

    changed = set(additions) | {p for (p, _), dst in wanted.items() if dst != p}

    backup_path = backup() if make_backup else ""

    written: list[str] = []
    for path in sorted(changed):
        entries = current.get(path, [])
        if not entries:
            continue
        snippets.save_file(path, _entries_to_json(entries))
        written.append(path)

    deleted: list[str] = []
    if delete_emptied:
        for path in sorted(changed & files):
            if not current.get(path):
                try:
                    snippets.delete_file(path)
                    deleted.append(path)
                except snippets.SnippetError:
                    pass

    return {"moved": moved, "written": written, "deleted": deleted, "backup": backup_path}
