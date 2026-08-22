// Small helpers shared by the Vercel functions (plain Node req/res API).
import { AUTH_ENABLED, isAuthedCookie } from "./auth.mjs";

export function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

// returns true when the request may proceed; otherwise responds 401 itself
export function guard(req, res) {
  if (!AUTH_ENABLED || isAuthedCookie(req.headers.cookie)) return true;
  sendJson(res, 401, { error: "non authentifié" });
  return false;
}

export const readJsonBody = (req) => new Promise((resolve, reject) => {
  if (req.body !== undefined) return resolve(req.body); // Vercel pre-parses JSON bodies
  let data = "";
  req.on("data", (c) => { data += c; if (data.length > 4096) reject(new Error("body trop long")); });
  req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  req.on("error", reject);
});

// Shared /api/perf query parsing, given a plain `get(name)` accessor so both the
// local server (URLSearchParams) and the Vercel functions (req.query) can use it.
export function parsePerfParams(get) {
  const range = get("range") || "max";
  const accountsRaw = get("accounts") || "";
  // account ids come from our own bucket labels (PEA/CTO/CRYPTO or a raw account_type
  // value from the sheet) - keep the character set generous but bounded
  const accounts = accountsRaw
    ? accountsRaw.split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{1,32}$/.test(s))
    : null;
  const from = get("from") || undefined;
  const to = get("to") || undefined;
  return { range, opts: { accounts, from, to } };
}
