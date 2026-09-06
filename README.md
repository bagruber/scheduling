# scheduling

Terminfindung als Matrix, wie when2meet — nur mobiltauglich. Tage und
Zeitfenster festlegen, Link teilen, alle malen ihre Zeiten ins Raster.

Kein Konto, keine Cookies, kein Tracking. Wer sich einträgt, tippt seinen Namen
und darf optional ein Kennwort setzen, das den eigenen Eintrag vor Änderungen
schützt.

## Bedienung

**Auf dem Handy** gibt es keinen Malmodus-Schalter — die Geste entscheidet:

| Geste                  | Wirkung                        |
| ---------------------- | ------------------------------ |
| Tippen                 | ein Feld an/aus                |
| Halten (250 ms), ziehen | Rechteck malen                |
| Wischen                | scrollen                       |
| Tag antippen (Leiste unten) | ganzer Tag / vormittags / nachmittags / abends |

Die **erste Zelle bestimmt die Richtung**: auf Leerem wird gemalt, auf
Gesetztem radiert. Am Desktop malt die Maus direkt, ohne Haltezeit, und das
Raster ist mit Pfeiltasten und Leertaste bedienbar.

Gespeichert wird automatisch nach jeder Geste. Es gibt keinen Absenden-Knopf und
damit auch keinen verlorenen Stand nach einem versehentlichen Reload.

## Warum Zeiträume und keine Rasterfelder

Der Takt (15 / 30 / 60 / 120 Minuten) ist reine **Anzeige-Auflösung**.
Gespeichert wird `von`–`bis`, nicht „Feld 14 von 24".

Das ist der Grund, warum der Ersteller den Takt jederzeit ändern kann, ohne dass
jemand neu antworten muss: eine Zwei-Stunden-Zusage füllt im 30-Minuten-Raster
eben vier Felder, und ein nur teilweise abgedecktes Feld wird als solches
markiert. Mit Slot-Nummern wäre jede Taktänderung eine Migration — und der Takt
wird erfahrungsgemäß genau dann geändert, wenn schon jemand geantwortet hat.

Zeitpunkte sind Strings der Form `2026-11-12T09:30` in der Zeitzone des Termins.
Es wird nie umgerechnet, also braucht weder Server noch Client Datumsarithmetik,
und es gibt keine Sommerzeit-Fehler.

## Aufbau

```
shared/types.ts    Typen, die Server und Client teilen
server/            node:http + node:sqlite, keine Laufzeit-Dependency
  db.ts            Schema und Abfragen
  api.ts           Handler und Validierung
  index.ts         Routing, statische Dateien, SPA-Fallback
src/
  lib/grid.ts      Zeiträume <-> Rasterfelder, Auszählung, Bestzeiten (rein, getestet)
  hooks/usePaint.ts Die Geste
  components/Grid.tsx
  pages/           Anlegen, Termin
```

Der Server hat **keine** Laufzeit-Dependency: `node:http`, `node:sqlite`,
`node:crypto` reichen, und Node 24 strippt die TypeScript-Typen selbst — es gibt
keinen Build-Schritt für den Server. React und Vite sind reine Dev-Abhängigkeiten
für das Frontend.

## Entwickeln

```bash
pnpm install
pnpm dev:api        # API auf :8080
pnpm dev            # Vite auf :5173
pnpm test           # Rasterlogik
pnpm build          # tsc + dist/
```

Deployment: siehe [DEPLOY.md](DEPLOY.md).
