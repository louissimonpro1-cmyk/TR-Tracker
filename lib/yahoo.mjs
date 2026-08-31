// Yahoo Finance access: ISIN -> ticker resolution, daily history (10y), intraday bars
// and FX series, with layered caching (memory + disk under cache/).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// on Vercel the filesystem is read-only except /tmp (cache is best-effort there)
const CACHE_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "tr-dashboard-cache")
  : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cache");
const HIST_DIR = path.join(CACHE_DIR, "history");
const SYMBOLS_FILE = path.join(CACHE_DIR, "symbols.json");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "application/json,text/plain,*/*",
};
const DAILY_TTL = 30 * 60 * 1000;      // daily history refreshed every 30 min
const INTRA_TTL = 60 * 1000;           // intraday quotes refreshed every 60 s
const NULL_SYMBOL_RETRY = 7 * 24 * 3600 * 1000; // retry unresolvable ISINs weekly

await fs.mkdir(HIST_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeName = (s) => s.replace(/[^A-Za-z0-9._-]/g, "_");

async function yjson(url) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return null; // 404/40x: unknown symbol, not a transient error
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(500 * (i + 1) * (i + 1));
    }
  }
  throw lastErr;
}

// ---- ISIN -> Yahoo symbol -------------------------------------------------
let symbols = null;
async function loadSymbols() {
  if (symbols) return symbols;
  try { symbols = JSON.parse(await fs.readFile(SYMBOLS_FILE, "utf8")); }
  catch { symbols = {}; }
  return symbols;
}

// Crypto rows carry a ticker (BTC, ETH) instead of an ISIN; Yahoo quotes them
// directly in EUR as "<TICKER>-EUR", so no search and no FX conversion is needed.
export async function resolveSymbol(asset) {
  if (asset.isCrypto) return `${asset.isin}-EUR`;
  return resolveIsin(asset.isin);
}

/* There used to be a fallback here: when the ISIN lookup came back empty, the holding's
   name was searched instead. It was removed after it did real damage.

   Structured products carry generic thematic names. "Semiconductors" resolved to NXPI
   and "Cyber Security" to HUBC — unrelated single stocks that were then used to value
   those positions across their whole history, throwing off the portfolio-wide return.
   The transaction-price guard in portfolio.mjs does not save this case: it rescales a
   mismatched series instead of rejecting it, so a wrong instrument is quietly made to
   look plausible.

   The asymmetry is what settles it. A holding with no quote is visible and honest: the
   price freezes at the last transaction and wears the "≈" badge. A holding priced off
   the wrong instrument is invisible and contaminates the P&L, the performance curve and
   the alerts. So an ISIN that cannot be resolved is now left unresolved, and the few
   cases worth fixing are pinned explicitly below. */

// Some ISINs the search endpoint cannot answer, or answers with a thin secondary
// listing whose history is far shorter than the primary line's. Pinning them makes
// the resolution deterministic instead of depending on a lookup that may return
// nothing — which is exactly what broke on Vercel, where the symbol cache starts
// empty on every cold start while a local cache keeps a stale answer alive.
const SYMBOL_OVERRIDES = {
  // Alphabet. Searching this ISIN returns zero quotes (checked 2026-08-23), so the
  // position ended up with no series at all in production. Yahoo used to answer
  // 1GOOGL.MI (Borsa Italiana), whose history only starts 2017-10-31 and therefore
  // cannot feed the 10 A view either. Class A, not C: checked against the actual
  // execution prices in the ledger, GOOGL is off by 0.35 % / 0.45 % where GOOG is
  // off by 0.70 % / 1.50 %, which also matches the "(A)" label on the statement.
  US02079K3059: "GOOGL",

  // Société Générale structured products. Explicitly pinned to null, not merely left
  // unresolved: it also invalidates any wrong symbol a previous run may have written
  // into the symbol cache, which would otherwise survive until its entry expires.
  DE000SQ4SUR5: null, // "Semiconductors", once mis-resolved to NXPI
  DE000SQ4SUN4: null, // "Cyber Security", once mis-resolved to HUBC
  DE000SN8ZNF4: null, // "Nachhaltigkeit & Klimawandel"
  DE000SW7VD46: null, // "Long Faktor Optionsschein 3"
};

export async function resolveIsin(isin) {
  if (isin in SYMBOL_OVERRIDES) return SYMBOL_OVERRIDES[isin]; // `in`, so a pinned null wins
  await loadSymbols();
  const e = symbols[isin];
  if (e && (e.symbol || Date.now() - e.at < NULL_SYMBOL_RETRY)) return e.symbol || null;
  let q = null;
  try {
    const j = await yjson(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}&quotesCount=6&newsCount=0`);
    q = j?.quotes?.find((x) => x.symbol) ?? null;
  } catch { return e?.symbol ?? null; } // network trouble: keep whatever we knew
  symbols[isin] = { symbol: q?.symbol ?? null, name: q?.longname ?? q?.shortname ?? null, at: Date.now() };
  await fs.writeFile(SYMBOLS_FILE, JSON.stringify(symbols, null, 2)).catch(() => {});
  return symbols[isin].symbol;
}

// ---- price history --------------------------------------------------------
const dateStr = (ts, gmtoffset) => new Date((ts + (gmtoffset || 0)) * 1000).toISOString().slice(0, 10);

function parseChart(j) {
  const r = j?.chart?.result?.[0];
  if (!r?.meta) return null;
  const meta = r.meta;
  const ts = r.timestamp || [];
  const cl = r.indicators?.quote?.[0]?.close || [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) if (cl[i] != null) bars.push([ts[i], cl[i]]);
  return {
    currency: meta.currency,
    gmtoffset: meta.gmtoffset || 0,
    live: meta.regularMarketPrice ?? (bars.length ? bars[bars.length - 1][1] : null),
    liveTime: meta.regularMarketTime ?? null,
    prevClose: meta.chartPreviousClose ?? null,
    bars,
  };
}

const memDaily = new Map();
export async function dailyHistory(symbol) {
  const hit = memDaily.get(symbol);
  if (hit && Date.now() - hit.at < DAILY_TTL) return hit.data;
  const file = path.join(HIST_DIR, `${safeName(symbol)}-1d.json`);
  if (!hit) {
    try {
      const disk = JSON.parse(await fs.readFile(file, "utf8"));
      memDaily.set(symbol, disk);
      if (Date.now() - disk.at < DAILY_TTL) return disk.data;
    } catch { /* no disk cache yet */ }
  }
  try {
    // 10y, not max: with range=max Yahoo silently drops to monthly bars (AMD returns
    // 168 points since 1984), which would wreck the daily valuation series. 10y keeps
    // true daily bars and is what the 5 A / 10 A period pills need.
    const j = await yjson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d`);
    const c = parseChart(j);
    if (!c) throw new Error(`no chart data for ${symbol}`);
    const byDate = new Map(); // one close per calendar date (exchange timezone), last wins
    for (const [ts, close] of c.bars) byDate.set(dateStr(ts, c.gmtoffset), close);
    const data = {
      currency: c.currency, live: c.live, liveTime: c.liveTime, prevClose: c.prevClose,
      closes: [...byDate.entries()], // [[date, close], ...] chronological
    };
    const entry = { at: Date.now(), data };
    memDaily.set(symbol, entry);
    await fs.writeFile(file, JSON.stringify(entry)).catch(() => {});
    return data;
  } catch (e) {
    const stale = memDaily.get(symbol);
    if (stale) return stale.data; // stale-if-error
    throw e;
  }
}

const memIntra = new Map();
export async function intradayHistory(symbol) {
  const hit = memIntra.get(symbol);
  if (hit && Date.now() - hit.at < INTRA_TTL) return hit.data;
  try {
    const j = await yjson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=5m&includePrePost=false`);
    const c = parseChart(j);
    if (!c) throw new Error(`no intraday data for ${symbol}`);
    // keep the last two sessions: the current one plus the previous day's tail,
    // so the 1J view can show a rolling market day
    let points = c.bars;
    let sessionDate = null, prevSessionDate = null, prevSessionClose = null, sessionStartTs = null;
    if (points.length) {
      const days = [];
      for (const [ts] of points) {
        const d = dateStr(ts, c.gmtoffset);
        if (days[days.length - 1] !== d) days.push(d);
      }
      sessionDate = days[days.length - 1];
      if (days.length >= 2) prevSessionDate = days[days.length - 2];
      const keep = new Set([sessionDate, prevSessionDate].filter(Boolean));
      points = points.filter(([ts]) => keep.has(dateStr(ts, c.gmtoffset)));
      for (const [ts, close] of points) {
        const d = dateStr(ts, c.gmtoffset);
        if (d === prevSessionDate) prevSessionClose = close; // last bar of the previous session
        else if (sessionStartTs == null) sessionStartTs = ts;
      }
    }
    const data = {
      currency: c.currency, live: c.live, liveTime: c.liveTime,
      // close of the previous session; null when unknown (daily series is the fallback)
      prevClose: prevSessionClose,
      sessionDate, prevSessionDate, sessionStartTs,
      points, // [[unix_ts, close], ...] spanning up to two sessions
    };
    memIntra.set(symbol, { at: Date.now(), data });
    return data;
  } catch (e) {
    const stale = memIntra.get(symbol);
    if (stale) return stale.data;
    throw e;
  }
}

// The whole listing history in monthly bars, feeding the "Tout" view alone. Monthly is
// the only granularity Yahoo serves that far back, and it is plenty for a 25-year curve:
// NVIDIA since 1999 fits in 11 kB. Refreshed twice a day — only the current month's bar
// moves, and the view is anchored on its first point.
const MONTHLY_TTL = 12 * 60 * 60 * 1000;
const memMonthly = new Map();
export async function monthlyHistory(symbol) {
  const hit = memMonthly.get(symbol);
  if (hit && Date.now() - hit.at < MONTHLY_TTL) return hit.data;
  const file = path.join(HIST_DIR, `${safeName(symbol)}-1mo.json`);
  if (!hit) {
    try {
      const disk = JSON.parse(await fs.readFile(file, "utf8"));
      memMonthly.set(symbol, disk);
      if (Date.now() - disk.at < MONTHLY_TTL) return disk.data;
    } catch { /* no disk cache yet */ }
  }
  try {
    const j = await yjson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1mo`);
    const c = parseChart(j);
    if (!c) throw new Error(`no monthly data for ${symbol}`);
    const byDate = new Map();
    for (const [ts, close] of c.bars) byDate.set(dateStr(ts, c.gmtoffset), close);
    const data = { currency: c.currency, closes: [...byDate.entries()] };
    const entry = { at: Date.now(), data };
    memMonthly.set(symbol, entry);
    await fs.writeFile(file, JSON.stringify(entry)).catch(() => {});
    return data;
  } catch (e) {
    const stale = memMonthly.get(symbol);
    if (stale) return stale.data; // stale-if-error
    throw e;
  }
}

// One month of half-hourly bars, feeding the 1-week and 1-month views.
// 30 min rather than 1 h: hourly left the 1-week curve with about 36 points across five
// sessions, too few to read a shape. Measured on one symbol, 30 min yields 274 points
// over the month and 66 over the week for 26 KB instead of 15. A 15 min interval would
// double that again for 49 KB, which is not worth it — the series is fetched for every
// recently active holding on a cold load.
// The file name carries the interval so a change of granularity cannot be served a
// stale cache written under the previous one.
const memHourly = new Map();
export async function hourlyHistory(symbol) {
  const hit = memHourly.get(symbol);
  if (hit && Date.now() - hit.at < DAILY_TTL) return hit.data;
  const file = path.join(HIST_DIR, `${safeName(symbol)}-30m.json`);
  if (!hit) {
    try {
      const disk = JSON.parse(await fs.readFile(file, "utf8"));
      memHourly.set(symbol, disk);
      if (Date.now() - disk.at < DAILY_TTL) return disk.data;
    } catch { /* no disk cache yet */ }
  }
  try {
    const j = await yjson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=30m&includePrePost=false`);
    const c = parseChart(j);
    if (!c) throw new Error(`no intraday data for ${symbol}`);
    const data = {
      currency: c.currency,
      points: c.bars.map(([ts, close]) => [ts * 1000, close]), // ms timestamps
    };
    const entry = { at: Date.now(), data };
    memHourly.set(symbol, entry);
    await fs.writeFile(file, JSON.stringify(entry)).catch(() => {});
    return data;
  } catch (e) {
    const stale = memHourly.get(symbol);
    if (stale) return stale.data;
    throw e;
  }
}

// ---- FX (EUR per unit of foreign currency is 1/rate: Yahoo EURUSD=X = USD per EUR)
export async function getFx(currency) {
  if (currency === "EUR") return null;
  const symbol = `EUR${currency}=X`;
  const [daily, intra, hourly] = await Promise.all([
    dailyHistory(symbol).catch(() => null),
    intradayHistory(symbol).catch(() => null),
    hourlyHistory(symbol).catch(() => null),
  ]);
  return { currency, daily, intra, hourly };
}
