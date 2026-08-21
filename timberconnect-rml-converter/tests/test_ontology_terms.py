"""
Prueft, dass die Ontologie und der Code dasselbe Vokabular sprechen.

Die Ontologie liegt unter ontology/ als Kopie aus dem Repo
TimberConnect_Ontology. Sie wird zur Laufzeit nicht geladen -- gerade
deshalb dieser Test: ohne ihn faellt es erst auf, wenn jemand die TTLs
tatsaechlich zusammenlaedt oder einen Reasoner ansetzt, und dann liegen
bereits Daten im Bestand, die zu keiner Definition passen.

Geprueft wird:
  1. Jedes tc:-Praedikat aus den PDF-Mappings und aus ident_injector.py ist
     in der Ontologie definiert.
  2. Die Ident-Properties haengen unter tc:epc. Das ist die Voraussetzung
     dafuer, dass EINE Abfrage auf tc:epc jeden Ident findet -- ohne diese
     Kette waere ein per tc:sgtin angehaengter Ident fuer die Abfrage
     unsichtbar.

Ausfuehren:  python -m tests.test_ontology_terms   (nur rdflib, kein Java)
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from rdflib import Graph, RDFS, URIRef  # noqa: E402

BASE = Path(__file__).parent.parent
ONTOLOGY_DIR = BASE / "ontology"
MAPPINGS_DIR = BASE / "mappings"
TC = "http://timberconnect.2050.de/ontology#"

# Praedikate, die ident_injector.py schreibt (dort als TC.<name>).
INJECTOR_TERMS = {
    "epc", "sgtin", "lgtin", "gs1Quantity", "gs1Uom",
    "bizTransaction", "hasEpcisEvent",
}

# Ident-Properties, die unter tc:epc haengen muessen.
IDENT_SUBPROPERTIES = {"sgtin", "lgtin", "documentEpc", "materialEpc"}


def load_ontology() -> Graph:
    g = Graph()
    for ttl in sorted(ONTOLOGY_DIR.glob("*.ttl")):
        g.parse(ttl, format="turtle")
    return g


def mapping_predicates() -> set[str]:
    """Alle tc:-Praedikate aus den PDF-Mappings und dem ERP-Excel-Mapping."""
    found: set[str] = set()
    mapping_files = sorted(MAPPINGS_DIR.glob("pdf_*.rml.ttl"))
    mapping_files.append(MAPPINGS_DIR / "erp_bsp.rml.ttl")
    # Ausfuehrungsplanung (IFC): nutzt ueberwiegend das vorhandene
    # IFC-Vokabular aus v6, ergaenzt um timberconnect_ifc_extension.ttl.
    mapping_files.append(MAPPINGS_DIR / "ifc_planung.rml.ttl")
    for ttl in mapping_files:
        text = ttl.read_text(encoding="utf-8")
        found |= set(re.findall(r"rr:predicate\s+tc:(\w+)", text))
        found |= set(re.findall(r"rr:class\s+tc:(\w+)", text))
    return found


def main() -> int:
    g = load_ontology()
    defined = {
        str(s)[len(TC):]
        for s in set(g.subjects())
        if isinstance(s, URIRef) and str(s).startswith(TC)
    }
    print(f"Ontologie: {len(g)} Triples, {len(defined)} tc:-Terme definiert")

    failures: list[str] = []

    # 1. Alle verwendeten Terme sind definiert.
    used = mapping_predicates() | INJECTOR_TERMS
    undefined = sorted(used - defined)
    if undefined:
        failures.append(
            f"{len(undefined)} verwendete Terme fehlen in der Ontologie: "
            + ", ".join(f"tc:{t}" for t in undefined)
        )
    else:
        print(f"OK   alle {len(used)} verwendeten tc:-Terme sind definiert")

    # 2. Ident-Properties haengen unter tc:epc.
    epc = URIRef(TC + "epc")
    for name in sorted(IDENT_SUBPROPERTIES):
        prop = URIRef(TC + name)
        if prop not in set(g.subjects()):
            failures.append(f"tc:{name} ist nicht definiert")
            continue
        parents = set(g.objects(prop, RDFS.subPropertyOf))
        if epc not in parents:
            failures.append(
                f"tc:{name} ist keine Unter-Property von tc:epc -- "
                f"ein so angehaengter Ident waere ueber die tc:epc-Abfrage "
                f"nicht auffindbar"
            )
    if not failures:
        print(f"OK   {len(IDENT_SUBPROPERTIES)} Ident-Properties haengen unter tc:epc")

    if failures:
        print("\nFEHLER:")
        for f in failures:
            print(" -", f)
        return 1

    print("\nOntologie und Code verwenden dasselbe Vokabular.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
