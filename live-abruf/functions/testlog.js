/**
 * Testlauf-Journal lesen (Ergänzung Michael/Claude, 20.10.2026)
 * ==============================================================
 * Öffentlich lesbar, enthält nur öffentliche FIS-Renndaten und Statusmeldungen
 * des Pollers – keine Passwörter, keine App-Daten.
 *
 *   /.netlify/functions/testlog                 -> Status + Journal (JSON)
 *   /.netlify/functions/testlog?raw=al5001-max  -> Roh-Feed mit den meisten Zeiten
 *   /.netlify/functions/testlog?raw=al5001-letzter
 *   /.netlify/functions/testlog?selbsttest=1    -> prüft, ob der Speicher geht
 */
const { getStore, connectLambda } = require("@netlify/blobs");
const { VERSION } = require("./poller.js");

exports.handler = async (event) => {
  const json = (code, obj) => ({ statusCode: code,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(obj, null, 2) });
  try {
    if (event && event.blobs) connectLambda(event);
    const store = getStore("testlauf");
    const q = (event && event.queryStringParameters) || {};
    if (q.selbsttest) {
      const wert = new Date().toISOString();
      await store.set("selbsttest", wert);
      const zurueck = await store.get("selbsttest");
      return json(200, { version: VERSION, speicher: zurueck === wert ? "OK" : "FEHLER", wert });
    }
    if (q.pdf) {   // ?pdf=2026-11-28 -> PDF-Beobachtung eines Renntags
      const v = await store.get("pdfLauf-" + String(q.pdf).replace(/[^0-9-]/g, ""), { type: "json" });
      return json(v ? 200 : 404, v || { fehler: "keine PDF-Beobachtung für " + q.pdf });
    }
    if (q.raw) {
      const key = "feed-" + String(q.raw).replace(/[^a-z0-9-]/gi, "");
      const t = await store.get(key);
      return { statusCode: t ? 200 : 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
               body: t || "nicht vorhanden: " + key };
    }
    const status = await store.get("status", { type: "json" });
    const herzschlag = await store.get("herzschlag", { type: "json" });
    const pdfTest = await store.get("pdfTest", { type: "json" });
    const loginCheck = await store.get("loginCheck", { type: "json" });
    return json(200, { version: VERSION, herzschlagPoller: herzschlag || "noch keiner",
                       loginCheck: loginCheck || "noch nicht gelaufen",
                       pdfTest: pdfTest || "noch nicht gelaufen",
                       status: status || "noch keine Daten (Testlauf hat noch nicht begonnen)" });
  } catch (e) {
    return json(500, { version: VERSION, fehler: String(e.message || e) });
  }
};
