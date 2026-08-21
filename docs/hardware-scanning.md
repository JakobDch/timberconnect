# Hardware-Scanner: RFID, DotCode und Barcode

Wie die Zebra-Geräte an die App angebunden sind, wie sie eingerichtet werden
und wie ohne Hardware getestet wird.

## Die Geräte

| | **TC22R** (TC2205) | **EM45** (EM45B1, Europa) |
|---|---|---|
| Bauform | Handheld mit Pistolengriff | robustes Smartphone |
| 2D-Imager | ja, oberer Auslöser | **nein** |
| UHF-RFID | ja, unterer Auslöser | **nein** |
| Kamera-Scan | ja | ja, programmierbare Taste links |
| DotCode | ja (Imager) | **nein** — siehe unten |

Beide laufen Android und bringen Zebras **DataWedge** mit.

## Die Erfassung in der App

Es gibt genau **einen** Weg: „Bauteil erfassen". Dort landet sowohl ein
Geräte-Scan als auch eine getippte ID. Zwei Betriebsarten, umschaltbar im
Dialog (die Wahl wird gemerkt):

- **Sofort suchen** (Standard) — ein Scan löst die Suche unmittelbar aus, ohne
  Enter. Erkannt wird er an der Tippgeschwindigkeit.
- **Vorher prüfen** — der Scan landet im Feld und wird erst auf Knopfdruck
  gesucht. Für manuelle Eingabe oder wenn man die ID vorher sehen will.

Ein Kamera-/QR-Scanner ist bewusst **nicht** vorhanden: im Projekt werden keine
QR-Codes verwendet, das Scannen übernehmen die Geräte, und die Kamera bräuchte
zusätzlich HTTPS.

## Wie der Scan in die App kommt

Über **Tastatur-Emulation**: DataWedge tippt die gelesene ID zeichenweise in die
Seite und schließt mit Enter ab. Für eine Web-App ist das der einzig gangbare
Weg — einen Android-Intent kann eine Seite im Browser nicht empfangen; dafür
bräuchte es eine eigene Android-App als Hülle.

Drei Vorteile:

- **Ein Code-Weg für beide Geräte** — TC22R-Imager, TC22R-RFID und
  EM45-Kamerascan liefern identisch.
- **Der einzige Weg zu DotCode**, weil nur der Hardware-Decoder das Format kann.
- **Funktioniert über einfaches HTTP** — kein Zertifikat nötig.

Erkannt wird ein Scan an der Geschwindigkeit: ein Scanner liefert die Zeichen
mit unter 50 ms Abstand, ein Mensch nicht. Deshalb funktioniert der Auslöser aus
jeder Ansicht heraus, ohne dass ein Eingabefeld den Fokus haben muss.
(Code: [useHardwareScan.ts](../timberconnect-viewer/src/hooks/useHardwareScan.ts))

## DataWedge einrichten

Auf **beiden** Geräten, einmalig. Kein Code, reine Geräteeinstellung.

1. **DataWedge** öffnen → neues Profil `TimberConnect` anlegen.
2. **Associated apps**: Chrome (`com.android.chrome`), Activity `*`.
3. **Barcode input**: aktivieren.
   - Decoders: **QR**, **DataMatrix**, **Code 128**, **GS1-128**, **GS1 DataMatrix**
   - **DotCode ausdrücklich einschalten** — ab Werk **aus**. Das ist die
     häufigste Ursache für „scannt nicht".
   - Wenn vorhanden: *Send AIM identifier* aktivieren. Dann kommt `]d2`/`]C1`
     mit; die App wertet das aus und weiß dadurch sicher, dass GS1-Kennungen
     folgen.
4. **RFID input** (nur TC22R): aktivieren, *Report unique tags only* = **an**,
   einen Trigger-Timeout setzen, damit ein Sweep endet.
5. **Keystroke output**: aktivieren.
   - **Suffix: ENTER**
   - **Inter-character delay: 0 ms** — ein Wert > 0 zerstört die Burst-Erkennung.

### Kurzprüfung ohne die App

Ein beliebiges Textfeld auf dem Gerät öffnen (z. B. Notizen) und scannen. Es
muss die ID erscheinen und der Cursor in die nächste Zeile springen. Klappt das
nicht, liegt es am DataWedge-Profil, nicht an der App.

## Die Scan-Formate

Dieselbe ID erreicht die App je nach Träger anders:

| Träger | Beispiel |
|---|---|
| Barcode | `010404711140592421123456789101` |
| DotCode | `01040471114510062112A3D4567` |
| RFID | `301134C52500941CBE991A6D` |
| manuell | `urn:epc:id:sgtin:404711145.0100.12A3D4567` |

Die App übersetzt alle Formen in die kanonische Form
`urn:epc:id:sgtin:<präfix>.<artikel>.<serie>`.

### Warum der GTIN nicht einfach aufgeteilt wird

Die App braucht Firmenpräfix und Artikelnummer getrennt. Aus einem Barcode ist
diese Grenze **nicht ableitbar**: `404711140592` lässt sich als
`40471114` + `00592` oder als `404711140` + `0592` lesen. Beim RFID-Tag steht
die Grenze im Partition-Feld, beim Barcode nicht.

Deshalb wird **nicht geraten**. Die App bildet alle plausiblen Lesarten und
prüft, welche im Datenbestand existiert. Findet sich keine, lautet die Meldung
konkret „GTIN …, Serie … — kein Bauteil gefunden" statt eines irreführenden
„ID ungültig".

Das ist keine Theorie: der 8-stellige Präfix `40471114` aus dem Barcode-Muster
weicht von allen bisherigen Demo-Daten ab, die durchweg 9-stellig sind.

## Testen ohne Hardware

### Automatische Tests

```bash
cd timberconnect-viewer && npm test
```

Prüft die Erkennung gegen alle Idente aus
[demo-dateien/tools/ids.json](../demo-dateien/tools/ids.json) (beide
Schreibweisen liegen dort nebeneinander), gegen die drei echten Scanner-Muster
und gegen die Burst-Erkennung. Wichtig darunter: von Hand getippter Text darf
**keinen** Scan auslösen.

### Im Browser

„Bauteil erfassen" öffnen und eine ID von Hand eintippen oder einfügen — die
Live-Vorschau unter dem Feld zeigt sofort, welche ID erkannt wurde.

### Auf dem Gerät

Die App ist im lokalen Netz unter `http://<LAN-IP>/timberconnect/` erreichbar
(Caddy hört auf allen Schnittstellen). **Die Tastatur-Emulation braucht kein
HTTPS** — Barcode und RFID funktionieren sofort.

Über einfaches HTTP **nicht** verfügbar: der Solid-Login (braucht eine
gesicherte Verbindung). Scannen und Suchen funktionieren ohne ihn.

Für die vollständige Demo mit Login danach HTTPS über Caddys eingebaute
Zertifizierungsstelle (`tls internal` mit einem Hostnamen, Wurzelzertifikat auf
den Geräten installieren).

Damit die App über die LAN-IP überhaupt ausgeliefert wird, muss `LAN_HOST` in
der `.env` auf die IP des Rechners zeigen — sonst antwortet Caddy mit einer
leeren Seite, weil es nur `DOMAIN` bedient. Der HSTS-Header geht bewusst nur an
`TLS_HOST`: über die LAN-IP würde er Chrome zwingen, den Host dauerhaft nur per
HTTPS anzusprechen, und die Seite wäre nicht mehr erreichbar.

**Zum EPCAT-Repo:** Beim Scannen wird nur **gelesen** — das verändert nichts.
Neue Events entstehen ausschließlich beim Hochladen von Dateien.

## Etiketten drucken (ZebraDesigner / ZT411)

- **Jedes Etikett braucht einen GS1-DataMatrix.** Das EM45 hat keinen Imager und
  kann DotCode nicht lesen; ohne DataMatrix funktioniert das Etikett nur auf dem
  TC22R.
- Inhalt: der GS1-Elementstring, also die `gs1`-Werte aus `ids.json` direkt
  verwenden.
- In ZebraDesigner die Symbologie **GS1 DataMatrix** wählen — nicht einfach
  `(01)…` in einen gewöhnlichen DataMatrix tippen. Sonst fehlt die
  FNC1-Kennung und die App darf den Inhalt nicht als GS1 deuten.
- Den Elementstring zusätzlich als **Klartext** aufs Etikett drucken. Das ist
  die Rückfallebene über die manuelle Eingabe und beim Fehlersuchen Gold wert.
- Zwei, drei **DotCode**-Etiketten zusätzlich, um den TC22R-Imager zu prüfen.

## Wenn etwas nicht funktioniert

| Symptom | Ursache |
|---|---|
| DotCode wird nicht gelesen | Decoder im DataWedge-Profil nicht aktiviert (ab Werk aus) |
| Nichts passiert beim Scannen | Keystroke-Suffix ENTER fehlt, oder Profil nicht mit Chrome verknüpft |
| Zeichen landen im Textfeld statt als Scan | Inter-character delay > 0 ms |
| „kein Bauteil gefunden" trotz korrektem Scan | Scan war in Ordnung, zum Ident gibt es keine Events — die Meldung nennt GTIN und Serie |
| DotCode auf dem EM45 | Gerät hat keinen Imager — DataMatrix verwenden |
| Scan landet im Feld, sucht aber nicht | Betriebsart steht auf "Vorher prüfen" |
