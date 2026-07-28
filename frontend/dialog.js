/**
 * テキスト入力モーダル。
 * Electron のレンダラーは window.prompt() を非サポートのため、その代替。
 */

export function showInputDialog(title, defaultValue = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";

    const box = document.createElement("div");
    box.className = "dialog-box";

    const h = document.createElement("div");
    h.className = "dialog-title";
    h.textContent = title;

    const input = document.createElement("input");
    input.type = "text";
    input.value = defaultValue;

    const row = document.createElement("div");
    row.className = "dialog-buttons";
    const ok = document.createElement("button");
    ok.className = "primary";
    ok.textContent = "OK";
    const cancel = document.createElement("button");
    cancel.textContent = "キャンセル";
    row.append(cancel, ok);

    box.append(h, input, row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    ok.addEventListener("click", () => close(input.value));
    cancel.addEventListener("click", () => close(null));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") close(input.value);
      else if (e.key === "Escape") close(null);
    });

    input.focus();
    input.select();
  });
}

/**
 * 複数項目の入力モーダル。
 * fields: [{ key, label, type?: "text" | "select" | "textarea", value?, options?, hint? }]
 * onSubmit(values) を渡すと、その完了まで閉じない（例外はダイアログ内にエラー表示）。
 * OK なら値のオブジェクト、キャンセルなら null を返す。
 */
export function showFormDialog(title, fields, { submitLabel = "OK", onSubmit } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";

    const box = document.createElement("div");
    box.className = "dialog-box dialog-form";

    const h = document.createElement("div");
    h.className = "dialog-title";
    h.textContent = title;
    box.appendChild(h);

    const controls = new Map();
    for (const f of fields) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const label = document.createElement("label");
      label.textContent = f.label;
      let input;
      if (f.type === "select") {
        input = document.createElement("select");
        for (const opt of f.options || []) {
          const o = document.createElement("option");
          o.value = typeof opt === "string" ? opt : opt.value;
          o.textContent = typeof opt === "string" ? opt : opt.label;
          input.appendChild(o);
        }
        input.value = f.value ?? "";
      } else if (f.type === "textarea") {
        input = document.createElement("textarea");
        input.rows = 3;
        input.value = f.value ?? "";
      } else {
        input = document.createElement("input");
        input.type = "text";
        input.value = f.value ?? "";
      }
      input.style.width = "100%";
      wrap.append(label, input);
      if (f.hint) {
        const hint = document.createElement("div");
        hint.className = "dialog-hint";
        hint.textContent = f.hint;
        wrap.appendChild(hint);
      }
      box.appendChild(wrap);
      controls.set(f.key, input);
    }

    const error = document.createElement("div");
    error.className = "dialog-error";
    error.hidden = true;
    box.appendChild(error);

    const row = document.createElement("div");
    row.className = "dialog-buttons";
    const ok = document.createElement("button");
    ok.className = "primary";
    ok.textContent = submitLabel;
    const cancel = document.createElement("button");
    cancel.textContent = "キャンセル";
    row.append(cancel, ok);
    box.appendChild(row);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    const values = () => {
      const out = {};
      for (const [key, input] of controls) out[key] = input.value;
      return out;
    };
    const submit = async () => {
      const v = values();
      if (!onSubmit) return close(v);
      ok.disabled = true;
      error.hidden = true;
      try {
        await onSubmit(v);
        close(v);
      } catch (e) {
        error.textContent = e.message || String(e);
        error.hidden = false;
        ok.disabled = false;
      }
    };

    ok.addEventListener("click", submit);
    cancel.addEventListener("click", () => close(null));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close(null);
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") submit();
      else if (e.key === "Escape") close(null);
    });

    const first = controls.values().next().value;
    if (first) {
      first.focus();
      if (first.select) first.select();
    }
  });
}
