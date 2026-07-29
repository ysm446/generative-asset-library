/**
 * スライダー（input[type=range]）の左側の塗り。
 *
 * 細いトラックにするため CSS で `appearance: none` を指定していて、既定の
 * 「つまみより左だけ色が付く」表示が消える。代わりに `--range-fill`（％）を
 * トラックのグラデーションに使うので、値が変わるたびにここで更新する。
 */

export function syncRangeFill(input) {
  if (!input) return;
  const min = parseFloat(input.min || "0");
  const max = parseFloat(input.max || "100");
  const value = parseFloat(input.value || "0");
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  input.style.setProperty("--range-fill", `${Math.max(0, Math.min(100, pct))}%`);
}

/** 初期値を反映し、以後の操作にも追従させる。 */
export function attachRangeFill(input) {
  if (!input) return input;
  syncRangeFill(input);
  input.addEventListener("input", () => syncRangeFill(input));
  return input;
}
