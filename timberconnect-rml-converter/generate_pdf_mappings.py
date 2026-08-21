"""
Generiert die RML-Mappings fuer die PDF-Templates aus der Template-Registry
(services/pdf_template_service.py) nach mappings/pdf_*.rml.ttl.

Einmalig ausfuehren (und die erzeugten Dateien committen), wenn sich die
Template-Registry aendert:

    python generate_pdf_mappings.py
"""

from pathlib import Path

from services.pdf_template_service import (
    DOCUMENT_EPC_KEY,
    DOCUMENT_EPC_PREDICATE,
    MATERIAL_INPUT_KEY,
    MATERIAL_INPUT_PREDICATE,
    MATERIAL_REF_KEY,
    ROW_EPC_KEY,
    SAWING_INDEX_KEY,
    SAWINGS_KEY,
    TEMPLATES,
    RESOURCE_BASE,
)

MAPPINGS_DIR = Path(__file__).parent / "mappings"

PREFIXES = """@base <http://timberconnect.2050.de/mapping/> .
@prefix rml: <http://semweb.mmlab.be/ns/rml#> .
@prefix rr: <http://www.w3.org/ns/r2rml#> .
@prefix ql: <http://semweb.mmlab.be/ns/ql#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix tc: <http://timberconnect.2050.de/ontology#> .
@prefix geo: <http://www.opengis.net/ont/geosparql#> .
@prefix wgs84: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
"""


def _pom(field: dict) -> str:
    """predicateObjectMap fuer ein Feld."""
    if field["type"] == "epc_reference":
        # Der EPC-Bezug ist eine IRI, kein Literal -- genau wie die von
        # ident_injector erzeugten tc:epc-Tripel fuer hpr/eldat. Nur so
        # finden EPC-Abfragen PDF- und Maschinendaten ohne Sonderfall.
        obj = f'rml:reference "{field["key"]}" ;\n            rr:termType rr:IRI'
    else:
        obj = f'rml:reference "{field["key"]}"'
        if field.get("datatype"):
            obj += f' ;\n            rr:datatype {field["datatype"]}'
    return (
        "    rr:predicateObjectMap [\n"
        f'        rr:predicate {field["predicate"]} ;\n'
        f"        rr:objectMap [ {obj} ]\n"
        "    ] ;\n"
    )


def _row_epc_pom() -> str:
    """tc:epc-Bindung fuer ein Zeilen-Subjekt.

    Jedes Zeilen-Subjekt (Probe, Lieferung) traegt den Ident des Dokuments
    direkt. Damit findet die Abfrage "alle Produktdaten zu Ident X" auch
    Einzelmesswerte, ohne den Umweg ueber das Hauptsubjekt.

    Der Extraktor spiegelt den Wert unter ``__epc`` in jede Zeile; fehlt er
    (Dokument ohne Ident), erzeugt rmlmapper hier schlicht kein Tripel.
    """
    return _epc_pom(ROW_EPC_KEY)


def _epc_pom(reference: str) -> str:
    """tc:epc-Tripel aus einem beliebigen JSON-Schluessel, als IRI."""
    return (
        "    rr:predicateObjectMap [\n"
        f"        rr:predicate {DOCUMENT_EPC_PREDICATE} ;\n"
        f'        rr:objectMap [ rml:reference "{reference}" ;\n'
        "            rr:termType rr:IRI ]\n"
        "    ] ;\n"
    )


def generate_mapping(template: dict) -> str:
    tpl = template
    tid = tpl["id"]
    main_subject = f"{RESOURCE_BASE}/{tpl['subject_path']}/{{__docId}}"

    lines: list[str] = []
    lines.append(f"# RML-Mapping fuer PDF-Template: {tpl['label']} ({tid})")
    lines.append("# GENERIERT aus services/pdf_template_service.py — nicht von Hand editieren;")
    lines.append("# Aenderungen in der Registry vornehmen und generate_pdf_mappings.py ausfuehren.")
    lines.append("# Ontologie: TimberConnect v6 (+ PDF-Erweiterung 07/2026)")
    lines.append("")
    lines.append(PREFIXES)

    # --- Haupt-TriplesMap (alle flachen Felder ohne Sub-Entitaet) ---
    # Saegevorgaenge sind kein flaches Feld: sie bekommen eigene TriplesMaps
    # weiter unten, weil jeder Vorgang zwei Richtungen traegt (Input/Output).
    main_fields = [
        f
        for s in tpl["sections"]
        if not s.get("repeatable") and not s.get("entity") and not s.get("sawings")
        for f in s["fields"]
    ]
    body = "".join(_pom(f) for f in main_fields).rstrip(" ;\n")
    lines.append(f"<#{tid}_main>")
    lines.append("    rml:logicalSource [")
    lines.append('        rml:source "{{SOURCE_FILE}}" ;')
    lines.append("        rml:referenceFormulation ql:JSONPath ;")
    lines.append('        rml:iterator "$.fields"')
    lines.append("    ] ;")
    lines.append("    rr:subjectMap [")
    lines.append(f'        rr:template "{main_subject}" ;')
    lines.append(f"        rr:class {tpl['main_class']}")
    lines.append("    ] ;")
    lines.append(body + " .")
    lines.append("")

    # --- Sub-Entitaeten ---
    for section in tpl["sections"]:
        entity = section.get("entity")
        if not entity:
            continue
        suffix = entity["suffix"]
        if section.get("repeatable"):
            iterator = f"$.rows.{section['id']}[*]"
            sub_subject = f"{main_subject}/{suffix}/{{__rowIndex}}"
        else:
            iterator = "$.fields"
            sub_subject = f"{main_subject}/{suffix}"

        # Ident an das Sub-Subjekt binden -- bei Zeilen-Sektionen aus dem
        # gespiegelten __epc, bei Nicht-Zeilen-Sektionen aus demselben
        # $.fields-Iterator wie das Hauptsubjekt.
        epc_pom = _row_epc_pom() if section.get("repeatable") else _epc_pom(DOCUMENT_EPC_KEY)
        body = (epc_pom + "".join(_pom(f) for f in section["fields"])).rstrip(" ;\n")
        lines.append(f"<#{tid}_{section['id']}>")
        lines.append("    rml:logicalSource [")
        lines.append('        rml:source "{{SOURCE_FILE}}" ;')
        lines.append("        rml:referenceFormulation ql:JSONPath ;")
        lines.append(f'        rml:iterator "{iterator}"')
        lines.append("    ] ;")
        lines.append("    rr:subjectMap [")
        lines.append(f'        rr:template "{sub_subject}" ;')
        lines.append(f"        rr:class {entity['class']}")
        lines.append("    ] ;")
        lines.append(body + " .")
        lines.append("")

        # Verknuepfung Hauptentitaet -> Sub-Entitaet (gleicher Iterator,
        # Subjekt ist die Hauptentitaet — __docId ist in jeder Zeile injiziert).
        lines.append(f"<#{tid}_{section['id']}_link>")
        lines.append("    rml:logicalSource [")
        lines.append('        rml:source "{{SOURCE_FILE}}" ;')
        lines.append("        rml:referenceFormulation ql:JSONPath ;")
        lines.append(f'        rml:iterator "{iterator}"')
        lines.append("    ] ;")
        lines.append("    rr:subjectMap [")
        lines.append(f'        rr:template "{main_subject}"')
        lines.append("    ] ;")
        lines.append("    rr:predicateObjectMap [")
        lines.append(f"        rr:predicate {entity['link_predicate']} ;")
        lines.append(f'        rr:objectMap [ rr:template "{sub_subject}" ]')
        lines.append("    ] .")
        lines.append("")

    # --- Saegevorgaenge (EECC-Format: fields.sawings[*]) ---
    #
    # Jeder Vorgang wird ein eigenes Subjekt tc:SawingProcess mit
    # tc:derivedFrom (Rundhoelzer) und tc:epc (Lamellen). Beide sind
    # mehrwertig -- rmlmapper erzeugt aus einem JSON-Array je Element ein
    # Tripel, sodass ein Vorgang mit 7 Lamellen 7 tc:epc-Tripel liefert.
    #
    # Der Vorgang wird ueber __sawingIndex identifiziert, den der Extraktor
    # setzt: RML kann die Array-Position selbst nicht als Subjekt-Bestandteil
    # referenzieren.
    for section in tpl["sections"]:
        if not section.get("sawings"):
            continue
        iterator = f"$.fields.{SAWINGS_KEY}[*]"
        sub_subject = f"{main_subject}/saegevorgang/{{{SAWING_INDEX_KEY}}}"

        lines.append(f"<#{tid}_{section['id']}>")
        lines.append("    rml:logicalSource [")
        lines.append('        rml:source "{{SOURCE_FILE}}" ;')
        lines.append("        rml:referenceFormulation ql:JSONPath ;")
        lines.append(f'        rml:iterator "{iterator}"')
        lines.append("    ] ;")
        lines.append("    rr:subjectMap [")
        lines.append(f'        rr:template "{sub_subject}" ;')
        lines.append("        rr:class tc:SawingProcess")
        lines.append("    ] ;")
        lines.append("    rr:predicateObjectMap [")
        lines.append(f"        rr:predicate {MATERIAL_INPUT_PREDICATE} ;")
        lines.append(f'        rr:objectMap [ rml:reference "{MATERIAL_INPUT_KEY}" ;')
        lines.append("            rr:termType rr:IRI ]")
        lines.append("    ] ;")
        lines.append("    rr:predicateObjectMap [")
        lines.append(f"        rr:predicate {DOCUMENT_EPC_PREDICATE} ;")
        lines.append(f'        rr:objectMap [ rml:reference "{MATERIAL_REF_KEY}" ;')
        lines.append("            rr:termType rr:IRI ]")
        lines.append("    ] .")
        lines.append("")

        # Verknuepfung Dokument -> Saegevorgang.
        lines.append(f"<#{tid}_{section['id']}_link>")
        lines.append("    rml:logicalSource [")
        lines.append('        rml:source "{{SOURCE_FILE}}" ;')
        lines.append("        rml:referenceFormulation ql:JSONPath ;")
        lines.append(f'        rml:iterator "{iterator}"')
        lines.append("    ] ;")
        lines.append("    rr:subjectMap [")
        lines.append(f'        rr:template "{main_subject}"')
        lines.append("    ] ;")
        lines.append("    rr:predicateObjectMap [")
        lines.append("        rr:predicate tc:hasSawingProcess ;")
        lines.append(f'        rr:objectMap [ rr:template "{sub_subject}" ]')
        lines.append("    ] .")
        lines.append("")

    return "\n".join(lines)


def main() -> None:
    for tid, template in TEMPLATES.items():
        content = generate_mapping(template)
        out_path = MAPPINGS_DIR / f"{tid}.rml.ttl"
        out_path.write_text(content, encoding="utf-8")
        field_count = sum(len(s["fields"]) for s in template["sections"])
        print(f"{out_path.name}: {field_count} Felder")


if __name__ == "__main__":
    main()
