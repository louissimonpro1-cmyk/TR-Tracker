// Web Push sender, VAPID only, zero npm dependency (node:crypto does all of it).
//
// The pushes we send carry NO payload. That is deliberate: an encrypted payload would
// mean implementing RFC 8291 (ECDH + HKDF + aes128gcm) here, whereas a bare push is
// just a signed POST. public/sw.js reacts to it by fetching /api/alerts itself, with
// the session cookie, so the notification still shows the real positions and figures.
import crypto from "node:crypto";

const PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || "").trim();
const PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || "").trim();
const SUBJECT = (process.env.VAPID_SUBJECT || "").trim() || "mailto:dashboard@localhost";

export const PUSH_CONFIGURED = PUBLIC_KEY.length > 0 && PRIVATE_KEY.length > 0;
export const publicKey = () => PUBLIC_KEY;

const b64u = (buf) => Buffer.from(buf).toString("base64url");

// The browser hands us the public key as the 65-byte uncompressed P-256 point
// (0x04 || x || y); JWK wants x and y separately.
function signingKey() {
  const pub = Buffer.from(PUBLIC_KEY, "base64url");
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("VAPID_PUBLIC_KEY invalide (attendu : point P-256 non compressé de 65 octets en base64url)");
  }
  return crypto.createPrivateKey({
    format: "jwk",
    key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: PRIVATE_KEY },
  });
}

function vapidAuth(endpoint) {
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64u(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600, // spec caps this at 24 h
    sub: SUBJECT,
  }));
  const data = `${header}.${payload}`;
  // JWT wants the raw r||s pair, not the DER wrapper node:crypto emits by default
  const sig = crypto.sign("sha256", Buffer.from(data), { key: signingKey(), dsaEncoding: "ieee-p1363" });
  return `vapid t=${data}.${b64u(sig)}, k=${PUBLIC_KEY}`;
}

// Resolves to { ok, status, gone } — `gone` means the browser dropped this
// subscription for good and the caller should stop storing it.
export async function sendPush(endpoint, ttlSeconds = 12 * 3600) {
  if (!PUSH_CONFIGURED) return { ok: false, status: 0, gone: false, error: "VAPID non configuré" };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuth(endpoint),
        TTL: String(ttlSeconds),
        "Content-Length": "0",
      },
    });
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: e.message };
  }
}

// One-off key generation, used by `npm run vapid`.
export function generateVapidKeys() {
  const { publicKey: pub, privateKey: priv } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = priv.export({ format: "jwk" });
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  void pub;
  return { publicKey: point.toString("base64url"), privateKey: jwk.d };
}
