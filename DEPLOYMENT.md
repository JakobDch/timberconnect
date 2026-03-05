# TimberConnect Deployment-Anleitung

Diese Anleitung beschreibt die Schritte, um TimberConnect auf einem eigenen Server öffentlich zugänglich zu machen.

---

## Voraussetzungen

### Server-Anforderungen
- **Betriebssystem**: Ubuntu 22.04 LTS (empfohlen) oder anderes Linux
- **CPU**: Mindestens 4 Kerne
- **RAM**: Mindestens 8 GB
- **Speicher**: Mindestens 50 GB SSD
- **Netzwerk**: Öffentliche IP-Adresse

### Zugang
- SSH-Zugang zum Server (root oder sudo-Berechtigungen)
- Zugang zur DNS-Verwaltung (für Subdomain)

---

## Schritt 1: Server beantragen

### Bei Uni-IT
1. Server-Antrag stellen mit folgenden Angaben:
   - Zweck: "TimberConnect Web-Anwendung"
   - Anforderungen: 4 CPU, 8GB RAM, 50GB SSD, Ubuntu 22.04
   - Ports: 80 (HTTP), 443 (HTTPS), 22 (SSH)
   - Öffentliche IP benötigt

2. Nach Bereitstellung notieren:
   - Server-IP: `_______________`
   - SSH-Benutzer: `_______________`

---

## Schritt 2: Domain/DNS einrichten

### Subdomain beantragen
1. Bei Uni-IT oder Domain-Administrator anfragen:
   - Gewünschte Subdomain: z.B. `timberconnect.tmdt.info`
   - Typ: A-Record
   - Ziel: Server-IP-Adresse

2. DNS-Eintrag prüfen (kann bis zu 24h dauern):
   ```bash
   nslookup timberconnect.tmdt.info
   ```

---

## Schritt 3: Server einrichten

### 3.1 Per SSH verbinden
```bash
ssh benutzer@server-ip
```

### 3.2 System aktualisieren
```bash
sudo apt update && sudo apt upgrade -y
```

### 3.3 Docker installieren
```bash
# Docker installieren
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Benutzer zur Docker-Gruppe hinzufügen
sudo usermod -aG docker $USER

# Ausloggen und wieder einloggen, damit Gruppe aktiv wird
exit
```

Nach erneutem Login prüfen:
```bash
docker --version
docker compose version
```

### 3.4 Git installieren (falls nicht vorhanden)
```bash
sudo apt install git -y
```

---

## Schritt 4: Firewall konfigurieren

```bash
# UFW aktivieren und Ports öffnen
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# Status prüfen
sudo ufw status
```

---

## Schritt 5: Anwendung deployen

### 5.1 Repository klonen
```bash
cd /opt
sudo git clone <REPOSITORY-URL> timberconnect
sudo chown -R $USER:$USER timberconnect
cd timberconnect
```

### 5.2 Docker-Netzwerk erstellen
```bash
docker network create solid-dataspace
```

### 5.3 Environment-Datei erstellen
```bash
cp .env.example .env
nano .env
```

**Wichtige Einstellungen in `.env`:**
```
# Deine Domain (WICHTIG!)
DOMAIN=timberconnect.tmdt.info

# Sichere Passwörter setzen (Passwörter generieren z.B. mit: openssl rand -base64 32)
MYSQL_ROOT_PASSWORD=<sicheres-passwort>
MYSQL_PASSWORD=<sicheres-passwort>
FUSEKI_ADMIN_PASSWORD=<sicheres-passwort>
```

### 5.4 Container starten
```bash
docker compose up -d --build
```

### 5.5 Logs prüfen
```bash
# Alle Logs
docker compose logs -f

# Nur Caddy (für HTTPS-Zertifikat)
docker compose logs -f caddy
```

---

## Schritt 6: Verifizierung

### Checkliste
- [ ] `https://timberconnect.tmdt.info` öffnet sich im Browser
- [ ] Kein Zertifikats-Fehler (grünes Schloss)
- [ ] Frontend lädt korrekt
- [ ] QR-Scanner funktioniert
- [ ] Chat-Agent antwortet

### Befehle zur Diagnose
```bash
# Container-Status
docker compose ps

# HTTPS-Zertifikat prüfen
curl -I https://timberconnect.tmdt.info

# Einzelne Services testen
curl https://timberconnect.tmdt.info/timberconnect/
curl https://timberconnect.tmdt.info/api/converter/health
```

---

## Troubleshooting

### Problem: HTTPS-Zertifikat wird nicht ausgestellt

**Mögliche Ursachen:**
1. DNS noch nicht propagiert → `nslookup domain` prüfen
2. Port 80 blockiert → Firewall prüfen
3. Domain falsch in .env → DOMAIN Variable prüfen

**Lösung:**
```bash
# Caddy neustarten
docker compose restart caddy

# Logs prüfen
docker compose logs caddy
```

### Problem: Container startet nicht

```bash
# Detaillierte Logs anzeigen
docker compose logs <service-name>

# Container manuell starten für Debug
docker compose up <service-name>
```

### Problem: "Network solid-dataspace not found"

```bash
docker network create solid-dataspace
docker compose up -d
```

### Problem: Port bereits belegt

```bash
# Prüfen was Port 80/443 nutzt
sudo lsof -i :80
sudo lsof -i :443

# Anderen Webserver stoppen falls nötig
sudo systemctl stop apache2
sudo systemctl stop nginx
```

---

## Wartung

### Container aktualisieren
```bash
cd /opt/timberconnect
git pull
docker compose up -d --build
```

### Logs rotieren
Docker rotiert Logs automatisch. Für manuelle Bereinigung:
```bash
docker system prune -f
```

### Backup
```bash
# Caddy-Zertifikate sichern
docker cp reverse-proxy:/data ./backup/caddy_data
```

---

## Wichtige Pfade

| Was | Pfad auf Server |
|-----|-----------------|
| Anwendung | `/opt/timberconnect/` |
| Environment | `/opt/timberconnect/.env` |
| Caddyfile | `/opt/timberconnect/Caddyfile` |
| Docker Compose | `/opt/timberconnect/docker-compose.yml` |

---

## Kontakt bei Problemen

- Repository Issues: `<REPOSITORY-URL>/issues`
- Uni-IT Support: (für Server/Netzwerk-Probleme)
