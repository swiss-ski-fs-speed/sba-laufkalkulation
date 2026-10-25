# Renntag-Anleitung – SBA Laufkalkulation

Für das Command Center am Wettkampftag. Stand 25.10.2026. Kein Technik-Wissen
nötig. **Im Normalfall macht ihr gar nichts:** Die Automatik holt die
Quali-Zeiten selbst von der FIS, die Coaches sehen sie live in der App.

## So funktioniert die Automatik

- Sie kennt alle Weltcup-Renntage der Saison und startet an diesen Tagen von
  selbst, jede Minute. Niemand muss etwas einschalten.
- Sie liest die Live-Zeiten der FIS und prüft jede Kurszuteilung (Blau/Rot)
  gegen die offizielle FIS-Startliste. Nur geprüfte Zeiten kommen in die App.
- Die offiziellen Resultat-PDFs dienen als Reserve, kurz nach jedem Lauf.
- Jeder Renntag hat sein eigenes Event in der App. Es ist beim Öffnen
  automatisch ausgewählt.

## Was ihr am Renntag seht

| Zeitpunkt | Normal |
|---|---|
| Q1 läuft | Zeiten kommen etwa im Minutentakt, Banner zeigt die Tendenz |
| Beginn Q2 | Die ersten Q2-Zeiten kommen **bis ca. 5 Minuten verzögert** (die Automatik wartet auf die offizielle Startliste Q2), danach wieder im Minutentakt |
| Nach jedem Lauf | Zeiten vollständig |

## Kontrollblick (einmal pro Lauf genügt)

Nach etwa 10 Fahrer:innen die App öffnen:

- **Zeiten kommen rein, Kurse plausibel?** → Alles gut, nichts tun.
- **Q1: nach 10 Fahrer:innen noch keine Zeiten?** → Plan B.
- **Q2: nach 10 Minuten noch keine Zeiten?** → Plan B.
- **Zeiten offensichtlich falsch** (z.B. Athlet:in auf falschem Kurs)? → Plan B.

## Plan B: manuell übernehmen (jederzeit möglich)

1. In der App als **Command Center** anmelden.
2. Menü (⋮) → **Neues Event** → im Formular den heutigen Wettkampf aus der
   FIS-Liste wählen → **Anlegen**.
3. Zeiten wie gewohnt eintragen.
4. Den Coaches sagen, dass sie oben in der Auswahl auf euer Event wechseln.

Die Automatik verändert **manuell angelegte Events nie**. Es kann also nichts
überschrieben werden. Das automatische Event könnt ihr ignorieren oder über
Menü (⋮) → Event löschen entfernen.

## Not-Aus (nur mit Netlify-Zugang: Michael, Luca)

Netlify → Site **sba-live-abruf** → Site configuration → Environment
variables → **Add a variable**: `DRY_RUN` mit Wert `1` → danach **Deploys →
Trigger deploy → Deploy project**. Die Automatik liest dann weiter, schreibt
aber nichts mehr in die App.

## Kontakt

Michael Pleus (Projektleitung) · Luca (Netlify, GitHub-Organisation
`swiss-ski-fs-speed`). Technische Details: `live-abruf/README.md` im Repository
`sba-laufkalkulation`.
