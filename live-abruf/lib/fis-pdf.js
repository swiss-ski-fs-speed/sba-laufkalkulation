/**
 * FIS-Dokumente der Snowboard-Quali finden und lesen (Ergänzung Michael/Claude, 25.10.2026)
 * =====================================================================================
 * Verifiziert am 25.10.2026 mit Cortina 13.12.2025, Männer-Quali (Codex 6169,
 * raceid 24015):
 *  - Event-Seite (event-details.html?eventid=...): pro Rennen eine Zeile mit
 *    raceid-Link und Codex.
 *  - Resultat-Seite (results.html?sectorcode=SB&raceid=...): PDFs als
 *    data-link=".../competition-attachment/<uuid>.pdf" mit Beschriftung,
 *    z.B. "Start List - Qualification Run 1", "Results - Qualification Run 2".
 *  - PDFs zweispaltig: links BLUE COURSE, rechts RED COURSE, pro Zeile ein Paar.
 *    Text nach Zeilen-Aufbereitung (pdf-poller: nach y gruppiert, nach x
 *    sortiert), Startliste:
 *      "1 18 9320014 KIM Sangkyum KOR 1989 17 9510316 CAVIEZEL Dario SUI 1995"
 *    Resultate:
 *      "1 22 7538766 MARCH Aaron ITA 1986 34.10 1 21 9320091 LEE Sangho KOR 1995 34.35"
 *    Eintrag = Startnr. (1-3 Ziffern), FIS-Code (7 Ziffern), Name, Nation,
 *    [Zeit]. Erster Eintrag der Zeile = Blau, zweiter = Rot.
 * Funktionen ohne Netzwerk -> testbar (node functions/pdf-poller.js --selftest-pdf).
 */
const strip = h => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#39;|&amp;/g, m => ({ "&nbsp;": " ", "&#39;": "'", "&amp;": "&" }[m])).replace(/\s+/g, " ").trim();

/** Event-Seite -> [{ raceid, codex, quali: bool, gender: "frauen"|"maenner"|null }] */
function parseEventRennen(html) {
  const out = [];
  for (const chunk of html.split('class="table-row').slice(1)) {
    const rid = chunk.match(/raceid=(\d+)/);
    if (!rid) continue;
    const t = strip("<x " + chunk);
    const m = t.match(/\b(\d{4}) Parallel (?:Giant )?Slalom( Qualification)?/);
    if (!m) continue;
    const g = (t.match(/\b(?:QUA|WC|WSC|EC) ([WM])\b/) || [])[1];
    out.push({ raceid: rid[1], codex: m[1], quali: !!m[2], gender: g === "W" ? "frauen" : g === "M" ? "maenner" : null });
  }
  return out;
}

/** Resultat-Seite -> [{ url, label, art: "startliste"|"resultat", run: "q1"|"q2" }] (nur Quali-Läufe) */
function parseAnhaenge(html) {
  const out = [];
  for (const chunk of html.split('data-link="').slice(1)) {
    const url = chunk.slice(0, chunk.indexOf('"'));
    if (!/competition-attachment\/.+\.pdf/.test(url)) continue;
    const label = strip(chunk.slice(chunk.indexOf(">") + 1)).replace(/\s*download.*$/i, "").trim();
    const run = /Run 1\b/i.test(label) ? "q1" : /Run 2\b/i.test(label) ? "q2" : null;
    const art = /^Start List/i.test(label) ? "startliste" : /^Results/i.test(label) ? "resultat" : null;
    if (run && art && /Qualification/i.test(label)) out.push({ url: url.replace(/&amp;/g, "&"), label, art, run });
  }
  return out;
}

// Eintrag: Startnr., FIS-Code, Name, Nation, [Jahrgang], [Zeit|DNF...]
const EINTRAG = /(\d{1,3}) (\d{7}) ([^\d]+?) ([A-Z]{3})(?: (?:19|20)\d{2})?(?: (\d{1,2}:\d{2}\.\d{2}|\d{1,3}\.\d{2}|DNF|DNS|DSQ|DQ))?(?=\s|$)/g;

function eintraegeProZeile(text) {
  const zeilen = [];
  for (const raw of text.split("\n")) {
    const e = [...raw.matchAll(EINTRAG)].map(m => ({ bib: m[1], fis: m[2], name: m[3].trim(), nation: m[4], zeit: m[5] || null }));
    if (e.length) zeilen.push(e);
  }
  return zeilen;
}

function genderAus(text) {
  const kopf = text.slice(0, 400);
  if (/\b(Ladies|Women)'?s?\b/i.test(kopf)) return "frauen";
  if (/\bMen'?s?\b/i.test(kopf)) return "maenner";
  return null;
}

/** Startlisten-PDF -> { bib: "blau"|"rot" } */
function parseStartlistePdf(text) {
  const bibKurs = {};
  for (const e of eintraegeProZeile(text)) {
    if (e.length >= 2) { bibKurs[e[0].bib] = "blau"; bibKurs[e[1].bib] = "rot"; }
  }
  return bibKurs;
}

function zeitSek(s) {
  const m = String(s || "").match(/^(?:(\d+):)?(\d{1,3}\.\d{2})$/);
  if (!m) return null;
  const sec = (m[1] ? parseInt(m[1], 10) * 60 : 0) + parseFloat(m[2]);
  return sec > 5 && sec < 600 ? Math.round(sec * 100) / 100 : null;
}

/** Resultat-PDF -> [{ name, zeit, gender, run, kurs, bib }]. Kurs aus der
 *  Startliste desselben Laufs (bib), sonst aus der Spalte (links Blau, rechts Rot). */
function parseResultatePdf(text, run, bibKurs) {
  const gender = genderAus(text);
  const out = [];
  for (const e of eintraegeProZeile(text)) {
    e.forEach((x, i) => {
      const zeit = zeitSek(x.zeit);
      if (!zeit) return;                                   // DNF/DSQ/leer
      const kurs = (bibKurs || {})[x.bib] || (e.length >= 2 ? (i === 0 ? "blau" : "rot") : null);
      // Name wie im Live-Feed: nur der Nachname in Grossbuchstaben ("PINHEIRO BRAATHEN Lucas" -> "PINHEIRO BRAATHEN")
      const name = x.name.replace(/\s+[A-ZÄÖÜ][a-zäöüéèàçñ'-].*$/, "").toUpperCase();
      out.push({ name, zeit, gender, run, kurs, bib: Number(x.bib) });
    });
  }
  return out;
}

/** Resultat-PDF Lauf 2 = Gesamttabelle der Quali. Pro Zeile: Rang, Startnr.,
 *  FIS-Code, Name, Nation, Jahrgang, Zeit Blau, Rang, Zeit Rot, Rang, Total.
 *  Verifiziert Cortina 13.12.2025 (Frauen 32/32, Männer 30/30 Zeiten):
 *    "1 22 7538766 MARCH Aaron ITA 1986 34.10 1 35.58 12 1:09.68"
 *  -> Total = grösste Zeit; Lauf-1-Zeit aus den Lauf-1-Resultaten bekannt;
 *  die übrige Zeit ist Lauf 2. Kurs: Startliste Lauf 2, sonst Gegenkurs zu Lauf 1.
 *  Kontrolle: Lauf 1 + Lauf 2 = Total. */
const ZEILE2 = /^\s*\d{1,3}\s+(\d{1,3}) (\d{7}) ([^\d]+?) ([A-Z]{3})(.*)$/;
function parseResultate2Pdf(text, q1, bibKurs2) {
  const gender = genderAus(text);
  const lauf1 = new Map((q1 || []).map(e => [String(e.bib), e]));
  const out = [];
  for (const raw of text.split("\n")) {
    const m = raw.match(ZEILE2);
    if (!m) continue;
    const bib = m[1], rest = m[5];
    if (/DNF|DNS|DSQ|DQ/.test(rest)) continue;
    const zeiten = [...rest.matchAll(/(\d{1,2}:\d{2}\.\d{2})|(\d{2}\.\d{2})/g)].map(z => zeitSek(z[0])).filter(Boolean);
    if (zeiten.length < 3) continue;                       // nur Lauf 1 gefahren
    const total = Math.max(...zeiten);
    const l1 = lauf1.get(bib);
    if (!l1) continue;
    const rest2 = zeiten.filter(z => z !== total);
    const i = rest2.indexOf(l1.zeit);
    if (i < 0) continue;
    rest2.splice(i, 1);
    if (rest2.length !== 1) continue;
    if (Math.abs(l1.zeit + rest2[0] - total) > 0.011) continue;   // Kontrolle
    const kurs = (bibKurs2 || {})[bib] || (l1.kurs === "blau" ? "rot" : l1.kurs === "rot" ? "blau" : null);
    const name = m[3].trim().replace(/\s+[A-ZÄÖÜ][a-zäöüéèàçñ'-].*$/, "").toUpperCase();
    out.push({ name, zeit: rest2[0], gender, run: "q2", kurs, bib: Number(bib) });
  }
  return out;
}

module.exports = { parseEventRennen, parseAnhaenge, parseStartlistePdf, parseResultatePdf, parseResultate2Pdf, genderAus };
