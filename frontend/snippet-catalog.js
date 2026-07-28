/**
 * スニペットカタログの共有ロードと、プロンプト文字列との突き合わせ。
 *
 * 自動候補（snippet-autocomplete.js）と登録済みハイライト（snippet-highlight.js）が
 * 同じ一覧・同じ正規化規則を使うため、ここに集約する。
 * スニペット編集タブでの保存後は "snippets-changed" イベントでキャッシュを捨てる。
 */

let catalog = null;
let catalogPromise = null;
let index = null; // catalog から作った照合用インデックス
const listeners = new Set();

export async function loadCatalog() {
  if (catalog) return catalog;
  if (!catalogPromise) {
    catalogPromise = fetch("/api/snippets")
      .then((r) => r.json())
      .then((data) => {
        catalog = Array.isArray(data.snippets) ? data.snippets : [];
        return catalog;
      })
      .catch(() => {
        catalog = [];
        return catalog;
      })
      .finally(() => {
        catalogPromise = null;
      });
  }
  return catalogPromise;
}

/** カタログ更新時に呼ばれる関数を登録する。解除用の関数を返す。 */
export function onCatalogChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

window.addEventListener("snippets-changed", () => {
  catalog = null;
  index = null;
  for (const fn of listeners) fn();
});

/**
 * プロンプトをカンマ / 改行で区切り、前後の空白を除いた位置つきで返す。
 * `(masterpiece, best quality:1.2)` のような強調の内側のカンマでは分割しない。
 */
export function splitSegments(text) {
  const out = [];
  let start = 0;
  let depth = 0;
  const push = (end) => {
    const raw = text.slice(start, end);
    const s = start + (raw.length - raw.trimStart().length);
    const e = end - (raw.length - raw.trimEnd().length);
    if (e > s) out.push({ start: s, end: e, text: text.slice(s, e) });
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++; // `\(` などのエスケープは深さに数えない
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1);
    } else if (ch === "\n" || (ch === "," && depth === 0)) {
      push(i);
      start = i + 1;
      depth = 0;
    }
  }
  push(text.length);
  return out;
}

/**
 * 照合用にセグメントを正規化する。
 * `(word:1.2)` `((word))` `[word]` の強調記法、`\(` のエスケープ、
 * `_` と空白の差、大文字小文字、連続空白を吸収する。
 */
export function normalizeSegment(raw) {
  let s = (raw || "").trim();
  // 強調記法を外側から剥がす（末尾が `\)` のエスケープなら剥がさない）
  for (let guard = 0; guard < 8; guard++) {
    const m = /^[([{]([\s\S]*)[)\]}]$/.exec(s);
    if (!m || /\\$/.test(m[1])) break;
    s = m[1].trim();
    const weighted = /^([\s\S]*?):\s*-?\d+(\.\d+)?$/.exec(s);
    if (weighted) s = weighted[1].trim();
  }
  return s
    .replace(/\\([(){}[\]])/g, "$1")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ") // 強調の内側に残るカンマの空け方を揃える
    .trim()
    .toLowerCase();
}

// body / prefix を正規化キーにしたインデックスを作る
function buildIndex(items) {
  const map = new Map(); // 正規化キー -> スニペット
  let maxRun = 1;
  for (const item of items) {
    const segs = splitSegments(item.body || "")
      .map((s) => normalizeSegment(s.text))
      .filter(Boolean);
    if (segs.length > 0) {
      const key = segs.join(", ");
      if (!map.has(key)) map.set(key, item);
      maxRun = Math.max(maxRun, segs.length);
    }
    const prefix = normalizeSegment(item.prefix || "");
    if (prefix && !map.has(prefix)) map.set(prefix, item);
  }
  return { map, maxRun: Math.min(maxRun, 12) };
}

function getIndex(items) {
  if (!index) index = buildIndex(items);
  return index;
}

/**
 * スニペットに登録済みの範囲を返す。
 * `[{ start, end, item }]`（start/end は text 内の文字位置、重なりなし）。
 * body が複数セグメントのスニペットは、連続するセグメントの最長一致で拾う。
 */
export function findRegisteredRanges(text, items) {
  if (!text || !items || items.length === 0) return [];
  const { map, maxRun } = getIndex(items);
  const segs = splitSegments(text);
  const ranges = [];
  let i = 0;
  while (i < segs.length) {
    // 下線が行末まで伸びないよう、連結の探索は行をまたがない範囲にとどめる
    let limit = i + 1;
    while (
      limit < segs.length &&
      limit < i + maxRun &&
      !text.slice(segs[limit - 1].end, segs[limit].start).includes("\n")
    ) {
      limit++;
    }
    let hit = 0;
    for (let j = limit; j > i; j--) {
      const key = segs
        .slice(i, j)
        .map((s) => normalizeSegment(s.text))
        .filter(Boolean)
        .join(", ");
      if (key && map.has(key)) {
        ranges.push({ start: segs[i].start, end: segs[j - 1].end, item: map.get(key) });
        hit = j;
        break;
      }
    }
    i = hit || i + 1;
  }
  return ranges;
}

/** カーソル位置（またはクリック位置）を含むセグメントを返す。 */
export function segmentAt(text, caret) {
  const segs = splitSegments(text);
  return segs.find((s) => caret >= s.start && caret <= s.end) || null;
}
