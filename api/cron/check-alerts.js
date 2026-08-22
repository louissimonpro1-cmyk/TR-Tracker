// Scheduled alert check. vercel.json points one cron entry per hour at this route;
// runCheck() itself decides whether the user's chosen local hour has come, which is
// how an hourly choice fits inside the Hobby "one run per day per expression" limit.
import { runCheck } from "../../lib/alerts-service.mjs";
import { sendJson } from "../../lib/http.mjs";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Locally this route is just a manual trigger; on a public deployment an open
    // endpoint would let anyone spin up the Yahoo fetches, so we say so out loud
    // rather than failing silently later.
    if (process.env.VERCEL) {
      return sendJson(res, 401, { error: "CRON_SECRET absent : ajoutez-le dans les variables d'environnement Vercel pour activer la vérification programmée." });
    }
  } else if (req.headers.authorization !== `Bearer ${secret}`) {
    // Vercel sends `Authorization: Bearer $CRON_SECRET` on every cron invocation.
    return sendJson(res, 401, { error: "non autorisé" });
  }
  try {
    sendJson(res, 200, await runCheck());
  } catch (e) {
    console.error("[cron] check-alerts:", e.message);
    sendJson(res, 500, { error: e.message });
  }
}
