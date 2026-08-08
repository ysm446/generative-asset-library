"""スニペット自動整理のスモークテスト。

一時フォルダをスニペットルートにし、LLM 呼び出し（chat_json）をフェイクに
差し替えて、整理案の生成と適用を一通り実行する。
実行: python tests/test_snippet_organize.py
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import settings
from server.generation import llm_client
from server.library import snippet_organize, snippets

TMP_ROOT = Path(tempfile.mkdtemp(prefix="studio-snippets-test-"))

# 実 settings.json を触らずにスニペットルートを差し替える
settings.load = lambda: {"snippets_root": str(TMP_ROOT)}
settings.update = lambda patch: {"snippets_root": str(TMP_ROOT)}
snippet_organize.BACKUP_DIR = TMP_ROOT.parent / "snippet-test-backups"


def write_file(name: str, entries: dict[str, str]) -> None:
    obj = {
        key: {"prefix": key, "body": [key], "description": desc}
        for key, desc in entries.items()
    }
    (TMP_ROOT / name).write_text(
        "{\n  // セクションコメント\n" + json.dumps(obj, ensure_ascii=False, indent=2)[1:],
        encoding="utf-8",
    )


def main() -> None:
    write_file(
        "mixed.code-snippets",
        {"cat": "猫", "dog": "犬", "sunset": "夕焼け", "rainy": "雨"},
    )
    write_file("keep.code-snippets", {"masterpiece": "品質"})

    assert len(snippet_organize.collect_entries()) == 5

    # --- フェイク LLM ---------------------------------------------------
    # カテゴリ設計 → 動物 / 天気、振り分けは prefix で機械的に決める
    animals = {"cat", "dog"}
    weather = {"sunset", "rainy"}

    def fake_chat_json(messages, schema, max_tokens=2048, temperature=0.1):
        if "categories" in schema["properties"]:
            return {
                "categories": [
                    {"file": "SD Animals", "description": "動物"},  # 正規化されるはず
                    {"file": "sd_weather.code-snippets", "description": "天気"},
                    {"file": "keep.code-snippets", "description": "品質"},
                ]
            }
        user = messages[-1]["content"]
        out = []
        for line in user.splitlines():
            if not line.startswith("{"):
                continue
            item = json.loads(line)
            text = item["text"].split(" / ")[0]
            cat = 0 if text in animals else 1 if text in weather else 2
            out.append({"id": item["id"], "category": cat})
        return {"assignments": out}

    llm_client.is_loaded = lambda: True
    llm_client.chat_json = fake_chat_json

    events: list[dict] = []
    plan = snippet_organize.build_plan(events.append, batch_size=3)

    assert [c["file"] for c in plan["categories"]] == [
        "sd_animals.code-snippets",
        "sd_weather.code-snippets",
        "keep.code-snippets",
    ], plan["categories"]
    assert plan["total"] == 5
    assert plan["unassigned"] == 0
    assert len(plan["moves"]) == 4  # keep.code-snippets の 1 件は移動なし
    assert plan["emptied"] == ["mixed.code-snippets"]
    assert plan["created"] == ["sd_animals.code-snippets", "sd_weather.code-snippets"]
    assert any(e.get("type") == "progress" for e in events)

    # 案を作っただけではファイルは変わっていない
    assert {f["path"] for f in snippets.list_files()} == {
        "mixed.code-snippets",
        "keep.code-snippets",
    }

    # --- 適用 -----------------------------------------------------------
    res = snippet_organize.apply_plan(plan["moves"])
    assert res["moved"] == 4, res
    assert res["deleted"] == ["mixed.code-snippets"], res
    assert Path(res["backup"]).is_dir()
    assert (Path(res["backup"]) / "mixed.code-snippets").is_file()

    files = {f["path"]: f["count"] for f in snippets.list_files()}
    assert files == {
        "sd_animals.code-snippets": 2,
        "sd_weather.code-snippets": 2,
        "keep.code-snippets": 1,
    }, files
    # 中身（prefix / body / description）が保たれている
    animals_entries = {e["prefix"]: e for e in snippets.parse_entries("sd_animals.code-snippets")}
    assert set(animals_entries) == {"cat", "dog"}
    assert animals_entries["cat"]["description"] == "猫"
    assert animals_entries["cat"]["body"] == "cat"
    # 触っていないファイルのコメントは残る
    assert "// セクションコメント" in snippets.read_file("keep.code-snippets")

    # --- 不正な移動先はルート内の安全な名前に丸められる -------------------
    assert snippet_organize._normalize_file_name("../evil") == "evil.code-snippets"
    assert snippet_organize._normalize_file_name("C:/tmp/x.txt") == "xtxt.code-snippets"
    assert snippet_organize._normalize_file_name("sub/dir/name") == "name.code-snippets"
    assert snippet_organize._normalize_file_name("///") == ""

    snippet_organize.apply_plan(
        [{"from": "sd_animals.code-snippets", "name": "cat", "to": "../evil.code-snippets"}],
        make_backup=False,
    )
    assert (TMP_ROOT / "evil.code-snippets").is_file()
    assert not (TMP_ROOT.parent / "evil.code-snippets").exists()  # ルート外に出ていない
    # 元に戻す
    snippet_organize.apply_plan(
        [{"from": "evil.code-snippets", "name": "cat", "to": "sd_animals.code-snippets"}],
        make_backup=False,
    )
    assert not (TMP_ROOT / "evil.code-snippets").exists()

    # 存在しない項目だけの移動は「適用できる移動がありません」
    try:
        snippet_organize.apply_plan(
            [{"from": "sd_animals.code-snippets", "name": "missing", "to": "keep.code-snippets"}]
        )
    except snippet_organize.OrganizeError:
        pass
    else:
        raise AssertionError("存在しない項目の移動が通ってしまいました")

    print("OK: snippet organize")


if __name__ == "__main__":
    try:
        main()
    finally:
        shutil.rmtree(TMP_ROOT, ignore_errors=True)
        shutil.rmtree(snippet_organize.BACKUP_DIR, ignore_errors=True)
