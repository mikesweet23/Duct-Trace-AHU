// Promise-based dialogs (prompt / confirm), a general modal and a toast, so
// nothing uses the browser's blocking dialogs. Same pattern as Pipe Trace:
// a locked modal cannot be dismissed by clicking away or pressing Escape —
// it is kept for the one thing that has to happen first (the scale).

const root = () => document.getElementById("modal-root");

let current = null;

export function closeModal(force = false) {
  if (!current) return;
  if (current.locked && !force) return;
  const c = current;
  current = null;
  root().innerHTML = "";
  if (c.onClose) c.onClose();
}

export function modalOpen() {
  return !!current;
}

// Opens a modal and returns its body element so the caller can wire buttons.
export function showModal(title, html, opts = {}) {
  closeModal(true);
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal${opts.wide ? " wide" : ""}" role="dialog" aria-modal="true">
      <h3></h3>
      <div class="modal-body">${html}</div>
    </div>`;
  backdrop.querySelector("h3").textContent = title;
  root().appendChild(backdrop);
  current = { locked: !!opts.locked, onClose: opts.onClose || null };
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  backdrop.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(true)));
  return backdrop.querySelector(".modal-body");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function showPrompt({ title, label, value = "", type = "text", placeholder = "", okText = "OK", note = "" }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      closeModal(true);
      resolve(val);
    };
    const body = showModal(title, `
      <div class="field">
        <label>${label || ""}</label>
        <input id="modal-input" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${type === "number" ? 'step="any"' : ""}/>
      </div>
      ${note ? `<p>${note}</p>` : ""}
      <div class="modal-actions">
        <button class="btn ghost" id="modal-cancel">Cancel</button>
        <button class="btn go" id="modal-ok">${okText}</button>
      </div>`, { onClose: () => done(null) });
    const input = body.querySelector("#modal-input");
    input.focus();
    input.select();
    body.querySelector("#modal-ok").onclick = () => done(input.value);
    body.querySelector("#modal-cancel").onclick = () => done(null);
    input.addEventListener("wheel", () => input.blur(), { passive: true });
    input.onkeydown = (e) => {
      if (e.key === "Enter") done(input.value);
      if (e.key === "Escape") done(null);
    };
  });
}

export function showConfirm({ title, message, okText = "OK", cancelText = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      closeModal(true);
      resolve(val);
    };
    const body = showModal(title, `
      <p>${message || ""}</p>
      <div class="modal-actions">
        <button class="btn ghost" id="modal-cancel">${cancelText}</button>
        <button class="btn ${danger ? "bad" : "go"}" id="modal-ok">${okText}</button>
      </div>`, { onClose: () => done(false) });
    body.querySelector("#modal-ok").onclick = () => done(true);
    body.querySelector("#modal-cancel").onclick = () => done(false);
  });
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  if (typeof document === "undefined") return;
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), ms);
}
