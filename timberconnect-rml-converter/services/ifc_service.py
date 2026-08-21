"""
IFC-Service (Ausfuehrungsplanung, Bauteilverortung im Gebaeude)

Liest den bauteilbezogenen Auszug einer IFC-Datei der Ausfuehrungsplanung und
erzeugt daraus das maschinenlesbare JSON-Zwischendokument, das vom RML-Mapping
mappings/ifc_planung.rml.ttl in die TimberConnect-Ontologie v6 materialisiert
wird. Aufbau und Ablauf entsprechen bewusst erp_excel_service.py: Datei ->
JSON-Zwischendokument -> RML, damit es im Konverter nur EIN Muster fuer
Nicht-RML-Quellformate gibt.

Merkmale (Datenmodell TC, Auswertung "Ausfuehrungsplanung Brettsperrholz"):

    M-1168  IFC_GlobalId          IfcSlab/IfcWall.GlobalId
    M-1169  IFC_Typ               Entitaetstyp (IfcSlab, IfcWall, ...)
    M-1170  Bezeichnung           Name des Bauteils
    M-1171  Material              zugeordnetes IfcMaterial
    M-1172  Einbau_&_Anlieferung  Property "Einbau"/"Anlieferung"
    M-1173  Geschoss              IfcBuildingStorey ueber
                                  IfcRelContainedInSpatialStructure
    M-1174  Teilgruppe            Property "Teilgruppe"
    M-1175  No_production_list    Property "Produktionsliste"
    M-1176  SKU                   Property "SKU"/"Artikelnummer"
    M-1177  Bauteil               Bauteilart aus Typ/Name abgeleitet
    M-1178  Abbund_BVN            Property "Abbund"/"BVN"
    M-1179  Bauabschnitt          Property "Bauabschnitt"/"BA"
    M-1180  Sichtqualitaet_S1     Property "Sichtqualitaet"

WICHTIG — nicht jede IFC traegt alle Merkmale, und die Benennung ist NICHT
standardisiert. Zwei Exporte desselben Bauwerks lagen dem Projekt vor:

  * M24_Auszug.ifc (Revit, IFC2X3) — GlobalId, Typ, Bezeichnung, Material,
    Geschoss und Mengen (IfcElementQuantity), aber KEINE projektspezifischen
    Parameter: Revit schreibt Bauabschnitt, Sichtqualitaet, Abbund/BVN und
    Produktionsliste nicht mit.
  * M24_gesamt.ifc (cadwork, IFC4) — ALLE Planungsmerkmale im Pset
    "Cadwork3dProperties", dafuer keine Mengen. Die Merkmale tragen dort eine
    Sortiernummer ("05-Abbund/ BVN") und teils eigene Namen ("Group" fuer das
    Geschoss); PROPERTY_ALIASES und _normalize_key gleichen das ab.

Die Masse des Bauteils stammen ohnehin aus dem ERP (Awf-Merkmale I-32..I-36);
die IFC-Mengen sind nur ein Zusatz fuer den Soll-Ist-Abgleich. Fehlen sie,
fehlt dem Anwendungsfall nichts.

Was eine Datei nicht hergibt, wird hier NICHT erfunden: es fehlt im JSON und
die Ansicht weist es als Luecke aus. Genau das sichtbar zu machen, ist laut
Awf-Vorgabe Teil des Anwendungsfalls.

Der Ident (tc:epc) kommt — anders als bei HPR/ELDAT — nicht aus der Datei,
sondern wird beim Upload mitgegeben: die Planung kennt die GS1-Serie des
gefertigten Bauteils nicht. Ohne Ident waere der Planungsdatensatz im
Datenraum nicht auffindbar, deshalb ist er PFLICHT.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)


class IFCError(Exception):
    """Fehler beim Lesen oder Validieren der IFC-Datei."""


# Gleiche Validierung wie im ERP- und PDF-Pfad
# (erp_excel_service._EPC_URN_RE, pdf_template_service._EPC_URN_RE).
_EPC_URN_RE = re.compile(
    r"^urn:epc:(id:sgtin|class:sgtin|class:lgtin):[0-9]+\.[0-9]+\.[A-Za-z0-9_-]+$"
)

# IFC ist ein STEP-Physical-File (ISO 10303-21).
IFC_MAGIC = b"ISO-10303-21"

# Namensfilter fuer das gemeinte Bauteil. Ein Gesamtmodell enthaelt neben dem
# Brettsperrholz auch Daemmung, Fenster und Verbindungsmittel; der Filter
# trennt sie, wie im Auswertungsskript des Projektteams (ifc_zu_json.py).
DEFAULT_KEYWORD = "BSP"

# Bauteilklassen, die als Traeger des Anwendungsfalls in Frage kommen. BSP
# tritt als Decke/Boden (IfcSlab) oder Wand (IfcWall) auf; die uebrigen
# Klassen sind mitgefuehrt, damit ein Auszug mit Traegern oder Stuetzen nicht
# stillschweigend leer bleibt.
ELEMENT_TYPES = (
    "IFCSLAB",
    "IFCWALL",
    "IFCWALLSTANDARDCASE",
    "IFCBEAM",
    "IFCCOLUMN",
    "IFCPLATE",
    "IFCMEMBER",
    "IFCROOF",
    "IFCCOVERING",
    "IFCBUILDINGELEMENTPROXY",
)

# Bauteilart (M-1177) aus dem IFC-Typ. Die Beispieldatei nennt das Bauteil
# "BSP-Boden"; ist im Namen bereits eine Bauteilart genannt, gewinnt diese,
# weil sie die Absicht des Planers wiedergibt.
_TYPE_TO_COMPONENT = {
    "IFCSLAB": "Decke",
    "IFCWALL": "Wand",
    "IFCWALLSTANDARDCASE": "Wand",
    "IFCBEAM": "Träger",
    "IFCCOLUMN": "Stütze",
    "IFCPLATE": "Platte",
    "IFCMEMBER": "Stab",
    "IFCROOF": "Dach",
    "IFCCOVERING": "Bekleidung",
}

# Bauteilart im Klartext, wie sie in Revit-Familiennamen auftaucht.
_NAME_TO_COMPONENT = (
    ("boden", "Boden"),
    ("decke", "Decke"),
    ("wand", "Wand"),
    ("dach", "Dach"),
    ("stütze", "Stütze"),
    ("stuetze", "Stütze"),
    ("träger", "Träger"),
    ("traeger", "Träger"),
)

# Property-Namen je Merkmal. IFC standardisiert diese projektspezifischen
# Parameter nicht — jedes Planungsbuero und jede CAD-Software benennt sie
# anders. Deshalb wird gegen eine Liste bekannter Schreibweisen geprueft,
# statt einen einzigen Namen zu erwarten (der dann bei der naechsten Datei
# nicht mehr passt).
#
# cadwork (Pset "Cadwork3dProperties") stellt den Merkmalen eine laufende
# Nummer voran: "05-Abbund/ BVN", "06-Bauabschnitt", "13-Einbau & Anliefung".
# Diese Nummer ist eine Sortierhilfe der Software, kein Teil des Merkmals --
# _lookup() streift sie deshalb vor dem Vergleich ab (siehe _normalize_key),
# sonst braeuchte jede Liste hier zwei Eintraege pro Schreibweise.
PROPERTY_ALIASES: dict[str, tuple[str, ...]] = {
    # cadwork schreibt "Anliefung" (ohne 'er') -- kein Tippfehler hier,
    # sondern der tatsaechliche Feldname in der Datei.
    "einbauUndAnlieferung": ("einbau_&_anlieferung", "einbau & anlieferung",
                             "einbau & anliefung", "einbau und anlieferung",
                             "einbau", "anlieferung"),
    "teilgruppe": ("teilgruppe", "baugruppe", "sub group"),
    "noProductionList": ("no_production_list", "no. production list",
                         "production list", "produktionsliste",
                         "nr_produktionsliste", "nummer produktionsliste"),
    "sku": ("sku", "artikelnummer", "artikel-nr", "artikelnr"),
    "abbundBvn": ("abbund/ bvn", "abbund/_bvn", "abbund_bvn", "abbund", "bvn",
                  "abbund bvn"),
    "bauabschnitt": ("bauabschnitt", "ba", "bauabschnitt_nr"),
    "sichtqualitaet": ("sichtqualität s1", "sichtqualität_s1",
                       "sichtqualitaet_s1", "sichtqualitaet s1",
                       "sichtqualität", "sichtqualitaet",
                       "oberflächenqualität"),
    # Bauteilart (M-1177). cadwork fuehrt sie als eigenes Merkmal
    # ("04-Bauteil" = "Außenwände", "Decke", "Boden") -- das ist die Angabe
    # des Planers und schlaegt deshalb die Ableitung aus Typ und Name.
    "bauteil": ("bauteil", "bauteiltyp"),
    # Geschoss (M-1173). cadwork legt es als "Group" ("0.EG") ab, waehrend
    # IfcBuildingStorey nur das generische "Geschoss 1" traegt.
    "geschoss": ("geschoss", "group", "stockwerk", "etage"),
}

# Property-Namen, unter denen der GS1-Ident des verbauten Bauteils stehen kann.
#
# Gleiche Konvention wie im PDF-Pfad (verstecktes AcroForm-Feld "Identity",
# siehe docs/PDF_IDENT.md) und in der ERP-Excel (Blatt "Identifikation").
# Planungswerkzeuge wie cadwork und Revit erlauben benutzerdefinierte
# Attribute je Bauteil; traegt die Datei den Ident dort ein, muss ihn beim
# Upload niemand mehr abtippen.
IDENT_ALIASES: tuple[str, ...] = (
    "identity",
    "gs1 epc",
    "gs1-epc",
    "epc",
    "material-id",
    "material id",
    "materialid",
)

# Mengen aus IfcElementQuantity (BaseQuantities). Nicht Teil der
# Informationsbedarfstiefe, aber die Planung ist die einzige Quelle fuer die
# geplante (statt gefertigte) Geometrie — der Abgleich Planung/Fertigung ist
# fuer die Dokumentation aussagekraeftig.
QUANTITY_KEYS = {
    "netarea": "nettoflaeche",
    "grossarea": "bruttoflaeche",
    "netvolume": "nettovolumen",
    "grossvolume": "bruttovolumen",
    "width": "breite",
    "length": "laenge",
    "height": "hoehe",
}


# ---------------------------------------------------------------------------
# STEP-Parser
# ---------------------------------------------------------------------------

# Eine STEP-Anweisung: #123=IFCSLAB('guid',#6,'Name',...);
#
# Nicht-gierig und ueber Zeilengrenzen hinweg: lange Argumentlisten (etwa
# Punktlisten der Geometrie) umbricht Revit, eine gierige Variante wuerde
# dagegen die gesamte Datei als eine einzige Entitaet verschlucken. Das
# abschliessende ');' vor dem naechsten '#<n>=' beendet die Anweisung.
_ENTITY_RE = re.compile(
    r"#(\d+)\s*=\s*([A-Z0-9_]+)\s*\((.*?)\)\s*;\s*(?=#\d+\s*=|ENDSEC|$)",
    re.DOTALL,
)

# STEP kodiert Nicht-ASCII als \X\<hex> bzw. \X2\<utf16>\X0\.
_X_ESCAPE_RE = re.compile(r"\\X\\([0-9A-Fa-f]{2})")
_X2_ESCAPE_RE = re.compile(r"\\X2\\([0-9A-Fa-f]+)\\X0\\")


def _decode_step_string(value: str) -> str:
    """STEP-Escapes in lesbaren Text ueberfuehren.

    Revit schreibt Umlaute als ``\\X\\E4`` (latin-1) oder ``\\X2\\00E4\\X0\\``
    (UTF-16). Ohne diese Aufloesung stuende im Datenraum "Bema\\X\\DFungen"
    statt "Bemaßungen".
    """
    def _x2(match: re.Match[str]) -> str:
        hexdigits = match.group(1)
        return "".join(
            chr(int(hexdigits[i:i + 4], 16)) for i in range(0, len(hexdigits), 4)
        )

    value = _X2_ESCAPE_RE.sub(_x2, value)
    value = _X_ESCAPE_RE.sub(lambda m: chr(int(m.group(1), 16)), value)
    # STEP verdoppelt einfache Anfuehrungszeichen innerhalb von Strings.
    return value.replace("''", "'")


def _split_args(raw: str) -> list[str]:
    """Argumentliste einer STEP-Zeile auf oberster Klammerebene zerlegen."""
    args: list[str] = []
    depth = 0
    in_string = False
    current: list[str] = []

    index = 0
    while index < len(raw):
        char = raw[index]
        if in_string:
            if char == "'":
                # Verdoppeltes Hochkomma bleibt Teil des Strings.
                if index + 1 < len(raw) and raw[index + 1] == "'":
                    current.append("''")
                    index += 2
                    continue
                in_string = False
            current.append(char)
        elif char == "'":
            in_string = True
            current.append(char)
        elif char == "(":
            depth += 1
            current.append(char)
        elif char == ")":
            depth -= 1
            current.append(char)
        elif char == "," and depth == 0:
            args.append("".join(current).strip())
            current = []
        else:
            current.append(char)
        index += 1

    if current:
        args.append("".join(current).strip())
    return args


def _as_string(arg: str) -> Optional[str]:
    """STEP-Argument als Text, oder None bei $ / * / leer."""
    arg = arg.strip()
    if not arg or arg in ("$", "*"):
        return None
    if arg.startswith("'") and arg.endswith("'") and len(arg) >= 2:
        text = _decode_step_string(arg[1:-1]).strip()
        return text or None
    # Typisierte Werte: IFCLABEL('x'), IFCREAL(1.5), IFCBOOLEAN(.T.)
    match = re.match(r"^[A-Z0-9_]+\((.*)\)$", arg, re.DOTALL)
    if match:
        return _as_string(match.group(1))
    if arg in (".T.", ".TRUE."):
        return "ja"
    if arg in (".F.", ".FALSE."):
        return "nein"
    if arg.startswith(".") and arg.endswith(".") and len(arg) > 2:
        # Enumeration wie .NOTDEFINED. -> als Text ohne Punkte
        value = arg[1:-1]
        return None if value in ("NOTDEFINED", "USERDEFINED") else value
    return arg or None


def _as_refs(arg: str) -> list[int]:
    """Alle Entitaetsreferenzen (#123) eines Arguments."""
    return [int(x) for x in re.findall(r"#(\d+)", arg)]


class _IFCModel:
    """Minimales IFC-Modell: Entitaeten und ihre Argumente.

    Bewusst kein ifcopenshell: die Bibliothek ist ein grosses natives Paket,
    und fuer das Auslesen einiger Property-Sets aus einem Bauteilauszug
    genuegt der STEP-Parser. Geometrie wird nicht ausgewertet.
    """

    def __init__(self, text: str):
        self.entities: dict[int, tuple[str, list[str]]] = {}
        for match in _ENTITY_RE.finditer(text):
            eid = int(match.group(1))
            self.entities[eid] = (match.group(2).upper(), _split_args(match.group(3)))

    def of_type(self, *types: str) -> list[tuple[int, list[str]]]:
        wanted = {t.upper() for t in types}
        return [
            (eid, args)
            for eid, (etype, args) in self.entities.items()
            if etype in wanted
        ]

    def type_of(self, eid: int) -> Optional[str]:
        entry = self.entities.get(eid)
        return entry[0] if entry else None

    def args_of(self, eid: int) -> list[str]:
        entry = self.entities.get(eid)
        return entry[1] if entry else []


def _read_property(model: _IFCModel, eid: int) -> tuple[Optional[str], Optional[str]]:
    """IfcPropertySingleValue -> (Name, Wert)."""
    etype = model.type_of(eid)
    if etype != "IFCPROPERTYSINGLEVALUE":
        return None, None
    args = model.args_of(eid)
    if len(args) < 3:
        return None, None
    return _as_string(args[0]), _as_string(args[2])


def _collect_properties(model: _IFCModel, element_id: int) -> dict[str, str]:
    """Alle Properties und Mengen eines Bauteils, flach als Name -> Wert.

    Property-Sets sind ueber IfcRelDefinesByProperties an das Bauteil
    gebunden; die Namen sind ueber Sets hinweg eindeutig genug, um sie flach
    zu halten. Der erste Treffer gewinnt, damit ein spaeteres, gleichnamiges
    Property aus einem anderen Set einen belegten Wert nicht ueberschreibt.
    """
    properties: dict[str, str] = {}
    quantities: dict[str, str] = {}

    for _, args in model.of_type("IFCRELDEFINESBYPROPERTIES"):
        if len(args) < 6:
            continue
        # args[4] = RelatedObjects, args[5] = RelatingPropertyDefinition
        if element_id not in _as_refs(args[4]):
            continue
        for definition in _as_refs(args[5]):
            dtype = model.type_of(definition)
            dargs = model.args_of(definition)
            if dtype == "IFCPROPERTYSET" and len(dargs) >= 5:
                for prop in _as_refs(dargs[4]):
                    name, value = _read_property(model, prop)
                    if name and value and name not in properties:
                        properties[name] = value
            elif dtype == "IFCELEMENTQUANTITY" and len(dargs) >= 6:
                for quantity in _as_refs(dargs[5]):
                    qargs = model.args_of(quantity)
                    qname = _as_string(qargs[0]) if qargs else None
                    # IfcQuantityArea/Volume/Length: letzter Wert ist die Zahl.
                    qvalue = _as_string(qargs[3]) if len(qargs) > 3 else None
                    if qname and qvalue:
                        quantities.setdefault(qname, qvalue)

    properties.update({k: v for k, v in quantities.items() if k not in properties})
    return properties


# cadwork stellt jedem Merkmal eine Sortiernummer voran ("05-Abbund/ BVN").
_ORDER_PREFIX_RE = re.compile(r"^\d{1,2}\s*[-.)]\s*")


def _normalize_key(name: str) -> str:
    """Property-Namen vergleichbar machen.

    Streift die cadwork-Sortiernummer ab und vereinheitlicht Gross-/
    Kleinschreibung und Mehrfach-Leerzeichen. Damit trifft ein Alias
    "abbund/ bvn" sowohl "05-Abbund/ BVN" als auch "Abbund/ BVN".
    """
    return re.sub(r"\s+", " ", _ORDER_PREFIX_RE.sub("", name).strip().lower())


def _lookup(properties: dict[str, str], aliases: tuple[str, ...]) -> Optional[str]:
    """Erstes Property, dessen Name einem der Aliase entspricht."""
    normalized = {_normalize_key(name): value for name, value in properties.items()}
    for alias in aliases:
        value = normalized.get(_normalize_key(alias))
        if value:
            return value
    return None


def _storey_of(model: _IFCModel, element_id: int) -> Optional[str]:
    """Geschoss (M-1173) ueber IfcRelContainedInSpatialStructure."""
    for _, args in model.of_type("IFCRELCONTAINEDINSPATIALSTRUCTURE"):
        if len(args) < 6:
            continue
        if element_id not in _as_refs(args[4]):
            continue
        for structure in _as_refs(args[5]):
            if model.type_of(structure) == "IFCBUILDINGSTOREY":
                sargs = model.args_of(structure)
                # Name (Index 2), sonst LongName (Index 7)
                name = _as_string(sargs[2]) if len(sargs) > 2 else None
                if not name and len(sargs) > 7:
                    name = _as_string(sargs[7])
                if name:
                    return name
    return None


def _material_of(model: _IFCModel, element_id: int) -> Optional[str]:
    """Material (M-1171) ueber IfcRelAssociatesMaterial.

    Revit haengt das Material haeufig nicht an das Bauteil selbst, sondern an
    seinen Typ (IfcRelDefinesByType -> IfcTypeProduct). Beide Wege werden
    geprueft, sonst bliebe "BSP-5 lagig" unerkannt.
    """
    candidates = {element_id}
    for _, args in model.of_type("IFCRELDEFINESBYTYPE"):
        if len(args) >= 6 and element_id in _as_refs(args[4]):
            candidates.update(_as_refs(args[5]))

    for _, args in model.of_type("IFCRELASSOCIATESMATERIAL"):
        if len(args) < 6:
            continue
        if not candidates & set(_as_refs(args[4])):
            continue
        for material in _as_refs(args[5]):
            name = _material_name(model, material)
            if name:
                return name
    return None


def _material_name(model: _IFCModel, eid: int) -> Optional[str]:
    """Materialname aus IfcMaterial oder einer Material-Schichtenfolge."""
    etype = model.type_of(eid)
    args = model.args_of(eid)
    if etype == "IFCMATERIAL" and args:
        return _as_string(args[0])
    if etype in ("IFCMATERIALLAYERSETUSAGE", "IFCMATERIALLAYERSET",
                 "IFCMATERIALLIST", "IFCMATERIALLAYER"):
        # Erste erreichbare Materialbezeichnung gewinnt; die vollstaendige
        # Schichtenfolge ist fuer diesen Awf nicht gefordert.
        for arg in args:
            for ref in _as_refs(arg):
                if ref == eid:
                    continue
                name = _material_name(model, ref)
                if name:
                    return name
        if etype == "IFCMATERIALLAYERSET" and len(args) > 1:
            return _as_string(args[1])
    return None


def _component_kind(ifc_type: str, name: Optional[str]) -> Optional[str]:
    """Bauteilart (M-1177): Klartext im Namen schlaegt den IFC-Typ."""
    if name:
        lowered = name.lower()
        for needle, label in _NAME_TO_COMPONENT:
            if needle in lowered:
                return label
    return _TYPE_TO_COMPONENT.get(ifc_type)


def _pick_element(
    model: _IFCModel,
    keyword: str = DEFAULT_KEYWORD,
) -> tuple[int, str, list[str]]:
    """Das dokumentierte Bauteil bestimmen.

    Ein Planungsdatensatz beschreibt genau EIN Bauteil (wie die ERP-Datei
    genau eine Platte beschreibt). Zwei Arten von Dateien kommen an:

      * der bauteilbezogene AUSZUG -- enthaelt im Wesentlichen nur das
        gemeinte Bauteil;
      * das GESAMTMODELL des Bauwerks -- enthaelt daneben Daemmung, Fenster,
        Lattung, Verbindungsmittel und alles andere (in der Beispieldatei
        M24_gesamt.ifc: 111 Kandidaten, davon 6 aus Brettsperrholz).

    Deshalb wird wie im Auswertungsskript des Projektteams auf den
    Bauteilnamen gefiltert ("BSP-Wand", "BSP-Decke", "BSP-Boden"): ohne
    diesen Filter landete beim Gesamtmodell irgendein Elastomerlager als
    "das Bauteil" im Datenraum. Greift der Filter nicht (Auszug mit
    abweichender Benennung), gilt wieder das erste tragende Element --
    sonst waere eine korrekte Datei nur wegen ihrer Namensgebung unbrauchbar.

    Bleibt mehr als ein Treffer, entscheidet die Reihenfolge in der Datei
    NICHT allein: das waere Zufall. Stattdessen faellt die Wahl auf das
    Bauteil, und der Aufrufer bekommt eine Warnung, welche weiteren zur
    Auswahl gestanden haetten -- siehe parse_ifc().
    """
    elements = sorted(
        (
            (eid, model.type_of(eid) or "", args)
            for eid, args in model.of_type(*ELEMENT_TYPES)
        ),
        key=lambda item: item[0],
    )
    if not elements:
        raise IFCError(
            "Kein Bauteil gefunden: Die IFC-Datei enthält keine der erwarteten "
            "Klassen (IfcSlab, IfcWall, IfcBeam, IfcColumn …). Erwartet wird ein "
            "Ausführungsplanungsmodell oder ein bauteilbezogener Auszug daraus."
        )

    matching = [
        item
        for item in elements
        if (_as_string(item[2][2]) if len(item[2]) > 2 else None)
        and keyword.lower() in (_as_string(item[2][2]) or "").lower()
    ]
    return (matching or elements)[0]


def _matching_elements(model: _IFCModel, keyword: str) -> list[tuple[int, str]]:
    """Alle Bauteile, auf die der Namensfilter passt (Id + Name)."""
    found: list[tuple[int, str]] = []
    for eid, args in sorted(model.of_type(*ELEMENT_TYPES)):
        name = _as_string(args[2]) if len(args) > 2 else None
        if name and keyword.lower() in name.lower():
            found.append((eid, name))
    return found


def parse_ifc(
    content: bytes,
    doc_id: str,
    epc: str,
    source_filename: str = "",
    keyword: str = DEFAULT_KEYWORD,
) -> tuple[dict, list[str]]:
    """IFC-Datei -> JSON-Zwischendokument fuer mappings/ifc_planung.rml.ttl.

    Der Ident wird an ZWEI Stellen gesucht, in dieser Reihenfolge:

      1. im Bauteil selbst (Property "Identity", siehe IDENT_ALIASES) --
         derselbe Weg wie beim PDF und der ERP-Excel. Traegt das
         Planungsmodell den Ident, muss ihn niemand abtippen.
      2. im Parameter ``epc``, den der Upload mitgibt -- der Rueckfallweg
         fuer Dateien, die ohne Ident aus dem Planungswerkzeug kommen.

    Widersprechen sich beide, gewinnt die DATEI und der Aufrufer bekommt eine
    Warnung: der eingetippte Wert ist die unsicherere Quelle, und ein
    stillschweigendes Ueberschreiben haenge die Planung an das falsche Bauteil.

    Args:
        content: Rohbytes der .ifc-Datei
        doc_id: kanonischer Dokument-Hash (SHA-256, 16 Hex) — Subjektbasis
        epc: GS1-EPC des Bauteils vom Upload; entbehrlich, wenn die Datei
            ihn selbst traegt
        source_filename: Originaldateiname (nur Metadatum)
        keyword: Namensfilter fuer das gemeinte Bauteil (Standard "BSP")

    Returns:
        (Dokument-Dict, nicht-blockierende Warnungen)

    Raises:
        IFCError: Datei unlesbar, EPC ungueltig oder kein Bauteil enthalten.
    """
    epc = (epc or "").strip()
    if epc and not _EPC_URN_RE.match(epc):
        raise IFCError(
            "Ungültiger Produkt-Ident: erwartet wird ein GS1-EPC im Format "
            "urn:epc:id:sgtin:<gcp>.<itemref>.<serial>. "
            f"Erhalten: '{epc}'"
        )

    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        # STEP ist offiziell ASCII mit \X\-Escapes; aeltere Exporte schreiben
        # Umlaute jedoch direkt in latin-1.
        text = content.decode("latin-1")

    if IFC_MAGIC.decode() not in text[:200]:
        raise IFCError(
            "Keine IFC-Datei: Der Kopf enthält kein 'ISO-10303-21'. Erwartet "
            "wird ein IFC-STEP-Export (.ifc) der Ausführungsplanung."
        )

    model = _IFCModel(text)
    if not model.entities:
        raise IFCError("IFC-Datei enthält keine lesbaren Entitäten.")

    element_id, ifc_type, args = _pick_element(model, keyword)

    # IfcRoot: GlobalId (0), OwnerHistory (1), Name (2), Description (3)
    global_id = _as_string(args[0]) if args else None
    name = _as_string(args[2]) if len(args) > 2 else None

    if not global_id:
        raise IFCError(
            "Bauteil ohne IFC_GlobalId (M-1168) — die GlobalId ist der "
            "eindeutige Bezeichner des Bauteils im Planungsmodell."
        )

    properties = _collect_properties(model, element_id)

    warnings: list[str] = []

    # --- Ident: Datei schlaegt Upload ---------------------------------------
    embedded = _lookup(properties, IDENT_ALIASES)
    if embedded and not _EPC_URN_RE.match(embedded.strip()):
        warnings.append(
            f"Das Bauteil trägt im Planungsmodell die Kennung '{embedded}', "
            "die kein gültiger GS1-EPC ist "
            "(urn:epc:id:sgtin:<gcp>.<itemref>.<serial>). Sie wird ignoriert."
        )
        embedded = None

    if embedded:
        embedded = embedded.strip()
        if epc and epc != embedded:
            warnings.append(
                f"Der beim Upload angegebene Ident ({epc}) weicht von dem im "
                f"Planungsmodell hinterlegten ({embedded}) ab. Verwendet wird "
                "die Angabe aus der Datei."
            )
        epc = embedded

    if not epc:
        raise IFCError(
            "Kein Produkt-Ident: Das Bauteil trägt im Planungsmodell keine "
            "Material-ID (Attribut 'Identity'), und beim Upload wurde keine "
            "angegeben. Ohne Ident wäre der Planungsdatensatz im Datenraum "
            "nicht auffindbar. Bitte die Material-ID des Bauteils beim Upload "
            "eintragen oder im Planungswerkzeug als Bauteilattribut hinterlegen."
        )

    # Ein Gesamtmodell enthaelt mehrere Bauteile aus Brettsperrholz, der
    # Upload traegt aber genau EINEN Ident. Welches Bauteil gemeint ist, kann
    # die Datei nicht sagen -- das darf nicht stillschweigend entschieden
    # werden, sonst haengt der Ident womoeglich am falschen Bauteil.
    candidates = _matching_elements(model, keyword)
    if len(candidates) > 1:
        others = ", ".join(
            f"{cname} (Nr. {_lookup(_collect_properties(model, cid), PROPERTY_ALIASES['noProductionList']) or cid})"
            for cid, cname in candidates
            if cid != element_id
        )
        warnings.append(
            f"Die Datei enthält {len(candidates)} Bauteile aus Brettsperrholz. "
            f"Übernommen wurde '{name or global_id}'; der angegebene Ident gilt "
            f"nur für dieses Bauteil. Nicht übernommen: {others}. Für die "
            "übrigen Bauteile bitte je einen eigenen Upload mit deren Ident."
        )

    planning: dict[str, Any] = {
        "ifcGlobalId": global_id,                                   # M-1168
        "ifcTyp": ifc_type[3:] if ifc_type.startswith("IFC") else ifc_type,
    }
    # Revit schreibt "IFCSLAB"; die Auswertung erwartet die Schreibweise der
    # IFC-Spezifikation ("IfcSlab").
    planning["ifcTyp"] = "Ifc" + planning["ifcTyp"].capitalize()    # M-1169

    if name:
        planning["bezeichnung"] = name                              # M-1170

    material = _material_of(model, element_id)
    if material:
        planning["material"] = material                             # M-1171

    # Projektspezifische Parameter (M-1172..M-1180). Fehlen sie, bleiben sie
    # leer — siehe Modulkopf. Laeuft VOR den beiden Ableitungen unten, damit
    # eine ausdrueckliche Angabe des Planers nicht ueberschrieben wird.
    for key, aliases in PROPERTY_ALIASES.items():
        value = _lookup(properties, aliases)
        if value:
            planning[key] = value

    # M-1173 Geschoss: die Angabe des Planers ("0.EG") schlaegt den
    # IfcBuildingStorey-Namen, der in cadwork-Exporten nur das generische
    # "Geschoss 1" traegt. Nur wenn keine Angabe vorliegt, gilt die Struktur.
    if "geschoss" not in planning:
        storey = _storey_of(model, element_id)
        if storey:
            planning["geschoss"] = storey

    # M-1177 Bauteil: ebenso -- "Außenwände"/"Decke" aus dem Property ist die
    # Aussage des Planers, die Ableitung aus Typ und Name nur die Notloesung.
    if "bauteil" not in planning:
        component = _component_kind(ifc_type, name)
        if component:
            planning["bauteil"] = component

    missing = [
        label
        for key, label in (
            ("bauabschnitt", "Bauabschnitt (M-1179)"),
            ("sichtqualitaet", "Sichtqualität (M-1180)"),
            ("abbundBvn", "Abbund/BVN (M-1178)"),
            ("noProductionList", "Nummer Produktionsliste (M-1175)"),
        )
        if key not in planning
    ]
    if missing:
        warnings.append(
            "Die IFC-Datei enthält folgende projektspezifische Parameter nicht: "
            + ", ".join(missing)
            + ". Sie werden im Anwendungsfall als fehlend ausgewiesen."
        )

    # Geplante Geometrie (kein Merkmal der Informationsbedarfstiefe, aber die
    # einzige Quelle fuer den Soll-Ist-Abgleich gegen die Fertigung).
    geometry: dict[str, str] = {}
    normalized = {k.strip().lower(): v for k, v in properties.items()}
    for source, target in QUANTITY_KEYS.items():
        value = normalized.get(source)
        if value:
            geometry[target] = value
    # Revit benennt die Mengen im deutschen Export abweichend.
    for source, target in (("fläche", "nettoflaeche"), ("volumen", "nettovolumen"),
                           ("höhe", "hoehe")):
        if target not in geometry and normalized.get(source):
            geometry[target] = normalized[source]

    project = _project_info(model)

    document: dict[str, Any] = {
        "timberconnect_ifc": {
            "format": "ifc_planung",
            "version": "1.0",
            "source_file": source_filename,
            "schema": _schema_of(text),
        },
        "__docId": doc_id,
        "identification": {"identity": [epc]},
        "planning": planning,
    }
    if geometry:
        document["geometry"] = geometry
    if project:
        document["project"] = project

    logger.info(
        "IFC '%s': Bauteil #%d (%s, GlobalId %s), %d Merkmale, %d Properties gelesen",
        source_filename, element_id, ifc_type, global_id, len(planning), len(properties),
    )
    return document, warnings


def _schema_of(text: str) -> Optional[str]:
    """IFC-Schemaversion aus dem HEADER (IFC2X3, IFC4, ...)."""
    match = re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'", text)
    return match.group(1) if match else None


def _project_info(model: _IFCModel) -> dict[str, str]:
    """Projektname und -nummer aus IfcProject.

    Ordnet den Planungsdatensatz dem Bauvorhaben zu — im Awf "Dokumentation"
    die Verortung oberhalb des Geschosses.
    """
    info: dict[str, str] = {}
    for eid, args in model.of_type("IFCPROJECT"):
        # IfcProject: GlobalId(0), OwnerHistory(1), Name(2), Description(3),
        # ObjectType(4), LongName(5), Phase(6)
        number = _as_string(args[2]) if len(args) > 2 else None
        long_name = _as_string(args[5]) if len(args) > 5 else None
        phase = _as_string(args[6]) if len(args) > 6 else None
        if number:
            info["projektnummer"] = number
        if long_name:
            info["projektname"] = long_name
        if phase:
            info["projektphase"] = phase
        del eid
        break
    return info
