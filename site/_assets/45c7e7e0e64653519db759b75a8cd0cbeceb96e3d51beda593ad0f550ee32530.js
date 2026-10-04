// Shared signed-percent formatting for app.js and watchlist.js. The renderers
// copy this file into each run directory at packaging time, so run directories
// stay self-contained (file:// opens without a server) without a second
// hand-maintained copy drifting out of sync.
(function () {
  "use strict";

  // Blank markers (null/undefined/""), NaN, Infinity, and non-numeric
  // strings all render as an em dash instead of a bogus "NaN%".
  function percent(value) {
    if (value === null || value === undefined || value === "") return "—";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)}%`;
  }

  window.StockOpsFormat = { percent };
})();
