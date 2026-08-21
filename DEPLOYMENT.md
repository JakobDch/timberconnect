# TimberConnect Deployment-Anleitung

Diese Anleitung beschreibt die Schritte, um TimberConnect auf dem Server `solid-prototypes` zu deployen.

---

## Übersicht

```
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Repository                                              │
│  github.com/JakobDch/timberconnect                             │
└────────────────┬────────────────────────────────────────────────┘
                 │ Push zu main
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Actions                                                 │
│  Baut Docker Images automatisch                                 │
└────────────────┬────────────────────────────────────────────────┘
                 │ Push Images
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Docker Hub                                                     │
│  jakobdch/timberconnect-viewer                                 │
│  jakobdch/timberconnect-rml-converter                          │
│  jakobdch/timberconnect-epcis                                  │
└────────────────┬────────────────────────────────────────────────┘
                 │ Pull Images
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Server (132.195.160.169)                                       │
│  Zentraler Caddy + TimberConnect Container                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Schritt 1: GitHub Secrets einrichten

1. Gehe zu: https://github.com/JakobDch/timberconnect/settings/secrets/actions

2. Füge diese Secrets hinzu:
   - `DOCKER_USERNAME`: Dein Docker Hub Benutzername (z.B. `jakobdch`)
   - `DOCKER_TOKEN`: Docker Hub Access Token (siehe unten)

### Docker Hub Access Token erstellen:
1. Gehe zu: https://hub.docker.com/settings/security
2. Klicke "New Access Token"
3. Name: `github-actions`
4. Permissions: Read & Write
5. Token kopieren und als `DOCKER_TOKEN` Secret speichern

---

## Schritt 2: Ersten Build triggern

Nach dem Einrichten der Secrets:

```bash
# Lokaler Push (triggert GitHub Actions)
git add .
git commit -m "trigger ci/cd"
git push github main
```

Prüfe den Build-Status unter: https://github.com/JakobDch/timberconnect/actions

---

## Schritt 3: Server vorbereiten

### Per SSH verbinden:
```bash
ssh solid@132.195.160.169
```

### TimberConnect Verzeichnis erstellen:
```bash
mkdir -p ~/timberconnect
cd ~/timberconnect
```

### docker-compose.server.yml herunterladen:
```bash
curl -O https://raw.githubusercontent.com/JakobDch/timberconnect/main/docker-compose.server.yml
```

### .env Datei erstellen:
```bash
nano .env
```

Inhalt:
```
DOCKER_USERNAME=jakobdch
SOLID_ACCESS_TOKEN=
CATALOG_DEFAULT_CONTACT=timberconnect@2050.de
CATALOG_REGISTRATION_ENABLED=true

# EPCIS: Bearer-Token fuer das EECC-EPCAT-Repository.
# ACHTUNG: TC_EPCIS_EPCAT_ENABLED=true schreibt in das echte LIVE-Repo.
# Fuer einen Trockenlauf auf false setzen.
TC_EPCIS_EPCAT_AUTH=Bearer <token>
TC_EPCIS_EPCAT_ENABLED=true
```

---

## Schritt 4: Container starten

```bash
cd ~/timberconnect

# Images von Docker Hub ziehen und starten
docker compose -f docker-compose.server.yml pull
docker compose -f docker-compose.server.yml up -d

# Status prüfen
docker compose -f docker-compose.server.yml ps
```

---

## Schritt 5: Caddyfile ergänzen

Die Domain ist **`timberconnect.tmdt.info`** (→ 132.195.160.169).

### Caddyfile bearbeiten:
```bash
nano ~/solid-css/dataspace/config/Caddyfile
```

### Diesen Block am Ende hinzufügen:
```caddy
timberconnect.tmdt.info {
    # TimberConnect Viewer (Frontend)
    reverse_proxy /timberconnect/* timberconnect-viewer:80

    # TimberConnect RML Converter API
    reverse_proxy /api/converter/* timberconnect-rml-converter:8001

    # TimberConnect EPCIS authorizing proxy
    # (der Dienst verarbeitet das /api/epcis-Praefix selbst)
    reverse_proxy /api/epcis/* timberconnect-epcis:8003

    # DeepSeek-Weiterleitung fuer den Assistenten (same-origin, damit CORS
    # nicht greift; der API-Key des Nutzers laeuft nur durch)
    handle /deepseek/* {
        uri strip_prefix /deepseek
        reverse_proxy https://api.deepseek.com {
            header_up Host api.deepseek.com
        }
    }

    # Default: Redirect to Viewer.
    # WICHTIG: nur exakt "/" umleiten, nicht "/*" — sonst verschluckt der
    # Redirect auch /api/converter/* und /api/epcis/*, und die API-Aufrufe
    # landen auf der Viewer-index.html statt beim Backend.
    redir / /timberconnect/ permanent
}
```

### Caddy neustarten:
```bash
cd ~/solid-css/dataspace
docker compose restart caddy
```

---

## Schritt 6: Verifizierung

### Checkliste
- [ ] GitHub Actions Build erfolgreich (grüner Haken)
- [ ] Images auf Docker Hub sichtbar
- [ ] Container auf Server laufen (`docker ps`)
- [ ] `https://timberconnect.tmdt.info` öffnet sich
- [ ] Frontend lädt korrekt
- [ ] Chat-Agent antwortet
- [ ] API-Routen liefern **nicht** die Viewer-HTML:
      `curl -sL -o /dev/null -w "%{url_effective}\n" https://timberconnect.tmdt.info/api/converter/pdf-templates`
      muss auf der API-URL enden, nicht auf `/timberconnect/`

### Befehle zur Diagnose:
```bash
# Container-Status
docker compose -f docker-compose.server.yml ps
docker compose -f docker-compose.server.yml logs -f

# Netzwerk prüfen
docker network inspect solid-dataspace

# Caddy-Logs
cd ~/solid-css/dataspace && docker compose logs caddy
```

---

## Aktualisierung (nach Code-Änderungen)

Nach einem Push zu GitHub werden die Images automatisch neu gebaut.

Auf dem Server dann:
```bash
cd ~/timberconnect
docker compose -f docker-compose.server.yml pull
docker compose -f docker-compose.server.yml up -d
```

---

## Troubleshooting

### Problem: "Network solid-dataspace not found"
```bash
docker network create solid-dataspace
```

### Problem: Container kann andere nicht erreichen
Prüfe ob alle Container im gleichen Netzwerk sind:
```bash
docker network inspect solid-dataspace
```

### Problem: Caddy zeigt 502 Bad Gateway
Container-Namen stimmen nicht mit Caddyfile überein. Prüfe:
```bash
docker ps --format "{{.Names}}"
```

### Problem: GitHub Actions Build fehlgeschlagen
1. Prüfe die Logs unter https://github.com/JakobDch/timberconnect/actions
2. Stelle sicher, dass DOCKER_USERNAME und DOCKER_TOKEN korrekt sind

---

## Wichtige Pfade

| Was | Pfad auf Server |
|-----|-----------------|
| TimberConnect | `~/timberconnect/` |
| Caddyfile | `~/solid-css/dataspace/config/Caddyfile` |
| Caddy Docker Compose | `~/solid-css/dataspace/docker-compose.yml` |

---

## Kontakt bei Problemen

- Repository Issues: https://github.com/JakobDch/timberconnect/issues
