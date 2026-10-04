(function () {
  "use strict";

  const data = window.__STOCKOPS_DATA__ || {};
  const rankingSnapshot = data.ranking_snapshot || {};
  const requestedSnapshotId = new URLSearchParams(window.location.search).get("snapshot_id");
  const rankingIdentityMismatch = Boolean(
    rankingSnapshot.mode === "canonical"
    && requestedSnapshotId
    && requestedSnapshotId !== String(rankingSnapshot.snapshot_id || "")
  );
  const screenResults = rankingIdentityMismatch
    ? []
    : Array.isArray(data.screen_results) ? data.screen_results : [];
  const resultsByCode = new Map(screenResults.map((item) => [String(item.code), item]));
  const marketFiles = data.market_files || {};
  const remoteMarket = data.remote_market || {};
  const marketSummaries = data.market_summaries || {};
  const indicatorParams = data.indicator_params || {};
  const navigation = data.navigation || {};
  const marketByCode = window.__STOCKOPS_MARKET__ || {};
  window.__STOCKOPS_MARKET__ = marketByCode;
  // board.js/format.js are loaded before this IIFE (see dashboard.html).
  const boardTag = window.StockOpsBoard.boardTag;
  const percent = window.StockOpsFormat.percent;
  const watchlistMarketLoads = {};
  const watchlistMarketLoadTimeoutMs = 12000;
  const watchlistRenderTimeoutMs = 8000;
  let selectedWatchlistCode = null;
  let watchlistChartRequestId = 0;
  let watchlistRange = remoteMarket.enabled ? "1y" : "3m";
  let watchlistQuery = "";

  function byId(id) {
    return document.getElementById(id);
  }

  function mountNavigation() {
    const business = navigation.business || {};
    const stages = navigation.stages || {};
    for (const link of document.querySelectorAll("[data-business-link]")) {
      const href = business[link.dataset.businessLink];
      link.href = href || "#";
      link.hidden = !href;
    }
    for (const link of document.querySelectorAll("[data-stage-link]")) {
      const key = link.dataset.stageLink;
      const href = stages[key];
      link.href = href || "#";
      link.dataset.baseHref = href || "#";
      link.hidden = !href;
      link.setAttribute(
        "aria-current",
        navigation.current_task === key ? "page" : "false"
      );
    }
    for (const link of document.querySelectorAll("[data-home-link]")) {
      link.href = navigation.home || "#";
    }
  }

  function replaceChildren(element, children) {
    while (element.firstChild) element.removeChild(element.firstChild);
    for (const child of children || []) element.appendChild(child);
  }

  function finite(value) {
    return value !== null && value !== "" && Number.isFinite(Number(value));
  }

  function price(value) {
    return finite(value) ? Number(value).toFixed(Number(value) < 10 ? 3 : 2) : "—";
  }

  function tone(element, value) {
    const numeric = Number(value);
    element.classList.toggle("is-positive-text", Number.isFinite(numeric) && numeric > 0);
    element.classList.toggle("is-negative-text", Number.isFinite(numeric) && numeric < 0);
  }

  function workspace(value) {
    const target = value === "watchlist"
      ? "watchlist"
      : value === "candidates"
        ? "candidates"
        : value === "research" ? "research" : "stage";
    byId("stage-workspace").hidden = target !== "stage";
    byId("research-workspace").hidden = target !== "research";
    byId("candidate-workspace").hidden = target !== "candidates";
    byId("watchlist-workspace").hidden = target !== "watchlist";
    for (const button of document.querySelectorAll("[data-workspace]")) {
      button.setAttribute("aria-pressed", String(button.dataset.workspace === target));
    }
    for (const link of document.querySelectorAll("[data-stage-link]")) {
      const base = link.dataset.baseHref || "#";
      if (base === "#") continue;
      link.href = `${base.split("?")[0]}?workspace=${encodeURIComponent(target)}`;
    }
    try {
      window.localStorage.setItem("stockops-workspace", target);
    } catch (_error) {
      // Storage is optional under file:// and restrictive embedded browsers.
    }
    if (target === "stage" || target === "research" || target === "candidates") {
      window.dispatchEvent(new Event("resize"));
    } else {
      if (!selectedWatchlistCode && initialWatchlistCode) {
        selectWatchlistChart(initialWatchlistCode);
      } else if (
        watchlistChart
        && typeof watchlistChart.resize === "function"
      ) {
        watchlistChart.resize();
        if (selectedWatchlistCode) {
          fitWatchlistRange(
            watchlistChart,
            rangedWatchlistBars(selectedWatchlistCode)
          );
        }
      }
    }
    window.scrollTo(0, 0);
  }

  function scrollToWatchlistChart() {
    const target = byId("watchlist-chart-title");
    const top = target ? target.getBoundingClientRect().top + window.scrollY - 18 : 0;
    window.scrollTo(0, top);
  }

  function rankingScore(item) {
    /**
     * Return canonical ranking_score or the explicit legacy display adapter.
     * Input example: { ranking_score: 72.5 }. Output example: 72.5.
     */
    if (Number.isFinite(Number(item.ranking_score))) return Number(item.ranking_score);
    const legacyScore = Number(item.display_score) || 0;
    const maxScore = Number(data.max_score) || 0;
    return maxScore > 0
      ? legacyScore / maxScore * 100
      : legacyScore <= 1 ? legacyScore * 100 : legacyScore;
  }

  function candidateSignals(item) {
    /**
     * Return unified public evidence labels before legacy compatibility labels.
     * Input example: a canonical candidate. Output: its non-empty signal labels,
     * so the watchlist workspace speaks the same public evidence language as Card.
     */
    return (item.evidence_signals || []).length
      ? item.evidence_signals.map((signal) => String(signal.label || signal.id))
      : (item.hit_strategies || []);
  }

  function candidateRow(item, index, fallbackReason) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "replacement-row";
    row.addEventListener("click", () => {
      selectWatchlistChart(String(item.code));
      scrollToWatchlistChart();
    });
    const rank = document.createElement("small");
    rank.textContent = Number.isInteger(item.canonical_rank)
      ? `#${item.canonical_rank}`
      : String(index + 1).padStart(2, "0");
    const info = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = String(item.name || item.code);
    const reason = document.createElement("small");
    reason.textContent = candidateSignals(item).join(" · ") || fallbackReason;
    info.append(name, boardTag(item.code, item.asset_type), reason);
    const score = document.createElement("b");
    score.textContent = candidateSignals(item).length
      ? rankingScore(item).toFixed(2)
      : "自选";
    row.append(rank, info, score);
    return row;
  }

  function renderWatchlist() {
    const watchlist = screenResults.filter((item) =>
      (item.matched_rules || []).includes("自选股")
    );
    const query = watchlistQuery.trim().toLowerCase();
    const visible = query
      ? watchlist.filter((item) =>
          `${item.name || ""} ${item.code || ""}`.toLowerCase().includes(query)
        )
      : watchlist;
    byId("watchlist-nav-count").textContent = String(watchlist.length);
    byId("watchlist-count").textContent = query
      ? `${visible.length} / ${watchlist.length} 只`
      : `${watchlist.length} 只`;
    const rows = visible.map((item, index) =>
      candidateRow(item, index, "自选观察")
    );
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "watchlist-empty";
      empty.textContent = watchlist.length
        ? "没有匹配的自选股。"
        : "尚未配置自选股。";
      rows.push(empty);
    }
    replaceChildren(byId("watchlist-list"), rows);
  }

  function renderReplacements() {
    const replacements = screenResults
      .filter((item) =>
        candidateSignals(item).length > 0
        && !(item.matched_rules || []).includes("自选股")
      )
      .slice(0, 5);
    const rows = replacements.map((item, index) =>
      candidateRow(item, index, "策略候选")
    );
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "watchlist-empty";
      empty.textContent = "本次没有额外策略候选。";
      rows.push(empty);
    }
    replaceChildren(byId("replacement-list"), rows);
  }

  const watchlistRiseColor = "#d94b4b";
  const watchlistFallColor = "#15906a";
  let watchlistChart = null;
  const watchlistIndicatorPanes = {};
  let watchlistOverlayIds = [];
  const watchlistEventTypes = new Set();

  function watchlistBars(code) {
    const snapshot = marketByCode[code] || {};
    return Array.isArray(snapshot.bars)
      ? snapshot.bars.filter((bar) => finite(bar.close))
      : [];
  }

  function rangedWatchlistBars(code) {
    const bars = watchlistBars(code);
    const count = watchlistRange === "3m"
      ? 66
      : watchlistRange === "1y" ? 252 : bars.length;
    return count >= bars.length ? bars : bars.slice(-count);
  }

  function fitWatchlistRange(chart, bars) {
    const chartNode = byId("watchlist-chart");
    if (chartNode) {
      chartNode.dataset.range = watchlistRange;
      chartNode.dataset.rangeBars = String(bars.length);
      chartNode.dataset.sourceBars = String(
        selectedWatchlistCode ? watchlistBars(selectedWatchlistCode).length : bars.length
      );
    }
    if (!chart || !bars.length || typeof chart.setBarSpace !== "function") return;
    const width = chartNode ? chartNode.clientWidth : 0;
    const availableWidth = Math.max(120, width - 64);
    const minimumBarSpace = watchlistRange === "3m" ? 3 : 1;
    const maximumBarSpace = watchlistRange === "3m" ? 12 : 8;
    const fittedSpace = Math.max(
      minimumBarSpace,
      Math.min(maximumBarSpace, availableWidth / bars.length)
    );
    chart.setBarSpace(fittedSpace);
    if (typeof chart.scrollToRealTime === "function") chart.scrollToRealTime();
    if (chartNode) {
      chartNode.dataset.barSpace = String(
        typeof chart.getBarSpace === "function"
          ? chart.getBarSpace()
          : fittedSpace
      );
      window.setTimeout(() => {
        if (!chartNode || typeof chart.getVisibleRange !== "function") return;
        const visible = chart.getVisibleRange();
        chartNode.dataset.visibleBars = String(
          Math.max(0, Number(visible.to) - Number(visible.from) + 1)
        );
      }, 0);
    }
  }

  function watchlistEvents(code) {
    const snapshot = marketByCode[code] || {};
    return Array.isArray(snapshot.events) ? snapshot.events : [];
  }

  function loadWatchlistMarket(code) {
    if (marketByCode[code]) return Promise.resolve(marketByCode[code]);
    if (watchlistMarketLoads[code]) return watchlistMarketLoads[code];
    const loadStatic = () => new Promise((resolve, reject) => {
      if (!marketFiles[code]) {
        reject(new Error(
          remoteMarket.enabled
            ? "远程行情不可用，且本次未发布静态行情"
            : "该股票没有行情快照"
        ));
        return;
      }
      const script = document.createElement("script");
      const timeout = window.setTimeout(() => {
        delete watchlistMarketLoads[code];
        script.remove();
        reject(new Error("行情文件加载超时，请刷新重试"));
      }, watchlistMarketLoadTimeoutMs);
      script.src = String(marketFiles[code]);
      script.async = true;
      script.onload = () => {
        window.clearTimeout(timeout);
        if (marketByCode[code]) resolve(marketByCode[code]);
        else {
          delete watchlistMarketLoads[code];
          reject(new Error("行情文件内容无效"));
        }
      };
      script.onerror = () => {
        window.clearTimeout(timeout);
        delete watchlistMarketLoads[code];
        reject(new Error("行情文件加载失败"));
      };
      document.head.appendChild(script);
    });
    const canLoadRemote = Boolean(
      remoteMarket.enabled
      && /^https?:$/.test(window.location.protocol)
      && window.StockOpsRemoteMarket
    );
    watchlistMarketLoads[code] = canLoadRemote
      ? window.StockOpsRemoteMarket.load(code, {
          adjust: String(remoteMarket.adjust || "qfq"),
          limit: Number(remoteMarket.limit) || 1000,
        }).then((snapshot) => {
          marketByCode[code] = snapshot;
          return snapshot;
        }).catch(() => loadStatic())
      : loadStatic();
    return watchlistMarketLoads[code];
  }

  function applyWatchlistData(chart, bars, onReady, onTimeout) {
    let completed = false;
    let pollTimer = null;
    const startedAt = Date.now();
    const finish = () => {
      if (completed) return;
      completed = true;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      onReady();
    };
    const poll = () => {
      if (completed) return;
      const renderedBars = typeof chart.getDataList === "function"
        ? chart.getDataList()
        : [];
      if (Array.isArray(renderedBars) && renderedBars.length === bars.length) {
        finish();
        return;
      }
      if (Date.now() - startedAt >= watchlistRenderTimeoutMs) {
        completed = true;
        onTimeout();
        return;
      }
      pollTimer = window.setTimeout(poll, 100);
    };
    chart.applyNewData(bars, false, finish);
    if (!completed) pollTimer = window.setTimeout(poll, 0);
  }

  function watchlistIndicator(name, styles) {
    const options = { name };
    const params = indicatorParams[name];
    if (Array.isArray(params) && params.length) options.calcParams = [...params];
    if (styles) options.styles = styles;
    return options;
  }

  function ensureWatchlistChart() {
    if (watchlistChart || !window.klinecharts) return watchlistChart;
    watchlistChart = window.klinecharts.init("watchlist-chart");
    if (!watchlistChart) return null;
    watchlistChart.setStyles({
      candle: {
        bar: {
          upColor: watchlistRiseColor,
          downColor: watchlistFallColor,
          upBorderColor: watchlistRiseColor,
          downBorderColor: watchlistFallColor,
          upWickColor: watchlistRiseColor,
          downWickColor: watchlistFallColor,
        },
        priceMark: {
          last: { upColor: watchlistRiseColor, downColor: watchlistFallColor },
        },
      },
      indicator: {
        ohlc: {
          upColor: "rgba(217, 75, 75, .72)",
          downColor: "rgba(21, 144, 106, .72)",
        },
      },
    });
    watchlistChart.setPaneOptions({
      id: "candle_pane",
      gap: { top: 0.4, bottom: 0.1 },
    });
    return watchlistChart;
  }

  const watchlistBarStyles = {
    bars: [{
      upColor: watchlistRiseColor,
      downColor: watchlistFallColor,
      noChangeColor: "#888888",
    }],
  };

  const watchlistMainIndicators = [
    { key: "MA", label: "MA", checked: true },
    { key: "BOLL", label: "BOLL", checked: false },
  ];
  const watchlistSubIndicators = [
    { key: "VOL", label: "VOL", checked: true },
    { key: "MACD", label: "MACD", checked: true },
    { key: "RSI", label: "RSI", checked: false },
    { key: "KDJ", label: "KDJ", checked: false },
  ];

  function createWatchlistIndicator(definition, main) {
    const chart = ensureWatchlistChart();
    if (!chart) return null;
    const styles = definition.key === "VOL" || definition.key === "MACD"
      ? watchlistBarStyles
      : undefined;
    if (main) {
      return chart.createIndicator(
        watchlistIndicator(definition.key, styles),
        false,
        { id: "candle_pane" }
      );
    }
    return chart.createIndicator(
      watchlistIndicator(definition.key, styles),
      false,
      { height: 112, minHeight: 80, gap: { top: 0.1, bottom: 0.1 } }
    );
  }

  function mountWatchlistIndicators(definitions, container, main) {
    for (const definition of definitions) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = definition.checked;
      checkbox.addEventListener("change", () => {
        const chart = ensureWatchlistChart();
        if (!chart) return;
        if (checkbox.checked) {
          watchlistIndicatorPanes[definition.key] =
            createWatchlistIndicator(definition, main);
        } else if (watchlistIndicatorPanes[definition.key]) {
          chart.removeIndicator(
            watchlistIndicatorPanes[definition.key],
            definition.key
          );
          delete watchlistIndicatorPanes[definition.key];
        }
      });
      const params = indicatorParams[definition.key];
      const text = Array.isArray(params) && params.length
        ? `${definition.label}${params.join("/")}`
        : definition.label;
      label.append(checkbox, document.createTextNode(text));
      container.appendChild(label);
    }
  }

  function activateDefaultWatchlistIndicators() {
    if (!ensureWatchlistChart()) return;
    for (const definition of watchlistMainIndicators) {
      if (definition.checked && !watchlistIndicatorPanes[definition.key]) {
        watchlistIndicatorPanes[definition.key] =
          createWatchlistIndicator(definition, true);
      }
    }
    for (const definition of watchlistSubIndicators) {
      if (definition.checked && !watchlistIndicatorPanes[definition.key]) {
        watchlistIndicatorPanes[definition.key] =
          createWatchlistIndicator(definition, false);
      }
    }
  }

  function renderWatchlistEventFilters(events) {
    const types = [...new Set(events.map((event) => String(event.event)))].sort();
    const menu = byId("watchlist-event-menu");
    const filters = byId("watchlist-event-filters");
    menu.hidden = types.length === 0;
    replaceChildren(filters);
    const legend = document.createElement("legend");
    legend.textContent = "事件类型";
    filters.appendChild(legend);
    for (const type of types) {
      if (!watchlistEventTypes.has(type)) watchlistEventTypes.add(type);
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = watchlistEventTypes.has(type);
      checkbox.addEventListener("change", () => {
        checkbox.checked
          ? watchlistEventTypes.add(type)
          : watchlistEventTypes.delete(type);
        renderWatchlistOverlays(selectedWatchlistCode);
      });
      label.append(checkbox, document.createTextNode(type));
      filters.appendChild(label);
    }
  }

  function renderWatchlistOverlays(code) {
    const chart = ensureWatchlistChart();
    if (!chart) return;
    for (const id of watchlistOverlayIds) chart.removeOverlay(id);
    watchlistOverlayIds = [];
    const bars = rangedWatchlistBars(code);
    const highByTimestamp = new Map(
      bars.map((bar) => [bar.timestamp, Number(bar.high)])
    );
    const events = watchlistEvents(code)
      .filter((event) =>
        watchlistEventTypes.has(String(event.event))
        && highByTimestamp.has(event.timestamp)
      )
      .slice(-8);
    byId("watchlist-event-summary").textContent = `事件 ${events.length}`;
    for (const event of events) {
      const id = chart.createOverlay({
        name: "simpleAnnotation",
        points: [{
          timestamp: event.timestamp,
          value: highByTimestamp.get(event.timestamp),
        }],
        extendData: String(event.event),
      });
      if (id) watchlistOverlayIds.push(id);
    }
  }

  function watchlistDisplayItem(code) {
    return resultsByCode.get(code) || { code, name: code };
  }

  function renderWatchlistChartSummary(code) {
    const item = watchlistDisplayItem(code);
    const summary = marketSummaries[code] || {};
    const bars = watchlistBars(code);
    const latest = bars.length ? Number(bars[bars.length - 1].close) : null;
    byId("watchlist-chart-identity").textContent =
      `${item.name || code} · ${code}`;
    const analysisLink = byId("watchlist-analysis-link");
    if (analysisLink) analysisLink.href = `stock-analysis.html?code=${encodeURIComponent(code)}`;
    byId("watchlist-chart-close").textContent = price(
      finite(latest) ? latest : summary.latest_close
    );
    const oneDay = byId("watchlist-chart-change-1d");
    const fiveDay = byId("watchlist-chart-change-5d");
    oneDay.textContent = percent(summary.change_1d);
    fiveDay.textContent = percent(summary.change_5d);
    tone(oneDay, summary.change_1d);
    tone(fiveDay, summary.change_5d);
  }

  function selectWatchlistChart(code) {
    const requestId = ++watchlistChartRequestId;
    selectedWatchlistCode = code;
    if (window.StockOpsCompany) {
      window.StockOpsCompany.render(
        byId("watchlist-company-panel"),
        code,
        "自选股或策略候选"
      );
    }
    renderWatchlistChartSummary(code);
    const status = byId("watchlist-chart-status");
    status.textContent = "正在加载完整历史行情…";
    status.hidden = false;
    loadWatchlistMarket(code).then(() => {
      if (selectedWatchlistCode !== code || requestId !== watchlistChartRequestId) return;
      const chart = ensureWatchlistChart();
      if (!chart) throw new Error("图表组件加载失败，请刷新重试");
      activateDefaultWatchlistIndicators();
      renderWatchlistChartSummary(code);
      const bars = rangedWatchlistBars(code);
      if (!bars.length) throw new Error("该股票没有可用历史行情");
      const events = watchlistEvents(code);
      renderWatchlistEventFilters(events);
      const finish = () => {
        if (selectedWatchlistCode !== code || requestId !== watchlistChartRequestId) return;
        fitWatchlistRange(chart, bars);
        renderWatchlistOverlays(code);
        status.hidden = true;
        status.textContent = "";
        if (chart && typeof chart.resize === "function") chart.resize();
      };
      applyWatchlistData(chart, bars, finish, () => {
        if (selectedWatchlistCode !== code || requestId !== watchlistChartRequestId) return;
        status.textContent = "技术图渲染超时，请点击股票重试";
        status.hidden = false;
      });
    }).catch((error) => {
      if (selectedWatchlistCode !== code || requestId !== watchlistChartRequestId) return;
      status.textContent = String(
        error && error.message || "行情加载失败，请刷新重试"
      );
    });
  }

  function renderAll() {
    byId("candidate-workspace-count").textContent = `${screenResults.length} 只候选`;
    renderWatchlist();
    renderReplacements();
  }

  for (const button of document.querySelectorAll("[data-workspace]")) {
    button.addEventListener("click", () => workspace(button.dataset.workspace));
  }
  for (const button of document.querySelectorAll("[data-stage-deep-link]")) {
    button.addEventListener(
      "click",
      () => workspace(button.dataset.stageDeepLink)
    );
  }
  for (const button of document.querySelectorAll("[data-watchlist-range]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.watchlistRange === watchlistRange)
    );
    button.addEventListener("click", () => {
      watchlistRange = String(button.dataset.watchlistRange);
      for (const candidate of document.querySelectorAll("[data-watchlist-range]")) {
        candidate.setAttribute(
          "aria-pressed",
          String(candidate.dataset.watchlistRange === watchlistRange)
        );
      }
      if (!selectedWatchlistCode) return;
      const chart = ensureWatchlistChart();
      const rangeBars = rangedWatchlistBars(selectedWatchlistCode);
      const redraw = () => {
        fitWatchlistRange(chart, rangeBars);
        renderWatchlistOverlays(selectedWatchlistCode);
      };
      if (chart) {
        fitWatchlistRange(chart, rangeBars);
        applyWatchlistData(chart, rangeBars, redraw, redraw);
      } else {
        redraw();
      }
    });
  }
  byId("watchlist-search-input").addEventListener("input", (event) => {
    watchlistQuery = String(event.target.value || "");
    renderWatchlist();
  });
  window.addEventListener("resize", () => {
    if (!watchlistChart || !selectedWatchlistCode) return;
    watchlistChart.resize();
    fitWatchlistRange(
      watchlistChart,
      rangedWatchlistBars(selectedWatchlistCode)
    );
  });

  mountWatchlistIndicators(
    watchlistMainIndicators,
    byId("watchlist-main-indicators"),
    true
  );
  mountWatchlistIndicators(
    watchlistSubIndicators,
    byId("watchlist-sub-indicators"),
    false
  );
  renderAll();
  const watchlistResults = screenResults.filter((item) =>
    (item.matched_rules || []).includes("自选股")
  );
  const initialWatchlistCode = watchlistResults.length
    ? String(watchlistResults[0].code)
    : screenResults.length ? String(screenResults[0].code) : null;
  mountNavigation();
  const requestedWorkspace = new URLSearchParams(window.location.search).get(
    "workspace"
  );
  let initialWorkspace = ["stage", "research", "candidates", "watchlist"].includes(
    requestedWorkspace
  ) ? requestedWorkspace : "stage";
  for (const button of document.querySelectorAll("[data-watchlist-range]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.watchlistRange === watchlistRange)
    );
  }
  workspace(initialWorkspace);
})();
