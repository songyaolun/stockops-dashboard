// 独立板块研究页：只消费冻结 page payload，所有板块公式复用 board-research.js。
(function () {
  "use strict";

  const pageData = window.__STOCKOPS_BOARD_RESEARCH__ || {};
  const navigation = pageData.navigation || {};
  const boardResearchPayload = pageData.board_research || {};
  const boardLib = window.StockOpsBoardResearch || null;
  const formatPercent = window.StockOpsFormat.percent;
  const boardResearchSnapshot = boardLib
    && boardLib.isSnapshot(boardResearchPayload.snapshot)
    ? boardResearchPayload.snapshot
    : null;
  const query = new URLSearchParams(window.location.search);
  const queryClassification = ["ths", "sw_l1", "sw_l2"].includes(
    query.get("boardClassification")
  ) ? query.get("boardClassification") : "ths";
  const queryWindow = ["20d", "60d"].includes(query.get("boardWindow"))
    ? query.get("boardWindow")
    : "20d";
  const querySort = (boardLib?.SORTS || []).some(
    (item) => item.id === query.get("boardSort")
  ) ? query.get("boardSort") : "macd_regime";
  const boardSelectedCode = String(query.get("boardSelected") || "");
  const boardRadarState = {
    completeness: "all",
    taxonomy: "all",
    window: queryWindow,
    search: "",
    selectedKey: null,
    mobileView: "list",
    listScrollTop: 0,
    classification: queryClassification,
    sort: querySort,
    view: query.get("boardView") === "heatmap" ? "heatmap" : "list",
    flowSource: "net_inflow",
    heatmapMetric: null,
    expandedParents: new Set(),
    revealSelected: false,
  };

  /**
   * 用一组新节点替换容器内容。
   * 输入示例：容器与两个 span；输出：容器只包含这两个 span。
   */
  function replaceChildrenCompat(element, children) {
    while (element.firstChild) element.removeChild(element.firstChild);
    for (const child of children || []) element.appendChild(child);
  }

  function formatBoardMoney(value) {
    const numeric = boardNumber(value);
    if (numeric === null) return "—";
    const absolute = Math.abs(numeric);
    const sign = numeric > 0 ? "+" : numeric < 0 ? "-" : "";
    if (absolute >= 1e12) return `${sign}${(absolute / 1e12).toFixed(2)}万亿`;
    if (absolute >= 1e8) return `${sign}${(absolute / 1e8).toFixed(2)}亿`;
    if (absolute >= 1e4) return `${sign}${(absolute / 1e4).toFixed(0)}万`;
    return `${sign}${absolute.toFixed(0)}元`;
  }

  function boardSourceLabel(source) {
    return {
      akshare_ths: "同花顺",
      akshare_eastmoney: "东方财富",
      board_cache: "本地快照",
      unknown: "未知来源",
    }[source] || source;
  }

  function boardNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  /** Format an unsigned board turnover amount; e.g. 12600000000 -> "126.00亿". */
  function formatBoardAmount(value) {
    const numeric = boardNumber(value);
    if (numeric === null) return "—";
    const absolute = Math.abs(numeric);
    if (absolute >= 1e12) return `${(absolute / 1e12).toFixed(2)}万亿`;
    if (absolute >= 1e8) return `${(absolute / 1e8).toFixed(2)}亿`;
    if (absolute >= 1e4) return `${(absolute / 1e4).toFixed(0)}万`;
    return `${absolute.toFixed(0)}元`;
  }

  /** Format one optional turnover ratio; e.g. 0.84 -> "0.84×". */
  function formatBoardRatio(value) {
    const numeric = boardNumber(value);
    return numeric === null ? "—" : `${numeric.toFixed(2)}×`;
  }

  /** Return a deterministic selection key; e.g. an industry named 半导体 -> "industry:半导体". */
  function boardRowKey(item) {
    return boardLib ? boardLib.rowKey(item) : `${item.taxonomy}:${item.name}`;
  }

  /** Selected radar window in trading sessions; e.g. "60d" -> 60. */
  function boardWindowSessionCount() {
    return boardRadarState.window === "60d" ? 60 : 20;
  }

  /** Human label of the selected window; e.g. "20d" -> "20 日". */
  function boardWindowLabel() {
    return boardRadarState.window === "60d" ? "60 日" : "20 日";
  }

  /** Whether the frozen board-research snapshot drives this render. */
  function boardResearchActive() {
    return Boolean(boardLib && boardResearchSnapshot);
  }

  /** Rows of one frozen classification; missing snapshots return no rows. */
  function boardRows() {
    return boardResearchActive()
      ? boardLib.classificationRows(
        boardResearchSnapshot,
        boardRadarState.classification
      )
      : [];
  }

  /** Timeline points preserved on one frozen row. */
  function boardRowPoints(item) {
    return Array.isArray(item.points) ? item.points : [];
  }

  /** Fund series field for the timeline lower track. */
  function boardFlowField() {
    return boardRadarState.flowSource === "verified_main_net_inflow"
      ? "verified_main_net_inflow"
      : "net_inflow";
  }

  /** Explicit lower-track label for the selected frozen field. */
  function boardFlowLabel() {
    return boardFlowField() === "verified_main_net_inflow" ? "主力净流入" : "净流入";
  }

  /** Frozen period record of the selected row and window, or null. */
  function boardPeriod(item) {
    if (!boardResearchActive()) return null;
    return boardLib.period(item, boardRadarState.window);
  }

  /** Sort metric value of one row; missing stays null and sorts last. */
  function boardSortValue(item) {
    if (!boardLib) return null;
    if (boardRadarState.sort === "macd_regime") {
      return boardLib.macdRegime(item)?.priority ?? null;
    }
    if (boardRadarState.sort === "trading_crowding") {
      // Only the backend's trade_date-truncated advanced value ranks rows;
      // the raw matrix tail may hold sessions beyond the trade date.
      return boardResearchActive() ? boardLib.rowCrowdingValue(item) : null;
    }
    return boardLib.periodFieldValue(
      item,
      boardRadarState.window,
      boardRadarState.sort
    );
  }

  /** Sort-metric column label; the list always shows the metric it is ordered by. */
  function boardSortLabel() {
    const sort = (boardLib ? boardLib.SORTS : []).find(
      (item) => item.id === boardRadarState.sort
    );
    return sort ? sort.label : boardRadarState.sort;
  }

  /** Format a sort-metric value by its unit family; missing renders as an em dash. */
  function formatBoardSortValue(value, item) {
    if (boardRadarState.sort === "macd_regime") {
      const regime = boardLib ? boardLib.macdRegime(item) : null;
      return regime ? regime.label : "—";
    }
    const numeric = boardNumber(value);
    if (numeric === null) return "—";
    if (
      boardRadarState.sort === "net_inflow"
      || boardRadarState.sort === "verified_main_net_inflow"
    ) {
      return formatBoardMoney(numeric);
    }
    if (boardRadarState.sort === "trading_crowding") {
      return formatPercent(numeric * 100);
    }
    return formatPercent(numeric);
  }

  /** Filter the board list with the current UI state; output preserves sort order. */
  function visibleBoardRows(rows) {
    const query = boardRadarState.search.trim().toLocaleLowerCase("zh-CN");
    return rows.filter((item) => {
      if (
        boardRadarState.taxonomy !== "all"
        && (!boardResearchActive() || boardRadarState.classification === "ths")
        && item.taxonomy !== boardRadarState.taxonomy
      ) return false;
      if (boardRadarState.completeness !== "all" && boardDetailStatus(item) !== boardRadarState.completeness) return false;
      if (!query) return true;
      const name = String(item.name || "").toLocaleLowerCase("zh-CN");
      const code = String(item.code || "").toLocaleLowerCase("zh-CN");
      return name.includes(query) || code.includes(query);
    });
  }

  /** Normalize detail completeness from one frozen period record. */
  function boardDetailStatus(item) {
    const record = boardPeriod(item);
    return record && boardLib.finiteNumber(record.return_pct) !== null
      ? "complete"
      : "market_only";
  }

  /** Select the requested common date window from the frozen snapshot. */
  function boardVisibleDates() {
    if (!boardResearchActive()) return [];
    const windows = boardResearchSnapshot.windows;
    const perClassification = windows && typeof windows === "object"
      ? windows[boardRadarState.classification]
      : null;
    const projected = perClassification && typeof perClassification === "object"
      ? perClassification[boardRadarState.window]
      : null;
    if (Array.isArray(projected)) return projected.map(String);
    // Presentation fallback only: derive the axis from row points; period
    // numbers still come exclusively from the backend period records.
    const dates = new Set();
    for (const row of boardRows()) {
      for (const point of boardRowPoints(row)) {
        if (point && point.date) dates.add(String(point.date));
      }
    }
    return [...dates].sort().slice(-boardWindowSessionCount());
  }

  /** Describe a board with the backend period logic; the page never derives a rule of its own. */
  function boardLogic(item) {
    const record = boardPeriod(item);
    if (!record) {
      return {
        key: "no_period",
        label: "无周期数据",
        className: "is-missing",
        reason: "window",
      };
    }
    const logic = record.logic && typeof record.logic === "object"
      ? record.logic
      : null;
    if (!logic || !logic.label) {
      return {
        key: "no_period",
        label: "周期逻辑缺失",
        className: "is-missing",
        reason: "logic",
      };
    }
    const classByLabel = {
      同向走强: "is-positive",
      价强资弱: "is-warning",
      价弱资强: "is-warning",
      同步走弱: "is-negative",
      分化整理: "is-neutral",
    };
    return {
      key: String(logic.key || "unknown"),
      label: String(logic.label),
      className: classByLabel[String(logic.label)] || "is-neutral",
      basis: String(logic.basis || "net_inflow"),
    };
  }

  /** Present one backend MACD regime with stable labels and visual priority. */
  function boardMacdState(item) {
    const regime = boardLib ? boardLib.macdRegime(item) : null;
    const classById = {
      medium_bullish_short_bullish: "is-positive",
      medium_bullish_short_pullback: "is-warning",
      medium_bearish_short_rebound: "is-neutral",
      medium_bearish_short_bearish: "is-negative",
    };
    if (!regime) {
      const quality = item && item.macd && typeof item.macd.quality === "object"
        ? item.macd.quality
        : null;
      return {
        id: null,
        label: "MACD 待补数",
        className: "is-missing",
        dif: null,
        histogram: null,
        reason: String(quality?.reason || "MACD 数据不可用"),
      };
    }
    return {
      ...regime,
      className: classById[regime.id] || "is-neutral",
      reason: "",
    };
  }

  /** Format one normalized-index MACD value with an explicit sign. */
  function formatBoardMacdValue(value) {
    const numeric = boardNumber(value);
    if (numeric === null) return "—";
    return `${numeric > 0 ? "+" : ""}${numeric.toFixed(4)}`;
  }

  /** Explain one backend MACD state without recalculating its classification. */
  function boardMacdEvidence(state) {
    if (!state.id) return state.reason;
    return `${state.description} · DIF ${formatBoardMacdValue(state.dif)} · 柱（DIF−DEA） ${formatBoardMacdValue(state.histogram)}`;
  }

  /** Map one optional return to its A-share color class; positive is red and negative is green. */
  function boardChangeClass(value) {
    const numeric = boardNumber(value);
    return numeric === null ? "is-missing" : numeric > 0 ? "is-positive" : numeric < 0 ? "is-negative" : "is-flat";
  }

  /** Taxonomy chip text per row source: THS 概念 or SW level label. */
  function boardTaxonomyTag(item) {
    if (item.classification === "sw_l1") return "申万一级行业";
    if (item.classification === "sw_l2") {
      return item.parent && item.parent.name ? `${item.parent.name} · 二级` : "申万二级行业";
    }
    return item.taxonomy === "industry" ? "行业" : "概念";
  }

  /** Rows of one classification keyed by id; used to resolve the Shenwan tree links. */
  function boardRowsById(classification) {
    if (!boardResearchActive()) return new Map();
    return new Map(
      boardLib.classificationRows(boardResearchSnapshot, classification).map((row) => [row.id, row])
    );
  }

  /** Children of one Shenwan L1 row, ordered by the selected window's return (backend rank). */
  function boardOrderedChildren(item, rowsById) {
    const windowKey = boardRadarState.window;
    const rankOf = (row) => (
      row.sibling_rank && row.sibling_rank[windowKey] ? row.sibling_rank[windowKey].rank : null
    );
    return (Array.isArray(item.children) ? item.children : [])
      .map((link) => rowsById.get(link.id))
      .filter(Boolean)
      .sort((left, right) => {
        const leftRank = rankOf(left);
        const rightRank = rankOf(right);
        if (leftRank === null && rightRank === null) return String(left.code).localeCompare(String(right.code));
        if (leftRank === null) return 1;
        if (rightRank === null) return -1;
        return leftRank - rightRank;
      });
  }

  /** Switch to another classification and select one row, keeping window, sort and flow source. */
  function boardJumpToRow(classification, row) {
    boardRadarState.classification = classification;
    boardRadarState.selectedKey = boardRowKey(row);
    boardRadarState.listScrollTop = 0;
    boardRadarState.revealSelected = true;
    if (window.matchMedia("(max-width: 760px)").matches) boardRadarState.mobileView = "detail";
    const select = document.querySelector("#board-classification-select");
    if (select) select.value = classification;
    renderBoardMarket();
  }

  /** One list row: identity (tree toggle or parent tag), three changes, optional sort value, trend. */
  function createBoardRadarRow(item, options) {
    const key = boardRowKey(item);
    const isCompactSort = options.isCompactSort;
    const selected = key === boardRadarState.selectedKey && !options.isChild;
    const macdState = boardMacdState(item);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `board-radar-row${selected ? " is-selected" : ""}${isCompactSort ? " is-single-metric" : ""}${options.isChild ? " is-child" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(selected));
    const identity = document.createElement("span");
    identity.className = "board-radar-identity";
    if (options.hasChildren) {
      const expanded = boardRadarState.expandedParents.has(item.id);
      const toggle = document.createElement("span");
      toggle.className = "board-tree-toggle";
      toggle.setAttribute("role", "button");
      toggle.setAttribute("tabindex", "0");
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.setAttribute("aria-label", `${expanded ? "收起" : "展开"}${item.name}的下属二级`);
      toggle.textContent = expanded ? "▾" : "▸";
      const flip = (event) => {
        event.stopPropagation();
        if (boardRadarState.expandedParents.has(item.id)) boardRadarState.expandedParents.delete(item.id);
        else boardRadarState.expandedParents.add(item.id);
        boardRadarState.listScrollTop = options.container.scrollTop;
        renderBoardMarket();
      };
      toggle.addEventListener("click", flip);
      toggle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          flip(event);
        }
      });
      identity.appendChild(toggle);
    }
    const name = document.createElement("strong");
    name.textContent = String(item.name || "—");
    const taxonomy = document.createElement("small");
    taxonomy.className = `is-${item.taxonomy === "industry" ? "industry" : "concept"}`;
    taxonomy.textContent = options.isChild ? "二级" : boardTaxonomyTag(item);
    identity.append(name, taxonomy);
    const latestChange = boardResearchActive()
      ? boardLib.latestPoint(item, "pct_chg").value
      : boardNumber(item.pct_chg_1d);
    const periodRecord = boardPeriod(item);
    const periodReturn = periodRecord
      ? boardLib.finiteNumber(periodRecord.return_pct)
      : null;
    const values = [latestChange, item.pct_chg_5d, periodReturn].map((value) => {
      const span = document.createElement("span");
      span.className = boardChangeClass(value);
      span.textContent = formatPercent(value);
      return span;
    });
    button.append(identity, ...values);
    if (!isCompactSort) {
      const sortValue = document.createElement("span");
      sortValue.className = "board-radar-sort-value";
      sortValue.textContent = formatBoardSortValue(boardSortValue(item), item);
      button.appendChild(sortValue);
    }
    const status = document.createElement("span");
    status.className = `board-radar-status ${macdState.className}`;
    status.textContent = macdState.id ? macdState.label : "—";
    status.title = boardMacdEvidence(macdState);
    button.append(status);
    button.addEventListener("click", options.onSelect);
    return button;
  }

  /** Build the selectable list; the fourth column is the metric the list is sorted by. */
  function renderBoardList(rows) {
    const container = document.querySelector("#board-radar-list");
    replaceChildrenCompat(container);
    document.querySelector("#board-visible-count").textContent = `${rows.length} 个板块`;
    const isPeriodSort = boardRadarState.sort === "return_pct";
    const isMacdSort = boardRadarState.sort === "macd_regime";
    const isCompactSort = isPeriodSort || isMacdSort;
    const windowLabel = boardWindowLabel();
    const periodColumn = document.querySelector("#board-period-column");
    if (periodColumn) {
      periodColumn.textContent = `${windowLabel}涨幅${isPeriodSort ? " ↓" : ""}`;
      periodColumn.title = `列表按${windowLabel}周期涨幅降序排序（后端复合），缺失排在末尾`;
    }
    const sortColumn = document.querySelector("#board-sort-column");
    if (sortColumn) {
      sortColumn.hidden = isCompactSort;
      sortColumn.textContent = `${windowLabel}${boardSortLabel()} ↓`;
      sortColumn.title = `列表按${windowLabel}${boardSortLabel()}降序排序，缺失排在末尾`;
    }
    const listPanel = document.querySelector("#board-radar-list-panel");
    if (listPanel) {
      listPanel.classList.toggle("is-single-metric", isCompactSort);
    }
    const regimeColumn = document.querySelector("#board-regime-column");
    if (regimeColumn) {
      regimeColumn.textContent = `多空${isMacdSort ? " ↓" : ""}`;
      regimeColumn.title = "按中短期多空趋势从强到弱排序，缺失排在末尾";
    }
    const conceptCount = rows.filter((item) => item.taxonomy === "concept").length;
    document.querySelector("#board-taxonomy-summary").textContent =
      boardResearchActive()
        ? `${boardLib.classificationLabel(boardRadarState.classification)} ${rows.length}`
        : `概念 ${conceptCount}`;
    const childRows = boardRowsById("sw_l2");
    for (const item of rows) {
      const key = boardRowKey(item);
      container.appendChild(createBoardRadarRow(item, {
        isCompactSort,
        container,
        onSelect: () => {
          boardRadarState.listScrollTop = container.scrollTop;
          boardRadarState.selectedKey = key;
          if (window.matchMedia("(max-width: 760px)").matches) boardRadarState.mobileView = "detail";
          renderBoardMarket();
        },
        hasChildren: Array.isArray(item.children) && item.children.length > 0,
      }));
      if (
        Array.isArray(item.children)
        && item.children.length
        && boardRadarState.expandedParents.has(item.id)
      ) {
        for (const child of boardOrderedChildren(item, childRows)) {
          container.appendChild(createBoardRadarRow(child, {
            isCompactSort,
            container,
            isChild: true,
            onSelect: () => boardJumpToRow("sw_l2", child),
          }));
        }
      }
    }
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "board-empty";
      empty.textContent = "没有符合当前筛选条件的板块。";
      container.appendChild(empty);
    }
    container.scrollTop = boardRadarState.listScrollTop;
    if (boardRadarState.revealSelected) {
      // After a tree jump the selected row may sit far down the list: centre it.
      boardRadarState.revealSelected = false;
      const selectedRow = container.querySelector(".board-radar-row.is-selected");
      if (selectedRow) {
        container.scrollTop = Math.max(0, selectedRow.offsetTop - container.clientHeight / 2);
        // Long lists render rows lazily, so their heights shift while scrolling:
        // keep correcting for a few frames until the row sits at the list centre.
        const centre = (attempt) => {
          const rowBox = selectedRow.getBoundingClientRect();
          const listBox = container.getBoundingClientRect();
          const offset = (rowBox.top + rowBox.height / 2) - (listBox.top + listBox.height / 2);
          if (Math.abs(offset) < 4 || attempt >= 5) {
            boardRadarState.listScrollTop = container.scrollTop;
            return;
          }
          container.scrollTop += offset;
          window.requestAnimationFrame(() => centre(attempt + 1));
        };
        window.requestAnimationFrame(() => centre(0));
      }
    }
  }

  /** Render the common date ticks and the scale legend; input dates align exactly with every timeline row. */
  function renderBoardTimelineAxis(dates, changeScale, flowScale) {
    const axis = document.querySelector("#board-timeline-axis");
    replaceChildrenCompat(axis);
    axis.style.setProperty("--board-day-count", String(Math.max(dates.length, 1)));
    const spacer = document.createElement("span");
    spacer.className = "board-timeline-axis-label";
    const changeLegend = document.createElement("span");
    changeLegend.textContent = changeScale ? `涨跌 ±${changeScale.limit.toFixed(1)}%` : "涨跌";
    const flowLegend = document.createElement("span");
    flowLegend.textContent = flowScale
      ? `${boardFlowLabel()} ±${formatBoardAmount(flowScale.limit)}`
      : boardFlowLabel();
    spacer.append(changeLegend, flowLegend);
    const clipped = (changeScale ? changeScale.clipped : 0) + (flowScale ? flowScale.clipped : 0);
    spacer.title = [
      "上方柱：每日涨跌（红涨绿跌）；下方柱：每日资金（红流入绿流出），满格即图例数值。",
      clipped ? `有 ${clipped} 个数据超出满格，已画到满格；悬停可读真实值。` : "",
    ].filter(Boolean).join(" ");
    const ticks = document.createElement("span");
    ticks.className = "board-timeline-axis-dates";
    ticks.style.setProperty("--board-day-count", String(Math.max(dates.length, 1)));
    const interval = Math.max(1, Math.ceil(dates.length / 5));
    dates.forEach((date, index) => {
      const tick = document.createElement("small");
      tick.textContent = index % interval === 0 || index === dates.length - 1 ? date.slice(5) : "";
      ticks.appendChild(tick);
    });
    axis.append(spacer, ticks);
  }

  /** Render daily change bars plus signed fund bars for visible rows; missing dates remain empty cells. */
  function renderBoardTimeline(rows) {
    const dates = boardVisibleDates();
    const container = document.querySelector("#board-timeline");
    replaceChildrenCompat(container);
    document.querySelector("#board-timeline-summary").textContent = dates.length
      ? `${dates[0]} 至 ${dates[dates.length - 1]} · ${dates.length} 日`
      : "等待历史数据";
    const dateSet = new Set(dates);
    const flowField = boardFlowField();
    const visibleSeries = rows.map((item) => ({ item, points: boardRowPoints(item) }));
    const visiblePoints = visibleSeries.flatMap(({ points }) => (
      Array.isArray(points) ? points.filter((point) => dateSet.has(String(point.date))) : []
    ));
    // Full scale is the 95th percentile, so one extreme day cannot flatten every other bar.
    const changeScale = boardLib.robustScale(visiblePoints.map((point) => point.pct_chg), 1);
    const flowScale = boardLib.robustScale(visiblePoints.map((point) => point[flowField]), 1);
    renderBoardTimelineAxis(dates, changeScale, flowScale);
    const barHeight = (value, limit) => (
      `${Math.max(value === 0 ? 1 : 6, Math.min(1, Math.abs(value) / limit) * 46)}%`
    );
    for (const { item, points } of visibleSeries.slice(0, 12)) {
      const row = document.createElement("div");
      row.className = `board-timeline-row ${boardRowKey(item) === boardRadarState.selectedKey ? "is-selected" : ""}`;
      const label = document.createElement("button");
      label.type = "button";
      label.className = "board-timeline-label";
      const nameText = document.createElement("span");
      nameText.textContent = String(item.name || "—");
      const summary = document.createElement("small");
      const latestPoint = boardLib.latestPoint(item, "pct_chg");
      const periodRecord = boardPeriod(item);
      const periodFlow = periodRecord ? boardNumber(periodRecord[flowField]) : null;
      summary.textContent = [
        latestPoint.value === null ? "涨跌 —" : `昨日 ${formatPercent(latestPoint.value)}`,
        `${boardWindowLabel()}${boardFlowLabel()} ${formatBoardMoney(periodFlow)}`,
      ].join(" · ");
      label.append(nameText, summary);
      label.addEventListener("click", () => {
        boardRadarState.selectedKey = boardRowKey(item);
        renderBoardMarket();
      });
      const track = document.createElement("div");
      track.className = "board-timeline-track";
      track.style.setProperty("--board-day-count", String(Math.max(dates.length, 1)));
      const pointByDate = new Map(
        (Array.isArray(points) ? points : []).map((point) => [String(point.date), point])
      );
      for (const date of dates) {
        const point = pointByDate.get(date);
        const change = point ? boardNumber(point.pct_chg) : null;
        const flow = point ? boardNumber(point[flowField]) : null;
        const cell = document.createElement("span");
        cell.className = `board-timeline-cell ${!point ? "is-missing" : ""}`;
        cell.title = point
          ? `${date} · 涨跌 ${formatPercent(change)} · ${boardFlowLabel()} ${formatBoardMoney(flow)}`
          : `${date} · 缺失`;
        const priceTrack = document.createElement("span");
        priceTrack.className = "board-price-track";
        if (change !== null) {
          const bar = document.createElement("i");
          bar.className = boardChangeClass(change);
          bar.style.height = barHeight(change, changeScale.limit);
          priceTrack.appendChild(bar);
        }
        const fundTrack = document.createElement("span");
        fundTrack.className = "board-fund-track";
        if (flow !== null) {
          const bar = document.createElement("i");
          bar.className = flow >= 0 ? "is-positive" : "is-negative";
          bar.style.height = barHeight(flow, flowScale.limit);
          fundTrack.appendChild(bar);
        }
        cell.append(priceTrack, fundTrack);
        track.appendChild(cell);
      }
      row.append(label, track);
      container.appendChild(row);
    }
    if (!rows.length || !dates.length) {
      const empty = document.createElement("p");
      empty.className = "board-empty";
      empty.textContent = rows.length ? "历史日快照尚未形成统一时间轴。" : "当前筛选没有可绘制板块。";
      container.appendChild(empty);
    }
  }

  /** Create one label/value fact for the selected detail; input strings render as a two-column row. */
  function createBoardDetailFact(labelText, valueText) {
    const row = document.createElement("div");
    row.className = "board-detail-fact";
    const label = document.createElement("span");
    label.textContent = labelText;
    const value = document.createElement("strong");
    value.textContent = valueText;
    row.append(label, value);
    return row;
  }

  /**
   * Build the selected board's two daily sub-charts (change and fund) from raw
   * snapshot points, each with a zero line, ticks and a shared readout. Any
   * cumulative or window figure comes from the backend period record, never
   * from a frontend formula.
   */
  function renderBoardDetailChart(item) {
    const dates = boardVisibleDates();
    const dateSet = new Set(dates);
    const flowField = boardFlowField();
    const pointByDate = new Map(
      boardRowPoints(item)
        .filter((point) => dateSet.has(String(point.date)))
        .map((point) => [String(point.date), point])
    );
    const wrapper = document.createElement("section");
    wrapper.className = "board-detail-chart";
    wrapper.dataset.pointCount = String(pointByDate.size);
    const heading = document.createElement("small");
    heading.textContent = `每日涨跌与${boardFlowLabel()} · ${dates.length} 日（红涨/流入，绿跌/流出）`;
    const valueOf = (date, field) => boardNumber(
      pointByDate.get(date) && pointByDate.get(date)[field]
    );
    // One board only: full scale is its own maximum, so no day is clipped.
    const changeScale = boardLib.robustScale(dates.map((date) => valueOf(date, "pct_chg")), 1, 1);
    const flowScale = boardLib.robustScale(dates.map((date) => valueOf(date, flowField)), 1, 1);
    const readout = document.createElement("p");
    readout.className = "board-detail-readout";
    const showReadout = (date) => {
      const change = valueOf(date, "pct_chg");
      const flow = valueOf(date, flowField);
      readout.textContent = pointByDate.has(date)
        ? `${date} · 涨跌 ${change === null ? "—" : formatPercent(change)} · ${boardFlowLabel()} ${formatBoardMoney(flow)}`
        : `${date} · 该日缺失，不当作 0`;
      for (const cell of wrapper.querySelectorAll("[data-date]")) {
        cell.classList.toggle("is-selected-day", cell.dataset.date === date);
      }
    };
    const buildSubChart = (titleText, field, scale, formatTick) => {
      const section = document.createElement("div");
      section.className = "board-detail-subchart";
      const title = document.createElement("strong");
      title.textContent = titleText;
      const body = document.createElement("div");
      body.className = "board-detail-subchart-body";
      const ticks = document.createElement("div");
      ticks.className = "board-detail-ticks";
      for (const tickText of [`+${formatTick(scale.limit)}`, "0", `-${formatTick(scale.limit)}`]) {
        ticks.appendChild(Object.assign(document.createElement("span"), { textContent: tickText }));
      }
      const bars = document.createElement("div");
      bars.className = "board-detail-flow-bars";
      bars.style.setProperty("--board-day-count", String(Math.max(dates.length, 1)));
      for (const date of dates) {
        const value = valueOf(date, field);
        const cell = document.createElement("span");
        cell.dataset.date = date;
        cell.addEventListener("mouseenter", () => showReadout(date));
        cell.addEventListener("click", () => showReadout(date));
        if (value !== null) {
          const bar = document.createElement("i");
          bar.className = boardChangeClass(value);
          bar.style.height = `${Math.max(value === 0 ? 1 : 6, Math.min(1, Math.abs(value) / scale.limit) * 46)}%`;
          cell.appendChild(bar);
        }
        bars.appendChild(cell);
      }
      body.append(ticks, bars);
      const note = document.createElement("small");
      note.className = "board-detail-scale-note";
      note.textContent = scale.clipped
        ? `有 ${scale.clipped} 天超出满格，已画到满格；点按或悬停读真实值`
        : "";
      section.append(title, body);
      if (scale.clipped) section.appendChild(note);
      return section;
    };
    const datesLabel = document.createElement("div");
    datesLabel.className = "board-detail-chart-dates";
    datesLabel.append(
      Object.assign(document.createElement("span"), { textContent: dates.length ? dates[0].slice(5) : "—" }),
      Object.assign(document.createElement("span"), { textContent: dates.length ? dates[Math.floor(dates.length / 2)].slice(5) : "—" }),
      Object.assign(document.createElement("span"), { textContent: dates.length ? dates[dates.length - 1].slice(5) : "—" })
    );
    wrapper.append(
      heading,
      buildSubChart("每日涨跌幅（%）", "pct_chg", changeScale, (limit) => `${limit.toFixed(1)}%`),
      buildSubChart(`每日${boardFlowLabel()}`, flowField, flowScale, (limit) => formatBoardAmount(limit)),
      datesLabel,
      readout
    );
    if (dates.length) showReadout(dates[dates.length - 1]);
    else readout.textContent = "等待历史数据";
    return wrapper;
  }

  /** One frozen period number plus its quality reason; missing stays an explicit em dash. */
  function createBoardPeriodFact(record, field, label, formatter, note) {
    const value = record
      ? boardLib.finiteNumber(record[field])
      : null;
    // The frozen contract keys per-metric quality by the field name itself.
    const qualityMap = record && record.quality && typeof record.quality === "object"
      ? record.quality
      : null;
    const quality = qualityMap && typeof qualityMap[field] === "object"
      ? qualityMap[field]
      : null;
    const reason = quality && quality.reason
      ? boardQualityReasonText(quality.reason)
      : null;
    const fact = createBoardDetailFact(
      label,
      value === null && reason ? `—（${reason}）` : formatter(value)
    );
    const tooltips = [note];
    if (quality && quality.valid_count != null) {
      tooltips.push(`样本 ${quality.valid_count}/${quality.expected_count ?? "—"} · ${quality.status || "unknown"}`);
    }
    if (reason) tooltips.push(`缺失原因 ${reason}`);
    fact.title = tooltips.filter(Boolean).join(" · ");
    return fact;
  }

  /** Period facts of one snapshot row; net amount and verified main force stay separate concepts. */
  function boardSnapshotPeriodFacts(item, record) {
    const windowLabel = boardWindowLabel();
    const money = formatBoardMoney;
    const pct = formatPercent;
    const conceptNote = "净额（全口径）与真实主力净流入是不同概念，不互相替代";
    const ratioNote = "同一周期、同一有效成分";
    const facts = [
      createBoardPeriodFact(record, "net_inflow", `${windowLabel}净额`, money, conceptNote),
      createBoardPeriodFact(record, "verified_main_net_inflow", `${windowLabel}真实主力净流入`, money, conceptNote),
      createBoardPeriodFact(record, "gross_inflow", `${windowLabel}总流入`, money, "全部分桶买入金额"),
      createBoardPeriodFact(record, "net_inflow_to_amount_pct", "净流入 / 成交额", pct, ratioNote),
      createBoardPeriodFact(record, "main_net_inflow_to_amount_pct", "主力净流入 / 成交额", pct, conceptNote),
      createBoardPeriodFact(record, "gross_inflow_to_amount_pct", "总流入 / 成交额", pct, ratioNote),
      createBoardPeriodFact(record, "main_buy_share_pct", "主力买入 / 总买入", pct, ""),
    ];
    // 旧板块详情字段（昨日成交额、20 日均值与倍数、5 日参考、来源）在新快照行
    // 上原样保留；缺失时同样显式为 em dash，不落入周期的零填充。
    const amountAverage = item.amount_average_20d ?? item.amount_avg_20d;
    const dailyFacts = [
      createBoardDetailFact("成交额（昨日）", formatBoardAmount(item.amount)),
      createBoardDetailFact("20 日平均成交额", formatBoardAmount(amountAverage)),
      createBoardDetailFact(
        "成交 / 20 日均",
        formatBoardRatio(item.amount_ratio_20d)
      ),
      createBoardDetailFact("5 日涨跌", formatPercent(item.pct_chg_5d)),
    ];
    dailyFacts[0].title = "当日板块成交额";
    dailyFacts[1].title = amountAverage == null
      ? "20 日平均成交额待积累"
      : "近 20 个交易日成交额均值，旧真实 run 同字段校验";
    dailyFacts[2].title = amountAverage == null
      ? "20 日平均成交额待积累"
      : `20 日平均成交额 ${formatBoardAmount(amountAverage)}`;
    dailyFacts[3].title = "5 日涨跌仅作参考，独立于所选周期结论";
    facts.push(...dailyFacts);
    const source = item.source_1d || item.source;
    if (source) {
      facts.push(createBoardDetailFact("来源", boardSourceLabel(String(source))));
    }
    const latestDate = boardLib.latestPoint(item, "pct_chg").date;
    if (latestDate) {
      facts.push(createBoardDetailFact("最新数据日", latestDate));
    }
    return facts;
  }

  /** Missing-reason ids stay readable in Chinese; domain text passes through. */
  function boardQualityReasonText(reason) {
    const labels = {
      insufficient_history: "历史样本不足",
      missing_amount: "成交额缺失",
      amount_not_verifiable: "成交额口径或成员成分不可验证",
      buys_not_verifiable: "买入额口径或成员成分不可验证",
      window_incomplete: "周期窗口不完整",
    };
    const text = String(reason || "");
    return labels[text] || text;
  }

  /**
   * One matrix-cell quality object rendered as a visible Chinese note plus a
   * full tooltip line; an object quality never reaches string interpolation.
   */
  function boardAdvancedQualityNote(quality) {
    if (!quality || typeof quality !== "object") return "";
    const parts = [];
    if (quality.reason) parts.push(boardQualityReasonText(quality.reason));
    const sampleCount = boardLib.finiteNumber(quality.sample_count ?? quality.valid_count);
    const expectedCount = boardLib.finiteNumber(
      quality.expected_session_count ?? quality.expected_count
    );
    if (sampleCount !== null || expectedCount !== null) {
      parts.push(`样本 ${sampleCount ?? "—"}/${expectedCount ?? "—"}`);
    }
    if (boardLib.finiteNumber(quality.coverage_ratio) !== null) {
      parts.push(`覆盖 ${Math.round(Number(quality.coverage_ratio) * 100)}%`);
    }
    const maturity = boardMaturityLabel(quality.maturity_status);
    if (maturity) parts.push(maturity);
    return parts.join(" · ");
  }

  /** Advanced per-metric evidence exposed by the backend; unknown ids stay visible. */
  /** Readable advanced-metric value by unit: CNY -> 亿/万, pct -> %, multiple -> 倍, ratio -> %. */
  function boardAdvancedValueText(value, unit) {
    if (unit === "CNY") return formatBoardMoney(value);
    if (unit === "pct") return formatPercent(value);
    if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
    if (unit === "multiple") return `${value.toFixed(2)}倍`;
    return String(Math.round(value * 10000) / 10000);
  }

  function renderBoardAdvancedMetrics(item) {
    const advanced = item.latest_advanced;
    if (!advanced || typeof advanced !== "object") return null;
    const entries = Object.entries(advanced);
    if (!entries.length) return null;
    const section = document.createElement("section");
    section.className = "board-detail-advanced";
    const title = document.createElement("strong");
    title.textContent = "进阶指标 · 最新可得";
    section.appendChild(title);
    for (const [metricId, entry] of entries) {
      if (!entry || typeof entry !== "object") continue;
      const value = boardLib.finiteNumber(entry.value);
      const quality = entry.quality && typeof entry.quality === "object"
        ? entry.quality
        : null;
      const qualityNote = boardAdvancedQualityNote(quality);
      const text = value === null
        ? (qualityNote ? `—（${qualityNote}）` : "—")
        : boardAdvancedValueText(value, entry.unit);
      const row = createBoardDetailFact(
        String(entry.label || boardSwMetricLabel(String(metricId))),
        text
      );
      const tooltips = [
        entry.source ? `来源 ${entry.source}` : "",
        entry.methodology_id ? `方法 ${entry.methodology_id}` : "",
        entry.status ? `状态 ${entry.status}` : "",
        entry.data_as_of ? `数据截至 ${entry.data_as_of}` : "",
        qualityNote ? `质量 ${qualityNote}` : "",
      ];
      row.title = tooltips.filter(Boolean).join(" · ");
      section.appendChild(row);
    }
    return section;
  }

  /** Render the selected frozen board and its period metrics. */
  /** Parent entry of one Shenwan L2 detail: back link to the L1 plus the sibling rank. */
  function renderBoardParentEntry(item) {
    if (!item.parent) return null;
    const windowKey = boardRadarState.window;
    const parentRow = boardRowsById("sw_l1").get(item.parent.id);
    const entry = document.createElement("div");
    entry.className = "board-detail-breadcrumb";
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = `← ${item.parent.name}（申万一级）`;
    back.disabled = !parentRow;
    back.addEventListener("click", () => {
      if (!parentRow) return;
      boardRadarState.expandedParents.add(item.parent.id);
      boardJumpToRow("sw_l1", parentRow);
    });
    const rank = item.sibling_rank && item.sibling_rank[windowKey];
    const rankText = document.createElement("span");
    rankText.textContent = rank && rank.rank != null
      ? `本类 ${rank.count} 个二级中，${boardWindowLabel()}涨幅第 ${rank.rank}`
      : `本类 ${rank ? rank.count : "—"} 个二级，${boardWindowLabel()}涨幅缺失`;
    entry.append(back, rankText);
    return entry;
  }

  /** One comparison row of the Shenwan tree sections; clickable when onSelect is given. */
  function createBoardTreeRow(cells, options) {
    const row = options.onSelect ? document.createElement("button") : document.createElement("div");
    if (options.onSelect) {
      row.type = "button";
      row.addEventListener("click", options.onSelect);
    }
    row.className = `board-tree-row${options.className ? ` ${options.className}` : ""}`;
    for (const cell of cells) {
      const span = document.createElement("span");
      span.textContent = cell.text;
      if (cell.className) span.className = cell.className;
      if (cell.title) span.title = cell.title;
      row.appendChild(span);
    }
    return row;
  }

  /** Children table of one Shenwan L1: each L2, the unlisted remainder and the L1 total. */
  function renderBoardChildrenSection(item, periodRecord) {
    if (!Array.isArray(item.children) || !item.children.length) return null;
    const windowKey = boardRadarState.window;
    const windowLabel = boardWindowLabel();
    const flowField = boardFlowField();
    const flowLabel = boardFlowLabel();
    const children = boardOrderedChildren(item, boardRowsById("sw_l2"));
    const section = document.createElement("section");
    section.className = "board-detail-tree";
    const heading = document.createElement("div");
    heading.className = "board-detail-tree-heading";
    const title = document.createElement("strong");
    title.textContent = `下属二级 · ${item.children.length} 个`;
    const hint = document.createElement("small");
    hint.textContent = "点一行进入二级详情";
    heading.append(title, hint);
    section.append(
      heading,
      createBoardTreeRow(
        [
          { text: "二级" },
          { text: "昨日" },
          { text: `${windowLabel}涨幅` },
          { text: `${windowLabel}${flowLabel}` },
          { text: "趋势" },
        ],
        { className: "is-head" }
      )
    );
    const changeCell = (value) => ({ text: formatPercent(value), className: boardChangeClass(value) });
    const flowCell = (value) => ({ text: formatBoardMoney(value), className: boardChangeClass(value) });
    for (const child of children) {
      const childPeriod = boardPeriod(child);
      const state = boardMacdState(child);
      section.appendChild(createBoardTreeRow(
        [
          { text: String(child.name || "—") },
          changeCell(boardLib.latestPoint(child, "pct_chg").value),
          changeCell(childPeriod ? boardLib.finiteNumber(childPeriod.return_pct) : null),
          flowCell(childPeriod ? boardNumber(childPeriod[flowField]) : null),
          { text: state.id ? state.label : "—", className: state.className },
        ],
        { onSelect: () => boardJumpToRow("sw_l2", child) }
      ));
    }
    const reconciliation = item.children_reconciliation && item.children_reconciliation[windowKey];
    const flowReconciliation = reconciliation ? reconciliation[flowField] : null;
    if (flowReconciliation) {
      const remainder = boardNumber(flowReconciliation.remainder);
      const unlisted = reconciliation.has_unlisted_members;
      section.appendChild(createBoardTreeRow(
        [
          { text: "其它*", title: "一级 − 下属二级之和：不属于任何已发布二级的成分股" },
          { text: "—" },
          { text: "—" },
          { text: remainder === null ? "—" : formatBoardMoney(remainder), className: boardChangeClass(remainder) },
          { text: unlisted === true ? "有差异" : unlisted === false ? "无差异" : "—" },
        ],
        { className: `is-remainder${unlisted === true ? " has-gap" : ""}` }
      ));
    }
    section.appendChild(createBoardTreeRow(
      [
        { text: "一级合计" },
        changeCell(boardLib.latestPoint(item, "pct_chg").value),
        changeCell(periodRecord ? boardLib.finiteNumber(periodRecord.return_pct) : null),
        flowCell(periodRecord ? boardNumber(periodRecord[flowField]) : null),
        { text: "" },
      ],
      { className: "is-total" }
    ));
    const note = document.createElement("p");
    note.className = "board-detail-tree-note";
    note.textContent = "*其它 = 一级 − 下属二级之和：个别成分股不属于任何已发布的二级时才会出现数值。涨幅与趋势不能相加，只对资金与成交额做对账。";
    section.appendChild(note);
    return section;
  }

  /** Same-parent comparison of one Shenwan L2: siblings ordered by the window return. */
  function renderBoardSiblingsSection(item) {
    if (!item.parent) return null;
    const parentRow = boardRowsById("sw_l1").get(item.parent.id);
    if (!parentRow) return null;
    const siblings = boardOrderedChildren(parentRow, boardRowsById("sw_l2"));
    if (siblings.length < 2) return null;
    const section = document.createElement("section");
    section.className = "board-detail-tree";
    const heading = document.createElement("div");
    heading.className = "board-detail-tree-heading";
    const title = document.createElement("strong");
    title.textContent = `同属${item.parent.name}的二级对比（${boardWindowLabel()}涨幅）`;
    heading.appendChild(title);
    section.appendChild(heading);
    for (const sibling of siblings) {
      const record = boardPeriod(sibling);
      const value = record ? boardLib.finiteNumber(record.return_pct) : null;
      const current = boardRowKey(sibling) === boardRowKey(item);
      section.appendChild(createBoardTreeRow(
        [
          { text: `${current ? "▶ " : ""}${sibling.name}` },
          { text: formatPercent(value), className: boardChangeClass(value) },
        ],
        {
          className: `is-sibling${current ? " is-current" : ""}`,
          onSelect: current ? null : () => boardJumpToRow("sw_l2", sibling),
        }
      ));
    }
    return section;
  }

  function renderBoardDetail(item) {
    const container = document.querySelector("#board-detail");
    replaceChildrenCompat(container);
    if (!item) {
      const empty = document.createElement("p");
      empty.className = "board-empty";
      empty.textContent = "请选择一个板块查看详情。";
      container.appendChild(empty);
      return;
    }
    const logic = boardLogic(item);
    const macdState = boardMacdState(item);
    const header = document.createElement("header");
    header.className = "board-detail-heading";
    const identity = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = String(item.name || "—");
    const taxonomy = document.createElement("small");
    taxonomy.className = `is-${item.taxonomy === "industry" ? "industry" : "concept"}`;
    taxonomy.textContent = boardTaxonomyTag(item);
    identity.append(name, taxonomy);
    const state = document.createElement("strong");
    state.className = macdState.className;
    state.textContent = macdState.id ? macdState.label : "MACD 待补数";
    header.append(identity, state);
    const windowLabel = boardWindowLabel();
    const metrics = document.createElement("div");
    metrics.className = "board-detail-metrics";
    const latestChange = boardLib.latestPoint(item, "pct_chg").value;
    const periodRecord = boardPeriod(item);
    const periodReturn = periodRecord
      ? boardLib.finiteNumber(periodRecord.return_pct)
      : null;
    const distance = periodRecord
      ? boardLib.finiteNumber(periodRecord.distance_from_high_pct)
      : null;
    for (const [label, value, hint] of [
      ["昨日", latestChange, "最新交易日单日涨跌幅，独立于周期结论"],
      [windowLabel, periodReturn, `${windowLabel}周期涨跌幅，由后端按交易日复合`],
      ["距周期高点回落", distance, "相对周期内最高价的回落幅度"],
    ]) {
      const metric = document.createElement("div");
      const caption = document.createElement("span");
      caption.textContent = label;
      caption.title = hint || "";
      const content = document.createElement("strong");
      content.className = boardChangeClass(value);
      content.textContent = formatPercent(value);
      metric.append(caption, content);
      metrics.appendChild(metric);
    }
    const macdFacts = document.createElement("div");
    macdFacts.className = "board-detail-facts";
    macdFacts.appendChild(
      createBoardDetailFact("MACD", boardMacdEvidence(macdState))
    );
    const parentEntry = renderBoardParentEntry(item);
    if (parentEntry) container.appendChild(parentEntry);
    container.append(header, metrics, macdFacts);

    const advanced = renderBoardAdvancedMetrics(item);
    if (!periodRecord) {
      const unavailable = document.createElement("section");
      unavailable.className = "board-detail-unavailable";
      const title = document.createElement("strong");
      title.textContent = `${windowLabel}周期数据不可用`;
      const explanation = document.createElement("p");
      explanation.textContent = "该分类下没有冻结的周期记录；保留日行情与进阶指标，不生成周期结论。";
      unavailable.append(title, explanation);
      container.append(
        ...(advanced ? [advanced] : []),
        unavailable,
        renderBoardDetailChart(item)
      );
      return;
    }

    const facts = document.createElement("div");
    facts.className = "board-detail-facts";
    facts.append(...boardSnapshotPeriodFacts(item, periodRecord));
    container.append(facts);

    // THS rows keep the daily leader/breadth facts; SW rows never fake them.
    if (item.leader != null || item.up_count != null) {
      const dailyFacts = document.createElement("div");
      dailyFacts.className = "board-detail-facts";
      if (item.leader != null) {
        dailyFacts.appendChild(createBoardDetailFact("龙头", String(item.leader)));
      }
      if (item.up_count != null) {
        dailyFacts.appendChild(createBoardDetailFact(
          "涨跌家数",
          `${item.up_count} 涨 / ${item.down_count} 跌`
        ));
      }
      container.appendChild(dailyFacts);
    }

    const childrenSection = renderBoardChildrenSection(item, periodRecord);
    if (childrenSection) container.appendChild(childrenSection);
    const siblingsSection = renderBoardSiblingsSection(item);
    if (siblingsSection) container.appendChild(siblingsSection);
    if (advanced) container.appendChild(advanced);
    container.appendChild(renderBoardDetailChart(item));

    const logicPanel = document.createElement("section");
    logicPanel.className = "board-detail-logic";
    const logicHeading = document.createElement("div");
    const logicTitle = document.createElement("strong");
    logicTitle.textContent = "板块逻辑 · 可回溯证据";
    const ruleVersion = document.createElement("small");
    ruleVersion.textContent = "BACKEND MACD + PERIOD LOGIC";
    logicHeading.append(logicTitle, ruleVersion);
    const basisLabel = logic.basis === "verified_main_net_inflow"
      ? "真实主力净流入"
      : "净流入";
    const explanation = document.createElement("p");
    explanation.textContent = `${boardMacdEvidence(macdState)}。${logic.label}：${windowLabel}周期涨幅 ${formatPercent(periodReturn)}，${basisLabel} ${formatBoardMoney(boardLib.finiteNumber(periodRecord[logic.basis === "verified_main_net_inflow" ? "verified_main_net_inflow" : "net_inflow"]))}。`;
    const evidence = document.createElement("div");
    evidence.append(
      createBoardDetailFact("MACD", boardMacdEvidence(macdState)),
      createBoardDetailFact("趋势", `${windowLabel} ${formatPercent(periodReturn)} · 昨日 ${formatPercent(latestChange)}`),
      createBoardDetailFact(
        "资金",
        `${basisLabel} ${formatBoardMoney(boardLib.finiteNumber(periodRecord[logic.basis === "verified_main_net_inflow" ? "verified_main_net_inflow" : "net_inflow"]))}`
      ),
      createBoardDetailFact("逻辑依据", basisLabel)
    );
    logicPanel.append(logicHeading, explanation, evidence);
    container.appendChild(logicPanel);
  }

  /** Unit labels for preserved SW matrix metrics in the heatmap view. */
  const boardSwMetricLabels = {
    trading_crowding: "交易拥挤度（365自然日分位）",
    cross_section_heat: "横截面成交热度",
    trading_amount_share: "同级成交额占比",
    turnover_rate_pct: "换手率",
    turnover_percentile: "换手率历史分位",
    volatility_20d_pct: "20日年化波动率",
    pe: "市盈率 PE",
    pe_percentile: "PE 三年分位",
    pb: "市净率 PB",
    pb_percentile: "PB 三年分位",
    momentum_10d_pct: "10日价格动量",
    pct_change: "日涨跌幅",
    net_inflow_cny: "全口径净流入（日）",
    main_net_inflow_cny: "主力净流入（日）",
    net_inflow_total_market_value_pct: "全口径净流入 / 总市值（日）",
    main_net_inflow_total_market_value_pct: "主力净流入 / 总市值（日）",
    net_inflow_float_market_value_pct: "全口径净流入 / 流通市值（日）",
    main_net_inflow_float_market_value_pct: "主力净流入 / 流通市值（日）",
    net_inflow_5d_cny: "全口径净流入（5日）",
    main_net_inflow_5d_cny: "主力净流入（5日）",
    net_inflow_5d_total_market_value_pct: "全口径净流入 / 总市值（5日）",
    main_net_inflow_5d_total_market_value_pct: "主力净流入 / 总市值（5日）",
    amount_cny: "成交额（日）",
    main_buy_cny: "主力买入额（日）",
    total_buy_cny: "总买入额（日）",
    total_sell_cny: "总卖出额（日）",
  };
  const boardThsMetricLabels = {
    pct_chg: "日涨跌",
    net_inflow: "净流入",
    verified_main_net_inflow: "真实主力净流入",
    amount: "日成交",
  };

  function boardSwMetricLabel(metricId) {
    return boardSwMetricLabels[metricId] || metricId;
  }

  /** Format one heatmap cell value by matrix unit; missing stays an em dash. */
  function boardHeatmapCellValue(value, unit) {
    const numeric = boardNumber(value);
    if (numeric === null) return "—";
    if (unit === "CNY") return formatBoardMoney(numeric);
    if (unit === "pct") return `${numeric.toFixed(Math.abs(numeric) < 1 ? 3 : 2)}%`;
    if (unit === "ratio") return numeric.toFixed(3);
    return numeric.toFixed(2);
  }

  /** Quantile color scale shared with the standalone data-center heatmap. */
  function boardHeatmapColor(value, unit, metricId, bounds) {
    const numeric = boardNumber(value);
    if (numeric === null) return "#111c19";
    if (
      unit === "ratio"
      && (String(metricId).endsWith("percentile")
        || String(metricId).includes("crowding")
        || String(metricId) === "cross_section_heat")
    ) {
      const t = Math.max(0, Math.min(1, numeric));
      return t < 0.5
        ? `hsl(${190 - t * 80} 45% ${18 + t * 14}%)`
        : `hsl(${52 - (t - 0.5) * 85} 64% ${30 + t * 12}%)`;
    }
    const scale = numeric >= 0 ? bounds.positive : bounds.negative;
    const intensity = Math.min(1, Math.abs(numeric) / (scale || 1));
    const hue = numeric >= 0 ? 5 : 195;
    return `hsl(${hue} ${35 + intensity * 38}% ${16 + intensity * 28}%)`;
  }

  function boardHeatmapBounds(rows) {
    const values = [];
    for (const row of rows) {
      for (const value of row.values) {
        const numeric = boardNumber(value);
        if (numeric !== null) values.push(numeric);
      }
    }
    const quantileOf = (sorted, percentile) => {
      if (!sorted.length) return 0;
      const position = (sorted.length - 1) * percentile;
      const lower = Math.floor(position);
      const upper = Math.ceil(position);
      return lower === upper
        ? sorted[lower]
        : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
    };
    const positives = values.filter((value) => value > 0).sort((a, b) => a - b);
    const negatives = values.filter((value) => value < 0).map(Math.abs).sort((a, b) => a - b);
    return {
      positive: quantileOf(positives, 0.95),
      negative: quantileOf(negatives, 0.95),
    };
  }

  /** Populate the heatmap metric dropdown for the active classification. */
  function boardHeatmapMetricOptions() {
    if (!boardResearchActive()) return [];
    if (boardRadarState.classification === "ths") {
      return boardLib.THS_HEATMAP_METRICS.map((metric) => ({
        id: metric.id,
        label: boardThsMetricLabels[metric.id] || metric.label,
      }));
    }
    return boardLib
      .swMatrixMetricIds(boardResearchSnapshot, boardRadarState.classification)
      .map((metricId) => ({ id: metricId, label: boardSwMetricLabel(metricId) }));
  }

  /** THS heatmap table aligned to the shared window dates and the filtered rows. */
  function boardThsHeatmapTable(rows) {
    const metricId = boardRadarState.heatmapMetric || "pct_chg";
    const table = boardLib.thsHeatmap(
      boardResearchSnapshot,
      metricId,
      boardRadarState.window,
      rows
    );
    return {
      title: `${boardLib.classificationLabel("ths")} · ${boardThsMetricLabels[metricId] || metricId}（${boardWindowLabel()}）`,
      subtitle: "同花顺板块研究快照 · 与榜单共享过滤、周期与所选板块",
      status: table.dates.length
        ? `最新 ${table.dates[table.dates.length - 1]}`
        : "共享日期列缺失",
      unit: metricId === "pct_chg" ? "pct" : "CNY",
      dates: table.dates,
      rows: table.rows,
      methodology: "backend board-research snapshot",
    };
  }

  /**
   * SW heatmap table via the pure boardLib.swHeatmap projection: the date
   * axis is exactly the shared window of the classification, and rows are
   * the caller's already-filtered, already-sorted list mapped by industry
   * code — never the full frozen matrix or raw matrix dates.
   */
  function boardSwHeatmapTable(rows) {
    const metricId = boardRadarState.heatmapMetric || "trading_crowding";
    const classification = boardRadarState.classification;
    const windowKey = boardRadarState.window;
    const table = boardLib.swHeatmap(
      boardResearchSnapshot,
      metricId,
      classification,
      windowKey,
      rows
    );
    if (!table || !table.dates.length || !table.rows.length) return null;
    const latest = table.dates[table.dates.length - 1];
    const status = table.insufficient
      ? `样本不足（${table.dates.length}/${windowKey === "60d" ? 60 : 20}）· 最新 ${latest}`
      : `${table.status || "ok"} · 最新 ${latest}`;
    return {
      title: `${boardLib.classificationLabel(classification)} · ${boardSwMetricLabel(metricId)}`,
      subtitle: `${table.methodology || "sw matrix"} · ${table.unit ?? ""}`.trim(),
      status,
      unit: table.unit,
      metricId,
      dates: table.dates,
      rows: table.rows,
      methodology: table.methodology,
    };
  }

  /** Maturity labels for preserved matrix quality cells. */
  function boardMaturityLabel(status) {
    return {
      insufficient: "样本不足",
      warming_up: "预热",
      mature: "",
      degraded: "覆盖不足",
    }[status] || status || "";
  }

  /**
   * Render one heatmap table inside a horizontally scrollable container. The
   * table keeps its natural width; the container never widens the page.
   */
  function renderBoardHeatmapTable(panel, table) {
    const wrapper = document.createElement("div");
    wrapper.className = "heatmap-heading";
    const titleBlock = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = table.title;
    const subtitle = document.createElement("p");
    subtitle.textContent = table.subtitle;
    titleBlock.append(title, subtitle);
    const status = document.createElement("span");
    status.className = "heatmap-status";
    status.textContent = table.status;
    wrapper.append(titleBlock, status);
    panel.appendChild(wrapper);

    const scroll = document.createElement("div");
    scroll.className = "heatmap-scroll";
    const tableNode = document.createElement("table");
    tableNode.className = "heatmap";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "industry-name";
    corner.textContent = "板块 / 日期";
    headRow.appendChild(corner);
    table.dates.forEach((date, index) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      const isLatest = index === table.dates.length - 1;
      cell.textContent = isLatest ? `${date.slice(5)} ↓` : date.slice(5);
      if (isLatest) cell.title = "行按此列（最新一日）从高到低排序，缺失排末尾";
      headRow.appendChild(cell);
    });
    thead.appendChild(headRow);
    tableNode.appendChild(thead);
    const tbody = document.createElement("tbody");
    const bounds = boardHeatmapBounds(table.rows);
    for (const row of table.rows) {
      const tr = document.createElement("tr");
      tr.dataset.boardKey = row.key;
      const name = document.createElement("th");
      name.className = "industry-name";
      name.scope = "row";
      name.textContent = row.name;
      tr.appendChild(name);
      row.values.forEach((value, index) => {
        const cell = document.createElement("td");
        const quality = Array.isArray(row.quality) ? row.quality[index] : null;
        const maturity = quality ? boardMaturityLabel(quality.maturity_status) : "";
        const numeric = boardNumber(value);
        cell.textContent = numeric === null
          ? (maturity || "—")
          : maturity
            ? `${boardHeatmapCellValue(value, table.unit)} · ${maturity}`
            : boardHeatmapCellValue(value, table.unit);
        cell.style.background = boardHeatmapColor(value, table.unit, table.metricId, bounds);
        if (numeric === null) cell.className = "empty";
        const coverage = quality && Number.isFinite(Number(quality.coverage_ratio))
          ? `${Math.round(Number(quality.coverage_ratio) * 100)}%`
          : "—";
        cell.title = [
          row.name,
          table.dates[index] || "—",
          `${boardHeatmapCellValue(value, table.unit)}${maturity ? ` · ${maturity}` : ""}`,
          quality ? `样本 ${quality.sample_count ?? "—"} / ${quality.expected_session_count ?? "—"} · 覆盖 ${coverage} · ${quality.maturity_status || "unknown"}` : "",
        ].filter(Boolean).join(" · ");
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    }
    tableNode.appendChild(tbody);
    scroll.appendChild(tableNode);
    panel.appendChild(scroll);
  }

  /**
   * Heatmap rows are ordered by the selected heatmap metric itself: latest
   * date value, high to low, missing last (never treated as zero), ties by
   * name. The list's sort dropdown does not apply to the heatmap view.
   */
  function boardHeatmapSortedRows(tableRows) {
    const latest = (row) => {
      const values = Array.isArray(row.values) ? row.values : [];
      return boardNumber(values.length ? values[values.length - 1] : null);
    };
    return [...tableRows].sort((left, right) => {
      const leftValue = latest(left);
      const rightValue = latest(right);
      if (leftValue === null && rightValue === null) {
        return String(left.name).localeCompare(String(right.name), "zh-Hans-CN");
      }
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      if (leftValue !== rightValue) return rightValue - leftValue;
      return String(left.name).localeCompare(String(right.name), "zh-Hans-CN");
    });
  }

  /** Heatmap view: one table per level+metric, sharing filters and selection with the list. */
  function renderBoardHeatmap(rows) {
    const panel = document.querySelector("#board-heatmap");
    replaceChildrenCompat(panel);
    const select = document.querySelector("#board-heatmap-metric-select");
    const options = boardHeatmapMetricOptions();
    replaceChildrenCompat(select);
    if (!options.length || !boardResearchActive()) {
      select.hidden = true;
      const empty = document.createElement("div");
      empty.className = "board-empty board-heatmap-empty";
      empty.textContent = boardResearchActive()
        ? (boardRadarState.classification === "ths"
          ? "当前指标没有可用数据；缺失值不按零填充。"
          : "共享窗口日期缺失，样本不足；不借用其他层级或 THS 的日期。")
        : "板块研究快照缺失（无行业热图 bundle）· 等待本次运行的冻结快照；页面不读取外部或历史 bundle。";
      panel.appendChild(empty);
      return;
    }
    select.hidden = false;
    if (!options.some((option) => option.id === boardRadarState.heatmapMetric)) {
      boardRadarState.heatmapMetric = options[0].id;
    }
    for (const option of options) {
      const node = document.createElement("option");
      node.value = option.id;
      node.textContent = option.label;
      node.selected = option.id === boardRadarState.heatmapMetric;
      select.appendChild(node);
    }
    const table = boardRadarState.classification === "ths"
      ? boardThsHeatmapTable(rows)
      : boardSwHeatmapTable(rows);
    if (!table || !table.dates.length || !table.rows.length) {
      const empty = document.createElement("div");
      empty.className = "board-empty board-heatmap-empty";
      empty.textContent = `当前指标没有可用矩阵；缺失值不按零填充，也不借用其他层级或指标的数据。`;
      panel.appendChild(empty);
      return;
    }
    table.rows = boardHeatmapSortedRows(table.rows);
    renderBoardHeatmapTable(panel, table);
    for (const tr of panel.querySelectorAll("tr[data-board-key]")) {
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      const selectHeatmapRow = () => {
        const key = tr.dataset.boardKey;
        // SW matrix rows are matched by explicit industry code, never by name.
        const match = rows.find((item) => (
          item.key === key
          || (table.metricId && String(item.code || "") === key)
        ));
        if (!match) return;
        boardRadarState.selectedKey = boardRowKey(match);
        // Return to the ranked list so the shared detail panel is visible;
        // on mobile go straight to the detail tab.
        boardRadarState.view = "list";
        for (const choice of document.querySelectorAll("[data-board-view]")) {
          choice.setAttribute("aria-pressed", String(choice.dataset.boardView === "list"));
        }
        if (window.matchMedia("(max-width: 760px)").matches) {
          boardRadarState.mobileView = "detail";
        }
        renderBoardMarket();
      };
      tr.addEventListener("click", selectHeatmapRow);
      tr.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectHeatmapRow();
      });
    }
    for (const tr of panel.querySelectorAll("tr[data-board-key]")) {
      const selected = rows.some((item) => (
        item.key === tr.dataset.boardKey
        || (String(item.code || "") === tr.dataset.boardKey && tr.dataset.boardKey)
      ) && item.key === boardRadarState.selectedKey)
        || (boardResearchActive()
          && boardRowKey(rows.find((item) => item.key === boardRadarState.selectedKey) || {}) === tr.dataset.boardKey);
      tr.classList.toggle("is-selected", Boolean(selected));
    }
  }

  /** Apply the list/detail mobile tab state; desktop layout remains three columns. */
  function renderBoardMobileState() {
    const mobileTabs = document.querySelector("#board-mobile-tabs");
    if (mobileTabs) mobileTabs.hidden = boardRadarState.view === "heatmap";
    for (const button of document.querySelectorAll("[data-board-mobile-view]")) {
      button.setAttribute("aria-selected", String(button.dataset.boardMobileView === boardRadarState.mobileView));
    }
    for (const panel of document.querySelectorAll("[data-board-mobile-panel]")) {
      panel.classList.toggle("is-mobile-hidden", panel.dataset.boardMobilePanel !== boardRadarState.mobileView);
    }
  }

  /**
   * 将视图、分类和明确选中项同步回 URL，确保刷新与分享后状态可复现。
   * 输入示例：SW L1 热图选中 801010；输出：query 带 3 个 board 参数。
   */
  function syncBoardQuery() {
    const url = new URL(window.location.href);
    url.searchParams.set("boardView", boardRadarState.view);
    url.searchParams.set("boardClassification", boardRadarState.classification);
    url.searchParams.set("boardWindow", boardRadarState.window);
    url.searchParams.set("boardSort", boardRadarState.sort);
    const selected = boardRows().find(
      (item) => boardRowKey(item) === boardRadarState.selectedKey
    );
    if (selected && selected.code) {
      url.searchParams.set("boardSelected", String(selected.code));
    } else {
      url.searchParams.delete("boardSelected");
    }
    window.history.replaceState(null, "", url);
  }

  /** Render the complete board workbench: list/timeline/detail or heatmap, all sharing filters. */
  function renderBoardMarket() {
    const sourceRows = boardRows();
    const rows = boardLib
      ? boardLib.sortRows(
        sourceRows,
        boardRadarState.sort,
        boardRadarState.window
      )
      : sourceRows;
    const visible = visibleBoardRows(rows);
    boardRadarState.selectedKey = boardLib
      ? boardLib.resolveSelection(visible, boardRadarState.selectedKey)
      : null;
    const selected = visible.find((item) => boardRowKey(item) === boardRadarState.selectedKey) || null;
    const completeCount = sourceRows.filter((item) => boardDetailStatus(item) === "complete").length;
    const advanceCount = sourceRows.filter((item) => {
      const change = boardResearchActive()
        ? boardLib.latestPoint(item, "pct_chg").value
        : boardNumber(item.pct_chg_1d);
      return (boardNumber(change) || 0) > 0;
    }).length;
    const declineCount = sourceRows.filter((item) => {
      const change = boardResearchActive()
        ? boardLib.latestPoint(item, "pct_chg").value
        : boardNumber(item.pct_chg_1d);
      return (boardNumber(change) || 0) < 0;
    }).length;
    document.querySelector("#board-complete-count").textContent = `有周期 ${completeCount}`;
    document.querySelector("#board-complete-count").title =
      "按当前分类与周期的冻结周期记录统计；缺失周期不代表零";
    document.querySelector("#board-advance-count").textContent = `上涨 ${advanceCount}`;
    document.querySelector("#board-decline-count").textContent = `下跌 ${declineCount}`;
    const dates = boardVisibleDates();
    const windowLabel = boardWindowLabel();
    const status = document.querySelector("#board-data-status");
    const heatmapActive = boardRadarState.view === "heatmap";
    const layout = document.querySelector("#board-radar-layout");
    const heatmapPanel = document.querySelector("#board-heatmap");
    if (layout) layout.hidden = heatmapActive;
    if (heatmapPanel) heatmapPanel.hidden = !heatmapActive;
    document.querySelector("#board-heatmap-view-note").hidden = !heatmapActive;
    document.querySelector("#board-radar-controls-heatmap").hidden = !heatmapActive;
    const sortControl = document.querySelector("#board-sort-select");
    if (sortControl && sortControl.closest("label")) {
      sortControl.closest("label").hidden = heatmapActive;
    }
    const taxonomyGroup = document.querySelector("[data-board-taxonomy-filter]");
    if (taxonomyGroup) {
      // 板块分类已统一：同花顺口径只投影概念，行业走申万分类，
      // 行业/概念筛选不再有混合列表可筛，恒定隐藏。
      const group = taxonomyGroup.closest(".board-filter-group");
      if (group) group.hidden = true;
    }
    status.classList.toggle("is-degraded", !boardResearchActive());
    const industryStatus = boardResearchPayload && boardResearchPayload.industry || {};
    const industryCutoff = industryStatus.available && industryStatus.trade_date
      ? ` · 行业快照截止 ${industryStatus.trade_date}`
      : "";
    status.textContent = !boardResearchActive()
      ? `板块研究快照不可用（${String(boardResearchPayload.reason || "unknown")}）· 不回读旧载荷或历史快照`
      : `${boardLib.classificationLabel(boardRadarState.classification)} ${sourceRows.length} 个板块 · ${windowLabel}周期完整 ${completeCount} · 历史 ${dates.length} 日${industryStatus.available === false ? " · 行业热图 bundle 缺失" : industryCutoff}`;
    document.querySelector("#board-radar-coverage").textContent = boardResearchActive()
      ? `${boardLib.classificationLabel(boardRadarState.classification)} · ${completeCount}/${sourceRows.length} 个板块有${windowLabel}周期记录`
      : "冻结板块研究快照缺失";
    document.querySelector("#board-sort-note").textContent = boardResearchActive()
      ? boardRadarState.sort === "macd_regime"
        ? "趋势从强到弱：中短期看多 > 多头回调 > 空头反弹 > 中短期看空 · 缺失排末尾"
        : `排序按 ${windowLabel}${boardSortLabel()}降序 · 缺失排末尾`
      : "无板块研究快照：不生成周期排序";
    if (heatmapActive) {
      renderBoardHeatmap(visible);
    } else {
      renderBoardList(visible);
      renderBoardTimeline(visible);
      renderBoardDetail(selected);
    }
    renderBoardMobileState();
    syncBoardQuery();
  }

  for (const button of document.querySelectorAll("[data-board-completeness]")) {
    button.addEventListener("click", () => {
      boardRadarState.completeness = String(button.dataset.boardCompleteness);
      boardRadarState.listScrollTop = 0;
      for (const choice of document.querySelectorAll("[data-board-completeness]")) {
        choice.setAttribute("aria-pressed", String(choice === button));
      }
      renderBoardMarket();
    });
  }

  for (const button of document.querySelectorAll("[data-board-taxonomy-filter]")) {
    button.addEventListener("click", () => {
      boardRadarState.taxonomy = String(button.dataset.boardTaxonomyFilter);
      boardRadarState.listScrollTop = 0;
      for (const choice of document.querySelectorAll("[data-board-taxonomy-filter]")) {
        choice.setAttribute("aria-pressed", String(choice === button));
      }
      renderBoardMarket();
    });
  }

  for (const button of document.querySelectorAll("[data-board-window]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.boardWindow === boardRadarState.window)
    );
    button.addEventListener("click", () => {
      boardRadarState.window = String(button.dataset.boardWindow);
      for (const choice of document.querySelectorAll("[data-board-window]")) {
        choice.setAttribute("aria-pressed", String(choice === button));
      }
      renderBoardMarket();
    });
  }

  const boardClassificationSelect = document.querySelector("#board-classification-select");
  if (boardClassificationSelect) {
    boardClassificationSelect.value = boardRadarState.classification;
    boardClassificationSelect.addEventListener("change", () => {
      // Classifications never mix rows; the selection key is kept when the id
      // still resolves, otherwise the first row is selected by renderBoardMarket.
      boardRadarState.classification = String(boardClassificationSelect.value || "ths");
      boardRadarState.listScrollTop = 0;
      renderBoardMarket();
    });
  }

  const boardSortSelect = document.querySelector("#board-sort-select");
  if (boardSortSelect) {
    boardSortSelect.value = boardRadarState.sort;
    boardSortSelect.addEventListener("change", () => {
      boardRadarState.sort = String(boardSortSelect.value || "macd_regime");
      boardRadarState.listScrollTop = 0;
      renderBoardMarket();
    });
  }

  for (const button of document.querySelectorAll("[data-board-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.boardView === boardRadarState.view));
    button.addEventListener("click", () => {
      boardRadarState.view = String(button.dataset.boardView);
      for (const choice of document.querySelectorAll("[data-board-view]")) {
        choice.setAttribute("aria-pressed", String(choice === button));
      }
      renderBoardMarket();
    });
  }

  for (const button of document.querySelectorAll("[data-board-flow]")) {
    button.setAttribute("aria-pressed", String(button.dataset.boardFlow === boardRadarState.flowSource));
    button.addEventListener("click", () => {
      boardRadarState.flowSource = String(button.dataset.boardFlow);
      for (const choice of document.querySelectorAll("[data-board-flow]")) {
        choice.setAttribute("aria-pressed", String(choice === button));
      }
      renderBoardMarket();
    });
  }

  const boardHeatmapMetricSelect = document.querySelector("#board-heatmap-metric-select");
  if (boardHeatmapMetricSelect) {
    boardHeatmapMetricSelect.addEventListener("change", () => {
      boardRadarState.heatmapMetric = String(boardHeatmapMetricSelect.value || "");
      renderBoardMarket();
    });
  }

  document.querySelector("#board-radar-search").addEventListener("input", (event) => {
    boardRadarState.search = String(event.target.value || "");
    boardRadarState.listScrollTop = 0;
    renderBoardMarket();
  });

  for (const button of document.querySelectorAll("[data-board-mobile-view]")) {
    button.addEventListener("click", () => {
      boardRadarState.mobileView = String(button.dataset.boardMobileView);
      renderBoardMobileState();
    });
  }

  document.querySelector("#board-detail-back").addEventListener("click", () => {
    boardRadarState.mobileView = "list";
    renderBoardMobileState();
  });

  /**
   * 把 null、零与普通值分开格式化。
   * 输入示例：null、0、0.25、{put_oi:1}；输出："—（缺失）"、"0"、"0.25"、"put_oi: 1"。
   */
  function displayFrozenValue(value) {
    if (value === null || value === undefined || value === "") return "—（缺失）";
    if (typeof value === "number") return Number.isFinite(value)
      ? value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })
      : "—（无效）";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (Array.isArray(value)) return value.length ? value.map(displayFrozenValue).join("、") : "[]";
    if (typeof value === "object") {
      return Object.entries(value)
        .map(([key, item]) => `${key}: ${displayFrozenValue(item)}`)
        .join("；") || "{}";
    }
    return String(value);
  }

  /**
   * 创建一项可追溯事实。
   * 输入示例："数据截至" 与 ISO 时间；输出：包含 label/value 的 div。
   */
  function createFrozenFact(label, value) {
    const item = document.createElement("div");
    const caption = document.createElement("span");
    caption.textContent = label;
    const content = document.createElement("strong");
    content.textContent = displayFrozenValue(value);
    item.append(caption, content);
    return item;
  }

  /**
   * 渲染限制列表；空列表也明确说明。
   * 输入示例：["来源缺失"]；输出：带一条 li 的 ul。
   */
  function createLimitations(limitations) {
    const list = document.createElement("ul");
    list.className = "board-limitations";
    const values = Array.isArray(limitations) && limitations.length
      ? limitations
      : ["未声明额外限制。"];
    for (const limitation of values) {
      const item = document.createElement("li");
      item.textContent = String(limitation);
      list.appendChild(item);
    }
    return list;
  }

  /**
   * 将一条聪明钱或指数期权记录原样投影为字段列表，不重算方向或得分。
   * 输入示例：{entry_type:"margin", value:0}；输出：显示 margin 与真实零的卡片。
   */
  function createFamilyEntry(entry, index) {
    const card = document.createElement("div");
    card.className = "board-entry";
    const title = document.createElement("strong");
    title.textContent = String(
      entry.label || entry.name || entry.contract_name || entry.entry_type || `记录 ${index + 1}`
    );
    const fields = document.createElement("dl");
    for (const [key, value] of Object.entries(entry || {})) {
      if (key === "label" || key === "name" || key === "limitations") continue;
      const term = document.createElement("dt");
      term.textContent = key;
      const description = document.createElement("dd");
      description.textContent = displayFrozenValue(value);
      fields.append(term, description);
    }
    card.append(title, fields);
    return card;
  }

  /**
   * 渲染一个市场情报 family 的状态、三类时点、覆盖、方法、记录和限制。
   * 输入示例：missing smart_money；输出：状态为 missing，0 条记录且时点显示缺失。
   */
  function renderIntelligenceFamily(targetId, titleText, family) {
    const target = document.getElementById(targetId);
    replaceChildrenCompat(target);
    const value = family && typeof family === "object" ? family : {};
    const heading = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = titleText;
    const status = document.createElement("span");
    status.className = `board-status is-${String(value.status || "missing")}`;
    status.textContent = String(value.status || "missing");
    heading.append(title, status);

    const coverage = value.coverage && typeof value.coverage === "object"
      ? value.coverage
      : {};
    const facts = document.createElement("div");
    facts.className = "board-fact-grid";
    for (const [label, fact] of [
      ["数据截至", value.data_as_of],
      ["可用时间", value.available_at],
      ["抓取时间", value.retrieved_at],
      ["方法", [value.methodology_id, value.methodology_version].filter(Boolean).join(" · ") || null],
      ["预期覆盖", coverage.expected_count],
      ["观测覆盖", coverage.observed_count],
      ["有效覆盖", coverage.valid_count],
      ["覆盖率", coverage.coverage_ratio],
    ]) facts.appendChild(createFrozenFact(label, fact));

    const entries = document.createElement("div");
    entries.className = "board-entry-list";
    const records = Array.isArray(value.entries) ? value.entries : [];
    if (!records.length) {
      const empty = document.createElement("p");
      empty.className = "board-empty";
      empty.textContent = "0 条冻结记录；缺失不解释为零。";
      entries.appendChild(empty);
    } else {
      records.forEach((entry, index) => entries.appendChild(createFamilyEntry(entry, index)));
    }
    target.append(heading, facts, entries, createLimitations(value.limitations));
  }

  // 行业窗口仅投影后端冻结值；排序和条宽不产生业务指标。
  const smartMoneySorts = {
    main_net_inflow_cny: "主力净流入",
    block_trade_amount_cny: "大宗成交额",
    dragon_tiger_net_buy_cny: "龙虎榜净买入",
    northbound_turnover_cny: "北向活跃成交额",
  };
  const smartMoneyState = {
    window: [3, 5, 10, 15, 20].includes(Number(query.get("boardSmartWindow")))
      ? Number(query.get("boardSmartWindow")) : 5,
    sort: Object.hasOwn(smartMoneySorts, query.get("boardSmartSort"))
      ? query.get("boardSmartSort") : "main_net_inflow_cny",
    search: "", selected: null,
  };

  function smartMoneyWindow(row, windowSize) {
    return (row.windows || {})[String(windowSize)] || {};
  }

  function smartMoneyTopSecurities(row, windowSize) {
    return (row.top_securities || {})[String(windowSize)] || {};
  }

  function smartMoneySortedRows(rows, windowSize, sort, search) {
    const needle = String(search || "").trim().toLocaleLowerCase();
    return rows.filter((row) => `${row.industry_name} ${row.industry_code}`
      .toLocaleLowerCase().includes(needle)).slice().sort((left, right) => {
      const a = boardNumber(smartMoneyWindow(left, windowSize)[sort]);
      const b = boardNumber(smartMoneyWindow(right, windowSize)[sort]);
      if (a === null && b !== null) return 1;
      if (b === null && a !== null) return -1;
      if (a !== null && b !== null && a !== b) return b - a;
      return String(left.industry_name).localeCompare(String(right.industry_name), "zh-CN");
    });
  }

  function smartMoneyCoverage(bundle, windowSize, source) {
    const count = ((bundle.window_coverage || {})[String(windowSize)] || {})[source];
    return Number.isInteger(count) && count < windowSize ? `样本不足 ${count}/${windowSize}` : "";
  }

  function optionDirection(direction) {
    return { warming: "偏多", cooling: "偏空", neutral: "中性" }[direction] || direction || "—";
  }

  function optionIndexName(code) {
    return { "000016.SI": "上证 50", "000300.SI": "沪深 300", "000852.SI": "中证 1000" }[code] || code || "—";
  }

  function optionCount(value) {
    const numeric = boardNumber(value);
    if (numeric === null) return "—";
    return numeric >= 1e4 ? `${(numeric / 1e4).toFixed(1)}万`
      : numeric.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  }

  function optionCallShare(call, put) {
    const a = boardNumber(call);
    const b = boardNumber(put);
    return a === null || b === null || a < 0 || b < 0 || a + b === 0
      ? null : a / (a + b) * 100;
  }

  function smartNode(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className || "";
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function createSmartMoneyBar(value, scale) {
    const track = smartNode("div", "board-smart-bar");
    track.setAttribute("aria-hidden", "true");
    const numeric = boardNumber(value);
    if (numeric !== null) {
      const bar = smartNode("i", numeric >= 0 ? "is-positive" : "is-negative");
      const width = Math.min(50, Math.abs(numeric) / scale * 50);
      bar.style.width = `${width}%`;
      bar.style.left = `${numeric < 0 ? 50 - width : 50}%`;
      track.appendChild(bar);
    }
    return track;
  }

  function createSmartMoneyDetails(row, windowSize) {
    const panel = smartNode("section", "board-smart-details");
    panel.appendChild(smartNode("h4", "", `${row.industry_name} · 个股明细`));
    panel.appendChild(smartNode("p", "board-smart-muted", `最近 ${windowSize} 个交易日 · 每类默认前 3 条，可展开全部（最多 5 条）`));
    const top = smartMoneyTopSecurities(row, windowSize);
    for (const [source, title, metric] of [
      ["block_trade", "大宗交易 · 成交额", "amount_cny"],
      ["dragon_tiger", "龙虎榜 · 净买入", "net_buy_cny"],
      ["northbound", "北向十大活跃 · 成交额", "turnover_cny"],
    ]) {
      const section = smartNode("section", "board-smart-top");
      section.appendChild(smartNode("h5", "", title));
      const entries = Array.isArray(top[source]) ? top[source].slice(0, 5) : [];
      const cards = entries.map((entry) => {
        const card = smartNode("div", "board-smart-security");
        const heading = smartNode("div", "board-smart-security-heading");
        heading.append(smartNode("strong", "", entry.name || entry.security_id || "—"),
          smartNode("span", "", source === "dragon_tiger"
            ? formatBoardMoney(entry[metric]) : formatBoardAmount(entry[metric])));
        const detail = source === "block_trade"
          ? `买方：${entry.buyer_branch || "—"} · 卖方：${entry.seller_branch || "—"} · ${entry.count ?? "—"} 笔`
          : source === "dragon_tiger"
            ? `机构净买：${formatBoardMoney(entry.institution_net_buy_cny)} · 深股通净买：${formatBoardMoney(entry.northbound_net_buy_cny)}`
            : entry.market || "—";
        card.append(heading, smartNode("small", "board-smart-muted", detail));
        return card;
      });
      section.append(...cards.slice(0, 3));
      if (!entries.length) section.appendChild(smartNode("p", "board-smart-muted", "—"));
      if (entries.length > 3) {
        const more = smartNode("details", "board-smart-more");
        more.append(smartNode("summary", "", "展开全部 ▾"), ...cards.slice(3));
        section.appendChild(more);
      }
      panel.appendChild(section);
    }
    return panel;
  }

  function createSmartMoneyMetadata(bundle, family) {
    const details = smartNode("details", "board-smart-metadata");
    details.appendChild(smartNode("summary", "", "数据说明 ▾"));
    const facts = smartNode("div", "board-fact-grid");
    for (const [label, value] of [
      ["数据截至", family.data_as_of], ["可用时间", family.available_at],
      ["抓取时间", family.retrieved_at], ["方法", [family.methodology_id, family.methodology_version].filter(Boolean).join(" · ") || null],
      ["覆盖", family.coverage], ["分类版本", bundle.classification_revision],
      ["成员版本", bundle.membership_revision],
    ]) facts.appendChild(createFrozenFact(label, value));
    details.append(facts, createLimitations(family.limitations), createLimitations(bundle.limitations));
    return details;
  }

  function renderSmartMoneyIndustry(bundle, family) {
    const target = document.getElementById("smart-money-family");
    target.classList.add("board-smart-industry");
    replaceChildrenCompat(target);
    const heading = smartNode("header", "board-smart-heading");
    const title = smartNode("h3", "");
    const dates = Array.isArray(bundle.trade_dates) ? bundle.trade_dates : [];
    const stateLabel = { ok: "数据正常", partial: "部分数据", missing: "缺失" }[bundle.status] || "缺失";
    heading.append(title, smartNode("span", `board-status is-${bundle.status || "missing"}`,
      `${stateLabel} · 截至 ${dates.at(-1) || "—"}`));
    const metadata = createSmartMoneyMetadata(bundle, family || {});
    heading.appendChild(metadata);
    target.appendChild(heading);
    const controls = smartNode("div", "board-smart-controls");
    const windows = smartNode("div", "board-smart-windows");
    windows.setAttribute("role", "group");
    windows.setAttribute("aria-label", "聪明钱交易日窗口");
    const sortLabel = smartNode("label", "", "排序 ");
    const sort = smartNode("select", "");
    sort.setAttribute("aria-label", "聪明钱排序");
    for (const [key, label] of Object.entries(smartMoneySorts)) {
      const option = smartNode("option", "", `${label} ↓`);
      option.value = key;
      sort.appendChild(option);
    }
    sort.value = smartMoneyState.sort;
    sortLabel.appendChild(sort);
    const search = smartNode("input", "");
    search.type = "search";
    search.placeholder = "搜索行业…";
    search.setAttribute("aria-label", "搜索行业名称或代码");
    search.value = smartMoneyState.search;
    controls.append(windows, sortLabel, search);
    const layout = smartNode("div", "board-smart-layout");
    target.append(controls, layout);
    const columns = [
      ["main_net_inflow_cny", "主力净流入", "main_flow"],
      ["block_trade_amount_cny", "大宗交易（成交额 · 笔数）", "block_trade"],
      ["dragon_tiger_net_buy_cny", "龙虎榜净买入", "dragon_tiger"],
      ["northbound_turnover_cny", "北向活跃成交额（上榜只数）", "northbound"],
    ];
    function update() {
      const n = smartMoneyState.window;
      title.textContent = `聪明钱 · 申万一级行业 · 最近 ${n} 个交易日`;
      for (const button of windows.children) button.setAttribute("aria-pressed", String(Number(button.dataset.window) === n));
      const url = new URL(window.location.href);
      url.searchParams.set("boardSmartWindow", String(n));
      url.searchParams.set("boardSmartSort", smartMoneyState.sort);
      window.history.replaceState(null, "", url);
      replaceChildrenCompat(layout);
      const rows = smartMoneySortedRows(bundle.rows || [], n, smartMoneyState.sort, smartMoneyState.search);
      const selected = rows.find((row) => row.industry_code === smartMoneyState.selected) || rows[0];
      smartMoneyState.selected = selected?.industry_code || null;
      const table = smartNode("div", "board-smart-table");
      const head = smartNode("div", "board-smart-columns");
      head.appendChild(smartNode("span", "", "行业"));
      for (const [, label, source] of columns) {
        const cell = smartNode("span", "", label);
        cell.appendChild(smartNode("small", "board-smart-coverage", smartMoneyCoverage(bundle, n, source)));
        head.appendChild(cell);
      }
      table.appendChild(head);
      // 仅求显示比例尺（75 分位，少数极端行业不压扁其余柱；超出的柱顶满，数值照常标注），不求和、不补算任何窗口指标。
      const scales = Object.fromEntries(columns.map(([key]) => [key,
        boardLib.robustScale((bundle.rows || []).map((row) => smartMoneyWindow(row, n)[key]), 1, 0.75).limit]));
      for (const row of rows) {
        const card = smartNode("article", `board-smart-row${row === selected ? " is-selected" : ""}`);
        const name = smartNode("button", "board-smart-name", row.industry_name || row.industry_code);
        name.type = "button";
        name.setAttribute("aria-expanded", String(row === selected));
        name.addEventListener("click", () => { smartMoneyState.selected = row.industry_code; update(); });
        card.appendChild(name);
        const values = smartMoneyWindow(row, n);
        for (const [key, label, source] of columns) {
          const cell = smartNode("div", `board-smart-cell board-smart-${source}`);
          cell.appendChild(smartNode("small", "board-smart-cell-label", label));
          const signed = source === "main_flow" || source === "dragon_tiger";
          const numeric = boardNumber(values[key]);
          cell.appendChild(smartNode("span", signed && numeric !== null
            ? numeric > 0 ? "is-positive" : numeric < 0 ? "is-negative" : ""
            : "", signed ? formatBoardMoney(values[key]) : formatBoardAmount(values[key])));
          if (signed) cell.appendChild(createSmartMoneyBar(values[key], scales[key]));
          if (source === "block_trade") cell.appendChild(smartNode("small", "board-smart-muted", `${values.block_trade_count ?? "—"} 笔`));
          if (source === "northbound") cell.appendChild(smartNode("small", "board-smart-muted", `${values.northbound_stock_count ?? "—"} 只上榜`));
          cell.appendChild(smartNode("small", "board-smart-coverage board-smart-mobile-coverage", smartMoneyCoverage(bundle, n, source)));
          card.appendChild(cell);
        }
        // 点击整行与键盘按钮共享同一选择行为；明细交互不触发行选择。
        card.addEventListener("click", (event) => {
          if (event.target.closest("button, summary, .board-smart-details")) return;
          smartMoneyState.selected = row.industry_code; update();
        });
        if (row === selected) {
          const inline = createSmartMoneyDetails(row, n);
          inline.classList.add("board-smart-inline-details");
          card.appendChild(inline);
        }
        table.appendChild(card);
      }
      if (!rows.length) table.appendChild(smartNode("p", "board-empty", "没有匹配的行业。"));
      const notes = smartNode("div", "board-smart-notes");
      for (const text of [
        "主力净流入：大单与特大单净额，按行业成分股汇总；缺失不补零。",
        "大宗交易是场外协议成交，金额代表成交规模，不代表买卖方向。",
        "北向仅沪股通、深股通十大活跃成交股，不是北向总成交，也不含净流入。",
      ]) notes.appendChild(smartNode("p", "", text));
      table.appendChild(notes);
      layout.appendChild(table);
      if (selected) {
        const detail = createSmartMoneyDetails(selected, n);
        detail.classList.add("board-smart-side-details");
        layout.appendChild(detail);
      }
    }
    for (const n of [3, 5, 10, 15, 20]) {
      const button = smartNode("button", "", `${n} 日`);
      button.type = "button";
      button.dataset.window = String(n);
      button.addEventListener("click", () => { smartMoneyState.window = n; update(); });
      windows.appendChild(button);
    }
    sort.addEventListener("change", () => { smartMoneyState.sort = sort.value; update(); });
    search.addEventListener("input", () => { smartMoneyState.search = search.value; update(); });
    update();
  }

  function renderIndexOptions(family) {
    const target = document.getElementById("index-options-family");
    target.classList.add("board-options-family");
    replaceChildrenCompat(target);
    target.append(smartNode("h3", "", "指数期权 · 认购/认沽情绪"),
      smartNode("p", "board-smart-muted", "认沽/认购成交量比越低买涨的人越多（偏乐观），只作情绪参考，不参与选股"));
    const cards = smartNode("div", "board-options-grid");
    const entries = Array.isArray(family?.entries) ? family.entries : [];
    for (const entry of entries) {
      const card = smartNode("section", "board-option-card");
      const heading = smartNode("header", "");
      heading.append(smartNode("h4", "", optionIndexName(entry.underlying_id)),
        smartNode("span", `board-option-direction is-${entry.direction}`, optionDirection(entry.direction)));
      const metrics = entry.metrics || {};
      const ratio = boardNumber(metrics.put_call_volume_ratio);
      const readout = smartNode("div", "board-option-ratio");
      readout.append(smartNode("strong", "", ratio === null ? "—" : ratio.toFixed(2)),
        smartNode("small", "board-smart-muted", "认沽/认购成交量比"));
      card.append(heading, readout);
      for (const [title, callKey, putKey] of [["成交量", "call_volume", "put_volume"], ["持仓量", "call_oi", "put_oi"]]) {
        const labels = smartNode("div", "board-option-labels");
        labels.append(smartNode("small", "board-smart-muted", title),
          smartNode("span", "is-positive", `认购 ${optionCount(metrics[callKey])}`),
          smartNode("span", "is-negative", `认沽 ${optionCount(metrics[putKey])}`));
        const track = smartNode("div", "board-option-track");
        const share = optionCallShare(metrics[callKey], metrics[putKey]);
        if (share !== null) {
          const call = smartNode("i", "is-positive");
          const put = smartNode("i", "is-negative");
          call.style.width = `${share}%`;
          put.style.width = `${100 - share}%`;
          track.append(call, put);
        } else track.textContent = boardNumber(metrics[callKey]) === 0 && boardNumber(metrics[putKey]) === 0 ? "0" : "—";
        card.append(labels, track);
      }
      cards.appendChild(card);
    }
    if (!entries.length) cards.appendChild(smartNode("p", "board-empty", "指数期权数据缺失 · —"));
    target.appendChild(cards);
  }

  /**
   * 按契约单位格式化资金矩阵单元格。
   * 输入示例：0/CNY、null/pct；输出："0元"、"—"。
   */
  function formatMatrixValue(value, unit) {
    if (value === null || value === undefined || value === "") return "—";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    if (unit === "CNY") return formatBoardMoney(numeric);
    if (unit === "pct") return `${numeric.toFixed(Math.abs(numeric) < 1 ? 4 : 2)}%`;
    return numeric.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
  }

  /**
   * 渲染一张行业资金矩阵的完整冻结行列与元数据。
   * 输入示例：L1 日主力金额矩阵；输出：可展开表格，null 与零使用不同样式。
   */
  function createFundFlowMatrix(matrix) {
    const details = document.createElement("details");
    details.className = "board-matrix";
    const summary = document.createElement("summary");
    const title = document.createElement("strong");
    title.textContent = `${matrix.industry_level} · ${matrix.metric_id}`;
    const status = document.createElement("span");
    status.className = `board-status is-${String(matrix.status || "missing")}`;
    status.textContent = String(matrix.status || "missing");
    summary.append(title, status);

    const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
    const values = rows.flatMap((row) => Array.isArray(row.values) ? row.values : []);
    const finiteCount = values.filter((value) => Number.isFinite(Number(value)) && value !== null).length;
    const nullCount = values.filter((value) => value === null || value === undefined).length;
    const zeroCount = values.filter((value) => value !== null && Number(value) === 0).length;
    const metadata = document.createElement("p");
    metadata.className = "board-matrix-meta";
    metadata.textContent = [
      `source ${displayFrozenValue(matrix.source)}`,
      `method ${displayFrozenValue(matrix.methodology_id)}@${displayFrozenValue(matrix.methodology_version)}`,
      `data_as_of ${displayFrozenValue(matrix.data_as_of)}`,
      `available_at ${displayFrozenValue(matrix.available_at)}`,
      `retrieved_at ${displayFrozenValue(matrix.retrieved_at)}`,
      `覆盖 行 ${rows.length} · 有限值 ${finiteCount} · null ${nullCount} · 真实零 ${zeroCount}`,
    ].join(" · ");

    const scroll = document.createElement("div");
    scroll.className = "board-matrix-scroll";
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.textContent = "行业 / 日期";
    headRow.appendChild(corner);
    for (const date of matrix.dates || []) {
      const cell = document.createElement("th");
      cell.textContent = String(date);
      headRow.appendChild(cell);
    }
    head.appendChild(headRow);
    table.appendChild(head);
    const body = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      const name = document.createElement("th");
      name.textContent = String(row.industry_name || row.industry_code || "—");
      tr.appendChild(name);
      for (const value of row.values || []) {
        const cell = document.createElement("td");
        cell.textContent = formatMatrixValue(value, matrix.unit);
        cell.className = value === null || value === undefined
          ? "is-null"
          : Number(value) === 0 ? "is-zero" : "";
        tr.appendChild(cell);
      }
      body.appendChild(tr);
    }
    table.appendChild(body);
    scroll.appendChild(table);
    details.append(summary, metadata, scroll, createLimitations(matrix.limitations));
    return details;
  }

  /**
   * 渲染组合情报快照的三个 section 与来源限制。
   * 输入示例：合法 board-research-intelligence/v1；输出：2 个 family 与 16 张矩阵。
   */
  function renderIntelligence() {
    const intelligence = boardResearchSnapshot
      && boardResearchSnapshot.intelligence
      && typeof boardResearchSnapshot.intelligence === "object"
      ? boardResearchSnapshot.intelligence
      : null;
    const status = document.getElementById("board-intelligence-status");
    if (!intelligence) {
      status.textContent = String(
        (boardResearchPayload.intelligence || {}).reason
        || "board_research_intelligence_missing"
      );
      status.className = "board-status is-missing";
      renderIntelligenceFamily("smart-money-family", "聪明钱", null);
      renderIndexOptions(null);
      document.getElementById("board-fund-flow-provenance").textContent =
        "组合情报快照缺失；0 与 null 未被混淆，也未回读历史 P12。";
      return;
    }
    status.textContent = String(intelligence.schema_version || "ready");
    status.className = "board-status";
    if (intelligence.smart_money_by_industry) {
      renderSmartMoneyIndustry(intelligence.smart_money_by_industry, intelligence.smart_money);
    } else {
      renderIntelligenceFamily("smart-money-family", "聪明钱", intelligence.smart_money);
    }
    renderIndexOptions(intelligence.index_options);

    const flow = intelligence.industry_fund_flow || {};
    const matrices = Array.isArray(flow.matrices) ? flow.matrices : [];
    document.getElementById("board-fund-flow-count").textContent = `${matrices.length} / 16`;
    document.getElementById("board-fund-flow-provenance").textContent = [
      `分类版本 ${displayFrozenValue(flow.classification_revision)}`,
      `成员版本 ${displayFrozenValue(flow.membership_revision)}`,
      `来源状态 ${displayFrozenValue(flow.source_status)}`,
    ].join(" · ");
    const container = document.getElementById("board-fund-flow-matrices");
    replaceChildrenCompat(container, matrices.map(createFundFlowMatrix));

    const sourceLimitations = document.getElementById("board-source-limitations");
    replaceChildrenCompat(sourceLimitations);
    for (const [source, limitations] of Object.entries(intelligence.source_limitations || {})) {
      const block = document.createElement("div");
      const heading = document.createElement("strong");
      heading.textContent = source;
      block.append(heading, createLimitations(limitations));
      sourceLimitations.appendChild(block);
    }
    sourceLimitations.appendChild(createLimitations(flow.limitations));
  }

  /**
   * 挂载独立页导航；缺失目标隐藏，避免链接到历史 P12。
   * 输入示例：business.research 有值；输出：每日研究链接可用。
   */
  function mountBoardNavigation() {
    const business = navigation.business || {};
    const stages = navigation.stages || {};
    for (const link of document.querySelectorAll("[data-board-business-link]")) {
      const href = business[link.dataset.boardBusinessLink];
      link.href = href || "#";
      link.hidden = !href;
    }
    for (const link of document.querySelectorAll("[data-board-stage-link]")) {
      const href = stages[link.dataset.boardStageLink];
      link.href = href || "#";
      link.hidden = !href;
    }
    for (const link of document.querySelectorAll("[data-board-home-link]")) {
      link.href = navigation.home || "#";
    }
  }

  /**
   * 渲染 run 与快照边界摘要。
   * 输入示例：metadata.trade_date=2026-09-16；输出：顶栏显示日期与 run id。
   */
  function renderPageMetadata() {
    const metadata = pageData.metadata || {};
    document.getElementById("board-run-meta").textContent = [
      metadata.trade_date,
      metadata.run_id,
      metadata.as_of,
    ].filter(Boolean).join(" · ") || "离线板块研究";
    const ready = boardResearchActive();
    const statusNode = document.getElementById("board-page-status");
    statusNode.textContent = ready
      ? `数据正常 · 截至 ${metadata.trade_date || "—"}`
      : `数据不可用 · ${String(boardResearchPayload.reason || "unknown")}`;
    statusNode.title = ready ? `数据版本 ${boardResearchSnapshot.schema_version}` : "";
  }

  mountBoardNavigation();
  renderPageMetadata();
  if (boardSelectedCode && boardResearchActive()) {
    const linked = boardLib.classificationRows(
      boardResearchSnapshot,
      boardRadarState.classification
    ).find((item) => String(item.code || "") === boardSelectedCode);
    if (linked) boardRadarState.selectedKey = boardRowKey(linked);
  }
  renderBoardMarket();
  renderIntelligence();
})();
