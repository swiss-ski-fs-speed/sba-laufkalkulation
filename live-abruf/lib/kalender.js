/**
 * Renntage Snowboard Alpin Weltcup 2026/27 (Ergänzung Michael/Claude, 25.10.2026)
 * ==============================================================================
 * Gemeinsam für poller.js und pdf-poller.js.
 *
 * Ein Eintrag = ein Qualifikationstag = ein App-Event (id "auto-<datum>").
 * Mehrtägige Weltcups (Mylin, Bansko, Krynica) haben pro Tag ein eigenes
 * Rennen mit eigener Quali -> zwei Einträge.
 *
 * quali = FIS-Codex der Qualifikationsrennen (Rennart "Parallel ... Slalom
 * Qualification", QUA). Live-Seite: live.fis-ski.com/lv-sb<codex>.htm,
 * Datenfeed: <server>/sb<codex>/main.xml. Erhoben am 25.10.2026 aus den
 * FIS-Event-Seiten (event-details.html?sectorcode=SB&eventid=...). Fehlt ein
 * Codex, sucht der Poller ihn am Renntag selbst auf der Event-Seite.
 */
const RENNTAGE = [
  { datum: "2026-11-28", ort: "Snow Ruyi",         disziplin: "PGS", eventid: "62746", quali: { maenner: "6002", frauen: "6004" } },
  { datum: "2026-12-05", ort: "Mylin",             disziplin: "PGS", eventid: "62791", quali: { maenner: "6011", frauen: "6014" } },
  { datum: "2026-12-06", ort: "Mylin",             disziplin: "PGS", eventid: "62791", quali: { maenner: "6016", frauen: "6018" } },
  { datum: "2026-12-12", ort: "Cortina d'Ampezzo", disziplin: "PGS", eventid: "62758", quali: { maenner: "6028", frauen: "6031" } },
  { datum: "2026-12-17", ort: "Carezza",           disziplin: "PGS", eventid: "62759", quali: { maenner: "6042", frauen: "6047" } },
  { datum: "2026-12-19", ort: "Davos",             disziplin: "PSL", eventid: "62760", quali: { maenner: "6052", frauen: "6055" } },
  { datum: "2027-01-09", ort: "Scuol",             disziplin: "PGS", eventid: "62761", quali: { maenner: "6060", frauen: "6063" } },
  { datum: "2027-01-16", ort: "Bansko",            disziplin: "PGS", eventid: "62762", quali: { maenner: "6070", frauen: "6074" } },
  { datum: "2027-01-17", ort: "Bansko",            disziplin: "PGS", eventid: "62762", quali: { maenner: "6077", frauen: "6079" } },
  { datum: "2027-01-23", ort: "Rogla",             disziplin: "PGS", eventid: "62763", quali: { maenner: "6087", frauen: "6090" } },
  { datum: "2027-01-26", ort: "Bad Gastein",       disziplin: "PSL", eventid: "62764", quali: { maenner: "6094", frauen: "6096" } },
  { datum: "2027-01-30", ort: "Ratschings",        disziplin: "PSL", eventid: "62955", quali: { maenner: "6102", frauen: "6105" } },
  { datum: "2027-02-27", ort: "Krynica",           disziplin: "PGS", eventid: "62765", quali: { maenner: "6129", frauen: "6132" } },
  { datum: "2027-02-28", ort: "Krynica",           disziplin: "PGS", eventid: "62765", quali: { maenner: "6136", frauen: "6139" } },
  { datum: "2027-03-07", ort: "WM Montafon",       disziplin: "PGS", eventid: "62999", quali: { maenner: "6171", frauen: "6173" } },
  { datum: "2027-03-09", ort: "WM Montafon",       disziplin: "PSL", eventid: "62999", quali: { maenner: "6176", frauen: "6179" } },
  { datum: "2027-03-20", ort: "Winterberg",        disziplin: "PSL", eventid: "62766", quali: { maenner: "6149", frauen: "6151" } },
];

const MONATE = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/** Quali-Codexe eines Tages von der FIS-Event-Seite lesen (Rückfall, wenn
 *  im Kalender nichts hinterlegt ist). Liefert { maenner, frauen } oder null. */
async function findeQualiCodexe(eventid, datum, seasoncode, headers) {
  const url = `https://www.fis-ski.com/DB/general/event-details.html?sectorcode=SB&eventid=${eventid}&seasoncode=${seasoncode}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error("FIS-Event-Seite: HTTP " + res.status);
  const txt = (await res.text()).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const re = /(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) Parallel (?:Giant )?Slalom Qualification[^]{0,200}?QUA ([WM])\b/g;
  const out = {};
  for (const m of txt.matchAll(re)) {
    const tag = datum.slice(0, 5) + MONATE[m[2]] + "-" + m[1].padStart(2, "0");
    if (tag !== datum) continue;
    out[m[4] === "W" ? "frauen" : "maenner"] = m[3];
  }
  return Object.keys(out).length ? out : null;
}

module.exports = { RENNTAGE, findeQualiCodexe };
