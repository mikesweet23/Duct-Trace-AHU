// Minimal promise-based modal dialogs (prompt / confirm) so we avoid the
// native blocking dialogs and keep everything styled and testable.

const root = () => document.getElementById("modal-root");

function close() {
  root().innerHTML = "";
}

export function showPrompt({ title, label, value = "", type = "text", placeholder = "", okText = "OK" }) {
  return new Promise((resolve) => {
    root().innerHTML = "";
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${title}</h3>
        <div class="field full">
          <label>${label || ""}</label>
          <input id="modal-input" type="${type}" value="${value}" placeholder="${placeholder}" />
        </div>
        <div class="modal-actions">
          <button class="btn ghost" id="modal-cancel">Cancel</button>
          <button class="btn primary" id="modal-ok">${okText}</button>
        </div>
      </div>`;
    root().appendChild(backdrop);
    const input = backdrop.querySelector("#modal-input");
    input.focus();
    input.select();
    const done = (val) => {
      close();
      resolve(val);
    };
    backdrop.querySelector("#modal-ok").onclick = () => done(input.value);
    backdrop.querySelector("#modal-cancel").onclick = () => done(null);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) done(null);
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") done(input.value);
      if (e.key === "Escape") done(null);
    };
  });
}

export function showApplicationPicker({ title = "Application type", current = "commercial", apps = [] } = {}) {
  return new Promise((resolve) => {
    root().innerHTML = "";
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const options = apps.map((a) => `
      <label class="app-option">
        <input type="radio" name="app-type" value="${a.id}" ${a.id === current ? "checked" : ""}/>
        <span>
          <b>${a.label}</b>
          ${a.notes?.[0] ? `<small>${a.notes[0]}</small>` : ""}
        </span>
      </label>`).join("");
    backdrop.innerHTML = `
      <div class="modal wide" role="dialog" aria-modal="true">
        <h3>${title}</h3>
        <p class="empty-hint">Select the intended use before duct sizing. This sets the default velocity profile. You can override rooms and individual sections later.</p>
        <div class="app-list">${options}</div>
        <div class="modal-actions">
          <button class="btn primary" id="modal-ok">Use this application</button>
        </div>
      </div>`;
    root().appendChild(backdrop);
    const done = (val) => {
      close();
      resolve(val);
    };
    backdrop.querySelector("#modal-ok").onclick = () => {
      const picked = backdrop.querySelector("input[name='app-type']:checked");
      done(picked ? picked.value : current);
    };
  });
}

export function showConfirm({ title, message, okText = "OK" }) {
  return new Promise((resolve) => {
    root().innerHTML = "";
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${title}</h3>
        <p class="empty-hint">${message || ""}</p>
        <div class="modal-actions">
          <button class="btn ghost" id="modal-cancel">Cancel</button>
          <button class="btn primary" id="modal-ok">${okText}</button>
        </div>
      </div>`;
    root().appendChild(backdrop);
    const done = (val) => {
      close();
      resolve(val);
    };
    backdrop.querySelector("#modal-ok").onclick = () => done(true);
    backdrop.querySelector("#modal-cancel").onclick = () => done(false);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) done(false);
    };
  });
}
