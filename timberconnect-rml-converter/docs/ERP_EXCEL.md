# ERP-Exceldatei mit eingebetteten Identen (Herstellungsvorgang)

Das Leitdokument des **Herstellungsvorgangs** (viertes Glied der Produktlebens­linie:
Pflanzung → Fällung → Aufsägung → **Herstellung**) ist die ERP-Exceldatei des
Holzwerkstoffproduzenten (Vorlage `ERP_BSP_Eingabetabelle.xlsx`). Damit die
Daten im Knowledge Graph mit der Lieferkette verknüpft werden können, muss die
Datei die GS1-Idente tragen — dieses Dokument beschreibt, wie.

Beispieldateien in `tests/data/`:

- `ERP_BSP_Eingabetabelle_mit_Ident.xlsx` — Excel mit ausgefülltem Blatt „Identifikation"
- `f5604d2ba9aa4934_herstellung.json` — das daraus erzeugte JSON-Zwischendokument,
  exakt so wie es der Konverter beim Upload neben Original und TTL im Pod ablegt
  (Referenz für das EECC/timber-events: Idente unter `identification`, die
  Datei als Ganzes = ein EPCIS TransformationEvent)

## Das Blatt „Identifikation"

Die Datei erhält (zusätzlich zu den sieben fachlichen Blättern) ein Blatt mit
dem Namen **`Identifikation`** im selben Schlüssel/Wert-Stil (Spalte A =
Feldname, Spalte B = Wert):

| A | B |
|---|---|
| `Identity` | `urn:epc:id:sgtin:4012345.001001.25VA000001-110` |
| `IdentityInput` | `urn:epc:id:sgtin:4098765.012345.LAM-0001; urn:epc:class:lgtin:4098765.012345.CH-2025-031` |

- **`Identity`** *(Pflicht, genau ein EPC)* — der GS1-EPC des hergestellten
  Produkts (BSP-Platte). Das ERP leitet den Serial-Teil deterministisch aus
  der Vertriebsauftrags-/Produktionsauftragsnummer ab, z. B.
  `urn:epc:id:sgtin:<GCP>.<Artikelref>.<Auftragsnummer>`. Ohne gültigen
  Identity-EPC bricht die Konvertierung mit einer Fehlermeldung ab.
  **Eine ERP-Datei beschreibt genau eine BSP-Platte** — mehrere
  Identity-EPCs sind ein Fehler; für weitere Platten je eine eigene Datei
  erzeugen.
- **`IdentityInput`** *(dringend empfohlen)* — die GS1-EPCs des Vormaterials:
  die Schnittholzlamellen (SGTIN) bzw. -lose (LGTIN), die der
  **Aufsägevorgang** als Output erzeugt hat (dort die `materialEpc`-Werte der
  Leistungserklärung). Genau diese Referenz schließt die Kette
  Stamm → Lamelle → BSP-Platte. Mehrere Werte mit `;` trennen. Fehlt das
  Feld, wird die Datei mit Warnung verarbeitet — die Verknüpfung zur
  vorherigen Wertschöpfungsstufe fehlt dann.

Gültige EPC-Formate (gleiche Validierung wie bei den versteckten
PDF-Formularfeldern, siehe `docs/PDF_IDENT.md`):

```
urn:epc:id:sgtin:<GCP>.<ItemRef>.<Serial>     serialisiertes Einzelstück
urn:epc:class:lgtin:<GCP>.<ItemRef>.<Los>     Los/Charge
```

### Eine Datei = eine Platte = ein Event

Die Datei als Ganzes entspricht genau **einem** EPCIS TransformationEvent:
`IdentityInput` → inputEPCList, `Identity` → outputEPCList. Im JSON-Extrakt
stehen die Idente entsprechend flach unter `identification`:

```json
"identification": {
  "identity": "urn:epc:id:sgtin:4012345.001001.25VA000001-110",
  "identityInput": ["urn:epc:id:sgtin:…", "urn:epc:class:lgtin:…"]
}
```

## Verarbeitung im Konverter

1. **Erkennung** (`services/file_detector.py`): XLSX mit den bekannten
   Blattnamen → `data_type: herstellung`, Mapping `erp_bsp`.
2. **Parser** (`services/erp_excel_service.py`): Blätter → JSON-Zwischendokument;
   die JSON-Schlüssel sind die lokalen Namen der Ontologie-Properties
   (v6, skos:notation M-913 ff.).
3. **RML** (`mappings/erp_bsp.rml.ttl`): JSON → TTL. Zentraler Knoten
   `tc:Panel` mit `tc:epc` (Identity) und `tc:derivedFrom` (IdentityInput),
   daneben `tc:Article`, `tc:DeliveryOrder`, `tc:Warehouse`, `tc:Carrier`,
   `tc:DeliveryCondition`, `tc:Invoice` gemäß der rdfs:domain-Angaben. Da
   eine Datei genau eine Platte beschreibt, steckt die Transformation
   vollständig im Panel-Knoten — ein eigener Prozessknoten ist nicht nötig.
4. **Ablage**: Original-XLSX, JSON-Extrakt und TTL landen gemeinsam unter
   `data/<vorgang>/` im Pod des Uploaders; Dateinamen tragen den kanonischen
   SHA-256-Dokument-Hash.

Anders als bei StanForD/ELDAT erzeugt der EPCIS-Service hier **keine** Idente:
sie stehen bereits in der Datei (Aussteller-Prinzip wie beim versteckten
PDF-Feld `Identity`). Die Erzeugung des EPCIS TransformationEvents am
EECC-Repository aus diesen Angaben ist ein separater, noch offener Schritt.

## Nicht übernommene Felder

`Pos.-Nr.`-lose Freizeilen sowie Blattzeilen ohne Ontologie-Property werden
ignoriert und im Konverter-Log vermerkt. Neue Felder brauchen: Property in der
v6-Ontologie → Eintrag in `SHEET_FIELDS` (`erp_excel_service.py`) → Predicate
im Mapping. Der Test `tests/test_ontology_terms.py` erzwingt, dass jedes im
Mapping verwendete Prädikat in der Ontologie definiert ist.
