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


def reset_files() -> None:
    for p in TMP_ROOT.glob("*.code-snippets"):
        p.unlink()
    write_file("things.code-snippets", {"chair": "椅子", "table": "机"})
    write_file("scenery.code-snippets", {"forest": "森", "beach": "浜辺"})
    write_file("people.code-snippets", {"girl": "少女"})


def test_scope() -> None:
    """対象ファイルの絞り込みと、移動先スコープの検証。"""
    # 対象の 2 ファイルを things / scenery に振り直すフェイク（people は対象外）
    def fake(messages, schema, max_tokens=2048, temperature=0.1):
        if "categories" in schema["properties"]:
            return {
                "categories": [
                    {"file": "furniture.code-snippets", "description": "家具"},
                    {"file": "nature.code-snippets", "description": "自然"},
                    {"file": "people.code-snippets", "description": "人物"},  # 対象外と同名
                ]
            }
        out = []
        for line in messages[-1]["content"].splitlines():
            if not line.startswith("{"):
                continue
            item = json.loads(line)
            text = item["text"].split(" / ")[0]
            out.append({"id": item["id"], "category": 0 if text in {"chair", "table"} else 1})
        return {"assignments": out}

    llm_client.chat_json = fake
    include = ["things.code-snippets", "scenery.code-snippets"]

    # --- 移動先を選択内に限る（既定）------------------------------------
    reset_files()
    events: list[dict] = []
    plan = snippet_organize.build_plan(events.append, include=include)
    assert plan["selected_files"] == sorted(include), plan["selected_files"]
    assert plan["total"] == 4, plan["total"]  # people の 1 件は対象外
    assert "people.code-snippets" not in [c["file"] for c in plan["categories"]]
    assert any("対象外のファイルと同名" in e.get("content", "") for e in events)
    assert {m["from"] for m in plan["moves"]} == set(include)
    assert sorted(plan["created"]) == ["furniture.code-snippets", "nature.code-snippets"]
    assert sorted(plan["emptied"]) == sorted(include)

    snippet_organize.apply_plan(plan["moves"], make_backup=False)
    files = {f["path"]: f["count"] for f in snippet_organize.snippets.list_files()}
    assert files == {
        "furniture.code-snippets": 2,
        "nature.code-snippets": 2,
        "people.code-snippets": 1,  # 対象外は手つかず
    }, files
    assert "// セクションコメント" in snippets.read_file("people.code-snippets")

    # --- 移動先に選択外のファイルも許す ----------------------------------
    reset_files()

    def fake_to_people(messages, schema, max_tokens=2048, temperature=0.1):
        if "categories" in schema["properties"]:
            return {"categories": [{"file": "furniture.code-snippets", "description": "家具"}]}
        # 追加された「people」カテゴリ（index 1）へ全部送る
        out = []
        for line in messages[-1]["content"].splitlines():
            if line.startswith("{"):
                out.append({"id": json.loads(line)["id"], "category": 1})
        return {"assignments": out}

    llm_client.chat_json = fake_to_people
    plan2 = snippet_organize.build_plan(
        lambda e: None, include=include, targets_within_selection=False
    )
    cats = [c["file"] for c in plan2["categories"]]
    assert cats == ["furniture.code-snippets", "people.code-snippets"], cats
    assert {m["to"] for m in plan2["moves"]} == {"people.code-snippets"}

    snippet_organize.apply_plan(plan2["moves"], make_backup=False)
    files2 = {f["path"]: f["count"] for f in snippet_organize.snippets.list_files()}
    assert files2 == {"people.code-snippets": 5}, files2

    # --- 空のファイルは「空になるファイル」に数えない ---------------------
    reset_files()
    (TMP_ROOT / "empty.code-snippets").write_text("{}\n", encoding="utf-8")
    llm_client.chat_json = fake
    plan3 = snippet_organize.build_plan(lambda e: None, include=include)
    assert "empty.code-snippets" not in plan3["emptied"], plan3["emptied"]

    print("OK: snippet organize scope")


if __name__ == "__main__":
    try:
        main()
        test_scope()
    finally:
        shutil.rmtree(TMP_ROOT, ignore_errors=True)
        shutil.rmtree(snippet_organize.BACKUP_DIR, ignore_errors=True)
