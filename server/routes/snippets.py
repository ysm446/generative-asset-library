"""スニペット API。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.library import snippet_organize, snippets
from server.streaming import make_sse_response

router = APIRouter(prefix="/api/snippets")


def _wrap(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except snippets.SnippetError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("")
def list_snippets() -> dict[str, Any]:
    return {"snippets": snippets.list_snippets()}


@router.get("/files")
def list_files() -> dict[str, Any]:
    return {"files": snippets.list_files()}


@router.get("/root")
def get_root() -> dict[str, Any]:
    return snippets.root_info()


@router.post("/reveal")
def reveal_folder() -> dict[str, bool]:
    """スニペットフォルダをエクスプローラーで開く（無ければ作成）。"""
    import os
    import subprocess

    d = snippets.snippets_dir()
    try:
        d.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"フォルダを作成できません: {e}")
    if os.name != "nt":
        raise HTTPException(status_code=400, detail="Windows のみ対応しています")
    subprocess.Popen(["explorer", str(d)])
    return {"ok": True}


class RootUpdate(BaseModel):
    path: str = ""


@router.post("/root")
def set_root(body: RootUpdate) -> dict[str, Any]:
    return _wrap(snippets.set_root, body.path)


@router.get("/file")
def read_file(path: str) -> dict[str, str]:
    return {"path": path, "content": _wrap(snippets.read_file, path)}


@router.get("/entries")
def read_entries(path: str) -> dict[str, Any]:
    return {"path": path, "entries": _wrap(snippets.parse_entries, path)}


class FileSave(BaseModel):
    path: str
    content: str


@router.put("/file")
def save_file(body: FileSave) -> dict[str, bool]:
    _wrap(snippets.save_file, body.path, body.content)
    return {"ok": True}


class EntryCreate(BaseModel):
    path: str
    name: str = ""
    prefix: str = ""
    body: str
    description: str = ""


@router.post("/entry")
def add_entry(payload: EntryCreate) -> dict[str, str]:
    """プロンプト欄からの「スニペットに登録」。既存ファイルの末尾に 1 件追記する。"""
    return _wrap(
        snippets.add_entry,
        payload.path,
        payload.name,
        payload.prefix,
        payload.body,
        payload.description,
    )


class FileCreate(BaseModel):
    path: str


@router.post("/file")
def create_file(body: FileCreate) -> dict[str, str]:
    return {"path": _wrap(snippets.create_file, body.path)}


@router.delete("/file")
def delete_file(path: str) -> dict[str, bool]:
    _wrap(snippets.delete_file, path)
    return {"ok": True}


class FileRename(BaseModel):
    path: str
    new_path: str


@router.post("/file/rename")
def rename_file(body: FileRename) -> dict[str, str]:
    return {"path": _wrap(snippets.rename_file, body.path, body.new_path)}


# --- 自動整理（ローカル LLM）------------------------------------------------


class OrganizePlan(BaseModel):
    model: str = ""
    instruction: str = ""
    max_categories: int = snippet_organize.MAX_CATEGORIES
    batch_size: int = snippet_organize.BATCH_SIZE
    include: list[str] | None = None  # 対象ファイル（省略時は全ファイル）
    targets_within_selection: bool = True  # 移動先も選択したファイルに限る


@router.post("/organize/plan")
async def organize_plan(body: OrganizePlan):
    """整理案を SSE で作る。ファイルは一切変更しない。"""
    from server.generation import llm_client
    from server.routes import llm as llm_routes

    def worker(send) -> None:
        try:
            if not llm_client.is_loaded():
                presets = llm_client.refresh_model_presets()
                target = body.model if body.model in presets else llm_routes.preferred_model(presets)
                if not target:
                    send({"type": "error", "content": "models/ フォルダに GGUF モデルが見つかりません。"})
                    return
                send({"type": "status", "content": f"LLM モデルをロード中: {target} ..."})
                llm_client.load_model(target)
                llm_routes.remember_model(target)
                send({"type": "model_loaded", "content": target})

            plan = snippet_organize.build_plan(
                send,
                instruction=body.instruction,
                max_categories=max(2, min(body.max_categories, 100)),
                batch_size=max(5, min(body.batch_size, 100)),
                include=body.include,
                targets_within_selection=body.targets_within_selection,
            )
            send({"type": "plan", "plan": plan})
        except Exception as e:
            send({"type": "error", "content": str(e)})
        finally:
            send({"type": "done"})

    return make_sse_response(worker)


class OrganizeApply(BaseModel):
    moves: list[dict[str, str]]
    delete_emptied: bool = True


@router.post("/organize/apply")
def organize_apply(body: OrganizeApply) -> dict[str, Any]:
    try:
        return snippet_organize.apply_plan(body.moves, delete_emptied=body.delete_emptied)
    except (snippet_organize.OrganizeError, snippets.SnippetError) as e:
        raise HTTPException(status_code=400, detail=str(e))
