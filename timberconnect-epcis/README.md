# TimberConnect EPCIS Service

Generiert GS1-EPCIS-Idente (SGTIN / LGTIN) und EPCIS-2.0-Events aus Roh-Holzdaten
und leitet die Events an das EECC-EPCAT-Repository weiter. Kapselt das vom EECC
gelieferte `timber-event` (Bash, vormals `serial-import.sh`) samt
Laufzeit-Abhängigkeiten in einem eigenen Container.

## Was es tut

1. Nimmt eine Rohdatei entgegen (siehe Format-Treiber unten).
2. Ruft `scripts/timber-event` auf, das die Idente **direkt aus dem Dokument**
   ableitet.
3. Extrahiert die Idente robust per Regex und baut ein **valides** EPCIS-2.0-JSON-LD
   Document (siehe `services/serial_import.py`). Das Skript selbst liefert
   **kein gültiges JSON** — nach dem `@context`-Array fehlt das Komma (Stand
   08.08.2026, an das EECC gemeldet); deshalb wird das Dokument hier neu gebaut.
4. Holt Dokumenten-Identität und Transaktions-ID über die dedizierten Skript-Modi
   `--hash` bzw. `--tractid` — nicht per Regex aus dem erzeugten Event.
   Wichtig, weil die Identität nicht zwingend ein Hash ist: ELDAT definiert das
   `idpattern` `%n_%.%s` (Segment `<name>_<hash>.eldat`), und die
   JSON-Treiber verwenden eine Dokumentennummer aus der Datei selbst.
5. Sendet das Document optional an das EPCAT-Repo (`POST {base}/capture`).

### Format-Treiber (Stand `timber-event` vom 10.08.2026)

Jeder Treiber liegt als `scripts/<format>/timber-event.shar` (+ `.properties`).
Der Aufruf übergibt **immer** `--form=<format>` explizit: drei Treiber
verarbeiten `.json`, die Dateiendung allein identifiziert das Format also nicht.
Die Zuordnung `data_type` → Treiber steht in `FORMAT_FOR_TYPE`
(`services/serial_import.py`).

| `data_type` | Treiber | Dokument | Event | Identität aus |
|---|---|---|---|---|
| `stammzertifikat` | `seed` | Stammzertifikat (PDF→JSON) | ObjectEvent, `creating_class_instance` | `fields.zertifikatNr` |
| `forst` | `hpr` | StanForD-Harvester-Protokoll | ObjectEvent, `commissioning` | SHA-1 (C14N) |
| `saegewerk` | `eldat` | KWF-Transportprotokoll | ObjectEvent, `commissioning` | SHA-1 + `idpattern` |
| `leistungserklaerung` | `sawdecl` | Leistungserklärung (PDF→JSON) | **TransformationEvent** | `fields.nr` |
| `herstellung`, `bspwerk` | `module` | ERP-Auszug BSP (Excel→JSON) | **TransformationEvent** | `product.auftrag` + `produktnorm` |

**HPR mit eingebetteten Identen:** Findet der Treiber nach einem `LogKey` ein
`<Identity type="http://stanford.org/gs1/urn">`, übernimmt er die aufgedruckte
SGTIN. Fehlt es, erzeugt er wie bisher eine synthetische Seriennummer
`S<session>T<stem>L<log>` aus `--gcp`/`--item`.

**LGTIN-Form:** Der `eldat`-Treiber liefert `urn:epc:id:lgtin:…`; beim Parsen
wird auf die TDS-konforme `urn:epc:class:lgtin:`-Form normalisiert, OpenEPCIS
lehnt die id-Form ab. Die JSON-Treiber reichen durch, was im Dokument steht.

**TransformationEvents** tragen `inputEPCList`/`inputQuantityList` (verbrauchtes
Vormaterial) und `outputEPCList`/`outputQuantityList` (Erzeugnis). Sie werden
bewusst **nicht** auf mehrere Events aufgeteilt (anders als große ObjectEvents):
Die Input→Output-Beziehung ist genau das, was das Produkt auf sein Vormaterial
zurückführbar macht — eine Aufteilung würde diese Verknüpfung zerreißen.

> **Laufzeit-Abhängigkeiten sind identitätsrelevant:** die Kanonisierer
> `xmllint` (.hpr) und `jq` (.eldat) werden im Skript mit unterdrücktem stderr
> aufgerufen. Fehlt eines der Werkzeuge, liefert das Skript still den
> Leer-Hash `da39a3ee…` für *jedes* Dokument. Der Wrapper erkennt diesen Fall
> und bricht mit einer Fehlermeldung ab, statt eine falsche Identität zu
> vergeben.

> **Der Hash ist nur bei gleicher `xmllint`-Version reproduzierbar**
> (verifiziert 2026-07-30). Bei einer `.hpr`-Datei mit CRLF-Zeilenenden
> entfernt libxml2 2.9.14 (dieses Image) die CR aus der `--c14n`-Ausgabe,
> während 2.12.10 (Strawberry Perl unter Windows) sie durchreicht — keine der
> beiden maskiert sie spec-konform als `&#xD;`. Dieselbe Datei ergibt damit je
> nach Umgebung zwei verschiedene Hashes (`1417f5bd…` im Container vs.
> `24577413…` auf dem Windows-Host). **Konsequenz:** Dokument-Identitäten
> immer im Container bestimmen, nie auf einem Entwicklungsrechner. Für den
> Austausch mit Partnern ist die `libxml2`-Version Teil des Vertrags.

## Endpunkte (`/api/epcis`)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/health` | Status + Konfiguration |
| POST | `/generate` | Datei → Idente + EPCIS-Document (kein Capture) |
| POST | `/capture` | EPCIS-Document → EPCAT |
| POST | `/generate-and-capture` | beides in einem Schritt |

`/generate` & `/generate-and-capture` erwarten multipart: `file`, `data_type`
(`forst`|`saegewerk`|`bspwerk`|`stammzertifikat`|`leistungserklaerung`|
`herstellung`), optional `doc_base_url`, `doc_id`, `gcp`.

Die Antwort führt unter `idents` zusätzlich `format`, `is_transformation`,
`input_epcs` und `input_quantities`. Bei einer Transformation beschreiben
`sgtins`/`quantities` die **Ausgangsseite** (Erzeugnis), `input_*` das
verbrauchte Vormaterial.

## Konfiguration (Env, Präfix `TC_EPCIS_`)

| Variable | Default | Bedeutung |
|---|---|---|
| `TC_EPCIS_GCP` | `4047111124` | GS1 Company Prefix |
| `TC_EPCIS_ITEMREF_FORST` | `015` | Item-Ref Forst (HPR) |
| `TC_EPCIS_ITEMREF_SAEGEWERK` | `091` | Item-Ref Sägewerk (ELDAT) |
| `TC_EPCIS_ITEMREF_BSPWERK` | `100` | Item-Ref BSP (VLEX) |
| `TC_EPCIS_ITEMREF_STAMMZERTIFIKAT` | `001` | Item-Ref Saatgut-Los |
| `TC_EPCIS_ITEMREF_LEISTUNGSERKLAERUNG` | `021` | Item-Ref Schnittholz-Lamellen |
| `TC_EPCIS_ITEMREF_HERSTELLUNG` | `100` | Item-Ref BSP-Platte |

> `GCP` und `ITEMREF` wirken nur bei den Treibern, die Idente selbst **bilden**
> (`hpr` ohne eingebettetes `Identity`, `eldat`). Die JSON-Treiber
> (`seed`, `sawdecl`, `module`) übernehmen fertige EPCs aus dem Dokument; dort
> bleiben beide Werte wirkungslos.
| `TC_EPCIS_DOC_BASE_URL` | Solid uploads | Basis-URL → EPCIS↔SOLID-Brücke (bizTransaction) |
| `TC_EPCIS_EPCAT_BASE_URL` | `https://epcat2-timber.prod-k8s.eecc.de/api` | EPCAT-Repo (GS1 EPCIS 2.0 REST) |
| `TC_EPCIS_EPCAT_AUTH` | – | `Bearer …` / `Basic …` (Token nur in lokaler `.env`) |
| `TC_EPCIS_EPCAT_ENABLED` | `true` | `true` = wirklich senden, `false` = Dry-Run |
| `TC_EPCIS_BASH` | `bash` | bash-Executable (Windows-Dev: Git-Bash-Pfad) |

> **EPCAT-Anbindung:** Es gibt nur noch **ein** Repository — das offizielle,
> **produktive** EECC-Repo `https://epcat2-timber.prod-k8s.eecc.de/api`
> (Bearer-Auth). Kein lokales und kein Test-Repo mehr. Alles, was hier
> erfasst wird, landet in der Live-Datenbank; zum gefahrlosen Ausprobieren
> `TC_EPCIS_EPCAT_ENABLED=false` setzen (Dry-Run: Event wird gebaut und
> geloggt, aber nicht gesendet).
> Den Token als kompletten Header-Wert in `TC_EPCIS_EPCAT_AUTH` der lokalen
> `.env` eintragen (`Bearer <token>`) — niemals committen.

## EPCAT-Endpunkt (GS1 EPCIS 2.0 REST)

`POST {base}/capture` mit `Content-Type: application/ld+json`,
`GS1-EPCIS-Version: 2.0`. Antwort `202 Accepted` + `Location`-Header (Job-URL),
abfragbar via `GET {base}/capture/{id}`.

## Verknüpfung mit den RDF-Daten

**EPCIS ist verpflichtend, kein optionaler Schritt.** Schlägt die Identgenerierung
fehl (Service nicht erreichbar, Fehlerantwort, keine Idente), bricht die
Konvertierung der betroffenen Datei mit Fehler ab — es landet dann **keine**
Roh- oder TTL-Datei im Pod. Einzige Ausnahme ist der explizite Betreiber-Schalter
`EPCIS_ENABLED=false` im rml-converter, der den Schritt bewusst deaktiviert. Ist
`TC_EPCIS_EPCAT_ENABLED=true`, ist auch ein fehlgeschlagener EPCAT-Capture fatal
(HTTP 502); im Dry-Run (disabled) nicht.

Der `timberconnect-rml-converter` ruft diesen Service nach der RML-Materialisierung
auf und injiziert die Idente per `services/ident_injector.py` ins TTL:
`tc:sgtin` / `tc:lgtin` an die Stem/Log-Subjekte und ein `tc:EpcisDocument` mit
`tc:bizTransaction`.

Bei einer Transformation bleiben die beiden Seiten getrennt:

- `tc:epc` — was das Dokument **erzeugt** (Ausgangsseite),
- `tc:derivedFrom` — was es **verbraucht** (Vormaterial).

`tc:derivedFrom` ist bewusst **keine** Unter-Property von `tc:epc`: Input und
Output sind entgegengesetzte Aussagen. Hingen beide unter `tc:epc`, lieferte
eine Abfrage nach dem Ident eines Rundholzes auch die daraus gesägten Lamellen
zurück — die Richtung des Materialflusses ginge verloren. Die zugehörigen
Ontologie-Terme liegen in `ontology/timberconnect_epcis_extension.ttl`.
