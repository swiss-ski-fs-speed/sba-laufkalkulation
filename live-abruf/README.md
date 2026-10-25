# SBA Live-Abruf – FIS-Daten → App

Stand: 25.10.2026. Zwei Hintergrund-Dienste auf Netlify (Site `sba-live-abruf`),
die an Weltcup-Renntagen die Quali-Zeiten von der FIS holen und in die
Firebase der SBA Laufkalkulation schreiben. Ausserhalb der Renntage beenden
sie sich sofort. **Status: scharf** (seit 25.10.2026, `DRY_RUN` entfernt).

| Dienst | Takt | Quelle | Rolle |
|---|---|---|---|
| `poller` | 1 Min. | FIS-Live-Datenfeed | Hauptquelle, live während der Läufe |
| `pdf-poller` | 5 Min. | Offizielle FIS-PDFs (Startlisten, Resultate) | Kursliste für den Abgleich + Ersatzweg, Zeiten kurz nach Laufende |
| `testlog` | auf Abruf | – | Journal lesen (ohne Netlify-Login) |

## Ablauf am Renntag (vollautomatisch)

1. **Kalender** (`lib/kalender.js`): ein Eintrag pro Quali-Tag mit den
   FIS-Codex-Nummern der Quali-Rennen (Frauen/Männer). Mehrtägige Weltcups
   (Mylin, Bansko, Krynica) = ein Eintrag pro Tag = ein App-Event
   (`auto-<datum>`). Fehlt ein Codex, wird er auf der FIS-Event-Seite gesucht.
2. **Live-Abruf** (`functions/poller.js`): Die Seite
   `live.fis-ski.com/lv-sb<codex>.htm` ist nur eine Hülle; die Daten kommen
   aus `<server>/sb<codex>/main.xml` (Serverliste
   `live.fis-ski.com/general/serverListFull.xml`), PHP-serialisiert. Der
   Decoder ist tolerant gegenüber gemischter Kodierung und falschen
   Längenangaben (Sölden 24.10.2026). Gesamtzeiten im 2. Lauf (mit oder ohne
   «:c»-Markierung) werden in Laufzeiten umgerechnet. Kursfarbe: Startlisten-
   Feld Index 4 («blue»/«red», laut FIS-Live-App, Disziplin «PAQ»).
3. **PDF-Abruf** (`functions/pdf-poller.js`, `lib/fis-pdf.js`): Event-Seite →
   Quali-Rennen (raceid) → Resultat-Seite → PDFs nach Beschriftung
   («Start List - Qualification Run 1» …). Text wird zeilenweise nach
   Position gelesen (eigene `pagerender`). Startlisten und Resultate Lauf 1
   zweispaltig (links Blau, rechts Rot), Resultate Lauf 2 = Gesamttabelle.
   Legt die offizielle Kurszuteilung als `startliste-<codex>` im Journal ab.
4. **Kurs-Abgleich**: Der Live-Abruf schreibt pro Rennen und Lauf nur, wenn
   ≥ 3 Startnummern mit der offiziellen Startliste verglichen werden konnten
   und keine abweicht. Sonst: «wartet auf Startliste» bzw. «GESPERRT» (Log).
   Folge: Erste Q2-Zeiten kommen bis ca. 5 Min. verzögert (Startliste Q2
   erscheint erst nach Lauf 1). Notfall-Schalter: `KURS_ABGLEICH=0`.
5. **Schreiben**: nur ins eigene Auto-Event (`auto: true`, manuell angelegte
   Events nie), nie mit «leer» überschreiben, nur bei neuen Zeiten. Pro Kurs
   und Geschlecht die besten 8 Zeiten (die App rechnet Frauen Top 5, Männer Top 8).

## Verifiziert

- Live-Feed: Generalprobe Sölden 24./25.10.2026 (Ski Alpin, Damen/Herren-RS),
  Zeiten beider Läufe auf die Hundertstel identisch mit FIS-Resultaten.
- PDFs: Cortina 13.12.2025 auf Netlify gelesen – Frauen Q1 49 / Q2 32,
  Männer Q1 60 / Q2 30, alle mit Kurs, Q1+Q2 = Total.
- Login mit `CC_PASSWORD`: OK (25.10.2026).
- **Noch offen bis Snow Ruyi (28.11.):** Adressmuster `lv-sb<codex>` und
  Kursfeld im Snowboard-Feed (aus dem Code der FIS-App abgeleitet, durch den
  Kurs-Abgleich abgesichert).

## Journal (ohne Netlify-Login)

`https://sba-live-abruf.netlify.app/.netlify/functions/testlog`

| Parameter | Inhalt |
|---|---|
| – | Version, Status pro Feed, letzte 300 Meldungen (inkl. «Kurs-Abgleich: …»), Login-Check, PDF-Test |
| `?raw=sb6004-max` / `?raw=sb6004-letzter` | Roh-Feed eines Rennens (meiste Zeiten / letzter Stand) |
| `?pdf=2026-11-28` | Letzter Stand des PDF-Abrufs an diesem Renntag |
| `?selbsttest=1` | Prüft den Speicher |

## Umgebungsvariablen (Netlify → Site configuration → Environment variables)

| Variable | Bedeutung |
|---|---|
| `CC_PASSWORD` | Passwort des Command-Center-Kontos (**geheim**, Pflicht) |
| `DRY_RUN=1` | **Not-Aus**: liest weiter, schreibt nichts. Danach «Trigger deploy»! |
| `KURS_ABGLEICH=0` | Kurs-Abgleich abschalten (nur im Notfall) |
| `LIVE_URL` | Live-Quelle(n) von Hand, kommagetrennt (nur Sonderfälle) |
| `FORCE=1` | Auch ausserhalb von Renntagen laufen (nur Tests) |

Geänderte Variablen gelten erst nach **Deploys → Trigger deploy → Deploy project**.

## Tests (lokal, ohne Netz)

```
node functions/poller.js --selftest        # Zuordnung, manuelle Events unangetastet
node functions/poller.js --selftest-feed   # Decoder mit echtem FIS-Feed (test/fixtures)
node functions/pdf-poller.js --selftest-pdf  # PDF-Parser mit echten Cortina-Zeilen
```

Generalproben lassen sich ohne Netlify-Einstellungen fahren: Kalendereintrag
mit `test: true` (Vorlagen als Kommentar in `poller.js` / `pdf-poller.js`) –
schreibt nie in die App, Ergebnis im Journal.

## Betrieb

- Kosten: praktisch keine (Netlify Free).
- Nächste Saison: `lib/kalender.js` neu befüllen (Codex der Quali-Rennen von
  den FIS-Event-Seiten) und `SEASONCODE`/`SEASON` anpassen; in der App
  `FIS_WC_2627` (index.html) nachführen und «Saisonkalender abgleichen».
- Not-Aus: `DRY_RUN=1` + Trigger deploy (oder Functions deaktivieren).
