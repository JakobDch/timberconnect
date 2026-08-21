# Testanleitung: Rollenbasiertes Zugriffsmanagement

Diese Anleitung führt durch das lokale Testen der RBAC-Features (Rollen, WAC-ACLs,
EPCIS-Consent-Proxy). Stand: alle Slices implementiert.

## Was läuft wo

| Dienst | Port | Start | Zweck |
|---|---|---|---|
| Viewer (UI) | `5173` | `npm run dev` im `timberconnect-viewer/` | React-App, Login, Rollen-UI |
| rml-converter | `8001` | Docker | Konvertierung, Katalog-Registrierung |
| EPCIS-Proxy | `8003` | Docker | role+consent-gegatete EPCIS-Events |

Der Vite-Dev-Server proxyt `/api/converter`→8001 und `/api/epcis`→8003 automatisch.

## Starten

```powershell
# 1. Backends (rml-converter + epcis) — aus dem Projekt-Root
docker compose up -d timberconnect-epcis timberconnect-rml-converter

# 2. Viewer-Dev-Server — im timberconnect-viewer/-Verzeichnis
cd timberconnect-viewer
npm run dev
```

App öffnen: **http://localhost:5173/timberconnect/**

> Nach Code-Änderungen an den Python-Services: `docker compose build <service>` dann
> `docker compose up -d <service>`. Der Viewer lädt Änderungen per Hot-Reload selbst.

---

## Test 1 — Erstlogin-Rollenerfassung (UI)

1. In der App oben rechts **„Anmelden"** → deinen Solid Pod wählen → einloggen.
2. **Beim ersten Login** mit einem Pod, der noch keine Rolle hat, erscheint das
   **Rollen-Setup-Modal**. Wähle z.B. „Sägewerk" → **„Rolle bestätigen"**.
3. Erwartung: Das Modal speichert die Rolle in deinem Pod und schließt sich.

**Prüfen, dass es im Pod landete** (ersetze `<POD>` mit deiner Pod-Basis-URL):

```powershell
curl "https://<POD>/profile/role.ttl" -H "Accept: text/turtle"
```
→ sollte ein Triple `<deineWebId> tc:hasRole tc:Saegewerk` enthalten.

Im User-Menü (oben rechts) wird die Rolle jetzt als Badge angezeigt.

---

## Test 2 — Zugriffs-Policy bearbeiten (UI)

1. User-Menü → **„Zugriff verwalten"**.
2. Wähle, welche Rollen deine Daten lesen dürfen (z.B. Sägewerk + BSP-Werk) → **„Speichern"**.
3. Erwartung: Schreibt `access/role-policy.ttl` (public-read), materialisiert
   `access/groups/<rolle>.ttl` aus dem Föderations-Register, und spiegelt die
   Liste in `access/epcis-consent.ttl`.

**Prüfen:**
```powershell
curl "https://<POD>/access/role-policy.ttl"   -H "Accept: text/turtle"
curl "https://<POD>/access/epcis-consent.ttl" -H "Accept: text/turtle"
```
→ beide listen die erlaubten Rollen via `tc:allowsRole`.

---

## Test 3 — Upload mit WAC-Schutz (UI + curl)

1. Im Viewer eine Datei hochladen (Forst/.hpr, Sägewerk/.eldat …) während eingeloggt.
2. Erwartung: Daten landen unter `…/epcisrepository/data/<id>/` (NICHT mehr `public/`),
   und die Container-ACL wird gestampft (Owner Control, erlaubte Rollen-Gruppen Read).

**WAC-Durchsetzung prüfen** — das ist das eigentliche Sicherheits-Orakel.
Hole die hochgeladene TTL-URL aus der Browser-Konsole (`[upload] Stamped ACL on …`):

```powershell
# (a) Als Owner: mit deinem Token -> sollte 200 + Wac-Allow user="read..."
#     (Token-Tests siehe Test 4)
# (b) Anonym/ohne Token: sollte 401/403, NICHT mehr 200
curl -I "https://<POD>/data/<id>/<datei>.ttl"
```
→ Achte auf den `Wac-Allow`-Header: bei geschützten Daten ist `public=""` (leer),
nicht mehr `public="read"`.

---

## Test 4 — EPCIS-Proxy (role + consent)

Der Proxy läuft auf 8003 und ist über `/api/epcis` aus dem Viewer erreichbar.

### 4a. Ohne Auth — wird abgewiesen (schon verifiziert)
```powershell
curl -X POST http://localhost:8003/api/epcis/events `
  -H "Content-Type: application/json" -d '{}'
```
→ `401 {"detail":"Missing Authorization header"}` ✓
Ein gefälschtes Token → `401 {"detail":"Malformed token: …"}` ✓

### 4b. Mit echtem Solid-Token
Der Viewer sendet das Token automatisch über `session.fetch`. Am einfachsten testest
du das **aus der App heraus** (Browser-Konsole, eingeloggt):

```js
// In der DevTools-Konsole auf http://localhost:5173/timberconnect/
const { queryEpcisEvents } = await import('/timberconnect/src/services/epcisService.ts');
console.log(await queryEpcisEvents());            // alle für deine Rolle erlaubten Events
console.log(await queryEpcisEvents('urn:epc:id:sgtin:4047111124.015.…')); // gefiltert nach EPC
```

Erwartung im Ergebnis-Objekt:
- `authEnforced: true`, `callerRole: "…Saegewerk"`
- `returned` ≤ `totalBeforeFilter` — `filteredOut` zeigt, wie viele Events die
  Consent-Prüfung entfernt hat.

### 4c. Consent-Effekt zeigen
1. In „Zugriff verwalten" die Rolle des Abfragenden **entziehen** → speichern.
2. `queryEpcisEvents()` erneut → die betroffenen Events fallen weg (`filteredOut` steigt).
3. Rolle wieder **erlauben** → Events erscheinen wieder.

### Open-Demo-Modus (optional)
Zum Vorführen ohne Token-Handling:
```powershell
docker compose stop timberconnect-epcis
$env:TC_EPCIS_AUTH_REQUIRED="false"; docker compose up -d timberconnect-epcis
```
→ `/events` läuft dann ohne Auth und ohne Consent-Filter (`auth_enforced: false`).
**Nur für Demos** — danach wieder auf `true` setzen.

---

## Schnelle Gesundheitschecks

```powershell
curl http://localhost:8003/api/epcis/health          # EPCIS-Service
curl http://localhost:8001/api/converter/mappings    # Konverter
curl -I http://localhost:5173/timberconnect/         # Viewer-UI
```

## Bekannte Grenzen (bewusst, für die Demo)
- **DPoP-Proof** wird im Proxy nicht geprüft (nur Token-Signatur + WebID). Ein
  abgefangenes Token wäre bis zum Ablauf nutzbar. Härtung für Produktion.
- **Legacy `public/`-Daten** bleiben öffentlich lesbar, bis sie nach `data/` migriert
  und `public/` abgeriegelt wird. Pods ohne `role-policy.ttl` gelten als public.
