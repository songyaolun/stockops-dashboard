// Pure helpers for the unified board-research workbench (app.js consumes the
// window.StockOpsBoardResearch namespace, same pattern as StockOpsBoard).
// No DOM access here so the behavior tests can evaluate these functions in
// plain Node; every missing upstream value stays null instead of zero.
(function () {
  "use strict";

  const SNAPSHOT_SCHEMA = "stockops.board-research.v1";
  const CLASSIFICATIONS = [
    { id: "ths", label: "同花顺行业/概念" },
    { id: "sw_l1", label: "申万一级" },
    { id: "sw_l2", label: "申万二级" },
  ];
  // Sort ids map 1:1 onto frozen period fields except "trading_crowding",
  // which is resolved from the preserved SW industry matrix of the same level.
  const SORTS = [
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
    ths: "同花顺",
    sw_l1: "申万一级",
    sw_l2: "申万二级",
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

  /** Rows of one classification only; classifications never mix data. */
  function classificationRows(snapshot, classification) {
    if (!isSnapshot(snapshot)) return [];
    const wanted = String(classification || "");
    return snapshot.rows
      .filter((row) => row && typeof row === "object" && String(row.classification) === wanted)
      .map((row) => ({ ...row, key: rowKey(row) }));
  }

  /** Legacy board_market rows adapted to the shared shape with no period data. */
  function legacyRows(boardMarket) {
    const source = boardMarket && typeof boardMarket === "object" ? boardMarket : {};
    const rows = [];
    for (const taxonomy of ["concept", "industry"]) {
      const payload = source[taxonomy];
      const payloadRows = payload && Array.isArray(payload.rows) ? payload.rows : [];
      for (const row of payloadRows) {
        if (!row || typeof row !== "object") continue;
        rows.push({ ...row, taxonomy: row.taxonomy || taxonomy, classification: "ths", id: null, periods: null, key: rowKey({ ...row, taxonomy: row.taxonomy || taxonomy }) });
      }
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
    const metricId = String(sortId || "return_pct");
    const level = String(windowKey || "20d");
    const values = new Map();
    for (const row of rows) {
      values.set(
        rowKey(row),
        metricId === "trading_crowding"
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
   * Display-only coverage of one fund field over the visible dates: finite
   * values per date (null = missing, 0 = real zero) and the missing dates.
   * No business total or ratio is derived; those stay backend period fields.
   */
  function flowCoverage(row, dates, field) {
    const source = Array.isArray(dates) ? dates.map(String) : [];
    const values = source.map((dateKey) => {
      const point = pointOnDate(row, dateKey);
      return point ? finiteNumber(point[field]) : null;
    });
    return {
      field,
      expectedCount: source.length,
      validCount: values.filter((value) => value !== null).length,
      missingDates: source.filter((_, index) => values[index] === null),
      values,
    };
  }

  /**
   * One linear amount scale shared by every coverage handed in: the largest
   * absolute finite value, or null when nothing is finite. No minimum floor,
   * so a small real amount is never enlarged; 0 means "only real zeros".
   */
  function flowScale(coverages) {
    let maximum = null;
    for (const coverage of Array.isArray(coverages) ? coverages : []) {
      for (const value of coverage.values) {
        if (value === null) continue;
        maximum = Math.max(maximum === null ? 0 : maximum, Math.abs(value));
      }
    }
    return maximum;
  }

  /** Bar half-height share (0..1) of one value on the shared scale; real zero and missing give 0. */
  function flowRatio(value, scale) {
    if (value === null || !scale) return 0;
    return Math.min(1, Math.abs(value) / scale);
  }

  /** Lane state: empty (no finite day), partial (some days missing) or full. */
  function flowState(coverage) {
    if (coverage.validCount === 0) return "empty";
    return coverage.validCount < coverage.expectedCount ? "partial" : "full";
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
    period,
    periodFieldValue,
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
    flowCoverage,
    flowScale,
    flowRatio,
    flowState,
  };
})();
