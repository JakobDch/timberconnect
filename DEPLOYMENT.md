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
│  jakobdch/timberconnect-agent                                  │
│  jakobdch/timberconnect-rml-converter                          │
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

## Schritt 5: Caddyfile ergänzen (sobald Domain da ist)

### Caddyfile bearbeiten:
```bash
nano ~/solid-css/dataspace/config/Caddyfile
```

### Diesen Block am Ende hinzufügen:
```caddy
timberconnect-tmdt.info {
    # TimberConnect Viewer (Frontend)
    reverse_proxy /timberconnect/* timberconnect-viewer:80

    # TimberConnect RML Converter API
    reverse_proxy /api/converter/* timberconnect-rml-converter:8001

    # TimberConnect Chat Agent
    handle /timberconnect-agent/* {
        uri strip_prefix /timberconnect-agent
        reverse_proxy timberconnect-agent:8002
    }

    # Default: Redirect to Viewer
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
- [ ] `https://timberconnect-tmdt.info` öffnet sich
- [ ] Frontend lädt korrekt
- [ ] Chat-Agent antwortet

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
