/**
 * スニペット編集モード
 * 左: ファイル一覧 / 中: 項目一覧（全ファイル検索つき） / 右: フォーム編集
 * 右上の切替で生テキスト（.code-snippets JSON）編集にも切り替えられる。
 */

import { showInputDialog } from "/frontend/dialog.js";
import { showContextMenu } from "/frontend/menu.js";
import { setIconLabel } from "/frontend/icons.js";
import { openOrganizeDialog } from "/frontend/snippet-organize.js";

const $ = (sel) => document.querySelector(sel);

async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

const apiJson = (path, method, body) =>
  api(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const snipState = {
  files: [],
  current: null, // 選択中ファイルの path
  entries: [], // フォーム編集用のエントリ一覧
  entryIndex: -1, // フォームに出している項目（複数選択時は最後にクリックしたもの）
  selected: new Set(), // 選択中の項目 index（複数選択）
  anchorIndex: null, // Shift 選択の起点
  jsonMode: false, // true なら生 JSON エディタ表示
  formOk: true, // false なら解析エラーで JSON モード固定
  dirty: false,
  rawContent: "", // 選択時に読み込んだ生テキスト（未編集時の JSON 表示用）
  allSnippets: null, // 全ファイル横断検索用キャッシュ
};

function setStatus(text) {
  $("#status").textContent = text;
}

function snippetsChanged() {
  snipState.allSnippets = null;
  window.dispatchEvent(new Event("snippets-changed"));
}

// Python 側 strip_jsonc_comments と同じ規則で // 行コメントを除去する
function stripJsoncComments(text) {
  return text
    .split("\n")
    .map((line) => {
      let inString = false;
      let escaped = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (!inString && ch === "/" && line[i + 1] === "/") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

// エントリ一覧を .code-snippets 形式の JSON テキストにする（name 重複は連番で回避）
function entriesToJson(entries) {
  const obj = {};
  const used = new Set();
  entries.forEach((e, i) => {
    const base = (e.name || e.prefix || "").trim() || `entry_${i + 1}`;
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
    used.add(key);
    obj[key] = {
      prefix: e.prefix || "",
      body: (e.body || "").split("\n"),
      description: e.description || "",
    };
  });
  return JSON.stringify(obj, null, 2) + "\n";
}

function jsonToEntries(text) {
  const data = JSON.parse(stripJsoncComments(text));
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("スニペットファイルの構造が不正です");
  }
  const entries = [];
  for (const [name, item] of Object.entries(data)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const body = item.body;
    const bodyText = Array.isArray(body) ? body.map(String).join("\n") : String(body ?? "");
    entries.push({
      name: String(name),
      prefix: String(item.prefix ?? ""),
      body: bodyText,
      description: String(item.description ?? ""),
    });
  }
  return entries;
}

// 表示切替 -------------------------------------------------------------------

function updateSaveButton() {
  $("#btn-snip-save").disabled = !snipState.current || !snipState.dirty;
}

function updateEditorView() {
  const hasFile = snipState.current !== null;
  const showForm = hasFile && !snipState.jsonMode;
  $("#snip-form").hidden = !showForm;
  $("#snip-editor").hidden = showForm;
  const jsonBtn = $("#btn-snip-json");
  jsonBtn.hidden = !hasFile;
  if (snipState.jsonMode) setIconLabel(jsonBtn, "file-text", "フォーム編集");
  else jsonBtn.textContent = "{ } JSON 編集";
  jsonBtn.title = snipState.jsonMode
    ? "フォーム編集に戻る（JSON を解析します）"
    : "生の JSON を直接編集する";
  updateSaveButton();
}

function markDirty() {
  if (!snipState.current) return;
  snipState.dirty = true;
  updateSaveButton();
}

// ファイル一覧 ---------------------------------------------------------------

async function loadFiles() {
  try {
    snipState.files = (await api("/api/snippets/files")).files;
  } catch (e) {
    snipState.files = [];
    setStatus(e.message);
  }
  renderFiles();
  loadRoot();
}

async function loadRoot() {
  try {
    const r = await api("/api/snippets/root");
    $("#snip-root").textContent = r.root;
    $("#snip-root").title = r.root;
  } catch {}
}

// ファイル一覧の count を合計して総スニペット数を表示する
function renderTotal() {
  const files = snipState.files.length;
  const total = snipState.files.reduce((sum, f) => sum + (f.count || 0), 0);
  const el = $("#snip-total");
  el.textContent = `${files} ファイル / 全 ${total} 項目`;
  el.title = `スニペットファイル ${files} 件、スニペット合計 ${total} 件`;
}

function renderFiles() {
  renderTotal();
  const el = $("#snip-files");
  el.innerHTML = "";
  if (snipState.files.length === 0) {
    el.innerHTML = '<p class="grid-empty">スニペットファイルがありません（＋で作成）</p>';
    return;
  }
  for (const f of snipState.files) {
    const row = document.createElement("div");
    row.className = "tree-node";
    if (f.path === snipState.current) row.classList.add("is-selected");
    const label = document.createElement("span");
    label.className = "palette-tree-label";
    setIconLabel(label, "file", f.path);
    label.title = f.path;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(f.count);
    // […] メニュー（右クリックでも同じメニューを表示）
    const more = document.createElement("button");
    more.type = "button";
    more.className = "tree-more";
    more.title = "メニュー";
    setIconLabel(more, "ellipsis");
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      const rect = more.getBoundingClientRect();
      showFileMenu(rect.left, rect.bottom + 2, f.path);
    });
    row.append(label, count, more);
    row.addEventListener("click", () => selectFile(f.path));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showFileMenu(e.clientX, e.clientY, f.path);
    });
    // 項目ドラッグの移動先（編集中のファイル自身は除く）
    row.addEventListener("dragover", (e) => {
      if (entryDragIndices.length === 0 || f.path === snipState.current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      row.classList.add("is-drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
    row.addEventListener("drop", (e) => {
      row.classList.remove("is-drop-target");
      if (entryDragIndices.length === 0 || f.path === snipState.current) return;
      e.preventDefault();
      moveEntriesToFile(entryDragIndices, f.path);
    });
    el.appendChild(row);
  }
}

// ファイルの […] / 右クリックメニュー -----------------------------------------

function showFileMenu(x, y, path) {
  showContextMenu(x, y, [
    { icon: "pencil", label: "名前を変更", action: () => renameFile(path) },
    { icon: "folder-open", label: "フォルダを開く", action: revealSnippetsFolder },
    { icon: "trash", label: "削除", danger: true, action: () => deleteFileByPath(path) },
  ]);
}

async function revealSnippetsFolder() {
  try {
    await api("/api/snippets/reveal", { method: "POST" });
    setStatus("スニペットフォルダをエクスプローラーで開きました");
  } catch (e) {
    setStatus(`フォルダを開けません: ${e.message}`);
  }
}

async function renameFile(path) {
  const base = path.replace(/\.code-snippets$/, "");
  const name = await showInputDialog("新しいファイル名:", base);
  if (name === null || !name.trim() || name.trim() === base) return;
  try {
    const res = await apiJson("/api/snippets/file/rename", "POST", {
      path,
      new_path: name.trim(),
    });
    if (path === snipState.current) {
      snipState.current = res.path;
      $("#snip-editing").textContent = res.path;
    }
    snippetsChanged();
    await loadFiles();
    setStatus(`「${res.path}」に変更しました`);
  } catch (e) {
    setStatus(`リネームエラー: ${e.message}`);
  }
}

async function deleteFileByPath(path) {
  if (!path) return;
  if (!confirm(`スニペットファイル「${path}」を削除しますか？`)) return;
  try {
    await api(`/api/snippets/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    if (path === snipState.current) clearSelection();
    snippetsChanged();
    await loadFiles();
    renderEntries();
    setStatus(`「${path}」を削除しました`);
  } catch (e) {
    setStatus(e.message);
  }
}

// 項目ドラッグ（他ファイルへの移動）------------------------------------------

let entryDragIndices = []; // ドラッグ中の項目 index（現在ファイルの entries 内、複数可）

// 項目を別ファイルへ移動する。移動先に追記 → 元ファイルから削除の順で両方保存する
// （元ファイルに未保存の編集があれば、それも一緒に保存される）
async function moveEntriesToFile(indices, targetPath) {
  if (!snipState.current || targetPath === snipState.current) return;
  // 元の並び順を保ったまま移動し、削除は後ろから行って index のずれを避ける
  const ordered = [...new Set(indices)].sort((a, b) => a - b);
  const moving = ordered.map((i) => snipState.entries[i]).filter(Boolean);
  if (moving.length === 0) return;
  const label =
    moving.length === 1
      ? `「${entryLabel(moving[0], ordered[0])}」`
      : `${moving.length} 件`;
  try {
    const targetEntries = (
      await api(`/api/snippets/entries?path=${encodeURIComponent(targetPath)}`)
    ).entries;
    targetEntries.push(...moving.map((e) => ({ ...e })));
    await apiJson("/api/snippets/file", "PUT", {
      path: targetPath,
      content: entriesToJson(targetEntries),
    });
    for (const i of [...ordered].reverse()) snipState.entries.splice(i, 1);
    const content = entriesToJson(snipState.entries);
    await apiJson("/api/snippets/file", "PUT", { path: snipState.current, content });
    snipState.rawContent = content;
    snipState.dirty = false;
    selectEntry(
      snipState.entries.length > 0 ? Math.min(ordered[0], snipState.entries.length - 1) : -1
    );
    updateSaveButton();
    snippetsChanged();
    snipState.files = (await api("/api/snippets/files")).files;
    renderFiles();
    renderEntries();
    setStatus(`${label}を ${targetPath} へ移動しました`);
  } catch (e) {
    setStatus(`移動エラー: ${e.message}`);
  }
}

async function selectFile(path, entryToSelect = -1) {
  if (
    snipState.dirty &&
    path !== snipState.current &&
    !confirm("未保存の変更があります。破棄して切り替えますか？")
  ) {
    return;
  }
  try {
    const res = await api(`/api/snippets/file?path=${encodeURIComponent(path)}`);
    snipState.current = path;
    snipState.dirty = false;
    snipState.rawContent = res.content;
    $("#snip-editor").value = res.content;
    $("#snip-editing").textContent = path;
    try {
      snipState.entries = (
        await api(`/api/snippets/entries?path=${encodeURIComponent(path)}`)
      ).entries;
      snipState.formOk = true;
      snipState.jsonMode = false;
    } catch (e) {
      // 解析できないファイルは生 JSON 編集のみ
      snipState.entries = [];
      snipState.formOk = false;
      snipState.jsonMode = true;
      setStatus(`フォーム編集できません（${e.message}）。JSON を直接編集してください`);
    }
    selectEntry(
      entryToSelect >= 0 && entryToSelect < snipState.entries.length
        ? entryToSelect
        : snipState.entries.length > 0
          ? 0
          : -1
    );
    updateEditorView();
    renderFiles();
    renderEntries();
  } catch (e) {
    setStatus(e.message);
  }
}

// 項目一覧・フォーム ----------------------------------------------------------

async function loadAllSnippets() {
  if (snipState.allSnippets) return snipState.allSnippets;
  try {
    snipState.allSnippets = (await api("/api/snippets")).snippets;
  } catch {
    snipState.allSnippets = [];
  }
  return snipState.allSnippets;
}

function entryLabel(e, index) {
  return e.prefix || e.name || `entry_${index + 1}`;
}

async function renderEntries() {
  const el = $("#snip-entries");
  const query = $("#snip-search").value.trim().toLowerCase();
  el.innerHTML = "";

  // 検索時は全ファイル横断
  if (query) {
    const all = await loadAllSnippets();
    if ($("#snip-search").value.trim().toLowerCase() !== query) return; // 入力が進んだ
    const hits = all
      .filter((s) =>
        [s.name, s.prefix, s.description, s.body, s.source].some((v) =>
          String(v || "").toLowerCase().includes(query)
        )
      )
      .slice(0, 200);
    if (hits.length === 0) {
      el.innerHTML = '<p class="grid-empty">一致する項目がありません</p>';
      return;
    }
    for (const s of hits) {
      const row = document.createElement("div");
      row.className = "tree-node snip-entry";
      const label = document.createElement("span");
      label.className = "palette-tree-label";
      label.textContent = s.prefix || s.name;
      label.title = s.body;
      const sub = document.createElement("span");
      sub.className = "snip-entry-sub";
      sub.textContent = s.source.replace(".code-snippets", "");
      row.append(label, sub);
      row.addEventListener("click", async () => {
        $("#snip-search").value = "";
        await selectFile(s.source);
        const idx = snipState.entries.findIndex(
          (e) => e.name === s.name && e.prefix === s.prefix
        );
        if (idx >= 0) selectEntry(idx);
        renderEntries();
      });
      el.appendChild(row);
    }
    return;
  }

  if (snipState.current === null) {
    el.innerHTML = '<p class="grid-empty">左のファイルを選択してください</p>';
    return;
  }
  if (!snipState.formOk) {
    el.innerHTML = '<p class="grid-empty">JSON を修正して保存すると一覧表示できます</p>';
    return;
  }
  if (snipState.entries.length === 0) {
    el.innerHTML = '<p class="grid-empty">項目がありません（＋で追加）</p>';
    return;
  }
  snipState.entries.forEach((e, index) => {
    const row = document.createElement("div");
    row.className = "tree-node snip-entry";
    if (snipState.selected.has(index)) row.classList.add("is-selected");
    if (index === snipState.entryIndex) row.classList.add("is-current");
    const label = document.createElement("span");
    label.className = "palette-tree-label";
    label.textContent = entryLabel(e, index);
    label.title = e.body;
    const sub = document.createElement("span");
    sub.className = "snip-entry-sub";
    sub.textContent = e.description || "";
    row.append(label, sub);
    row.addEventListener("click", (ev) => {
      handleEntryClick(index, ev);
      renderEntries();
    });
    // 左のファイル一覧へドラッグして項目を移動（JSON 直接編集中は無効）
    row.draggable = !snipState.jsonMode;
    row.title = "ドラッグで他のファイルへ移動（Ctrl / Shift クリックで複数選択）";
    row.addEventListener("dragstart", (ev) => {
      // 選択外の項目をドラッグしたら、その項目だけを掴む
      if (!snipState.selected.has(index)) {
        handleEntryClick(index, {});
        renderEntries();
      }
      entryDragIndices = [...snipState.selected];
      ev.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      entryDragIndices = [];
    });
    el.appendChild(row);
  });
}

// 項目のクリック（Ctrl でトグル、Shift で範囲選択。グリッドと同じ操作）
function handleEntryClick(index, e) {
  if (e.shiftKey && snipState.anchorIndex != null) {
    const [a, b] = [snipState.anchorIndex, index].sort((x, y) => x - y);
    snipState.selected = new Set(
      Array.from({ length: b - a + 1 }, (_, i) => a + i)
    );
    setFormEntry(index);
  } else if (e.ctrlKey || e.metaKey) {
    if (snipState.selected.has(index)) snipState.selected.delete(index);
    else snipState.selected.add(index);
    snipState.anchorIndex = index;
    // フォームは、選択が残っていれば最後にクリックしたもの
    setFormEntry(
      snipState.selected.has(index) ? index : [...snipState.selected].at(-1) ?? -1
    );
  } else {
    selectEntry(index);
  }
}

// 単一選択（選択をこの 1 件に置き換える）
function selectEntry(index) {
  snipState.selected = index >= 0 ? new Set([index]) : new Set();
  snipState.anchorIndex = index >= 0 ? index : null;
  setFormEntry(index);
}

// フォームに出す項目だけを切り替える（選択状態は変えない）
function setFormEntry(index) {
  snipState.entryIndex = index;
  const e = snipState.entries[index];
  $("#snip-f-name").value = e?.name || "";
  $("#snip-f-prefix").value = e?.prefix || "";
  $("#snip-f-desc").value = e?.description || "";
  $("#snip-f-body").value = e?.body || "";
  const disabled = !e;
  ["#snip-f-name", "#snip-f-prefix", "#snip-f-desc", "#snip-f-body"].forEach((sel) => {
    $(sel).disabled = disabled;
  });
  // 削除ボタンは選択している件数に合わせる（フォームの編集対象は 1 件だけ）
  const count = snipState.selected.size;
  const delBtn = $("#btn-snip-del-entry");
  delBtn.disabled = count === 0;
  setIconLabel(delBtn, "trash", count > 1 ? ` 選択した ${count} 件を削除` : " この項目を削除");
}

function bindForm() {
  const fields = [
    ["#snip-f-name", "name"],
    ["#snip-f-prefix", "prefix"],
    ["#snip-f-desc", "description"],
    ["#snip-f-body", "body"],
  ];
  for (const [sel, key] of fields) {
    $(sel).addEventListener("input", () => {
      const e = snipState.entries[snipState.entryIndex];
      if (!e) return;
      e[key] = $(sel).value;
      markDirty();
      if (key === "name" || key === "prefix" || key === "description") {
        // 一覧のラベルにも反映（フォームにフォーカスがあるため再描画してよい）
        renderEntries();
      }
    });
  }
}

// 保存・モード切替 ------------------------------------------------------------

function currentContent() {
  if (snipState.jsonMode) return $("#snip-editor").value;
  return snipState.dirty ? entriesToJson(snipState.entries) : snipState.rawContent;
}

async function saveFile() {
  if (!snipState.current || !snipState.dirty) return;
  const content = currentContent();
  try {
    await apiJson("/api/snippets/file", "PUT", {
      path: snipState.current,
      content,
    });
    snipState.dirty = false;
    snipState.rawContent = content;
    if (snipState.jsonMode) {
      // 保存できた JSON はフォームにも反映できるようにしておく
      try {
        snipState.entries = jsonToEntries(content);
        snipState.formOk = true;
      } catch {}
    }
    updateSaveButton();
    setStatus("スニペットを保存しました");
    snippetsChanged();
    snipState.files = (await api("/api/snippets/files")).files;
    renderFiles();
    renderEntries();
  } catch (e) {
    setStatus(`保存エラー: ${e.message}`);
  }
}

function toggleJsonMode() {
  if (!snipState.current) return;
  if (snipState.jsonMode) {
    // JSON → フォーム: 解析できたときだけ戻す
    try {
      snipState.entries = jsonToEntries($("#snip-editor").value);
      snipState.formOk = true;
      snipState.jsonMode = false;
      selectEntry(snipState.entries.length > 0 ? 0 : -1);
    } catch (e) {
      setStatus(`JSON が不正なためフォームに戻せません: ${e.message}`);
      return;
    }
  } else {
    $("#snip-editor").value = currentContent();
    snipState.jsonMode = true;
  }
  updateEditorView();
  renderEntries();
}

// 初期化 ---------------------------------------------------------------------

export function initSnippetsView() {
  bindForm();
  selectEntry(-1);

  $("#snip-editor").addEventListener("input", () => {
    if (snipState.current) markDirty();
  });
  $("#snip-editor").addEventListener("keydown", (e) => {
    // Tab でタブ挿入（フォーカス移動を防ぐ）
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.target;
      const s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + "\t" + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + 1;
      markDirty();
    }
  });

  $("#btn-snip-save").addEventListener("click", saveFile);
  $("#btn-snip-json").addEventListener("click", toggleJsonMode);

  // Ctrl+S：編集中のスニペットファイルを保存
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
    if ($("#view-snippets").hidden) return;
    e.preventDefault();
    saveFile();
  });
  $("#snip-search").addEventListener("input", renderEntries);

  $("#btn-snip-add-entry").addEventListener("click", () => {
    if (!snipState.current || !snipState.formOk) return;
    if (snipState.jsonMode) toggleJsonMode();
    if (snipState.jsonMode) return; // JSON が不正で戻れなかった
    snipState.entries.push({ name: "", prefix: "", body: "", description: "" });
    selectEntry(snipState.entries.length - 1);
    markDirty();
    renderEntries();
    $("#snip-f-prefix").focus();
  });

  $("#btn-snip-del-entry").addEventListener("click", () => {
    // 複数選択しているときは選択したものをまとめて削除する
    const indices = [...snipState.selected].sort((a, b) => a - b);
    if (indices.length === 0) return;
    const first = snipState.entries[indices[0]];
    const label =
      indices.length === 1
        ? `項目「${entryLabel(first, indices[0])}」`
        : `選択した ${indices.length} 件の項目`;
    if (!confirm(`${label}を削除しますか？`)) return;
    for (const i of [...indices].reverse()) snipState.entries.splice(i, 1);
    selectEntry(
      snipState.entries.length > 0 ? Math.max(0, indices[0] - 1) : -1
    );
    markDirty();
    renderEntries();
  });

  $("#btn-snip-new").addEventListener("click", async () => {
    const name = await showInputDialog("新しいスニペットファイル名:", "my_snippets");
    if (!name) return;
    try {
      const res = await apiJson("/api/snippets/file", "POST", { path: name });
      snippetsChanged();
      await loadFiles();
      await selectFile(res.path);
    } catch (e) {
      setStatus(e.message);
    }
  });

  // ローカル LLM による自動整理（適用するまでファイルは変わらない）
  $("#btn-snip-organize").addEventListener("click", () => {
    openOrganizeDialog({
      onApplied: async (res) => {
        clearSelection();
        snippetsChanged();
        await loadFiles();
        renderEntries();
        const deleted = res.deleted.length ? `、${res.deleted.length} ファイルを削除` : "";
        setStatus(
          `${res.moved} 件のスニペットを移動しました${deleted}（バックアップ: ${res.backup}）`
        );
      },
    });
  });

  // ファイルが 1 件も無いときでもフォルダを開けるように、一覧の余白でもメニューを出す
  $("#snip-files").addEventListener("contextmenu", (e) => {
    if (e.target.closest(".tree-node")) return; // 行の上では行のメニューを優先
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { icon: "folder-open", label: "フォルダを開く", action: revealSnippetsFolder },
    ]);
  });

  $("#btn-snip-root").addEventListener("click", async () => {
    const cur = await api("/api/snippets/root").catch(() => ({}));
    let path;
    if (window.electronAPI?.selectFolder) {
      path = await window.electronAPI.selectFolder(cur.root);
      if (!path) return;
    } else {
      path = await showInputDialog("スニペットフォルダ（絶対パス）:", cur.root || "");
      if (path === null) return;
    }
    try {
      await apiJson("/api/snippets/root", "POST", { path });
      clearSelection();
      snippetsChanged();
      await loadFiles();
      renderEntries();
    } catch (e) {
      setStatus(e.message);
    }
  });

}

function clearSelection() {
  snipState.current = null;
  snipState.dirty = false;
  snipState.entries = [];
  snipState.jsonMode = false;
  snipState.formOk = true;
  snipState.rawContent = "";
  $("#snip-editor").value = "";
  $("#snip-editing").textContent = "";
  selectEntry(-1);
  updateEditorView();
}

export async function activateSnippetsView() {
  await loadFiles();
  renderEntries();
  updateEditorView();
  // ファイル未選択なら先頭を自動で開く
  if (snipState.current === null && snipState.files.length > 0) {
    await selectFile(snipState.files[0].path);
  }
}
