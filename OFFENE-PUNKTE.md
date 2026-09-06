# Offene Punkte

*Fuer spaetere Sitzungen. Erledigte Punkte bitte streichen, nicht abhaken —
die Datei soll kurz bleiben. Angelegt 07.09.2026.*

## `pnpm lint` laeuft nirgends

`typescript-eslint@8` unterstuetzt TypeScript 7.0 nicht und bricht sofort ab.
**Das betrifft alle Repos auf der Hausbasis**, nicht nur dieses — in `freshpost`
am 07.09.2026 mit demselben Fehler geprueft. Die eslint-Config liegt hier
trotzdem schon richtig, und `pnpm build` (tsc) prueft die Typen ohnehin.

Nicht im Alleingang loesen: entweder wartet die Hausbasis auf
typescript-eslint mit TS-7-Support, oder `typescript` geht in `baseline.json`
zurueck auf 6.x. Beides ist eine Entscheidung fuer alle Repos zusammen.
Tracking: https://github.com/typescript-eslint/typescript-eslint/issues/10940

Sobald das geloest ist, `lint` in `.github/workflows/ci.yml` wieder aufnehmen.

## QR-Code zum Termin — Dependency-Entscheidung noetig

Wenn eine Gruppe im Raum steht, ist ein QR-Code schneller als jeder geteilte
Link. Dafuer braucht es einen QR-Encoder, und der waere die **einzige**
Laufzeit-Dependency des Projekts ausserhalb von React.

Nach der Hausbasis-Regel kostet ein Paket, das nur ein Repo hat, den gemeinsamen
pnpm-Store. Also entweder in `baseline.json` aufnehmen (wenn andere Repos das
auch brauchen koennen) oder ~200 Zeilen QR-Encoder selbst schreiben. Bis dahin:
Web Share bzw. Zwischenablage.

## Kein Rate-Limit auf Kennwortversuche

`PUT /api/polls/:id/entry` prueft Kennwoerter ohne Zaehler. scrypt laeuft async,
blockiert den Event-Loop also nicht, aber Raten ist unbegrenzt moeglich.

Fuer eine Vereinsrunde mit geteiltem Link ist das vertretbar — das Kennwort
schuetzt einen Rasterentrag, keine Identitaet. Vor breiterem Einsatz: ein
Zaehler pro IP im Speicher, ~20 Zeilen.

## Was bewusst fehlt

Nicht vergessen, sondern entschieden:

- **Zeitzonen-Umrechnung pro Person.** Ein Termin hat eine Zeitzone. Die
  Umrechnung ist die fehleranfaelligste Funktion in solchen Werkzeugen und fuer
  eine lokale Gruppe wertlos.
- **Konten, E-Mail-Erinnerungen, Kalender-Sync.**
- **Wochentags-Modus** (Spalten = Mo–So statt konkreter Daten, fuer
  wiederkehrende Termine). Waere billig: der Tagesschluessel ist schon ein
  String, kein Datum, und wird nirgends als Datum gerechnet. Erst bauen, wenn
  es jemand braucht.
- **Live-Aktualisierung per SSE**, damit man beim gemeinsamen Ausfuellen sieht,
  wie sich das Raster fuellt.
- **Ergebnis festzurren + .ics-Download**, **CSV-Export**.
