// Pure helpers for the unified board-research workbench (app.js consumes the
// window.StockOpsBoardResearch namespace, same pattern as StockOpsBoard).
// No DOM access here so the behavior tests can evaluate these functions in
// plain Node; every missing upstream value stays null instead of zero.
(function () {
  "use strict";

  const SNAPSHOT_SCHEMA = "stockops.board-research.v1";
  const CLASSIFICATIONS = [
    { id: "ths", label: "同花顺概念" },
    { id: "sw_l1", label: "申万一级行业" },
    { id: "sw_l2", label: "申万二级行业" },
  ];
  // The ths classification only ever shows concepts whose provenance names a
  // THS provider; anything else (THS industry, Eastmoney/DC concepts, unknown
  // sources) fails closed instead of silently mixing taxonomies.
  function isTrustedThsSource(value) {
    const source = typeof value === "string" ? value.trim() : "";
    return source === "tushare" || source === "akshare_ths" || source.startsWith("tushare_ths");
  }
  // Sort ids map 1:1 onto frozen period fields except the backend-owned MACD
  // regime and SW trading crowding projections.
  const SORTS = [
    { id: "macd_regime", label: "中短期趋势（强到弱）" },
    { id: "return_pct", label: "周期涨幅" },
    { id: "net_inflow", label: "净流入金额" },
    { id: "verified_main_net_inflow", label: "主力净流入" },
    { id: "net_inflow_to_amount_pct", label: "净流入占成交额" },
    { id: "main_net_inflow_to_amount_pct", label: "主力净流入占成交额" },
    { id: "gross_inflow_to_amount_pct", label: "总流入占成交额" },
    { id: "main_buy_share_pct", label: "主力买入占总买入" },
    { id: "trading_crowding", label: "拥挤度（申万同级）" },
  ];
  const THS_HEATMAP_METRICS = [
    { id: "pct_chg", label: "日涨跌" },
    { id: "net_inflow", label: "净流入" },
    { id: "verified_main_net_inflow", label: "真实主力净流入" },
    { id: "amount", label: "日成交" },
  ];
  const CLASSIFICATION_LABELS = {
    ths: "同花顺概念",
    sw_l1: "申万一级行业",
    sw_l2: "申万二级行业",
  };

  function isSnapshot(value) {
    return Boolean(
      value
      && typeof value === "object"
      && value.schema_version === SNAPSHOT_SCHEMA
      && Array.isArray(value.rows)
    );
  }

  /**
   * Convert one optional scalar to a finite number. Only real numbers and
   * non-blank numeric strings count; booleans, blank/whitespace strings,
   * arrays, objects, null and undefined are missing. Zero is a real value.
   */
  function finiteNumber(value) {
    if (typeof value === "boolean" || value === null || value === undefined) {
      return null;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const numeric = Number(trimmed);
      return Number.isFinite(numeric) ? numeric : null;
    }
    return null;
  }

  /** Stable identity: source-internal id when present, legacy taxonomy:name fallback. */
  function rowKey(row) {
    const id = row && row.id;
    if (id !== null && id !== undefined && String(id) !== "") return String(id);
    return `${String((row && row.taxonomy) || "unknown")}:${String((row && row.name) || "")}`;
  }

  function classificationLabel(id) {
    return CLASSIFICATION_LABELS[String(id || "")] || String(id || "未知");
  }

  /**
   * Legacy provenance of one old board_market concept row: the row's own
   * per-day source fields plus the matching shared timeline series source.
   * Only explicit, uniformly THS sources count; absent, mixed or foreign
   * (e.g. akshare_eastmoney) sources leave the row unverifiable and it is
   * dropped rather than trusted.
   */
  function legacyRowSources(boardMarket, taxonomy, name) {
    const sources = new Set();
    const payload = boardMarket
      && typeof boardMarket === "object"
      && boardMarket[taxonomy]
      && typeof boardMarket[taxonomy] === "object"
        ? boardMarket[taxonomy]
        : null;
    const rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      if (String(row.name || "") !== name) continue;
      for (const field of ["source", "source_1d", "source_20d", "source_60d"]) {
        const value = typeof row[field] === "string" ? row[field].trim() : "";
        if (value) sources.add(value);
      }
    }
    const timeline = boardMarket && typeof boardMarket === "object"
      ? boardMarket.timeline
      : null;
    const series = timeline && Array.isArray(timeline.series) ? timeline.series : [];
    for (const entry of series) {
      if (!entry || typeof entry !== "object") continue;
      if (String(entry.taxonomy || "") !== taxonomy) continue;
      if (String(entry.name || "") !== name) continue;
      const value = typeof entry.source === "string" ? entry.source.trim() : "";
      if (value) sources.add(value);
      const points = Array.isArray(entry.points) ? entry.points : [];
      for (const point of points) {
        const pointSource = typeof point?.source === "string" ? point.source.trim() : "";
        if (pointSource) sources.add(pointSource);
      }
    }
    return sources;
  }

  /** True only when every declared source names a trusted THS provider. */
  function hasTrustedThsSource(sources) {
    if (!sources || !sources.size) return false;
    for (const source of sources) {
      if (!isTrustedThsSource(source)) return false;
    }
    return true;
  }

  /** Rows of one classification only; classifications never mix data. The
   *  ths classification is concept-only: THS industry rows, DC concepts and
   *  rows without an explicit trusted THS source never enter the projection. */
  function classificationRows(snapshot, classification) {
    if (!isSnapshot(snapshot)) return [];
    const wanted = String(classification || "");
    return snapshot.rows
      .filter((row) => row && typeof row === "object" && String(row.classification) === wanted)
      .filter((row) => {
        if (wanted !== "ths") return true;
        return String(row.taxonomy) === "concept"
          && hasTrustedThsSource(
            typeof row.source === "string" && row.source.trim()
              ? new Set([row.source.trim()])
              : null
          );
      })
      .map((row) => ({ ...row, key: rowKey(row) }));
  }

  /**
   * Legacy board_market rows adapted to the shared shape with no period data.
   * Only concepts with provable THS provenance are projected; legacy industry
   * rows and unverified concept sources stay out of the concept list.
   */
  function legacyRows(boardMarket) {
    const source = boardMarket && typeof boardMarket === "object" ? boardMarket : {};
    const rows = [];
    const payload = source.concept;
    const payloadRows = payload && Array.isArray(payload.rows) ? payload.rows : [];
    for (const row of payloadRows) {
      if (!row || typeof row !== "object") continue;
      const taxonomy = row.taxonomy || "concept";
      if (taxonomy !== "concept") continue;
      const name = String(row.name || "");
      if (!hasTrustedThsSource(legacyRowSources(source, "concept", name))) continue;
      rows.push({ ...row, taxonomy, classification: "ths", id: null, periods: null, key: rowKey({ ...row, taxonomy }) });
    }
    return rows;
  }

  /** One frozen period record or null; the backend is the only formula owner. */
  function period(row, windowKey) {
    const periods = row && row.periods;
    if (!periods || typeof periods !== "object") return null;
    const record = periods[String(windowKey)];
    return record && typeof record === "object" ? record : null;
  }

  /** Sort field of one row's period; crowding is resolved separately. */
  function periodFieldValue(row, windowKey, field) {
    const record = period(row, windowKey);
    if (!record) return null;
    return finiteNumber(record[field]);
  }

  /**
   * Read one backend-owned MACD regime without reproducing its sign formula.
   * Invalid ids, labels or priorities fail closed so sorting cannot invent a
   * state from partial values.
   */
  function macdRegime(row) {
    const macd = row && row.macd;
    const regime = macd && typeof macd === "object" ? macd.regime : null;
    if (!regime || typeof regime !== "object") return null;
    const id = String(regime.id || "");
    const label = String(regime.label || "");
    const description = String(regime.description || "");
    const priority = finiteNumber(regime.priority);
    if (!new Set([
      "medium_bullish_short_bullish",
      "medium_bullish_short_pullback",
      "medium_bearish_short_rebound",
      "medium_bearish_short_bearish",
    ]).has(id) || !label || !description || priority === null) {
      return null;
    }
    return {
      id,
      label,
      description,
      priority,
      dif: finiteNumber(macd.dif),
      dea: finiteNumber(macd.dea),
      histogram: finiteNumber(macd.histogram),
      histogramConvention: String(macd.histogram_convention || ""),
    };
  }

  /** Latest SW trading-crowding per industry code, as preserved in the frozen matrix. */
  function crowdingByCode(snapshot, level) {
    const values = new Map();
    const matrix = swMatrix(snapshot, "trading_crowding", level);
    if (!matrix) return values;
    for (const row of matrix.rows || []) {
      const value = finiteNumber(
        Array.isArray(row.values) ? row.values[row.values.length - 1] : null
      );
      if (value !== null) values.set(String(row.industry_code), value);
    }
    return values;
  }

  /**
   * Crowding used for sorting: prefer the backend's latest_advanced value,
   * which is truncated to the run's trade_date. The raw matrix tail may hold
   * sessions beyond the trade date, so it never feeds the ranking.
   */
  function rowCrowdingValue(row) {
    const advanced = row && row.latest_advanced;
    const entry = advanced && typeof advanced === "object"
      ? advanced.trading_crowding
      : null;
    return entry && typeof entry === "object"
      ? finiteNumber(entry.value)
      : null;
  }

  /**
   * Frontend classification ids (sw_l1/sw_l2) and the frozen bundle's matrix
   * levels (L1/L2) both resolve to the contract level; anything else —
   * including passing a lowercase id as a matrix level — fails closed.
   */
  function swMatrixLevel(level) {
    return { sw_l1: "L1", sw_l2: "L2", L1: "L1", L2: "L2" }[String(level || "")] || null;
  }

  /** One SW matrix by metric and level, or null when the bundle lacks it. */
  function swMatrix(snapshot, metricId, level) {
    const wantedLevel = swMatrixLevel(level);
    if (!wantedLevel) return null;
    const industry = snapshot && snapshot.industry_snapshot;
    const matrices = industry && Array.isArray(industry.matrices)
      ? industry.matrices
      : [];
    return matrices.find((matrix) => (
      matrix
      && String(matrix.metric_id) === String(metricId)
      && String(matrix.industry_level) === wantedLevel
    )) || null;
  }

  /** Distinct SW matrix metric ids available for one level, bundle order. */
  function swMatrixMetricIds(snapshot, level) {
    const wantedLevel = swMatrixLevel(level);
    if (!wantedLevel) return [];
    const industry = snapshot && snapshot.industry_snapshot;
    const matrices = industry && Array.isArray(industry.matrices)
      ? industry.matrices
      : [];
    const seen = new Set();
    const ids = [];
    for (const matrix of matrices) {
      if (!matrix || String(matrix.industry_level) !== wantedLevel) continue;
      const id = String(matrix.metric_id);
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  /**
   * SW heatmap aligned to the shared window date columns of one
   * classification. Rows are the caller's already-filtered, already-sorted
   * list; each maps to a preserved matrix row by explicit industry code and
   * keeps its real key. Missing dates or codes stay null — never backfilled
   * from other levels, metrics or THS dates. Duplicate shared dates or
   * duplicate matrix codes fail closed (null), they are never deduped.
   */
  function swHeatmap(snapshot, metricId, classification, windowKey, rows) {
    const level = swMatrixLevel(classification);
    const source = Array.isArray(rows) ? rows : [];
    if (!level || !source.length) return { dates: [], rows: [] };
    const matrix = swMatrix(snapshot, metricId, level);
    const dates = sharedWindowDates(snapshot, classification, windowKey);
    if (!matrix || !dates.length) return { dates: [], rows: [], insufficient: true };
    if (new Set(dates).size !== dates.length) return null;
    const seenCodes = new Set();
    for (const row of matrix.rows || []) {
      const code = String((row && row.industry_code) || "");
      if (!code || seenCodes.has(code)) return null;
      seenCodes.add(code);
    }
    const matrixDates = (matrix.dates || []).map(String);
    // A duplicated matrix date would make indexOf pick the first column
    // silently; fail closed like duplicated codes do.
    if (new Set(matrixDates).size !== matrixDates.length) return null;
    const byCode = new Map();
    for (const row of matrix.rows || []) {
      byCode.set(String(row.industry_code), row);
    }
    const expectedSessions = String(windowKey) === "60d" ? 60 : 20;
    const insufficient = dates.length < expectedSessions;
    const project = (series) => dates.map((date) => {
      const matrixIndex = matrixDates.indexOf(String(date));
      if (matrixIndex < 0 || !Array.isArray(series)) return null;
      const value = series[matrixIndex];
      return value === undefined ? null : value;
    });
    return {
      dates,
      insufficient,
      unit: matrix.unit,
      methodology: matrix.methodology_id,
      status: matrix.status,
      rows: source.map((row) => {
        const code = String(row.code || "");
        const matrixRow = byCode.get(code);
        return {
          key: row.key,
          code,
          name: String(row.name || "—"),
          values: matrixRow ? project(matrixRow.values) : dates.map(() => null),
          quality: matrixRow ? project(matrixRow.quality) : dates.map(() => null),
        };
      }),
    };
  }

  /** Sort rows by one metric; missing values keep last, ties stay deterministic. */
  function sortRows(rows, sortId, windowKey) {
    const metricId = String(sortId || "macd_regime");
    const level = String(windowKey || "20d");
    const values = new Map();
    for (const row of rows) {
      values.set(
        rowKey(row),
        metricId === "macd_regime"
          ? macdRegime(row)?.priority ?? null
          : metricId === "trading_crowding"
            ? rowCrowdingValue(row)
            : periodFieldValue(row, level, metricId)
      );
    }
    return [...rows].sort((left, right) => {
      const leftValue = values.get(rowKey(left));
      const rightValue = values.get(rowKey(right));
      if (leftValue === null && rightValue !== null) return 1;
      if (rightValue === null && leftValue !== null) return -1;
      if (leftValue !== rightValue) return (rightValue || 0) - (leftValue || 0);
      return rowKey(left).localeCompare(rowKey(right), "zh-CN");
    });
  }

  /** Keep the selection id inside one already-filtered row set, else the first row. */
  function resolveSelection(rows, selectedKey) {
    if (selectedKey !== null && rows.some((row) => row.key === selectedKey)) {
      return selectedKey;
    }
    return rows.length ? rows[0].key : null;
  }

  /** Shared date columns of one classification and window, per the frozen backend windows. */
  function sharedWindowDates(snapshot, classification, windowKey) {
    if (!isSnapshot(snapshot)) return [];
    const windows = snapshot.windows;
    const perClassification = windows && typeof windows === "object"
      ? windows[String(classification)]
      : null;
    const projected = perClassification && typeof perClassification === "object"
      ? perClassification[String(windowKey)]
      : null;
    return Array.isArray(projected) ? projected.map(String) : [];
  }

  /** Point of one row on an exact shared date; absent dates stay absent. */
  function pointOnDate(row, dateKey) {
    const points = Array.isArray(row && row.points) ? row.points : [];
    return points.find((point) => (
      point && typeof point === "object" && String(point.date) === dateKey
    )) || null;
  }

  /**
   * THS heatmap table aligned to the shared window date columns. Rows are the
   * caller's already-filtered rows; every cell reads the point of that exact
   * shared date, and missing dates stay null instead of borrowing a newer day.
   */
  function thsHeatmap(snapshot, metricId, windowKey, rows) {
    const source = Array.isArray(rows)
      ? rows
      : classificationRows(snapshot, "ths");
    const dates = sharedWindowDates(snapshot, "ths", windowKey);
    if (!dates.length || !source.length) {
      return { dates: [], rows: [] };
    }
    return {
      dates,
      rows: source.map((row) => ({
        key: row.key,
        name: String(row.name || "—"),
        values: dates.map((dateKey) => {
          const point = pointOnDate(row, dateKey);
          return point ? finiteNumber(point[metricId]) : null;
        }),
      })),
    };
  }

  /** Latest finite point field of one row; the date axis stays per source. */
  function latestPoint(row, field) {
    const points = Array.isArray(row && row.points) ? row.points : [];
    let latest = null;
    let latestDate = null;
    for (const point of points) {
      if (!point || typeof point !== "object") continue;
      const dateKey = String(point.date || "");
      if (!dateKey) continue;
      if (latestDate === null || dateKey > latestDate) {
        latestDate = dateKey;
        latest = point;
      }
    }
    if (!latest) return { date: null, value: null };
    return { date: latestDate, value: finiteNumber(latest[field]) };
  }

  /**
   * 柱状图比例尺：取绝对值的分位数（默认 95 分位，多行共用时防止极端值压扁其余柱；
   * 单行详情图传 1 即取最大值，不截断任何一天），且不小于 floor。
   * 输入示例：[1, 2, 3, 100]、floor 1；输出：{ limit, clipped }，limit 为满格对应的
   * 数值，clipped 为超出满格而被截到满格的个数。
   */
  function robustScale(values, floor, quantileLevel) {
    const magnitudes = (Array.isArray(values) ? values : [])
      .map((value) => finiteNumber(value))
      .filter((value) => value !== null)
      .map((value) => Math.abs(value))
      .sort((left, right) => left - right);
    const minimum = Number.isFinite(floor) && floor > 0 ? floor : 1;
    if (!magnitudes.length) return { limit: minimum, clipped: 0 };
    const level = Number.isFinite(quantileLevel) && quantileLevel > 0 && quantileLevel <= 1 ? quantileLevel : 0.95;
    const position = (magnitudes.length - 1) * level;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const quantile = lower === upper
      ? magnitudes[lower]
      : magnitudes[lower] + (magnitudes[upper] - magnitudes[lower]) * (position - lower);
    const limit = Math.max(quantile, minimum);
    return { limit, clipped: magnitudes.filter((value) => value > limit).length };
  }

  window.StockOpsBoardResearch = {
    SNAPSHOT_SCHEMA,
    CLASSIFICATIONS,
    SORTS,
    THS_HEATMAP_METRICS,
    isSnapshot,
    finiteNumber,
    rowKey,
    classificationLabel,
    classificationRows,
    legacyRows,
    legacyRowSources,
    hasTrustedThsSource,
    period,
    periodFieldValue,
    macdRegime,
    crowdingByCode,
    rowCrowdingValue,
    swMatrix,
    swMatrixLevel,
    swMatrixMetricIds,
    swHeatmap,
    sortRows,
    resolveSelection,
    sharedWindowDates,
    pointOnDate,
    latestPoint,
    thsHeatmap,
    robustScale,
  };
})();
