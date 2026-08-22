import { guard, sendJson, readJsonBody } from "../lib/http.mjs";
import { handleAlerts } from "../lib/alerts-http.mjs";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  try {
    await handleAlerts(req, res, readJsonBody);
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message });
  }
}
