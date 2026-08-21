"""
End-to-End-Test der PDF-Template-Pipeline (ohne Netz):

    Formulardaten -> build_document_json (Extraktor) -> RML-Mapping -> TTL

Fuer jedes der 7 Templates werden alle Felder mit plausiblen Dummy-Werten
befuellt und geprueft, dass die Materialisierung Triples erzeugt und die
Subjekt-IRIs die Dokument-ID tragen.

Ausfuehren:  python -m tests.test_pdf_templates   (benoetigt Java + rmlmapper.jar)
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from rdflib import Graph, URIRef, RDF  # noqa: E402
from services.pdf_template_service import (  # noqa: E402
    TEMPLATES,
    PDFTemplateError,
    build_document_json,
    pdf_fields_to_form_data,
)
from services.rml_converter import RMLConverter  # noqa: E402

TC = "http://timberconnect.2050.de/ontology#"
DOC_ID = "abc123def4567890"

# Werte, die der Viewer erhebt (kein AcroForm-Feld): EPC-Bezug und die auf der
# Karte gezeichnete Pflanzflaeche. Rechteck im Sauerland, Zentroid (8.15, 51.33).
STAMM_EXTRA = {
    "materialEpc": "urn:epc:class:lgtin:4012345.012345.LOT2026",
    "pflanzflaeche": {
        "type": "Polygon",
        "coordinates": [[[8.10, 51.30], [8.20, 51.30], [8.20, 51.36], [8.10, 51.36], [8.10, 51.30]]],
    },
}


def dummy_value(field: dict, i: int):
    if field["type"] == "derived":
        # Abgeleitete Felder fuellt der Extraktor selbst (WKT, Zentroid).
        return None
    if field["type"] == "epc_reference":
        # Muss ein syntaktisch gueltiger GS1-EPC sein -- der Extraktor
        # validiert streng, damit keine ins Leere zeigenden Bezuege entstehen.
        return "urn:epc:class:lgtin:4012345.012345.LOT2026"
    if field["type"] == "sawings":
        # Saegevorgaenge im EECC-Format: ein Rundholz -> mehrere Lamellen.
        return [
            {
                "materialInputEpc": ["urn:epc:class:sgtin:4047111124.015.643849625"],
                "materialEpc": [
                    f"urn:epc:class:sgtin:4047111124.021.2356413{n}"
                    for n in range(958, 965)
                ],
            },
        ]
    if field["type"] == "polygon":
        # Kleines Rechteck im Sauerland (innerhalb der Deutschland-Pruefung).
        return {
            "type": "Polygon",
            "coordinates": [[[8.10, 51.30], [8.20, 51.30], [8.20, 51.36], [8.10, 51.36], [8.10, 51.30]]],
        }
    if field["type"] == "number":
        return "1.234,5" if i % 3 == 0 else str(10 + i)
    if field["type"] == "date":
        return "2026-07-01"
    if field["type"] == "checkbox":
        return True
    if field["type"] == "select":
        if field["options"]:
            return field["options"][0]
        return f"Auswahl {field['label'][:20]}"
    return f"Testwert {field['label'][:24]}"


def build_form_data(template: dict) -> dict:
    fields = {}
    rows = {}
    i = 0
    for section in template["sections"]:
        if section.get("repeatable"):
            row_list = []
            for r in range(2):
                row = {}
                for field in section["fields"]:
                    i += 1
                    row[field["key"]] = dummy_value(field, i + r)
                row_list.append(row)
            rows[section["id"]] = row_list
        else:
            for field in section["fields"]:
                i += 1
                value = dummy_value(field, i)
                if value is not None:
                    fields[field["key"]] = value
    return {"fields": fields, "rows": rows}


def main() -> int:
    converter = RMLConverter()
    failures = []

    for tid, template in TEMPLATES.items():
        form_data = build_form_data(template)
        document = build_document_json(tid, form_data, DOC_ID)

        json_bytes = json.dumps(document, ensure_ascii=False).encode("utf-8")
        try:
            rdf_data, _ = converter.convert(
                source_content=json_bytes,
                source_filename=f"{DOC_ID}_{tid}.json",
                mapping_type=tid,
                trace_id=DOC_ID,
                data_type=template["data_type"],
            )
        except Exception as e:
            failures.append(f"{tid}: Konvertierung fehlgeschlagen: {e}")
            continue

        g = Graph()
        g.parse(data=rdf_data, format="turtle")

        main_subject = URIRef(
            f"http://timberconnect.2050.de/resource/{template['subject_path']}/{DOC_ID}"
        )
        main_class = URIRef(TC + template["main_class"].split(":", 1)[1])

        checks = []
        if (main_subject, RDF.type, main_class) not in g:
            checks.append(f"Hauptsubjekt {main_subject} fehlt oder falsche Klasse")

        # Pflanzflaeche muss als GeoSPARQL-WKT im Graph landen, sonst kann
        # spaeter kein Produkt ueber seine GPS-Position zugeordnet werden.
        if any(f["type"] == "polygon" for s in template["sections"] for f in s["fields"]):
            wkt_pred = URIRef("http://www.opengis.net/ont/geosparql#asWKT")
            lat_pred = URIRef("http://www.w3.org/2003/01/geo/wgs84_pos#lat")
            wkt = g.value(main_subject, wkt_pred)
            if wkt is None or not str(wkt).startswith("POLYGON(("):
                checks.append(f"geo:asWKT fehlt oder ist kein Polygon: {wkt!r}")
            elif str(wkt.datatype) != "http://www.opengis.net/ont/geosparql#wktLiteral":
                checks.append(f"geo:asWKT hat falschen Datentyp: {wkt.datatype}")
            if g.value(main_subject, lat_pred) is None:
                checks.append("wgs84:lat (Zentroid) fehlt")

        # Anzahl uebertragener Datenpunkte muss sich in den Triples wiederfinden.
        # "__"-Schluessel sind technisch und zaehlen nicht (Dokument-ID,
        # Zeilenindex, gespiegelter Ident) -- genau wie in build_document_json.
        field_count = len(
            [k for k in document["fields"] if not k.startswith("__")]
        ) + sum(
            len([k for k in row if not k.startswith("__")])
            for rl in document["rows"].values() for row in rl
        )
        if len(g) < field_count:
            checks.append(f"Nur {len(g)} Triples fuer {field_count} Datenpunkte")

        # Sub-Entitaeten (Verknuepfungen) pruefen
        for section in template["sections"]:
            entity = section.get("entity")
            if not entity:
                continue
            link_pred = URIRef(TC + entity["link_predicate"].split(":", 1)[1])
            links = list(g.objects(main_subject, link_pred))
            expected = 2 if section.get("repeatable") else 1
            if len(links) != expected:
                checks.append(
                    f"Sektion {section['id']}: {len(links)} statt {expected} "
                    f"Verknuepfungen ueber {entity['link_predicate']}"
                )

        if checks:
            failures.append(f"{tid}: " + "; ".join(checks))
        else:
            print(f"OK   {tid}: {len(g)} Triples, {field_count} Datenpunkte")

    # --- pdf_fields-Pfad: rohe AcroForm-Werte -> Formulardaten -------------
    form = pdf_fields_to_form_data("pdf_biegepruefung", {
        "Titel": "Mustermann",
        "Auftrags-Nr": "A-2026-042",
        "Proben-Nr._3": "P3",
        "Fmax_3": "4158",
        "dL_bei_Fmax_3": "17,3",
        "Proben-Nr._7": "P7",
        "Fmax_7": "3721",
        "Unbekanntes Feld": "wird ignoriert",
    }, extra_fields={"materialEpc": "urn:epc:class:lgtin:4012345.012345.LOT2026"})
    doc = build_document_json("pdf_biegepruefung", form, DOC_ID)
    rows = doc["rows"]["proben"]
    if len(rows) != 2 or rows[0]["probenNr"] != "P3" or rows[1]["fmax"] != 3721:
        failures.append(f"pdf_fields-Pfad: Zeilen falsch zusammengesetzt: {rows}")
    else:
        print("OK   pdf_fields-Pfad: Zeilen 3+7 korrekt als 2 Proben extrahiert")

    # Checkboxen (Stammzertifikat): angehakt -> Label-Wert, nicht angehakt -> weg
    form = pdf_fields_to_form_data("pdf_stammzertifikat", {
        "STAMMZERTIFIKATNR": "SZ-1",
        "Erntegut Original": True,
        "Waldbesitzer Abdruck": False,
        "Verwendungszweck": "-- Auswählen --",
    }, extra_fields=STAMM_EXTRA)
    doc = build_document_json("pdf_stammzertifikat", form, DOC_ID)
    f = doc["fields"]
    if f.get("verteilerErntegut") != "Erntegut Original" or "verteilerWaldbesitzer" in f or "verwendungszweck" in f:
        failures.append(f"Checkbox/Select-Normalisierung fehlerhaft: {f}")
    else:
        print("OK   Checkbox/Select-Normalisierung (Stammzertifikat)")

    # --- Pflanzflaeche: GeoJSON -> WKT + Zentroid --------------------------
    # Das Rechteck 8.10..8.20 / 51.30..51.36 hat den Schwerpunkt (8.15, 51.33).
    if f.get("pflanzflaecheLat") != 51.33 or f.get("pflanzflaecheLon") != 8.15:
        failures.append(
            f"Pflanzflaeche: Zentroid falsch: {f.get('pflanzflaecheLat')}/{f.get('pflanzflaecheLon')}"
        )
    elif not str(f.get("pflanzflaecheWkt", "")).startswith("POLYGON(("):
        failures.append(f"Pflanzflaeche: WKT fehlt oder falsch: {f.get('pflanzflaecheWkt')}")
    else:
        print("OK   Pflanzflaeche: WKT + Zentroid abgeleitet")

    # Flaechen ausserhalb Deutschlands und Nicht-Polygone muessen scheitern --
    # sonst entstehen Zuordnungen, die im Graph echt aussehen, aber falsch sind.
    for bad, name in [
        ({"type": "Polygon", "coordinates": [[[-73.9, 40.7], [-73.8, 40.7], [-73.8, 40.8], [-73.9, 40.7]]]}, "ausserhalb DE"),
        ({"type": "Point", "coordinates": [8.1, 51.3]}, "Punkt statt Polygon"),
        ({"type": "Polygon", "coordinates": [[[8.1, 51.3], [8.2, 51.3]]]}, "zu wenig Punkte"),
    ]:
        try:
            bad_form = pdf_fields_to_form_data(
                "pdf_stammzertifikat", {"STAMMZERTIFIKATNR": "SZ-1"},
                extra_fields={**STAMM_EXTRA, "pflanzflaeche": bad},
            )
            build_document_json("pdf_stammzertifikat", bad_form, DOC_ID)
            failures.append(f"Pflanzflaeche '{name}': wurde faelschlich akzeptiert")
        except PDFTemplateError:
            print(f"OK   Pflanzflaeche '{name}' korrekt abgelehnt")

    if failures:
        print("\nFEHLER:")
        for f in failures:
            print(" -", f)
        return 1
    print("\nAlle 7 PDF-Templates erfolgreich materialisiert.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
