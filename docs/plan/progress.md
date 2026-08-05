# Progress

作成日時: 2026-05-19 23:05
更新日時: 2026-08-05 21:30

このファイルは、完了した作業、確認したこと、残っている注意点を共有するための進捗管理ドキュメントです。

## 現在の状態

Generative Asset Library は、初期の Gradio / A1111 想定から、Electron UI + FastAPI + ローカル `llama-server` + Forge / ComfyUI を組み合わせる構成へ発展している。

現在は、画像生成・動画生成・AI チャット・スニペット管理・画像ライブラリがひと通り揃い、直近では画像ライブラリとライブラリ参照チャットの機能拡張が進んでいる。

最近の更新では、過去画像を保存し、その過去画像を LLM が参照できる情報として蓄積する方向性が強まっている。画像、プロンプト、Caption、tags、notes、embedding を組み合わせ、過去の作例から次のプロンプト精度を高める流れを作っている。

## 完了済みの主な作業

### アプリ基盤

- アプリ名を Image Assistant に変更した。
- Electron のデスクトップ UI と FastAPI サーバー構成に移行した。
- バックエンドを `server.py` から route モジュールへ分割し、共通ユーティリティを抽出した。
- フロントエンドの `app.js` を `frontend/modules/` 以下の ES modules へ分割した。
- `settings.json` にモデル、生成パラメータ、保存先、workflow 選択などを保存する構成にした。

### ローカル LLM

- `llm_client.py` で `llama-server` の OpenAI 互換 API を利用する構成にした。
- `models/` 配下の GGUF モデルをスキャンして選択できるようにした。
- Vision 対応モデルの `mmproj` 検出に対応した。
- LLM モデル選択ボタンと選択モーダルをトップバーに追加した。
- Qwen3 系などの `<think>...</think>` をストリームから除去する処理を入れた。

### 画像生成

- SD WebUI Forge と ComfyUI を画像生成バックエンドとして扱えるようにした。
- Forge / ComfyUI の管理対象プロセス起動と接続状態表示を追加した。
- 画像生成、生成キュー、生成中表示、経過時間表示を追加した。
- PNG メタデータから Positive / Negative Prompt、Seed、生成パラメータを読み取れるようにした。
- 生成画像のリセット時に、表示中の生成画像もクリアするようにした。

### 動画生成

- ComfyUI workflow を使った動画生成に対応した。
- 画像プロンプトと動画ページの専用入力画像をもとに、動画プロンプトを LLM で生成できるようにした。
- Scene / Action / Camera / Style / Final Prompt などのセクション生成に対応した。
- 動画生成完了時の効果音と、効果音のオン・オフ切り替えを追加した。
- 動画ページに専用の入力画像と基画像プロンプト欄を追加し、画像のドロップ時にメタデータと同名JSONの動画プロンプト・追加指示を読み込めるようにした。画像生成ページからの転送にも対応した。
- 動画ページの JSON 保存先を、専用入力画像と同じフォルダ・ファイル名に揃えた。

### AI チャットとプロンプト管理

- 画像生成タブの AI チャットで、現在画像と現在プロンプトを文脈に含められるようにした。
- `[PROMPT_UPDATE]` ブロックを解析し、Positive / Negative Prompt に反映できるようにした。
- チャット用システムプロンプトを `data/chat_prompts.json` に保存する構成にした。
- チャット UI にシステムプロンプト選択、コンテキスト長スライダー、コンテキスト量ゲージ、プロンプトデバッグビューアを追加した。
- ユーザー発言は吹き出し、AI 応答はプレーンテキストに近い表示へ調整した。

### 画像ライブラリ

- 画像ライブラリを追加し、画像・サムネイル・SQLite DB を `data/library/` 配下で管理する構成にした。
- 画像登録時に PNG メタデータからプロンプトや Seed を抽出できるようにした。
- ライブラリ詳細モーダルで Prompt、Caption、tags、notes を編集できるようにした。
- Vision 対応 LLM による Caption 生成と、一括 Caption 生成を追加した。
- Caption 生成時に tags も生成し、保存できるようにした。
- Qwen3 Embedding を使った embedding 作成と再インデックス化を追加した。
- FTS5 とベクトル検索を組み合わせたハイブリッド検索を追加した。
- `{library_context}` を含むチャットプロンプトで、類似プロンプトを LLM に渡せるようにした。
- フォルダ機能、ネストしたフォルダ、ドラッグ並び替え、リネーム、サイドバーリサイズを追加した。
- 複数選択、フォルダへの一括移動、一括削除、ページネーション、無限スクロールを追加した。
- 詳細モーダルに前後移動を追加した。

### スニペット管理

- `snippets/` 配下の `.code-snippets` を UI で検索・編集できるようにした。
- スニペット検索、ヘルプ、アイコン、レイアウト調整を追加した。
- スニペット管理画面の背景とレイアウトをアプリ全体に合わせて調整した。

### UI / 運用

- メインナビゲーションを左サイドバーからトップバーへ移動した。
- SD / ComfyUI のバックエンド操作ボタン、VRAM 表示、ステータス表示をトップバーに整理した。
- GPU / VRAM 取得に必要な `nvidia-ml-py` をアプリ用 `.venv` の依存関係へ追加し、不足時に起動処理で再導入するようにした。
- VRAM 使用状況の詳細内訳をデバッグ表示できるようにした。
- LLM、Forge、ComfyUI のモデル解放やメモリ解放操作を追加した。
- アプリ終了時に関連するコンソール画面も閉じるようにした。

### スニペット（2026-07-22）

- 旧 Image Assistant のスニペット機能を Studio へ移植した（VSCode `.code-snippets` 形式、`snippets/` フォルダは設定 `snippets_root` で変更可）。
- Prompt / Negative Prompt / 動画プロンプトの入力中に prefix の自動候補を表示する
  `frontend/snippet-autocomplete.js` を追加した（↑↓ / Tab / Enter / Esc、候補メニューは body 直下に共有 1 個）。
- スニペットタブをフォーム式編集 UI（ファイル一覧 / 項目一覧＋全ファイル検索 / Name・Prefix・Description・Body フォーム）にし、生 JSON 編集にも切り替え可能にした。`GET /api/snippets/entries` を追加。保存はフロントで JSON を組み立てて既存 `PUT /api/snippets/file` を使う（JSONC のコメントは保存時に失われる）。
- シーケンス編集・スニペット編集で Ctrl+S 保存に対応した。

### 生成結果の配置と NEW 表示（2026-07-22）

- 画像生成 API に `near_item`（元画像 ID）を追加。指定時は `items.place_before` で
  元画像の sort_order ＋ 1e-6 を設定し、一覧（sort_order 降順＝新しいものほど左・上）で
  元画像のすぐ左隣（直前）に並べる。同じ元画像から複数生成した場合は created_at 降順の
  タイブレークで新しい順が保たれる。
- フロントは「✨ この設定で新規生成」（state.genNearId、フォルダ移動でクリア）と
  詳細パネルの「🖼 新規生成でキューに追加」で near_item を渡す。通常のフォルダ生成は従来通り先頭。
- 生成完了時にアイテム ID を localStorage（`studio_new_item_ids`、直近 300 件）へ記録し、
  カードに NEW バッジ（accent 色・点滅）を表示。クリック（handleCardClick / selectItem）で解除。
- 動画にも同様の NEW バッジを追加。キーは「アイテムID/videos/vNNN.mp4」で
  `studio_new_video_ids` に保持し、動画ストリップのカードに表示、handleVideoClick で解除。
- 未確認の新規動画を持つ画像のグリッドカードに「🎞 NEW」（琥珀色 #ffb74d）を表示。
  画像自体の NEW（青）と色で区別。hasNewVideo / pruneNewVideos を追加し、
  動画クリック（handleVideoClick / open-library-item）で解除時に renderGrid、
  selectItem・動画一括削除時に削除済み動画のキーを掃除。
- スニペットファイルの右クリックメニュー（名前を変更 / 削除）を追加。
  リネームは `POST /api/snippets/file/rename`（`snippets.rename_file`、パス検証・重複チェック・
  サブフォルダ移動対応）。削除はツールバーの 🗑 と共通化（deleteFileByPath）。
  スモークテストでリネーム・不正パス拒否を確認。タブ検索は既に全ファイル対象と確認済み。
- スニペット項目のファイル間移動（項目一覧 → ファイル一覧へのドラッグ＆ドロップ）を追加。
  moveEntryToFile は移動先へ追記保存 → 元ファイルから削除保存の順（元ファイルの未保存編集も一緒に確定）。
  移動先の JSON が不正な場合はエラー表示で中断し、元ファイルは変更されない。JSON 編集モード中はドラッグ無効。
- シーケンスのノード右クリックメニューを追加（sequence.js 内で .context-menu を再利用）。
  「ライブラリの元動画を表示」は `open-library-item` カスタムイベントで app.js に通知し、
  app.js 側でタブ切替 → フォルダ/アイテム選択 → 動画プロパティ表示まで行う（モジュール間は疎結合）。
- 検証: `tests/test_generation_service.py` に near_item の配置と参照元欠落時のフォールバックを追加し、
  `test_library_core.py` と合わせて通過。UI は実機での確認が必要（サーバー変更のため要再起動）。
- バグ修正: 動画生成パネル表示中（videoPanel=true）は renderContext が selectedVideoFile より
  生成パネルを優先するため、生成直後の動画をストリップでクリックしてもプロパティに切り替わらなかった。
  handleVideoClick で videoPanel を解除するよう修正。
- グリッド内並べ替えを複数選択ドラッグに対応（internalDragId → internalDragIds、
  reorderItems は選択群をグリッド順のままドロップ位置へ挿入）。フォルダへの複数ドロップ移動は従来通り。
- 動画生成前の LLM アンロード（旧 unload_llm_before_video 相当）を移植。
  `state.genVideo.unload_llm`（既定 true、gen_video として保存）→ enqueueVideoJob で常に params に付与 →
  サーバー `generate_video_for_item` が `params.get("unload_llm", True)` で llama-server を停止。
  チェックボックスは動画生成パネルの Seed と生成ボタンの間。動画プロパティからの再生成にも共通設定が効く。
- 検証: `node --check`、`parse_entries` のスモークテスト、テスト用サーバー（ポート 8799）＋ヘッドレス Chrome のスクリーンショットで UI を確認。候補メニューはヘッドレスのスクリーンショットでのみ描画されない現象があったが、DOM・ヒットテスト・clone 描画・キー操作での挿入はすべて正常で、ヘッドレス固有のコンポジット問題と判断（実機は Ctrl+R 後に要確認）。

### 設定パネルとウインドウサイズ（2026-07-23）

- 上部バー右端に歯車ボタン（#btn-settings）を追加し、#settings-panel（queue-panel と
  同様の右上ドロップダウン）に設定項目を集約した。
  - ライブラリ: 保存先フォルダ（現在パス表示＋変更＋既定に戻す）、インデックス再構築。
  - 検索: Embedding 更新。
  - #btn-embed / #btn-reindex は ID を維持したままパネル内へ移動（既存ハンドラそのまま）。
    保存先変更は changeLibraryRoot(reset) に共通化し、ツリー下の #btn-root
    （Shift+クリックで既定に戻す）と設定パネルの両方から呼ぶ。
  - 外側クリックで閉じる（#btn-settings 自体は closest 判定で除外しトグルに任せる）。
- Electron のメインウインドウを useContentSize: true の 1920x1080 にし、
  コンテンツ領域が 1920x1080 になるようにした（electron/main.js、要アプリ再起動）。
- 検証: puppeteer-core（scratchpad に導入）＋ヘッドレス Chrome で、開閉（歯車 / ✕ /
  外側クリック）、パネル内のインデックス再構築実行、保存先パス表示を確認。

### フラットアイコン化（2026-07-23）

- UI の絵文字アイコンを `frontend/icons.js` のフラット SVG アイコン（ストローク系・
  currentColor・24 viewBox、Lucide 風）に置き換えた。サイズは CSS `.ico`（1.2em）で
  フォントサイズに追従する。
- 使い方: 静的 HTML は `data-icon="name"` ＋ `applyStaticIcons()`（app.js 起動時に実行）。
  JS 生成要素は `setIconLabel(el, name, text)`（text は textNode なのでエスケープ不要）
  または `iconSvg(name)`。コンテキストメニューは entries に `icon` フィールドを追加。
- 対象外: ステータス文言内の ⚠（テキストメッセージ）、→ / ↑↓ などの文字記号、
  snippet-autocomplete のキーヒント、コメント内の絵文字。
- 検証: node --check 全ファイル、テスト用サーバー＋ヘッドレス Chrome で
  ライブラリ / シーケンス / スニペット 3 タブのスクリーンショットを確認。
  Ctrl+R で反映可能（フロントのみの変更）。

### サービス状態インジケーターの遷移表示（2026-07-23）

- `/api/status` の各サービスに `state`（ready / starting / installing / error / off）と
  `detail` を追加。HTTP プローブに加え、各プロセスモジュールへ追加した軽量な
  `process_state()`（HTTP プローブ・ロック取得なし）で「プロセスは起動しているが
  まだ応答しない = starting」「異常終了 = error」を判定する。
  - llm_client は load_model 中 `_lock` を最大 120 秒保持するため、`process_state()` は
    ロックを取らずにモジュール変数を直接読む（get_status() は従来通り）。
  - llama-server はモデルロード中 /health が 503 のため「200 = ロード完了」で判定できる。
  - 正常停止時はプロセス変数が None に戻るため、returncode が残っている場合のみ error 扱い。
- フロントのチップは 4 色（灰/琥珀点滅/緑/赤）＋遷移中テキスト（detail 優先）。
  遷移中はポーリングを 8 秒 → 1.5 秒に短縮する setTimeout チェーンに変更。
- 検証: `_resolve_state` の全パターン、テスト用サーバー（8797）での API 応答、
  ヘッドレス Chrome での見た目（5 状態のチップ）、`test_generation_service.py` 通過。
  実際の起動遷移（Forge 起動中→緑）は実機で要確認。サーバー変更のため要再起動。

### バグ修正（2026-07-23）

- ライブラリのフォルダ名を大文字↔小文字だけ変更できなかった問題を修正。Windows の
  ファイルシステムが大文字小文字を区別しないため、`rename_folder` の `dest.exists()` が
  自分自身を検出して「folder already exists」になっていた。`samefile` で同一フォルダと
  判定できた場合のみリネームを許可（別フォルダとの衝突は従来通りエラー）。
  一時ライブラリでの動作確認と `tests/test_library_core.py` 通過を確認。

### シーケンス一覧のフォルダ分け（2026-07-24）

- シーケンス一覧を 1 段のフォルダで整理できるようにした。フォルダは表示上のグループで、
  各シーケンス JSON の `folder` フィールド（フォルダ名）で所属を持ち、フォルダの一覧と
  表示順は `.studio/sequences/folders.json` に保存する（空フォルダの保持のため）。
  `folder` なしは「未分類」として一覧の末尾に表示する。
- API: `GET /api/sequences` の応答に `folders` を追加、`POST/PATCH/DELETE
  /api/sequences/folders(/{name})` を追加、`PATCH /api/sequences/{id}` の `folder` で移動
  （folder のみの更新は updated_at を変えない）。フォルダ削除時は中のシーケンスを未分類へ戻す。
- フロント: フォルダ行の開閉（localStorage `studio_seq_folders_collapsed` に保持）、
  ツールバーの「新規フォルダ」ボタン、行の […] メニューに「フォルダへ移動」を追加。
  シーケンスのドラッグはフォルダ行へのドロップ（移動）とフォルダをまたぐ並べ替えに対応。
  並び順は表示順（フォルダ順に平坦化した ID 列）を既存の reorder API で保存する。
- 検証: `tests/test_sequences.py` 通過、一時ライブラリでのフォルダ CRUD・移動・
  日本語フォルダ名の API 動作確認、`node --check frontend/sequence.js` 通過。
  フォルダのドラッグ並べ替え（フォルダ自体の順序変更）は未実装（folders.json の並びに
  依存。必要になったら追加する）。

### フォルダツリーの NEW バッジ（2026-07-24）

- ライブラリの左のフォルダツリーに、未確認の新規画像・動画を含むフォルダの NEW バッジを
  追加した（新規画像=青、新規動画のみ=琥珀・フィルムアイコン。親フォルダにもロールアップ表示）。
- 実装はフロントのみ。既存の localStorage の NEW 管理（`studio_new_item_ids` /
  `studio_new_video_ids`）に加えて、新着アイテムの所属フォルダの控え
  `studio_new_item_folders`（id → rel）を追加し、renderTree 時にフォルダ rel の
  前方一致で判定する。
- 控えの整合性: 生成時に folder を記録、アイテムのドラッグ移動・フォルダの移動/リネームで
  追従、アイテム/フォルダ削除でクリア、loadItems 時に実データで自己修復（旧データも
  一覧を開けば直る）。NEW 解除（クリック）時は renderTree してバッジを即時反映。
- 検証: `node --check frontend/app.js`、テスト用サーバー＋ヘッドレス Chrome で
  localStorage を仕込んだスクリーンショットにより画像 NEW（青）・動画 NEW（琥珀）の
  両表示とルートへのロールアップを確認。フロントのみの変更のため Ctrl+R で反映可能。

### 動画サムネイルの右クリックメニュー（2026-07-25）

- 下部の動画ストリップのサムネイルに右クリックメニューを追加した（「ファイルの場所を開く」
  「削除」。複数選択中のサムネイルを右クリックした場合は「選択した N 件を削除」）。
  動画のプロパティパネルにも「ファイルの場所を開く」ボタンを追加した。
- サーバー側は `POST /api/library/items/{item_id}/videos/{file_name}/reveal` を追加。
  画像側の reveal と共通の `_reveal()` に切り出した（Windows のみ、`explorer /select,`）。
  `file_name` はベース名に丸めてから `videos/` 配下で解決するためパス脱出はしない。
- `frontend/menu.js` の「メニューを閉じない要素」の判定に `.vstrip-card` を追加した。
- 検証: `node --check frontend/app.js` / `frontend/menu.js`、一時ライブラリ＋
  TestClient で reveal API（正常・存在しないファイル 404・パス脱出 404）と
  一括削除の非退行を確認、`tests/test_library_core.py` 通過。サーバー変更を含むため再起動が必要。

### プロンプト欄のスニペット登録済みハイライト（2026-07-28）

- 画像の Prompt / Negative Prompt（生成パネル・画像プロパティの計 4 箇所）で、
  スニペット登録済みの語に点線の下線を引くようにした。動画プロンプトには付けていない。
- `frontend/snippet-catalog.js` を新設し、カタログ取得（`/api/snippets`）と
  照合ロジック（セグメント分割・正規化・複数セグメント body の連結一致）を集約した。
  自動候補（`snippet-autocomplete.js`）も同じカタログを使う。
- 正規化で吸収するもの: 強調 `(word:1.2)` `((word))` `[word]`、`\(` エスケープ、
  `_` と空白、大文字小文字、連続空白、カンマ前後の空け方。
  強調の内側のカンマでは分割しないため `(masterpiece, best quality:1.2)` も 1 語として一致する。
  下線が行末まで伸びないよう、複数セグメントの連結一致は改行をまたがない。
- `frontend/snippet-highlight.js` は、textarea の背後に同じ文字を描いたバックドロップを敷いて
  下線を引く（textarea は部分装飾できないため）。auto-grow で内部スクロールしない前提。
  文字送り・余白は `getComputedStyle` で実測値を写すので CSS 変更にも追従する。
- LLM 生成やスニペット挿入は `.value` を直接書き換えて `input` が飛ばないため、
  対象 textarea に限って `value` setter をラップして再描画する。
- ツールチップは、バックドロップの `pointer-events` をその場だけ有効にして
  `elementFromPoint` で当たり判定する（入力操作は妨げない）。
- 登録動線は右クリック →「スニペットに登録」。`dialog.js` に `showFormDialog` を追加し、
  保存先・名前・prefix・本文・説明を指定して `POST /api/snippets/entry` で追記する。
- `snippets.add_entry` はファイル全体を書き直さず、最後の `}` の直前にテキスト挿入する
  （コメント・整形を保持）。追記後に JSONC として検証し、壊れる場合は保存せずエラーにする。
- 表示の ON/OFF はラベル横のパズルアイコン。`localStorage` の `studio_snippet_highlight` に保存。
- 検証: `node --check`（変更した JS 全て）、照合ロジックの単体確認（強調・重み・改行・
  アンダースコア・prefix 一致・エスケープ）、`add_entry` のスモークテスト（コメント保持・
  同名連番・新規作成・空本文エラー・末尾コメント時は壊さずエラー）、
  ヘッドレス Chrome で重ね合わせのずれ・折り返し・トグル OFF・右クリックメニュー・
  登録ダイアログの表示を確認、`tests/test_library_core.py` 通過。
  サーバー変更（`/api/snippets/entry`）を含むため再起動が必要。

### アプリ名を Generative Asset Library に変更（2026-07-28）

- `Stable Diffusion Studio` から改名した。理由は、動画（i2v・シーケンス）を名前が拾えないことと、
  "Stable Diffusion" が Stability AI の商標で製品名に載せたくないこと。
- 変更したのはユーザーに見える名前だけ: `README.md` / `CLAUDE.md` / `AGENTS.md` /
  `start.bat` / `frontend/index.html` の `<title>` / `electron/main.js` のウィンドウタイトル /
  `electron/package.json` の name・description / `docs/` 内で現行アプリを旧名で呼んでいた箇所。
- 内部識別子は互換性のため据え置き: ライブラリの `.studio/` フォルダ、環境変数
  `STUDIO_LIBRARY_ROOT`、localStorage の `studio_*` キー。改名で既存ライブラリや
  ユーザーの UI 状態を壊さないため。将来変えるなら移行処理とセットで行う。
- 「旧 Image Assistant」という履歴の記述は事実なのでそのまま残している。
- リポジトリのフォルダ名（`d:\GitHub\stable-diffusion-studio`）と GitHub 上のリポジトリ名は未変更。

### 画像パラメータの開閉セクション（2026-07-29）

- Width / Height / Steps / CFG / Sampler を `buildImageParamsSection(key, obj)` にまとめ、
  生成パネル（key: "gen"）と画像プロパティ（key: "item"）の両方で同じ `<details>` を使う。
  ComfyUI 選択時に Steps / CFG / Sampler を出さない条件は従来どおり。
- 開閉は `collapsibleSection()`（`.params-field.section-field`）に共通化し、状態は
  `localStorage: studio_section_open` にキー別で保存（既定は閉じる）。
  閉じているときは summary の右に現在値の要約を出すので、畳んだままでも設定が分かる。
- 検証: ヘッドレス Chrome で、既定で閉じている / 見出しと項目 / 開閉状態の保存と復元 /
  画像プロパティ側も同じ構成になること / 入力が編集できることを確認（12 ケース）。
  閉じた状態・開いた状態の見た目もスクリーンショットで確認。

### 画像選択でグリッドが勝手にスクロールする問題（2026-07-29）

- 症状: ライブラリで画像を選択すると、サムネイル一覧が数行ぶん飛ぶことがある。
  「右端に少し余りが出る幅のとき」に起きやすい、という報告どおりの再現条件だった。
- 原因: 選択のたびに `renderGrid()` がグリッドを全再構築していて、そこへブラウザの
  スクロールアンカリング（`overflow-anchor`）が働き、スクロール位置が補正されていた。
  列の折り返しが変わった直後（アンカーが選び直された直後）に顕著。
- 再現: テスト用ライブラリ 80 件＋ヘッドレス Chrome で、右ペイン幅を 380〜520px まで
  2px 刻みに変えながらカードをクリックする掃引テストを実施。5 パターンで
  scrollTop が 1500 → 1886（約 2 行）飛ぶことを確認した。
  `overflow-anchor: none` を注入した場合、およびクラスだけ差し替えた場合はいずれも 0 件。
- 対策（両方）:
  - 選択が変わっただけのときは `updateGridSelection()` でクラスと NEW バッジだけ差し替え、
    カードを作り直さない（サムネイルの再取得も減る）。`renderGrid()` は一覧が変わるとき専用。
  - `.grid { overflow-anchor: none; }` を保険として追加（生成完了時の再描画などにも効く）。
- 検証: 修正後は掃引テストで 0 件。単一 / Ctrl / Shift 選択とコンテキスト更新、NEW バッジ解除、
  カード数が変わらないことも結合テストで確認。フロントのみの変更で Ctrl+R で反映できる。

### プロンプトの強調（重み）スライダー（2026-07-29）

- `frontend/prompt-weight.js` を追加。プロンプトの語にマウスを載せると、その語の上に
  スライダー（0〜2.0 / 0.1 刻み。当初は 0.05 刻みだったが 2026-07-30 に変更）を出し、
  動かすと強調記法で書き戻す。
  1.0 = 括弧なし、1.1 = `(word)`、それ以外 = `(word:値)`。
  既存表記の読み取りは `(` = ×1.1、`[` = ÷1.1、入れ子は掛け算、`(x:N)` は明示値優先。
  `(a) b (c)` のような「全体を囲っていない括弧」を誤って剥がさないよう、括弧の対応を
  数えてから判定している。
- 書き戻しは `ta.value` の差し替え＋`input` イベントの手動発火（`hookValueSetter` により
  バックドロップも再描画される）。カーソル位置は書き換え位置より後ろなら差分だけずらす。
- 当たり判定を修正した: バックドロップは textarea より下（z-index）にあるため
  `pointer-events` を一時的に有効にしても `elementFromPoint` は常に textarea を返しており、
  既存のスニペットのツールチップは実際には出ていなかった（ヘッドレス Chrome で確認）。
  語ごとの `<span class="snippet-hl-seg">` を敷き、その `getClientRects()` に
  マウス位置が入るかで判定する方式に変更し、ツールチップも直った。
- 下線（`.snippet-hl-mark`）はセグメント境界に揃うので、語の span を外側から包む形で共存させた。
  パズルアイコンの ON / OFF は下線だけに効き、語の span は常に敷く（スライダー用）。
- つまみを掴めなかった不具合を修正: ポップアップ全体の mousedown を `preventDefault` していたため
  range 入力のドラッグまで止まっていた。スライダーとボタンは除外し、余白（語ラベル・数値）だけ
  preventDefault する。スライダーは `appearance: none` で細く描き直し（トラック 3px / つまみ 10px、
  当たり判定は高さ 12px）、左側の塗りは `--pw-fill` を JS から更新している。
- スライダーの見た目（トラック 3px / つまみ 10px / 高さ 12px）は `input[type=range]` の
  共通スタイルに切り出し、BGM 音量スライダーも同じ見た目にした。左側の塗りは
  `--range-fill` を `frontend/range-input.js` の `attachRangeFill` / `syncRangeFill` が更新する。
- ラベル横にスライダーアイコンのトグルを追加（`localStorage: studio_prompt_weight`）。
  下線のパズルトグルとは独立で、オフにすると開いているスライダーも即座に閉じる。
  状態は全プロンプト欄で共有（下線トグルと同じ扱い）。
- 検証: ヘッドレス Chrome で parse / format の 24 ケース（往復変換・エスケープ・入れ子含む）と、
  hover → スライダー表示 → 0.6 / 1.1 / 1.0 の書き戻し → `input` 発火までの
  結合テスト 12 ケースが通過。ポップアップの見た目もスクリーンショットで確認。
  フロントのみの変更なので Ctrl+R で反映できる。

### サービスチップのオン / オフとサイドバー整理（2026-07-29）

- `/api/status` に `POST /api/status/{key}/start` と `/stop` を追加し、トップバーのチップ
  （Forge / ComfyUI / LLM / Embedding）から起動・停止できるようにした。
  - 起動は数十秒〜かかるためスレッドで実行して即座に返す。失敗理由は `_start_errors`
    に控え、`_apply_start_error` が「停止中」を「エラー + 理由」に差し替えて表示する
    （ready / starting になったら控えは破棄）。
  - LLM の起動モデルは `settings.llm_model` → 名前順の先頭（`routes/llm.py` の
    `_preferred_model` と同じ規則）。モデルが無ければ 400。
  - 停止は同期実行（terminate はすぐ返る）。Forge / ComfyUI が外部プロセス設定
    （`is_enabled()` が False）のときは start / stop とも 400 を返す。
  - 各サービスに `managed` を追加。フロントは `managed: false` を `<span>`（押せない）、
    それ以外を `<button>` として描き分ける。停止時のみ `confirm()` で確認する。
- チップの見た目を拡大（font-size 11→12px、padding 2/6→5/12px、ドット 7→8px）。
  `button, .btn-like` の共通スタイルはクラス指定（`.svc-chip`）が優先されるため、
  hover / active だけ `button.svc-chip` で上書きしている。
- ライブラリ / スニペットのルート表示（`.root-bar`）をサイドバー最下部から最上部へ移動し、
  区切り線を `border-top` → `border-bottom` に変更。
- ライブラリのフォルダツリーのツールバー（新規フォルダ・エクスプローラーで開く）を削除。
  どちらも行の […] / 右クリックメニューにあるため重複していた。スニペットも同様に
  「削除」を外し、「フォルダを開く」をファイルのメニューへ移動（ファイル 0 件のときのために
  一覧の余白の右クリックでも出す）。「＋」新規作成のみ残した。
- シーケンス画面に F（選択ノードにフォーカス）/ A（全体表示）のショートカットを追加した。
  `fitView` を `fitView(nodes = 全ノード)` に一般化して選択ノードだけにも使えるようにした
  （`#btn-seq-fit` の click ハンドラは click イベントが第 1 引数に入らないよう `() => fitView()`）。
  入力欄フォーカス時とシーケンス画面以外では効かないよう `seqShortcutAllowed()` で判定し、
  Del キーの判定もこれに寄せた。
- シーケンスのノードエリアに浮かせた「整列」ボタン（`.seq-canvas-tools`）を追加した。
  `nodeOrder` の順路順 → それ以外は現在位置（y, x）順に並べ、1 行の数は
  表示幅 ÷ ズームから算出（1〜10）。整列範囲の左上は元の位置を保つ。
  `selectedNodes` が 2 件以上なら選択ノードだけを対象にする。キャンバスの mousedown は
  `.seq-canvas-tools` を除外して、ボタン操作で範囲選択が始まらないようにしている。
- 下部ストリップの動画サムネイルのクリックで、右パネルの動画プロパティが自動再生するようにした。
  `renderContext` は保存やリロードでも走るため、常時 autoplay ではなく `state.autoPlayVideo`
  を「クリック時に立てて、`renderVideoPropsContext` で 1 回だけ消費する」形にしている。
  Ctrl・Shift クリック（複数選択）と右クリック（メニュー表示）では再生しない。
- 検証: テスト用サーバー（8799・一時ライブラリ）で `/api/status` の応答、LLM の
  start → starting（モデルをロード中…）→ stop を実機で確認。未知キーは 404、
  起動失敗時のエラー差し替えも確認。ヘッドレス Chrome でチップの見た目を確認。
  `test_library_core.py` 通過。Forge / ComfyUI の実起動は未検証（要実機確認）。
  サーバー変更のため反映には再起動が必要。

### BGM の試聴シークバー / スニペットハイライトを文字色へ（2026-07-29）

- シーケンス画面の BGM 一覧に、試聴中の曲だけシークバー（+ 経過 / 全体時間）を出すようにした。
  一覧が縦に伸びないよう、行は `.seq-bgm-item-row`、シークバーは `.seq-bgm-seek` として
  再生中の項目にだけ差し込む。共有の `previewAudio` の `timeupdate` / `loadedmetadata` で
  `syncPreviewSeek()` を呼び、`previewSeeking` フラグでドラッグ中の上書きを止める
  （`change` で実シーク。つまみを動かさず離した場合に備えて `pointerup` / `pointercancel`
  でもフラグを戻す）。`renderBgm()` のたびに要素を作り直すので参照は毎回張り替える。
- スニペット登録済みの語の表示を、点線の下線から**文字色**（`var(--accent)`）に変更した。
  textarea 側を `color: transparent` + `caret-color` にして、背後のバックドロップの
  文字を見せる形にした（`.snippet-hl-mark` は `color` のみ）。
  - バックドロップに文字が載る前に透明化すると入力内容が消えて見えるため、
    `render()` の末尾で `.snippet-hl-wrap` に `is-ready` を付け、CSS はこれを条件にしている。
  - 選択範囲は textarea 側で描かれ背後の文字を隠すので、`::selection` を半透明
    （`rgba(79, 195, 247, 0.35)`）にして透けるようにした。既定の placeholder 色も明示した。
- 検証: `node --check`。ハイライトはヘッドレス Chrome で重ね合わせのズレ（二重に見える等）が
  ないこと・折り返し位置が一致することを確認。BGM シークバーは音源を用意していないため
  実機での試聴・シーク動作は未確認。どちらもフロントのみなので Ctrl+R で反映される。

### 画像ギャラリーの矢印キー移動（2026-08-04）

- `#grid`（既に `tabindex="0"`）の keydown で ←→↑↓ を処理し、`selectItem()` で選択を移す。
  カードクリック時に `grid.focus({ preventScroll: true })` を呼び、クリック直後から
  キー操作できるようにした。
- 列数は決め打ちせず、`nextCardIndex()` がカードの `offsetTop` / `offsetLeft` から
  行を判定する（`repeat(auto-fill, var(--card-w))` で列数が可変、かつ最終行が欠けても
  横位置がいちばん近いカードへ移動できる）。上端 / 下端では動かさない。
- 連続移動で古い応答が新しい選択を上書きしないよう、`selectItem()` の詳細取得後に
  `state.selectedId !== itemId` なら中断するガードを入れた。
- 検証: `node --check frontend/app.js`、`nextCardIndex` を切り出して 4 列 × 10 枚
  （最終行 2 枚）で移動先を確認。ヘッドレスブラウザが無い環境のため実機のキー操作は
  未確認。フロントのみなので Ctrl+R で反映される。

### サムネイルのお気に入り（2026-08-04）

- データは `meta.json` が正。画像は `favorite`（bool）、動画は `videos[].favorite`。
  インデックスには `items.favorite` / `items.fav_video_count` / `videos.favorite` を追加し、
  既存 DB は `connect()` の `_ADDED_COLUMNS` で `ALTER TABLE` 移行する（作り直し不要）。
- 絞り込みは「画像が★ or ★付き動画を持つ」。一覧は `index_db.list_items(..., favorite_only)` の
  SQL で、検索（FTS / ベクトル / ハイブリッド）は関連度順を崩さないよう取得後に
  `index_db.is_favorite()` でフィルタする。
- API は既存の PATCH に相乗り（`ItemUpdate.favorite` / `VideoUpdate.favorite`）。
  `exclude_unset` なので、動画プロパティの保存（prompt + settings）で★は消えない。
- UI は `.card` / `.vstrip-card` 右上の `.fav-star`（OFF はホバー時のみ、ON は金色 `var(--fav)`）。
  クリックは `stopPropagation` で選択・再生と分離。動画バッジは★と重ならないよう `right: 28px`
  に寄せ、★付き動画があれば金色 + ★を付ける。F キーは Del と同じガード（入力中・別タブ・
  設定ダイアログ表示中は無効）で、すべて★なら外す / 1 つでも未★なら全部★にする。
- 検証: `tests/test_library_core.py` にお気に入りの往復と再構築後の復元を追加して実行。
  TestClient で PATCH → `favorite_only` の一覧・検索を確認。ヘッドレス Chrome で
  カード★・動画バッジ・動画ストリップ★の表示を確認した。

### アプリアイコンの差し替え（2026-08-05）

- `assets/ai-cube.png`（1254x1254 / RGB）を元に `assets/app_icon.png`（512x512 RGBA）と
  `assets/app_icon.ico`（16/24/32/48/64/128/256）を生成して差し替えた。参照側
  （`electron/main.js` の `iconPath`、`frontend/index.html` の favicon）は変更不要。
- 元画像は角丸スクエアの外側が**白で塗られている**（透過ではない）ため、そのままだと
  角が白く残る。中央の星も白いので色でマスクを作らず、角丸半径を推定して
  （上端付近の暗いピクセルが始まる x = 258px ≒ 20.6%）rounded_rectangle でマスクを描き、
  4 倍解像度→縮小のアンチエイリアスをかけて alpha に入れている。
- 元画像を差し替えるときは同じ手順で再生成する。生成スクリプトはリポジトリに含めていない。

### クリップパレットのお気に入り（2026-08-05）

- シーケンス画面のクリップカードから「＋」ボタン（`addNodeFromVideo`）を削除し、代わりに
  `.fav-star` を置いた。ノード追加はドラッグ＆ドロップのみになる（カードの title は元から
  「クリックで試聴 / ドラッグでノード配置」）。
- 状態は `/api/library/videos`（`index_db.list_all_videos`）が返す `videos.favorite` をそのまま使い、
  切り替えは既存の `PATCH /api/library/items/{id}/videos/{file}` に相乗り。成功したら
  `seqState.videos` の要素とボタンだけ更新し、`renderPalette()` は呼ばない（スクロール位置維持）。
- app.js の `makeFavStar` は共有せず `sequence.js` にローカル実装した。ツールチップの「（F）」は
  シーケンス画面では F がノードフォーカスに割り当たっているため付けていない。
- CSS は `.palette-card .fav-star`。カードが flex 行なので絶対配置ではなく行内に並べ、
  OFF でも `opacity: 0.5` で見えるようにしている（`.card` 側の「ホバー時だけ」とは別扱い）。
- 検証: `node --check frontend/sequence.js` のみ。実画面での見た目は未確認。

## 確認済みの補足

- `README.md` は現在の構成にかなり近く、主要機能や起動方法が整理されている。
- `docs/changelog.md` には、2026-02-11 以降の変更が機能のまとまりごとに整理されている。
- `docs/prompts/` には、システムプロンプトとプロンプト保存先の説明がある。
- `docs/library/library_search.md` には、embedding、FTS5、RRF、フォールバックの仕組みが整理されている。
- リポジトリ直下には `package.json` はなく、Electron 側の npm 構成は `electron/` 配下を確認する必要がある。
- 2026-05-19 に、古い Gradio / A1111 仕様書、重複したエージェント向けドキュメント、空のルート `package-lock.json`、単発確認用スクリプトを削除した。
- Forge API 調査用スクリプトは、実行コードから分けるため `tools/discover_forge_api.py` へ移動した。
- ルート直下の実行ログ、Python キャッシュ、旧 Claude ローカル設定ディレクトリをローカル整理として削除した。
- ルート直下のファイル配置方針を `docs/reference/project_structure.md` に記録した。
- 起動時の Python 環境を conda からプロジェクト直下の `.venv` に変更し、`start.bat` で初回セットアップできるようにした。
- Forge 起動時はアプリ用 `.venv` の環境変数と PATH を外し、Forge 側の venv を使えるようにした。
- Forge 用 Python は既存の Forge venv を優先し、未作成時は `py -3.10` や `SD_FORGE_PYTHON` で明示できるようにした。
- 管理対象の ComfyUI、Forge、`llama-server` の配置先を `bin/` から `runtime/` へ変更し、旧設定パスの読み替えに対応した。
- Forge の `config.json` に残るVAEなどの旧絶対パスを、起動前に現在の配置先へ移行するようにした。

## 残っている注意点

- `docs/plan/goals.md`、`docs/plan/plan.md`、`docs/plan/progress.md` は今回、履歴から逆算した暫定整理であり、実際の優先順位は今後の作業で更新する。
- 画像ライブラリは機能が増えているため、登録・検索・一括操作・詳細編集・フォルダ操作の回帰確認が重要。
- Embedding サーバー、Forge、ComfyUI、ローカル LLM は環境依存が強いため、検証時は起動状態とログを確認する。
- FTS5 + ベクトル検索は便利だが、固有語・日本語・LoRA 名などで期待通り拾えるか実データで確認が必要。
- Caption / tags 生成は LLM 返答 JSON の品質に依存するため、失敗時の保存内容と UI 表示を確認する。
- ComfyUI workflow のノード差し替えは workflow ごとの構造差に左右されるため、代表 workflow で継続確認する。
- 未コミット変更がある作業ツリーでは、ユーザー作業を戻さず、変更範囲を限定する。
