/**
 * SBA Laufkalkulation – Live-Abruf (Netlify Scheduled Function)
 * =============================================================
 * Läuft jede Minute (Zeitplan in netlify.toml). Ablauf pro Aufruf:
 *
 *   1. Renntag-Check: Ist heute ein Weltcup-Termin (Kalender unten)?
 *      Nein -> sofort Schluss. (Mit FORCE=1 lässt sich der Check übergehen.)
 *   2. Live-Quelle finden: LIVE_URL aus den Umgebungsvariablen, sonst
 *      Best-Effort-Suche über die FIS-Live-Übersichtsseite.
 *   3. Daten abrufen und parsen (siehe parseLive – wird am ersten Renntag
 *      gegen die echte Seite verifiziert; bis dahin loggt der Dienst im
 *      DRY_RUN, was er sieht).
 *   4. Zeiten in die Firebase Realtime Database der App schreiben – als
 *      "automatisches Command Center". Der Dienst meldet sich dazu mit dem
 *      normalen Command-Center-Konto an (Firebase Auth, E-Mail/Passwort).
 *
 * WICHTIG – Sicherheitsnetz:
 *   - Der Dienst fasst NUR Events an, die er selbst angelegt hat
 *     (gekennzeichnet mit auto:true). Manuell angelegte Events werden nie
 *     verändert – das Command Center kann also immer manuell übernehmen.
 *   - DRY_RUN=1: alles wie gewohnt, aber ohne Schreiben (nur Logs).
 *
 * Umgebungsvariablen (Netlify -> Site settings -> Environment variables):
 *   CC_PASSWORD   Passwort des Command-Center-Kontos  (PFLICHT, geheim!)
 *   CC_EMAIL      Standard: command-center@sba.app
 *   FB_API_KEY    Standard: API-Key aus der App (index.html)
 *   FB_DB_URL     Standard: Datenbank-URL aus der App (index.html)
 *   LIVE_URL      Direkte URL der FIS-Live-Daten, sobald bekannt (optional)
 *   DRY_RUN       "1" = nichts schreiben, nur loggen (für die Verifikation)
 *   FORCE         "1" = auch ausserhalb von Renntagen laufen (zum Testen)
 */

// ---------------------------------------------------------------------------
// Firebase-Zugang (Standardwerte = Konfiguration der App; Passwort ist Pflicht)
// ---------------------------------------------------------------------------
const FB = {
  apiKey: process.env.FB_API_KEY || "AIzaSyBXZYpxJZgblLr_aBGTo7czWe_IE-giSr4",
  dbUrl: (process.env.FB_DB_URL || "https://sba-laufkalkulation-default-rtdb.europe-west1.firebasedatabase.app").replace(/\/$/, ""),
  email: process.env.CC_EMAIL || "command-center@sba.app",
  password: process.env.CC_PASSWORD || "",
};

// Code-Stand, sichtbar im Testlauf-Journal (Ergänzung Michael/Claude)
const VERSION = "2026-10-24 feed-v4";

// FIS-Weltcup-Kalender Snowboard Alpin 2026/27 (Parallel-Disziplinen)
// Einträge mit test:true sind Generalproben: laufen ohne FORCE/LIVE_URL,
// schreiben NIE in die App (immer Trockenlauf) und führen ein Journal, das
// über /.netlify/functions/testlog lesbar ist (Ergänzung Michael/Claude).
const KALENDER = [
  { ort: "Generalprobe Sölden (Ski Alpin)", disziplin: "TEST", start: "2026-10-24", end: "2026-10-25", test: true,
    liveUrls: ["https://live.fis-ski.com/lv-al5001.htm", "https://live.fis-ski.com/lv-al0001.htm"] },
  { ort: "Snow Ruyi (TBC)",   disziplin: "PGS", start: "2026-11-28", end: "2026-11-29" },
  { ort: "Mylin",             disziplin: "PGS", start: "2026-12-05", end: "2026-12-06" },
  { ort: "Cortina d'Ampezzo", disziplin: "PGS", start: "2026-12-12", end: "2026-12-12" },
  { ort: "Carezza",           disziplin: "PGS", start: "2026-12-17", end: "2026-12-17" },
  { ort: "Davos",             disziplin: "PSL", start: "2026-12-19", end: "2026-12-19" },
  { ort: "Scuol",             disziplin: "PGS", start: "2027-01-09", end: "2027-01-09" },
  { ort: "Bansko",            disziplin: "PGS", start: "2027-01-16", end: "2027-01-17" },
  { ort: "Rogla",             disziplin: "PGS", start: "2027-01-23", end: "2027-01-23" },
  { ort: "Bad Gastein",       disziplin: "PSL", start: "2027-01-26", end: "2027-01-27" },
  { ort: "Ratschings",        disziplin: "PSL", start: "2027-01-30", end: "2027-01-30" },
  { ort: "Krynica",           disziplin: "PGS", start: "2027-02-27", end: "2027-02-28" },
  { ort: "WM Montafon (PGS)",  disziplin: "PGS", start: "2027-03-07", end: "2027-03-07" },
  { ort: "WM Montafon (PSL)",  disziplin: "PSL", start: "2027-03-09", end: "2027-03-10" },
  { ort: "Winterberg",        disziplin: "PSL", start: "2027-03-20", end: "2027-03-21" },
];

// Live-Übersicht: Standard Snowboard. Für die Generalprobe (Ski Alpin) per
// Umgebungsvariable LIVE_INDEX umstellbar (Ergänzung Michael/Claude).
const LIVE_INDEX = process.env.LIVE_INDEX || "https://www.fis-ski.com/DB/snowboard/live.html";
const LIVE_HOST = "https://live.fis-ski.com";
const UA = { "User-Agent": "Mozilla/5.0 (sba-laufkalkulation live-abruf; read-only)" };

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------
function heute() {
  // Renntage sind in Europa – Datum in Europe/Zurich bestimmen
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" }); // YYYY-MM-DD
}
function aktuellesEvent() {
  const h = heute();
  return KALENDER.find(e => h >= e.start && h <= e.end) || null;
}
const norm = {
  kurs(v) { v = String(v || "").toLowerCase(); if (/(blau|blue|^b$)/.test(v)) return "blau"; if (/(rot|red|^r$)/.test(v)) return "rot"; return null; },
  gender(v) { v = String(v || "").toLowerCase(); if (/(women|frauen|damen|ladies|^w$|^f$)/.test(v)) return "frauen"; if (/(men|männer|maenner|herren|^m$)/.test(v)) return "maenner"; return null; },
  run(v) { v = String(v || "").toLowerCase().replace(/\s/g, ""); if (/(q1|run1|lauf1|^1$)/.test(v)) return "q1"; if (/(q2|run2|lauf2|^2$)/.test(v)) return "q2"; return null; },
  zeit(v) {
    const s = String(v).trim().replace(",", ".");
    const m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
    const sec = m ? parseInt(m[1], 10) * 60 + parseFloat(m[2]) : parseFloat(s);
    return isFinite(sec) && sec > 5 && sec < 600 ? Math.round(sec * 100) / 100 : null;
  },
};

// ---------------------------------------------------------------------------
// Schritt 2: Live-Quelle finden
// ---------------------------------------------------------------------------
// LIVE_URL darf eine kommagetrennte Liste sein (z.B. Damen- und Herren-Rennen);
// geloggt werden alle, verwendet wird die erste Quelle mit Zielzeiten.
async function findeLiveUrls() {
  if (process.env.LIVE_URL) return process.env.LIVE_URL.split(",").map(x => x.trim()).filter(Boolean);
  const res = await fetch(LIVE_INDEX, { headers: UA });
  if (!res.ok) throw new Error("Live-Übersicht: HTTP " + res.status);
  const html = await res.text();
  const links = [...new Set(html.match(/https?:\/\/live\.fis-ski\.com\/[^\s"'<>]+/g) || [])];
  console.log("Gefundene Live-Links:", links);
  // Nur Renn-Seiten (lv-<codex>.htm), nicht die Startseite
  return links.filter(l => /\/lv-[a-z]{2}\d+\.htm/i.test(l));
}

// ---------------------------------------------------------------------------
// FIS-Live-Datenfeed (Ergänzung Michael/Claude, 20.10.2026)
// ---------------------------------------------------------------------------
// Die Seite live.fis-ski.com/lv-<codex>.htm ist nur eine leere Hülle. Ihre
// Daten lädt sie per JavaScript von einem Datenserver:
//   <server>/<codex>/main.xml      (z.B. https://sys7.novius.net/al5409/main.xml)
// Serverliste: live.fis-ski.com/general/serverListFull.xml. Format: ein
// PHP-serialisiertes Array, eingepackt in <lt>…</lt>. Aufbau (verifiziert am
// 20.10.2026 mit al5409, Riesenslalom Cerro Catedral vom 13.9.2026):
//   racers[]                       = [racerId, NAME, Vorname, Nation, ...]
//   startlist[0][0][lauf][pos]     = [racerId, Startnr., Status, Zusatz]
//   result[0][lauf][pos][messpunkt]= Zeit in ms; "123450:c" = kumuliert
//   racedef[0][lauf][messpunkt]    = [Typ ("finish", "inter" ...), Nr.]
// Offen bis zum ersten Snowboard-Rennen: wo die Kurszuteilung (Blau/Rot)
// steht. Vermutung: Zusatzfeld der Startliste oder racedef -> wird geloggt.
function codexAusUrl(url) {
  const m = String(url).match(/lv-([a-z]{2}\d{3,5})\.htm/i);
  return m ? m[1].toLowerCase() : null;
}

// Arbeitet auf Bytes und ist tolerant (Ergänzung Michael/Claude, 24.10.2026):
// Die FIS liefert teils doppelt kodierte Texte, deren Längenangabe nicht mehr
// stimmt (Sölden 24.10.: s:7:"SÃÂ¶lden" = 9 Bytes). Stimmt die Länge nicht,
// wird das nächstgelegene String-Ende ('";' + gültiges Folgezeichen) gesucht.
// Texte: UTF-8 (doppelte Kodierung wird rückgängig gemacht), sonst Latin-1.
function phpUnserialize(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  const utf8ok = b => Buffer.from(b.toString("utf8"), "utf8").equals(b);
  const str = (a, b) => {
    const roh = buf.subarray(a, b);
    if (!utf8ok(roh)) return roh.toString("latin1");
    let u = roh.toString("utf8");
    for (let k = 0; k < 2 && /[\u00c2\u00c3]/.test(u) && /^[\u0000-\u00ff]*$/.test(u); k++) {
      const zurueck = Buffer.from(u, "latin1");
      if (!utf8ok(zurueck)) break;
      u = zurueck.toString("utf8");
    }
    return u;
  };
  const istToken = p => {
    const c = buf[p];
    if (c === 0x7d) return true;                                   // '}'
    return c !== undefined && "siabdN".includes(String.fromCharCode(c)) && (buf[p + 1] === 0x3a || buf[p + 1] === 0x3b);
  };
  const istEnde = p => buf[p] === 0x22 && buf[p + 1] === 0x3b && (p + 2 >= buf.length || istToken(p + 2));
  let i = 0;
  const bis = ch => {
    const j = buf.indexOf(ch, i);
    if (j < 0) throw new Error("PHP-Format: '" + ch + "' fehlt ab Position " + i);
    const v = buf.toString("latin1", i, j); i = j + 1; return v;
  };
  function lies() {
    const t = String.fromCharCode(buf[i]); i += 2;
    if (t === "N") return null;
    if (t === "b") return bis(";") === "1";
    if (t === "i" || t === "d") return Number(bis(";"));
    if (t === "s") {
      const n = Number(bis(":")); i += 1;           // Länge in Bytes, dann '"'
      const a = i;
      let e = a + n;
      if (!istEnde(e)) {                            // Länge stimmt nicht -> nächstes gültiges Ende
        let best = -1;
        for (let d = 1; d <= 64 && best < 0; d++) {
          if (istEnde(a + n + d)) best = a + n + d;
          else if (a + n - d >= a && istEnde(a + n - d)) best = a + n - d;
        }
        if (best < 0) throw new Error("PHP-Format: String-Ende nicht gefunden ab Position " + a);
        e = best;
      }
      const v = str(a, e); i = e + 2; return v;
    }
    if (t === "a") {
      const n = Number(bis(":")); i += 1;           // '{'
      const o = {};
      for (let k = 0; k < n; k++) { const key = lies(); o[key] = lies(); }
      i += 1;                                       // '}'
      return o;
    }
    throw new Error("PHP-Format: unbekannter Typ '" + t + "' an Position " + (i - 2));
  }
  return lies();
}

async function ladeFeed(liveUrl) {
  const codex = codexAusUrl(liveUrl);
  if (!codex) return { liveUrl, codex: null, data: null };
  const hosts = [];
  try {
    const t = await (await fetch(LIVE_HOST + "/general/serverListFull.xml?t=" + Date.now(), { headers: UA })).text();
    for (const m of t.matchAll(/s:\d+:"(https?:\/\/[^"]+)"/g)) hosts.push(m[1].replace(/\/$/, ""));
  } catch (e) { console.log("Serverliste nicht lesbar:", e.message); }
  hosts.push(LIVE_HOST);
  for (const h of hosts) {
    const url = `${h}/${codex}/main.xml?t=${Date.now()}`;
    const res = await fetch(url, { headers: UA }).catch(() => null);
    if (!res || !res.ok) continue;
    const roh = Buffer.from(await res.arrayBuffer());
    const text = roh.toString("latin1").trim();      // verlustfrei, für das Journal
    if (!text.startsWith("<lt>")) continue;
    const a = roh.indexOf("<lt>") + 4, b = roh.lastIndexOf("</lt>");
    try {
      return { liveUrl, codex, url, text, data: phpUnserialize(roh.subarray(a, b > a ? b : roh.length)) };
    } catch (err) {
      return { liveUrl, codex, url, text, data: null, fehler: err.message };  // Rohdaten trotzdem ins Journal
    }
  }
  return { liveUrl, codex, data: null };
}

/** Feed -> Einträge { name, zeit, gender, run, kurs, bib }. kurs kann null sein. */
function decodeFeed(d) {
  const racers = new Map();
  for (const r of Object.values(d.racers || {})) if (r) racers.set(r[0], r);
  const info = d.raceinfodetail || {};
  const gender = norm.gender(info.gender) || norm.gender((d.raceinfo || {})[4]);
  const startlist = ((d.startlist || {})[0] || {})[0] || {};
  const result = (d.result || {})[0] || {};
  const racedef = (d.racedef || {})[0] || {};
  const lauf1 = new Map();   // racerId -> ms (für kumulierte Zeiten im 2. Lauf)
  const out = [];
  for (const lauf of Object.keys(startlist).map(Number).sort((a, b) => a - b)) {
    const run = ["q1", "q2"][lauf];
    if (!run) continue;
    const defs = Object.values(racedef[lauf] || {});
    let ziel = defs.findIndex(x => x && x[0] === "finish");
    if (ziel < 0) ziel = defs.length - 1;
    for (const [pos, s] of Object.entries(startlist[lauf] || {})) {
      if (!s) continue;
      const messung = ((result[lauf] || {})[pos] || {})[ziel];
      if (messung == null) continue;                 // noch nicht im Ziel
      if (/^(dq|dnf|dns|dsq)$/i.test(String(s[2]))) continue;
      const [msRoh, flag] = String(messung).split(":");
      let ms = Number(msRoh);
      if (!isFinite(ms)) continue;
      // Kumulierte Zeit -> Laufzeit. Markiert mit ":c" (Bariloche) ODER
      // unmarkiert, aber offensichtlich Gesamtzeit (Sölden 24.10.: 2. Lauf
      // 135650 = 2:15.65 bei 67270 im 1. Lauf). Regel: > 1.5 x Lauf 1.
      const kumuliert = flag === "c" || (lauf > 0 && lauf1.has(s[0]) && ms > 1.5 * lauf1.get(s[0]));
      if (kumuliert) {
        if (!lauf1.has(s[0])) continue;
        ms -= lauf1.get(s[0]);
      }
      if (lauf === 0) lauf1.set(s[0], ms);
      const r = racers.get(s[0]);
      const zeit = norm.zeit(ms / 1000);
      if (!r || !zeit) continue;
      out.push({ name: String(r[1]).trim().toUpperCase(), zeit, gender, run, kurs: norm.kurs(s[3]), bib: s[1] });
    }
  }
  return out;
}

/** Kompakter Diagnose-Log des Feeds (für die Schärfung am ersten Rennen). */
function logFeed(feed) {
  const d = feed.data;
  const j = (v, n) => JSON.stringify(v === undefined ? null : v).slice(0, n || 400);
  console.log(`Feed ${feed.codex} (${feed.url}):`, j(d.raceinfodetail || d.raceinfo, 300));
  console.log("  Felder:", Object.keys(d).join(", "));
  console.log("  racedef:", j(d.racedef), "| runinfo:", j(d.runinfo, 300));
  const sl = ((d.startlist || {})[0] || {})[0] || {};
  for (const lauf of Object.keys(sl)) {
    const reihe = Object.values(sl[lauf] || {});
    console.log(`  Startliste Lauf ${Number(lauf) + 1}: ${reihe.length} Einträge, Beispiele:`, j(reihe.slice(0, 4)));
    console.log(`  Resultat Lauf ${Number(lauf) + 1}, Beispiele:`, j(Object.values(((d.result || {})[0] || {})[lauf] || {}).slice(0, 4)));
  }
}

// ---------------------------------------------------------------------------
// Schritt 3: Parsen
// ---------------------------------------------------------------------------
// TODO (Verifikation am ersten Renntag): Die genaue Struktur der FIS-Live-
// Seite/-Daten ist erst am Live-Event sichtbar. Dieser Parser versucht der
// Reihe nach: (a) JSON direkt, (b) im HTML eingebettetes JSON, (c) nichts –
// dann loggt er einen Ausschnitt der Antwort, damit wir den Parser anhand
// der Logs fertigstellen können (DRY_RUN=1 lassen, Logs anschauen).
//
// Erwartetes Resultat: Liste von Einträgen
//   { name, zeit (Sek.), gender: 'frauen'|'maenner', run: 'q1'|'q2', kurs: 'blau'|'rot' }
function parseLive(text, contentType) {
  // (a) JSON direkt
  let data = null;
  if (/json/.test(contentType || "") || /^[\[{]/.test(text.trim())) {
    try { data = JSON.parse(text); } catch (e) { /* weiter */ }
  }
  // (b) im HTML eingebettetes JSON (häufig: window.__XXX__ = {...};)
  if (!data) {
    const m = text.match(/=\s*(\{[\s\S]{200,}?\});?\s*<\/script>/);
    if (m) { try { data = JSON.parse(m[1]); } catch (e) { /* weiter */ } }
  }
  if (!data) return null;

  // Generischer Versuch: alle Objekte mit Name + Zeit einsammeln.
  // Feldnamen decken die üblichen Varianten ab; wird am Live-Event geschärft.
  const out = [];
  (function walk(node, ctx) {
    if (Array.isArray(node)) { for (const x of node) walk(x, ctx); return; }
    if (!node || typeof node !== "object") return;
    const c = { ...ctx };
    for (const [k, v] of Object.entries(node)) {
      if (/^(gender|sex|category)$/i.test(k)) c.gender = norm.gender(v) || c.gender;
      if (/^(run|heat|lauf)$/i.test(k)) c.run = norm.run(v) || c.run;
      if (/^(course|kurs|lane)$/i.test(k)) c.kurs = norm.kurs(v) || c.kurs;
    }
    const name = node.name || node.athlete || node.lastname || node.familyname;
    const zeitRoh = node.time || node.runtime || node.result || node.zeit;
    if (name && zeitRoh != null) {
      const zeit = norm.zeit(zeitRoh);
      if (zeit && c.gender && c.run && c.kurs)
        out.push({ name: String(name).trim().toUpperCase(), zeit, gender: c.gender, run: c.run, kurs: c.kurs });
    }
    for (const v of Object.values(node)) walk(v, c);
  })(data, {});
  return out.length ? out : null;
}

// ---------------------------------------------------------------------------
// Schritt 4: Firebase (Anmeldung als Command Center, dann State-Update)
// ---------------------------------------------------------------------------
async function fbLogin() {
  const res = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + FB.apiKey,
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: FB.email, password: FB.password, returnSecureToken: true }) });
  if (!res.ok) throw new Error("Firebase-Login fehlgeschlagen (CC_PASSWORD prüfen): HTTP " + res.status);
  return (await res.json()).idToken;
}
async function fbGetState(token) {
  const res = await fetch(FB.dbUrl + "/state.json?auth=" + token, { headers: UA });
  if (!res.ok) throw new Error("Firebase lesen: HTTP " + res.status);
  return (await res.json()) || { v: 1, events: [], updatedAt: null };
}
async function fbPutState(token, state) {
  const res = await fetch(FB.dbUrl + "/state.json?auth=" + token,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) });
  if (!res.ok) throw new Error("Firebase schreiben: HTTP " + res.status);
}

/** Einträge in den App-State einarbeiten. Fasst nur das eigene Auto-Event an. */
function upsert(state, evMeta, entries) {
  const events = Array.isArray(state.events) ? state.events.filter(Boolean) : Object.values(state.events || {});
  const id = "auto-" + evMeta.start;
  let ev = events.find(e => e && e.id === id);
  if (!ev) {
    ev = { id, ort: evMeta.ort, disziplin: evMeta.disziplin, datum: heute(), auto: true,
           runs: [{ id: "q1", label: "Q1", frauen: { blau: [], rot: [] }, maenner: { blau: [], rot: [] } },
                  { id: "q2", label: "Q2", frauen: { blau: [], rot: [] }, maenner: { blau: [], rot: [] } }] };
    events.push(ev);
  }
  if (!ev.auto) return null; // Sicherheitsnetz: nie ein manuelles Event überschreiben

  for (const runId of ["q1", "q2"]) {
    const run = ev.runs.find(r => r.id === runId);
    for (const g of ["frauen", "maenner"]) {
      for (const k of ["blau", "rot"]) {
        const zeiten = entries
          .filter(e => e.run === runId && e.gender === g && e.kurs === k)
          .sort((a, b) => a.zeit - b.zeit)
          .slice(0, 8) // wie im Excel: max. Top 8
          .map(e => ({ name: e.name, zeit: e.zeit }));
        if (zeiten.length) run[g][k] = zeiten; // nie mit leer überschreiben
      }
    }
  }
  return { v: 1, events, updatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Testlauf-Journal (Netlify Blobs, Store "testlauf") – nur bei test:true
// ---------------------------------------------------------------------------
async function oeffneJournal(event) {
  try {
    const blobs = require("@netlify/blobs");
    if (event && event.blobs) blobs.connectLambda(event);
    const store = blobs.getStore("testlauf");
    const status = (await store.get("status", { type: "json" })) || { version: VERSION, laeufe: {}, log: [] };
    return {
      status,
      log(msg) {
        status.log.push({ t: new Date().toISOString(), msg: String(msg).slice(0, 500) });
        if (status.log.length > 300) status.log = status.log.slice(-300);
      },
      async speichern(feeds) {
        status.version = VERSION;
        status.aktualisiert = new Date().toISOString();
        for (const f of feeds) {
          await store.set("feed-" + f.codex + "-letzter", f.text);
          const l = status.laeufe[f.codex];
          if (l && l.neuesMaximum) { await store.set("feed-" + f.codex + "-max", f.text); delete l.neuesMaximum; }
        }
        await store.setJSON("status", status);
      },
    };
  } catch (e) {
    console.log("Journal nicht verfügbar:", e.message);
    return null;
  }
}

function journalFeed(j, feed, e) {
  if (!j) return;
  const d = feed.data || {};
  const l = j.status.laeufe[feed.codex] || (j.status.laeufe[feed.codex] = {
    erstmals: new Date().toISOString(), aufrufe: 0, maxZeiten: 0 });
  l.aufrufe++;
  l.zuletzt = new Date().toISOString();
  l.quelle = feed.url;
  if (!feed.data) { l.letzterStand = "keine Daten"; return; }
  l.rennen = d.raceinfodetail || d.raceinfo;
  l.felder = Object.keys(d);
  l.racedef = d.racedef;
  const sl = ((d.startlist || {})[0] || {})[0] || {};
  l.startlisten = Object.fromEntries(Object.entries(sl).map(([k, v]) => [Number(k) + 1, Object.values(v || {}).length]));
  l.beispielStartliste = Object.values(sl[0] || {}).slice(0, 3);
  l.zeitenProLauf = { q1: e.filter(x => x.run === "q1").length, q2: e.filter(x => x.run === "q2").length };
  l.mitKurs = e.filter(x => x.kurs).length;
  l.letzterStand = `${e.length} Zielzeiten`;
  if (e.length > l.maxZeiten) { l.maxZeiten = e.length; l.maxZeitpunkt = l.zuletzt; l.neuesMaximum = true; l.beispiele = e.slice(0, 8); }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
exports.VERSION = VERSION;
exports._test = { phpUnserialize, decodeFeed };   // für Tests
exports.handler = async (event) => {
  let journal = null;
  const feeds = [];
  const ok = async (msg, code) => {
    console.log(msg);
    if (journal) { journal.log(msg); try { await journal.speichern(feeds); } catch (e) { console.log("Journal speichern:", e.message); } }
    return { statusCode: code || 200, body: msg };
  };
  try {
    const evMeta = aktuellesEvent();
    if (!evMeta && process.env.FORCE !== "1") {
      // Bis zur letzten Generalprobe: Herzschlag ins Journal, damit vorab
      // prüfbar ist, dass Zeitplan und Speicher laufen (testlog zeigt ihn).
      const letzteProbe = KALENDER.filter(k => k.test).map(k => k.end).sort().pop();
      if (letzteProbe && heute() <= letzteProbe) {
        try {
          const blobs = require("@netlify/blobs");
          if (event && event.blobs) blobs.connectLambda(event);
          await blobs.getStore("testlauf").setJSON("herzschlag", { zeit: new Date().toISOString(), version: VERSION });
        } catch (e) { console.log("Herzschlag nicht gespeichert:", e.message); }
      }
      return ok("Kein Renntag – nichts zu tun.");
    }
    const meta = evMeta || { ort: "TEST", disziplin: "PGS", start: heute(), end: heute() };
    console.log("Renntag:", meta.ort, meta.disziplin, "| Version", VERSION);
    if (meta.test) journal = await oeffneJournal(event);

    const liveUrls = meta.test && !process.env.LIVE_URL ? meta.liveUrls : await findeLiveUrls();
    if (!liveUrls.length) return ok("Keine Live-Quelle gefunden (noch kein Rennen live?).");
    console.log("Live-Quellen:", liveUrls);

    // 1. Weg: Datenfeed (<server>/<codex>/main.xml) – alle Quellen loggen,
    //    die erste mit Zielzeiten verwenden.
    let alle = null;
    const zusammenfassung = [];
    for (const liveUrl of liveUrls) {
      let feed;
      try { feed = await ladeFeed(liveUrl); }
      catch (err) { feed = { liveUrl, codex: codexAusUrl(liveUrl), data: null }; console.log("Feed-Fehler:", err.message); if (journal) journal.log(`Feed-Fehler ${feed.codex}: ${err.message}`); }
      if (!feed.data) {
        const grund = feed.fehler ? "Decoder-Fehler: " + feed.fehler : "keine Daten";
        console.log(`Feed ${feed.codex || liveUrl}: ${grund}`);
        journalFeed(journal, feed, []);
        if (feed.text) { feeds.push(feed); if (journal) journal.status.laeufe[feed.codex].letzterStand = grund; }
        zusammenfassung.push(`${feed.codex}: ${grund}`); continue;
      }
      logFeed(feed);
      let e = [];
      try { e = decodeFeed(feed.data); }
      catch (err) { console.log("Decoder-Fehler:", err.message); if (journal) journal.log(`Decoder-Fehler ${feed.codex}: ${err.message}`); }
      console.log(`  Dekodiert: ${e.length} Zielzeiten, davon ${e.filter(x => x.kurs).length} mit Kurs.`, JSON.stringify(e.slice(0, 6)));
      journalFeed(journal, feed, e); feeds.push(feed);
      zusammenfassung.push(`${feed.codex}: ${e.length} Zeiten`);
      if (!alle && e.length) alle = e;
    }
    if (meta.test) return ok("Generalprobe (Trockenlauf): " + zusammenfassung.join(" | "));

    // 2. Weg (Rückfall): bisheriger generischer Parser auf der Seite selbst
    if (!alle) {
      const res = await fetch(liveUrls[0], { headers: UA });
      if (res.ok) {
        const text = await res.text();
        alle = parseLive(text, res.headers.get("content-type"));
        if (!alle) console.log("Seite ohne erkennbare Daten. Ausschnitt:", text.slice(0, 800));
      }
    }
    if (!alle) return ok("Noch keine Zielzeiten.");
    const entries = alle.filter(e => e.kurs && e.gender && e.run);
    if (!entries.length) return ok(`${alle.length} Zeiten gelesen, aber ohne Kurszuteilung – nichts zu schreiben.`);
    console.log(`Verwendbar: ${entries.length} Zeiten.`, JSON.stringify(entries.slice(0, 6)));

    if (process.env.DRY_RUN === "1") return ok("DRY_RUN – nichts geschrieben.");
    if (!FB.password) return ok("CC_PASSWORD fehlt – nichts geschrieben.");

    const token = await fbLogin();
    const state = await fbGetState(token);
    const neu = upsert(state, meta, entries);
    if (!neu) return ok("Event ist manuell verwaltet – nicht angefasst.");
    await fbPutState(token, neu);
    return ok(`Firebase aktualisiert (${entries.length} Zeiten, Event ${meta.ort}).`);
  } catch (err) {
    console.error(err);
    return ok("Fehler: " + String(err.message || err), 500);
  }
};

// Selbsttest des Feed-Decoders mit echtem FIS-Feed (Ergänzung Michael/Claude):
//   node functions/poller.js --selftest-feed
if (process.argv.includes("--selftest-feed")) {
  const fs = require("fs"), path = require("path");
  const roh = fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "novius-al5409-main.xml"), "utf8").trim();
  const d = phpUnserialize(roh.replace(/^<lt>/, "").replace(/<\/lt>$/, ""));
  logFeed({ codex: "al5409", url: "fixture", data: d });
  const e = decodeFeed(d);
  const pruef = (txt, ok) => { console.log((ok ? "OK   " : "FEHL ") + txt); if (!ok) process.exitCode = 1; };
  const st1 = e.find(x => x.name === "STOESSEL" && x.run === "q1");
  const st2 = e.find(x => x.name === "STOESSEL" && x.run === "q2");
  pruef("Lauf 1: 24 Zielzeiten", e.filter(x => x.run === "q1").length === 24);
  pruef("Lauf 2: 20 Zielzeiten", e.filter(x => x.run === "q2").length === 20);
  pruef("STOESSEL Lauf 1 = 51.88", st1 && st1.zeit === 51.88);
  pruef("STOESSEL Lauf 2 = 50.59 (102.47 kumuliert - 51.88)", st2 && st2.zeit === 50.59);
  pruef("Geschlecht = frauen", e.every(x => x.gender === "frauen"));
  pruef("DNF/DQ ausgelassen (RICAU)", !e.some(x => x.name === "RICAU"));
  // Variante wie Sölden 24.10.: Gesamtzeit im 2. Lauf ohne ":c"-Markierung
  const d2 = phpUnserialize(roh.replace(/^<lt>/, "").replace(/<\/lt>$/, "").replace(/s:8:"(\d+):c";/g, (m, z) => "i:" + z + ";"));
  const st2b = decodeFeed(d2).find(x => x.name === "STOESSEL" && x.run === "q2");
  pruef("Unmarkierte Gesamtzeit: STOESSEL Lauf 2 = 50.59", st2b && st2b.zeit === 50.59);
}

// Lokaler Selbsttest der Zuordnungslogik: node functions/poller.js --selftest
if (process.argv.includes("--selftest")) {
  const entries = [
    { name: "ZOGG", zeit: 36.75, gender: "frauen", run: "q1", kurs: "blau" },
    { name: "MIKI", zeit: 36.78, gender: "frauen", run: "q1", kurs: "rot" },
    { name: "CAVIEZEL", zeit: 34.20, gender: "maenner", run: "q2", kurs: "rot" },
  ];
  const state = upsert({ v: 1, events: [{ id: "manuell-1", ort: "Scuol", runs: [] }] },
    { ort: "Cortina d'Ampezzo", disziplin: "PGS", start: "2026-12-12" }, entries);
  console.log(JSON.stringify(state, null, 2));
  console.log("Manuelles Event unangetastet:", state.events[0].id === "manuell-1" && !state.events[0].auto ? "JA" : "NEIN");
}
