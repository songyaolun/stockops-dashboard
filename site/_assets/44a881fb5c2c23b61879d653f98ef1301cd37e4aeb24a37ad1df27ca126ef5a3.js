/* Presentation of frozen strategy facts; never computes ranks or trade prices. */
(function () {
  "use strict";

  /** Input: a frozen row. Output: its rank and original signed model score. */
  function label(row) {
    return `#${row.rank} · ${Number(row.expected_net_return_score).toFixed(4)}`;
  }

  /** Input: a frozen row. Output: explicit conditional-entry or blocked wording. */
  function status(row) {
    return row.paper_action?.reason || row.entry_plan?.reason || (row.entry_eligible ? "次日条件候选（旧版未计算买入名额）" : "不买：共同交易资格未通过（旧版未记录具体原因）");
  }

  /** Input: price 10. Output: 10.00 元; missing evidence remains an em dash. */
  function price(value) {
    return value != null && Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)} 元` : "—";
  }

  /** Input: list target and plain text rows. Output: safe list nodes; an empty list shows its reason. */
  function paperList(id, lines, empty) {
    const target = document.getElementById(id);
    target.replaceChildren();
    for (const text of lines.length ? lines : [empty]) {
      const item = document.createElement("li");
      item.textContent = text;
      target.appendChild(item);
    }
  }

  /** Input: frozen simulated portfolio plan. Output: identical desktop/mobile holdings and paired orders. */
  function paperSummary(plan, snapshot) {
    const brokerStatus = document.getElementById("return80-broker-status");
    brokerStatus.hidden = !snapshot.broker_status;
    brokerStatus.textContent = snapshot.broker_status?.message || "";
    document.getElementById("return80-paper").hidden = !plan;
    if (!plan) return;
    const futu = plan.backend === "futu";
    document.getElementById("return80-paper-account").textContent = `截至 ${plan.as_of} · 启动于 ${plan.start_date} · 模拟仓位 ${(plan.exposure * 100).toFixed(1)}% · ${futu ? "策略可用现金" : "可用现金"} ${price(plan.cash)} · ${futu ? "策略净值" : "模拟总资产"} ${price(plan.nav)}`;
    const official = document.getElementById("return80-paper-official");
    official.hidden = !futu;
    official.textContent = futu ? `富途总资产 ${price(plan.official_assets)} · 固定保留 ${price(plan.reserved_cash)}。仓位按策略净值计算。` : "";
    document.getElementById("return80-paper-assumption").textContent = plan.assumption;
    document.getElementById("return80-paper-rule").textContent = plan.rule;
    document.getElementById("return80-paper-title").textContent = futu ? plan.label : !snapshot.model_display_name
      ? "历史模拟组合"
      : plan.start_date === plan.as_of ? "新模型模拟组合 · 首日计划" : "模拟组合今日行动";
    document.getElementById("return80-buy-heading").textContent = `${plan.next_session}开盘 · 准备买入${plan.buys.length}只`;
    document.getElementById("return80-buy-budget").textContent = `预算上限合计 ${price(plan.buys.reduce((total, order) => total + order.budget, 0))}（含费用）。开盘价确定后按预算和整手规则计算股数；超价或不能成交就取消，不盘中追买。`;
    if (futu) document.getElementById("return80-buy-budget").textContent = `预算上限合计 ${price(plan.buys.reduce((total, order) => total + order.budget, 0))}（含费用缓冲）。09:30起提交限价单，09:35撤余单；成交价和股数以富途回报为准，不保证开盘价成交。`;
    document.getElementById("return80-holdings-summary").textContent = `查看${plan.holdings.length}只模拟持仓：继续持有${plan.holdings.filter((row) => row.action !== "sell").length}只，待卖出${plan.holdings.filter((row) => row.action === "sell").length}只`;
    const performance = document.getElementById("return80-performance-summary");
    const capital = Number(plan.capital);
    performance.textContent = `截至 ${plan.as_of} · 初始本金 ${price(plan.capital)} · 当前权益 ${price(plan.nav)} · 累计收益 ${capital > 0 && Number.isFinite(Number(plan.nav)) ? ((Number(plan.nav) / capital - 1) * 100).toFixed(2) + "%" : "未知"} · 仓位 ${(plan.exposure * 100).toFixed(1)}%`;
    document.getElementById("return80-performance-basis").textContent = `${plan.assumption} 累计收益=当前账本权益/初始本金−1，包含账本交易成本；不是入榜后的观察收益，也不是个人账户收益。`;
    if (futu) document.getElementById("return80-performance-basis").textContent = `${plan.assumption} 累计收益=策略净值/120000−1。${plan.fees_status}`;
    const noBuy = plan.exposure > snapshot.maximum_total_weight + 1e-9
      ? `本组合今晚不新增买单：当前仓位${(plan.exposure * 100).toFixed(1)}%高于新买总仓上限${(snapshot.maximum_total_weight * 100).toFixed(0)}%，不通过换仓补买，也不因此强平。`
      : "本组合今晚不新增买单：按当前现金、仓位名额、共同资格和替换条件，没有生成可执行的条件买单。掉出榜单不会自动卖出。";
    document.getElementById("return80-paper-execution-rule").textContent = plan.execution_rule;
    paperList("return80-paper-holdings", plan.holdings.map((row) => `${row.action === "sell" ? "待卖出" : "继续持有"}：${row.name} ${row.code} · 持有${row.held_sessions}日 · 模拟成交价 ${price(row.entry_price)} · 止盈 ${price(row.take_profit)} · 止损 ${price(row.stop_loss)} · ${row.reason}${row.price_stale ? "；停牌或缺当日价格" : ""}`), "模拟组合当前空仓。");
    paperList("return80-paper-buys", plan.buys.map((row) => `条件买入：${row.name} ${row.code} · 追价上限 ${price(row.maximum_entry_price_reference)} · 预算不超过 ${price(row.budget)} · ${row.required_sales ? `须先卖出${row.sale_dependencies.join("、")}，至少成交${row.required_sales}笔` : "使用可用现金，仍须满足仓位和行业上限"}`), noBuy);
    paperList("return80-paper-executions", plan.executions.map((row) => `${({buy: "模拟买入", sell: "模拟卖出", cancel: "订单未成交"})[row.action]}：${row.name} ${row.code} · ${row.price == null ? row.reason : `${price(row.price)}，${row.shares}股`}`), "今日无模拟成交或取消记录。");
  }

  /** Input: immutable identity and rows. Output: shared summary without legacy weights. */
  function summary(identity, rows) {
    const snapshot = identity.source_snapshot;
    const topCount = snapshot.top_count ?? 10;
    const positionWeight = `${((snapshot.paper_plan?.position_weight ?? snapshot.position_weight ?? 0.05) * 100).toFixed(0)}%`;
    const modelName = snapshot.model_display_name || "历史冻结模型";
    const target = document.getElementById("return80-summary");
    target.hidden = false;
    document.getElementById("return80-title").textContent = `每日 Top ${topCount} · ${modelName}`;
    document.getElementById("return80-date").textContent = `信号日 ${identity.signal_date} · 仅下一交易日开盘有效`;
    document.getElementById("return80-count").textContent = `${rows.length} 只候选 · ${rows.filter((row) => row.entry_eligible).length} 只通过共同资格`;
    document.getElementById("return80-market").textContent = `市场广度 ${(snapshot.market_breadth * 100).toFixed(1)}% · 新买入总仓上限 ${(snapshot.maximum_total_weight * 100).toFixed(0)}% · 单股${positionWeight} · 行业40%`;
    const plan = snapshot.entry_plan;
    const entryPanel = document.getElementById("return80-allocation");
    entryPanel.hidden = !plan;
    document.getElementById("return80-ranking-rule").textContent = plan
      ? "按预测净收益从高到低排序，每行业最多一只；资格失败不从榜外补位。分数不是胜率。"
      : "旧版榜单：先取前十，再检查共同资格，不补位；未计算空仓买入安排。";
    if (plan) {
      document.getElementById("return80-market").textContent = `${plan.market_label} · 市场广度 ${(snapshot.market_breadth * 100).toFixed(1)}% · 新买入总仓上限 ${(snapshot.maximum_total_weight * 100).toFixed(0)}% · 单股${positionWeight}`;
      document.getElementById("return80-market-rule").textContent = plan.market_rule;
      document.getElementById("return80-priority").textContent = `空仓优先准备：${rows.filter((row) => plan.selected_codes.includes(row.code)).map((row) => row.name).join("、") || "无"}`;
      document.getElementById("return80-planned-weight").textContent = `每只${positionWeight} · 计划合计${(plan.planned_weight * 100).toFixed(0)}% · 当日Top${topCount}每行业最多一只`;
      document.getElementById("return80-assumption").textContent = plan.assumption;
      document.getElementById("return80-cancel-rule").textContent = plan.cancel_rule;
      document.getElementById("return80-not-planned").textContent = rows.filter((row) => row.entry_plan.status !== "priority_entry")
        .map((row) => `${row.name}：${row.entry_plan.reason}`).join("；") || "本榜单均已安排条件买入；不等于已成交。";
    }
    document.getElementById("return80-sample").textContent = snapshot.sample_semantics;
    const scope = snapshot.selection_scope;
    document.getElementById("return80-scope").textContent = scope
      ? `筛选范围：${scope.label}；创业板${scope.allow_chinext ? "开放" : "关闭"}，科创板${scope.allow_star_market ? "开放" : "关闭"}。范围由运行配置控制，历史快照保留当时设置。`
      : "历史快照未记录板块开关，不代表当前仅主板范围。";
    paperSummary(snapshot.paper_plan, snapshot);
    document.querySelector(".candidate-intro p").textContent = `与盘后推送共用同一份 Top ${topCount}；筛选不重排，点击股票查看买入条件与技术图。`;
    document.querySelector(".candidate-panel h2").textContent = `每日 Top ${topCount}`;
    document.querySelector(".candidate-columns span:last-child").textContent = "名次 · 模型分";
    document.querySelector("#selected-score").previousElementSibling.textContent = "名次 · 模型分";
    document.querySelector("#selection-rule-filters").closest(".observer-filter-band").hidden = true;
    document.querySelector(".candidate-risk-filter").hidden = true;
  }

  /** Input: selected row. Output: entry limit and actual holding exits, or formulas before entry. */
  function selected(row) {
    let observation = document.getElementById("candidate-board-observation");
    if (!observation) {
      observation = document.createElement("section");
      observation.id = "candidate-board-observation";
      document.getElementById("return80-plan").after(observation);
    }
    window.StockOpsBoardObservation?.render(observation, window.__STOCKOPS_DATA__?.board_observation, row?.code);
    const target = document.getElementById("return80-plan");
    target.hidden = !row || !row.price_plan;
    if (target.hidden) return;
    const plan = row.price_plan;
    document.getElementById("return80-entry-status").textContent = status(row);
    document.getElementById("return80-entry-status").dataset.eligible = String(row.paper_action ? row.paper_action.status === "buy" : (row.entry_plan ? row.entry_plan.status === "priority_entry" : row.entry_eligible));
    for (const [id, field] of Object.entries({
      "return80-close": "reference_close", "return80-entry": "maximum_entry_price_reference",
    })) document.getElementById(id).textContent = price(plan[field]);
    const holding = row.paper_holding;
    const held = holding || ["hold", "sell"].includes(row.paper_action?.status);
    document.getElementById("return80-entry").textContent = held ? "已有持仓，不重复买入" : price(plan.maximum_entry_price_reference);
    document.getElementById("return80-profit").textContent = holding ? price(holding.take_profit) : held ? "见模拟持仓明细" : "实际成交价×1.045（待成交）";
    document.getElementById("return80-stop").textContent = holding ? price(holding.stop_loss) : held ? "见模拟持仓明细" : "实际成交价×0.92（待成交）";
    document.getElementById("stock-strategies").textContent = `${row.sector} · ${row.signals.join("、")} · ${status(row)}`;
    document.getElementById("stock-strategies").title = row.signals.join("、");
    document.getElementById("selected-score").textContent = label(row);
  }

  window.StockOpsReturn80 = {label, status, price, summary, selected};
})();
