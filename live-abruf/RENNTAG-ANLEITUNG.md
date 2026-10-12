# Renntag-Anleitung – SBA Laufkalkulation (Automatik)

Für das Command Center am Wettkampftag. Kein Claude, kein Technik-Wissen
nötig. Kurzfassung: **Im Normalfall macht ihr gar nichts** – die Automatik
holt die Zeiten selbst von der FIS und die Coaches sehen sie live in der App.

---

## So funktioniert die Automatik

- Der Dienst kennt den Weltcup-Kalender und aktiviert sich an Renntagen
  von selbst (im Minutentakt). Niemand muss etwas starten.
- Er holt die Zeiten von der FIS (Live-Seite, zusätzlich die offiziellen
  Quali-PDFs kurz nach jedem Lauf) und schreibt sie in die App.
- In der App erscheint automatisch das heutige Event (es ist beim Öffnen
  vorausgewählt). Die Coaches brauchen nur ihren Link.

## Am Renntag: ein Kontrollblick genügt

Kurz nach den ersten 3–5 Fahrern des ersten Laufs die App öffnen:

- **Heutiges Event da und Zeiten kommen rein?** → Alles gut. Nichts tun.
- **Nach ~10 Fahrern immer noch keine Zeiten?** → Manuell übernehmen (unten).

## Manuell übernehmen (Plan B – wie bisher, jederzeit möglich)

1. In der App als **Command Center** anmelden.
2. Menü (⋮) → **Neues Event** → im Formular den heutigen Wettkampf aus der
   FIS-Liste übernehmen → Anlegen.
3. Zeiten wie gewohnt eintragen (Eingabe «Zeit» oder «Diff»).

Wichtig: Die Automatik fasst **manuell angelegte Events nie an** – es kann
also nichts überschrieben werden oder durcheinanderkommen. Den Coaches kurz
sagen, dass sie oben im Dropdown auf euer Event wechseln sollen (falls auch
ein automatisches Event sichtbar ist).

Zeigt die Automatik offensichtlich falsche Daten: gleich vorgehen –
eigenes Event anlegen, manuell erfassen, das automatische Event ignorieren
(oder über Menü ⋮ löschen).

## Not-Aus (nur wer Netlify-Zugang hat)

Netlify → Site «Live-Abruf» → **Environment variables** →
`DRY_RUN` auf `1` setzen → die Automatik liest weiter, schreibt aber nichts
mehr. (Alternativ die Functions deaktivieren.)

## Kontakt bei Problemen

Michael Pleus / Luca (GitHub-Repo `sba-laufkalkulation`, Ordner `live-abruf`
mit technischem README).

---

## Voraussetzungen, damit das oben gilt (einmalig, vor der Saison)

1. Live-Abruf auf Netlify deployt, `CC_PASSWORD` gesetzt.
2. Live-Parser am echten Event verifiziert (Generalprobe Sölden 24./25.10.,
   definitiv beim ersten Rennen) – bis dahin läuft die Automatik im
   Beobachtungsmodus (`DRY_RUN=1`).
3. Danach `DRY_RUN` entfernt → Automatik scharf.
