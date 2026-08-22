// Live access to the Trade Republic activity history, configured via the SHEET_URL
// environment variable so each deployment points to its own history. Three shapes
// are accepted, all read live and never stored:
//  - a Google Sheet sharing link (docs.google.com/spreadsheets/...) or bare ID
//  - a raw .csv file kept in Google Drive (drive.google.com/file/d/... or /open?id=...)
//  - a local .csv file path (handy for trying the dashboard before publishing anything)
// Both Google flavors need "Anyone with the link" sharing.
import fs from "node:fs/promises";
import { parseCSV } from "./csv.mjs";

const TTL_MS = 2 * 60 * 1000;

const isLocalCsv = (raw) => /\.csv$/i.test(raw) && !/^https?:/i.test(raw);
const isDriveFile = (raw) => /drive\.google\.com/i.test(raw);

let resolved = null; // { url } | { file } — memoised once parsed
function resolveSource() {
  if (resolved) return resolved;
  const raw = (process.env.SHEET_URL || process.env.SHEET_ID || "").trim();
  if (!raw) {
    throw new Error("Variable SHEET_URL manquante : renseignez le lien de partage de votre Google Sheet ou d'un fichier .csv Google Drive (partagé en « Tous les utilisateurs disposant du lien »).");
  }
  if (isLocalCsv(raw)) return (resolved = { file: raw });
  const m = raw.match(/[-\w]{25,}/); // the spreadsheet/file ID inside a URL, or the bare ID
  if (!m) {
    throw new Error("SHEET_URL invalide : collez le lien complet du Google Sheet ou du fichier Drive, leur identifiant, ou le chemin d'un fichier .csv local.");
  }
  const url = isDriveFile(raw)
    ? `https://drive.google.com/uc?export=download&id=${m[0]}`
    : `https://docs.google.com/spreadsheets/d/${m[0]}/export?format=csv`;
  return (resolved = { url });
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
      // a mis-shared or too-large Drive file serves an HTML interstitial instead of
      // the CSV (virus-scan warning, permission page); catch it early with a clear hint
      if (/^\s*<(!doctype|html)/i.test(text)) {
        throw new Error("Le lien SHEET_URL renvoie une page web au lieu d'un CSV : vérifiez que le fichier/sheet est bien partagé en « Tous les utilisateurs disposant du lien ».");
      }
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
