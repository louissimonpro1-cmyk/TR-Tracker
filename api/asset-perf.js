import { getAssetSeries } from "../lib/service.mjs";
import { guard, sendJson } from "../lib/http.mjs";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const key = String(req.query?.key || "");
  if (!/^[A-Z0-9_]{1,20}\|[A-Za-z0-9.\-]{1,20}$/.test(key)) return sendJson(res, 400, { error: "clé invalide" });
  try {
    sendJson(res, 200, await getAssetSeries(key));
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message });
  }
}
