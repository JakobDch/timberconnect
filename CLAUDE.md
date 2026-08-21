# TimberConnect — solid-dataspace

## Die Anwendung läuft über Docker

**Niemals `npm run dev` starten.** Der komplette Stack läuft als Compose-Projekt;
der Vite-Dev-Server ist nicht der Weg, auf dem diese App betrieben oder
angeschaut wird. Alles läuft hinter Caddy auf **Port 80**.

**Die App öffnen:** <http://localhost/timberconnect/>
(`/` leitet permanent dorthin um; der Vite-`base` ist `/timberconnect/`.)

### Änderungen am Viewer sichtbar machen

Der Viewer ist ein **Production-Build im nginx-Image** — es gibt kein Hot
Reload. Nach jeder Code-Änderung im Viewer:

```bash
docker compose build timberconnect-viewer
docker compose up -d timberconnect-viewer
```

Erst danach ist die Änderung unter <http://localhost/timberconnect/> zu sehen.
Wird das vergessen, zeigt der Browser weiterhin den alten Build — das sieht aus
wie „die Änderung wirkt nicht", ist aber nur das alte Image.

Gilt genauso für die Python-Services (`timberconnect-rml-converter`,
`timberconnect-epcis`) — auch die werden aus lokalen Quellen gebaut.

### Gesamten Stack starten / stoppen

```bash
docker compose up -d       # alles hochfahren
docker compose ps          # Status
docker compose logs -f timberconnect-viewer
docker compose down        # alles stoppen
```

Das externe Netzwerk `solid-dataspace` muss existieren:
`docker network create solid-dataspace`

## Services und Routen

| Service | Port (intern) | Route über Caddy |
|---|---|---|
| `timberconnect-viewer` | 80 | `/timberconnect/*` |
| `timberconnect-rml-converter` | 8001 | `/api/converter/*` |
| `timberconnect-epcis` | 8003 | `/api/epcis/*` |

8001 und 8003 sind über `docker-compose.override.yml` zusätzlich auf dem Host
veröffentlicht — praktisch zum direkten `curl`-Test der Backends, z.B.
`curl http://localhost:8001/api/converter/pdf-templates`.

Dazu kommt die Route `/deepseek/*`, die auf `https://api.deepseek.com`
weiterleitet. Sie hat keinen eigenen Dienst: der Assistent („Sprich mit deinem
Bauteil") läuft vollständig im Browser, weil nur dort die authentifizierte
Solid-Session und Comunica verfügbar sind. Über die eigene Herkunft zu gehen
erspart die Frage, ob DeepSeek CORS-Header schickt.

Der frühere `timberconnect-agent` (Port 8002) ist entfallen — er führte nie
echte SPARQL-Abfragen aus, sondern durchsuchte den erzeugten Query-String nach
Stichwörtern. Sein Nachfolger liegt in
`timberconnect-viewer/src/services/agent/`.

## Die vier Compose-Dateien

- **`docker-compose.yml`** — die Basis. Referenziert für den Viewer das
  Docker-Hub-Image `deich302/timberconnect-viewer:latest`.
- **`docker-compose.override.yml`** — greift lokal **automatisch** zusätzlich.
  Baut den Viewer aus lokalen Quellen als `timberconnect-viewer:local` (statt
  das Hub-Image zu ziehen) und veröffentlicht 8001/8003 auf dem Host. Deshalb
  landen lokale Änderungen im Stack, ohne dass etwas gepusht werden muss.
- **`docker-compose.server.yml`** — nur für den Produktionsserver, wo Caddy
  bereits zentral läuft. Lokal nicht verwenden.
- **`docker-compose_live.yml`** — Live-Deployment.

## Konfiguration

Secrets und Umgebungsvariablen kommen aus `.env` (Vorlage: `.env.example`).
Nie committen — insbesondere `TC_EPCIS_EPCAT_AUTH` (Bearer-Token für das
EECC-EPCAT-Repository) und `SOLID_ACCESS_TOKEN`.

`TC_EPCIS_EPCAT_ENABLED=true` bedeutet: Captures gehen an das **echte
LIVE-EECC-Repository**. Für einen Trockenlauf auf `false` setzen.

## Prüfen ohne Browser

```bash
# Läuft die App?
curl -s -o /dev/null -w "%{http_code}" http://localhost/timberconnect/

# Enthält der ausgelieferte Build wirklich die Änderung?
curl -s http://localhost/timberconnect/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
curl -s http://localhost/timberconnect/assets/index-<hash>.js | grep -c "<suchbegriff>"
```

Der zweite Schritt ist der verlässliche Nachweis, dass der Rebuild tatsächlich
gegriffen hat.

## Viewer — Typecheck vor dem Build

```bash
cd timberconnect-viewer && npx tsc --noEmit -p tsconfig.app.json
```

Schneller als ein voller Docker-Build und findet Typfehler früher. Der
Docker-Build führt `tsc -b && vite build` ohnehin aus und schlägt bei
Typfehlern fehl.
