"""バックエンドサービスの起動状態を返す API。

Forge / ComfyUI / LLM / Embedding の各 llama-server・生成サーバーに軽量な
HTTP プローブを投げて、起動しているかどうかを返す。あわせて、管理対象
プロセスの起動・停止（トップバーのチップのオン / オフ）も受け付ける。
"""

from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import requests
from fastapi import APIRouter, HTTPException

from server import settings
from server.generation import comfy_process, embedding_client, llm_client, sd_process

router = APIRouter(prefix="/api/status")

_TIMEOUT = 0.6

# 起動をバックグラウンドで行うため、失敗内容はここに控えてステータスに載せる
_start_errors: dict[str, str] = {}


def _probe(url: str, ok_codes=(200,)) -> bool:
    try:
        return requests.get(url, timeout=_TIMEOUT).status_code in ok_codes
    except requests.RequestException:
        return False


def _probe_any(urls: list[str], ok_codes=(200,)) -> tuple[bool, str]:
    for url in urls:
        if _probe(url, ok_codes):
            return True, url
    return False, urls[0] if urls else ""


def _resolve_state(
    ready: bool,
    proc: dict[str, Any],
    *,
    installing: bool = False,
) -> tuple[str, str]:
    """(state, detail) を返す。state: ready / starting / installing / error / off"""
    if ready:
        return "ready", ""
    if installing:
        return "installing", "セットアップ中…"
    if proc.get("process_running"):
        return "starting", "起動中…"
    rc = proc.get("returncode")
    err = proc.get("error") or ""
    if rc is not None:
        return "error", f"異常終了 (code {rc})"
    if err:
        return "error", str(err)
    return "off", ""


def _apply_start_error(info: dict[str, Any]) -> dict[str, Any]:
    """起動要求が失敗していたら、停止中ではなくエラーとして見せる。"""
    key = info["key"]
    err = _start_errors.get(key)
    if not err:
        return info
    if info["state"] in ("ready", "starting", "installing"):
        _start_errors.pop(key, None)  # 起動したので控えは不要
        return info
    info["state"] = "error"
    info["detail"] = err
    return info


def _forge_status() -> dict[str, Any]:
    urls = []
    try:
        urls.append(sd_process.get_url())  # 管理対象 (既定 7861)
    except Exception:
        pass
    urls.append("http://127.0.0.1:7860")  # 外部起動でよく使うポート
    ready, url = _probe_any(list(dict.fromkeys(urls)))
    state, detail = _resolve_state(ready, sd_process.process_state())
    return {
        "key": "forge",
        "label": "Forge",
        "ready": ready,
        "state": state,
        "detail": detail,
        "url": url,
        "managed": sd_process.is_enabled(),
    }


def _comfy_status() -> dict[str, Any]:
    try:
        base = comfy_process.get_url()
    except Exception:
        base = "http://127.0.0.1:8188"
    ready = _probe(f"{base}/system_stats")
    proc = comfy_process.process_state()
    state, detail = _resolve_state(ready, proc, installing=proc.get("installing", False))
    return {
        "key": "comfyui",
        "label": "ComfyUI",
        "ready": ready,
        "state": state,
        "detail": detail,
        "url": base,
        "managed": comfy_process.is_enabled(),
    }


def _llm_status() -> dict[str, Any]:
    port = os.getenv("LLAMA_SERVER_PORT", "8090")
    base = f"http://127.0.0.1:{port}"
    # llama-server はモデルロード中 /health が 503 を返すため、200 = ロード完了
    ready = _probe(f"{base}/health")
    proc = llm_client.process_state()
    state, detail = _resolve_state(ready, proc)
    if state == "starting":
        detail = "モデルをロード中…"
    if ready and proc.get("model"):
        detail = str(proc["model"])
    return {
        "key": "llm",
        "label": "LLM",
        "ready": ready,
        "state": state,
        "detail": detail,
        "url": base,
        "managed": True,
    }


def _embedding_status() -> dict[str, Any]:
    port = os.getenv("EMBEDDING_SERVER_PORT", "8091")
    base = f"http://127.0.0.1:{port}"
    ready = _probe(f"{base}/health")
    proc = embedding_client.process_state()
    state, detail = _resolve_state(ready, proc)
    if state == "starting":
        detail = "モデルをロード中…"
    if ready and proc.get("model"):
        detail = str(proc["model"])
    return {
        "key": "embedding",
        "label": "Embedding",
        "ready": ready,
        "state": state,
        "detail": detail,
        "url": base,
        "managed": True,
    }


@router.get("")
def get_status() -> dict[str, Any]:
    checks = [_forge_status, _comfy_status, _llm_status, _embedding_status]
    with ThreadPoolExecutor(max_workers=len(checks)) as pool:
        services = list(pool.map(lambda fn: fn(), checks))
    return {"services": [_apply_start_error(s) for s in services]}


# ---------------------------------------------------------------------------
# 起動 / 停止（トップバーのチップのオン・オフ）
# ---------------------------------------------------------------------------


def _start_in_background(key: str, fn, *args) -> None:
    """起動は数十秒かかることがあるので待たずに返す。失敗内容は控えておく。"""
    _start_errors.pop(key, None)

    def runner() -> None:
        try:
            fn(*args)
        except Exception as e:  # noqa: BLE001 - 失敗理由をそのまま表示したい
            _start_errors[key] = str(e)

    threading.Thread(target=runner, daemon=True).start()


def _llm_default_model() -> str:
    """前回ロードしたモデル → 名前順の先頭、で既定を選ぶ（LLM パネルと同じ規則）。"""
    presets = llm_client.refresh_model_presets()
    last = str(settings.load().get("llm_model") or "").strip()
    if last and last in presets:
        return last
    return next(iter(sorted(presets.keys())), "")


@router.post("/{key}/start")
def start_service(key: str) -> dict[str, Any]:
    if key == "forge":
        if not sd_process.is_enabled():
            raise HTTPException(status_code=400, detail="外部 Forge を使う設定のため、アプリからは起動できません")
        _start_in_background(key, sd_process.start)
    elif key == "comfyui":
        if not comfy_process.is_enabled():
            raise HTTPException(status_code=400, detail="外部 ComfyUI を使う設定のため、アプリからは起動できません")
        _start_in_background(key, comfy_process.start)
    elif key == "llm":
        model = _llm_default_model()
        if not model:
            raise HTTPException(status_code=400, detail="models/ に LLM モデル（.gguf）が見つかりません")
        _start_in_background(key, llm_client.load_model, model)
    elif key == "embedding":
        _start_in_background(key, embedding_client.ensure_loaded)
    else:
        raise HTTPException(status_code=404, detail=f"unknown service: {key}")
    return {"ok": True}


@router.post("/{key}/stop")
def stop_service(key: str) -> dict[str, Any]:
    _start_errors.pop(key, None)
    try:
        if key == "forge":
            if not sd_process.is_enabled():
                raise HTTPException(status_code=400, detail="外部 Forge はアプリからは停止できません")
            message = sd_process.stop()
        elif key == "comfyui":
            if not comfy_process.is_enabled():
                raise HTTPException(status_code=400, detail="外部 ComfyUI はアプリからは停止できません")
            message = comfy_process.stop()
        elif key == "llm":
            message = llm_client.unload_model()
        elif key == "embedding":
            message = embedding_client.stop()
        else:
            raise HTTPException(status_code=404, detail=f"unknown service: {key}")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "message": message}


# ---------------------------------------------------------------------------
# システムリソース（GPU / VRAM / CPU / RAM）
# ---------------------------------------------------------------------------

try:
    import psutil as _psutil
except ImportError:
    _psutil = None

try:
    import pynvml as _pynvml

    _pynvml.nvmlInit()
    _NVML_HANDLE = _pynvml.nvmlDeviceGetHandleByIndex(0)
except Exception:
    _pynvml = None
    _NVML_HANDLE = None


@router.get("/system")
def system_stats() -> dict[str, Any]:
    result: dict[str, float | None] = {
        "gpu_util": None,
        "vram_used": None,
        "vram_total": None,
        "cpu_util": None,
        "ram_used": None,
        "ram_total": None,
    }
    if _psutil is not None:
        result["cpu_util"] = _psutil.cpu_percent(interval=None)
        vm = _psutil.virtual_memory()
        result["ram_used"] = round(vm.used / 1024**3, 1)
        result["ram_total"] = round(vm.total / 1024**3, 1)
    if _pynvml is not None and _NVML_HANDLE is not None:
        try:
            util = _pynvml.nvmlDeviceGetUtilizationRates(_NVML_HANDLE)
            mem = _pynvml.nvmlDeviceGetMemoryInfo(_NVML_HANDLE)
            result["gpu_util"] = float(util.gpu)
            result["vram_used"] = round(mem.used / 1024**3, 1)
            result["vram_total"] = round(mem.total / 1024**3, 1)
        except Exception:
            pass
    return result
