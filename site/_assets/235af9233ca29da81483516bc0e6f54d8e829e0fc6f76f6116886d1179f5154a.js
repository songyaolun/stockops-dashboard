// Renders the dashboard index, then lazy-loads one immutable market snapshot
// when a stock is selected. Dynamic script tags also work when opened locally.
(function () {
  "use strict";

  const data = window.__STOCKOPS_DATA__ || {};
  // board.js/format.js are loaded before this IIFE (see dashboard.html).
  const boardTag = window.StockOpsBoard.boardTag;
  const formatPercent = window.StockOpsFormat.percent;
  const rankingSnapshot = data.ranking_snapshot || {};
  const canonicalRanking = String(rankingSnapshot.mode) === "canonical";
  const requestedSnapshotId = new URLSearchParams(window.location.search).get("snapshot_id");
  const rankingIdentityMismatch = Boolean(
    canonicalRanking
    && requestedSnapshotId
    && requestedSnapshotId !== String(rankingSnapshot.snapshot_id || "")
  );
  const rawScreenResults = Array.isArray(data.screen_results) ? data.screen_results : [];
  const screenResults = rankingIdentityMismatch ? [] : rawScreenResults;
  const fullScreenCount = rankingIdentityMismatch
    ? 0
    : Number(data.full_screen_count) || screenResults.length;
  const aiAnalysisCount = Number(
    data.ai_analysis_count !== undefined ? data.ai_analysis_count : data.ai_focus_count
  ) || 0;
  const aiReport = data.ai_report || {};
  const researchHierarchy = data.research_hierarchy || {};
  const sourceStatus = data.source_status || {};
  const marketFiles = data.market_files || {};
  const remoteMarket = data.remote_market || {};
  const marketSummaries = data.market_summaries || {};
  const marketByCode = window.__STOCKOPS_MARKET__ || {};
  window.__STOCKOPS_MARKET__ = marketByCode;
  const indicatorParams = data.indicator_params || {};
  const history = data.history && typeof data.history === "object" ? data.history : {};
  const historyDays = Array.isArray(history.days) ? history.days : [];
  const candidateComparisons = data.candidate_comparisons || {};
  const configuredStrategies = Array.isArray(data.strategy_observations)
    ? data.strategy_observations
    : [];
  const configuredRules = Array.isArray(data.selection_rule_observations)
    ? data.selection_rule_observations
    : [];
  const strategyLanes = Array.isArray(data.strategy_lanes) ? data.strategy_lanes : [];
  const stage = data.stage || null;
  const companyQuality = data.company_quality || {};
  const maxScore = Number(data.max_score) || 0;
  const evidenceGroupLabels = data.evidence_group_labels || {};

  function evidenceGroupLabel(groupId) {
    // Convert stable internal IDs into Chinese product language while keeping
    // unknown IDs visible for contract-drift diagnosis.
    const normalizedGroupId = String(groupId || "");
    if (!normalizedGroupId) return "未分组";
    return evidenceGroupLabels[normalizedGroupId]
      || `未知证据组（${normalizedGroupId}）`;
  }
  const fieldLabels = {
    average_amount_20d_cny: "20日平均成交额",
    structural_stop_qfq_cny: "前复权结构止损价",
    structural_stop: "前复权结构止损价",
    capital_efficiency_evidence_score: "资金效率证据分",
  };
  const reasonLabels = {
    market_age_lt_250: "新股历史不足（上市交易日不足250天）",
    stock_common_session_missing: "已上市交易日行情缺失（已触发一次全量补拉）",
    status_unknown: "历史交易状态无法确认",
    daily_status_missing: "历史交易状态数据缺失",
    average_amount_not_above_30m_cny: "流动性不足（20日平均成交额低于3000万元）",
    recent_valid_bars_lt_20: "最近20个交易日有效行情不足",
    structural_stop_missing: "前复权结构止损价暂无法计算",
  };
  function displayField(value) {
    return fieldLabels[String(value || "")] || "数据字段缺失";
  }
  function displayReason(value) {
    return reasonLabels[String(value || "").split(":", 1)[0]] || "数据完整性或规则限制";
  }
  function publishStatus(value) {
    return value === true
      ? "可公开展示（有正向证据）"
      : "暂不公开展示（缺少可公开的正向证据）";
  }
  const taskType = String(aiReport.task_type || "daily");
  const mobileViewport = typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 900px)")
    : { matches: Number(window.innerWidth) <= 900 };

  const opinions = new Map(
    (aiReport.stock_opinions || []).map((item) => [String(item.code), String(item.opinion)])
  );
  const resultsByCode = new Map(screenResults.map((item) => [String(item.code), item]));
  let activeStrategyGroup = null;
  let activeStrategy = null;
  let activeRule = null;
  let activeRisk = null;
  let activeComparisonPeriod = "previous";
  let activeComparisonFilter = null;
  let currentCode = null;
  let overlayIds = [];
  let mobileCandidatesExpanded = false;
  let openComparisonList = null;
  const marketLoads = {};

  function companyStatus(value) {
    return {
      ok: { label: "数据已复核", className: "is-ok" },
      degraded: { label: "降级数据", className: "is-degraded" },
      conflict: { label: "多源有差异", className: "is-conflict" },
      missing: { label: "数据待补", className: "is-missing" },
    }[String(value || "missing")] || { label: "状态未知", className: "is-missing" };
  }

  function companyNumber(value, suffix, digits, signed) {
    if (value === null || value === undefined || value === "") return "—";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    return `${signed && numeric > 0 ? "+" : ""}${numeric.toFixed(digits)}${suffix}`;
  }

  function companyMetric(label, value, note) {
    const cell = document.createElement("div");
    cell.className = "company-metric";
    const caption = document.createElement("span");
    caption.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value;
    const detail = document.createElement("small");
    detail.textContent = note;
    cell.append(caption, content, detail);
    return cell;
  }

  function companyMoney(value) {
    if (value === null || value === undefined || value === "") return "—";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    if (Math.abs(numeric) >= 100000000) {
      return `${(numeric / 100000000).toFixed(1)} 亿元`;
    }
    if (Math.abs(numeric) >= 10000) {
      return `${(numeric / 10000).toFixed(1)} 万元`;
    }
    return `${numeric.toFixed(0)} 元`;
  }

  const marketLeadershipEvidence =
    (data.market_leadership_evidence && data.market_leadership_evidence.candidates) || {};

  const sectorHeatEvidence =
    (data.sector_heat_evidence && data.sector_heat_evidence.candidates) || {};

  // Every matched candidate shows its board name; only one whose board is
  // both inside today's top 9% AND backed by a fully live (non-cached, wide
  // enough) ranking gets the 🔥 emphasis — see
  // stockops.research.sector_heat's highlight_data_reliable fail-closed
  // guard. A candidate with no board match shows nothing (no guessing).
  function sectorHeatBadge(code) {
    const entry = sectorHeatEvidence[code];
    if (!entry || !entry.available) return null;
    const badge = document.createElement("span");
    const rankNote = typeof entry.rank_5d === "number" ? `5日涨幅排名第${entry.rank_5d}、` : "";
    if (entry.highlight) {
      badge.className = "sector-heat-badge is-hot";
      badge.title = `所属板块「${entry.board_name}」${rankNote}进入今日前9%强板块` +
        "（东方财富/同花顺板块口径，非申万分类，仅供人工参考，不影响排序）";
      badge.textContent = `🔥 ${entry.board_name}`;
    } else {
      badge.className = "sector-heat-badge";
      badge.title = `所属板块「${entry.board_name}」${rankNote}` +
        "（东方财富/同花顺板块口径，非申万分类，仅供人工参考，不影响排序）";
      badge.textContent = entry.board_name;
    }
    return badge;
  }

  /**
   * Research link for one candidate's sector-heat evidence. Only an explicit
   * industry code plus a mappable SW level may deep-link into the board
   * workbench; anything else stays a missing note instead of a name-based
   * cross-source guess.
   */
  function sectorHeatResearchLink(code) {
    const entry = sectorHeatEvidence[String(code)];
    if (!entry || !entry.available) return null;
    const classification = {
      sw_l1: "sw_l1",
      L1: "sw_l1",
      sw_l2: "sw_l2",
      L2: "sw_l2",
    }[String(entry.industry_level || "")];
    const industryCode = entry.industry_code ? String(entry.industry_code) : "";
    const node = document.createElement(classification && industryCode ? "a" : "span");
    node.className = "sector-heat-research-link";
    if (classification && industryCode) {
      const boardResearchHref = (
        data.navigation
        && data.navigation.business
        && data.navigation.business.board_research
      ) || "board-research.html";
      node.href = `${boardResearchHref.split("?")[0]}?boardView=heatmap`
        + `&boardClassification=${classification}`
        + `&boardSelected=${encodeURIComponent(industryCode)}`;
      node.textContent = "行业研究 →";
      node.title = `按明确分类（${classification} · ${industryCode}）打开板块研究；不按名称跨源匹配，不改评分。`;
    } else {
      node.textContent = "行业研究 · 分类缺失";
      node.title = "该行业证据没有明确的行业代码与层级；不按名称跨源跳转。";
    }
    return node;
  }

  function leadershipInputRow(label, entry, formatValue) {
    const row = document.createElement("div");
    row.className = "leadership-input-row";
    const name = document.createElement("span");
    name.textContent = label;
    const value = document.createElement("span");
    value.textContent = entry && entry.available
      ? formatValue(entry)
      : "数据不足";
    value.className = entry && entry.available ? "" : "leadership-value-missing";
    row.append(name, value);
    return row;
  }

  function renderLeadershipEvidencePanel(target, code) {
    if (!target) return;
    replaceChildrenCompat(target);
    if (!code) {
      const empty = document.createElement("p");
      empty.className = "leadership-panel-empty";
      empty.textContent = "选择候选股后显示龙头与相对强度研究证据。";
      target.appendChild(empty);
      return;
    }

    const card = marketLeadershipEvidence[code];
    const section = document.createElement("section");
    section.className = "leadership-evidence-card";

    const heading = document.createElement("div");
    heading.className = "leadership-card-heading";
    const title = document.createElement("div");
    const eyebrow = document.createElement("small");
    eyebrow.textContent = "MARKET LEADERSHIP · 仅供参考";
    const name = document.createElement("h2");
    name.textContent = "龙头与相对强度研究证据";
    title.append(eyebrow, name);
    heading.appendChild(title);
    section.appendChild(heading);

    // A missing card is a real finding (outside the research universe or no
    // research run yet), not an error — show it plainly instead of a 0 score.
    if (!card || card.available === false) {
      const empty = document.createElement("p");
      empty.className = "leadership-panel-empty";
      empty.textContent = "当前运行没有该股票的研究证据（不在研究样本池内或研究尚未覆盖）。";
      section.appendChild(empty);
      target.appendChild(section);
      return;
    }

    const note = document.createElement("p");
    note.className = "leadership-shadow-note";
    note.textContent = card.shadow_score === null || card.shadow_score === undefined
      ? "样本覆盖不足，暂无 shadow 分数。"
      : `Shadow 参考分 ${(card.shadow_score * 100).toFixed(0)}%（覆盖权重 ${(card.shadow_score_coverage * 100).toFixed(0)}%）· 不影响候选排序或总分`;
    section.appendChild(note);

    const inputs = card.inputs || {};
    const rows = document.createElement("div");
    rows.className = "leadership-inputs";
    rows.appendChild(
      leadershipInputRow(
        "下跌抗跌强度（60日窗口分位）",
        inputs.down_alpha_rank_pct,
        (entry) => `${(entry.value * 100).toFixed(0)}%`
      )
    );
    rows.appendChild(
      leadershipInputRow(
        "上涨进攻强度（60日窗口分位）",
        inputs.up_alpha_rank_pct,
        (entry) => `${(entry.value * 100).toFixed(0)}%`
      )
    );
    rows.appendChild(
      leadershipInputRow(
        "龙头证据",
        inputs.leader_evidence,
        (entry) => {
          const risk = entry.overheated_risk ? "（过热风险）" : "";
          return `${entry.label || "—"}${risk}`;
        }
      )
    );
    rows.appendChild(
      leadershipInputRow(
        "既有相对强度分位",
        inputs.existing_rs,
        (entry) => `${(entry.value * 100).toFixed(0)}%`
      )
    );
    rows.appendChild(
      leadershipInputRow(
        "板块持续性",
        inputs.board_persistence,
        (entry) => `${(entry.value * 100).toFixed(0)}%`
      )
    );
    section.appendChild(rows);

    if (card.missing_inputs) {
      const missing = document.createElement("p");
      missing.className = "leadership-missing-note";
      missing.textContent = `缺失说明：${card.missing_inputs}`;
      section.appendChild(missing);
    }

    target.appendChild(section);
  }

  function renderCompanyDecisionPanel(target, code, contextLabel) {
    if (!target) return;
    replaceChildrenCompat(target);
    const card = companyQuality.cards && companyQuality.cards[code];
    if (!code) {
      const empty = document.createElement("p");
      empty.className = "company-panel-empty";
      empty.textContent = `选择${contextLabel}后显示公司质量与事件风险。`;
      target.appendChild(empty);
      return;
    }

    const quality = document.createElement("section");
    quality.className = "company-quality-card";
    const heading = document.createElement("div");
    heading.className = "company-card-heading";
    const title = document.createElement("div");
    const eyebrow = document.createElement("small");
    eyebrow.textContent = "COMPANY QUALITY";
    const name = document.createElement("h2");
    name.textContent = `${card && card.name || code} · 公司质量与估值`;
    title.append(eyebrow, name);
    const status = companyStatus(card && card.source_status || companyQuality.source_status);
    const badge = document.createElement("span");
    badge.className = `company-status ${status.className}`;
    badge.textContent = status.label;
    heading.append(title, badge);
    const heatResearchLink = sectorHeatResearchLink(code);
    if (heatResearchLink) heading.appendChild(heatResearchLink);

    const freshness = document.createElement("p");
    freshness.className = "company-freshness";
    const cardSources = card && card.sources || {};
    const sourceLabels = [
      cardSources.identity,
      cardSources.valuation,
      cardSources.financial,
      ...(Array.isArray(cardSources.reconciliation) ? cardSources.reconciliation : []),
    ].filter(Boolean);
    freshness.textContent = card
      ? [
          card.report_period ? `财务报告期 ${card.report_period}` : "财务数据待补",
          card.announced_at ? `公告日 ${card.announced_at}` : "公告日待补",
          card.market_date ? `估值截至 ${card.market_date}` : "估值数据待补",
          card.fetched_at ? `抓取于 ${card.fetched_at}` : "抓取时间待补",
          companyQuality.checked_at ? `检查于 ${companyQuality.checked_at}` : "检查时间待补",
          Array.isArray(companyQuality.errors) && companyQuality.errors.length
            ? `降级原因 ${companyQuality.errors[0].code || companyQuality.errors[0].message || "未知"}`
            : "",
          card.comparable === false ? "金融行业口径不可直接横比" : "同口径指标可比较",
          sourceLabels.length ? `来源 ${[...new Set(sourceLabels)].join(" / ")}` : "来源待补",
        ].filter(Boolean).join(" · ")
      : "当前运行没有该公司的可用质量与估值快照。";

    const metrics = document.createElement("div");
    metrics.className = "company-metrics";
    const detail = document.createElement("details");
    detail.className = "company-detail";
    const detailSummary = document.createElement("summary");
    detailSummary.textContent = "更多基本面与估值";
    const detailMetrics = document.createElement("div");
    detailMetrics.className = "company-detail-metrics";
    if (card) {
      const values = card.metrics || {};
      metrics.append(
        companyMetric(
          "营业收入同比增长",
          companyNumber(values.revenue_yoy, "%", 1, true),
          "与上年同期相比"
        ),
        companyMetric(
          "扣除非经常损益后利润同比",
          companyNumber(values.deducted_profit_yoy, "%", 1, true),
          "更接近主营业务表现"
        ),
        companyMetric(
          "净资产收益率",
          companyNumber(values.roe_pct, "%", 1),
          "衡量股东资金使用效率"
        ),
        companyMetric(
          "滚动市盈率 · 近3年分位",
          `${companyNumber(values.pe_ttm, "", 1)} · ${companyNumber(
            values.pe_ttm_percentile_3y == null
              ? null
              : Number(values.pe_ttm_percentile_3y) * 100,
            "%",
            0
          )}`,
          "分位越低，越接近近3年低估值区"
        )
      );
      const comparableValue = (value, formatter) => card.comparable === false
        ? "行业口径不可比"
        : formatter(value);
      detailMetrics.append(
        companyMetric(
          "销售毛利率",
          companyNumber(values.gross_margin_pct, "%", 1),
          `较上期 ${companyNumber(values.gross_margin_change_pct_points, " 个百分点", 1, true)}`
        ),
        companyMetric(
          "净资产收益率变化",
          companyNumber(values.roe_change_pct_points, " 个百分点", 1, true),
          "与上一可用报告期相比"
        ),
        companyMetric(
          "经营现金流 / 营业收入",
          companyNumber(values.operating_cashflow_to_revenue_pct, "%", 1),
          values.operating_cashflow_to_revenue_pct == null
            ? "分母缺失或非正，禁用比率"
            : "现金回收质量"
        ),
        companyMetric(
          "经营现金流 / 净利润",
          companyNumber(values.operating_cashflow_to_profit_pct, "%", 1),
          values.operating_cashflow_to_profit_pct == null
            ? "分母缺失或非正，禁用比率"
            : "净利润现金含量"
        ),
        companyMetric(
          "资产负债率",
          comparableValue(
            values.debt_to_assets_pct,
            (value) => companyNumber(value, "%", 1)
          ),
          card.comparable === false ? "金融行业使用专用口径" : "总负债占总资产"
        ),
        companyMetric(
          "流动比率 / 速动比率",
          comparableValue(
            values.current_ratio,
            () => `${companyNumber(values.current_ratio, "", 2)} / ${companyNumber(values.quick_ratio, "", 2)}`
          ),
          card.comparable === false ? "金融行业使用专用口径" : "短期偿债能力"
        ),
        companyMetric(
          "市净率 / 近3年分位",
          `${companyNumber(values.pb, "", 2)} · ${companyNumber(
            values.pb_percentile_3y == null
              ? null
              : Number(values.pb_percentile_3y) * 100,
            "%",
            0
          )}`,
          "分位越低，越接近近3年低估值区"
        ),
        companyMetric(
          "市销率 / 近十二月股息率",
          `${companyNumber(values.ps_ttm, "", 2)} / ${companyNumber(values.dividend_yield_ttm_pct, "%", 2)}`,
          "交易日截面"
        ),
        companyMetric(
          "总市值",
          companyMoney(values.total_market_value),
          "最新可用交易日"
        ),
        companyMetric(
          "流通市值",
          companyMoney(values.circulating_market_value),
          "最新可用交易日"
        )
      );
      detail.append(detailSummary, detailMetrics);
      const reconciliationSources = card.reconciliation
        && card.reconciliation.sources
        && typeof card.reconciliation.sources === "object"
        ? card.reconciliation.sources
        : {};
      if (Object.keys(reconciliationSources).length) {
        const reconciliation = document.createElement("section");
        reconciliation.className = "company-reconciliation";
        const reconciliationTitle = document.createElement("strong");
        reconciliationTitle.textContent = "多源对账";
        const reconciliationMeta = document.createElement("small");
        reconciliationMeta.textContent = card.reconciliation.reconciled_at
          ? `对账于 ${card.reconciliation.reconciled_at}`
          : "对账时间待补";
        reconciliation.append(reconciliationTitle, reconciliationMeta);
        for (const [source, record] of Object.entries(reconciliationSources)) {
          const row = document.createElement("div");
          row.className = `company-reconciliation-row is-${String(
            record.status || "missing"
          )}`;
          const sourceName = document.createElement("b");
          sourceName.textContent = source;
          const result = document.createElement("span");
          const conflicts = Array.isArray(record.conflicts) ? record.conflicts : [];
          result.textContent = conflicts.length
            ? conflicts.map((conflict) => (
                `${conflict.field}: ${conflict.primary} / ${conflict.secondary}`
              )).join("；")
            : record.reason === "time_mismatch"
              ? `报告期口径不同：${record.primary_period || "—"} / ${record.secondary_period || "—"}`
              : record.status === "ok" ? "关键字段一致" : "对账数据不足";
          row.append(sourceName, result);
          reconciliation.appendChild(row);
        }
        detail.appendChild(reconciliation);
      }
    } else {
      const empty = document.createElement("p");
      empty.className = "company-card-empty";
      empty.textContent = "质量与估值缓存缺失；候选其他信息仍可正常使用。";
      metrics.appendChild(empty);
    }
    quality.append(heading, freshness, metrics, detail);

    target.append(quality);
  }

  window.StockOpsCompany = { render: renderCompanyDecisionPanel };

  function replaceChildrenCompat(element, children) {
    while (element.firstChild) element.removeChild(element.firstChild);
    for (const child of children || []) element.appendChild(child);
  }

  function renderStageList(container, items) {
    replaceChildrenCompat(container);
    for (const item of items || []) {
      const row = document.createElement("div");
      row.className = `stage-item is-${String(item.tone || "accent")}`;
      const identity = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = String(item.name || item.code || "—");
      const code = document.createElement("small");
      code.textContent = String(item.code || "");
      identity.append(name, code);
      const status = document.createElement("span");
      status.textContent = String(item.status || "待复核");
      row.append(identity, status);
      container.appendChild(row);
    }
    if (!container.children.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "本阶段没有需要单独列出的对象。";
      container.appendChild(empty);
    }
  }

  function renderStageWorkspace() {
    if (!stage) return;
    document.body.dataset.stage = String(stage.task_type || taskType);
    document.querySelector("#stage-eyebrow").textContent =
      String(stage.eyebrow || taskType.toUpperCase());
    document.querySelector("#stage-question").textContent =
      String(stage.question || "本阶段需要关注什么？");
    document.querySelector("#stage-focus-title").textContent =
      String(stage.focus_title || "等待阶段结论");
    document.querySelector("#stage-focus-detail").textContent =
      normalizeMarketTerms(stage.focus_detail || "");
    const ai = stage.ai || {};
    document.querySelector("#stage-ai-status").textContent = [
      String(ai.mode || "data_only").toUpperCase(),
      ai.engine || "NO ENGINE",
      Number(ai.duration_sec) > 0 ? `${Number(ai.duration_sec).toFixed(1)}S` : "",
    ].filter(Boolean).join(" · ");
    document.querySelector("#stage-primary-label").textContent =
      String(stage.primary_label || "本阶段处理顺序");
    document.querySelector("#stage-secondary-label").textContent =
      String(stage.secondary_label || "继续观察");
    document.querySelector("#stage-alert").textContent =
      String(stage.alert || "研究辅助，不构成投资建议。");

    const metrics = document.querySelector("#stage-metrics");
    replaceChildrenCompat(metrics);
    for (const metric of stage.metrics || []) {
      const article = document.createElement("article");
      const label = document.createElement("span");
      label.textContent = String(metric.label || "指标");
      const value = document.createElement("strong");
      value.textContent = String(metric.value || "—");
      const note = document.createElement("small");
      note.textContent = String(metric.note || "");
      article.append(label, value, note);
      metrics.appendChild(article);
    }
    renderStageList(
      document.querySelector("#stage-primary-items"),
      stage.primary_items
    );
    renderStageList(
      document.querySelector("#stage-secondary-items"),
      stage.secondary_items
    );
  }

  function renderRankingSummary() {
    /**
     * Render canonical identity, degradation, coverage, and admission counts.
     * Input example: deterministic snapshot identity. Output: a visible
     * four-cell summary; legacy pages keep the canonical panel hidden.
     */
    const summary = document.querySelector("#ranking-summary");
    if (!summary || !canonicalRanking) return;
    summary.hidden = false;
    const rankingSummary = rankingSnapshot.summary || {};
    const views = rankingSnapshot.views || {};
    const groupCounts = rankingSummary.evidence_group_candidate_counts || {};
    const evidenceCoverage = Object.entries(groupCounts).map(([groupId, count]) => (
      `${evidenceGroupLabel(groupId)} ${Number(count || 0)}`
    ));
    const degradationReasons = rankingSnapshot.degradation_reasons || [];
    document.querySelector("#ranking-snapshot-id").textContent =
      String(rankingSnapshot.snapshot_id || "—");
    document.querySelector("#ranking-version").textContent =
      String(rankingSnapshot.ranking_version || "—");
    document.querySelector("#ranking-signal-date").textContent =
      String(rankingSnapshot.signal_date || "—");
    document.querySelector("#ranking-as-of").textContent =
      formatTimestamp(rankingSnapshot.as_of) || "—";
    document.querySelector("#ranking-admission-counts").textContent = [
      Number(rankingSummary.allow_count ?? (views.eligible_ids || []).length),
      Number(rankingSummary.watch_count ?? (views.watch_ids || []).length),
      Number(rankingSummary.reject_count ?? (views.rejected_ids || []).length),
    ].join(" / ");
    document.querySelector("#ranking-family-only-count").textContent =
      String(Object.values(groupCounts).reduce((total, count) => total + Number(count || 0), 0));
    document.querySelector("#ranking-recall-status").textContent =
      rankingSnapshot.recall_status === "complete" ? "完整" : "召回降级";
    document.querySelector("#ranking-coverage").textContent = degradationReasons.length
      ? `${evidenceCoverage.join(" · ")} · ${degradationReasons.join("、")}`
      : evidenceCoverage.join(" · ") || "无公开证据覆盖";
    const highestRisk = rankingSummary.highest_risk || {};
    document.querySelector("#ranking-highest-risk").textContent =
      highestRisk.canonical_code
        ? `${highestRisk.canonical_code} · 罚分 ${Number(highestRisk.risk_penalty || 0).toFixed(2)} · ${highestRisk.reason || "—"}`
        : "无风险候选";
  }

  function renderRankingIdentityWarning() {
    /**
     * Block candidate identity when a card URL names a different snapshot.
     * Input example: URL snapshot B with page snapshot A. Output: a visible
     * warning and an empty candidate projection, never mislabeled as B.
     */
    const warning = document.querySelector("#ranking-identity-warning");
    if (!warning || !rankingIdentityMismatch) return;
    warning.hidden = false;
    document.querySelector("#ranking-identity-warning-text").textContent =
      `快照身份不匹配：链接 ${requestedSnapshotId}，页面 ${rankingSnapshot.snapshot_id || "缺失"}；候选已隐藏，请打开与页面一致的链接。`;
  }


  function matchesRule(item, ruleName) {
    if (!ruleName) return true;
    const matchedRules = item.matched_rules || [];
    if (matchedRules.includes(ruleName)) return true;
    const rule = configuredRules.find((candidate) => String(candidate.name) === ruleName);
    if (!rule) return false;
    const strategies = (rule.strategies || []).map(String);
    const hits = item.hit_strategies || [];
    if (!strategies.length) return false;
    return rule.mode === "all"
      ? strategies.every((strategy) => hits.includes(strategy))
      : strategies.some((strategy) => hits.includes(strategy));
  }

  function rankingScore(item) {
    /**
     * Return the upstream canonical score, or the explicit legacy display score.
     * Input example: { ranking_score: 88.25 }. Output example: 88.25.
     */
    if (item && Number.isFinite(Number(item.ranking_score))) {
      return Number(item.ranking_score);
    }
    const legacyScore = Number(item && item.display_score) || 0;
    return maxScore > 0
      ? (legacyScore / maxScore) * 100
      : legacyScore <= 1 ? legacyScore * 100 : legacyScore;
  }

  function rankingLabel(item) {
    /**
     * Render a label without presenting an adapted legacy score as canonical.
     * Input example: canonical rank 3 and score 88.25. Output: "生产排名 #3 · 88.25".
     */
    return canonicalRanking
      ? `生产排名 #${item.canonical_rank || "—"} · ${rankingScore(item).toFixed(2)}`
      : `历史分数适配 · ${rankingScore(item).toFixed(2)}`;
  }

  function securityRisk(item) {
    return item && item.security_risk && typeof item.security_risk === "object"
      ? item.security_risk : {};
  }

  function securityRiskVerdict(item) {
    const risk = securityRisk(item);
    return String(risk.scan_status || "") === "not_in_scope"
      ? "not_in_scope"
      : String(risk.verdict || "unknown");
  }

  function filteredResults() {
    /**
     * Filter the upstream list while preserving its canonical relative order.
     * Input example: canonical [A, B, C] and a filter matching A/C. Output: [A, C].
     */
    const comparison = candidateComparisons[activeComparisonPeriod] || {};
    const comparisonCodes = activeComparisonFilter
      ? new Set((comparison[activeComparisonFilter] || []).map((item) => String(item.code)))
      : null;
    const activeLane = strategyLanes.find(
      (lane) => String(lane.key) === activeStrategyGroup
    );
    const activeStrategyDefinition = configuredStrategies.find(
      (item) => String(item.name) === activeStrategy
    );
    const laneCodes = activeLane
      ? new Set((activeLane.candidates || []).map((item) => String(item.code)))
      : null;
    return screenResults.filter((item) => (
      matchesRule(item, activeRule)
      && (!activeStrategy || (item.hit_strategies || []).includes(activeStrategy))
      && (!laneCodes || laneCodes.has(String(item.code)))
      && (!comparisonCodes || comparisonCodes.has(String(item.code)))
      && (!activeRisk || securityRiskVerdict(item) === activeRisk)
    ));
  }

  function renderRiskFilters() {
    const container = document.querySelector("#candidate-risk-filters");
    if (!container) return;
    const labels = {
      red: "红色拦截", orange: "橙色复核", yellow: "黄色关注",
      unknown: "数据未知", green: "无触发", not_in_scope: "未入扫描范围",
    };
    const counts = {};
    for (const item of screenResults) {
      const key = securityRiskVerdict(item);
      counts[key] = (counts[key] || 0) + 1;
    }
    replaceChildrenCompat(container);
    for (const key of [null, "red", "orange", "yellow", "unknown", "green", "not_in_scope"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.riskFilter = key || "all";
      button.setAttribute("aria-pressed", String(activeRisk === key));
      button.textContent = key ? `${labels[key]} ${counts[key] || 0}` : `全部 ${screenResults.length}`;
      button.addEventListener("click", () => {
        activeRisk = key;
        mobileCandidatesExpanded = false;
        renderRiskFilters();
        const first = filteredResults()[0];
        if (first) show(String(first.code)); else renderCandidates();
      });
      container.appendChild(button);
    }
  }

  function renderSelectedSecurityRisk(code) {
    const panel = document.querySelector("#candidate-security-risk-panel");
    if (!panel) return;
    replaceChildrenCompat(panel);
    const item = resultsByCode.get(String(code)) || {};
    const risk = securityRisk(item);
    const verdict = securityRiskVerdict(item);
    const labels = {
      red: "红色硬风险", orange: "橙色复核", yellow: "黄色关注",
      unknown: "风险未知", green: "未触发", not_in_scope: "未进入自动扫描范围",
    };
    const heading = document.createElement("div");
    heading.className = "candidate-security-risk-heading";
    const title = document.createElement("h2"); title.textContent = "独立风险识别";
    const badge = document.createElement("span");
    badge.className = `candidate-risk-badge is-${verdict}`;
    badge.textContent = labels[verdict] || verdict;
    heading.append(title, badge); panel.appendChild(heading);
    const status = document.createElement("p");
    status.className = "candidate-security-risk-status";
    status.textContent = `覆盖 ${risk.coverage || "missing"} · 最近交易日 ${risk.latest_trade_date || "—"}`;
    panel.appendChild(status);
    const signals = Array.isArray(risk.signals) ? risk.signals : [];
    if (!signals.length) {
      const empty = document.createElement("p"); empty.className = "company-panel-empty";
      empty.textContent = verdict === "green"
        ? "关键数据齐全，未触发已配置风险规则。"
        : verdict === "not_in_scope"
          ? "该证券不在本次各泳道 Top50 风险扫描并集中。"
          : "风险证据不足；未知状态不会替代为绿色。";
      panel.appendChild(empty); return;
    }
    const list = document.createElement("div"); list.className = "candidate-security-risk-signals";
    const displayEvidenceValue = (value) => {
      if (value === null || value === undefined) return "—";
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    };
    for (const signal of signals) {
      const row = document.createElement("article");
      const name = document.createElement("strong");
      name.textContent = String(signal.title || signal.name || signal.rule_id || "风险信号");
      const evidence = document.createElement("span");
      evidence.textContent = `观测 ${displayEvidenceValue(signal.observed ?? signal.value)} · 阈值 ${displayEvidenceValue(signal.threshold)} · ${signal.source || "来源待确认"}`;
      row.append(name, evidence); list.appendChild(row);
    }
    panel.appendChild(list);
  }

  function validBars(code) {
    const snapshot = marketByCode[code] || {};
    return Array.isArray(snapshot.bars)
      ? snapshot.bars.filter((bar) => Number.isFinite(Number(bar.close)))
      : [];
  }

  function marketEvents(code) {
    const snapshot = marketByCode[code] || {};
    return Array.isArray(snapshot.events) ? snapshot.events : [];
  }

  function loadMarketData(code) {
    if (marketByCode[code]) return Promise.resolve(marketByCode[code]);
    if (marketLoads[code]) return marketLoads[code];
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
      script.src = String(marketFiles[code]);
      script.async = true;
      script.onload = () => {
        if (marketByCode[code]) resolve(marketByCode[code]);
        else {
          delete marketLoads[code];
          reject(new Error("行情文件内容无效"));
        }
      };
      script.onerror = () => {
        delete marketLoads[code];
        reject(new Error("行情文件加载失败"));
      };
      document.head.appendChild(script);
    });
    const canLoadRemote = Boolean(
      remoteMarket.enabled
      && /^https?:$/.test(window.location.protocol)
      && window.StockOpsRemoteMarket
    );
    marketLoads[code] = canLoadRemote
      ? window.StockOpsRemoteMarket.load(code, {
          adjust: String(remoteMarket.adjust || "qfq"),
          limit: Number(remoteMarket.limit) || 1000,
        }).then((snapshot) => {
          marketByCode[code] = snapshot;
          return snapshot;
        }).catch(() => loadStatic())
      : loadStatic();
    return marketLoads[code];
  }

  // Price change is a market close-to-close return, not an account return.
  function priceChange(code, sessionsBack) {
    const bars = validBars(code);
    if (bars.length > sessionsBack) {
      const latest = Number(bars[bars.length - 1].close);
      const previous = Number(bars[bars.length - 1 - sessionsBack].close);
      return previous !== 0 ? ((latest / previous) - 1) * 100 : null;
    }
    const summary = marketSummaries[code] || {};
    const value = summary[`change_${sessionsBack}d`];
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function setChange(element, value) {
    element.textContent = formatPercent(value);
    element.classList.toggle("is-positive-text", Number.isFinite(value) && value > 0);
    element.classList.toggle("is-negative-text", Number.isFinite(value) && value < 0);
  }

  function formatTimestamp(value) {
    if (!value) return "";
    return String(value).replace("T", " ").replace(/\.\d+/, "");
  }

  function normalizeMarketTerms(value) {
    return String(value || "")
      .replace(/近(\d+(?:\/\d+)*)日收益/g, "近$1日涨跌幅")
      .replace(/累计收益/g, "累计涨跌幅");
  }

  function renderRunMetadata() {
    const metadata = aiReport.metadata || sourceStatus.metadata || {};
    const taskLabels = { postmarket: "POST-MARKET" };
    document.querySelector("#task-type").textContent = taskLabels[taskType] || taskType.toUpperCase();
    const clockMatch = metadata.as_of
      ? String(metadata.as_of).match(/T(\d{2}:\d{2})/)
      : null;
    const clock = clockMatch ? clockMatch[1] : "";
    document.querySelector("#run-meta").textContent = mobileViewport.matches
      ? [metadata.date, clock && `${clock} CST`].filter(Boolean).join("  ·  ")
      : [metadata.date, metadata.run_id].filter(Boolean).join("  ·  ") || "离线研究报告";
    document.querySelector("#last-updated").textContent = metadata.as_of
      ? `LAST UPDATED ${formatTimestamp(metadata.as_of)}`
      : "";
  }


  function renderMetrics() {
    const hitCount = screenResults.filter(
      (item) => (item.evidence_signals || []).length > 0
    ).length;
    const top = screenResults[0];
    const changes = Object.keys(marketSummaries)
      .map((code) => Number(marketSummaries[code].change_1d))
      .filter(Number.isFinite);
    const advancers = changes.filter((value) => value > 0).length;

    document.querySelector("#metric-candidates").textContent = String(fullScreenCount);
    document.querySelector("#metric-ai-focus").textContent = `AI 深度分析 ${aiAnalysisCount} 只`;
    document.querySelector("#metric-hits").textContent = String(hitCount);
    document.querySelector("#metric-hit-note").textContent = canonicalRanking
      ? `${hitCount} 只命中生产家族或兼容策略`
      : `${hitCount} 只命中策略`;
    document.querySelector("#metric-score").textContent = top ? rankingScore(top).toFixed(2) : "—";
    document.querySelector("#metric-score-label").textContent = canonicalRanking
      ? "首名生产排名分"
      : "首名历史适配分";
    document.querySelector("#metric-score-stock").textContent = top ? `${top.name} · ${top.code}` : "暂无候选";
    document.querySelector("#metric-advancers").textContent = changes.length ? `${advancers} / ${changes.length}` : "—";
  }

  function laneMembershipCount(code) {
    return strategyLanes.filter((lane) => (
      (lane.candidates || []).some((item) => String(item.code) === String(code))
    )).length;
  }

  function renderStrategyLanes() {
    const board = document.querySelector("#strategy-lanes");
    replaceChildrenCompat(board);
    document.querySelector("#strategy-lane-eyebrow").textContent = canonicalRanking
      ? "EVIDENCE GROUPS" : "STRATEGY LANES";
    document.querySelector("#strategy-lane-title").textContent = canonicalRanking
      ? "七类证券证据" : "策略泳道";
    document.querySelector("#strategy-lane-description").textContent = canonicalRanking
      ? "按公开证据分组，同一只股票可跨组命中；组内保持生产排名。"
      : "泳道只筛选候选并保持全局排名，不产生独立重排。";
    document.querySelector("#lane-count").textContent = canonicalRanking
      ? `${strategyLanes.length} 类证据` : `${strategyLanes.length} 条泳道`;
    document.querySelector("#lane-ai-summary").textContent = `AI 去重覆盖 ${aiAnalysisCount} 只`;

    for (const lane of strategyLanes) {
      const article = document.createElement("article");
      article.className = "strategy-lane";
      article.style.setProperty("--lane-color", String(lane.color || "#2F6B8A"));

      const header = document.createElement("header");
      const titleBlock = document.createElement("div");
      const eyebrow = document.createElement("small");
      eyebrow.textContent = canonicalRanking
        ? `${Number(lane.candidate_count) || 0} 只命中`
        : (`${Number(lane.candidate_count) || 0} TOTAL · `
          + `${Number(lane.display_count) || (lane.candidates || []).length} SHOWN`);
      const title = document.createElement("h3");
      title.textContent = String(lane.name || lane.key);
      const description = document.createElement("p");
      description.textContent = String(lane.description || "");
      titleBlock.append(eyebrow, title, description);
      const coverage = document.createElement("div");
      coverage.className = "lane-coverage";
      const aiCount = document.createElement("strong");
      aiCount.textContent = `${canonicalRanking ? Number(lane.candidate_count) || 0 : Number(lane.ai_count) || 0}`;
      const aiLabel = document.createElement("span");
      aiLabel.textContent = canonicalRanking ? "只候选" : `AI / TOP ${Number(lane.ai_top_n) || 0}`;
      coverage.append(aiCount, aiLabel);
      header.append(titleBlock, coverage);

      const strategyLine = document.createElement("div");
      strategyLine.className = "lane-strategies";
      for (const strategy of lane.strategies || []) {
        const chip = document.createElement("span");
        chip.textContent = String(strategy);
        strategyLine.appendChild(chip);
      }

      const list = document.createElement("div");
      list.className = "lane-candidates";
      const candidates = Array.isArray(lane.candidates) ? lane.candidates : [];
      for (const [index, item] of candidates.slice(0, 8).entries()) {
        const code = String(item.code);
        const row = document.createElement("button");
        row.type = "button";
        row.className = `lane-candidate${code === currentCode ? " is-selected" : ""}`;
        row.dataset.code = code;
        row.addEventListener("click", () => show(code));

        const rank = document.createElement("b");
        rank.textContent = Number.isInteger(item.canonical_rank)
          ? `#${item.canonical_rank}`
          : String(index + 1).padStart(2, "0");
        const identity = document.createElement("span");
        const name = document.createElement("strong");
        name.textContent = String(item.name || code);
        const meta = document.createElement("small");
        const groupCount = laneMembershipCount(code);
        meta.textContent = groupCount > 1
          ? `${code} · 跨 ${groupCount} 类命中`
          : `${code} · 单类命中`;
        const laneHeatBadge = sectorHeatBadge(code);
        identity.append(
          name,
          boardTag(code),
          ...(laneHeatBadge ? [laneHeatBadge] : []),
          meta
        );
        const score = document.createElement("span");
        score.className = "lane-score";
        const groupScore = document.createElement("strong");
        groupScore.textContent = Number(item.group_score || 0).toFixed(3);
        const rankingValue = document.createElement("small");
        rankingValue.textContent = rankingLabel(item);
        score.append(groupScore, rankingValue);
        row.append(rank, identity, score);
        list.appendChild(row);
      }
      if (!candidates.length) {
        const empty = document.createElement("p");
        empty.className = "lane-empty";
        empty.textContent = "本轮该大类暂无候选。";
        list.appendChild(empty);
      }
      if (candidates.length > 8) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "lane-more";
        more.textContent = (
          `查看该类 Top ${Number(lane.display_top_n) || candidates.length}`
          + `（完整 ${Number(lane.candidate_count) || candidates.length}）`
        );
        more.addEventListener("click", () => selectStrategyGroup(String(lane.key)));
        list.appendChild(more);
      }

      article.append(header, strategyLine, list);
      board.appendChild(article);
    }
  }

  function statusClass(status) {
    if (status === "ok") return "";
    return status === "degraded" ? "is-degraded" : "is-missing";
  }

  function groupedSources(sources) {
    const groups = new Map();
    const rank = { ok: 0, degraded: 1, missing: 2 };
    for (const item of sources) {
      const domain = String(item.domain || "unknown").split(":")[0];
      const key = domain === "wencai"
        ? "问财策略"
        : domain.startsWith("board_")
          ? "板块行情"
          : "日线行情";
      const group = groups.get(key) || { name: key, total: 0, ok: 0, status: "ok", providers: new Set() };
      group.total += 1;
      if (item.status === "ok") group.ok += 1;
      if ((rank[item.status] || 0) > (rank[group.status] || 0)) group.status = item.status;
      if (item.source) group.providers.add(String(item.source));
      groups.set(key, group);
    }
    const hasOpinions = (aiReport.stock_opinions || []).length > 0;
    const aiHealthy = aiReport.report_mode === "ai" && hasOpinions;
    const aiStatus = aiReport.report_mode === "mixed" && hasOpinions
      ? "degraded"
      : aiHealthy ? "ok" : "degraded";
    groups.set("AI 研究", {
      name: "AI 研究",
      total: 1,
      ok: aiHealthy ? 1 : 0,
      status: aiStatus,
      providers: new Set([aiReport.engine_used || "data-only"]),
    });
    return [...groups.values()];
  }

  function sourceDetailRow(item) {
    const row = document.createElement("div");
    row.className = "source-detail-row";
    const name = document.createElement("div");
    name.className = "source-detail-name";
    const dot = document.createElement("span");
    dot.className = `status-dot ${statusClass(item.status)}`.trim();
    const label = document.createElement("span");
    label.textContent = String(item.domain || "unknown");
    name.append(dot, label);
    const meta = document.createElement("small");
    meta.textContent = `${item.status || "unknown"} · ${item.source || "unknown"}`;
    row.append(name, meta);
    return row;
  }

  function renderSources() {
    const sources = Array.isArray(sourceStatus.sources) ? sourceStatus.sources : [];
    const okCount = sources.filter((item) => item.status === "ok").length;
    const degradedCount = sources.filter((item) => item.status === "degraded").length;
    const missingCount = sources.length - okCount - degradedCount;
    const overall = missingCount > 0 ? "missing" : degradedCount > 0 ? "degraded" : "ok";
    const healthLabels = { ok: "数据源正常", degraded: "部分数据源降级", missing: "存在缺失数据源" };

    document.querySelector("#source-health-label").textContent = healthLabels[overall];
    document.querySelector("#source-health-count").textContent = `${okCount} / ${sources.length} SOURCES`;
    document.querySelector("#source-health-dot").className = `health-dot ${statusClass(overall)}`.trim();
    document.querySelector("#source-tooltip-total").textContent = `${okCount} / ${sources.length} 正常`;
    document.querySelector("#source-panel-summary").textContent = healthLabels[overall];

    const tooltipList = document.querySelector("#source-tooltip-list");
    replaceChildrenCompat(tooltipList, sources.map(sourceDetailRow));
    if (!sources.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "本次运行没有数据源状态记录。";
      replaceChildrenCompat(tooltipList, [empty]);
    }

    const panel = document.querySelector("#source-status");
    replaceChildrenCompat(panel);
    for (const group of groupedSources(sources)) {
      const row = document.createElement("div");
      row.className = "source-group";
      const name = document.createElement("div");
      name.className = "source-group-name";
      const dot = document.createElement("span");
      dot.className = `status-dot ${statusClass(group.status)}`.trim();
      const title = document.createElement("strong");
      title.textContent = group.name;
      name.append(dot, title);
      const meta = document.createElement("div");
      meta.className = "source-group-meta";
      const count = document.createElement("strong");
      count.textContent = `${group.ok} / ${group.total}`;
      const providers = document.createElement("small");
      providers.textContent = [...group.providers].join(", ") || "unknown";
      meta.append(count, providers);
      row.append(name, meta);
      panel.appendChild(row);
    }

    const popover = document.querySelector("#source-popover");
    const button = document.querySelector("#source-summary");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = popover.classList.toggle("is-open");
      button.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", () => {
      popover.classList.remove("is-open");
      button.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        popover.classList.remove("is-open");
        button.setAttribute("aria-expanded", "false");
        button.focus();
      }
    });
  }

  function safeHistoryRuns(day) {
    const runs = Array.isArray(day.runs) ? day.runs : [];
    return runs.filter((run) => {
      const href = String(run.href || "");
      return href && !href.includes("://") && !href.startsWith("/");
    });
  }

  function renderHistory() {
    const container = document.querySelector("#history-days");
    const stageNames = { postmarket: "盘后" };
    const stageName = stageNames[history.stage || taskType] || "本时段";
    document.querySelector("#history-scope").textContent =
      `仅显示本时段（${stageName}）的历史运行，按交易日汇总`;
    const days = historyDays
      .map((day) => ({ date: String(day.date || ""), runs: safeHistoryRuns(day) }))
      .filter((day) => day.date && day.runs.length);
    const runTotal = days.reduce((sum, day) => sum + day.runs.length, 0);
    document.querySelector("#history-count").textContent =
      `${days.length} 天 · ${runTotal} 次运行`;
    replaceChildrenCompat(container);
    if (!days.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "暂无更早的本时段报告。";
      container.appendChild(empty);
      return;
    }
    days.forEach((day, index) => {
      const group = document.createElement("div");
      group.className = "history-group";
      const expanded = index === 0;
      group.classList.toggle("is-open", expanded);

      const header = document.createElement("button");
      header.type = "button";
      header.className = "history-group-header";
      header.setAttribute("aria-expanded", String(expanded));
      const left = document.createElement("span");
      left.className = "history-group-left";
      const caret = document.createElement("span");
      caret.className = "history-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.textContent = "▸";
      const dateText = document.createElement("strong");
      dateText.textContent = day.date;
      left.append(caret, dateText);
      const count = document.createElement("span");
      count.className = "history-group-count";
      count.textContent = `${day.runs.length} 次运行`;
      header.append(left, count);

      const list = document.createElement("div");
      list.className = "history-run-list";
      for (const run of day.runs) {
        const anchor = document.createElement("a");
        anchor.className = "history-run";
        anchor.href = String(run.href);
        const runLeft = document.createElement("span");
        runLeft.className = "history-run-left";
        const dot = document.createElement("span");
        dot.className = `history-run-dot is-${String(history.stage || taskType)}`;
        dot.setAttribute("aria-hidden", "true");
        const time = document.createElement("span");
        time.className = "history-run-time";
        time.textContent = String(run.time || "运行");
        runLeft.append(dot, time);
        if (run.note) {
          const note = document.createElement("small");
          note.className = "history-run-note";
          note.textContent = String(run.note);
          runLeft.appendChild(note);
        }
        const open = document.createElement("span");
        open.className = "history-run-open";
        open.textContent = "打开 →";
        anchor.append(runLeft, open);
        list.appendChild(anchor);
      }

      header.addEventListener("click", () => {
        const isOpen = !group.classList.contains("is-open");
        group.classList.toggle("is-open", isOpen);
        header.setAttribute("aria-expanded", String(isOpen));
      });
      group.append(header, list);
      container.appendChild(group);
    });
  }

  function comparisonDateLabel(comparison) {
    const dates = Array.isArray(comparison.baseline_dates) ? comparison.baseline_dates : [];
    if (!dates.length) return "暂无同任务历史榜单";
    if (comparison.period === "previous") return `对比 ${dates[0]} 最近一次运行`;
    return `对比 ${dates[dates.length - 1]} 至 ${dates[0]} · ${dates.length} 个交易日`;
  }

  function renderComparisonStockList(containerId, items, interactive) {
    const container = document.querySelector(containerId);
    replaceChildrenCompat(container);
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "comparison-stock-empty";
      empty.textContent = interactive ? "本周期没有新进股票。" : "本周期没有调出股票。";
      container.appendChild(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement(interactive ? "button" : "div");
      if (interactive) row.type = "button";
      row.className = "comparison-stock-row";
      const name = document.createElement("strong");
      name.textContent = String(item.name || item.code);
      const code = document.createElement("small");
      code.textContent = String(item.code);
      row.append(name, code);
      if (interactive) row.addEventListener("click", () => show(String(item.code)));
      container.appendChild(row);
    }
  }

  function renderCandidateComparison() {
    const comparison = candidateComparisons[activeComparisonPeriod] || {};
    const content = document.querySelector("#comparison-content");
    const empty = document.querySelector("#comparison-empty");
    for (const button of document.querySelectorAll("[data-comparison-period]")) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.comparisonPeriod === activeComparisonPeriod)
      );
    }
    const taskLabel = "盘后";
    document.querySelector("#comparison-subtitle").textContent =
      `${taskLabel} · ${comparisonDateLabel(comparison)}`;
    if (!comparison.available) {
      content.hidden = true;
      empty.hidden = false;
      empty.textContent = "暂无更早的同任务榜单；产生下一次同类报告后即可比较。";
      return;
    }
    content.hidden = false;
    empty.hidden = true;
    document.querySelector("#comparison-current-count").textContent = String(comparison.current_count || 0);
    document.querySelector("#comparison-entered-count").textContent = String(comparison.entered_count || 0);
    document.querySelector("#comparison-exited-count").textContent = String(comparison.exited_count || 0);
    document.querySelector("#comparison-retained-count").textContent = String(comparison.retained_count || 0);
    const netChange = Number(comparison.net_change) || 0;
    document.querySelector("#comparison-net-label").textContent =
      netChange > 0 ? "净增加" : netChange < 0 ? "净减少" : "净变化";
    document.querySelector("#comparison-net-change").textContent =
      `${netChange > 0 ? "+" : ""}${netChange} 只`;
    document.querySelector("#comparison-entered-label").textContent =
      `${Number(comparison.entered_count) || 0} 只`;
    document.querySelector("#comparison-exited-label").textContent =
      `${Number(comparison.exited_count) || 0} 只`;
    for (const button of document.querySelectorAll("[data-comparison-filter]")) {
      button.setAttribute(
        "aria-pressed",
        String((button.dataset.comparisonFilter || null) === activeComparisonFilter)
      );
    }
    renderComparisonStockList(
      "#comparison-entered-list",
      Array.isArray(comparison.entered) ? comparison.entered : [],
      true
    );
    renderComparisonStockList(
      "#comparison-exited-list",
      Array.isArray(comparison.exited) ? comparison.exited : [],
      false
    );
    for (const button of document.querySelectorAll("[data-comparison-list-toggle]")) {
      const listName = String(button.dataset.comparisonListToggle);
      const section = button.closest(".comparison-list");
      const isOpen = !mobileViewport.matches || openComparisonList === listName;
      section.classList.toggle("is-mobile-open", isOpen);
      button.setAttribute("aria-expanded", String(isOpen));
    }
  }

  function renderStrategyObserver() {
    const container = document.querySelector("#strategy-filters");
    const ruleContainer = document.querySelector("#selection-rule-filters");
    const hitCount = screenResults.filter((item) => (item.hit_strategies || []).length).length;
    const filteredCount = filteredResults().length;
    const activeStrategyDefinition = configuredStrategies.find(
      (item) => String(item.name) === activeStrategy
    );
    document.querySelector("#strategy-total").textContent = `${configuredStrategies.length} · ${configuredRules.length}`;
    const comparisonLabel = activeComparisonFilter === "entered"
      ? "今日新进"
      : activeComparisonFilter === "retained" ? "连续在榜" : null;
    const activeLane = strategyLanes.find(
      (lane) => String(lane.key) === activeStrategyGroup
    );
    const activeLabels = [
      comparisonLabel,
      activeLane ? String(activeLane.name) : null,
      activeRule,
      activeStrategy,
    ].filter(Boolean);
    document.querySelector("#strategy-filter-summary").textContent = activeLabels.length
      ? `当前筛选：${activeLabels.join(" · ")} · 已筛至 ${filteredCount} 只${
        activeStrategyDefinition && activeStrategyDefinition.explanation
          ? ` · ${activeStrategyDefinition.explanation}`
          : ""
      }`
      : `全部候选 · ${hitCount} 只命中 · 共 ${screenResults.length} 只`;
    replaceChildrenCompat(ruleContainer);
    replaceChildrenCompat(container);

    for (const rule of configuredRules) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "strategy-filter";
      button.dataset.rule = String(rule.name);
      button.setAttribute("aria-pressed", String(activeRule === String(rule.name)));
      button.setAttribute("aria-controls", "candidate-list");
      const label = document.createElement("span");
      label.textContent = String(rule.name);
      const count = document.createElement("span");
      count.className = "strategy-filter-count";
      count.textContent = String(
        screenResults.filter((item) => matchesRule(item, String(rule.name))).length
      );
      button.append(label, count);
      button.addEventListener("click", () => selectRule(String(rule.name)));
      ruleContainer.appendChild(button);
    }

    const filters = [
      { name: null, label: "全部候选", hit_count: screenResults.length },
      ...configuredStrategies.map((item) => ({
        name: String(item.name),
        label: String(item.name),
        hit_count: Number(item.hit_count) || 0,
        explanation: String(item.explanation || ""),
      })),
    ];
    for (const filter of filters) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "strategy-filter";
      button.dataset.strategy = filter.name || "";
      button.setAttribute("aria-pressed", String(activeStrategy === filter.name));
      button.setAttribute("aria-controls", "candidate-list");
      const label = document.createElement("span");
      label.textContent = filter.label;
      if (filter.explanation) {
        button.title = filter.explanation;
        button.setAttribute("aria-label", `${filter.label}：${filter.explanation}`);
      }
      const count = document.createElement("span");
      count.className = "strategy-filter-count";
      count.textContent = String(filter.hit_count);
      button.append(label, count);
      button.addEventListener("click", () => selectStrategy(filter.name));
      container.appendChild(button);
    }
  }

  function renderSectorHeatReliabilityNote() {
    const note = document.querySelector("#sector-heat-reliability-note");
    if (!note) return;
    const meta = (data.sector_heat_evidence && data.sector_heat_evidence.metadata) || null;
    if (!meta || meta.highlight_data_reliable !== false) {
      note.hidden = true;
      return;
    }
    const covered = meta.total_boards_ranked ?? 0;
    const floor = meta.min_boards_for_reliable_highlight ?? "?";
    note.hidden = false;
    note.textContent =
      `⚠️ 今日板块强度不可判定（覆盖 ${covered}/${floor}+ 或部分数据非实时）` +
      "，暂不显示 🔥 强板块高亮，候选仍会显示所属板块名供参考。";
  }

  function renderCandidates() {
    renderSectorHeatReliabilityNote();
    const list = document.querySelector("#candidate-list");
    const results = filteredResults();
    replaceChildrenCompat(list);
    const isFiltered = Boolean(
      activeRule || activeStrategy || activeStrategyGroup || activeComparisonFilter
    );
    document.querySelector("#candidate-count").textContent = isFiltered
      ? `已筛至 ${results.length} 只 · 保持生产顺序`
      : `共 ${results.length} 只 · ${canonicalRanking ? "生产排名" : "历史分数适配"}`;

    if (!results.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state candidate-empty";
      empty.textContent = "当前筛选条件没有命中候选股。";
      list.appendChild(empty);
      return;
    }

    const visibleResults = mobileViewport.matches && !mobileCandidatesExpanded
      ? results.slice(0, 3)
      : results;
    for (const item of visibleResults) {
      const code = String(item.code);
      const row = document.createElement("button");
      row.type = "button";
      row.className = `candidate-row${code === currentCode ? " is-selected" : ""}`;
      row.dataset.code = code;
      row.setAttribute("aria-pressed", String(code === currentCode));

      const stock = document.createElement("span");
      stock.className = "candidate-stock";
      const name = document.createElement("strong");
      name.textContent = String(item.name || code);
      const codeText = document.createElement("small");
      codeText.textContent = code;
      const candidateHeatBadge = sectorHeatBadge(code);
      stock.append(
        name,
        boardTag(code),
        ...(candidateHeatBadge ? [candidateHeatBadge] : []),
        codeText
      );

      const signal = document.createElement("span");
      signal.className = "candidate-signal";
      const signalTitle = document.createElement("strong");
      const evidenceSignals = item.evidence_signals || [];
      signalTitle.textContent = evidenceSignals.length
        ? `${evidenceSignals.length} 项命中信号` : "观察候选";
      if (evidenceSignals.length) {
        const signalText = document.createElement("small");
        signalText.textContent = `信号 ${evidenceSignals.slice(0, 2).map(
          (entry) => String(entry.label || entry.id)
        ).join(" · ")}${
          evidenceSignals.length > 2 ? ` +${evidenceSignals.length - 2}` : ""
        }`;
        signal.appendChild(signalText);
      }
      const change = document.createElement("small");
      change.textContent = `1 日涨跌 ${formatPercent(priceChange(code, 1))}`;
      signal.append(signalTitle, change);
      const riskKey = securityRiskVerdict(item);
      const riskLabels = {
        red: "风险·红", orange: "风险·橙", yellow: "风险·黄",
        unknown: "风险·未知", green: "风险·绿", not_in_scope: "风险·未扫描",
      };
      const riskBadge = document.createElement("span");
      riskBadge.className = `candidate-risk-badge is-${riskKey}`;
      riskBadge.textContent = riskLabels[riskKey] || "风险·未知";
      signal.appendChild(riskBadge);
      const liquidityKey = item.liquidity_tier === "低流动性" ? "low"
        : item.liquidity_tier === "中流动性" ? "mid"
        : item.liquidity_tier === "高流动性" ? "high"
        : "unknown";
      const liquidityLabels = {
        low: "流动性·低", mid: "流动性·中", high: "流动性·高", unknown: "流动性·未知",
      };
      const liquidityBadge = document.createElement("span");
      liquidityBadge.className = `candidate-liquidity-badge is-${liquidityKey}`;
      liquidityBadge.textContent = liquidityLabels[liquidityKey];
      liquidityBadge.title =
        "按当日全体候选池的实时成交额逐日三等分得到的相对档位，" +
        "是跟当天候选池里其它股票比较的排名，不是该股票流动性的绝对评级，" +
        "也不代表流动性越低风险越大。仅用于风险打分内部的乘数校准，" +
        "不影响候选是否入选，纯资讯展示。数据缺失或候选池过小时显示「未知」。";
      signal.appendChild(liquidityBadge);

      const score = document.createElement("span");
      score.className = "candidate-score";
      score.textContent = canonicalRanking
        ? `#${item.canonical_rank} · ${rankingScore(item).toFixed(2)}`
        : `历史 · ${rankingScore(item).toFixed(2)}`;
      row.append(stock, signal, score);
      row.addEventListener("click", () => {
        show(code);
        window.requestAnimationFrame(() => window.scrollTo(0, 0));
      });
      list.appendChild(row);
    }
    if (mobileViewport.matches && results.length > visibleResults.length) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "candidate-more";
      more.textContent = `查看全部 ${results.length} 只候选`;
      more.addEventListener("click", () => {
        mobileCandidatesExpanded = true;
        renderCandidates();
      });
      list.appendChild(more);
    }
  }

  function renderSelectedStock(code) {
    const item = resultsByCode.get(code) || {};
    renderSelectedSecurityRisk(code);
    renderCompanyDecisionPanel(
      document.querySelector("#candidate-company-panel"),
      code,
      "候选股"
    );
    renderLeadershipEvidencePanel(
      document.querySelector("#candidate-leadership-panel"),
      code
    );
    const bars = validBars(code);
    const latest = bars.length ? bars[bars.length - 1] : null;
    const summary = marketSummaries[code] || {};
    document.querySelector("#stock-name").textContent = String(item.name || code || "暂无数据");
    document.querySelector("#stock-code").textContent = code || "";
    const analysisLink = document.querySelector("#candidate-analysis-link");
    if (analysisLink) analysisLink.href = `stock-analysis.html?code=${encodeURIComponent(code || "")}`;
    const groupContributions = strategyLanes
      .map((lane) => {
        const candidate = (lane.candidates || []).find(
          (entry) => String(entry.code) === String(code)
        );
        return candidate
          ? `${lane.name} ${Number(candidate.group_score || 0).toFixed(3)}`
          : null;
      })
      .filter(Boolean);
    const liquidityText = item.liquidity_tier ? `｜流动性 ${item.liquidity_tier}` : "｜流动性 未知";
    const evidenceSignals = item.evidence_signals || [];
    const reasonCodes = item.reason_codes || [];
    const missingFields = item.missing_fields || [];
    const highestRiskOrMissing = missingFields.length
      ? displayField(missingFields[0])
      : reasonCodes.length
      ? displayReason(reasonCodes.slice(-1)[0])
      : `罚分 ${Number(item.risk_penalty || 0).toFixed(2)}`;
    const canonicalEvidence = canonicalRanking && item.code
      ? [
          rankingLabel(item),
          `信号价 ${item.reference_price_qfq_cny == null ? "—" : Number(item.reference_price_qfq_cny).toFixed(2)}`,
          `主证据组 ${evidenceGroupLabel(item.primary_group)}`,
          `准入 ${item.admission || "—"} ｜公开展示资格 ${publishStatus(item.publish_eligible)}`,
          `命中信号 ${evidenceSignals.map((signal) => String(signal.label || signal.id)).join(" · ") || "无正向证据"}`,
          `ADV20 ${item.adv20_cny == null ? "—" : Number(item.adv20_cny).toFixed(0)}`,
          `L ${item.liquidity_score == null ? "—" : Number(item.liquidity_score).toFixed(2)}`,
          missingFields.includes("structural_stop_qfq_cny")
            ? "E 资金效率证据不足"
            : `E ${item.capital_efficiency_evidence_score == null ? "—" : Number(item.capital_efficiency_evidence_score).toFixed(2)}`,
          `主理由 ${reasonCodes.length ? displayReason(reasonCodes[0]) : "—"}`,
          `最高风险/缺失 ${highestRiskOrMissing}`,
        ].join(" ｜ ")
      : null;
    document.querySelector("#stock-strategies").textContent = canonicalEvidence || (groupContributions.length
      ? `${groupContributions.join(" · ")} ｜ ${rankingLabel(item)}`
      : "未命中本次策略") + liquidityText;
    document.querySelector("#stock-strategies").title =
      (item.hit_strategies || []).join(" · ") +
      "\n流动性档位：按当日全体候选池的实时成交额逐日三等分得到的相对档位，" +
      "是跟当天候选池里其它股票比较的排名，不是该股票流动性的绝对评级，" +
      "也不代表流动性越低风险越大。仅用于风险打分内部的乘数校准，" +
      "不影响候选是否入选，纯资讯展示。";
    const latestClose = latest
      ? Number(latest.close)
      : summary.latest_close == null ? NaN : Number(summary.latest_close);
    document.querySelector("#latest-close").textContent = Number.isFinite(latestClose)
      ? latestClose.toFixed(2)
      : "—";
    setChange(document.querySelector("#change-1d"), priceChange(code, 1));
    setChange(document.querySelector("#change-5d"), priceChange(code, 5));
    document.querySelector("#selected-score").textContent = item.code
      ? rankingLabel(item).replace("生产排名 ", "")
      : "—";
    const fallbackOpinion = item.code
      ? `数据模式：命中 ${(item.hit_strategies || []).length} 项策略，生产排名分 ${rankingScore(item).toFixed(2)}，` +
        `近 1 日涨跌幅 ${formatPercent(priceChange(code, 1))}，近 5 日涨跌幅 ${formatPercent(priceChange(code, 5))}。`
      : "本次报告没有该股票的研究数据。";
    document.querySelector("#stock-opinion").textContent = normalizeMarketTerms(
      opinions.get(code) || fallbackOpinion
    );
  }

  const riseColor = "#d94b4b";
  const fallColor = "#15906a";
  const chart = window.klinecharts ? window.klinecharts.init("chart") : null;
  if (chart) {
    chart.setStyles({
      candle: {
        bar: {
          upColor: riseColor,
          downColor: fallColor,
          upBorderColor: riseColor,
          downBorderColor: fallColor,
          upWickColor: riseColor,
          downWickColor: fallColor,
        },
        priceMark: {
          last: { upColor: riseColor, downColor: fallColor },
        },
      },
      indicator: {
        ohlc: {
          upColor: "rgba(217, 75, 75, .72)",
          downColor: "rgba(21, 144, 106, .72)",
        },
      },
    });
    chart.setPaneOptions({ id: "candle_pane", gap: { top: 0.4, bottom: 0.1 } });
  }

  const aShareBarStyles = {
    bars: [{
      upColor: riseColor,
      downColor: fallColor,
      noChangeColor: "#888888",
    }],
  };

  function configuredIndicator(name, styles) {
    const options = { name };
    const params = indicatorParams[name];
    if (Array.isArray(params) && params.length) options.calcParams = [...params];
    if (styles) options.styles = styles;
    return options;
  }

  function indicatorTitle(name) {
    const params = indicatorParams[name];
    return Array.isArray(params) && params.length ? `${name} (${params.join(", ")})` : name;
  }

  function configuredLabel(name, prefix) {
    const params = indicatorParams[name];
    return Array.isArray(params) && params.length ? `${prefix}${params.join("/")}` : prefix;
  }

  const mainIndicatorDefs = chart ? [
    {
      key: "MA",
      label: configuredLabel("MA", "MA"),
      checked: true,
      create: () => chart.createIndicator(
        configuredIndicator("MA"), false, { id: "candle_pane" }
      ),
    },
    {
      key: "BOLL",
      label: "BOLL",
      checked: false,
      create: () => chart.createIndicator(
        configuredIndicator("BOLL"), false, { id: "candle_pane" }
      ),
    },
  ] : [];
  const subchartIndicatorDefs = chart ? [
    {
      key: "VOL",
      label: configuredLabel("VOL", "VOL+MA"),
      checked: true,
      create: () => chart.createIndicator(
        configuredIndicator("VOL", aShareBarStyles),
        false,
        { height: 112, minHeight: 80, gap: { top: 0.1, bottom: 0.1 } }
      ),
    },
    {
      key: "MACD",
      label: "MACD",
      checked: true,
      create: () => chart.createIndicator(
        configuredIndicator("MACD", aShareBarStyles),
        false,
        { height: 112, minHeight: 80, gap: { top: 0.1, bottom: 0.1 } }
      ),
    },
    {
      key: "RSI",
      label: "RSI",
      checked: false,
      create: () => chart.createIndicator(
        configuredIndicator("RSI"),
        false,
        { height: 112, minHeight: 80, gap: { top: 0.1, bottom: 0.1 } }
      ),
    },
    {
      key: "KDJ",
      label: "KDJ",
      checked: false,
      create: () => chart.createIndicator(
        configuredIndicator("KDJ"),
        false,
        { height: 112, minHeight: 80, gap: { top: 0.1, bottom: 0.1 } }
      ),
    },
  ] : [];
  const indicatorPaneIds = {};

  function mountIndicatorFilters(definitions, container) {
    for (const def of definitions) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = def.checked;
      label.title = indicatorTitle(def.key);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          indicatorPaneIds[def.key] = def.create();
        } else {
          chart.removeIndicator(indicatorPaneIds[def.key], def.key);
          delete indicatorPaneIds[def.key];
        }
      });
      label.append(checkbox, document.createTextNode(def.label));
      container.appendChild(label);
      if (def.checked) indicatorPaneIds[def.key] = def.create();
    }
  }

  mountIndicatorFilters(mainIndicatorDefs, document.querySelector("#indicator-filters"));
  mountIndicatorFilters(subchartIndicatorDefs, document.querySelector("#subchart-filters"));

  const allEventTypes = Array.isArray(data.event_types) ? data.event_types : [];
  const enabledEventTypes = new Set(allEventTypes);
  const eventFilters = document.querySelector("#event-filters");
  const eventMenu = document.querySelector("#event-menu");
  const eventNote = document.querySelector("#event-note");
  const eventCount = Number(data.event_count) || 0;
  eventMenu.hidden = allEventTypes.length === 0;
  eventNote.hidden = allEventTypes.length > 0;
  if (allEventTypes.length) {
    document.querySelector("#event-summary").textContent = `事件 ${eventCount}`;
  } else {
    eventNote.textContent = "本次盘后没有触发事件节点";
  }
  for (const type of allEventTypes) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.addEventListener("change", () => {
      checkbox.checked ? enabledEventTypes.add(type) : enabledEventTypes.delete(type);
      renderEventOverlays(currentCode);
    });
    label.append(checkbox, document.createTextNode(type));
    eventFilters.appendChild(label);
  }

  function renderEventOverlays(code) {
    if (!chart) return;
    for (const id of overlayIds) chart.removeOverlay(id);
    overlayIds = [];
    const bars = validBars(code);
    const highByTimestamp = new Map(bars.map((bar) => [bar.timestamp, bar.high]));
    const range = bars.length
      ? Math.max(...bars.map((bar) => bar.high)) - Math.min(...bars.map((bar) => bar.low))
      : 0;
    const step = range > 0 ? range * 0.09 : 1;
    const stackCountByTimestamp = new Map();
    const visibleEvents = marketEvents(code)
      .filter((event) => enabledEventTypes.has(event.event) && highByTimestamp.has(event.timestamp))
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
      .slice(0, mobileViewport.matches ? 1 : 8)
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    document.querySelector("#event-summary").textContent = `事件 ${visibleEvents.length}`;
    for (const event of visibleEvents) {
      const high = highByTimestamp.get(event.timestamp);
      const stackIndex = stackCountByTimestamp.get(event.timestamp) || 0;
      stackCountByTimestamp.set(event.timestamp, stackIndex + 1);
      const eventLabel = event.value != null
        ? `${event.event} ${event.value}${event.unit || ""}`
        : event.event;
      const id = chart.createOverlay({
        name: "simpleAnnotation",
        points: [{ timestamp: event.timestamp, value: high + step * stackIndex }],
        extendData: eventLabel,
      });
      if (id) overlayIds.push(id);
    }
  }

  function show(code) {
    currentCode = code;
    renderSelectedStock(code);
    renderCandidates();
    renderStrategyLanes();
    const status = document.querySelector("#chart-status");
    if (marketByCode[code]) {
      if (chart) {
        chart.applyNewData(validBars(code));
        renderEventOverlays(code);
      }
      status.hidden = true;
      return;
    }
    if (chart) chart.applyNewData([]);
    status.textContent = "正在加载完整历史行情…";
    status.hidden = false;
    loadMarketData(code).then(() => {
      if (currentCode !== code) return;
      renderSelectedStock(code);
      if (chart) {
        chart.applyNewData(validBars(code));
        renderEventOverlays(code);
      }
      status.hidden = true;
    }).catch((error) => {
      if (currentCode !== code) return;
      status.textContent = String(error && error.message || "行情加载失败，请刷新重试");
    });
  }
  window.StockOpsResearchShow = show;

  function focusFirstVisibleResult() {
    const results = filteredResults();
    const currentIsVisible = results.some((item) => String(item.code) === currentCode);
    if (currentIsVisible) {
      renderCandidates();
      return;
    }
    const next = results[0];
    if (next) {
      show(String(next.code));
      return;
    }
    currentCode = null;
    renderSelectedStock(null);
    renderCandidates();
    if (chart) chart.applyNewData([]);
  }

  function selectStrategy(strategy) {
    activeStrategyGroup = null;
    activeStrategy = strategy;
    activeComparisonFilter = null;
    mobileCandidatesExpanded = false;
    renderCandidateComparison();
    renderStrategyObserver();
    focusFirstVisibleResult();
  }

  function selectRule(rule) {
    activeStrategyGroup = null;
    activeRule = activeRule === rule ? null : rule;
    activeComparisonFilter = null;
    mobileCandidatesExpanded = false;
    renderCandidateComparison();
    renderStrategyObserver();
    focusFirstVisibleResult();
  }

  function selectStrategyGroup(groupKey) {
    activeStrategyGroup = activeStrategyGroup === groupKey ? null : groupKey;
    activeStrategy = null;
    activeRule = null;
    activeComparisonFilter = null;
    mobileCandidatesExpanded = false;
    renderCandidateComparison();
    renderStrategyObserver();
    renderStrategyLanes();
    focusFirstVisibleResult();
  }

  for (const button of document.querySelectorAll("[data-comparison-period]")) {
    button.addEventListener("click", () => {
      activeComparisonPeriod = String(button.dataset.comparisonPeriod);
      activeComparisonFilter = null;
      openComparisonList = null;
      mobileCandidatesExpanded = false;
      renderCandidateComparison();
      renderStrategyObserver();
      const first = filteredResults()[0];
      if (first) show(String(first.code));
      else {
        renderSelectedStock(null);
        renderCandidates();
      }
    });
  }

  for (const button of document.querySelectorAll("[data-comparison-list-toggle]")) {
    button.addEventListener("click", () => {
      if (!mobileViewport.matches) return;
      const listName = String(button.dataset.comparisonListToggle);
      openComparisonList = openComparisonList === listName ? null : listName;
      renderCandidateComparison();
    });
  }

  document.querySelector("#strategy-mobile-toggle").addEventListener("click", () => {
    const section = document.querySelector(".strategy-observer");
    const isOpen = !section.classList.contains("is-mobile-open");
    section.classList.toggle("is-mobile-open", isOpen);
    document.querySelector("#strategy-mobile-toggle").setAttribute("aria-expanded", String(isOpen));
    document.querySelector("#strategy-mobile-toggle").textContent = isOpen ? "收起" : "展开";
  });

  document.querySelector("#history-mobile-toggle").addEventListener("click", () => {
    const panel = document.querySelector("#history-panel");
    const isOpen = !panel.classList.contains("is-mobile-open");
    panel.classList.toggle("is-mobile-open", isOpen);
    document.querySelector("#history-mobile-toggle").setAttribute("aria-expanded", String(isOpen));
    document.querySelector("#history-mobile-toggle").textContent = isOpen ? "收起" : "展开";
  });

  for (const button of document.querySelectorAll("[data-comparison-filter]")) {
    button.addEventListener("click", () => {
      activeComparisonFilter = button.dataset.comparisonFilter || null;
      activeStrategyGroup = null;
      activeStrategy = null;
      activeRule = null;
      mobileCandidatesExpanded = false;
      renderCandidateComparison();
      renderStrategyObserver();
      const first = filteredResults()[0];
      if (first) show(String(first.code));
      else {
        renderSelectedStock(null);
        renderCandidates();
      }
    });
  }


  window.addEventListener("resize", () => {
    if (chart && typeof chart.resize === "function") chart.resize();
  });

  renderRunMetadata();
  renderRankingIdentityWarning();
  renderStageWorkspace();
  renderRankingSummary();
  renderMetrics();
  // Candidate facts must render before optional research modules. Older run
  // payloads can lack newer board/research fields, but must never blank the
  // shared candidate pool.
  renderCandidates();
  renderStrategyLanes();
  renderSources();
  renderHistory();
  renderCandidateComparison();
  renderStrategyObserver();
  renderRiskFilters();
  const initialResult = filteredResults()[0];
  if (initialResult) show(String(initialResult.code));
  else renderCandidates();
})();
