# スニペット仕様

作成日時: 2026-08-08 19:10
更新日時: 2026-08-08 20:05

プロンプト断片（スニペット）の保存形式・照合規則・API・自動整理をまとめた仕様メモ。
実装は `server/library/snippets.py` / `server/library/snippet_organize.py` /
`server/routes/snippets.py` と、`frontend/snippet-*.js`。

## 1. データの持ち方

- 保存場所は **`snippets/` フォルダ**（既定）。設定 `snippets_root`（`settings.json`）で
  変更でき、絶対パスでも相対パス（リポジトリルート基準）でも指定できる。
- 1 ファイル = 1 カテゴリ。拡張子は **`.code-snippets`**（VSCode のユーザースニペットと同形式）。
  サブフォルダも `rglob` で再帰的に読まれる。
- フォルダが正のデータで、DB には入らない。ファイルを直接編集してもアプリ側の再読み込みで反映される。
- 現在の構成は `sd_<領域>_<主題>` という命名（例: `sd_character_pose_expression`、`sd_lighting`）。

### ファイル形式

JSON オブジェクトの各キーが 1 スニペット。`//` の行コメントを書ける（JSONC）。
読み込み時に `strip_jsonc_comments()` で除去してから `json.loads()` する。BOM 付き
（`utf-8-sig`）でも読める。

```jsonc
{
  // 照明
  "cinematic lighting": {
    "prefix": "cinematic lighting",
    "body": ["cinematic lighting"],
    "description": "映画的なライティング"
  }
}
```

| フィールド | 役割 |
| --- | --- |
| キー（`name`） | 管理用の名前。ファイル内で一意。UI の項目名 |
| `prefix` | 補完・検索のキー。候補一覧に表示される |
| `body` | 実際に挿入される文字列。配列なら改行で連結。文字列でも可 |
| `description` | 候補一覧やツールチップに出る説明（日本語で書いている） |

`body` が空のスニペットは `GET /api/snippets`（カタログ）から除外される。ファイル編集
UI 用の `GET /api/snippets/entries` では空でも返る。

## 2. プロンプトとの照合規則

補完とハイライトは同じ規則を使う（`frontend/snippet-catalog.js` に集約）。

- **セグメント分割** (`splitSegments`)：カンマと改行で区切る。ただし `(` `[` `{` の中の
  カンマでは切らない。`\(` のエスケープは深さに数えない。
- **正規化** (`normalizeSegment`)：強調記法 `(word)` `((word))` `[word]` を外側から剥がし、
  `(word:1.2)` の重み指定を落とす。`_` を空白に、連続空白を 1 つに、小文字化する。
- **インデックス**：`body` を分割・正規化して連結したキーと、`prefix` の正規化キーの
  両方でスニペットを引ける。`body` が複数セグメントのスニペットは、連続するセグメントの
  **最長一致**（最大 12 セグメント）で拾う。

この規則により、`(cinematic lighting:1.3)` や `cinematic_lighting` も
`cinematic lighting` として登録済みと判定される。

## 3. UI

| 機能 | 実装 | 概要 |
| --- | --- | --- |
| 自動候補 | `snippet-autocomplete.js` | 入力中のセグメントを `prefix` と照合して候補を出す。↑↓ 選択、Tab / Enter 挿入、Esc で閉じる |
| 登録済みハイライト | `snippet-highlight.js` | textarea の背後にバックドロップを敷き、登録済みの語だけ色を変える。未登録の語は右クリックから登録できる |
| スニペット編集モード | `snippets.js` | 左: ファイル一覧（ファイル数と総項目数を表示）／ 中: 項目一覧（全ファイル横断検索）／ 右: フォーム編集と生 JSON 編集 |

- 項目は中央ペインから左のファイルへ**ドラッグして移動**できる（移動先へ追記 → 元から削除の順で両方保存）。
  **Ctrl クリックでトグル選択、Shift クリックで範囲選択**でき、選択した複数件をまとめてドラッグできる
  （グリッドと同じ操作）。選択外の項目をドラッグしたときは、その 1 件だけを掴む。
  移動先には**元の並び順のまま**追記し、削除は後ろの index から行って ずれを避ける。
  フォームに出るのは最後にクリックした 1 件（左端のアクセント線）で、削除ボタンは選択件数に追従する。
- 保存・作成・削除の後は `snippets-changed` イベントでカタログのキャッシュを捨てる。
- フォーム編集で保存するとファイル全体が書き直されるため、**そのファイルの `//` コメントは失われる**。
  コメントを残したいファイルは JSON 編集モードで編集する。

## 4. API

| メソッド / パス | 内容 |
| --- | --- |
| `GET /api/snippets` | 全ファイル横断のカタログ（`name` / `prefix` / `body` / `description` / `source`） |
| `GET /api/snippets/files` | ファイル一覧（`path` / `name` / `count`） |
| `GET /api/snippets/file?path=` | 生テキスト取得 |
| `PUT /api/snippets/file` | 生テキスト保存（JSONC として検証してから一時ファイル経由で置換） |
| `POST /api/snippets/file` | 新規作成（サンプル 1 件入りのテンプレート） |
| `DELETE /api/snippets/file?path=` | 削除 |
| `POST /api/snippets/file/rename` | リネーム |
| `GET /api/snippets/entries?path=` | フォーム編集用のエントリ配列 |
| `POST /api/snippets/entry` | 1 件追記（ファイル末尾の `}` の直前に挿入するのでコメントが残る） |
| `GET /api/snippets/root` / `POST /api/snippets/root` | スニペットフォルダの取得・変更 |
| `POST /api/snippets/reveal` | エクスプローラーで開く（Windows のみ） |
| `POST /api/snippets/organize/plan` | 自動整理の案を作る（SSE、**読み取りのみ**） |
| `POST /api/snippets/organize/apply` | 整理案を適用する |

パスは必ず `_resolve()` を通し、スニペットルート外や `.code-snippets` 以外の拡張子は拒否する。

## 5. 自動整理（ローカル LLM）

`server/library/snippet_organize.py`。**LLM にファイルを書かせない**のが前提で、
案（JSON）を作る処理と、それを適用する処理を分けている。

### フェーズ 1: カテゴリ設計

現在のファイル名・件数と、各ファイルから等間隔に抜いた最大 20 件のサンプル（`prefix` と
`description`）だけを渡し、整理後のカテゴリ一覧を出させる。全件を渡さないのは
`n_ctx`（既定 8192）に収めるため。

出力されたファイル名は `_normalize_file_name()` で
**英小文字・数字・アンダースコアのみ**に正規化する（サブフォルダ指定は basename に丸める）。
これによりパストラバーサルや不正な文字のファイルが作られることはない。

### フェーズ 2: 振り分け

カテゴリ一覧を固定し、スニペットを **40 件ずつ**のバッチで割り当てさせる。1 件あたり
`{"id", "text", "now"}`（`text` は `prefix / description`、`now` は現在のファイル名）だけを渡す。
`body` は渡さない。バッチが失敗したら警告イベントを出して次へ進み、そのバッチの項目は未分類として
現在の場所に残す。

どちらのフェーズも `llm_client.chat_json()` を使い、llama-server の
`response_format: json_schema` で JSON を強制する。古いビルドで弾かれた場合は
`json_object` → 素の生成の順にフォールバックし、`<think>` ブロックと ```` ```json ```` フェンスを
剥がしてからパースする。

### 整理案（plan）の構造

```jsonc
{
  "categories": [{ "file": "sd_animals.code-snippets", "description": "動物" }],
  "moves": [{ "name": "cat", "prefix": "cat", "from": "mixed.code-snippets", "to": "sd_animals.code-snippets" }],
  "counts": { "sd_animals.code-snippets": 2 },  // 移動後の件数
  "created": ["sd_animals.code-snippets"],      // 新しくできるファイル
  "emptied": ["mixed.code-snippets"],           // 空になる見込みのファイル
  "touched": ["mixed.code-snippets", "sd_animals.code-snippets"],
  "total": 5, "unassigned": 0, "failed_batches": 0
}
```

移動先が現在のファイルと同じ項目は `moves` に入らない。UI ではこの案を移動先ごとに
グループ表示し、チェックを外した項目を除いて適用できる。

### 適用

`apply_plan(moves, delete_emptied, make_backup)` の順序:

1. 全ファイルを読み直し、**いま実在する `(from, name)` の移動だけ**を対象にする
   （案を作った後にファイルを編集していた場合、古い移動は黙って捨てられる。1 件も残らなければエラー）。
2. `data/snippet_backups/<日時>/` にスニペットフォルダをコピーする。
3. 移動が発生したファイルだけを書き直す（`prefix` / `body` / `description` はそのまま維持。
   移動先で名前が衝突したら `_2` 以降の連番を付ける）。
4. `delete_emptied` が真なら、空になったファイルを削除する。

**注意**：書き換え対象になったファイルの `//` コメントは失われる（バックアップには残る）。
移動が 1 件も無かったファイルは触らないのでコメントも残る。

### 制約

- llama-server が 1 プロセスなので、整理中は他の LLM 機能（動画プロンプト生成など）と排他になる。
- 約 580 件・40 件バッチで 15 回程度の推論が走る。ローカルモデルでは数分かかる。
- カテゴリ設計の質はモデル依存。UI の「整理の方針」欄で方向づけし、差分を見てから適用する運用を前提にしている。

## 6. 検証

`python tests/test_snippet_organize.py`（`chat_json` をフェイクに差し替え、一時フォルダで
案の生成 → 適用 → バックアップ → 不正パスの正規化までを確認する）。
