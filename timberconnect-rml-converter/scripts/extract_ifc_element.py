"""
extract_ifc_element.py — bauteilbezogenen Auszug aus einem IFC-Gesamtmodell

Schneidet aus einem Ausfuehrungsplanungsmodell GENAU EIN Bauteil samt allem
heraus, was es zum Verstehen braucht (Property-Sets, Material, Geschoss,
Projekt, Geometrie) und schreibt eine gueltige IFC-Datei.

Hintergrund
-----------
Ein Planungsdatensatz im Datenraum beschreibt genau ein Bauteil: der Upload
traegt genau einen GS1-Ident (siehe services/ifc_service.py). Ein
Gesamtmodell enthaelt dagegen viele Bauteile — M24_gesamt.ifc etwa sechs aus
Brettsperrholz. Welches davon zum Ident gehoert, kann die Datei nicht sagen.

Statt diese Frage in die App zu verlagern, wird der Auszug einmal hier
erzeugt: eine Datei, ein Bauteil, keine Mehrdeutigkeit.

Verwendung
----------
    # Bauteil ueber die IFC-GlobalId waehlen (eindeutig):
    python scripts/extract_ifc_element.py M24_gesamt.ifc \\
        --guid 3vyFm6FjX9mhMTaYZ8JVH7 --output M24_BSP-Boden.ifc

    # ... oder ueber den Namen (erster Treffer):
    python scripts/extract_ifc_element.py M24_gesamt.ifc --name BSP-Boden

    # Enthaltene Bauteile auflisten, ohne etwas zu schreiben:
    python scripts/extract_ifc_element.py M24_gesamt.ifc --list

Wie geschnitten wird
--------------------
Ausgehend vom gewaehlten Bauteil wird der Referenzgraph transitiv verfolgt
(#123-Verweise), sodass Geometrie, Platzierung und Einheiten mitkommen.
Zusaetzlich werden die Beziehungen uebernommen, die AUF das Bauteil zeigen
(IfcRelDefinesByProperties, IfcRelAssociatesMaterial,
IfcRelContainedInSpatialStructure, IfcRelDefinesByType) — auf genau dieses
eine Bauteil eingekuerzt, damit die Datei keine Verweise auf entfernte
Elemente behaelt.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.ifc_service import (  # noqa: E402
    ELEMENT_TYPES,
    _IFCModel,
    _as_string,
    _split_args,
)

# Beziehungen, die auf das Bauteil zeigen: (Typ, Index der Objektliste).
INVERSE_RELATIONS = {
    "IFCRELDEFINESBYPROPERTIES": 4,
    "IFCRELASSOCIATESMATERIAL": 4,
    "IFCRELCONTAINEDINSPATIALSTRUCTURE": 4,
    "IFCRELDEFINESBYTYPE": 4,
    "IFCRELAGGREGATES": 5,
    "IFCRELVOIDSELEMENT": 5,
}

# Kopf-Entitaeten, die eine IFC-Datei immer braucht, auch wenn das Bauteil
# sie nicht direkt referenziert.
ALWAYS_KEEP = (
    "IFCPROJECT",
    "IFCSITE",
    "IFCBUILDING",
    "IFCBUILDINGSTOREY",
    "IFCUNITASSIGNMENT",
    "IFCSIUNIT",
    "IFCCONVERSIONBASEDUNIT",
    "IFCMEASUREWITHUNIT",
    "IFCDIMENSIONALEXPONENTS",
    "IFCGEOMETRICREPRESENTATIONCONTEXT",
    "IFCGEOMETRICREPRESENTATIONSUBCONTEXT",
    "IFCOWNERHISTORY",
    "IFCPERSON",
    "IFCORGANIZATION",
    "IFCPERSONANDORGANIZATION",
    "IFCAPPLICATION",
    "IFCPOSTALADDRESS",
)

_ENTITY_LINE = re.compile(r"^#(\d+)\s*=", re.MULTILINE)


def _refs(text: str) -> set[int]:
    return {int(x) for x in re.findall(r"#(\d+)", text)}


def _raw_statements(text: str) -> dict[int, str]:
    """Rohtext jeder Anweisung, damit die Ausgabe zeichengleich bleibt.

    Ein Neu-Serialisieren aus dem geparsten Modell wuerde Zahlenformate und
    Escapes veraendern; die Datei soll aber unveraendert das enthalten, was
    das Planungswerkzeug geschrieben hat.
    """
    data_start = text.index("DATA;") + len("DATA;")
    data_end = text.index("ENDSEC;", data_start)
    body = text[data_start:data_end]

    statements: dict[int, str] = {}
    positions = [(m.start(), int(m.group(1))) for m in _ENTITY_LINE.finditer(body)]
    for index, (start, eid) in enumerate(positions):
        end = positions[index + 1][0] if index + 1 < len(positions) else len(body)
        statements[eid] = body[start:end].strip()
    return statements


def _bsp_elements(model: _IFCModel) -> list[tuple[int, str, str]]:
    """(Id, Typ, Name) aller Bauteile, nach Id sortiert."""
    found = []
    for eid, args in sorted(model.of_type(*ELEMENT_TYPES)):
        name = _as_string(args[2]) if len(args) > 2 else None
        found.append((eid, model.type_of(eid) or "", name or ""))
    return found


def _pick(model: _IFCModel, guid: str | None, name: str | None) -> int:
    elements = _bsp_elements(model)
    if guid:
        for eid, _, _ in elements:
            if _as_string(model.args_of(eid)[0]) == guid:
                return eid
        raise SystemExit(f"Kein Bauteil mit GlobalId '{guid}' gefunden.")
    if name:
        for eid, _, ename in elements:
            if name.lower() in ename.lower():
                return eid
        raise SystemExit(f"Kein Bauteil mit Namen '{name}' gefunden.")
    raise SystemExit("Bitte --guid oder --name angeben (oder --list benutzen).")


def extract(
    text: str,
    element_id: int,
    statements: dict[int, str],
    model: _IFCModel,
) -> tuple[str, dict[int, str]]:
    """Rumpf der Auszugsdatei bauen; gibt (DATA-Abschnitt, Anweisungen) zurueck."""
    # 1. Transitive Huelle der Vorwaertsreferenzen des Bauteils.
    keep: set[int] = set()
    queue = [element_id]
    while queue:
        eid = queue.pop()
        if eid in keep or eid not in statements:
            continue
        keep.add(eid)
        queue.extend(_refs(statements[eid]) - keep)

    # 2. Kopf-Entitaeten (Projekt, Geschoss, Einheiten, Kontexte).
    for eid, (etype, _) in model.entities.items():
        if etype in ALWAYS_KEEP:
            queue.append(eid)
    while queue:
        eid = queue.pop()
        if eid in keep or eid not in statements:
            continue
        keep.add(eid)
        queue.extend(_refs(statements[eid]) - keep)

    # 3. Beziehungen, die AUF das Bauteil zeigen — auf dieses eine Bauteil
    #    eingekuerzt, damit keine Verweise auf entfernte Elemente bleiben.
    rewritten: dict[int, str] = {}
    for eid, (etype, args) in sorted(model.entities.items()):
        index = INVERSE_RELATIONS.get(etype)
        if index is None or len(args) <= index:
            continue
        if element_id not in _refs(args[index]):
            continue

        trimmed = list(args)
        if trimmed[index].strip().startswith("("):
            trimmed[index] = f"(#{element_id})"
        rewritten[eid] = f"#{eid}={etype}({','.join(trimmed)});"
        keep.add(eid)
        for other in _refs(",".join(trimmed)):
            queue.append(other)

    while queue:
        eid = queue.pop()
        if eid in keep or eid not in statements:
            continue
        keep.add(eid)
        queue.extend(_refs(statements[eid]) - keep)

    lines = [rewritten.get(eid, statements[eid]) for eid in sorted(keep) if eid in statements]
    return "\n".join(lines), rewritten


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Schneidet ein einzelnes Bauteil aus einem IFC-Gesamtmodell heraus."
    )
    parser.add_argument("ifc_datei", help="Pfad zum IFC-Gesamtmodell")
    parser.add_argument("--guid", help="IFC-GlobalId des gewuenschten Bauteils")
    parser.add_argument("--name", help="Name des Bauteils (erster Treffer)")
    parser.add_argument("--output", help="Pfad der Ausgabedatei")
    parser.add_argument(
        "--list", action="store_true", help="Enthaltene Bauteile auflisten und beenden"
    )
    args = parser.parse_args()

    text = Path(args.ifc_datei).read_text(encoding="utf-8", errors="replace")
    model = _IFCModel(text)
    statements = _raw_statements(text)

    if args.list:
        for eid, etype, name in _bsp_elements(model):
            guid = _as_string(model.args_of(eid)[0]) or "?"
            print(f"  {guid}  {etype:24} {name}")
        return

    element_id = _pick(model, args.guid, args.name)
    name = _as_string(model.args_of(element_id)[2]) or str(element_id)

    body, _ = extract(text, element_id, statements, model)

    header = text[: text.index("DATA;")]
    # Der Dateiname im Kopf soll den Auszug benennen, nicht mehr das
    # Gesamtmodell — sonst behauptet die Datei etwas Falsches ueber sich.
    output = Path(args.output or f"{Path(args.ifc_datei).stem}_{name}.ifc")
    header = re.sub(
        r"FILE_NAME\('([^']*)'", f"FILE_NAME('{output.name}'", header, count=1
    )

    output.write_text(f"{header}DATA;\n{body}\nENDSEC;\nEND-ISO-10303-21;\n", encoding="utf-8")

    kept = body.count("\n") + 1
    print(
        f"Bauteil '{name}' extrahiert: {kept} von {len(statements)} Entitaeten "
        f"-> {output}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
