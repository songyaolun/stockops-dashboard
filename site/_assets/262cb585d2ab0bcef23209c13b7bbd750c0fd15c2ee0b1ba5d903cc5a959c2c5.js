(function () {
  "use strict";

  function symbolParts(code) {
    const value = String(code || "").toUpperCase();
    const [number, exchange] = value.split(".");
    if (!/^\d{6}$/.test(number) || !["SH", "SZ", "BJ"].includes(exchange)) {
      throw new Error(`不支持的股票代码：${value}`);
    }
    return {
      number,
      exchange,
      prefix: exchange === "SH" ? "sh" : exchange === "SZ" ? "sz" : "bj",
      market: exchange === "SH" ? "1" : exchange === "SZ" ? "0" : "0",
    };
  }

  function timestamp(day) {
    return Date.parse(`${String(day)}T00:00:00+08:00`);
  }

  function normalizeBars(rows) {
    return rows
      .map((row) => ({
        timestamp: timestamp(row[0]),
        open: Number(row[1]),
        close: Number(row[2]),
        high: Number(row[3]),
        low: Number(row[4]),
        volume: Number(row[5]),
      }))
      .filter((bar) => (
        Number.isFinite(bar.timestamp)
        && Number.isFinite(bar.open)
        && Number.isFinite(bar.high)
        && Number.isFinite(bar.low)
        && Number.isFinite(bar.close)
        && Number.isFinite(bar.volume)
      ));
  }

  function eastmoneyUrl(code, adjust, limit) {
    const parts = symbolParts(code);
    const fqt = adjust === "none" ? 0 : 1;
    const params = new URLSearchParams({
      secid: `${parts.market}.${parts.number}`,
      klt: "101",
      fqt: String(fqt),
      lmt: String(limit),
      end: "20500101",
      fields1: "f1,f2,f3,f4,f5,f6",
      fields2: "f51,f52,f53,f54,f55,f56",
    });
    return `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`;
  }

  function tencentUrl(code, adjust, limit) {
    const parts = symbolParts(code);
    const mode = adjust === "none" ? "" : "qfq";
    return (
      "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
      + `?param=${parts.prefix}${parts.number},day,,,${limit},${mode}`
    );
  }

  async function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function fromEastmoney(code, options) {
    const payload = await fetchJson(
      eastmoneyUrl(code, options.adjust, options.limit),
      options.timeoutMs
    );
    const rows = payload && payload.data && payload.data.klines;
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error("东方财富未返回日线");
    }
    return {
      source: "eastmoney-browser",
      adjust: options.adjust,
      bars: normalizeBars(rows.map((value) => String(value).split(","))),
      events: [],
    };
  }

  async function fromTencent(code, options) {
    const parts = symbolParts(code);
    const payload = await fetchJson(
      tencentUrl(code, options.adjust, Math.min(options.limit, 1000)),
      options.timeoutMs
    );
    const item = payload && payload.data && payload.data[`${parts.prefix}${parts.number}`];
    const rows = item && (options.adjust === "none" ? item.day : item.qfqday);
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error("腾讯未返回日线");
    }
    return {
      source: "tencent-browser",
      adjust: options.adjust,
      bars: normalizeBars(rows),
      events: [],
    };
  }

  async function load(code, options) {
    const config = Object.assign({
      adjust: "qfq",
      limit: 1000,
      timeoutMs: 8000,
    }, options || {});
    const failures = [];
    for (const provider of [fromEastmoney, fromTencent]) {
      try {
        const result = await provider(code, config);
        if (result.bars.length) return result;
      } catch (error) {
        failures.push(String(error && error.message || error));
      }
    }
    throw new Error(`免费日线接口均失败：${failures.join("；")}`);
  }

  window.StockOpsRemoteMarket = {
    eastmoneyUrl,
    load,
    normalizeBars,
    symbolParts,
    tencentUrl,
  };
})();
