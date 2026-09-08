# Offene Punkte

*Fuer spaetere Sitzungen. Erledigte Punkte bitte streichen, nicht abhaken —
die Datei soll kurz bleiben. Angelegt 07.09.2026, zuletzt 07.09.2026.*

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

## Browser-Tests liegen nicht im Repo

Die Gesten, der Kennwortschutz, die Kopfzeilen und die Scroll-Logik wurden mit
einer Playwright-Reihe gegen den Produktionsbau geprueft (echte Touch-Events
ueber CDP, 42 Faelle). Committed ist sie nicht: Playwright waere mit Abstand die
groesste Dev-Abhaengigkeit dieses Repos, und nach der Hausbasis-Regel ist das
keine Entscheidung fuer ein Repo allein.

Zu klaeren: entweder Playwright in `baseline.json` aufnehmen — `etymology` hat
es ohnehin schon —, oder die Reihe bleibt ein Werkzeug fuer die Entwicklung und
laeuft nicht in der CI. Solange sie draussen ist, faellt eine Regression an der
Geste erst am Geraet auf.

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

## Erledigt, aber gut zu wissen

Kennwortversuche werden seit 07.09.2026 gebremst (`server/limit.ts`): zehn
Fehlversuche je IP und Zieleintrag, dann 15 Minuten Sperre. Der Zaehler haengt
im Arbeitsspeicher und ist nach einem Redeploy leer — fuer diesen Zweck
ausreichend, aber es ist kein Schutz gegen viele Rechner gleichzeitig.

Terminseiten liefern `X-Robots-Tag: noindex, nofollow`, die Startseite nicht;
`public/robots.txt` sperrt zusaetzlich `/e/`. Das haengt am Pfad im Server, ist
also unabhaengig davon, was in Coolify eingestellt ist.

HSTS setzt der Server selbst, aber nur wenn `x-forwarded-proto: https` ankommt —
im Dev ueber http wuerde der Header den Browser sonst dauerhaft aussperren.
Deshalb ist am Proxy dafuer nichts einzustellen.

## Auto-Deploy haengt noch

Coolify baut nur auf Knopfdruck: es gibt keinen Webhook, weder am Repo noch
ueber die GitHub App (am 07.09.2026 fuer `scheduling` und `fresh-redesign`
geprueft — bei fresh-redesign laeuft er ueber die App, hier fehlt er).
Vermutlich wurde die Application als *Public Repository* angelegt; diese
Quelle hat keine Rueckverbindung zu GitHub. Weg raus: Webhook aus dem
Webhooks-Reiter der Application von Hand in die Repo-Einstellungen eintragen.
