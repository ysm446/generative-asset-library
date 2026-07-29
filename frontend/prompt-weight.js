/**
 * プロンプトの語の「強調（重み）」スライダー。
 *
 * プロンプト欄で語にマウスを載せると、その語の上にスライダーが出る。
 * 動かすと Stable Diffusion の強調記法でその場に書き戻す:
 *
 *   1.0        → word          （括弧なし）
 *   1.1        → (word)        （括弧 1 つ = 1.1 倍）
 *   それ以外   → (word:0.6)
 *
 * 既にある `(word:1.2)` `((word))` `[word]` は読み取って初期値にする
 * （`(` は 1.1 倍、`[` は 1/1.1 倍、入れ子は掛け算）。
 */

import { setIconLabel } from "/frontend/icons.js";

export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 2;
export const WEIGHT_STEP = 0.05;

const round2 = (n) => Math.round(n * 100) / 100;
const near = (a, b) => Math.abs(a - b) < 0.005;

/** 文字列全体が 1 組の括弧で囲まれているか（`(a), (b)` を誤検出しないため） */
function isWrapped(s) {
  const open = s[0];
  const close = { "(": ")", "[": "]" }[open];
  if (!close || s.at(-1) !== close) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++;
    } else if (ch === "(" || ch === "[") {
      depth++;
    } else if (ch === ")" || ch === "]") {
      depth--;
      if (depth === 0) return i === s.length - 1; // 最初の括弧が末尾で閉じている
    }
  }
  return false;
}

/** 括弧の外側（深さ 0）にある末尾の `:数値` を探す。無ければ -1 */
function weightColonIndex(s) {
  let depth = 0;
  let found = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++;
    } else if (ch === "(" || ch === "[") {
      depth++;
    } else if (ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
    } else if (ch === ":" && depth === 0) {
      found = i;
    }
  }
  if (found < 0) return -1;
  return /^\s*-?\d+(\.\d+)?\s*$/.test(s.slice(found + 1)) ? found : -1;
}

/** `(mature:0.6)` → `{ base: "mature", weight: 0.6 }` */
export function parseWeight(raw) {
  let base = (raw || "").trim();
  let weight = 1;
  for (let guard = 0; guard < 8; guard++) {
    if (base.length < 3 || !isWrapped(base)) break;
    const open = base[0];
    const inner = base.slice(1, -1);
    if (/\\$/.test(inner)) break; // `\)` で終わるエスケープは括弧ではない
    if (open === "(") {
      const colon = weightColonIndex(inner);
      if (colon >= 0) {
        // 明示の重みが最優先。ここで打ち切る
        weight = round2(weight * parseFloat(inner.slice(colon + 1)));
        base = inner.slice(0, colon).trim();
        break;
      }
      weight *= 1.1;
    } else {
      weight /= 1.1;
    }
    base = inner.trim();
  }
  return { base, weight: round2(weight) };
}

/** 重み付きの表記に組み立てる */
export function formatWeighted(base, weight) {
  const w = round2(weight);
  if (near(w, 1)) return base;
  if (near(w, 1.1)) return `(${base})`;
  return `(${base}:${String(w)})`;
}

// ------------------------------------------------------------------ ポップアップ

const state = {
  el: null,
  slider: null,
  valueEl: null,
  wordEl: null,
  ta: null,
  start: 0,
  end: 0,
  base: "",
  hovering: false,
  dragging: false,
};
let hideTimer = null;

function build() {
  if (state.el) return;
  const el = document.createElement("div");
  el.className = "prompt-weight-pop";
  el.hidden = true;

  const word = document.createElement("span");
  word.className = "pw-word";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(WEIGHT_MIN);
  slider.max = String(WEIGHT_MAX);
  slider.step = String(WEIGHT_STEP);

  const value = document.createElement("span");
  value.className = "pw-value";

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "pw-reset";
  reset.title = "1.0（強調なし）に戻す";
  setIconLabel(reset, "restore");

  el.append(word, slider, value, reset);
  document.body.appendChild(el);

  slider.addEventListener("input", () => apply(parseFloat(slider.value)));
  slider.addEventListener("mousedown", () => (state.dragging = true));
  reset.addEventListener("click", () => {
    slider.value = "1";
    apply(1);
  });
  document.addEventListener("mouseup", () => {
    state.dragging = false;
    if (!state.hovering) scheduleHideWeightSlider();
  });
  el.addEventListener("mouseenter", () => {
    state.hovering = true;
    clearTimeout(hideTimer);
  });
  el.addEventListener("mouseleave", () => {
    state.hovering = false;
    scheduleHideWeightSlider();
  });
  // ポップアップの余白のクリックでは textarea の選択を消さない。
  // スライダーとボタンは preventDefault するとつまみを掴めなくなるので除く。
  el.addEventListener("mousedown", (e) => {
    if (e.target === slider || e.target.closest("button")) return;
    e.preventDefault();
  });

  state.el = el;
  state.slider = slider;
  state.valueEl = value;
  state.wordEl = word;
}

function place(rect) {
  const el = state.el;
  el.hidden = false;
  const pop = el.getBoundingClientRect();
  const margin = 6;
  let top = rect.top - pop.height - margin; // 基本は語の上
  if (top < margin) top = rect.bottom + margin; // 上が狭ければ下に出す
  let left = rect.left + rect.width / 2 - pop.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - pop.width - margin));
  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(left)}px`;
}

function showValue(w) {
  state.valueEl.textContent = near(w, 1) ? "1.0（なし）" : String(round2(w));
  // トラックの左側だけ色を付ける（appearance: none で既定の塗りが消えるため）
  const pct = ((w - WEIGHT_MIN) / (WEIGHT_MAX - WEIGHT_MIN)) * 100;
  state.slider.style.setProperty("--pw-fill", `${Math.max(0, Math.min(100, pct))}%`);
}

/** 語の上にスライダーを出す。seg は `{ start, end, text }`、rect は画面上の位置。 */
export function showWeightSlider({ ta, seg, rect }) {
  const { base, weight } = parseWeight(seg.text);
  if (!base) return;
  build();
  clearTimeout(hideTimer);
  state.ta = ta;
  state.start = seg.start;
  state.end = seg.end;
  state.base = base;
  state.wordEl.textContent = base.length > 28 ? `${base.slice(0, 28)}…` : base;
  state.wordEl.title = base;
  state.slider.value = String(Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, weight)));
  showValue(weight);
  place(rect);
}

/** 表示中のスライダーがこの語のものか */
export function isWeightSliderFor(ta, segStart) {
  return !!state.el && !state.el.hidden && state.ta === ta && state.start === segStart;
}

export function isWeightSliderBusy() {
  return state.hovering || state.dragging;
}

export function hideWeightSlider(force = false) {
  clearTimeout(hideTimer);
  if (!state.el || state.el.hidden) return;
  if (!force && isWeightSliderBusy()) return;
  state.el.hidden = true;
  state.ta = null;
}

export function scheduleHideWeightSlider(delay = 450) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => hideWeightSlider(), delay);
}

// スライダーの値をプロンプトに書き戻す
function apply(weight) {
  const ta = state.ta;
  if (!ta || !ta.isConnected) return hideWeightSlider(true);
  const text = ta.value;
  const next = formatWeighted(state.base, weight);
  const oldEnd = state.end;
  if (text.slice(state.start, oldEnd) === next) return showValue(weight);
  const selStart = ta.selectionStart;
  const selEnd = ta.selectionEnd;
  const delta = next.length - (oldEnd - state.start);
  ta.value = text.slice(0, state.start) + next + text.slice(oldEnd);
  state.end = oldEnd + delta;
  // 書き換えより後ろにあったカーソル位置はずらして保つ
  const fix = (p) => (p == null ? p : p >= oldEnd ? p + delta : Math.min(p, state.end));
  try {
    ta.setSelectionRange(fix(selStart), fix(selEnd));
  } catch {}
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  showValue(weight);
}

window.addEventListener("scroll", () => hideWeightSlider(true), true);
window.addEventListener("resize", () => hideWeightSlider(true));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideWeightSlider(true);
});
