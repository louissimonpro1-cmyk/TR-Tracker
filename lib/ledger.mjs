// Position engine: replays the full transaction history chronologically and produces
// per-asset state (holdings, average cost, realized P&L), cash balances per account,
// the share-count timeline of every asset and the daily EUR flows in/out of positions.
//
// Conventions found in the Trade Republic export:
//  - SELL rows carry NEGATIVE share counts; BUY rows positive.
//  - `amount` is the gross cash movement; `fee` and `tax` are separate signed columns,
//    so the net cash effect of any row is amount + fee + tax.
//  - DELIVERY (FREE_RECEIPT / MIGRATION) rows come in cancelling +/- pairs; the extra
//    ones that do not cancel are genuine free shares (staking rewards, promotions).
//  - CORPORATE_ACTION rows (SPLIT, STOCK_DIVIDEND, BONUS_ISSUE, ...) adjust share
//    counts at zero cost, which the weighted-average-cost method absorbs naturally.
//  - `account_type` separates the accounts (DEFAULT = ordinary securities account,
//    PEA = French tax-advantaged account, ...). Crypto lives inside the DEFAULT
//    account but is told apart by `asset_class = CRYPTO`.

export const CTO = "CTO";
export const CRYPTO = "CRYPTO";

// Fractional residues that should count as "fully sold". Shares can leave dust from
// fractional orders; crypto is divisible to 8+ decimals, where 0.04 can be hundreds
// of euros, so it gets a far tighter threshold.
export const RESIDUAL_SHARES = 0.04;
export const RESIDUAL_CRYPTO = 1e-6;

// Which section an asset belongs to. Any account_type other than DEFAULT becomes its
// own bucket, so an account this code has never seen still shows up on its own.
export function bucketOf(tx) {
  if (tx.assetClass === "CRYPTO") return CRYPTO;
  if (tx.account && tx.account !== "DEFAULT") return tx.account;
  return CTO;
}
// Cash pocket: crypto is bought with the securities account's cash, so it has none.
export const cashBucketOf = (tx) => (tx.account && tx.account !== "DEFAULT" ? tx.account : CTO);

// Cash movement classification (regex-based so unseen variants still land correctly).
const isDeposit = (type) => /INBOUND|INPAYMENT/.test(type);
const isWithdrawal = (type) => /OUTBOUND|OUTPAYMENT/.test(type);
const isInternalTransfer = (type) => type === "TRANSFER_IN" || type === "TRANSFER_OUT";
const isBonus = (type) => /PERK|MARKETING|REFERRAL|BONUS|REWARD/.test(type);

export function buildLedger(txs) {
  const totals = {
    cash: 0, deposits: 0, withdrawals: 0,
    interestNet: 0, dividendsNet: 0, bonuses: 0, fees: 0, taxes: 0,
  };
  const cashByAccount = new Map();     // bucket -> EUR
  const assets = new Map();            // `${bucket}|${symbol}` -> asset state
  const flowsByAccount = new Map();    // bucket -> Map<date, EUR> moved into (+)/out of (-) positions
  const firstDateByAccount = new Map(); // bucket -> date of the account's first ever activity

  const getAsset = (t) => {
    const bucket = bucketOf(t);
    const key = `${bucket}|${t.isin}`; // sheet.mjs exposes the symbol column as `isin`
    if (!assets.has(key)) assets.set(key, {
      key, bucket, isin: t.isin, name: t.name, assetClass: t.assetClass,
      isCrypto: t.assetClass === "CRYPTO",
      shares: 0, costBasis: 0,
      buyQty: 0, buyValue: 0, sellQty: 0, sellValue: 0,
      // dated lots: quantities traded before a split must be restated per current
      // share before any average price is compared with another
      buyLots: [], sellLots: [],
      realized: 0,
      lastSellPrice: null, lastSellDate: null,
      lastBuyPrice: null, lastBuyDate: null,
      lastOpDate: null, firstDate: t.date,
      timeline: [],   // [{date, shares}] cumulative share count after each trading day
      priceMarks: [], // [{date, price}] every EUR price observed in the history
      corpRaw: [],    // corporate-action share changes, to derive split/bonus ratios
    });
    return assets.get(key);
  };

  const addFlow = (bucket, date, eur) => {
    if (!flowsByAccount.has(bucket)) flowsByAccount.set(bucket, new Map());
    const m = flowsByAccount.get(bucket);
    m.set(date, (m.get(date) || 0) + eur);
  };
  const pushTimeline = (a, date) => {
    const last = a.timeline[a.timeline.length - 1];
    if (last && last.date === date) last.shares = a.shares;
    else a.timeline.push({ date, shares: a.shares });
  };

  for (const t of txs) {
    const net = t.amount + t.fee + t.tax;
    totals.cash += net;
    const pocket = cashBucketOf(t);
    cashByAccount.set(pocket, (cashByAccount.get(pocket) || 0) + net);
    totals.fees += t.fee;
    totals.taxes += t.tax;

    // the section a tx belongs to for filtering/display purposes; txs are chronological
    // so the first one seen for a bucket is that account's true start of activity,
    // including a pure cash deposit or perk that predates its first trade
    const displayBucket = bucketOf(t);
    if (!firstDateByAccount.has(displayBucket)) firstDateByAccount.set(displayBucket, t.date);

    if (t.category === "CASH" && !isInternalTransfer(t.type)) {
      // internal PEA <-> securities transfers cancel out and must not count as funding
      if (isDeposit(t.type)) totals.deposits += t.amount;
      else if (isWithdrawal(t.type)) totals.withdrawals += -t.amount;
      else if (isBonus(t.type)) totals.bonuses += t.amount;
    }
    if (t.type === "INTEREST_PAYMENT") totals.interestNet += t.amount + t.tax;
    if (t.type === "DIVIDEND") {
      totals.dividendsNet += t.amount + t.tax;
      // a cash dividend is value leaving the positions (the price drops on ex-date):
      // counting it as an outflow keeps the TWR from reading it as a market loss
      addFlow(displayBucket, t.date, -t.amount);
    }

    if (!t.isin) continue;
    const a = getAsset(t);
    if (t.price > 0) a.priceMarks.push({ date: t.date, price: t.price });

    if (t.category === "TRADING" && t.type === "BUY") {
      a.shares += t.shares;
      a.costBasis += t.shares * t.price;
      a.buyQty += t.shares;
      a.buyValue += t.shares * t.price;
      a.buyLots.push({ date: t.date, qty: t.shares });
      a.lastBuyPrice = t.price;
      a.lastBuyDate = t.date;
      a.lastOpDate = t.date;
      addFlow(a.bucket, t.date, t.shares * t.price);
      pushTimeline(a, t.date);
    } else if (t.category === "TRADING" && t.type === "SELL") {
      const qty = Math.abs(t.shares);
      const avg = a.shares > 1e-12 ? a.costBasis / a.shares : t.price;
      a.realized += qty * (t.price - avg);
      a.costBasis -= qty * avg;
      a.shares -= qty;
      a.sellQty += qty;
      a.sellValue += qty * t.price;
      a.sellLots.push({ date: t.date, qty });
      a.lastSellPrice = t.price;
      a.lastSellDate = t.date;
      a.lastOpDate = t.date;
      addFlow(a.bucket, t.date, -qty * t.price);
      pushTimeline(a, t.date);
    } else if (t.category === "DELIVERY" || t.category === "CORPORATE_ACTION") {
      if (t.category === "CORPORATE_ACTION") a.corpRaw.push({ date: t.date, delta: t.shares, sharesBefore: a.shares });
      a.shares += t.shares; // signed; zero-cost share changes shift the average price
      a.lastOpDate = t.date;
      pushTimeline(a, t.date);
    }
  }

  for (const a of assets.values()) {
    // keep at most one price mark per date (the last one) so interpolation is clean
    const byDate = new Map();
    for (const m of a.priceMarks) byDate.set(m.date, m.price);
    a.priceMarks = [...byDate.entries()].map(([date, price]) => ({ date, price }));
    a.isOpen = Math.abs(a.shares) > (a.isCrypto ? RESIDUAL_CRYPTO : RESIDUAL_SHARES);

    // net share ratio of corporate actions per date (split 10:1 -> 10, bonus 1:10 -> 1.1).
    // Yahoo back-adjusts its price series for these events; the valuation engine uses
    // these ratios to reconstruct the actual (unadjusted) historical prices.
    const adjByDate = new Map();
    for (const ev of a.corpRaw) {
      if (!adjByDate.has(ev.date)) adjByDate.set(ev.date, { before: ev.sharesBefore, after: 0 });
      adjByDate.get(ev.date).after = ev.sharesBefore + ev.delta;
    }
    a.adjEvents = [...adjByDate.entries()]
      .map(([date, { before, after }]) => ({ date, ratio: before > 1e-9 ? after / before : 1 }))
      .filter((e) => Math.abs(e.ratio - 1) > 1e-6);
    delete a.corpRaw;
  }

  return {
    totals, assets, cashByAccount, flowsByAccount, firstDateByAccount,
    firstDate: txs[0]?.date ?? null,
  };
}

// Sums the per-account flow maps for a set of selected buckets into one flat
// Map<date, EUR>, as perfSeries()/perfSeriesHourly() expect. `bucketIds` null/undefined
// merges every account (the unfiltered "all accounts" view).
export function mergeFlows(flowsByAccount, bucketIds) {
  const out = new Map();
  for (const [bucket, byDate] of flowsByAccount) {
    if (bucketIds && !bucketIds.has(bucket)) continue;
    for (const [date, eur] of byDate) out.set(date, (out.get(date) || 0) + eur);
  }
  return out;
}
