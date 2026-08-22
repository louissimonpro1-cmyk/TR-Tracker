import { getPerf, PERF_RANGES } from "../lib/service.mjs";
import { guard, sendJson, parsePerfParams } from "../lib/http.mjs";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { range, opts } = parsePerfParams((name) => req.query?.[name]);
  if (!PERF_RANGES.includes(range)) return sendJson(res, 400, { error: "range invalide" });
  try {
    sendJson(res, 200, await getPerf(range, opts));
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message });
  }
}
