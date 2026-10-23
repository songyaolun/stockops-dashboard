/* Frozen board facts shared by candidates, stock details and the existing board page. */
(function () {
  "use strict";

  /** Input plain text; output a safe DOM node without parsing provider HTML. */
  function node(tag, text) {
    const result = document.createElement(tag);
    if (text != null) result.textContent = text;
    return result;
  }

  /** Input fraction or null; output percent or an explicit unknown state. */
  function percent(value) {
    return value != null && Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "未知";
  }

  /** Input stable source identity; output a real local board detail URL. */
  function boardLink(row) {
    const anchor = node("a", `${row.name} · 查看板块详情`);
    anchor.href = `board-research.html#observation=${encodeURIComponent(row.entity_id)}`;
    return anchor;
  }

  /** Input frozen review rows; output calendar-based returns, pending and missing states. */
  function review(rows) {
    const section = node("details");
    section.append(node("summary", `后续观察（${rows.length}条入榜记录）`));
    section.append(node("p", "收益 =（到期收盘价 × 当日复权因子）/（信号收盘价 × 信号日复权因子）− 1。不扣交易成本，不是次日开盘可执行交易净收益；仅观察关联，不代表因果。"));
    for (const row of rows) {
      const line = node("p", `${row.signal_date} ${row.code}：`);
      line.append(node("span", [1, 5, 10, 20].map((horizon) => {
        const window = row.windows?.[String(horizon)];
        return `${horizon}日 ${window?.status === "mature" ? percent(window.return) : window?.status === "pending" ? "待观察" : "缺价格或日历"}`;
      }).join(" · ")));
      section.append(line);
    }
    if (!rows.length) section.append(node("p", "尚无已留档的入榜观察。"));
    return section;
  }

  /** Input a board row; output the evidence, denominators and historical gaps unchanged. */
  function evidence(row, snapshot, code) {
    const article = node("article");
    article.className = "observation-evidence";
    article.dataset.entityId = row.entity_id;
    article.append(boardLink(row), node("p", row.description));
    const details = node("details");
    const priceCount = row.expected_price_count ?? row.member_count;
    const memberNames = (members) => (members || []).map((member) => `${row.member_names?.[member] || ""} ${member}`.trim()).join("、") || "无";
    details.append(node("summary", `上涨 ${row.up_members}/${row.valid_members} · 行情覆盖 ${row.valid_members}/${priceCount} · 展开证据`));
    details.append(node("p", `${row.date} · ${row.source} · ${row.code} · 关系来源观察于 ${row.observed_at || "未知"}`));
    if (row.expected_price_count != null) {
      details.append(node("p", `已上市 ${row.listed_member_count}只 · 全天停牌 ${(row.suspended_members || []).length}只 · 待上市 ${(row.pending_listing_members || []).length}只另列 · 上市状态待核实 ${(row.unknown_listing_members || []).length}只`));
      details.append(node("p", `应有行情 ${priceCount}只，实际 ${row.valid_members}只 · 覆盖率 ${percent(row.coverage)}。全天停牌不计行情分母；真正缺数仍计入应有数量。`));
      if (row.suspended_members?.length) details.append(node("p", `全天停牌：${memberNames(row.suspended_members)} · 不计行情、等权和涨停分母，保留在资金分母 · ${row.suspension_source} · ${row.suspension_date}`));
      if (row.pending_listing_members?.length) details.append(node("p", `待上市：${memberNames(row.pending_listing_members)} · 不参与计算；依据证券主表及发行资料，行业纳入日期不是上市日期。`));
      if (row.unknown_listing_members?.length) details.append(node("p", `上市状态待核实：${memberNames(row.unknown_listing_members)} · 仍保留分母，未按缺数排除。`));
      details.append(node("p", `行情缺失：${memberNames(row.missing_price_members)} · 涨停计算所需数据缺失：${memberNames(row.missing_limit_members)}`));
    } else {
      details.append(node("p", `旧观察口径 · 成员 ${row.member_count} · 覆盖率 ${percent(row.coverage)}；未留档上市、停牌分类，不推算新分母。`));
    }
    if (row.membership_gap) details.append(node("p", `成员关系缺口：${row.membership_gap}`));
    details.append(node("p", `有效样本等权 ${percent(row.sample_equal_return)} · ${row.expected_price_count != null ? "应交易成员等权" : "全体等权"} ${percent(row.equal_return)} · 涨停广度 ${percent(row.limit_up_breadth)}（边界 ${row.limit_boundary_members}/${priceCount}）`));
    const flow = row.flow || {};
    details.append(node("p", `资金同日确认：${flow.confirmed == null ? "未知" : flow.confirmed ? "价格与净流入均为正" : "未共同为正"} · 资金覆盖 ${flow.covered_members ?? 0}/${flow.expected_members ?? row.member_count} · ${flow.source || "未知来源"} · ${flow.date || "日期未知"} · 净流入 ${flow.net_inflow == null ? "未知" : `${Number(flow.net_inflow).toLocaleString("zh-CN")}元`}`));
    if (flow.missing_members?.length) details.append(node("p", `资金缺失：${memberNames(flow.missing_members)} · 缺失不补零。`));
    details.append(node("p", `前三上涨贡献占比 ${percent(row.top3_positive_share)}（仅有效样本的正收益之和为分母）`));
    const contributionStatus = row.coverage === 1
      ? `本股${(row.contributors || []).some((item) => item.code === code) ? "在" : "不在"}前三贡献者中`
      : "本股前三贡献身份未知（行情未全覆盖）";
    details.append(node("p", `主要贡献者（有效样本）：${(row.contributors || []).map((item) => `${item.code} ${percent(item.positive_share)}`).join("、") || "无可用正收益贡献"}${code ? `；${contributionStatus}` : ""}`));
    const crowding = row.crowding || {};
    const crowdingReason = {
      industry_snapshot_not_loaded: "本次未载入行业数据中心的拥挤度快照",
      industry_snapshot_date_mismatch: "行业数据中心快照日期与本页不一致",
      industry_crowding_entity_missing: "同日快照缺少该行业的拥挤度记录",
      industry_crowding_source_conflict: "同一行业存在重复拥挤度来源，未择一使用",
      existing_crowding_unavailable: "本次没有可核验的拥挤度结果",
    };
    details.append(node("p", `拥挤度分位 ${percent(crowding.value)} · ${crowdingReason[crowding.reason] || crowding.window || "本次没有可核验的拥挤度结果"} · ${crowding.source || "来源未载入"} · 仅观察，不参与榜单算分`));
    if (crowding.quality) details.append(node("p", `窗口质量：${JSON.stringify(crowding.quality)}`));
    details.append(node("p", `近5次观察：${row.history_window?.available || 1}/5 · ${row.history_window?.status === "ready" ? "窗口齐全" : "不足或成员变更，状态未知"}`));
    for (const point of row.trend || []) details.append(node("p", `${point.date} · 上涨 ${percent(point.up_breadth)} · 样本等权 ${percent(point.sample_equal_return)} · 覆盖 ${percent(point.coverage)}${point.membership_changed ? " · 成员变更，不直接比较" : ""}`));
    const candidates = (snapshot.candidates || []).filter((item) => (snapshot.associations?.[item.code] || []).includes(row.entity_id));
    for (const candidate of candidates) {
      const anchor = node("a", `查看 ${candidate.name || candidate.code} 个股研究`);
      anchor.href = `stock-analysis.html?code=${encodeURIComponent(candidate.code)}`;
      details.append(anchor);
    }
    article.append(details);
    return article;
  }

  /** Input shared snapshot and optional stock code; output one compact observation region. */
  function render(target, snapshot, code) {
    if (!target) return;
    target.classList.add("board-observation");
    target.replaceChildren(node("h2", "行业与题材观察"));
    const all = snapshot?.rows || [];
    const identities = snapshot?.associations?.[code] || [];
    const rows = code ? all.filter((row) => identities.includes(row.entity_id)) : all;
    if (!rows.length) {
      target.append(node("p", snapshot?.reason || "缺同日板块事实或本股成员关系；仅此观察区不可用。榜单与模拟计划不受影响。"));
      return;
    }
    target.append(node("p", `${snapshot.date} · 只描述事实，不改变排序和交易计划。多个题材分别观察，重叠成员不算多份独立利好。`));
    if (code) {
      for (const row of rows) target.append(evidence(row, snapshot, code));
    } else {
      const label = node("label", `全市场 ${rows.length} 个来源实体 `);
      const select = node("select");
      select.setAttribute("aria-label", "选择行业或题材观察");
      for (const row of rows) {
        const option = node("option", `${row.name} · ${row.classification} · ${row.code}`);
        option.value = row.entity_id;
        select.append(option);
      }
      const detail = node("div");
      const update = () => {
        const selected = rows.find((row) => row.entity_id === select.value);
        detail.replaceChildren(evidence(selected, snapshot));
        detail.querySelector("details").open = true;
        detail.append(review((snapshot.review || []).filter((row) => row.entity_ids.includes(selected.entity_id))));
      };
      const fromHash = () => {
        if (!location.hash.startsWith("#observation=")) return;
        const requested = new URLSearchParams(location.hash.slice(1)).get("observation");
        if (rows.some((row) => row.entity_id === requested)) { select.value = requested; update(); target.scrollIntoView(); }
      };
      select.addEventListener("change", () => { history.replaceState(null, "", `#observation=${encodeURIComponent(select.value)}`); update(); });
      label.append(select);
      target.append(label, detail);
      update();
      fromHash();
      window.addEventListener("hashchange", fromHash);
    }
    if (code) target.append(review((snapshot.review || []).filter((row) => row.code === code)));
    const formulas = node("details");
    formulas.append(node("summary", "计算口径与版本"));
    formulas.append(node("p", `${snapshot.schema_version} · 历史PIT未认证`));
    for (const value of Object.values(snapshot.formulas || {})) formulas.append(node("p", value));
    target.append(formulas);
  }

  window.StockOpsBoardObservation = {review, render};
  if (window.__STOCKOPS_BOARD_RESEARCH__) render(document.getElementById("board-observation"), window.__STOCKOPS_BOARD_RESEARCH__.board_observation);
})();
