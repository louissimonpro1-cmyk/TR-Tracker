// Orchestration between the alert rules, the store and the push sender.
// Used by /api/alerts (settings + current state) and /api/cron/check-alerts (the
// scheduled check), so both the local server and the Vercel functions share it.
import { getDashboard } from "./service.mjs";
import { evaluate, normalizeConfig, DEFAULT_CONFIG, hasAnyThreshold, localParts } from "./alerts.mjs";
import { readState, updateState, KIND, DURABLE } from "./store.mjs";
import { PUSH_CONFIGURED, publicKey, sendPush } from "./push.mjs";

const MAX_DEVICES = 10;
const configOf = (state) => (state.config ? normalizeConfig(state.config) : { ...DEFAULT_CONFIG });

// Everything the settings dialog and the service worker need in one payload.
export async function getStatus() {
  const state = await readState();
  const config = configOf(state);
  let triggers = [];
  if (config.enabled && hasAnyThreshold(config)) {
    // a quote outage must not take the settings dialog down with it
    try { triggers = evaluate(await getDashboard(), config); } catch { /* prices unavailable */ }
  }
  return {
    config,
    triggers,
    push: {
      configured: PUSH_CONFIGURED,
      durable: DURABLE,          // false => the cron cannot see what we store, push is off
      store: KIND,
      publicKey: PUSH_CONFIGURED ? publicKey() : null,
      devices: state.subscriptions.length,
    },
  };
}

export async function saveConfig(raw) {
  const config = normalizeConfig(raw);
  // changing the thresholds re-arms everything: the new rules have never fired yet
  await updateState((s) => ({ ...s, config, fired: {} }));
  return config;
}

export async function addSubscription(endpoint, userAgent = "") {
  await updateState((s) => {
    const others = s.subscriptions.filter((x) => x.endpoint !== endpoint);
    return { ...s, subscriptions: [...others, { endpoint, ua: userAgent.slice(0, 120), at: new Date().toISOString() }].slice(-MAX_DEVICES) };
  });
}

export async function removeSubscription(endpoint) {
  await updateState((s) => ({ ...s, subscriptions: s.subscriptions.filter((x) => x.endpoint !== endpoint) }));
}

// The scheduled check. Called once per hour by the cron entries in vercel.json; it is
// this function, not the schedule, that decides whether the user's chosen hour has
// come — that is how an hourly choice survives the Hobby "one run per day per cron
// expression" limit, and how it stays correct across timezones and DST.
//
// Idempotent by design (Vercel warns crons may be missed or delivered twice):
//  - `lastRun` holds the local date already handled, so a repeat within the day is a no-op
//  - only thresholds that were NOT already breached at the previous run are pushed, so a
//    position sitting at +25 % for a month notifies once, not thirty times
export async function runCheck(now = new Date()) {
  const state = await readState();
  const config = configOf(state);
  if (!config.enabled) return { ran: false, reason: "alertes désactivées" };
  if (!hasAnyThreshold(config)) return { ran: false, reason: "aucun seuil renseigné" };

  const { date, hour } = localParts(config.tz, now);
  // `>=` rather than `===`: if the scheduled invocation was dropped, a later one the
  // same day still catches up instead of silently skipping the day
  if (hour < config.hour) return { ran: false, reason: `avant l'heure choisie (${hour} h < ${config.hour} h, ${config.tz})` };
  if (state.lastRun === date) return { ran: false, reason: "déjà vérifié aujourd'hui" };

  const triggers = evaluate(await getDashboard(), config);
  const fresh = triggers.filter((t) => !state.fired?.[t.id]);
  const fired = Object.fromEntries(triggers.map((t) => [t.id, date]));

  let sent = 0;
  const gone = [];
  if (fresh.length) {
    for (const sub of state.subscriptions) {
      const r = await sendPush(sub.endpoint);
      if (r.ok) sent++;
      else if (r.gone) gone.push(sub.endpoint);
    }
  }
  await updateState((s) => ({
    ...s,
    fired,
    lastRun: date,
    subscriptions: s.subscriptions.filter((x) => !gone.includes(x.endpoint)),
  }));
  return { ran: true, date, hour, triggers: triggers.length, fresh: fresh.length, sent, dropped: gone.length };
}
