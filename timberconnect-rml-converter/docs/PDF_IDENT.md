# Ident im PDF — eingebettet, gelesen, abfragbar

Ausstellende Stellen betten den GS1-Ident des Materials als **verstecktes
AcroForm-Feld** in das PDF ein. TimberConnect liest ihn beim Hochladen
automatisch aus und verknüpft damit alle Produktdaten, die aus diesem Dokument
in den Knowledge Graph übernommen werden.

## Für ausstellende Stellen: den Ident einbetten

In Adobe Acrobat Pro:

1. **Werkzeuge → Formulare**, neues **Textfeld** anlegen.
2. Eigenschaften öffnen.
3. Reiter **Allgemein**: Feldname `Identity`,
   Sichtbarkeit **Ausgeblendet**, Schreibgeschützt **Ja**.
4. Reiter **Optionen**: Standardwert = der Ident, z.B.
   `urn:epc:id:sgtin:4047111124.015.0013249`

Der Benutzer sieht das Feld nicht, der Wert bleibt Bestandteil des AcroForms.

**Gültige Formate** (beides wird akzeptiert):

| Form | Bedeutung | Beispiel |
|---|---|---|
| `urn:epc:id:sgtin:<gcp>.<itemref>.<serial>` | Einzelstück | `urn:epc:id:sgtin:4047111124.015.0013249` |
| `urn:epc:class:lgtin:<gcp>.<itemref>.<lot>` | Los/Charge mit Menge | `urn:epc:class:lgtin:4012345.012345.LOT2026` |

Ein Wert, der diesem Muster nicht entspricht, wird ignoriert — er würde sonst
eine Verknüpfung erzeugen, die im Graph echt aussieht, aber ins Leere zeigt.

Alternative Feldnamen, die ebenfalls erkannt werden: `identity`, `Ident`,
`EPC`, `epc`, `TimberConnectIdent`. Findet sich unter keinem davon ein
gültiger Ident, sucht der Extraktor zusätzlich alle übrigen Formularfelder ab
— ein Wert im EPC-Format ist auch dann eindeutig als Ident erkennbar, wenn das
Feld anders heißt.

### Sägevorgänge: mehrere Idente je Dokument

Eine Leistungserklärung beschreibt keine einzelne Umwandlung, sondern n
Sägevorgänge, in denen aus Rundhölzern viele Lamellen entstehen. Dafür gibt es
**nummerierte Feldpaare**:

| Feldname | Inhalt |
|---|---|
| `IdentityInput_1` | Rundhölzer des ersten Vorgangs |
| `Identity_1` | Lamellen des ersten Vorgangs |
| `IdentityInput_2` / `Identity_2` | zweiter Vorgang |
| … | … |

Mehrere EPCs in einem Feld werden durch **Semikolon, Komma oder Leerraum**
getrennt — ein AcroForm-Textfeld kann keine echte Liste tragen:

```
Identity_1 = urn:epc:class:sgtin:4047111124.021.2356413958;
             urn:epc:class:sgtin:4047111124.021.2356413959; …
```

Ein Vorgang ohne Input **oder** ohne Output wird verworfen: daraus lässt sich
kein TransformationEvent bilden, und ein halber Vorgang würde eine
Verknüpfung vorspiegeln, die es nicht gibt.

**Auflösung:** Ein Vorgang je Rundholz (1 Input, n Lamellen) erlaubt die
Rückverfolgung jeder Lamelle auf ihr konkretes Rundholz. Ein Vorgang je Charge
(m Inputs, m×n Lamellen) ist einfacher zu erfassen, verliert diese Zuordnung
aber. Das entscheidet die ausstellende Stelle.

Im JSON landet das als `fields.sawings` — Format abgestimmt mit dem EECC
(06.08.2026), siehe `SAWINGS_KEY` in `pdf_template_service.py`.

### Ohne Acrobat: `tools/embed_ident.py`

Für bereits ausgestellte Zertifikate — auch **gescannte ohne AcroForm** —
legt das Skript das Feld an:

```bash
python tools/embed_ident.py "P1 Stammzertifikat D-05 004 1 0235 24.pdf" \
    urn:epc:id:sgtin:4047111124.015.0013249
```

Ersetzt die Datei an Ort und Stelle und legt daneben `<name>.original.pdf` als
Sicherungskopie ab; mit `-o <datei>` stattdessen in eine neue Datei schreiben.
Der Ident wird gegen dasselbe Muster geprüft wie in der App — ein Wert, den
die App später ablehnen würde, wird gar nicht erst eingebettet. Nach dem
Schreiben liest das Skript den Wert zur Gegenprobe zurück.

Das Feld bekommt ein Rechteck der Größe 0 und liegt außerhalb des Textflusses:
der sichtbare Inhalt bleibt **pixelgenau unverändert**, Seitendrehung und
-format ebenso. Ein bereits vorhandenes `Identity`-Feld wird überschrieben,
nicht dupliziert.

## Ein Feld, nicht mehrere

Der Ident landet in **genau einem** JSON-Feld: `fields.materialEpc`. Woher er
stammt, steht als Metadatum in `timberconnect_pdf.epcSource` (`"document"` =
aus dem PDF gelesen, `"user"` = im Viewer ausgewählt).

Warum nicht ein eigenes Feld je Herkunft, obwohl Aussteller und Nutzer
verschiedene Quellen sind: Die JSON ist eine Schnittstelle für nachgelagerte
Systeme (EPCIS-Event-Generierung beim EECC). Kämen dort mehrere Felder als ID
in Frage, müsste der Leser raten — und ein falsch geratenes Feld erzeugt
Events am falschen Objekt. Ein eindeutiges Feld ist mehr wert als die im
Feldnamen kodierte Herkunft.

Eine ausdrückliche Wahl des Nutzers gewinnt immer; der eingebettete Ident
füllt nur eine Lücke.

## Was beim Hochladen passiert

1. `extractPdfIdentity()` (`timberconnect-viewer/src/services/pdfIdentityService.ts`)
   liest das AcroForm des **hochgeladenen Originals** mit PDF.js.
   Wichtig: nicht der Formular-Viewer im Transfer-Sheet — der rendert die
   **leere Vorlage** aus der Registry, ein anderes Dokument.
2. Der Ident wird im Materialbezug-Schritt **vorausgewählt** und als „aus dem
   Dokument übernommen" gekennzeichnet. Der Nutzer kann ihn überschreiben;
   eine ausdrückliche Wahl gewinnt immer.
3. Beim Absenden geht er als `extra_fields.materialEpc` mit, begleitet von
   `epc_source: "document"`. Auch Templates ohne Materialbezug-Schritt
   (Klebstoffdatenblatt, Leistungserklärung) haben dafür ein Feld — es kommt
   aus `_document_ident_section()`, angehängt von
   `_attach_document_ident_sections()`.
4. Da der Ident im Feld des Materialbezugs steht, erfüllt er dessen
   Pflichtprüfung: ein Stammzertifikat mit eingebettetem Ident ist ohne
   zusätzliche Auswahl übertragbar.

## Wie die Produktdaten daran hängen

Jedes Subjekt, das aus dem PDF entsteht, trägt den Ident **direkt** — auch
Zeilen-Subjekte wie die Einzelproben einer Biegeprüfung oder die Lieferung
eines Transportauftrags. Der Extraktor spiegelt ihn dafür unter `__epc` in
jede Zeile (`ROW_EPC_KEY`).

Der Grund: würde der Ident nur am Hauptsubjekt hängen, fände die Abfrage
„alle Produktdaten zu diesem Ident" die einzelnen Messwerte nicht — sie wären
im Graph vorhanden, aber über den Ident nicht erreichbar.

Der Ident zählt dabei **nicht** als bepreister Datenpunkt (1 Datenpunkt = 1
Token). Er ist der Schlüssel, unter dem die Daten gefunden werden, nicht
selbst eine bezahlte Aussage; ihn pro Probenzeile mitzuzählen hieße, denselben
Ident vielfach in Rechnung zu stellen.

## Abfragen

Eine Abfrage findet alles — unabhängig von der Herkunft des Idents:

```sparql
PREFIX tc: <http://timberconnect.2050.de/ontology#>
SELECT ?s ?p ?o WHERE {
  ?s tc:epc <urn:epc:id:sgtin:4047111124.015.0013249> ;
     ?p ?o .
}
```

Das funktioniert, weil in der Ontologie alle Ident-Properties unter `tc:epc`
hängen:

```
tc:identifier                     (fachliche Kennungen, Literal)
  └── tc:epc                      ← hierauf wird abgefragt
        ├── tc:sgtin              Einzelstück (StanForD HPR)
        └── tc:lgtin              Los mit Menge (ELDAT)
```

Die PDF-Mappings schreiben direkt `tc:epc`. Die Ontologie kennt zusätzlich
`tc:documentEpc` und `tc:materialEpc` als Unter-Properties für den Fall, dass
die Herkunft später auch im Graph unterschieden werden soll — materialisiert
wird derzeit keine von beiden, weil die Herkunft im JSON-Metadatum
`epcSource` steht.

Im Viewer: `createProductDataByEpcQuery(epc)` in
`src/services/sparqlQueries.ts`.

## Tests

```bash
# Jede Produktdateninstanz ist über ihren Ident auffindbar (alle 7 Templates,
# inklusive Zeilen-Subjekte). Braucht Java + rmlmapper.jar:
docker compose exec timberconnect-rml-converter python -m tests.test_ident_query

# Ontologie und Code verwenden dasselbe Vokabular (nur rdflib):
cd timberconnect-rml-converter && python tests/test_ontology_terms.py
```

Der zweite Test prüft auch die `subPropertyOf`-Kette oben. Reißt sie, wäre ein
Ident zwar im Graph, aber über `tc:epc` nicht mehr auffindbar — genau der
Fehler, der sonst erst beim Abfragen auffällt.

## Ontologie

`ontology/` enthält die Kopien aus dem Repo `TimberConnect_Ontology`
(`timberconnect_ontology_v6.ttl` + `timberconnect_epcis_extension.ttl`). Sie
werden zur Laufzeit nicht geladen, aber von `test_ontology_terms.py` gegen die
Mappings geprüft. Änderungen am Vokabular gehören in das Ontologie-Repo und
werden von dort hierher kopiert.
