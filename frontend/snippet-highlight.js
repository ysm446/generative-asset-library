/**
 * プロンプト入力欄の「スニペット登録済み」ハイライト。
 *
 * attachSnippetHighlight(textarea) を呼ぶと、textarea の背後に同じ文字を描いた
 * バックドロップを敷き、スニペットに登録済みの語だけに下線を引く。
 * （textarea の中身は部分的に装飾できないため、重ね合わせで表現する）
 *
 * - 対象は auto-grow な textarea（内部スクロールしない）を前提にする。
 * - ラベル脇のトグルで表示を切り替え、localStorage に保存する。
 * - 未登録の語は右クリックから「スニペットに登録」できる。
 */

import { showFormDialog } from "/frontend/dialog.js";
import { setIconLabel } from "/frontend/icons.js";
import { showContextMenu } from "/frontend/menu.js";
import {
  findRegisteredRanges,
  loadCatalog,
  onCatalogChanged,
  segmentAt,
} from "/frontend/snippet-catalog.js";

const STORAGE_KEY = "studio_snippet_highlight";
let enabled = localStorage.getItem(STORAGE_KEY) !== "0";

// 有効な（DOM に残っている）ハイライト対象
const instances = new Set();

// バックドロップに写す必要のある textarea のスタイル
const COPIED_STYLES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textIndent",
  "textTransform",
  "wordSpacing",
  "tabSize",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
];

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function sweep() {
  for (const inst of instances) {
    if (!inst.ta.isConnected) instances.delete(inst);
  }
}

function refreshAll() {
  sweep();
  for (const inst of instances) render(inst);
}

onCatalogChanged(refreshAll);

function setEnabled(value) {
  enabled = value;
  localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  sweep();
  for (const inst of instances) {
    updateToggle(inst);
    render(inst);
  }
}

// --------------------------------------------------------------- セットアップ

export function attachSnippetHighlight(textarea) {
  if (!textarea || textarea.dataset.snippetHighlight) return textarea;
  textarea.dataset.snippetHighlight = "1";
  const inst = { ta: textarea, backdrop: null, toggle: null, ranges: [] };
  instances.add(inst);

  textarea.addEventListener("input", () => render(inst));
  textarea.addEventListener("mousemove", (e) => updateTooltip(e, inst));
  textarea.addEventListener("mouseleave", () => (textarea.title = ""));
  textarea.addEventListener("contextmenu", (e) => onContextMenu(e, inst));
  // LLM 生成やスニペット挿入は .value を直接書き換える（input が飛ばない）ため、
  // この textarea に限って setter をラップして再描画する
  hookValueSetter(textarea, () => render(inst));

  // 生成直後は親がないので、DOM に載ってから包む
  whenConnected(textarea, () => setup(inst));
  return textarea;
}

function whenConnected(el, fn, tries = 30) {
  if (el.isConnected) return fn();
  if (tries <= 0) return;
  requestAnimationFrame(() => whenConnected(el, fn, tries - 1));
}

function setup(inst) {
  const { ta } = inst;
  const wrap = document.createElement("div");
  wrap.className = "snippet-hl-wrap";
  ta.parentNode.insertBefore(wrap, ta);
  const backdrop = document.createElement("div");
  backdrop.className = "snippet-hl-backdrop";
  wrap.append(backdrop, ta);
  inst.backdrop = backdrop;
  syncMetrics(inst);

  const label = wrap.closest(".field")?.querySelector(":scope > label");
  if (label && !label.querySelector(".snippet-hl-toggle")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "snippet-hl-toggle";
    setIconLabel(btn, "puzzle");
    btn.addEventListener("click", () => setEnabled(!enabled));
    label.classList.add("with-hl-toggle");
    label.appendChild(btn);
    inst.toggle = btn;
    updateToggle(inst);
  }
  render(inst);
}

// textarea と同じ文字送り・余白でないと重ね合わせがずれるため、実測値を写す
function syncMetrics(inst) {
  const cs = getComputedStyle(inst.ta);
  for (const prop of COPIED_STYLES) inst.backdrop.style[prop] = cs[prop];
}

function updateToggle(inst) {
  if (!inst.toggle) return;
  inst.toggle.classList.toggle("is-off", !enabled);
  inst.toggle.title = enabled
    ? "スニペット登録済みの語に引く下線を隠す"
    : "スニペット登録済みの語に下線を引く";
}

function hookValueSetter(ta, onChange) {
  const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  if (!desc?.set) return;
  Object.defineProperty(ta, "value", {
    configurable: true,
    get() {
      return desc.get.call(this);
    },
    set(v) {
      desc.set.call(this, v);
      onChange();
    },
  });
}

// ------------------------------------------------------------------- 描画

function clearBackdrop(inst) {
  inst.ranges = [];
  inst.backdrop.textContent = "";
  inst.ta.title = "";
}

async function render(inst) {
  const { ta, backdrop } = inst;
  if (!backdrop) return;
  // カタログ取得待ちの間に入力やトグルがあっても、古い結果で塗り直さない
  const renderId = (inst.renderId = (inst.renderId || 0) + 1);
  if (!enabled) return clearBackdrop(inst);
  const items = await loadCatalog();
  if (renderId !== inst.renderId) return;
  if (!enabled) return clearBackdrop(inst);
  const text = ta.value;
  const ranges = findRegisteredRanges(text, items);
  inst.ranges = ranges;
  let html = "";
  let pos = 0;
  for (const r of ranges) {
    html += escapeHtml(text.slice(pos, r.start));
    html += `<span class="snippet-hl-mark">${escapeHtml(text.slice(r.start, r.end))}</span>`;
    pos = r.end;
  }
  // 末尾の改行は表示上つぶれるので 1 文字足しておく
  html += escapeHtml(text.slice(pos)) + "\n";
  backdrop.innerHTML = html;
}

// バックドロップは pointer-events: none なので、その場だけ当たり判定を有効にして
// マウス位置の語を調べる（同期処理なので入力操作には影響しない）
function markAtPoint(inst, x, y) {
  if (!inst.backdrop || inst.ranges.length === 0) return null;
  inst.backdrop.style.pointerEvents = "auto";
  const el = document.elementFromPoint(x, y);
  inst.backdrop.style.pointerEvents = "";
  if (!el || !el.classList.contains("snippet-hl-mark")) return null;
  const marks = [...inst.backdrop.querySelectorAll(".snippet-hl-mark")];
  const range = inst.ranges[marks.indexOf(el)];
  return range || null;
}

function updateTooltip(event, inst) {
  const hit = markAtPoint(inst, event.clientX, event.clientY);
  if (!hit) {
    if (inst.ta.title) inst.ta.title = "";
    return;
  }
  const item = hit.item;
  const source = (item.source || "").replace(".code-snippets", "");
  const label = [item.name, item.description].filter(Boolean).join(" — ");
  const title = `登録済み: ${label || item.prefix}${source ? `（${source}）` : ""}`;
  if (inst.ta.title !== title) inst.ta.title = title;
}

// ------------------------------------------------------- 右クリックからの登録

function onContextMenu(event, inst) {
  const { ta } = inst;
  // 選択範囲があればそれを、なければカーソル位置のセグメントを対象にする
  let body = "";
  if (ta.selectionStart !== ta.selectionEnd) {
    body = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
  } else {
    if (markAtPoint(inst, event.clientX, event.clientY)) return; // 登録済みなら何も出さない
    body = segmentAt(ta.value, ta.selectionStart ?? 0)?.text || "";
  }
  if (!body) return;
  event.preventDefault();
  // menu.js の document ハンドラが直後に閉じてしまうのを防ぐ
  event.stopPropagation();
  const short = body.length > 24 ? `${body.slice(0, 24)}…` : body;
  showContextMenu(event.clientX, event.clientY, [
    {
      icon: "puzzle",
      label: `「${short}」をスニペットに登録`,
      action: () => openRegisterDialog(body),
    },
  ]);
}

async function openRegisterDialog(body) {
  let files = [];
  try {
    files = (await (await fetch("/api/snippets/files")).json()).files || [];
  } catch {
    files = [];
  }
  const options = files.map((f) => ({ value: f.path, label: f.path }));
  if (options.length === 0) options.push({ value: "user.code-snippets", label: "user.code-snippets（新規作成）" });

  await showFormDialog(
    "スニペットに登録",
    [
      { key: "path", label: "保存先ファイル", type: "select", options, value: options[0].value },
      { key: "name", label: "名前", value: body },
      { key: "prefix", label: "prefix（入力補完のトリガー）", value: body },
      { key: "body", label: "本文", type: "textarea", value: body },
      { key: "description", label: "説明（任意）", value: "" },
    ],
    {
      submitLabel: "登録",
      onSubmit: async (v) => {
        if (!v.body.trim()) throw new Error("本文が空です");
        const res = await fetch("/api/snippets/entry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail.detail || `登録に失敗しました (${res.status})`);
        }
        // カタログを捨てて全欄のハイライトを更新する
        window.dispatchEvent(new Event("snippets-changed"));
      },
    }
  );
}

window.addEventListener("resize", () => {
  sweep();
  for (const inst of instances) if (inst.backdrop) syncMetrics(inst);
});
