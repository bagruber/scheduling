# scheduling

Terminfindung als Matrix, wie when2meet — nur mobiltauglich. Tage und Zeitfenster
festlegen, Link teilen, alle malen ihre Zeiten ins Raster.

Kein Konto, keine Cookies, kein Tracking. Wer sich einträgt, tippt seinen Namen
und darf optional ein Kennwort setzen, mit dem sich der eigene Eintrag später
ändern lässt.

**Zum Ausprobieren:** <https://bagruber.github.io/scheduling/> — dieselbe App
ohne Server, alles bleibt im Browser des Besuchers. Siehe [Demo](#demo).

## Bedienung

Auf dem Handy gibt es keinen Malmodus-Schalter. Die Geste entscheidet:

| Geste | Wirkung |
| --- | --- |
| Tippen | ein Feld an oder aus |
| Halten (250 ms), dann ziehen | Rechteck malen |
| Wischen | scrollen |
| Tag in der Kopfzeile antippen | ganzen Tag füllen, nochmal tippen leert ihn |

Die **erste Zelle bestimmt die Richtung**: auf Leerem wird gemalt, auf Gefülltem
radiert. Am Desktop malt die Maus sofort, ohne Haltezeit, und das Raster lässt
sich mit Pfeiltasten und Leertaste bedienen.

Gespeichert wird automatisch 700 ms nach der letzten Geste. Es gibt keinen
Absenden-Knopf und damit auch keinen verlorenen Stand nach einem versehentlichen
Reload. Nach jeder Änderung steht sechs Sekunden lang ein Rückgängig-Knopf bereit.

Warum das lange Drücken funktioniert: Ein Wisch bedeutet auf einem Touchscreen
gleichzeitig „scrollen" und „malen". Statt eines Moduswechsels trennt die Geste
selbst. Wer 250 ms stillhält, hat sich nicht bewegt — der Browser hat das
Scrollen also noch gar nicht begonnen, und ein `preventDefault` auf dem ersten
`touchmove` danach verhindert es zuverlässig. Die Konstanten stehen oben in
[`src/hooks/usePaint.ts`](src/hooks/usePaint.ts).

Auf iOS gibt es `navigator.vibrate` nicht. Deshalb quittiert das lange Drücken
zusätzlich mit einem Ring, der aus dem Startfeld läuft — auf der Hälfte aller
Geräte ist das die einzige Rückmeldung.

## Auswertung

Unter dem Raster stehen zwei Sichten auf dieselben Antworten, umschaltbar:

**Ein Termin** sucht die Fenster, in denen die meisten können, und nennt die
Fehlenden beim Namen. Benachbarte Felder mit identischer Besetzung verschmelzen,
damit „alle außer Anna, 14–16 Uhr" als ein Vorschlag erscheint und nicht als
vier.

**Mehrere Schichten** löst die andere Frage: nicht *wann können die meisten*,
sondern *wie kommen möglichst viele verschiedene Leute zum Zug, ohne dass eine
Schicht unterbesetzt bleibt*. Das Ergebnis ist eine **Einteilung**, keine
Verfügbarkeitsliste — je Schicht steht, wer dran ist, und wer einspringen
könnte. Darüber die Bilanz: „6 von 6 Personen eingeteilt, auf 3 Schichten."

Die Mindestzahl je Schicht ist einstellbar. Jede ausgegebene Schicht erreicht
sie; wer in keiner Schicht dieser Größe vorkommt, wird namentlich ausgewiesen
statt stillschweigend übergangen.

**Auf eine Anzahl von Schichten legt sich nichts vorab fest.** Angezeigt wird
zunächst, was nötig ist, damit jeder einmal dran war — `planShifts` gibt das als
`enough` zurück. Darüber hinaus vergibt es weiter, solange freie Fenster übrig
sind; „Weitere Schicht laden" holt sie einzeln nach und sagt dabei, wie viele
noch möglich sind, „Letzte entfernen" nimmt sie wieder zurück. Unter das Nötige
geht es nicht — dort wäre jemand nicht mehr versorgt.

Nachgeladene Schichten rutschen chronologisch an ihren Platz, weil das Ergebnis
ein Plan ist und keine Liste.

Darunter steht, wie viele Stunden jeder im **aktuell angezeigten** Plan trägt,
absteigend sortiert. Das ist die Zahl, an der man sieht, ob sich die Last
verteilt — und sie ändert sich mit, sobald eine Schicht dazukommt oder wegfällt.

Exakt ist das eine Mengenüberdeckung und damit NP-schwer. `planShifts` in
[`src/lib/grid.ts`](src/lib/grid.ts) läuft deshalb als Heuristik, und zwar
bewusst nicht über das jeweils vollste Fenster: das sammelt die Flexiblen
zuerst ein und lässt am Ende genau die übrig, um die es geht. Stattdessen ist
immer dran, wer bisher die wenigsten Dienste hat — bei Gleichstand, wer die
wenigsten Möglichkeiten hat.

In eine Schicht kommen alle, die dann können und bisher am wenigsten dran waren
— das bringt pro Schicht die meisten neuen Leute hinein. Reicht das nicht bis
zur Mindestzahl, wird mit den nächst-wenigst-Beanspruchten aufgefüllt. Kein
Zeitfenster wird zweimal vergeben. Eine Schicht reicht so weit, wie dieselben
Leute können; die Schichtlänge ergibt sich also aus den Antworten, nicht aus
einer weiteren Einstellung.

„Vielleicht" zählt hier nicht mit. Für eine Schicht braucht es Zusagen.

Ein Tipper auf einen Namen in der Liste blendet dessen Zeiten ins Raster —
nützlich, wenn jemand fehlt und man sehen will, woran es liegt.

## Warum Zeiträume und keine Rasterfelder

Der Takt (15 / 30 / 60 / 120 Minuten) ist reine **Anzeige-Auflösung**.
Gespeichert wird `von`–`bis`, nicht „Feld 14 von 24".

Das ist der Grund, warum der Ersteller den Takt jederzeit ändern kann, ohne dass
jemand neu antworten muss: Eine Zwei-Stunden-Zusage füllt im 30-Minuten-Raster
eben vier Felder, ein nur teilweise abgedecktes Feld wird als solches markiert.
Mit Slot-Nummern wäre jede Taktänderung eine Migration — und der Takt wird
erfahrungsgemäß genau dann geändert, wenn schon jemand geantwortet hat.

Zeitpunkte sind Strings der Form `2026-11-12T09:30` in der Zeitzone des Termins.
Es wird nie umgerechnet, also braucht weder Server noch Client Datumsarithmetik,
Vergleiche sind lexikographisch korrekt, und es gibt keine Sommerzeit-Fehler.

Die Feldhöhe skaliert bewusst nicht linear mit der Dauer, sondern mit Faktor
1,25 je Verdopplung (26 / 32 / 40 / 50 px). Linear wäre das Viertelstundenraster
mit dem Daumen nicht mehr treffbar und das Zweistundenraster absurd hoch.

## Aufbau

```
shared/types.ts        Typen, die Server und Client teilen
server/
  db.ts                Schema und Abfragen (node:sqlite)
  api.ts               Handler und Validierung
  limit.ts             Bremse gegen Kennwortraten
  index.ts             Routing, statische Dateien, SPA-Fallback, Header
src/
  lib/grid.ts          Zeiträume <-> Rasterfelder, Auszählung, Bestzeiten, Schichtplan
  lib/grid.test.ts     Tests dazu
  lib/api.ts           fetch-Hüllen, im Mockup auf demoStore umgebogen
  lib/demoStore.ts     localStorage-Ersatz für die Demo
  lib/router.ts        zwei Routen, keine Bibliothek
  lib/format.ts        deutsche Datums- und Zeitformate
  hooks/usePaint.ts    die Geste
  components/Grid.tsx  das Raster
  components/HelpFigures.tsx  animierte Anleitung (SVG + CSS)
  pages/               Anlegen, Termin
public/robots.txt      sperrt /e/ für Suchmaschinen
tests/browser.mjs      Browsertests gegen den gebauten Stand
```

Ein einziger Node-Prozess serviert in Produktion das gebaute Frontend aus `dist/`
**und** die API unter `/api`.

### Datenmodell

```
poll         id, titel, hinweis, zeitzone, takt, tage[], von, bis,
             vielleicht_erlaubt, admin_token, angelegt, geschlossen
participant  id, poll_id, name, kennwort_hash?, geändert
span         participant_id, von, bis, wahl
```

Schreiben heißt: alle Zeiträume des Teilnehmers löschen, zusammengefasste neu
einfügen. Der eindeutige Index auf `(poll_id, name COLLATE NOCASE)` sorgt dafür,
dass „Max" und „max" derselbe Eintrag sind.

## Werkzeuge

Der Server hat **keine einzige Laufzeit-Dependency**. React und Vite sind reine
Dev-Abhängigkeiten für das Frontend; im Produktionsimage liegt kein
`node_modules`.

| Werkzeug | Version | Wofür |
| --- | --- | --- |
| Node | 24 | Laufzeit. `node:sqlite`, `node:crypto` und `node:http` decken alles ab, was der Server braucht |
| pnpm | 11.24.0 | Paketmanager, in `packageManager` festgenagelt, damit der Docker-Build dieselbe Version zieht wie das Lockfile |
| TypeScript | ~7.0.2 | Typen für Frontend, Server und `shared/`. `tsc -b` ist zugleich die Prüfung in der CI |
| Vite | ^8.2.2 | Dev-Server und Frontend-Build |
| React | ^19.2.8 | UI |
| @vitejs/plugin-react | ^6.1.0 | JSX und Fast Refresh |
| Vitest | ^4.1.11 | Tests der Rasterlogik |
| ESLint | ^10.4.1 | Linting — läuft derzeit nicht, siehe [OFFENE-PUNKTE.md](OFFENE-PUNKTE.md) |

Die Zielversionen stehen nicht hier, sondern in `hausbasis/baseline.json`.
Abgleich mit `node ../hausbasis/check.mjs --kurz`.

### Was bewusst fehlt

Kein Router (zwei Routen sind eine Regex), keine Icon-Bibliothek (zwei Icons sind
Inline-SVG), keine Animationsbibliothek (die Anleitung sind CSS-Keyframes), kein
ORM, kein CSS-Framework, kein QR-Encoder.

Der Server braucht auch **keinen Build-Schritt**: Node 24 entfernt die
TypeScript-Typen selbst. Dafür müssen relative Imports die `.ts`-Endung tragen
und die Syntax vollständig löschbar sein — `erasableSyntaxOnly` in
[`tsconfig.json`](tsconfig.json) erzwingt das, also keine `enum`s und keine
Parameter-Properties.

## Entwickeln

```bash
pnpm install
pnpm dev:api        # API auf :8080
pnpm dev            # Vite auf :5173, proxied /api
pnpm test           # Rasterlogik
pnpm build          # tsc + dist/
pnpm start          # Produktionsserver auf :8080
```

Für den Produktionsmodus lokal: `pnpm build && pnpm start`.

### Umgebungsvariablen

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PORT` | `8080` | Port des Servers |
| `DATA_DIR` | `./data` | Verzeichnis für `scheduling.db` |

Keine Secrets, keine externen Dienste.

## Tests

`pnpm test` prüft die Rasterlogik in [`src/lib/grid.test.ts`](src/lib/grid.test.ts)
— Umrechnung zwischen Zeiträumen und Feldern in beide Richtungen, Teilabdeckung,
Auszählung, Bestzeiten. Darunter der Fall, der die Architektur trägt: eine bei
120er-Takt gegebene Antwort muss nach Umstellung auf 30 Minuten vier Felder
füllen.

Die CI läuft `pnpm test` und `pnpm build` bei jedem Push
([`ci.yml`](.github/workflows/ci.yml)).

[`tests/browser.mjs`](tests/browser.mjs) prüft den gebauten Stand im echten
Browser: die Gesten mit echten Touch-Events über CDP, die Auswertung, den
Kennwortschutz, die Kopfzeilen und die Scroll-Logik.

```bash
pnpm build
PORT=8099 DATA_DIR=./data node server/index.ts &
PLAYWRIGHT_FROM=../etymology node tests/browser.mjs
```

Playwright ist hier **keine** Abhängigkeit — das wäre die mit Abstand größte,
und nach der Hausbasis-Regel keine Entscheidung für ein Repo allein. Die Datei
sucht es deshalb erst als eigenes Paket und dann unter dem Pfad in
`PLAYWRIGHT_FROM`. Deshalb läuft sie auch nicht in der CI; notiert in
[OFFENE-PUNKTE.md](OFFENE-PUNKTE.md).

## Demo

`pnpm run build:demo` baut dasselbe Frontend im Vite-Modus `demo`. Dabei greift
[`.env.demo`](.env.demo) mit `VITE_DEMO=1`, und
[`src/lib/api.ts`](src/lib/api.ts) leitet Lesen und Speichern auf
[`src/lib/demoStore.ts`](src/lib/demoStore.ts) um: statt `/api` der
`localStorage` des Besuchers.

Der Termin ist vorbelegt — vier Personen, fünf Tage ab morgen, damit die
Auswertung etwas zu rechnen hat. Ein Knopf im Hinweis oben setzt alles auf den
Ausgangsstand zurück, was beim Reihum-Testen praktisch ist.

Nicht enthalten: Anlegen, Verwaltung und Löschen. Die setzen einen Admin-Token
in der URL voraus, den die Demo nicht hat. Die Demo zeigt genau den Weg, um den
es beim Ausprobieren geht — Namen eintragen und Zeiten malen.

[`pages.yml`](.github/workflows/pages.yml) baut und veröffentlicht sie bei jedem
Push auf `main`.

## Betrieb

Ein Container, gebaut über das [`Dockerfile`](Dockerfile) im Wurzelverzeichnis.
Die Daten sind eine einzige SQLite-Datei; sie muss auf einem Volume liegen.
Schritt für Schritt in [DEPLOY.md](DEPLOY.md).

### Was der Server absichert

Kennwörter über `scrypt` mit 16 Byte Zufallssalz je Eintrag, Vergleich über
`timingSafeEqual`. Die Ableitung läuft asynchron, damit sie den Event-Loop des
einzigen Prozesses nicht für ~100 ms blockiert.

Zehn Fehlversuche je IP und Zieleintrag, dann eine Viertelstunde Sperre mit `429`
und `Retry-After`. Gezählt werden nur falsche Kennwörter; ein richtiges setzt den
Zähler zurück, normales Benutzen läuft also nie gegen die Grenze. Der Schlüssel
enthält den Zieleintrag, damit hinter einem gemeinsamen Anschluss nicht die ganze
Gruppe gesperrt wird, weil eine Person ihr Kennwort vergessen hat.

Terminseiten liefern `X-Robots-Tag: noindex, nofollow`, die Startseite nicht —
dort stehen keine Namen. `Strict-Transport-Security` wird gesetzt, sobald der
Proxy `x-forwarded-proto: https` meldet; im Klartext bleibt der Header aus, sonst
sperrte er die lokale Entwicklung über `http://localhost` aus.

Das Kennwort schützt einen Rasterentrag, keine Identität. Die Oberfläche sagt das
auch so.

## Offene Punkte

[OFFENE-PUNKTE.md](OFFENE-PUNKTE.md).
