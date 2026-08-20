(function () {
  "use strict";

  const button = document.getElementById("traceBtn");
  const status = document.getElementById("status");
  const yearEl = document.getElementById("year");

  yearEl.textContent = new Date().getFullYear();

  let traced = 0;
  button.addEventListener("click", function () {
    traced += 1;
    const label = traced === 1 ? "segment" : "segments";
    status.textContent = `Traced ${traced} duct ${label}.`;
  });
})();
