/**
 * スニペットの自動整理（ローカル LLM）。
 * 設定 → 整理案の生成（SSE）→ 差分プレビュー → 適用、を 1 つのダイアログで行う。
 * 「適用」を押すまでファイルは一切変更されない。
 */

import { setIconLabel } from "/frontend/icons.js";

const SNIPPET_EXT = ".code-snippets";
const shortName = (path) => String(path || "").replace(SNIPPET_EXT, "");

async function streamSse(url, body, onEvent) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

/**
 * 自動整理ダイアログを開く。適用が成功したら onApplied(result) を呼ぶ。
 */
export async function openOrganizeDialog({ onApplied } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  const box = document.createElement("div");
  box.className = "dialog-box dialog-organize";
  const title = document.createElement("div");
  title.className = "dialog-title";
  title.textContent = "スニペットの自動整理";
  box.appendChild(title);

  // --- 設定 ---
  const form = document.createElement("div");
  form.className = "organize-form";

  const modelWrap = document.createElement("div");
  modelWrap.className = "field";
  const modelLabel = document.createElement("label");
  modelLabel.textContent = "使用するモデル";
  const modelSel = document.createElement("select");
  modelSel.style.width = "100%";
  modelWrap.append(modelLabel, modelSel);

  const instWrap = document.createElement("div");
  instWrap.className = "field";
  const instLabel = document.createElement("label");
  instLabel.textContent = "整理の方針（任意）";
  const inst = document.createElement("textarea");
  inst.rows = 2;
  inst.style.width = "100%";
  inst.placeholder = "例: 人物と背景をはっきり分ける。動物は種類ごとにまとめる。";
  instWrap.append(instLabel, inst);

  const catWrap = document.createElement("div");
  catWrap.className = "field";
  const catLabel = document.createElement("label");
  catLabel.textContent = "カテゴリ数の上限";
  const catInput = document.createElement("input");
  catInput.type = "number";
  catInput.min = "2";
  catInput.max = "100";
  catInput.value = "24";
  catInput.style.width = "100%";
  catWrap.append(catLabel, catInput);

  const hint = document.createElement("div");
  hint.className = "dialog-hint";
  hint.textContent =
    "案を作るだけではファイルは変更されません。適用時は data/snippet_backups/ に自動でバックアップを取ります。";

  form.append(modelWrap, instWrap, catWrap, hint);
  box.appendChild(form);

  // --- 進捗 ---
  const progress = document.createElement("div");
  progress.className = "organize-progress";
  progress.hidden = true;
  box.appendChild(progress);

  // --- 整理案 ---
  const result = document.createElement("div");
  result.className = "organize-result";
  result.hidden = true;
  box.appendChild(result);

  const error = document.createElement("div");
  error.className = "dialog-error";
  error.hidden = true;
  box.appendChild(error);

  // --- ボタン ---
  const row = document.createElement("div");
  row.className = "dialog-buttons";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "閉じる";
  const runBtn = document.createElement("button");
  runBtn.className = "primary";
  setIconLabel(runBtn, "sparkles", "整理案を作る");
  const applyBtn = document.createElement("button");
  applyBtn.className = "primary";
  applyBtn.textContent = "この案を適用";
  applyBtn.hidden = true;
  row.append(closeBtn, runBtn, applyBtn);
  box.appendChild(row);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // ticker はこの下で宣言している（close の呼び出しは初期化後なので参照できる）
  const close = () => {
    clearInterval(ticker);
    overlay.remove();
  };
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay && !runBtn.disabled) close();
  });

  // モデル一覧
  try {
    const res = await (await fetch("/api/llm/models")).json();
    for (const m of res.models || []) {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      modelSel.appendChild(o);
    }
    if (res.last) modelSel.value = res.last;
    if (!(res.models || []).length) {
      const o = document.createElement("option");
      o.textContent = "（models/ に GGUF がありません）";
      modelSel.appendChild(o);
      runBtn.disabled = true;
    }
  } catch {}

  // --- 進捗表示（経過時間つき）---
  // 1 バッチの推論に時間がかかり無音になりやすいため、イベントが来ない間も
  // タイマーで経過を更新する。残り時間は振り分け開始からの実測ペースで見積もる。
  let message = "";
  let startedAt = 0;
  let assignStartedAt = 0; // 振り分け（フェーズ 2）の開始
  let progressInfo = null; // { done, total }
  let finished = false;
  let ticker = null;

  const fmtTime = (sec) => {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const renderProgress = () => {
    if (!startedAt) {
      progress.textContent = message;
      return;
    }
    const elapsed = (Date.now() - startedAt) / 1000;
    let text = `${message}（${finished ? "所要" : "経過"} ${fmtTime(elapsed)}`;
    if (!finished && progressInfo?.done > 0 && assignStartedAt) {
      const perItem = (Date.now() - assignStartedAt) / 1000 / progressInfo.done;
      const left = perItem * (progressInfo.total - progressInfo.done);
      if (left > 0) text += ` ／ 残り 約 ${fmtTime(left)}`;
    }
    progress.textContent = `${text}）`;
  };

  const log = (text) => {
    message = text;
    progress.hidden = false;
    renderProgress();
  };

  const startTimer = () => {
    startedAt = Date.now();
    assignStartedAt = 0;
    progressInfo = null;
    finished = false;
    clearInterval(ticker);
    ticker = setInterval(renderProgress, 500);
  };

  const stopTimer = () => {
    clearInterval(ticker);
    ticker = null;
    finished = true;
    progressInfo = null;
  };


  let plan = null;
  const checks = new Map(); // move index -> checkbox

  // --- 整理案の描画 ---

  function renderPlan() {
    result.hidden = false;
    result.innerHTML = "";
    checks.clear();

    const summary = document.createElement("div");
    summary.className = "organize-summary";
    const moved = plan.moves.length;
    summary.textContent =
      `全 ${plan.total} 件のうち ${moved} 件を移動 ／ ` +
      `新規 ${plan.created.length} ファイル ／ 空になる ${plan.emptied.length} ファイル` +
      (plan.unassigned ? ` ／ 未分類 ${plan.unassigned} 件（現在の場所に残ります）` : "");
    result.appendChild(summary);

    if (plan.failed_batches) {
      const warn = document.createElement("div");
      warn.className = "organize-warn";
      warn.textContent = `${plan.failed_batches} 個のバッチで振り分けに失敗しました。該当分は現在の場所に残ります。`;
      result.appendChild(warn);
    }

    if (moved === 0) {
      const none = document.createElement("p");
      none.className = "grid-empty";
      none.textContent = "移動が必要な項目はありませんでした。";
      result.appendChild(none);
      applyBtn.hidden = true;
      return;
    }

    const warn = document.createElement("div");
    warn.className = "organize-warn";
    warn.textContent =
      "書き換えるファイルの // コメントは失われます（バックアップには残ります）。チェックを外した項目は移動しません。";
    result.appendChild(warn);

    // 移動先ごとにまとめる
    const byTarget = new Map();
    plan.moves.forEach((m, i) => {
      if (!byTarget.has(m.to)) byTarget.set(m.to, []);
      byTarget.get(m.to).push({ ...m, index: i });
    });

    const list = document.createElement("div");
    list.className = "organize-list";
    for (const target of [...byTarget.keys()].sort()) {
      const items = byTarget.get(target);
      const group = document.createElement("div");
      group.className = "organize-group";

      const head = document.createElement("label");
      head.className = "organize-group-head";
      const all = document.createElement("input");
      all.type = "checkbox";
      all.checked = true;
      const label = document.createElement("span");
      const isNew = plan.created.includes(target);
      label.textContent = `${shortName(target)}${isNew ? "（新規）" : ""} ← ${items.length} 件`;
      const after = document.createElement("span");
      after.className = "organize-count";
      after.textContent = `整理後 ${plan.counts[target] ?? items.length} 件`;
      head.append(all, label, after);
      group.appendChild(head);

      for (const m of items) {
        const rowEl = document.createElement("label");
        rowEl.className = "organize-move";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = true;
        checks.set(m.index, cb);
        const text = document.createElement("span");
        text.className = "organize-move-label";
        text.textContent = m.prefix || m.name;
        const from = document.createElement("span");
        from.className = "organize-move-from";
        from.textContent = shortName(m.from);
        rowEl.append(cb, text, from);
        group.appendChild(rowEl);
      }

      all.addEventListener("change", () => {
        for (const m of items) checks.get(m.index).checked = all.checked;
      });
      list.appendChild(group);
    }
    result.appendChild(list);

    if (plan.emptied.length) {
      const del = document.createElement("div");
      del.className = "organize-emptied";
      del.textContent = `空になる見込みのファイル: ${plan.emptied.map(shortName).join(", ")}`;
      result.appendChild(del);
    }

    // .dialog-check の flex 指定は .field 配下が前提なので div.field で包む
    const delField = document.createElement("div");
    delField.className = "field";
    const delWrap = document.createElement("label");
    delWrap.className = "dialog-check";
    const delCheck = document.createElement("input");
    delCheck.type = "checkbox";
    delCheck.checked = true;
    delCheck.id = "organize-delete-emptied";
    delWrap.append(delCheck, document.createTextNode("空になったファイルを削除する"));
    delField.appendChild(delWrap);
    result.appendChild(delField);

    applyBtn.hidden = false;
  }

  // --- 実行 ---

  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    closeBtn.disabled = true;
    applyBtn.hidden = true;
    result.hidden = true;
    error.hidden = true;
    plan = null;
    startTimer();
    log("開始しています...");
    try {
      await streamSse(
        "/api/snippets/organize/plan",
        {
          model: modelSel.value,
          instruction: inst.value,
          max_categories: Number(catInput.value) || 24,
        },
        (ev) => {
          if (ev.type === "progress") {
            progressInfo = { done: ev.done, total: ev.total };
            log(ev.content);
          } else if (ev.type === "status") log(ev.content);
          else if (ev.type === "model_loaded") log(`モデルをロードしました: ${ev.content}`);
          else if (ev.type === "categories") {
            assignStartedAt = Date.now();
            log(`カテゴリ ${ev.categories.length} 件を設計しました。振り分けを開始します...`);
          }
          else if (ev.type === "warning") log(ev.content);
          else if (ev.type === "plan") plan = ev.plan;
          else if (ev.type === "error") {
            error.textContent = ev.content;
            error.hidden = false;
          }
        }
      );
      if (plan) {
        stopTimer();
        log("整理案ができました。内容を確認して適用してください。");
        renderPlan();
      }
    } catch (e) {
      error.textContent = e.message || String(e);
      error.hidden = false;
    } finally {
      stopTimer();
      renderProgress();
      runBtn.disabled = false;
      closeBtn.disabled = false;
      setIconLabel(runBtn, "sparkles", "作り直す");
    }
  });

  // --- 適用 ---

  applyBtn.addEventListener("click", async () => {
    if (!plan) return;
    const moves = plan.moves.filter((_, i) => checks.get(i)?.checked);
    if (!moves.length) {
      error.textContent = "適用する項目が選ばれていません";
      error.hidden = false;
      return;
    }
    if (!confirm(`${moves.length} 件のスニペットを移動します。よろしいですか？`)) return;
    applyBtn.disabled = true;
    error.hidden = true;
    startTimer();
    log("適用しています...");
    try {
      const res = await fetch("/api/snippets/organize/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moves,
          delete_emptied: !!document.getElementById("organize-delete-emptied")?.checked,
        }),
      });
      if (!res.ok) {
        let detail = res.statusText;
        try {
          detail = (await res.json()).detail || detail;
        } catch {}
        throw new Error(detail);
      }
      const data = await res.json();
      close();
      onApplied?.(data);
    } catch (e) {
      stopTimer();
      renderProgress();
      error.textContent = `適用エラー: ${e.message}`;
      error.hidden = false;
      applyBtn.disabled = false;
    }
  });
}
