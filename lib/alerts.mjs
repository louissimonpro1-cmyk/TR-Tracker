// Price alert rules: which position field is compared against which user threshold.
// Evaluated here for the cron and /api/alerts, and mirrored in public/app.js so the
// in-app modal works with zero server round-trip — keep ALERT_RULES there in sync.
//
// Thresholds are stored as positive magnitudes: `buyDown: 10` means "notify when the
// price falls 10 % or more below the last buy", so nobody has to type a minus sign.

// `field` names come straight from the dashboard payload built in service.mjs.
export const RULES = [
  { id: "pruUp", field: "perfPct", dir: 1, ref: "avgBuy", label: "au-dessus du PRU" },
  { id: "pruDown", field: "perfPct", dir: -1, ref: "avgBuy", label: "sous le PRU" },
  { id: "buyUp", field: "vsLastBuyPct", dir: 1, ref: "lastBuyPrice", label: "au-dessus du dernier achat" },
  { id: "buyDown", field: "vsLastBuyPct", dir: -1, ref: "lastBuyPrice", label: "sous le dernier achat" },
  { id: "sellUp", field: "vsLastSellPct", dir: 1, ref: "lastSellPrice", label: "au-dessus de la dernière vente" },
  { id: "sellDown", field: "vsLastSellPct", dir: -1, ref: "lastSellPrice", label: "sous la dernière vente" },
];
export const RULE_IDS = RULES.map((r) => r.id);

export const DEFAULT_CONFIG = {
  enabled: false,
  hour: 9,                 // local hour of the daily check (0-23)
  tz: "Europe/Paris",
  thresholds: Object.fromEntries(RULE_IDS.map((id) => [id, null])),
};

const validTz = (tz) => {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
};

// Accepts anything (browser payload, stored JSON) and returns a config that is safe
// to act on: unknown keys dropped, magnitudes clamped, nulls meaning "rule disabled".
export function normalizeConfig(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const hour = Number(src.hour);
  const thresholds = {};
  for (const id of RULE_IDS) {
    const v = Number(src.thresholds?.[id]);
    // 0 would fire permanently on almost every position — treat it as "not set"
    thresholds[id] = Number.isFinite(v) && Math.abs(v) > 0 ? Math.min(Math.abs(v), 10000) : null;
  }
  return {
    enabled: !!src.enabled,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_CONFIG.hour,
    tz: typeof src.tz === "string" && validTz(src.tz) ? src.tz : DEFAULT_CONFIG.tz,
    thresholds,
  };
}

export const hasAnyThreshold = (config) => RULE_IDS.some((id) => config.thresholds?.[id] != null);

// Local wall-clock parts in the user's own timezone, so the daily check fires at the
// hour they picked wherever they live and whatever DST is doing.
export function localParts(tz, now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

// Every open position breaching at least one enabled threshold, one entry per
// (position, rule) pair so the modal can say exactly which situation fired.
export function evaluate(dashboard, config) {
  const triggers = [];
  if (!config?.enabled) return triggers;
  for (const account of dashboard.accounts || []) {
    for (const p of account.positions || []) {
      for (const rule of RULES) {
        const threshold = config.thresholds?.[rule.id];
        if (threshold == null) continue;
        const actual = p[rule.field];
        if (actual == null) continue;                       // never bought/sold, or no quote
        if (rule.dir > 0 ? actual < threshold : actual > -threshold) continue;
        triggers.push({
          id: `${p.key}|${rule.id}`,
          key: p.key, isin: p.isin, name: p.name,
          account: account.id, accountLabel: account.label,
          rule: rule.id, label: rule.label,
          threshold: rule.dir > 0 ? threshold : -threshold,
          actualPct: actual,
          priceEur: p.priceEur,
          refPrice: p[rule.ref] ?? null,
        });
      }
    }
  }
  // strongest moves first: that is what the notification body shows
  return triggers.sort((a, b) => Math.abs(b.actualPct) - Math.abs(a.actualPct));
}
