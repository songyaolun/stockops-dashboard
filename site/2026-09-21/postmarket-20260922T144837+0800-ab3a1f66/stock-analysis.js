const stockOpsAnalysisLevelLogic = (() => {
  "use strict";
  const primaryLevelLimit = 5;

  /**
   * Return the absolute zone-midpoint distance from the latest close.
   * Input: a zone with lower/upper and a numeric close; output: a non-negative ratio.
   * Example: zone [9, 11] versus close 10 returns 0.
   */
  function distanceFromClose(zone, close) {
    if (!Number.isFinite(close) || close <= 0) return Math.abs(Number(zone.distance_fraction) || 0);
    return Math.abs(((Number(zone.lower) + Number(zone.upper)) / 2) / close - 1);
  }

  /**
   * Split all zones into semantic primary cards and distance-sorted secondary cards.
   * Input: one stock-research report; output: unique primary/secondary arrays without padding.
   * Example: if stop and nearest support share an id, the primary list contains it once.
   */
  function prioritize(report) {
    const zones = [...(report.price_levels?.zones || [])];
    const close = Number(report.technical?.indicators?.close);
    const stopZoneId = report.risk_plan?.stop_loss?.zone_id;
    const firstTargetZoneId = report.risk_plan?.take_profit?.[0]?.zone_id;
    const byDistance = (left, right) => distanceFromClose(left, close) - distanceFromClose(right, close) || String(left.id).localeCompare(String(right.id));
    const domainKeyLevels = report.price_levels?.key_levels;
    if (!Array.isArray(domainKeyLevels)) throw new Error("新版研究结果缺少领域关键位，请生成新 run。");
    const primary = domainKeyLevels.slice(0, primaryLevelLimit);
    const primaryIds = new Set(primary.map((zone) => zone.id));
    return { primary, secondary: zones.filter((zone) => !primaryIds.has(zone.id)).sort(byDistance) };
  }

  /**
   * Report whether both zone boundaries fit inside the supplied bar-price extent.
   * Input: one zone and bar rows; output: boolean. Example: [9,11] fits bars spanning [8,12].
   */
  function fitsBars(zone, bars) {
    const lows = bars.map((bar) => Number(bar.low)).filter(Number.isFinite);
    const highs = bars.map((bar) => Number(bar.high)).filter(Number.isFinite);
    if (!lows.length || !highs.length) return false;
    const minimum = Math.min(...lows);
    const maximum = Math.max(...highs);
    const span = maximum - minimum;
    return Number(zone.lower) >= minimum - span * 0.1 && Number(zone.upper) <= maximum + span * 0.4;
  }

  /**
   * Choose the smallest standard chart range that contains a selected zone.
   * Input: zone, full bar rows and current range; output: {range,label,changed,visible}.
   * Example: a zone outside 66 bars but inside 252 returns range 252 and changed true.
   */
  function revealRange(zone, bars, currentRange) {
    const rows = (value) => value ? bars.slice(-value) : bars;
    if (fitsBars(zone, rows(currentRange))) return { range: currentRange, label: null, changed: false, visible: true };
    for (const option of [{ range: 66, label: "3月" }, { range: 252, label: "1年" }, { range: 0, label: "全部" }]) {
      if (fitsBars(zone, rows(option.range))) return { ...option, changed: option.range !== currentRange, visible: true };
    }
    return { range: currentRange, label: null, changed: false, visible: false };
  }

  /**
   * Build the two boundary descriptors consumed by KLineCharts.
   * Input: one zone; output: lower/upper descriptor rows. Example: [9,11] returns values 9 and 11.
   */
  function overlayBoundaries(zone) {
    return [{ value: Number(zone.lower), label: "下沿" }, { value: Number(zone.upper), label: "上沿" }];
  }

  return { distanceFromClose, prioritize, fitsBars, revealRange, overlayBoundaries, primaryLevelLimit };
})();
if (typeof module !== "undefined" && module.exports) module.exports = stockOpsAnalysisLevelLogic;
if (typeof globalThis !== "undefined") globalThis.StockOpsAnalysisLevelLogic = stockOpsAnalysisLevelLogic;

(() => {
  "use strict";
  if (typeof document === "undefined") return;
  const payload = window.__STOCKOPS_ANALYSIS__ || { reports: {}, choices: [] };
  const byId = (id) => document.getElementById(id);
  const reports = payload.reports || {};
  let current = null;
  let requestSequence = 0;
  let range = 66;
  let analysisChart = null;
  let analysisIndicatorsReady = false;
  let chartRenderSequence = 0;
  let selectedLevelId = null;
  let selectedLevelTrigger = null;
  let selectedLevelFocusPending = false;
  let selectedLevelRangeMessage = "";
  let selectedLevelVisible = true;
  let analysisLevelOverlayIds = [];
  let pendingDeepLinkedLevelId = new URLSearchParams(location.search).get("level");
  const levelLogic = stockOpsAnalysisLevelLogic;
  const numeric = (value, digits = 2) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(digits);
  const percent = (value) => value === null || value === undefined ? "—" : `${numeric(value * 100)}%`;
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function codeOf(value) {
    const match = String(value).trim().toUpperCase().match(/^(?:(SH|SZ|BJ))?(\d{6})(?:\.(SH|SZ|BJ))?$/);
    if (!match) throw new Error("请输入六位 A 股代码，可带交易所前缀或后缀。");
    const exchange = match[2].startsWith("6") ? "SH" : /^(4|8|92)/.test(match[2]) ? "BJ" : "SZ";
    if (!/^(0|3|4|6|8|92)/.test(match[2]) || [match[1], match[3]].some((part) => part && part !== exchange)) throw new Error("股票代码与交易所不匹配。");
    return `${match[2]}.${exchange}`;
  }
  function svgNode(tag, attributes) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }
  function plotAnalog(paths, { width = 520, height = 190, divider = null } = {}) {
    const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "当前路径与历史相似路径对比" });
    const values = paths.flatMap((path) => path.values.filter((value) => value !== null && Number.isFinite(value)));
    if (!values.length) return svg;
    const minimum = Math.min(...values), maximum = Math.max(...values);
    const scale = maximum - minimum || Math.max(Math.abs(maximum) * 0.01, 0.01);
    const count = Math.max(...paths.map((path) => path.values.length));
    const bottom = height - 26;
    const x = (index) => 46 + index / Math.max(count - 1, 1) * (width - 66);
    const y = (value) => 18 + (maximum - value) / scale * (bottom - 32);
    for (let index = 0; index < 4; index += 1) {
      const value = minimum + scale * index / 3;
      svg.append(svgNode("line", { x1: 46, x2: width - 20, y1: y(value), y2: y(value), stroke: "#e4eaee" }));
      const label = svgNode("text", { x: 2, y: y(value) + 4, fill: "#647680", "font-size": 11 });
      label.textContent = numeric(value);
      svg.append(label);
    }
    if (divider !== null) svg.append(svgNode("line", { x1: x(divider), x2: x(divider), y1: 10, y2: bottom, stroke: "#8797a0", "stroke-dasharray": "4 4" }));
    for (const path of paths) {
      const points = path.values.flatMap((value, index) => value === null || !Number.isFinite(value) ? [] : [`${x(index)},${y(value)}`]);
      svg.append(svgNode("polyline", { points: points.join(" "), fill: "none", stroke: path.color, "stroke-width": 2 }));
    }
    return svg;
  }
  function klineBars(bars) {
    return bars.flatMap((bar) => {
      const timestamp = Number.isFinite(Number(bar.timestamp))
        ? Number(bar.timestamp)
        : Date.parse(`${bar.date}T00:00:00+08:00`);
      const values = [bar.open, bar.high, bar.low, bar.close].map(Number);
      if (!Number.isFinite(timestamp) || values.some((value) => !Number.isFinite(value))) return [];
      return [{
        timestamp,
        open: values[0],
        high: values[1],
        low: values[2],
        close: values[3],
        volume: Number.isFinite(Number(bar.volume)) ? Number(bar.volume) : 0,
      }];
    });
  }
  function ensureAnalysisChart() {
    if (analysisChart || !window.klinecharts) return analysisChart;
    analysisChart = window.klinecharts.init("analysis-chart");
    if (!analysisChart) return null;
    const riseColor = "#d94b4b";
    const fallColor = "#15906a";
    analysisChart.setStyles({
      candle: {
        bar: {
          upColor: riseColor,
          downColor: fallColor,
          upBorderColor: riseColor,
          downBorderColor: fallColor,
          upWickColor: riseColor,
          downWickColor: fallColor,
        },
        priceMark: { last: { upColor: riseColor, downColor: fallColor } },
      },
      indicator: {
        ohlc: {
          upColor: "rgba(217, 75, 75, .72)",
          downColor: "rgba(21, 144, 106, .72)",
        },
      },
    });
    analysisChart.setPaneOptions({ id: "candle_pane", gap: { top: 0.4, bottom: 0.1 } });
    if (typeof analysisChart.subscribeAction === "function" && window.klinecharts.ActionType) {
      for (const action of [window.klinecharts.ActionType.OnZoom, window.klinecharts.ActionType.OnScroll]) {
        analysisChart.subscribeAction(action, () => window.requestAnimationFrame(refreshAnalysisPriceBand));
      }
    }
    return analysisChart;
  }
  function activateAnalysisIndicators() {
    const chart = ensureAnalysisChart();
    if (!chart || analysisIndicatorsReady) return;
    chart.createIndicator(
      { name: "MA", calcParams: [20, 60] },
      false,
      { id: "candle_pane" }
    );
    chart.createIndicator(
      {
        name: "VOL",
        styles: {
          bars: [{
            upColor: "#d94b4b",
            downColor: "#15906a",
            noChangeColor: "#888888",
          }],
        },
      },
      false,
      { height: 100, minHeight: 72, gap: { top: 0.1, bottom: 0.1 } }
    );
    analysisIndicatorsReady = true;
  }
  function fitAnalysisRange(chart, bars) {
    const node = byId("analysis-chart");
    node.dataset.rangeBars = String(bars.length);
    if (!bars.length || typeof chart.setBarSpace !== "function") return;
    const availableWidth = Math.max(120, node.clientWidth - 64);
    const minimumBarSpace = range === 66 ? 3 : 1;
    const maximumBarSpace = range === 66 ? 12 : 8;
    const fittedSpace = Math.max(
      minimumBarSpace,
      Math.min(maximumBarSpace, availableWidth / bars.length)
    );
    chart.setBarSpace(fittedSpace);
    if (typeof chart.scrollToRealTime === "function") chart.scrollToRealTime();
    node.dataset.barSpace = String(
      typeof chart.getBarSpace === "function" ? chart.getBarSpace() : fittedSpace
    );
    window.setTimeout(() => {
      if (typeof chart.getVisibleRange !== "function") return;
      const visible = chart.getVisibleRange();
      node.dataset.visibleBars = String(
        Math.max(0, Number(visible.to) - Number(visible.from) + 1)
      );
    }, 0);
  }
  /**
   * Remove every selected-zone overlay and its DOM diagnostics from the main chart.
   * Input: no arguments; it uses the current chart and overlay-id list.
   * Output: no return value; for example, two boundary overlays become zero.
   */
  function removeAnalysisLevelOverlays() {
    if (analysisChart) {
      for (const id of analysisLevelOverlayIds) analysisChart.removeOverlay(id);
    }
    analysisLevelOverlayIds = [];
    const chartNode = byId("analysis-chart");
    chartNode.dataset.levelOverlayCount = "0";
    delete chartNode.dataset.selectedLevel;
    byId("analysis-price-band").hidden = true;
  }
  /**
   * Position a translucent DOM band between the selected chart coordinates.
   * Input: one zone, the last visible timestamp and its role color; output: no return value.
   * Example: support [10.20,10.45] becomes a green strip between its y-axis pixels.
   */
  function renderAnalysisPriceBand(zone, timestamp, color) {
    const band = byId("analysis-price-band");
    const pixels = analysisChart.convertToPixel(
      [{ timestamp, value: Number(zone.upper) }, { timestamp, value: Number(zone.lower) }],
      { paneId: "candle_pane", absolute: true }
    );
    const pane = typeof analysisChart.getSize === "function" ? analysisChart.getSize("candle_pane", "main") : null;
    const top = Number(pixels?.[0]?.y);
    const bottom = Number(pixels?.[1]?.y);
    if (![top, bottom, Number(pane?.left), Number(pane?.width)].every(Number.isFinite)) { band.hidden = true; return; }
    band.style.left = String(Number(pane.left)) + "px";
    band.style.width = String(Number(pane.width)) + "px";
    band.style.top = `${Math.min(top, bottom)}px`;
    band.style.height = `${Math.max(2, Math.abs(bottom - top))}px`;
    band.style.setProperty("--band-color", color);
    band.style.setProperty("--band-fill", `${color}24`);
    band.hidden = false;
  }
  /**
   * Recalculate the selected DOM price band after chart zoom, scroll or resize.
   * Input/output: no arguments or return value; the current selected zone is repositioned.
   * Example: dragging the chart keeps a support band aligned with its native overlay lines.
   */
  function refreshAnalysisPriceBand() {
    if (!analysisChart || !selectedLevelVisible) return;
    const zone = (current?.price_levels?.zones || []).find((item) => item.id === selectedLevelId);
    const visibleBars = klineBars(range ? (current?.technical?.bars || []).slice(-range) : (current?.technical?.bars || []));
    if (!zone || !visibleBars.length) return;
    const colors = { support: "#27765b", resistance: "#b5473e", pivot: "#b27c27" };
    renderAnalysisPriceBand(zone, visibleBars[visibleBars.length - 1].timestamp, colors[zone.role] || "#276f9b");
  }
  /**
   * Draw the selected zone as two locked horizontal boundaries.
   * Input: selectedLevelId plus the current report/range held by this page.
   * Output: no return value; for example, support [10.20, 10.45] creates two labelled lines.
   */
  function renderSelectedLevelOverlay() {
    removeAnalysisLevelOverlays();
    const zone = (current?.price_levels?.zones || []).find((item) => item.id === selectedLevelId);
    const visibleBars = klineBars(range ? (current?.technical?.bars || []).slice(-range) : (current?.technical?.bars || []));
    const notice = byId("analysis-chart-level");
    if (!analysisChart || !zone || !visibleBars.length) {
      notice.hidden = true;
      return;
    }
    if (!selectedLevelVisible) {
      byId("analysis-chart-level-text").textContent = `${labelOf(zone.role)} ${numeric(zone.lower)} — ${numeric(zone.upper)}：当前图表数据无法显示该历史区域，未绘制上下沿。`;
      byId("analysis-chart").dataset.selectedLevel = zone.id;
      notice.hidden = false;
      if (selectedLevelFocusPending) {
        selectedLevelFocusPending = false;
        byId("analysis-chart-level-clear").focus({ preventScroll: true });
      }
      return;
    }
    const colors = { support: "#27765b", resistance: "#b5473e", pivot: "#b27c27" };
    const color = colors[zone.role] || "#276f9b";
    const lastTimestamp = visibleBars[visibleBars.length - 1].timestamp;
    for (const boundary of levelLogic.overlayBoundaries(zone)) {
      const created = analysisChart.createOverlay({
        name: "horizontalStraightLine",
        lock: true,
        points: [{ timestamp: lastTimestamp, value: boundary.value }],
        extendData: `${labelOf(zone.role)} ${boundary.label} ${numeric(boundary.value)}`,
        styles: { line: { color, size: 2 } },
      });
      if (Array.isArray(created)) analysisLevelOverlayIds.push(...created);
      else if (created) analysisLevelOverlayIds.push(created);
    }
    byId("analysis-chart").dataset.selectedLevel = zone.id;
    byId("analysis-chart").dataset.levelOverlayCount = String(analysisLevelOverlayIds.length);
    renderAnalysisPriceBand(zone, lastTimestamp, color);
    byId("analysis-chart-level-text").textContent = `主图已高亮：${labelOf(zone.role)} ${numeric(zone.lower)} — ${numeric(zone.upper)}（上下沿）${selectedLevelRangeMessage}`;
    notice.hidden = false;
    if (selectedLevelFocusPending) {
      selectedLevelFocusPending = false;
      byId("analysis-chart-level-clear").focus({ preventScroll: true });
    }
  }
  function renderChart() {
    const bars = current.technical?.bars || [];
    const start = range ? Math.max(0, bars.length - range) : 0;
    const source = bars.slice(start);
    const visible = klineBars(source);
    const chart = ensureAnalysisChart();
    const status = byId("analysis-chart-status");
    const renderSequence = ++chartRenderSequence;
    byId("analysis-chart").dataset.rangeBars = String(visible.length);
    if (!chart) {
      status.textContent = "K 线组件加载失败，请刷新重试。";
      status.hidden = false;
    } else if (!visible.length) {
      chart.clearData();
      status.textContent = "无可用图表数据";
      status.hidden = false;
    } else {
      activateAnalysisIndicators();
      status.textContent = "正在渲染日 K…";
      status.hidden = false;
      let completed = false;
      let pollTimer = null;
      const startedAt = Date.now();
      const finish = () => {
        if (completed || renderSequence !== chartRenderSequence) return;
        completed = true;
        if (pollTimer !== null) window.clearTimeout(pollTimer);
        fitAnalysisRange(chart, visible);
        if (typeof chart.resize === "function") chart.resize();
        status.hidden = true;
        status.textContent = "";
        renderSelectedLevelOverlay();
      };
      const poll = () => {
        if (completed || renderSequence !== chartRenderSequence) return;
        const rendered = typeof chart.getDataList === "function" ? chart.getDataList() : [];
        if (Array.isArray(rendered) && rendered.length === visible.length) {
          finish();
        } else if (Date.now() - startedAt >= 8000) {
          completed = true;
          status.textContent = "技术图渲染超时，请切换范围重试。";
          status.hidden = false;
        } else {
          pollTimer = window.setTimeout(poll, 100);
        }
      };
      chart.applyNewData(visible, false, finish);
      if (!completed) pollTimer = window.setTimeout(poll, 0);
    }
    byId("analysis-chart-note").textContent = visible.length
      ? `${source[0].date} — ${source[source.length - 1].date} · ${visible.length}根前复权日 K · 主图：MA20 / MA60 · 副图：成交量。可缩放、拖动并查看十字光标。`
      : "无可用图表数据";
  }
  const labels = { business: "业务", fundamentals: "财务", valuation: "估值", fund_flow: "资金", ownership: "股东", events: "事件", industry: "行业", market: "大盘", price_volume: "价量", available: "可用", partial: "部分覆盖", missing: "缺失", stale: "陈旧", conflict: "冲突", unverified_time: "可知时间未核验", superseded: "已被新版本替代", insufficient: "数据不足", unavailable: "不可用", conditional: "条件式参考", observe_only: "仅观察", condition_observed: "已观察到条件", confirmed: "已确认", unconfirmed: "待确认", not_triggered: "未触发", support: "支撑", resistance: "阻力", pivot: "枢轴", up: "上涨", down: "下跌", mixed: "分歧", expanding: "扩张", contracting: "收缩", stable: "稳定", ready: "可用" };
  const labelOf = (value) => labels[value] || value || "—";
  const blockers = { stale_bars: "行情陈旧", no_latest_trades: "最新日无成交", zero_volatility: "波动为零", single_price_session: "单一价格日", unreliable_confirmation_session: "确认日数据不可靠", no_support_below_price: "价格下方无有效结构支撑", invalid_stop_geometry: "止损位置无效", no_observed_upside_target: "无已观测上方阻力", insufficient_reward_risk_to_first_resistance: "到首个阻力的收益风险比不足", insufficient_history: "历史不足" };
  const levelEvidenceLabels = { range_low: "周期低点", range_high: "周期高点", swing_low: "局部低点", swing_high: "局部高点", moving_average: "均线", volume_concentration_proxy: "成交集中近似" };
  function metric(label, value) {
    const node = element("div", undefined, "metric");
    node.append(element("span", label), element("strong", value));
    return node;
  }
  function conditionText(condition) {
    if (!condition) return "不可用";
    const names = { close_above: "收盘高于", close_below: "收盘低于", close_at_or_above: "收盘达到或高于", close_at_or_below: "收盘达到或低于", close_inside: "收盘在区域内", close_outside: "收盘离开区域" };
    const price = "price" in condition ? numeric(condition.price) : `${numeric(condition.lower)} — ${numeric(condition.upper)}`;
    return `${names[condition.operator] || condition.operator} ${price}${condition.consecutive_closes ? `；连续${condition.consecutive_closes}根收盘` : ""}${condition.minimum_volume_ratio20 ? `；量比至少${numeric(condition.minimum_volume_ratio20)}倍` : ""}${condition.reason ? `。${condition.reason}` : ""}`;
  }
  /**
   * Explain the semantic reason a zone is in the compact view.
   * Input: one zone and its report; output: a short Chinese label such as "结构止损依据".
   */
  function levelImportance(zone, report) {
    if (Array.isArray(zone.importance_labels) && zone.importance_labels.length) return zone.importance_labels.join(" · ");
    if (zone.id === report.risk_plan?.stop_loss?.zone_id) return "结构止损依据";
    if (zone.id === report.risk_plan?.take_profit?.[0]?.zone_id) return "第一止盈参考";
    if (zone.role === "pivot") return "当前价格枢轴";
    return zone.role === "support" ? "邻近支撑" : zone.role === "resistance" ? "邻近阻力" : "邻近区域";
  }
  /**
   * Synchronize card data-selected and button aria-pressed state with selectedLevelId.
   * Input/output: no arguments or return value; it updates all rendered price-zone cards.
   */
  function syncLevelSelection() {
    for (const card of document.querySelectorAll("[data-level-id]")) {
      const selected = card.dataset.levelId === selectedLevelId;
      card.dataset.selected = String(selected);
      card.querySelector("[data-level-select]")?.setAttribute("aria-pressed", String(selected));
    }
  }
  /**
   * Expand the chart to the smallest standard range that contains the selected zone.
   * Input: one price zone; output: true when a chart re-render is required.
   * Example: an old support outside 66 bars switches the chart to 252 bars when possible.
   */
  function revealLevelRange(zone) {
    const selection = levelLogic.revealRange(zone, current?.technical?.bars || [], range);
    selectedLevelVisible = selection.visible;
    if (!selection.visible) { selectedLevelRangeMessage = ""; return false; }
    if (!selection.changed) { selectedLevelRangeMessage = ""; return false; }
    range = selection.range;
    selectedLevelRangeMessage = `；已自动切换到${selection.label}以显示该区域`;
    for (const button of document.querySelectorAll("[data-bars]")) button.setAttribute("aria-pressed", String(Number(button.dataset.bars) === range));
    return true;
  }
  /**
   * Select one evidence zone, reveal it on the chart and move keyboard focus to the reversible action.
   * Input: a zone and its activating button; output: no return value.
   */
  function selectLevel(zone, trigger, moveFocus) {
    selectedLevelId = zone.id;
    selectedLevelTrigger = trigger;
    selectedLevelFocusPending = moveFocus;
    syncLevelSelection();
    if (revealLevelRange(zone)) renderChart();
    else renderSelectedLevelOverlay();
    byId("analysis-chart").scrollIntoView({ behavior: "smooth", block: "center" });
    const url = new URL(location.href);
    url.searchParams.set("level", zone.id);
    history.replaceState(null, "", url);
  }
  /** Focus and scroll to the selected card when the chart band is activated. */
  function focusSelectedLevelCard() {
    const selector = '[data-level-id="' + CSS.escape(selectedLevelId || "") + '"]';
    const card = document.querySelector(selector);
    const button = card?.querySelector("[data-level-select]");
    if (!button) return;
    button.focus({ preventScroll: true });
    card.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  /** Select the previous or next semantic key level, wrapping at either end. */
  function stepSelectedLevel(offset) {
    const zones = levelLogic.prioritize(current).primary;
    if (!zones.length) return;
    const currentIndex = zones.findIndex((zone) => zone.id === selectedLevelId);
    const nextIndex = (Math.max(currentIndex, 0) + offset + zones.length) % zones.length;
    const next = zones[nextIndex];
    const selector = '[data-level-id="' + CSS.escape(next.id) + '"] [data-level-select]';
    selectLevel(next, document.querySelector(selector), false);
  }
  /**
   * Build one accessible price-zone card without discarding its evidence or event status.
   * Input: one zone and report; output: an article element with a selectable summary and details.
   */
  function levelCard(zone, report) {
    const node = element("article", undefined, `level-card is-${zone.role}`);
    node.dataset.levelId = zone.id;
    node.dataset.selected = "false";
    const select = element("button", undefined, "level-select");
    select.type = "button";
    select.dataset.levelSelect = "true";
    select.setAttribute("aria-pressed", "false");
    select.setAttribute("aria-label", `在主图高亮${labelOf(zone.role)} ${numeric(zone.lower)} 到 ${numeric(zone.upper)}`);
    const title = element("span", undefined, "level-title");
    title.append(element("strong", `${labelOf(zone.role)} · ${levelImportance(zone, report)}`), element("strong", `${numeric(zone.lower)} — ${numeric(zone.upper)}`));
    select.append(title, element("span", "点击后在主图显示上下沿", "level-action"));
    select.addEventListener("click", (event) => selectLevel(zone, select, event.detail === 0));
    const distance = Number(zone.distance_fraction);
    const mapped = zone.unadjusted_reference;
    node.append(select, element("p", `${zone.id} · 距现价 ${Number.isFinite(distance) ? percent(distance) : "—"} · 历史触及 ${zone.touch_sessions} 日；触及次数不代表胜率。${mapped ? ` 同日不复权参考 ${numeric(mapped.lower)} — ${numeric(mapped.upper)}。` : ""}`, "level-reason"));
    const badges = element("div", undefined, "level-badges");
    const evidenceKinds = [...new Set((zone.evidence || []).map((row) => levelEvidenceLabels[row.kind] || row.kind))];
    badges.append(...evidenceKinds.slice(0, 4).map((value) => element("span", value, "level-badge")));
    node.append(badges);
    const details = element("details", undefined, "level-details");
    details.append(element("summary", "为什么形成这个区域？"));
    const list = element("ul");
    list.append(...(zone.evidence || []).map((row) => element("li", `${numeric(row.price)} · ${row.reason}（${row.start} — ${row.end}）`)));
    details.append(list);
    node.append(details);
    const events = (report.level_events || []).filter((row) => row.zone_id === zone.id);
    if (events.length) {
      node.append(element("p", events.map((event) => `${event.direction === "up" ? "突破" : "破位"}：${labelOf(event.status)}`).join(" · "), "level-event-summary"));
      const eventDetails = element("details", undefined, "level-details");
      eventDetails.append(element("summary", "查看突破与破位确认规则"));
      const eventList = element("ul");
      eventList.append(...events.map((event) => element("li", `${event.direction === "up" ? "突破" : "破位"} ${numeric(event.boundary)}：${labelOf(event.status)}${event.reentered ? "，已回到原区域" : ""}。${event.confirmation_rule} ${event.invalidation}`)));
      eventDetails.append(eventList);
      node.append(eventDetails);
    }
    return node;
  }
  function renderScenarios() {
    const horizon = Number(byId("analysis-horizon").value);
    byId("analysis-scenarios").replaceChildren(...(current.scenarios || []).filter((scenario) => scenario.horizon_sessions === horizon).map((scenario) => {
      const node = element("article", undefined, `scenario ${scenario.direction}`);
      node.append(element("h3", scenario.label), element("p", `${labelOf(scenario.status)} · 未来概率：未校准`));
      for (const [title, rows] of [["支持证据", scenario.drivers], ["反证", scenario.counterevidence], ["背景与限制", scenario.context_evidence]]) {
        const details = element("details");
        details.append(element("summary", `${title}（${rows.length}）`));
        const list = element("ul");
        list.append(...rows.map((row) => element("li", `${row.reason} [${row.evidence_refs.join(" / ")}]`)));
        details.append(list);
        node.append(details);
      }
      const conditions = element("dl");
      for (const [title, value] of [["触发条件", conditionText(scenario.trigger)], ["失效条件", conditionText(scenario.invalidation)]]) conditions.append(element("dt", title), element("dd", value));
      const history = scenario.historical_return_envelope;
      node.append(conditions, element("p", `历史${horizon}日收益：n=${history.sample_count}，中位数 ${percent(history.return_median)}，P10–P90 ${percent(history.return_p10)} — ${percent(history.return_p90)}。仅描述历史。`, "action"), element("p", `待核验维度：${scenario.unverified_dimensions.map(labelOf).join("、") || "无"}`, "muted"));
      return node;
    }));
  }
  function renderResearch(report) {
    const context = report.context;
    byId("analysis-context").replaceChildren(...[
      ["多周期趋势", labelOf(context.multi_scale_trend?.alignment)], ["波动状态", labelOf(context.volatility?.regime)], ["20日年化波动", percent(context.annualized_volatility20)], ["60日收盘最大回撤", percent(context.drawdown?.maximum_close_drawdown60)],
    ].map(([title, value]) => metric(title, value)));
    byId("analysis-diagnostics").replaceChildren(...(context.diagnostics || []).map((row) => element("li", row.reason)));
    const levels = levelLogic.prioritize(report);
    byId("analysis-more-levels").open = false;
    byId("analysis-level-summary").textContent = `默认显示 ${levels.primary.length} 个关键区域；点击卡片可在主图高亮价格带。完整保留 ${levels.primary.length + levels.secondary.length} 个历史区域。`;
    byId("analysis-level-method").textContent = `${report.price_levels.method || "历史不足"} 参考冻结日 ${report.price_levels.as_of || "—"}。${report.price_levels.warning || ""}`;
    byId("analysis-levels").replaceChildren(...levels.primary.map((zone) => levelCard(zone, report)));
    byId("analysis-secondary-levels").replaceChildren(...levels.secondary.map((zone) => levelCard(zone, report)));
    byId("analysis-more-levels-summary").textContent = `查看其余 ${levels.secondary.length} 个历史区域`;
    byId("analysis-more-levels").hidden = levels.secondary.length === 0;
    const deepLinkedLevel = pendingDeepLinkedLevelId;
    pendingDeepLinkedLevelId = null;
    if (deepLinkedLevel) {
      const zone = report.price_levels.zones.find((item) => item.id === deepLinkedLevel);
      if (zone) {
        if (levels.secondary.some((item) => item.id === zone.id)) byId("analysis-more-levels").open = true;
        const selector = '[data-level-id="' + CSS.escape(zone.id) + '"] [data-level-select]';
        window.setTimeout(() => selectLevel(zone, document.querySelector(selector), false), 0);
      }
    }
    const risk = report.risk_plan;
    byId("analysis-risk-status").textContent = `${labelOf(risk.status)}；全部为研究坐标，不可直接下单。${risk.blockers.map((value) => blockers[value] || value).join("；")}`;
    byId("analysis-risk").replaceChildren(...[
      ["假设入场参考", numeric(risk.entry_reference?.price)], ["结构止损参考", numeric(risk.stop_loss?.price)], ["止损距离", percent(risk.stop_loss?.distance_fraction)], ["最低收益风险比", numeric(risk.minimum_reward_risk)],
    ].map(([title, value]) => metric(title, value)));
    const riskDetails = [risk.entry_reference?.condition, risk.stop_loss?.reason,
      ...(risk.take_profit || []).map((row) => `止盈参考 ${numeric(row.price)} · 收益风险比 ${numeric(row.reward_risk)} · ${row.reason}`),
      ...(risk.reward_milestones || []).map((row) => `${row.risk_multiple}R 预算推演 ${numeric(row.price)}，不是已观测阻力。`),
      "本页不读取账户持仓，不推算移动止损或真实盈亏。",
      ...(risk.time_review || []).map((row) => `${row.after_trading_sessions}个交易日后复核：${row.condition}`), ...(risk.execution_limits || [])];
    byId("analysis-risk-details").replaceChildren(...riskDetails.filter(Boolean).map((value) => element("li", value)));
    byId("analysis-horizon").replaceChildren(...report.horizons.map((horizon) => {
      const option = element("option", `${horizon}个交易日`); option.value = String(horizon); return option;
    }));
    renderScenarios();
    byId("analysis-coverage").replaceChildren(...Object.entries(report.coverage).map(([dimension, status]) => metric(labelOf(dimension), labelOf(status))));
    byId("analysis-evidence").replaceChildren(...report.evidence.items.map((row) => {
      const node = element("article", undefined, "pattern");
      node.append(element("h3", `${labelOf(row.dimension)} · ${row.metric}`), element("p", `${row.value ?? "—"} ${row.unit} · ${labelOf(row.status)}`), element("p", `来源 ${row.source} · 数据时点 ${row.observed_at} · 可知时间 ${row.available_at || "未提供"} · 抓取 ${row.retrieved_at || "未提供"}`, "muted"));
      for (const finding of report.evidence.findings.filter((item) => item.evidence_ids.includes(row.evidence_id))) node.append(element("p", finding.reason));
      node.append(element("small", `证据 ${row.evidence_id} · 引用 ${row.reference || "未提供"} · 修订 ${row.revision || "未提供"}`));
      return node;
    }));
    byId("analysis-evidence-excluded").textContent = `未来或不可见证据已排除 ${(report.evidence.excluded || []).length} 条。${report.evidence.items.length ? "" : "未提供可追溯外部证据，不以技术指标代替基本面或资金事实。"}`;
    byId("analysis-watchlist").replaceChildren(...report.watchlist.map((row) => element("li", `${row.dimension ? labelOf(row.dimension) + " · " : ""}${row.event_date || row.zone_id || (blockers[row.blocker] || row.blocker) || ""} ${row.price !== undefined ? numeric(row.price) : ""} ${row.status ? labelOf(row.status) + " · " : ""}${row.action}${row.metrics?.length ? " 缺口：" + row.metrics.join("、") : ""}`)));
  }
  function render(report) {
    if (report.status === "invalid") throw new Error((report.warnings || ["数据无效"]).join("；"));
    if (report.contract_schema !== "stock-research-result/v2") throw new Error("研究数据版本不受支持；历史 run 已废弃，请生成新报告。");
    current = report;
    selectedLevelId = null;
    selectedLevelTrigger = null;
    selectedLevelFocusPending = false;
    selectedLevelRangeMessage = "";
    selectedLevelVisible = true;
    removeAnalysisLevelOverlays();
    byId("analysis-chart-level").hidden = true;
    const coordinateMapping = report.price_levels?.price_coordinate_mapping;
    byId("analysis-price-basis-note").textContent = coordinateMapping?.status === "available"
      ? `前复权研究坐标；同日不复权参考按 ${coordinateMapping.observation_date}、${coordinateMapping.source}、比例 ${numeric(coordinateMapping.ratio, 6)} 换算。`
      : report.price_levels?.coordinate_note || "全部价位均为前复权研究坐标；未提供可靠映射时不换算为券商下单价。";
    const technical = report.technical;
    byId("analysis-result").hidden = false;
    byId("analysis-name").textContent = `${report.name || report.code} · ${report.code}`;
    byId("analysis-source").textContent = `行情截至 ${report.as_of || "未知"} · 分析截止 ${report.requested_as_of || "未知"} · ${report.source || "未知来源"} · ${technical.bar_count || 0}根 · 前复权 · ${report.method_version}`;
    byId("analysis-price").textContent = `${numeric(technical.indicators?.close)} 元（前复权）`;
    byId("analysis-warnings").replaceChildren(...(report.warnings || []).map((warning) => element("li", warning)));
    byId("analysis-disclaimer").textContent = report.disclaimer || "数据不足，暂不输出情景分析。";
    renderChart();
    const metrics = [["MA5", "ma5"], ["MA20", "ma20"], ["MA60", "ma60"], ["RSI14", "rsi14"], ["MACD柱（DIF−DEA）", "macd_histogram"], ["ATR14", "atr14"], ["量比 / 前20日均量", "volume_ratio20"], ["20日收益", "return_20d"]];
    byId("analysis-indicators").replaceChildren(...metrics.map(([label, key]) => {
      const node = element("div", undefined, "metric");
      node.append(element("span", label), element("strong", key === "return_20d" ? percent(technical.indicators?.[key]) : numeric(technical.indicators?.[key])));
      return node;
    }));
    byId("analysis-patterns").replaceChildren(...(technical.patterns || []).map((pattern) => {
      const node = element("article", undefined, "pattern");
      node.append(element("h3", pattern.name), element("p", pattern.reason));
      return node;
    }));
    renderResearch(report);
    const analogs = technical.analogs;
    byId("analysis-method").textContent = analogs?.method || "历史数据不足，不生成相似样本统计。";
    byId("analysis-sample-warning").textContent = analogs ? `${analogs.samples.length}个非重叠样本 / ${analogs.candidate_count}个可检索窗口。${analogs.status === "limited" ? "样本不足8个，证据很弱。" : ""}${analogs.warning}` : "无历史参照";
    byId("analysis-statistics").replaceChildren(...(analogs?.statistics || []).map((stat) => {
      const node = element("article", undefined, "stat");
      node.append(element("h3", `${stat.horizon}个交易日后 · n=${stat.count}`), element("p", `中位数 ${percent(stat.median)}`), element("p", `P10–P90 ${percent(stat.p10)} — ${percent(stat.p90)}`), element("p", `历史上涨 ${percent(stat.up_fraction)} / 震荡 ${percent(stat.range_fraction)} / 下跌 ${percent(stat.down_fraction)}`));
      return node;
    }));
    byId("analysis-analogs").replaceChildren(...(analogs?.samples || []).map((sample) => {
      const node = element("article", undefined, "analog");
      node.append(element("h3", `${sample.start} — ${sample.end}`), plotAnalog([{ values: sample.path.map((value) => value * 100), color: "#c09139" }, { values: analogs.current_path.map((value) => value * 100), color: "#276f9b" }], { divider: 19 }), element("p", "蓝：当前20日 / 金：历史20日及之后20日 · 纵轴为累计变化百分数 · 虚线后仅为历史后验", "legend"), element("p", `5日 ${percent(sample.returns["5"])} · 10日 ${percent(sample.returns["10"])} · 20日 ${percent(sample.returns["20"])}`), element("small", `距离 ${numeric(sample.distance, 4)} · 后验截至 ${sample.outcome_end}`));
      return node;
    }));
  }
  async function analyze(value) {
    const sequence = ++requestSequence;
    const status = byId("analysis-status");
    status.dataset.error = "false";
    byId("analysis-result").hidden = true;
    try {
      const code = codeOf(value);
      byId("analysis-code").value = code;
      status.textContent = `正在分析 ${code}…`;
      let report = reports[code];
      if (!report && payload.api_enabled && location.protocol !== "file:") {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        try {
          const response = await fetch(`/api/stock-analysis?code=${encodeURIComponent(code)}`, { signal: controller.signal });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "行情加载失败");
          report = data;
          reports[code] = report;
        } finally { clearTimeout(timeout); }
      }
      if (!report) throw new Error("本次快照没有该股票。请启动本地服务：uv run --frozen python -m scripts.stock_analysis --serve --live；或用 --code 代码 --csv 前复权CSV 生成独立页面。");
      if (sequence !== requestSequence) return;
      if (current?.code && current.code !== code) {
        const switchedUrl = new URL(location.href);
        switchedUrl.searchParams.delete("level");
        history.replaceState(null, "", switchedUrl);
      }
      render(report);
      status.textContent = report.status === "partial" ? "研究完成；资料部分覆盖，以下为条件情景，不是买卖指令。" : report.status === "stale" ? "研究完成，但行情陈旧，价位确认与风险计划不可用。" : "历史数据不足，不输出走势情景。";
      const url = new URL(location.href);
      url.searchParams.set("code", code);
      history.replaceState(null, "", url);
    } catch (error) {
      if (sequence !== requestSequence) return;
      status.dataset.error = "true";
      status.textContent = error.name === "AbortError" ? "行情请求超时，请稍后重试。" : error.message;
    }
  }
  for (const choice of payload.choices || []) {
    const option = element("option", `${choice.group || "股票"} · ${choice.name || choice.code} · ${choice.code}`);
    option.value = choice.code;
    byId("analysis-choice").append(option);
  }
  byId("analysis-form").addEventListener("submit", (event) => { event.preventDefault(); analyze(byId("analysis-code").value); });
  byId("analysis-horizon").addEventListener("change", () => { if (current) renderScenarios(); });
  byId("analysis-choice").addEventListener("change", (event) => { if (event.target.value) analyze(event.target.value); });
  byId("analysis-chart-level-clear").addEventListener("click", () => {
    const trigger = selectedLevelTrigger;
    selectedLevelId = null;
    selectedLevelTrigger = null;
    selectedLevelRangeMessage = "";
    selectedLevelVisible = true;
    removeAnalysisLevelOverlays();
    syncLevelSelection();
    byId("analysis-chart-level").hidden = true;
    const url = new URL(location.href);
    url.searchParams.delete("level");
    history.replaceState(null, "", url);
    if (trigger?.isConnected) { trigger.focus({ preventScroll: true }); trigger.scrollIntoView({ behavior: "smooth", block: "center" }); }
  });
  byId("analysis-level-previous").addEventListener("click", () => stepSelectedLevel(-1));
  byId("analysis-level-next").addEventListener("click", () => stepSelectedLevel(1));
  byId("analysis-price-band").addEventListener("click", focusSelectedLevelCard);
  byId("analysis-price-band").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusSelectedLevelCard(); }
    if (event.key === "ArrowLeft") { event.preventDefault(); stepSelectedLevel(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); stepSelectedLevel(1); }
  });
  for (const button of document.querySelectorAll("[data-bars]")) button.addEventListener("click", () => {
    range = Number(button.dataset.bars);
    for (const sibling of document.querySelectorAll("[data-bars]")) sibling.setAttribute("aria-pressed", String(sibling === button));
    if (current) renderChart();
  });
  window.addEventListener("resize", () => {
    if (!analysisChart || !current) return;
    analysisChart.resize();
    const bars = current.technical?.bars || [];
    fitAnalysisRange(analysisChart, klineBars(range ? bars.slice(-range) : bars));
    window.requestAnimationFrame(refreshAnalysisPriceBand);
  });
  if (!payload.has_dashboard) {
    document.querySelector("header nav").hidden = true;
    document.querySelector(".brand").href = "stock-analysis.html";
  }
  const mobileViewport = window.matchMedia("(max-width: 650px)");
  /** Collapse long historical/evidence sections only on mobile while preserving desktop content. */
  function applyAnalysisResponsiveDisclosure() {
    for (const section of document.querySelectorAll(".mobile-collapsible")) section.open = !mobileViewport.matches;
  }
  applyAnalysisResponsiveDisclosure();
  mobileViewport.addEventListener?.("change", applyAnalysisResponsiveDisclosure);
  for (const link of document.querySelectorAll(".analysis-section-nav a")) link.addEventListener("click", () => {
    const target = document.querySelector(link.getAttribute("href"));
    if (target?.matches("details")) target.open = true;
  });
  const initial = new URLSearchParams(location.search).get("code");
  if (initial) analyze(initial);
})();
