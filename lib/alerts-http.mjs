// Shared request handling for /api/alerts, so server.mjs and api/alerts.js expose
// exactly the same contract. Plain Node req/res, like lib/auth.mjs does for login.
import { getStatus, saveConfig, addSubscription, removeSubscription } from "./alerts-service.mjs";

const send = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
};

// push endpoints are opaque URLs chosen by the browser vendor, not by us: accept any
// https URL but keep it bounded so nothing silly ends up in the store
const validEndpoint = (v) => typeof v === "string" && v.length <= 800 && /^https:\/\//.test(v);

export async function handleAlerts(req, res, readBody) {
  if (req.method === "GET") return send(res, 200, await getStatus());
  if (req.method !== "POST") return send(res, 405, { error: "méthode non supportée" });

  const body = await readBody(req).catch(() => null);
  if (!body || typeof body !== "object") return send(res, 400, { error: "corps de requête invalide" });

  switch (body.action) {
    case "save":
      await saveConfig(body.config);
      return send(res, 200, await getStatus());
    case "subscribe": {
      const endpoint = body.subscription?.endpoint;
      if (!validEndpoint(endpoint)) return send(res, 400, { error: "abonnement push invalide" });
      if (body.config) await saveConfig(body.config);
      await addSubscription(endpoint, String(req.headers["user-agent"] || ""));
      return send(res, 200, await getStatus());
    }
    case "unsubscribe": {
      const endpoint = body.endpoint;
      if (!validEndpoint(endpoint)) return send(res, 400, { error: "abonnement push invalide" });
      await removeSubscription(endpoint);
      return send(res, 200, await getStatus());
    }
    default:
      return send(res, 400, { error: "action inconnue" });
  }
}
