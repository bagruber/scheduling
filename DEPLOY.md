# Deploy auf Coolify

Die App ist ein einzelner Container: ein Node-Prozess serviert das gebaute
Frontend aus `dist/` **und** die API unter `/api`. Gebaut wird über das
[`Dockerfile`](Dockerfile) im Repo-Wurzelverzeichnis, Coolify baut bei jedem
Push auf `main` neu.

Das Repo ist domainfrei — die Domain steht nur in Coolify, nirgends im Code.
`fresh.bayern` ist also nur *ein* mögliches Ziel, kein eingebautes.

## 1. Resource anlegen

Neue Resource → **Application** → Quelle: Repo `bagruber/scheduling`.

| Einstellung        | Wert         |
| ------------------ | ------------ |
| **Build Pack**     | `Dockerfile` |
| **Base Directory** | `/`          |
| **Dockerfile**     | `Dockerfile` |
| **Port**           | `8080`       |

Domain eintragen (z. B. `termine.fresh.bayern`), TLS/Let's-Encrypt aktivieren.
Die Hauptseite von fresh.bayern bleibt davon unberührt: das ist eine eigene
Application mit eigenem Container, kein Grav-Plugin.

## 2. Persistent Storage (WICHTIG)

Ohne dieses Volume sind bei **jedem** Redeploy alle Termine weg. Unter
*Storages* anlegen (Typ: Volume Mount):

| Mount Path | Zweck                                       |
| ---------- | ------------------------------------------- |
| `/data`    | SQLite-Datei mit Terminen und Einträgen (PII!) |

Der Pfad ist über `DATA_DIR` konfigurierbar, Standard ist `/data`. Beim ersten
Start legt der Container Schema und Datei selbst an.

Es gilt dieselbe Grundregel wie bei `fresh-redesign`: jeder Pfad hat *einen*
Besitzer. `/data` gehört der Live-Instanz, alles andere kommt aus Git.

## 3. Umgebungsvariablen

| Variable   | Standard  | Bedeutung                          |
| ---------- | --------- | ---------------------------------- |
| `PORT`     | `8080`    | Port, auf dem der Server lauscht   |
| `DATA_DIR` | `/data`   | Verzeichnis für `scheduling.db`    |

Keine Secrets, keine API-Keys — es gibt keine externen Dienste.

## Sicherung

Die gesamte Datenlage ist eine Datei. Sichern heißt:

```bash
docker exec <container> sh -c 'cd /data && sqlite3 scheduling.db ".backup /data/backup.db"'
```

Oder simpler: das Volume snapshotten, wenn Coolify das anbietet. Wegen WAL
sollten `scheduling.db-wal` und `-shm` mitkopiert werden, wenn im laufenden
Betrieb kopiert wird.

## Troubleshooting

- **Build schlägt fehl:** Coolify-Build-Log prüfen. Häufigste Ursache ist eine
  Lockfile-Abweichung — `pnpm install --frozen-lockfile` bricht dann ab.
- **„Kein Build vorhanden"** im Browser: `dist/` fehlt im Image, also ist Stage 1
  durchgelaufen, aber der `COPY --from=build` hat nichts gefunden.
- **Termine nach Redeploy weg:** `/data` ist nicht als Volume gemountet.
- **Alles nach jedem Neustart leer, Volume ist aber da:** Rechte. Das Volume
  gehört dem Host, der Container läuft als `node` (UID 1000).

## Lokal

```bash
pnpm install
pnpm build          # dist/ erzeugen
pnpm start          # Server auf http://localhost:8080

# oder zum Entwickeln, in zwei Terminals:
pnpm dev:api        # API auf :8080
pnpm dev            # Vite auf :5173, proxied /api
```
