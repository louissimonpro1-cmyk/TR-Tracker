// Live access to the Trade Republic activity history stored in the user's Google Sheet.
// The sheet is link-shared, so its CSV export URL is readable without authentication.
// The sheet is configured via the SHEET_URL environment variable (full sharing link
// or bare spreadsheet ID) so that each deployment points to its own history.
import fs from "node:fs/promises";
import { parseCSV } from "./csv.mjs";

const TTL_MS = 2 * 60 * 1000;

// SHEET_URL is normally a Google Sheet sharing link; a local .csv path is also
// accepted, which is handy for trying the dashboard out before publishing a sheet.
const isLocalCsv = (raw) => /\.csv$/i.test(raw) && !/^https?:/i.test(raw);

let exportUrl = null;
function resolveSource() {
  const raw = (process.env.SHEET_URL || process.env.SHEET_ID || "").trim();
  if (!raw) {
    throw new Error("Variable SHEET_URL manquante : renseignez le lien de partage de votre Google Sheet (partagé en « Tous les utilisateurs disposant du lien »).");
  }
  if (isLocalCsv(raw)) return { file: raw };
  if (exportUrl) return { url: exportUrl };
  const m = raw.match(/[-\w]{25,}/); // the spreadsheet ID inside a URL, or the bare ID
  if (!m) {
    throw new Error("SHEET_URL invalide : collez le lien complet du Google Sheet, son identifiant, ou le chemin d'un fichier .csv local.");
  }
  exportUrl = `https://docs.google.com/spreadsheets/d/${m[0]}/export?format=csv`;
  return { url: exportUrl };
}

let cache = null; // { at, txs }

const num = (s) => (s === undefined || s === "" ? 0 : parseFloat(s));

export async function getTransactions() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.txs;
  try {
    const src = resolveSource();
    let text;
    if (src.file) {
      text = await fs.readFile(src.file, "utf8");
    } else {
      const res = await fetch(src.url, { redirect: "follow" });
      if (!res.ok) throw new Error(`Google Sheet: HTTP ${res.status}`);
      text = await res.text();
    }
    const rows = parseCSV(text);
    const header = rows[0];
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const txs = rows.slice(1)
      .filter((r) => r.length > 5 && r[idx.datetime])
      .map((r) => ({
        datetime: r[idx.datetime],
        date: r[idx.date],
        account: r[idx.account_type] || "DEFAULT",
        category: r[idx.category],
        type: r[idx.type],
        assetClass: r[idx.asset_class],
        name: r[idx.name],
        isin: r[idx.symbol],
        shares: num(r[idx.shares]),
        price: num(r[idx.price]),
        amount: num(r[idx.amount]),
        fee: num(r[idx.fee]),
        tax: num(r[idx.tax]),
      }))
      .sort((a, b) => a.datetime.localeCompare(b.datetime));
    cache = { at: Date.now(), txs };
    return txs;
  } catch (e) {
    if (cache) return cache.txs; // serve stale data if the sheet is unreachable
    throw e;
  }
}
