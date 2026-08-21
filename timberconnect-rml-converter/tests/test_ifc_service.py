"""
Tests fuer den IFC-Service (Ausfuehrungsplanung).

Zwei Dinge muessen sitzen:

  1. Was die Datei hergibt, wird korrekt gelesen — inklusive der Umwege, die
     Revit-Exporte gehen (Material am TYP statt am Bauteil, Geschoss ueber
     IfcRelContainedInSpatialStructure, Umlaute als STEP-Escapes).
  2. Was die Datei NICHT hergibt, wird nicht erfunden. Der Anwendungsfall
     "Dokumentation" lebt davon, Luecken auszuweisen statt zu fuellen —
     ein geratener Bauabschnitt waere schlimmer als gar keiner.

Ausfuehren:  pytest tests/test_ifc_service.py
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.file_detector import FileType, detect_file_type  # noqa: E402
from services.ifc_service import IFCError, parse_ifc  # noqa: E402

PLATE_EPC = "urn:epc:id:sgtin:4047111124.015.M24"


def _build_ifc(
    *,
    element: str = "IFCSLAB('3vyFm6FjX9mhMTaYZ8JVH7',#6,'BSP-Boden',$,$,#70,#239,'2522519',.NOTDEFINED.)",
    extra_entities: str = "",
    schema: str = "IFC2X3",
) -> bytes:
    """Minimale, aber strukturell echte IFC-Datei.

    Nachgebaut nach dem Aufbau von M24_Auszug.ifc (Revit-Export): das Bauteil
    haengt ueber IfcRelContainedInSpatialStructure am Geschoss und ueber
    IfcRelDefinesByType am Typ, das Material haengt am TYP.
    """
    return f"""ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('M24_Auszug .ifc','2026-08-19T15:34:41+01:00',(''),(''),'','','');
FILE_SCHEMA(('{schema}'));
ENDSEC;

DATA;
#6=IFCOWNERHISTORY($,$,$,.NOCHANGE.,$,$,$,1787146480);
#18=IFCPROJECT('2B2cP1dRL9aBs2TYgyQdm5',#6,'2018_01','Neubau',$,'Wohnhaus Musterstra\\X\\DFe','Entwurf',(#13),#1465);
#25=IFCBUILDINGSTOREY('3YU2iCvZTFMfj8YmcRyPNd',#6,'Geschoss 1',$,$,#24,$,'Geschoss 1',.ELEMENT.,0.);
#240={element};
#241=IFCTYPEPRODUCT('1QBQiUWJT4OQj5OZnrjp06',#6,'BSP-Boden',$,$,$,$,'2522517');
#242=IFCMATERIAL('BSP-5 lagig');
#243=IFCRELASSOCIATESMATERIAL('0aaaaaaaaaaaaaaaaaaaaa',#6,$,$,(#241),#242);
#259=IFCELEMENTQUANTITY('0eIj4PE0PtjnJ3_emupfj0',#6,'BaseQuantities',$,$,(#260,#261));
#260=IFCQUANTITYAREA('NetArea',$,$,32.887207999999987);
#261=IFCQUANTITYVOLUME('NetVolume',$,$,4.0458212399999978);
#262=IFCRELDEFINESBYPROPERTIES('1bbbbbbbbbbbbbbbbbbbbb',#6,$,$,(#240),#259);
{extra_entities}
#1351=IFCRELCONTAINEDINSPATIALSTRUCTURE('1QBQiUWJT4OQj5OZrrjyoh',#6,$,$,(#240),#25);
#1364=IFCRELDEFINESBYTYPE('3cByR03ccUzp88ARt8u05f',#6,$,$,(#240),#241);
ENDSEC;
END-ISO-10303-21;
""".encode("utf-8")


# ---------------------------------------------------------------------------
# Was die Datei hergibt
# ---------------------------------------------------------------------------

def test_liest_die_merkmale_der_beispieldatei():
    document, _ = parse_ifc(_build_ifc(), "abc123", PLATE_EPC, "M24_Auszug.ifc")
    planning = document["planning"]

    assert planning["ifcGlobalId"] == "3vyFm6FjX9mhMTaYZ8JVH7"   # M-1168
    assert planning["ifcTyp"] == "IfcSlab"                        # M-1169
    assert planning["bezeichnung"] == "BSP-Boden"                 # M-1170
    assert planning["material"] == "BSP-5 lagig"                  # M-1171
    assert planning["geschoss"] == "Geschoss 1"                   # M-1173
    assert planning["bauteil"] == "Boden"                         # M-1177


def test_ident_steht_im_dokument():
    document, _ = parse_ifc(_build_ifc(), "abc123", PLATE_EPC)
    # Array-Notation wie im ERP-Pfad.
    assert document["identification"]["identity"] == [PLATE_EPC]


def test_liest_mengen_und_projekt():
    document, _ = parse_ifc(_build_ifc(), "abc123", PLATE_EPC)

    assert document["geometry"]["nettoflaeche"].startswith("32.887")
    assert document["geometry"]["nettovolumen"].startswith("4.045")
    assert document["project"]["projektnummer"] == "2018_01"
    assert document["timberconnect_ifc"]["schema"] == "IFC2X3"


def test_loest_step_escapes_auf():
    """Umlaute stehen im STEP-Format als \\X\\<hex> — sonst landet
    "Musterstra\\X\\DFe" im Datenraum."""
    document, _ = parse_ifc(_build_ifc(), "abc123", PLATE_EPC)
    assert document["project"]["projektname"] == "Wohnhaus Musterstraße"


def test_material_wird_auch_am_typ_gefunden():
    """Revit haengt das Material an den TYP, nicht an das Bauteil."""
    document, _ = parse_ifc(_build_ifc(), "abc123", PLATE_EPC)
    assert document["planning"]["material"] == "BSP-5 lagig"


def test_bauteilart_aus_dem_namen_schlaegt_den_ifc_typ():
    """IfcSlab hiesse "Decke"; der Planer nennt es "BSP-Boden" — dann gilt
    seine Absicht."""
    document, _ = parse_ifc(_build_ifc(), "abc123", PLATE_EPC)
    assert document["planning"]["bauteil"] == "Boden"

    wand = _build_ifc(
        element="IFCWALL('3vyFm6FjX9mhMTaYZ8JVH7',#6,'BSP-Wand',$,$,#70,#239,'2522519')"
    )
    document, _ = parse_ifc(wand, "abc123", PLATE_EPC)
    assert document["planning"]["bauteil"] == "Wand"
    assert document["planning"]["ifcTyp"] == "IfcWall"


def test_liest_projektspezifische_parameter_wenn_vorhanden():
    """Traegt die IFC die Parameter doch, muessen sie ankommen."""
    extra = """#300=IFCPROPERTYSINGLEVALUE('Bauabschnitt',$,IFCLABEL('BA-1'),$);
#301=IFCPROPERTYSINGLEVALUE('Sichtqualit\\X\\E4t',$,IFCLABEL('NSI'),$);
#302=IFCPROPERTYSINGLEVALUE('Abbund',$,IFCLABEL('40001'),$);
#303=IFCPROPERTYSINGLEVALUE('Produktionsliste',$,IFCLABEL('194'),$);
#304=IFCPROPERTYSINGLEVALUE('Teilgruppe',$,IFCLABEL('Tragwerk'),$);
#305=IFCPROPERTYSINGLEVALUE('Einbau',$,IFCLABEL('Einbau Werk'),$);
#306=IFCPROPERTYSINGLEVALUE('SKU',$,IFCLABEL('M24'),$);
#310=IFCPROPERTYSET('2eFtdhptfcbpp7w_3b7aQ2',#6,'Andere',$,(#300,#301,#302,#303,#304,#305,#306));
#311=IFCRELDEFINESBYPROPERTIES('2cccccccccccccccccccc',#6,$,$,(#240),#310);"""

    document, warnings = parse_ifc(
        _build_ifc(extra_entities=extra), "abc123", PLATE_EPC
    )
    planning = document["planning"]

    assert planning["bauabschnitt"] == "BA-1"              # M-1179
    assert planning["sichtqualitaet"] == "NSI"             # M-1180
    assert planning["abbundBvn"] == "40001"                # M-1178
    assert planning["noProductionList"] == "194"           # M-1175
    assert planning["teilgruppe"] == "Tragwerk"            # M-1174
    assert planning["einbauUndAnlieferung"] == "Einbau Werk"  # M-1172
    assert planning["sku"] == "M24"                        # M-1176
    assert warnings == []


def test_liest_cadwork_schreibweise():
    """cadwork benennt dieselben Merkmale anders als Revit.

    Die Sortiernummer ("05-") ist eine Anzeigehilfe der Software, "Group"
    steht fuer das Geschoss, und "Anliefung" ist der tatsaechliche Feldname
    in der Datei (nicht "Anlieferung"). Ohne diese Aliase blieben bei einer
    cadwork-Datei GENAU die Merkmale leer, um die es im Awf geht.
    """
    extra = """#300=IFCPROPERTYSINGLEVALUE('06-Bauabschnitt',$,IFCLABEL('BA-1'),$);
#301=IFCPROPERTYSINGLEVALUE('Sichtqualit\\X2\\00E4\\X0\\t S1',$,IFCLABEL('NSI'),$);
#302=IFCPROPERTYSINGLEVALUE('05-Abbund/ BVN',$,IFCLABEL('40001'),$);
#303=IFCPROPERTYSINGLEVALUE('No. production list',$,IFCLABEL('194'),$);
#304=IFCPROPERTYSINGLEVALUE('08-Teilgruppe',$,IFCLABEL('Tragwerk'),$);
#305=IFCPROPERTYSINGLEVALUE('13-Einbau & Anliefung',$,IFCLABEL('Einbau Werk'),$);
#306=IFCPROPERTYSINGLEVALUE('SKU',$,IFCLABEL('M24'),$);
#307=IFCPROPERTYSINGLEVALUE('04-Bauteil',$,IFCLABEL('Boden'),$);
#308=IFCPROPERTYSINGLEVALUE('Group',$,IFCLABEL('0.EG'),$);
#310=IFCPROPERTYSET('2eFtdhptfcbpp7w_3b7aQ2',#6,'Cadwork3dProperties',$,(#300,#301,#302,#303,#304,#305,#306,#307,#308));
#311=IFCRELDEFINESBYPROPERTIES('2cccccccccccccccccccc',#6,$,$,(#240),#310);"""

    document, warnings = parse_ifc(
        _build_ifc(extra_entities=extra), "abc123", PLATE_EPC
    )
    planning = document["planning"]

    assert planning["bauabschnitt"] == "BA-1"
    assert planning["sichtqualitaet"] == "NSI"
    assert planning["abbundBvn"] == "40001"
    assert planning["noProductionList"] == "194"
    assert planning["teilgruppe"] == "Tragwerk"
    assert planning["einbauUndAnlieferung"] == "Einbau Werk"
    assert planning["sku"] == "M24"
    assert warnings == []


def test_angabe_des_planers_schlaegt_die_ableitung():
    """"04-Bauteil" und "Group" sind Aussagen des Planers.

    Sie muessen die Notloesungen schlagen: die Bauteilart aus dem Namen und
    das generische "Geschoss 1" aus der IfcBuildingStorey-Struktur.
    """
    extra = """#307=IFCPROPERTYSINGLEVALUE('04-Bauteil',$,IFCLABEL('Au\\X2\\00DF\\X0\\enw\\X2\\00E4\\X0\\nde'),$);
#308=IFCPROPERTYSINGLEVALUE('Group',$,IFCLABEL('0.EG'),$);
#310=IFCPROPERTYSET('2eFtdhptfcbpp7w_3b7aQ2',#6,'Cadwork3dProperties',$,(#307,#308));
#311=IFCRELDEFINESBYPROPERTIES('2cccccccccccccccccccc',#6,$,$,(#240),#310);"""

    document, _ = parse_ifc(_build_ifc(extra_entities=extra), "abc123", PLATE_EPC)

    # Ohne die Properties waere es "Boden" (aus dem Namen) und "Geschoss 1".
    assert document["planning"]["bauteil"] == "Außenwände"
    assert document["planning"]["geschoss"] == "0.EG"


def test_gesamtmodell_waehlt_bsp_und_warnt():
    """Ein Gesamtmodell enthaelt viele Bauteile, der Upload einen Ident.

    Ohne Namensfilter landete das erstbeste Element (hier eine Daemmplatte)
    als "das Bauteil" im Datenraum; ohne Warnung bliebe unbemerkt, dass der
    Ident nur fuer eines von mehreren gilt.
    """
    weitere = """#400=IFCSLAB('1aaaaaaaaaaaaaaaaaaaaa',#6,'BSP-Decke',$,$,#70,#239,'2522520',.NOTDEFINED.);
#401=IFCMEMBER('1bbbbbbbbbbbbbbbbbbbbb',#6,'Konterlattung',$,$,#70,#239,'2522521',.NOTDEFINED.);"""

    # Die Daemmplatte steht VOR dem BSP-Bauteil in der Datei.
    davor = """#100=IFCBUILDINGELEMENTPROXY('1cccccccccccccccccccc',#6,'Tackerd\\X\\E4mmplatte',$,$,#70,#239,'2522500',.NOTDEFINED.);"""

    document, warnings = parse_ifc(
        _build_ifc(extra_entities=davor + "\n" + weitere), "abc123", PLATE_EPC
    )

    # Nicht die Daemmplatte, sondern das erste Bauteil aus Brettsperrholz.
    assert document["planning"]["bezeichnung"] == "BSP-Boden"
    assert len(warnings) >= 1
    assert any("BSP-Decke" in w and "Ident" in w for w in warnings)


def test_auszug_mit_einem_bauteil_warnt_nicht():
    """Der Regelfall — eine Datei, ein Bauteil, keine Mehrdeutigkeit."""
    _, warnings = parse_ifc(_build_ifc(), "abc123", PLATE_EPC)
    assert not any("Bauteile aus Brettsperrholz" in w for w in warnings)


# ---------------------------------------------------------------------------
# Was die Datei NICHT hergibt
# ---------------------------------------------------------------------------

def test_erfindet_fehlende_parameter_nicht():
    """Der Revit-Export der Beispieldatei fuehrt diese Parameter nicht — sie
    duerfen weder geraten noch stillschweigend weggelassen werden."""
    document, warnings = parse_ifc(_build_ifc(), "abc123", PLATE_EPC)
    planning = document["planning"]

    for key in ("bauabschnitt", "sichtqualitaet", "abbundBvn", "noProductionList"):
        assert key not in planning

    # Und der Uploader erfaehrt davon.
    assert len(warnings) == 1
    assert "Bauabschnitt" in warnings[0]
    assert "Sichtqualität" in warnings[0]


# ---------------------------------------------------------------------------
# Fehlerfaelle
# ---------------------------------------------------------------------------

def test_ohne_ident_bricht_ab():
    """Weder in der Datei noch beim Upload — dann fehlt die Verknuepfung."""
    with pytest.raises(IFCError, match="Kein Produkt-Ident"):
        parse_ifc(_build_ifc(), "abc123", "")


def test_ungueltiger_ident_bricht_ab():
    with pytest.raises(IFCError, match="Ungültiger Produkt-Ident"):
        parse_ifc(_build_ifc(), "abc123", "M24")


# ---------------------------------------------------------------------------
# Ident aus der Datei (Bauteilattribut "Identity")
# ---------------------------------------------------------------------------

def _ifc_mit_identity(wert: str = PLATE_EPC, feld: str = "Identity") -> bytes:
    extra = (
        f"#320=IFCPROPERTYSINGLEVALUE('{feld}',$,IFCLABEL('{wert}'),$);\n"
        "#321=IFCPROPERTYSET('2ffffffffffffffffffff',#6,'Cadwork3dProperties',$,(#320));\n"
        "#322=IFCRELDEFINESBYPROPERTIES('2ggggggggggggggggggg',#6,$,$,(#240),#321);"
    )
    return _build_ifc(extra_entities=extra)


def test_ident_aus_der_datei_ohne_upload():
    """Traegt das Bauteil den Ident, muss beim Upload nichts angegeben werden.

    Gleiche Konvention wie das versteckte AcroForm-Feld der PDFs.
    """
    document, warnings = parse_ifc(_ifc_mit_identity(), "abc123", "")

    assert document["identification"]["identity"] == [PLATE_EPC]
    # Die Luecken-Warnung der Testdatei bleibt; zum Ident schweigt sie.
    assert not any("Ident" in w for w in warnings)


def test_ident_aus_der_datei_erscheint_nicht_als_merkmal():
    """"Identity" ist die Verknuepfung, kein Planungsmerkmal.

    Stuende es unter den Merkmalen, taeuchte der Ident als Zeile in der
    Ansicht auf -- er gehoert dort nicht hin.
    """
    document, _ = parse_ifc(_ifc_mit_identity(), "abc123", "")
    assert not any(
        "identity" in key.lower() for key in document["planning"]
    )


@pytest.mark.parametrize("feld", ["Identity", "GS1-EPC", "Material-ID"])
def test_ident_unter_verschiedenen_feldnamen(feld: str):
    """Planungswerkzeuge benennen benutzerdefinierte Attribute frei."""
    document, _ = parse_ifc(_ifc_mit_identity(feld=feld), "abc123", "")
    assert document["identification"]["identity"] == [PLATE_EPC]


def test_datei_schlaegt_abweichenden_upload_ident():
    """Bei Widerspruch gewinnt die Datei -- und der Nutzer erfaehrt davon.

    Der eingetippte Wert ist die unsicherere Quelle; ein stillschweigendes
    Ueberschreiben haenge die Planung an das falsche Bauteil.
    """
    anderer = "urn:epc:id:sgtin:4047111124.015.ANDERS"
    document, warnings = parse_ifc(_ifc_mit_identity(), "abc123", anderer)

    assert document["identification"]["identity"] == [PLATE_EPC]
    assert any(anderer in w and "Datei" in w for w in warnings)


def test_uebereinstimmender_upload_ident_warnt_nicht():
    _, warnings = parse_ifc(_ifc_mit_identity(), "abc123", PLATE_EPC)
    assert not any("Ident" in w for w in warnings)


def test_unbrauchbarer_ident_in_der_datei_faellt_auf_den_upload_zurueck():
    """Eine Kennung, die kein GS1-EPC ist, darf nicht durchrutschen."""
    document, warnings = parse_ifc(
        _ifc_mit_identity(wert="Bauteil-194"), "abc123", PLATE_EPC
    )

    assert document["identification"]["identity"] == [PLATE_EPC]
    assert any("Bauteil-194" in w for w in warnings)


def test_ohne_bauteil_bricht_ab():
    ohne = b"""ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#6=IFCOWNERHISTORY($,$,$,.NOCHANGE.,$,$,$,1787146480);
ENDSEC;
END-ISO-10303-21;
"""
    with pytest.raises(IFCError, match="Kein Bauteil"):
        parse_ifc(ohne, "abc123", PLATE_EPC)


def test_fremde_datei_ist_keine_ifc():
    with pytest.raises(IFCError, match="Keine IFC-Datei"):
        parse_ifc(b"{'kein': 'ifc'}", "abc123", PLATE_EPC)


# ---------------------------------------------------------------------------
# Erkennung
# ---------------------------------------------------------------------------

def test_detect_erkennt_ifc():
    detection = detect_file_type(_build_ifc(), "M24_Auszug.ifc")

    assert detection.file_type == FileType.IFC
    assert detection.data_type == "planung"
    assert detection.mapping_id == "ifc_planung"
    assert detection.is_recognized
    # Der Ident kommt beim Upload, nicht aus der Datei.
    assert detection.trace_id is None


def test_detect_verwechselt_json_nicht_mit_ifc():
    detection = detect_file_type(b'{"hallo": "welt"}', "irgendwas.json")
    assert detection.file_type != FileType.IFC


# ---------------------------------------------------------------------------
# Die echte Beispieldatei
# ---------------------------------------------------------------------------

EXAMPLE = (
    Path(__file__).parent.parent / "examples" / "ifc_ausfuehrungsplanung_beispiel.ifc"
)


def test_beispieldatei_liefert_alle_merkmale():
    """Der Auszug aus dem ECHTEN Planungsmodell des Projektteams.

    cadwork IFC4, BSP-Boden Nr. 194, geschnitten aus M24_gesamt.ifc mit
    scripts/extract_ifc_element.py. Prueft die Merkmale gegen die Auswertung
    des Projektteams ("Auswertung_Ausfuehrungsplanung_BSP_v1.xlsx",
    M-1168..M-1180). Schlaegt dieser Test fehl, wurde die Beispieldatei
    ausgetauscht oder beschnitten.

    Abgrenzung: Diese Datei belegt, dass der Parser mit einem UNVERAENDERTEN
    Export der Planungssoftware zurechtkommt. Der zusammenhaengende
    Demo-Datensatz benutzt dagegen
    demo-dateien/5_Ausfuehrungsplanung/PFLICHT_ausfuehrungsplanung.ifc --
    dieselbe Struktur, aber auf die Idente und Masse der Demo-Kette gesetzt
    (geprueft von demo-dateien/tools/pruefe_verknuepfung.py).
    """
    if not EXAMPLE.exists():  # pragma: no cover - nur bei fehlender Datei
        pytest.skip(f"Beispieldatei fehlt: {EXAMPLE}")

    document, warnings = parse_ifc(
        EXAMPLE.read_bytes(), "abc123", PLATE_EPC, EXAMPLE.name
    )
    planning = document["planning"]

    assert planning["ifcGlobalId"] == "3vyFm6FjX9mhMTaYZ8JVH7"  # M-1168
    assert planning["ifcTyp"] == "IfcSlab"                       # M-1169
    assert planning["bezeichnung"] == "BSP-Boden"                # M-1170
    assert planning["material"] == "BSP-5 lagig"                 # M-1171
    assert planning["einbauUndAnlieferung"] == "Einbau Werk"     # M-1172
    assert planning["geschoss"] == "0.EG"                        # M-1173
    assert planning["teilgruppe"] == "Tragwerk"                  # M-1174
    assert planning["noProductionList"] == "194"                 # M-1175
    assert planning["sku"] == "M24"                              # M-1176
    assert planning["bauteil"] == "Boden"                        # M-1177
    assert planning["abbundBvn"] == "40001"                      # M-1178
    assert planning["bauabschnitt"] == "BA-1"                    # M-1179
    assert planning["sichtqualitaet"] == "NSI"                   # M-1180

    assert document["project"]["projektnummer"] == "Kita Monschau"
    assert document["timberconnect_ifc"]["schema"] == "IFC4"

    # Vollstaendig und eindeutig: keine Luecken-, keine Mehrdeutigkeitswarnung.
    assert warnings == []


def test_beispieldatei_wird_erkannt():
    if not EXAMPLE.exists():  # pragma: no cover - nur bei fehlender Datei
        pytest.skip(f"Beispieldatei fehlt: {EXAMPLE}")

    detection = detect_file_type(EXAMPLE.read_bytes(), EXAMPLE.name)
    assert detection.file_type == FileType.IFC
    assert detection.mapping_id == "ifc_planung"
    assert detection.is_recognized
