/**
 * SBA Laufkalkulation – PDF-Abruf (Netlify Scheduled Function, alle 5 Min.)
 * =========================================================================
 * Zweite, robuste Datenquelle neben dem Live-Abruf (poller.js). Neu aufgebaut
 * am 25.10.2026 (Ergänzung Michael/Claude) nach Prüfung an echten FIS-Daten:
 *
 *   1. Renntag-Check (Kalender in lib/kalender.js; FORCE=1 übergeht ihn).
 *   2. FIS-Event-Seite lesen -> Quali-Rennen des Tages (raceid, Codex).
 *   3. Resultat-Seite jedes Quali-Rennens -> PDF-Links nach Beschriftung
 *      ("Start List - Qualification Run 1", "Results - Qualification Run 2" ...).
 *      Die früher geratenen Adressen data.fis-ski.com/pdf/... gibt es so nicht.
 *   4. PDFs lesen (lib/fis-pdf.js): Startlisten -> Kurs pro Startnummer,
 *      Resultate Lauf 1 (zweispaltig Blau/Rot), Lauf 2 (Gesamttabelle).
 *   5. In die App schreiben – nur eigene Auto-Events, nur bei Änderungen.
 *
 * Testlauf ohne Netlify-Einstellungen: Kalendereintrag mit pdfTest (unten)
 * liest an den angegebenen Tagen ein Rennen der letzten Saison, schreibt nie
 * in die App und legt das Ergebnis im Journal ab (testlog -> "pdfTest").
 */

const { RENNTAGE } = require("../lib/kalender.js");
const fp = require("../lib/fis-pdf.js");

const FB = {
  apiKey: process.env.FB_API_KEY || "AIzaSyBXZYpxJZgblLr_aBGTo7czWe_IE-giSr4",
  dbUrl: (process.env.FB_DB_URL || "https://sba-laufkalkulation-default-rtdb.europe-west1.firebasedatabase.app").replace(/\/$/, ""),
  email: process.env.CC_EMAIL || "command-center@sba.app",
  password: process.env.CC_PASSWORD || "",
};
const SEASON = "2027"; // FIS-Saisoncode 2026/27
const PDF_VERSION = "2026-10-25 pdf-v3";   // neue Version -> PDF-Test läuft erneut
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 sba-laufkalkulation (read-only)" };

const KALENDER = [
  // PDF-Testlauf mit echten Daten: Cortina 13.12.2025 (Event 57890, Saison 2026)
  { ort: "PDF-Test Cortina 2025", disziplin: "TEST", start: "2026-10-25", end: "2026-10-28", test: true,
    pdfTest: { eventid: "57890", season: "2026", datum: "2025-12-13" } },
  ...RENNTAGE.map(r => ({ ...r, start: r.datum, end: r.datum })),
];

function heute() { return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" }); }
function aktuellesEvent() { const h = heute(); return KALENDER.find(e => h >= e.start && h <= e.end) || null; }

async function holeText(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} bei ${url}`);
  return res.text();
}
async function holePdfText(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`PDF HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.slice(0, 5).toString() !== "%PDF-") throw new Error("kein PDF");
  const pdfParse = require("pdf-parse");   // erst hier laden (Tests ohne Abhängigkeit)
  // Eigene Seitenausgabe (25.10.2026): Textstücke nach Zeilen gruppieren
  // (y-Toleranz 3 pt), innerhalb der Zeile nach x sortieren, Leerzeichen nur
  // bei sichtbarem Abstand. Der Standard von pdf-parse klebt Stücke zusammen
  // ("1227538766MARCH") und verteilt Spalten je nach PDF auf eigene Zeilen.
  const pagerender = page => page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then(tc => {
      const zeilen = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const y = it.transform[5], x = it.transform[4];
        let z = zeilen.find(r => Math.abs(r.y - y) < 3);
        if (!z) { z = { y, teile: [] }; zeilen.push(z); }
        z.teile.push({ x, w: it.width || 0, s: it.str });
      }
      zeilen.sort((a, b) => b.y - a.y);
      return zeilen.map(z => {
        z.teile.sort((a, b) => a.x - b.x);
        let t = "", ende = null;
        for (const i of z.teile) { t += (ende === null ? "" : (i.x - ende > 1.5 ? " " : "")) + i.s; ende = i.x + i.w; }
        return t.replace(/\s+/g, " ").trim();
      }).join("\n");
    });
  return (await pdfParse(buf, { pagerender })).text;
}

/** Alle Quali-Daten eines Tages aus den FIS-PDFs. Liefert { entries, protokoll }. */
async function lesePdfs(eventid, season, datum) {
  const protokoll = [];
  const html = await holeText(`https://www.fis-ski.com/DB/general/event-details.html?sectorcode=SB&eventid=${eventid}&seasoncode=${season}`);
  const tagMonat = new Date(datum + "T12:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  const alleRennen = fp.parseEventRennen(html).filter(r => r.quali);
  // Tagesfilter: Zeile enthält das Datum ("13 Dec"); bei Problemen alle Quali-Rennen
  const rennen = alleRennen.filter(r => html.split('class="table-row').some(c => c.includes("raceid=" + r.raceid) && c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").includes(tagMonat)));
  const quali = rennen.length ? rennen : alleRennen;
  protokoll.push(`Event ${eventid}: ${quali.length} Quali-Rennen (${quali.map(r => r.codex + "/" + (r.gender || "?")).join(", ")})`);
  const entries = [];
  const startlisten = {};   // Codex -> { q1: {bib: kurs}, q2: {...} } (für den Kurs-Abgleich des Live-Abrufs)
  for (const r of quali) {
    const seite = await holeText(`https://www.fis-ski.com/DB/general/results.html?sectorcode=SB&raceid=${r.raceid}`);
    const anh = fp.parseAnhaenge(seite);
    const finde = (art, run) => anh.find(a => a.art === art && a.run === run);
    const text = {};
    for (const a of anh) {
      try { text[a.art + a.run] = await holePdfText(a.url); }
      catch (e) { protokoll.push(`${r.codex} ${a.label}: ${e.message}`); }
    }
    const sl1 = text.startlisteq1 ? fp.parseStartlistePdf(text.startlisteq1) : {};
    const sl2 = text.startlisteq2 ? fp.parseStartlistePdf(text.startlisteq2) : {};
    const q1 = text.resultatq1 ? fp.parseResultatePdf(text.resultatq1, "q1", sl1) : [];
    const q2 = text.resultatq2 ? fp.parseResultate2Pdf(text.resultatq2, q1, sl2) : [];
    for (const e of [...q1, ...q2]) if (!e.gender) e.gender = r.gender;
    const z = (l, k) => l.filter(e => e.kurs === k).length;
    protokoll.push(`${r.codex} (${r.gender}): PDFs ${anh.map(a => a.art + "-" + a.run).join(" ")} | Startliste Q1 ${Object.keys(sl1).length}, Q2 ${Object.keys(sl2).length} | Q1 ${q1.length} Zeiten (blau ${z(q1, "blau")}/rot ${z(q1, "rot")}) | Q2 ${q2.length} (blau ${z(q2, "blau")}/rot ${z(q2, "rot")})`);
    if (!finde("resultat", "q1")) protokoll.push(`${r.codex}: noch keine Resultate Lauf 1`);
    entries.push(...q1, ...q2);
    startlisten[r.codex] = { q1: sl1, q2: sl2 };
  }
  return { entries, protokoll, startlisten };
}

async function fbLogin() {
  const res = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + FB.apiKey,
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
  if (!ev.auto) return null;
  for (const runId of ["q1", "q2"]) {
    const run = ev.runs.find(r => r.id === runId);
    for (const g of ["frauen", "maenner"]) {
      for (const k of ["blau", "rot"]) {
        const zeiten = entries
          .filter(e => e.run === runId && e.gender === g && e.kurs === k)
          .sort((a, b) => a.zeit - b.zeit).slice(0, 8)
          .map(e => ({ name: e.name, zeit: e.zeit }));
        if (zeiten.length) run[g][k] = zeiten;
      }
    }
  }
  return { v: 1, events, updatedAt: new Date().toISOString() };
}

// --- Handler ----------------------------------------------------------------
// Nur schreiben, wenn sich am eigenen Auto-Event etwas geändert hat
// (Ergänzung Michael/Claude, 25.10.2026): weniger Schreibvorgänge, kein
// unnötiges Überschreiben paralleler Command-Center-Änderungen.
function autoEvent(state, meta) {
  const events = Array.isArray(state && state.events) ? state.events : Object.values((state && state.events) || {});
  return events.find(e => e && e.id === "auto-" + meta.start) || null;
}
function anzahlZeiten(ev) {
  let n = 0;
  for (const r of (ev && ev.runs) || []) for (const g of ["frauen", "maenner"]) for (const k of ["blau", "rot"]) n += ((r[g] || {})[k] || []).length;
  return n;
}

exports.handler = async (event) => {
  const ok = (msg) => { console.log(msg); return { statusCode: 200, body: msg }; };
  try {
    const evMeta = aktuellesEvent();
    if (!evMeta && process.env.FORCE !== "1") return ok("Kein Renntag – nichts zu tun.");
    const meta = evMeta || { ort: "TEST", disziplin: "PGS", start: heute(), end: heute() };

    // --- PDF-Testlauf: einmal erfolgreich reicht, Ergebnis ins Journal ---
    if (meta.test && meta.pdfTest) {
      const blobs = require("@netlify/blobs");
      if (event && event.blobs) blobs.connectLambda(event);
      const store = blobs.getStore("testlauf");
      // Einmalige Anmeldeprüfung mit CC_PASSWORD (meldet sich nur an, schreibt nichts)
      if (!(await store.get("loginCheck", { type: "json" }))) {
        let lc;
        try { await fbLogin(); lc = { ok: true }; }
        catch (e) { lc = { ok: false, fehler: FB.password ? String(e.message || e) : "CC_PASSWORD nicht gesetzt" }; }
        await store.setJSON("loginCheck", { ...lc, zeit: new Date().toISOString() });
      }
      const bisher = await store.get("pdfTest", { type: "json" });
      if (bisher && bisher.erfolg && bisher.version === PDF_VERSION) return ok("PDF-Test bereits erfolgreich – nichts zu tun.");
      let res;
      try {
        const { eventid, season, datum } = meta.pdfTest;
        const r = await lesePdfs(eventid, season, datum);
        const bsp = k => r.entries.filter(e => e.run === k).slice(0, 4);
        // Erfolg = bei Frauen UND Männern Zeiten aus beiden Läufen, alle mit Kurs
        const hat = (g, k) => r.entries.some(e => e.gender === g && e.run === k && e.kurs);
        const erfolg = ["frauen", "maenner"].every(g => hat(g, "q1") && hat(g, "q2")) && r.entries.every(e => e.kurs);
        res = { version: PDF_VERSION, zeit: new Date().toISOString(), erfolg, zeiten: r.entries.length,
                mitKurs: r.entries.filter(e => e.kurs).length, protokoll: r.protokoll, beispieleQ1: bsp("q1"), beispieleQ2: bsp("q2") };
      } catch (e) {
        res = { zeit: new Date().toISOString(), erfolg: false, fehler: String(e.message || e) };
      }
      await store.setJSON("pdfTest", res);
      return ok("PDF-Test: " + JSON.stringify(res).slice(0, 400));
    }

    if (!meta.eventid) return ok("Keine FIS-Event-ID im Kalender.");
    const { entries, protokoll, startlisten } = await lesePdfs(meta.eventid, SEASON, meta.start);
    protokoll.forEach(z => console.log(z));
    // Beobachtung für die Auswertung (Snow Ruyi): letzter Stand ins Journal
    try {
      const blobs = require("@netlify/blobs");
      if (event && event.blobs) blobs.connectLambda(event);
      // Offizielle Kurszuteilung für den Kurs-Abgleich des Live-Abrufs ablegen
      for (const [codex, sl] of Object.entries(startlisten || {}))
        if (Object.keys(sl.q1).length || Object.keys(sl.q2).length)
          await blobs.getStore("testlauf").setJSON("startliste-" + codex, { zeit: new Date().toISOString(), ...sl });
      await blobs.getStore("testlauf").setJSON("pdfLauf-" + meta.start, { zeit: new Date().toISOString(), zeiten: entries.length,
        mitKurs: entries.filter(e => e.kurs).length, protokoll, beispiele: entries.slice(0, 6) });
    } catch (e) { console.log("Journal nicht verfügbar:", e.message); }
    const alle = entries.filter(e => e.kurs && e.gender);
    if (!alle.length) return ok("Noch keine verwertbaren PDF-Daten.");
    console.log(`Total verwertbar: ${alle.length} Zeiten.`, JSON.stringify(alle.slice(0, 6)));

    if (process.env.DRY_RUN === "1") return ok("DRY_RUN – nichts geschrieben.");
    if (!FB.password) return ok("CC_PASSWORD fehlt – nichts geschrieben.");
    const token = await fbLogin();
    const state = await fbGetState(token);
    const vorher = JSON.stringify(autoEvent(state, meta));
    const zeitenVorher = anzahlZeiten(autoEvent(state, meta));
    const neu = upsert(state, meta, alle);
    if (!neu) return ok("Event ist manuell verwaltet – nicht angefasst.");
    if (JSON.stringify(autoEvent(neu, meta)) === vorher) return ok("Keine neuen Zeiten – nichts geschrieben.");
    const zuwachs = anzahlZeiten(autoEvent(neu, meta)) - zeitenVorher;
    await fbPutState(token, neu);
    return ok(`Firebase aktualisiert (+${zuwachs} neue, total ${alle.length} Zeiten aus PDFs, Event ${meta.ort}).`);
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: String(err.message || err) };
  }
};

// Selbsttest mit echten Zeilen aus den FIS-PDFs Cortina 13.12.2025 (Männer-Quali):
//   node functions/pdf-poller.js --selftest-pdf
if (process.argv.includes("--selftest-pdf")) {
  const sl1 = "Men's Parallel Giant Slalom\nSTART LIST QUALIFICATION RUN\nBLUE COURSE\n" +
    "1 18 9320014 KIM Sangkyum KOR 1989 17 9510316 CAVIEZEL Dario SUI 1995\n" +
    "3 22 7538766 MARCH Aaron ITA 1986 21 9320091 LEE Sangho KOR 1995\n" +
    "8 32 9290107 CORATTI Edwin ITA 1991 31 1054984 KARL Benjamin AUT 1985\n";
  const rl1 = "Men's Parallel Giant Slalom\nRESULTS QUALIFICATION RUN\n" +
    "1 22 7538766 MARCH Aaron ITA 1986 34.10 1 21 9320091 LEE Sangho KOR 1995 34.35\n" +
    "5 18 9320014 KIM Sangkyum KOR 1989 34.77 5 25 9290151 FELICETTI Mirko ITA 1992 35.17\n" +
    "48 9320129 CHO Wanhee KOR 1998 DNF 17 9510316 CAVIEZEL Dario SUI 1995 DNF\n";
  const rl2 = "Men's Parallel Giant Slalom\nRESULTS QUALIFICATION\n" +
    "1 22 7538766 MARCH Aaron ITA 1986 34.10 1 35.58 12 1:09.68\n" +
    "2 21 9320091 LEE Sangho KOR 1995 35.60 12 34.35 1 1:09.95\n" +
    "31 25 9290151 FELICETTI Mirko ITA 1992 DNF 35.17 5 DNF\n" +
    "33 46 9531244 WINTERS Cody USA 2000 35.96 22\n";
  const pruef = (t, ok) => { console.log((ok ? "OK   " : "FEHL ") + t); if (!ok) process.exitCode = 1; };
  const b1 = fp.parseStartlistePdf(sl1);
  pruef("Startliste: MARCH blau, LEE rot", b1["22"] === "blau" && b1["21"] === "rot");
  const q1 = fp.parseResultatePdf(rl1, "q1", b1);
  pruef("Q1: 4 Zeiten (DNF ausgelassen)", q1.length === 4);
  pruef("Q1: MARCH 34.10 blau, Männer", q1[0].name === "MARCH" && q1[0].zeit === 34.1 && q1[0].kurs === "blau" && q1[0].gender === "maenner");
  pruef("Q1: LEE 34.35 rot", q1[1].name === "LEE" && q1[1].zeit === 34.35 && q1[1].kurs === "rot");
  const q2 = fp.parseResultate2Pdf(rl2, q1, {});
  pruef("Q2: 2 Zeiten", q2.length === 2);
  pruef("Q2: MARCH 35.58 rot (Gegenkurs)", q2[0].zeit === 35.58 && q2[0].kurs === "rot");
  pruef("Q2: LEE 35.60 blau", q2[1].zeit === 35.6 && q2[1].kurs === "blau");
}
