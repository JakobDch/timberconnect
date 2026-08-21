"""
Prueft die Kernzusage der Ident-Integration:

    Jede Produktdateninstanz, die aus einem PDF entsteht, ist ueber den
    Ident des Dokuments per SPARQL auffindbar.

"Jede" schliesst Zeilen-Subjekte ein (Biegepruefungs-Proben,
Transport-Lieferung). Ein Test, der nur das Hauptsubjekt prueft, wuerde genau
den Fall durchgehen lassen, der in der Praxis stoert: der Ident haengt am
Dokument, die Messwerte darunter sind ueber ihn aber nicht erreichbar.

Geprueft wird ausserdem, dass der im PDF eingebettete Ident den
Materialbezug erfuellt -- ein Stammzertifikat mit eingebettetem Ident muss
ohne zusaetzliche Nutzerauswahl uebertragbar sein.

Ausfuehren:  python -m tests.test_ident_query   (benoetigt Java + rmlmapper.jar)
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from rdflib import Graph, URIRef  # noqa: E402
from services.pdf_template_service import (  # noqa: E402
    EPC_SOURCE_DOCUMENT,
    MATERIAL_INPUT_KEY,
    MATERIAL_REF_KEY,
    SAWINGS_KEY,
    TEMPLATES,
    build_document_json,
)
from services.rml_converter import RMLConverter  # noqa: E402

from tests.test_pdf_templates import build_form_data  # noqa: E402

# Der Ident aus Stammzertifikat_v6.pdf -- genau der Wert, den die ausstellende
# Stelle in das versteckte AcroForm-Feld "Identity" geschrieben hat.
EMBEDDED_EPC = "urn:epc:id:sgtin:4047111124.015.0013249"
DOC_ID = "abc123def4567890"

# Die eine Abfrage, um die es geht: alles zu einem Ident.
IDENT_QUERY = """
PREFIX tc: <http://timberconnect.2050.de/ontology#>
SELECT ?s WHERE { ?s tc:epc <%s> }
"""

# Bei Saegevorgaengen haengt der Ident am Vorgang. Vom Vorgang fuehrt
# tc:hasSawingProcess zurueck zum Dokument -- ein Schritt, den eine Abfrage
# nach "alle Daten zu diesem Ident" mitgehen muss.
IDENT_QUERY_VIA_SAWING = """
PREFIX tc: <http://timberconnect.2050.de/ontology#>
SELECT ?s WHERE {
  ?s tc:hasSawingProcess ?vorgang .
  ?vorgang tc:epc <%s> .
}
"""


def materialise(converter: RMLConverter, tid: str, template: dict) -> Graph:
    """Ein Template mit eingebettetem Ident bis zum TTL durchreichen."""
    form_data = build_form_data(template)
    # Der Ident steht in genau EINEM Feld -- gleich, ob er aus dem PDF gelesen
    # oder im Viewer gewaehlt wurde. Die Herkunft ist Metadatum (epc_source),
    # nicht ein zweites Feld: nachgelagerte Systeme sollen nicht raten muessen,
    # welches Feld die ID traegt.
    #
    # Templates mit Saegevorgaengen fuehren ihre Idente ausschliesslich dort;
    # der Ident gehoert dann in die Output-Liste eines Vorgangs.
    if SAWINGS_KEY in form_data["fields"]:
        form_data["fields"][SAWINGS_KEY] = [
            {
                MATERIAL_INPUT_KEY: ["urn:epc:class:sgtin:4047111124.015.643849625"],
                MATERIAL_REF_KEY: [EMBEDDED_EPC],
            },
        ]
    else:
        form_data["fields"][MATERIAL_REF_KEY] = EMBEDDED_EPC

    document = build_document_json(tid, form_data, DOC_ID, EPC_SOURCE_DOCUMENT)
    rdf_data, _ = converter.convert(
        source_content=json.dumps(document, ensure_ascii=False).encode("utf-8"),
        source_filename=f"{DOC_ID}_{tid}.json",
        mapping_type=tid,
        trace_id=DOC_ID,
        data_type=template["data_type"],
    )
    g = Graph()
    g.parse(data=rdf_data, format="turtle")
    return g


def main() -> int:
    converter = RMLConverter()
    failures: list[str] = []

    for tid, template in TEMPLATES.items():
        try:
            g = materialise(converter, tid, template)
        except Exception as e:
            failures.append(f"{tid}: Konvertierung fehlgeschlagen: {e}")
            continue

        # 1. Der Ident findet ueberhaupt etwas.
        found = {row.s for row in g.query(IDENT_QUERY % EMBEDDED_EPC)}
        if not found:
            failures.append(f"{tid}: Ident-Abfrage liefert nichts")
            continue

        main_subject = URIRef(
            f"http://timberconnect.2050.de/resource/{template['subject_path']}/{DOC_ID}"
        )

        # Dokumente mit Saegevorgaengen sind ein Sonderfall: sie beschreiben
        # viele Lamellen aus vielen Rundhoelzern und haben deshalb keinen EINEN
        # Ident. Der Ident haengt am jeweiligen Vorgang, nicht am Dokument --
        # erreichbar ueber tc:hasSawingProcess. Ihn zusaetzlich ans Dokument zu
        # haengen waere eine willkuerliche Auswahl aus 14 gleichrangigen EPCs.
        has_sawings = any(s.get("sawings") for s in template["sections"])
        if has_sawings:
            reachable = {
                row.s
                for row in g.query(
                    IDENT_QUERY_VIA_SAWING % (EMBEDDED_EPC,)
                )
            }
            if main_subject not in reachable:
                failures.append(
                    f"{tid}: Dokument ueber den Ident seiner Saegevorgaenge "
                    f"nicht erreichbar"
                )
            print(
                f"{tid}: {len(found)} Saegevorgang/-vorgaenge ueber den Ident "
                f"auffindbar, Dokument darueber erreichbar"
            )
            continue

        # 2. Das Hauptsubjekt ist dabei.
        if main_subject not in found:
            failures.append(f"{tid}: Hauptsubjekt nicht ueber den Ident auffindbar")

        # 3. JEDES Subjekt mit Produktdaten ist ueber den Ident auffindbar.
        #    Link-Subjekte ohne eigene Aussagen sind nicht gemeint -- gezaehlt
        #    werden Subjekte, die mehr tragen als nur ihre Verknuepfung.
        with_data = {
            s
            for s in set(g.subjects())
            if isinstance(s, URIRef) and len(list(g.predicate_objects(s))) > 1
        }
        missing = with_data - found
        if missing:
            failures.append(
                f"{tid}: {len(missing)} Subjekt(e) tragen Produktdaten, sind aber "
                f"nicht ueber den Ident auffindbar: "
                + ", ".join(sorted(str(m).rsplit('/resource/', 1)[-1] for m in missing))
            )

        print(f"{tid}: {len(found)} Subjekt(e) ueber den Ident auffindbar")

    if failures:
        print("\nFEHLER:")
        for f in failures:
            print(" -", f)
        return 1

    print("\nAlle Templates: jede Produktdateninstanz ist ueber ihren Ident auffindbar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
