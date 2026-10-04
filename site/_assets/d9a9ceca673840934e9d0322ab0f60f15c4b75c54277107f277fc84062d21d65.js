// Shared security-board classification for app.js and watchlist.js.
// Both dashboards load this file before their IIFEs, following the same
// window.StockOps* namespace pattern as StockOpsCompany/StockOpsRemoteMarket.
(function () {
  "use strict";

  function boardLabel(code, assetType) {
    const normalized = String(code || "").toUpperCase();
    const digits = normalized.replace(/\.(SH|SZ|BJ)$/, "");
    if (normalized.endsWith(".BJ") || /^(43|83|87|88|92)/.test(digits)) return "北交所";
    if (/^(300|301)/.test(digits)) return "创业板";
    if (/^(688|689)/.test(digits)) return "科创板";
    if (/^(00|001|002|003|60|601|603|605)/.test(digits)) return "主板";
    return "其他";
  }

  function boardTag(code, assetType) {
    const badge = document.createElement("span");
    badge.className = "security-board-tag";
    badge.textContent = boardLabel(code, assetType);
    return badge;
  }

  window.StockOpsBoard = { boardLabel, boardTag };
})();
