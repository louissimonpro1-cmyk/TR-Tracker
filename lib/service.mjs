// Business layer shared by the local server (server.mjs) and the Vercel functions
// (api/*.js): assembles the dashboard payload, the performance series and the logo
// proxy, with light in-memory memoisation (survives while the process/instance is warm).
import { getTransactions } from "./sheet.mjs";
import { buildLedger } from "./ledger.mjs";
import {
  collectMarket, makePricer, buildDailyValues, buildIntradaySeries,
  buildHourlyValues, perfSeriesHourly,
  perfSeries, rangeStartIndex, ownPerf, todayParis,
} from "./portfolio.mjs";

export const PERF_RANGES = ["max", "3y", "1y", "6m", "1m", "1w", "1d"];

let marketMemo = null; // { at, promise }
async function getContext() {
  const txs = await getTransactions();          // cached 2 min inside sheet.mjs
  const ledger = buildLedger(txs);              // cheap, recomputed every time
  if (!marketMemo || Date.now() - marketMemo.at > 60 * 1000) {
    marketMemo = { at: Date.now(), promise: collectMarket(ledger) };
  }
  const market = await marketMemo.promise;
  return { ledger, market };
}

const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
// per-share amounts: 3 decimals normally, 6 for sub-euro assets (small-cap tokens)
const round3 = (x) => (x == null ? null : Math.abs(x) < 0.5 ? Math.round(x * 1e6) / 1e6 : Math.round(x * 1000) / 1000);

// ---- account labels -------------------------------------------------------
// Unknown account types keep their raw name and land at the end, so an account this
// code has never seen still gets its own section instead of being silently merged.
const ACCOUNT_META = {
  PEA: { label: "PEA", order: 1 },
  CTO: { label: "CTO", order: 2 },
  CRYPTO: { label: "Cryptos", order: 3 },
};
const metaOf = (id) => ACCOUNT_META[id] || { label: id, order: 9 };
const byOrder = (a, b) => metaOf(a.id).order - metaOf(b.id).order || a.id.localeCompare(b.id);

// ---- dashboard ------------------------------------------------------------
export async function getDashboard() {
  const { ledger, market } = await getContext();
  const items = [...ledger.assets.values()].map((a) => ({ a, p: makePricer(a, market) }));
  const openByBucket = new Map();   // bucket -> { positions, value, prevClose, cost, unrealized, realized }
  const closedByBucket = new Map(); // bucket -> { items, realized, invested }
  const openBucket = (id) => {
    if (!openByBucket.has(id)) openByBucket.set(id, { positions: [], value: 0, prevClose: 0, cost: 0, unrealized: 0, realized: 0 });
    return openByBucket.get(id);
  };
  const closedBucket = (id) => {
    if (!closedByBucket.has(id)) closedByBucket.set(id, { items: [], realized: 0, invested: 0 });
    return closedByBucket.get(id);
  };
  let positionsValue = 0, prevCloseValue = 0, unrealized = 0, realizedTotal = 0;
  let positionsCost = 0, archivesRealized = 0, archivesInvested = 0;

  // Most recent trading session among LISTED assets: one that did not trade in it
  // (market not yet open, holiday) counts as flat in the day change, matching the 1J
  // curve. Crypto trades 24/7 and is always in session, but never sets the reference.
  let sessionRef = null;
  for (const { a, p } of items) {
    if (!a.isOpen || a.isCrypto) continue;
    const sd = p.entry.intra?.sessionDate;
    if (sd && (!sessionRef || sd > sessionRef)) sessionRef = sd;
  }
  const tradesNow = (a, p) => a.isCrypto || p.entry.intra?.sessionDate === sessionRef;

  for (const { a, p } of items) {
    realizedTotal += a.realized;
    if (a.isOpen) {
      const value = a.shares * p.liveEur;
      const avgBuy = a.shares > 0 ? a.costBasis / a.shares : 0;
      const perShare = (raw, date) => (raw == null ? null : raw / p.factorAfter(date));
      const lastBuy = perShare(a.lastBuyPrice, a.lastBuyDate);
      const lastSell = perShare(a.lastSellPrice, a.lastSellDate);
      const prevValue = a.shares * (tradesNow(a, p) ? p.prevCloseEur : p.liveEur);
      positionsValue += value;
      positionsCost += a.costBasis;
      prevCloseValue += prevValue;
      unrealized += value - a.costBasis;
      const bucket = openBucket(a.bucket);
      bucket.value += value;
      bucket.prevClose += prevValue;
      bucket.cost += a.costBasis;
      bucket.unrealized += value - a.costBasis;
      bucket.realized += a.realized;
      bucket.positions.push({
        key: a.key, isin: a.isin, name: a.name, assetClass: a.assetClass, isCrypto: a.isCrypto,
        account: a.bucket,
        qty: a.shares,
        priceEur: round3(p.liveEur), priceSource: p.source,
        valueEur: round2(value),
        avgBuy: round3(avgBuy),
        perfPct: avgBuy > 0 ? round2((p.liveEur / avgBuy - 1) * 100) : null,
        perfEur: round2(value - a.costBasis),
        realized: round2(a.realized),
        investedEur: round2(a.costBasis),
        // transaction prices are restated per current share (splits/bonus shares),
        // otherwise the comparison with today's price is meaningless
        lastSellPrice: round3(lastSell),
        lastSellRaw: lastSell !== a.lastSellPrice ? round3(a.lastSellPrice) : null,
        lastSellDate: a.lastSellDate,
        vsLastSellPct: lastSell ? round2((p.liveEur / lastSell - 1) * 100) : null,
        vsLastSellEur: lastSell ? round3(p.liveEur - lastSell) : null,
        lastBuyPrice: round3(lastBuy),
        lastBuyRaw: lastBuy !== a.lastBuyPrice ? round3(a.lastBuyPrice) : null,
        lastBuyDate: a.lastBuyDate,
        vsLastBuyPct: lastBuy ? round2((p.liveEur / lastBuy - 1) * 100) : null,
        vsLastBuyEur: lastBuy ? round3(p.liveEur - lastBuy) : null,
        ownPerf: Object.fromEntries(Object.entries(ownPerf(a, p)).map(([k, v]) => [k, round2(v)])),
      });
    } else {
      // quantities restated per current share, so a split between the buy and the sell
      // cannot turn a real gain into a fake loss (10:1 split: 1 share bought = 10 sold)
      const perShare = (raw, date) => (raw == null ? null : raw / p.factorAfter(date));
      const adjQty = (lots) => lots.reduce((s, l) => s + l.qty * p.factorAfter(l.date), 0);
      const buyQtyAdj = adjQty(a.buyLots), sellQtyAdj = adjQty(a.sellLots);
      const avgBuy = buyQtyAdj > 0 ? a.buyValue / buyQtyAdj : 0;
      const avgSell = sellQtyAdj > 0 ? a.sellValue / sellQtyAdj : 0;
      const lastSell = perShare(a.lastSellPrice, a.lastSellDate);
      archivesRealized += a.realized;
      archivesInvested += a.buyValue;
      const group = closedBucket(a.bucket);
      group.realized += a.realized;
      group.invested += a.buyValue;
      // valLiveEur: rescaled to the instrument actually traded when Yahoo only has a proxy
      const current = p.hasMarket ? p.valLiveEur : null;
      group.items.push({
        key: a.key, isin: a.isin, name: a.name, assetClass: a.assetClass, isCrypto: a.isCrypto,
        account: a.bucket,
        avgBuy: round3(avgBuy), avgSell: round3(avgSell),
        perfPct: avgBuy > 0 && avgSell > 0 ? round2((avgSell / avgBuy - 1) * 100) : null,
        perfEur: round2(a.realized),
        lastOpDate: a.lastOpDate,
        lastSellPrice: round3(lastSell),
        lastSellRaw: lastSell !== a.lastSellPrice ? round3(a.lastSellPrice) : null,
        lastSellDate: a.lastSellDate,
        currentPrice: round3(current),
        vsLastSellPct: current != null && lastSell ? round2((current / lastSell - 1) * 100) : null,
        vsLastSellEur: current != null && lastSell ? round3(current - lastSell) : null,
      });
    }
  }

  // accounts with no open position at all are simply absent from the payload
  const accounts = [...openByBucket.entries()]
    .filter(([, b]) => b.positions.length > 0)
    .map(([id, b]) => ({
      id, label: metaOf(id).label,
      positions: b.positions.sort((x, y) => y.valueEur - x.valueEur),
      positionsValue: round2(b.value),
      // crypto is bought with the securities account's cash and has no pocket of its own
      cash: ledger.cashByAccount.has(id) ? round2(ledger.cashByAccount.get(id)) : null,
      invested: round2(b.cost),
      unrealized: round2(b.unrealized),
      unrealizedPct: b.cost > 0 ? round2((b.unrealized / b.cost) * 100) : null,
      realized: round2(b.realized),
      dayChangeEur: round2(b.value - b.prevClose),
      dayChangePct: b.prevClose > 0 ? round2((b.value / b.prevClose - 1) * 100) : null,
    }))
    .sort(byOrder);

  const archiveGroups = [...closedByBucket.entries()]
    .filter(([, g]) => g.items.length > 0)
    .map(([id, g]) => ({
      id, label: metaOf(id).label,
      items: g.items.sort((x, y) => (y.lastOpDate || "").localeCompare(x.lastOpDate || "")),
      realized: round2(g.realized),
      realizedPct: g.invested > 0 ? round2((g.realized / g.invested) * 100) : null,
    }))
    .sort(byOrder);

  const t = ledger.totals;
  return {
    updatedAt: new Date().toISOString(),
    today: todayParis(),
    totals: {
      positionsValue: round2(positionsValue),
      sessionDate: sessionRef,
      dayChangeEur: round2(positionsValue - prevCloseValue),
      dayChangePct: prevCloseValue > 0 ? round2((positionsValue / prevCloseValue - 1) * 100) : null,
      cash: round2(t.cash),
      accountValue: round2(positionsValue + t.cash),
      deposits: round2(t.deposits),
      withdrawals: round2(t.withdrawals),
      netDeposits: round2(t.deposits - t.withdrawals),
      unrealized: round2(unrealized),
      unrealizedPct: positionsCost > 0 ? round2((unrealized / positionsCost) * 100) : null,
      realized: round2(realizedTotal),
      archivesRealized: round2(archivesRealized),
      archivesRealizedPct: archivesInvested > 0 ? round2((archivesRealized / archivesInvested) * 100) : null,
      income: round2(t.dividendsNet + t.interestNet + t.bonuses),
      dividends: round2(t.dividendsNet),
      interest: round2(t.interestNet),
      bonuses: round2(t.bonuses),
      fees: round2(t.fees),
      taxes: round2(t.taxes),
    },
    accounts,
    archives: archiveGroups,
  };
}

// ---- performance series ---------------------------------------------------
const perfCache = new Map(); // range -> { at, data }
export async function getPerf(range) {
  if (!PERF_RANGES.includes(range)) throw Object.assign(new Error("range invalide"), { status: 400 });
  const ttl = range === "1d" ? 60 * 1000 : 5 * 60 * 1000;
  const hit = perfCache.get(range);
  if (hit && Date.now() - hit.at < ttl) return hit.data;

  const { ledger, market } = await getContext();
  const pack = (points, sessionDate = null) => ({
    range, sessionDate,
    points: points.map((p) => ({ t: p.t, pct: round3(p.pct), value: round2(p.value) })),
  });
  // keep index 0 (the 0% baseline) and every step-th point counted from the end
  const thin = (arr, step) => arr.filter((_, i) => i === 0 || (arr.length - 1 - i) % step === 0);

  let data;
  if (range === "1d") {
    const { sessionDate, sessionStart, points } = buildIntradaySeries(ledger, market);
    data = { ...pack(points, sessionDate), sessionStart };
  } else if (range === "1w" || range === "1m") {
    // hourly granularity: one point per market hour (1w), ~4 per day (1m)
    const { grid, dates, values } = buildHourlyValues(ledger, market);
    const startTs = Date.now() - (range === "1w" ? 7 : 30) * 86400000;
    let startIdx = grid.findIndex((t) => t >= startTs);
    if (startIdx === -1) startIdx = 0;
    if (grid.length - startIdx >= 10) {
      let points = perfSeriesHourly(grid, dates, values, ledger.flowsByDate, startIdx);
      if (range === "1m") points = thin(points, 4); // ~3-4 points per market day
      data = pack(points);
    }
  }
  if (!data) { // daily fallback (also covers hourly data being unavailable)
    const { dates, values } = buildDailyValues(ledger, market);
    const startIdx = rangeStartIndex(dates, range);
    data = pack(perfSeries(dates, values, ledger.flowsByDate, startIdx));
  }
  perfCache.set(range, { at: Date.now(), data });
  return data;
}

// ---- per-asset price series (mini chart inside the position cards) --------
const assetSeriesCache = new Map(); // asset key -> { at, data }
export async function getAssetSeries(key) {
  const hit = assetSeriesCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.data;

  const { ledger, market } = await getContext();
  const asset = ledger.assets.get(key);
  if (!asset) throw Object.assign(new Error("actif inconnu"), { status: 404 });
  const p = makePricer(asset, market);

  // adjusted EUR closes: consistent with the period pills (a split must not distort)
  const daily = p.hasMarket
    ? p.entry.daily.closes.map(([d]) => [d, round3(p.adjEurAt(d))])
    : [];
  let intraday = null;
  const intra = p.entry.intra;
  if (intra?.points?.length && p.prevCloseEur > 0) {
    intraday = {
      prevClose: round3(p.prevCloseEur),
      sessionDate: intra.sessionDate,
      prevSessionDate: intra.prevSessionDate ?? null,
      sessionStart: intra.sessionStartTs != null ? intra.sessionStartTs * 1000 : null,
      points: intra.points
        .map(([ts]) => [ts * 1000, round3(p.intraEurAt(ts))])
        .filter((x) => x[1] != null),
    };
  }
  // hourly bars (1 month) for the fine-grained 1S / 1M mini-chart views
  const hourly = (p.entry.hourly?.points || [])
    .map(([ts]) => [ts, round3(p.hourlyEurAt(ts))])
    .filter((x) => x[1] != null);
  const data = { key, isin: asset.isin, daily, hourly, intraday };
  assetSeriesCache.set(key, { at: Date.now(), data });
  return data;
}

// ---- logo proxy (Trade Republic asset CDN, keyed by ISIN) -----------------
const logoCache = new Map(); // `${isin}/${theme}` -> { ok, body }
export async function getLogo(isin, theme) {
  const t = theme === "dark" ? "dark" : "light";
  const key = `${isin}/${t}`;
  if (!logoCache.has(key)) {
    try {
      const r = await fetch(`https://assets.traderepublic.com/img/logos/${isin}/${t}.svg`);
      logoCache.set(key, r.ok ? { ok: true, body: Buffer.from(await r.arrayBuffer()) } : { ok: false });
    } catch {
      logoCache.set(key, { ok: false });
    }
  }
  return logoCache.get(key);
}
