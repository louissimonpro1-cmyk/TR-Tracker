// Tiny persistent store for the alert settings, push subscriptions and "already
// notified" state — the only things in this app that must outlive a request, since
// the cron has to reach them without a browser. Under 2 kB in practice.
//
// Three backends, auto-detected, no npm dependency:
//  - Upstash Redis REST (KV_REST_API_* injected by the Vercel Marketplace integration,
//    or UPSTASH_REDIS_REST_* when configured by hand) — the only durable one on Vercel
//  - a local JSON file, for `npm start` on your own machine
//  - memory, so everything still runs without any store: the in-app modal works,
//    only the push part is turned off (see DURABLE)
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KEY = "tr-dashboard:alerts:v1";
const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const ON_VERCEL = !!process.env.VERCEL;

const FILE = ON_VERCEL
  ? path.join(os.tmpdir(), "tr-dashboard-cache", "alerts.json")
  : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cache", "alerts.json");

export const KIND = REST_URL && REST_TOKEN ? "upstash" : ON_VERCEL ? "memory" : "file";
// On Vercel without a KV store every instance has its own /tmp and is recycled at
// will: state written there would be invisible to the cron, so we call it what it is.
export const DURABLE = KIND !== "memory";

const EMPTY = { config: null, subscriptions: [], fired: {}, lastRun: null };
let memo = null; // last known value, also the whole store when KIND === "memory"

async function upstash(pathname, init) {
  const res = await fetch(`${REST_URL}/${pathname}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${REST_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Upstash: HTTP ${res.status}`);
  return res.json();
}

export async function readState() {
  if (KIND === "memory") return memo ? structuredClone(memo) : structuredClone(EMPTY);
  try {
    let raw;
    if (KIND === "upstash") {
      raw = (await upstash(`get/${encodeURIComponent(KEY)}`)).result;
    } else {
      raw = await fs.readFile(FILE, "utf8");
    }
    const parsed = raw ? JSON.parse(raw) : null;
    memo = parsed && typeof parsed === "object" ? { ...EMPTY, ...parsed } : structuredClone(EMPTY);
  } catch {
    // nothing stored yet, or the store is briefly unreachable: fall back to the last
    // value we saw rather than silently wiping the user's settings
    if (!memo) memo = structuredClone(EMPTY);
  }
  return structuredClone(memo);
}

export async function writeState(state) {
  memo = structuredClone(state);
  if (KIND === "memory") return;
  const body = JSON.stringify(state);
  if (KIND === "upstash") {
    await upstash(`set/${encodeURIComponent(KEY)}`, { method: "POST", body });
    return;
  }
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, body);
}

// read-modify-write helper; the cron is the only writer that races with itself and
// its update is idempotent, so a plain read/write pair is enough here
export async function updateState(fn) {
  const next = await fn(await readState());
  await writeState(next);
  return next;
}
