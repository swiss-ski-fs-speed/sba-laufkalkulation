/**
 * Nutzungsstatistik der Coach-Ansicht (Ergänzung Michael/Claude, 17.11.2026)
 * =========================================================================
 * POST  (aus der App, per navigator.sendBeacon, nur Coach-Geräte):
 *   { v:1, dev:"<zufällige Geräte-ID>", mob:true|false, evs:[ {t, ts, ...} ] }
 *   -> abgelegt in Netlify Blobs (Store "nutzung"), Schlüssel "<JJJJ-MM-TT>/<zeit>-<zufall>".
 *   Gespeichert wird nur, was die App schickt (keine IP-Adressen, keine Namen).
 * GET   ?von=JJJJ-MM-TT&bis=JJJJ-MM-TT  (nur Command Center):
 *   Header "Authorization: Bearer <Firebase-ID-Token>"; der Token wird bei
 *   Google geprüft und muss zum Command-Center-Konto gehören.
 *   -> { events: [ {dev, mob, rt, t, ts, ...}, ... ] }  (Auswertung macht die App)
 */
const { getStore, connectLambda } = require("@netlify/blobs");

const API_KEY = process.env.FB_API_KEY || "AIzaSyBXZYpxJZgblLr_aBGTo7czWe_IE-giSr4";
const CC_EMAIL = process.env.CC_EMAIL || "command-center@sba.app";
const ORIGINS = ["https://swiss-ski-fs-speed.github.io"];
const TYPEN = new Set(["open", "view", "card", "click", "err"]);

function cors(origin) {
  const ok = ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "");
  return {
    "Access-Control-Allow-Origin": ok ? origin : ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
const tag = ms => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
const kurz = (v, n) => (v == null ? undefined : String(v).slice(0, n));

/** Ein eingehendes Ereignis säubern (nur bekannte Felder, Längen begrenzt). */
function saeubern(e) {
  if (!e || !TYPEN.has(e.t)) return null;
  const ms = Number(e.ms);
  return {
    t: e.t,
    ts: Number(e.ts) || undefined,
    ev: kurz(e.ev, 60), g: kurz(e.g, 12), card: kurz(e.card, 24), what: kurz(e.what, 40),
    msg: kurz(e.msg, 160),
    ms: isFinite(ms) && ms > 0 ? Math.min(Math.round(ms), 30 * 60 * 1000) : undefined,
  };
}

async function istCommandCenter(auth) {
  const token = String(auth || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const res = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + API_KEY,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token }) });
  if (!res.ok) return false;
  const u = ((await res.json()).users || [])[0];
  return !!u && String(u.email).toLowerCase() === CC_EMAIL;
}

exports.handler = async (event) => {
  const h = cors((event.headers || {}).origin || (event.headers || {}).Origin);
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: h, body: "" };
  try {
    if (event.blobs) connectLambda(event);
    const store = getStore("nutzung");

    if (event.httpMethod === "POST") {
      const roh = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
      if (roh.length > 30000) return { statusCode: 413, headers: h, body: "" };
      const d = JSON.parse(roh);
      const dev = kurz(d.dev, 40);
      const evs = (Array.isArray(d.evs) ? d.evs : []).slice(0, 300).map(saeubern).filter(Boolean);
      if (!dev || !/^[a-z0-9-]{8,40}$/i.test(dev) || !evs.length) return { statusCode: 204, headers: h, body: "" };
      const jetzt = Date.now();
      const key = tag(jetzt) + "/" + jetzt + "-" + Math.random().toString(36).slice(2, 8);
      await store.setJSON(key, { dev, mob: !!d.mob, rt: jetzt, evs });
      return { statusCode: 204, headers: h, body: "" };
    }

    if (event.httpMethod === "GET") {
      if (!(await istCommandCenter((event.headers || {}).authorization || (event.headers || {}).Authorization)))
        return { statusCode: 401, headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ fehler: "nur Command Center" }) };
      const q = event.queryStringParameters || {};
      const re = /^\d{4}-\d{2}-\d{2}$/;
      const bis = re.test(q.bis || "") ? q.bis : tag(Date.now());
      let von = re.test(q.von || "") ? q.von : bis;
      const tage = [];
      for (let d = new Date(von + "T12:00:00Z"); tage.length < 200; d = new Date(d.getTime() + 86400000)) {
        const s = d.toISOString().slice(0, 10);
        if (s > bis) break;
        tage.push(s);
      }
      const keys = [];
      for (const t of tage) {
        const { blobs } = await store.list({ prefix: t + "/" });
        keys.push(...blobs.map(b => b.key));
      }
      const events = [];
      for (let i = 0; i < keys.length; i += 40) {
        const teil = await Promise.all(keys.slice(i, i + 40).map(k => store.get(k, { type: "json" }).catch(() => null)));
        for (const b of teil) if (b) for (const e of b.evs || []) events.push({ dev: b.dev, mob: b.mob, rt: b.rt, ...e });
      }
      return { statusCode: 200, headers: { ...h, "content-type": "application/json", "cache-control": "no-store" },
               body: JSON.stringify({ von, bis, events }) };
    }
    return { statusCode: 405, headers: h, body: "" };
  } catch (err) {
    return { statusCode: 500, headers: h, body: String(err.message || err) };
  }
};
