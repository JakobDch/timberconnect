"""
PDF Template Service

Registry der ausfuellbaren PDF-Vorlagen (AcroForms) fuer die manuelle
Datenuebernahme "PDF -> Knowledge Graph". Der Nutzer fuellt die Original-
Template-PDF direkt im Viewer aus (PDF.js, Formularfelder); beim Absenden
werden die AcroForm-Werte ausgelesen und hier verarbeitet.

Jeder Registry-Eintrag bindet einen Datenpunkt an:
  * ``pdf``       — den AcroForm-Feldnamen im Template-PDF
                    (bei Tabellen-Zeilen ein Muster mit ``{n}``, z.B. "Fmax_{n}")
  * ``key``       — den JSON-Schluessel, den das RML-Mapping referenziert
  * ``predicate`` — das Praedikat der TimberConnect-Ontologie v6

Daraus entstehen:
  1. das maschinenlesbare JSON-Dokument (pdf_fields_to_form_data +
     build_document_json = "Extraktor"),
  2. die RML-Mappings (generate_pdf_mappings.py -> mappings/pdf_*.rml.ttl),
  3. die Template-Liste fuer den Viewer (GET /api/converter/pdf-templates;
     die Template-PDF selbst kommt von .../pdf-templates/{id}/file).

Die Konsistenz Registry <-> PDF prueft tests/test_pdf_field_names.py.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional

TC = "http://timberconnect.2050.de/ontology#"
RESOURCE_BASE = "http://timberconnect.2050.de/resource"

PDF_TEMPLATES_DIR = Path(__file__).parent.parent / "pdf_templates"


class PDFTemplateError(Exception):
    """Fehler bei Validierung/Aufbereitung von PDF-Formulardaten."""
    pass


def _f(
    key: str,
    label: str,
    predicate: str,
    pdf: str,
    ftype: str = "text",
    unit: Optional[str] = None,
    options: Optional[list[str]] = None,
    required: bool = False,
    datatype: Optional[str] = None,
    demo: Any = None,
) -> dict:
    """Kurzform fuer eine Felddefinition (pdf = AcroForm-Feldname).

    ``demo`` ist ein realistischer Beispielwert fuer die Demo-Befuellung im
    Viewer. Er steht bewusst hier neben der Felddefinition -- so kann er nicht
    aus dem Tritt geraten, wenn sich Feldname oder Typ aendern.
    """
    if datatype is None and ftype == "number":
        datatype = "xsd:decimal"
    return {
        "key": key,
        "label": label,
        "type": ftype,
        "unit": unit,
        "options": options,
        "required": required,
        "predicate": predicate,
        "datatype": datatype,
        "pdf": pdf,
        "demo": demo,
    }


# =============================================================================
# Materialbezug: Einteilung der Templates (A / B / C)
# =============================================================================
#
# Nicht jedes Dokument gehoert in den Materialfluss. Ein EPCIS-Event beschreibt
# eine Bewegung oder Umwandlung von Holz -- ein Produktdatenblatt tut das nicht.
# Die Einteilung entscheidet, ob der Viewer beim Ausfuellen nach dem bezogenen
# Holz fragt (und damit ein Event erzeugt werden kann) oder nicht.
#
#   MATERIAL_REF_REQUIRED ("A")
#       Das Dokument beschreibt eine Bewegung/Umwandlung konkreten Holzes.
#       Der Viewer fragt nach dem EPC-Bezug; damit kann ein Event entstehen.
#
#   MATERIAL_REF_OPTIONAL ("B")
#       Eigene Ware ohne zwingenden Vorbezug. Der Bezug darf angegeben werden,
#       ist aber nicht Pflicht. (Derzeit von keinem Template genutzt --
#       vorgesehen fuer kuenftige Lieferschein-artige Vorlagen.)
#
#   MATERIAL_REF_NONE ("C")
#       Beschreibt einen Produkt-TYP, keine konkrete Charge. Bekommt bewusst
#       keine SGTIN/LGTIN. Die Verknuepfung laeuft ueber Eigenschaften im
#       RDF-Graph (z.B. "Bauteil X wurde verleimt mit Klebstoff Y"), nicht
#       ueber EPCIS. Das ist kein Mangel, sondern die fachlich richtige Stelle.
#
# WICHTIG: Jedes Dokument hat unabhaengig davon IMMER eine Dokument-ID (den
# Hash des Originals). "Kein Materialbezug" heisst also nicht "nicht
# verknuepfbar", sondern nur "nicht Teil des EPCIS-Materialflusses".
MATERIAL_REF_REQUIRED = "required"
MATERIAL_REF_OPTIONAL = "optional"
MATERIAL_REF_NONE = "none"

# Feld-Key des EPC-Bezugs. Bewusst EIN Feld statt vieler: der Nutzer waehlt im
# Viewer aus dem, was bereits im Pod liegt (SGTIN/LGTIN) -- er tippt keine
# Nummer ab. Damit ist die Aussage bewusst getroffen und syntaktisch gueltig.
MATERIAL_REF_KEY = "materialEpc"

# Das Praedikat, unter dem der Bezug im Graph landet. Gleiches Praedikat wie
# bei hpr/eldat (ident_injector), damit EPC-Abfragen PDF- und Maschinendaten
# ohne Sonderfall finden.
MATERIAL_REF_PREDICATE = "tc:epc"


# =============================================================================
# Dokument-Ident: der von der ausstellenden Stelle ins PDF eingebettete EPC
# =============================================================================
#
# Ausstellende Stellen betten den GS1-Ident als verstecktes AcroForm-Feld
# ("Identity", Sichtbarkeit=Hidden, schreibgeschuetzt) in das PDF ein. Der
# Viewer liest ihn beim Upload aus dem Original und schickt ihn als
# extra_field mit.
#
# Er landet im SELBEN Feld wie der Materialbezug: MATERIAL_REF_KEY.
#
# Warum nicht in einem eigenen Feld -- obwohl Aussteller und Nutzer
# unterschiedliche Quellen sind:
#
# Das JSON ist eine Schnittstelle. Nachgelagerte Systeme (EPCIS-Event-
# Generierung beim EECC) lesen daraus die ID des Materials. Stehen dort
# mehrere Felder, die alle als ID in Frage kommen, muss der Leser raten oder
# nachfragen -- und ein falsch geratenes Feld erzeugt Events am falschen
# Objekt. Ein eindeutiges Feld ist mehr wert als die im Feldnamen kodierte
# Herkunft.
#
# Es gibt daher GENAU EIN Feld mit dem Ident. Woher er stammt, steht als
# Metadatum in "timberconnect_pdf.epcSource" -- ausserhalb von "fields",
# wo es niemand mit einem Datenpunkt verwechselt.
#
# Vorrang: eine ausdrueckliche Wahl des Nutzers gewinnt immer. Der
# eingebettete Ident fuellt nur eine Luecke, er ueberschreibt nichts.
DOCUMENT_EPC_KEY = MATERIAL_REF_KEY
DOCUMENT_EPC_PREDICATE = MATERIAL_REF_PREDICATE

# Herkunftswerte fuer timberconnect_pdf.epcSource.
EPC_SOURCE_DOCUMENT = "document"  # aus dem versteckten PDF-Feld gelesen
EPC_SOURCE_USER = "user"          # im Viewer ausgewaehlt

# Schluessel, unter dem der wirksame Ident in JEDE Zeile gespiegelt wird, damit
# auch Zeilen-Subjekte (Proben, Lieferung) ihn tragen.
#
# Doppelter Unterstrich wie __docId/__rowIndex: technischer Schluessel, kein
# Datenpunkt. Das ist hier keine Kosmetik -- die Datenpunktzaehlung speist die
# Bepreisung (1 Datenpunkt = 1 Token). Der Ident ist der Schluessel, unter dem
# die Daten gefunden werden, nicht selbst eine bezahlte Aussage; ihn pro
# Probenzeile mitzuzaehlen wuerde denselben Ident vielfach in Rechnung stellen.
ROW_EPC_KEY = "__epc"


# =============================================================================
# Vormaterial-Ident: woraus das beschriebene Material entstanden ist
# =============================================================================
#
# Der Ident oben beantwortet "WAS beschreibt dieses Dokument?". Fuer einen
# nachvollziehbaren Materialfluss fehlt die zweite Haelfte: "WORAUS ist es
# entstanden?".
#
# Beispiel Aufsaegung: eine Leistungserklaerung beschreibt die erzeugte
# Schnittholz-Charge (Output). Welches Rundholz-Los dafuer eingesetzt wurde
# (Input), weiss nur das Saegewerk -- und genau diese Angabe braucht das EECC,
# um ein EPCIS TransformationEvent zu bilden:
#
#     inputEPCList/inputQuantityList  <- materialInputEpc  (dieses Feld)
#     outputEPCList/outputQuantityList <- materialEpc      (der Ident oben)
#
# Ohne den Input bleibt jede Stufe eine Insel: die Idente existieren, aber
# nichts verbindet Faellvorgang, Polter und Schnittholz miteinander.
#
# Bewusst ein EIGENES Feld und NICHT unter tc:epc: Input und Output sind
# entgegengesetzte Aussagen. Beide unter dieselbe Property zu haengen wuerde
# bedeuten, dass eine Abfrage nach dem Ident des Rundholzes auch das daraus
# erzeugte Schnittholz zurueckliefert -- die Richtung des Materialflusses
# ginge verloren, und genau sie soll hier abgebildet werden.
MATERIAL_INPUT_KEY = "materialInputEpc"
MATERIAL_INPUT_PREDICATE = "tc:derivedFrom"

# Der Aussteller hinterlegt ihn analog zu "Identity" als verstecktes,
# schreibgeschuetztes AcroForm-Feld.
MATERIAL_INPUT_PDF_FIELD = "IdentityInput"


# =============================================================================
# Saegevorgaenge: n:m-Umwandlung Rundholz -> Schnittholzlamellen
# =============================================================================
#
# Format nach Absprache mit dem EECC (Albrecht, 06.08.2026). Ein Saegevorgang
# verarbeitet ein oder mehrere Rundhoelzer zu vielen Lamellen -- ein einzelnes
# Feldpaar Input/Output kann das nicht abbilden. Deshalb ein Array von
# Vorgaengen, jeder mit zwei EPC-Listen:
#
#     "fields": {
#       "sawings": [
#         { "materialInputEpc": [ "urn:epc:...643849625" ],
#           "materialEpc":      [ "urn:epc:...2356413958", ... ] },
#         ...
#       ]
#     }
#
# Jeder Eintrag wird beim EECC zu genau einem EPCIS-TransformationEvent:
# materialInputEpc -> inputEPCList, materialEpc -> outputEPCList.
#
# Die Aufloesung bestimmt der Aussteller:
#   hoch    -- ein Vorgang je Rundholz (1 Input, n Lamellen). Erlaubt die
#              Rueckverfolgung jeder Lamelle auf ihr konkretes Rundholz.
#   niedrig -- ein Vorgang fuer die ganze Charge (m Inputs, m*n Lamellen).
#              Guenstiger zu erfassen, aber die Zuordnung Lamelle->Rundholz
#              geht verloren.
#
# Bewusst innerhalb von "fields" und nicht unter "rows": "rows" ist unsere
# interne Struktur fuer wiederholte AcroForm-Zeilen (Probennummern o.ae.).
# Saegevorgaenge stammen nicht aus dem Formular, sondern aus den eingebetteten
# Identen -- und der EECC-Parser erwartet sie an dieser Stelle.
#
# OFFENER PUNKT (Albrecht/EECC, 06.08.2026): Der Name ist verallgemeinerbar --
# "tasks", "steps" oder ein deutsches Wort taeten es genauso, "nur die Struktur
# muss erhalten bleiben". Sinnvoll wird das, sobald der dritte Umwandlungsfall
# angebunden wird; heute liegen drei Faelle in drei Formen vor:
#
#   pdf_leistungserklaerung  sawings[]                 (n:m, dieses Format)
#   pdf_schnittbild          materialInputEpc          (Einzelwert)
#   ERP-Excel (Verleimen)    epcs / input_epcs         (zwei flache Listen)
#
# Bis dahin bleibt "sawings" stehen: das EECC baut seinen Adapter gerade
# darauf, und ein Umbenennen waehrend der laufenden Abstimmung kostet dort
# Arbeit, ohne dass hier etwas gewonnen waere.
SAWINGS_KEY = "sawings"

# Technische Schluessel, die der Extraktor in jeden Vorgang schreibt, damit das
# RML-Mapping daraus eine Subjekt-URI bilden kann. RML kann die Position im
# Array nicht selbst referenzieren, und ohne die Dokument-ID im Iterator-
# Kontext liesse sich der Vorgang nicht dem Dokument zuordnen.
SAWING_INDEX_KEY = "__sawingIndex"


def _sawings_section(hint: str) -> dict:
    """Sektion mit den Saegevorgaengen (EECC-Format, siehe SAWINGS_KEY).

    Nie Pflicht: eine Leistungserklaerung ohne eingebettete Idente bleibt
    uebertragbar, sie liefert dann nur keine Event-Grundlage.
    """
    return {
        "id": "saegevorgaenge",
        "title": "Sägevorgänge",
        "description": hint,
        "sawings": True,
        "fields": [
            _f(
                SAWINGS_KEY,
                "Sägevorgänge (Rundholz → Lamellen)",
                # Kein eigenes Praedikat: die Sektion wird gesondert
                # materialisiert (siehe generate_pdf_mappings.py), weil ein
                # Vorgang zwei Richtungen traegt.
                "",
                # Kein AcroForm-Feld: die Idente stehen im hochgeladenen
                # Original, nicht im Leerformular.
                "",
                ftype="sawings",
                required=False,
            ),
        ],
    }


def _material_input_section(hint: str) -> dict:
    """Sektion mit dem Ident des eingesetzten Vormaterials.

    Nie Pflicht: die meisten Dokumente beschreiben keine Umwandlung, und ein
    fehlender Input darf den Upload nicht blockieren. Wo er vorliegt, kann das
    EECC daraus ein TransformationEvent bilden.
    """
    return {
        "id": "vormaterial",
        "title": "Eingesetztes Vormaterial",
        "description": hint,
        "material_input": True,
        "fields": [
            _f(
                MATERIAL_INPUT_KEY,
                "Hergestellt aus",
                MATERIAL_INPUT_PREDICATE,
                # Kein AcroForm-Feld der VORLAGE: der Wert steht im
                # hochgeladenen Original, so wie der Ident selbst.
                "",
                ftype="epc_reference",
                required=False,
            ),
        ],
    }


def _document_ident_section() -> dict:
    """Ident-Sektion fuer Templates, die keinen Materialbezug haben.

    Templates der Gruppe A/B bringen den Ident bereits ueber
    ``_material_ref_section`` mit. Gruppe C (Klebstoffdatenblatt,
    Leistungserklaerung) hat keine solche Sektion -- ohne diese hier haetten
    genau die Dokumente, die einen eingebetteten Ident tragen koennen, kein
    Feld, in dem er landen kann.

    Nie Pflicht: die meisten PDFs tragen keinen eingebetteten Ident, und ein
    fehlender darf den Upload nicht blockieren.
    """
    return {
        "id": "dokumentident",
        "title": "Ident aus dem Dokument",
        "description": (
            "Von der ausstellenden Stelle im PDF hinterlegter GS1-Ident. "
            "Wird beim Hochladen automatisch aus dem Dokument gelesen."
        ),
        "document_ident": True,
        "fields": [
            _f(
                DOCUMENT_EPC_KEY,
                "Ident laut Dokument",
                DOCUMENT_EPC_PREDICATE,
                # Kein AcroForm-Feld der VORLAGE: der Wert steht im
                # hochgeladenen Original, nicht im Leerformular.
                "",
                ftype="epc_reference",
                required=False,
            ),
        ],
    }


# =============================================================================
# Pflanzflaeche: das im Viewer gezeichnete Polygon
# =============================================================================
#
# Beim Pflanzvorgang zeichnet der Nutzer die Flaeche, auf der gepflanzt wurde,
# auf einer Karte ein. Wie beim EPC-Bezug gibt es dafuer bewusst KEIN
# AcroForm-Feld: eine Flaeche tippt man nicht ab, man zeichnet sie.
#
# Der Nutzer liefert GeoJSON (so gibt es Leaflet heraus). Daraus leitet der
# Extraktor drei Datenpunkte ab:
#   * geo:asWKT    — die Flaeche als GeoSPARQL-WKT-Literal. Das ist die
#                    abfragbare Form ("liegt Punkt X in Polygon Y").
#   * geo:lat/long — der Schwerpunkt (Zentroid). Damit findet der bestehende
#                    Karten-/Koordinatencode im Viewer die Flaeche ohne
#                    Sonderfall, genau wie eine Maschinenposition.
# Das rohe GeoJSON bleibt zusaetzlich erhalten, damit die Zeichnung
# verlustfrei rekonstruierbar ist.
PLANTING_AREA_KEY = "pflanzflaeche"
PLANTING_AREA_WKT_KEY = "pflanzflaecheWkt"
PLANTING_AREA_LAT_KEY = "pflanzflaecheLat"
PLANTING_AREA_LON_KEY = "pflanzflaecheLon"


def _planting_area_section(hint: str, required: bool) -> dict:
    """Sektion mit der auf der Karte gezeichneten Pflanzflaeche."""
    return {
        "id": "pflanzflaeche",
        "title": "Pflanzfläche",
        "description": hint,
        "planting_area": True,
        "fields": [
            _f(
                PLANTING_AREA_KEY,
                "Gepflanzte Fläche (Karte)",
                "tc:plantingArea",
                # Kein AcroForm-Feld: die Flaeche wird im Viewer gezeichnet.
                "",
                ftype="polygon",
                required=required,
                # Demo: Waldstueck im Arnsberger Wald (ca. 20 ha), passend zur
                # Samenplantage in den uebrigen Beispielwerten.
                demo={
                    "type": "Polygon",
                    "coordinates": [[
                        [8.0680, 51.4060],
                        [8.0745, 51.4058],
                        [8.0758, 51.4112],
                        [8.0692, 51.4118],
                        [8.0680, 51.4060],
                    ]],
                },
            ),
            # Abgeleitet, nicht vom Nutzer eingegeben -- siehe _derive_planting_area.
            _f(
                PLANTING_AREA_WKT_KEY,
                "Fläche (WKT)",
                "geo:asWKT",
                "",
                ftype="derived",
                datatype="geo:wktLiteral",
            ),
            _f(
                PLANTING_AREA_LAT_KEY,
                "Flächenmittelpunkt: Breitengrad",
                "wgs84:lat",
                "",
                ftype="derived",
                datatype="xsd:decimal",
            ),
            _f(
                PLANTING_AREA_LON_KEY,
                "Flächenmittelpunkt: Längengrad",
                "wgs84:long",
                "",
                ftype="derived",
                datatype="xsd:decimal",
            ),
        ],
    }


def _material_ref_section(hint: str, required: bool) -> dict:
    """Sektion mit dem EPC-Bezug fuer Templates der Gruppen A und B.

    ``hint`` beschreibt in Nutzersprache, worauf sich das Dokument bezieht --
    er erscheint als Hilfetext ueber der Auswahl.
    """
    return {
        "id": "materialbezug",
        "title": "Bezug zum Holz",
        "description": hint,
        "material_ref": True,
        "fields": [
            _f(
                MATERIAL_REF_KEY,
                "Bezieht sich auf",
                MATERIAL_REF_PREDICATE,
                # Kein AcroForm-Feld: der Bezug wird im Viewer ausgewaehlt,
                # nicht in der Original-PDF eingetragen.
                "",
                ftype="epc_reference",
                required=required,
                # Demo-Rueckfall, wenn im Pod (noch) kein echter EPC liegt.
                # Der Viewer bevorzugt einen tatsaechlich vorhandenen EPC --
                # ein erfundener wuerde im Graph ins Leere zeigen.
                demo="urn:epc:class:lgtin:4012345.012345.LOT2026",
            ),
        ],
    }


# =============================================================================
# Template-Registry (7 ausfuellbare PDF-Vorlagen)
# =============================================================================

TEMPLATES: dict[str, dict] = {
    # -------------------------------------------------------------------------
    # 1. Pruefzertifikat KJZ — Saatgut-Pruefbericht (30 Felder)
    # -------------------------------------------------------------------------
    "pdf_pruefzertifikat": {
        "id": "pdf_pruefzertifikat",
        "label": "Prüfzertifikat Saatgut (KJZ)",
        "description": "Prüfbericht einer Saatgutprüfung: Reinheit, Tausendkornmasse, Feuchtigkeit und Keimprüfung (Landesbetrieb Wald und Holz NRW).",
        # Materialbezug: Prueft eine konkrete Saatgut-Partie (kennNr/regNr/ezrNr, Partiegroesse).
        "material_ref": MATERIAL_REF_REQUIRED,
        "doc_class": "Prüfbericht",
        "data_type": "pdf_pruefzertifikat",
        "main_class": "tc:TestReport",
        "subject_path": "testreport",
        "sections": [
            # EPC-Bezug zuerst: der Nutzer soll das Material waehlen,
            # bevor er Detaildaten eintraegt.
            _material_ref_section(
                "Auf welche Saatgut-Partie bezieht sich dieser Pruefbericht? Waehlen Sie das bereits erfasste Material aus.",
                required=True,
            ),
            {
                "id": "allgemein",
                "title": "Prüfbericht",
                "fields": [
                    _f("pruefberichtNr", "Prüfbericht Nr.", "tc:reportNumber", "Pruefbericht_Nr", required=True),
                    _f("datum", "Datum", "tc:date", "Datum_af_date"),
                ],
            },
            {
                "id": "einsender",
                "title": "Angaben des Einsenders",
                "fields": [
                    _f("kennNr", "Kenn-Nr.", "tc:identifier", "Kenn-Nr"),
                    _f("regNr", "Reg.-Nr.", "tc:registrationNumber", "Reg-Nr"),
                    _f("artBotanisch", "Art (botanische Bezeichnung)", "tc:species", "Art (botanische Bezeichnung)"),
                    _f("artDeutsch", "Art (deutsche Bezeichnung)", "tc:species", "Art (deutsche Bezeichnung)"),
                    _f("reifejahr", "Reifejahr", "tc:maturityYear", "Reifejahr_af_date"),
                    _f("einsender", "Einsender", "tc:senderName", "Einsender"),
                    _f("partiegroesse", "Partiegröße", "tc:lotSize", "Partiegroesse", ftype="number", unit="g"),
                    _f("herkunft", "Herkunft", "tc:origin", "Herkunft"),
                    _f("ezrNr", "EZR-Nr.", "tc:registerSign", "EZR-Nr"),
                    _f("sonstiges", "Sonstiges", "tc:comment", "Sonstiges"),
                ],
            },
            {
                "id": "untersuchung",
                "title": "Untersuchungsergebnisse",
                "fields": [
                    _f("reinheit", "Reinheit", "tc:purity", "Reinheit", ftype="number", unit="%"),
                    _f("samenAndererArten", "Samen anderer Arten", "tc:otherSpeciesSeedPercentage", "Samen anderer Arten", ftype="number", unit="%"),
                    _f("verunreinigungen", "Verunreinigungen", "tc:impurityPercentage", "Verunreinigungen", ftype="number", unit="%"),
                    _f("tkm", "TKM (Tausendkornmasse)", "tc:thousandSeedWeight", "TKM", ftype="number", unit="g"),
                    _f("feuchtegehalt", "Feuchtegehalt", "tc:moistureContent", "Feuchtegehalt", ftype="number", unit="%"),
                ],
            },
            {
                "id": "keimpruefung",
                "title": "Keimprüfung",
                "fields": [
                    _f("keimschnelligkeit", "Keimschnelligkeit", "tc:germinationSpeed", "Keimschnelligkeit", ftype="number", unit="%"),
                    _f("keimschnelligkeitWochen", "Keimschnelligkeit nach Wochen", "tc:germinationSpeedWeeks", "Keimschnelligkeit in Wochen", ftype="number"),
                    _f("keimfaehigkeit", "Keimfähigkeit", "tc:germinationRate", "Keimfaehigkeit", ftype="number", unit="%"),
                    _f("keimfaehigkeitWochen", "Keimfähigkeit nach Wochen", "tc:germinationRateWeeks", "Keimfaehigkeit in Wochen", ftype="number"),
                    _f("harteSamen", "Harte Samen", "tc:hardSeedPercentage", "Harte Samen", ftype="number", unit="%"),
                    _f("frischeSamen", "Frische Samen", "tc:freshSeedPercentage", "Frische Samen", ftype="number", unit="%"),
                    _f("anomaleSamen", "Anomale S. Samen", "tc:abnormalSeedPercentage", "Anomale S Samen", ftype="number", unit="%"),
                    _f("fauleSamen", "Faule Samen", "tc:rottenSeedPercentage", "Faule Samen", ftype="number", unit="%"),
                    _f("hohleSamen", "Hohle Samen", "tc:hollowSeedPercentage", "Hohle Samen", ftype="number", unit="%"),
                ],
            },
            {
                "id": "ergebnis",
                "title": "Ergebnis",
                "fields": [
                    _f("keimfaehigeSamenJeKg", "Anzahl keimfähiger Samen je kg Saatgut", "tc:viableSeedsPerKg", "Anzahl keimfaehiger Samen je kg Saatgut", ftype="number"),
                    _f("bemerkungen", "Bemerkungen", "tc:description", "Bemerkungen"),
                    _f("keimverlauf", "Keimverlauf", "tc:germinationCurve", "Keimverlauf"),
                    _f("unterschrift", "Unterschrift", "tc:signature", "Unterschrift"),
                ],
            },
        ],
    },
    # -------------------------------------------------------------------------
    # 2. LOCTITE HB S ECO PURBOND — Technisches Datenblatt (29 Felder)
    # -------------------------------------------------------------------------
    "pdf_klebstoffdatenblatt": {
        "id": "pdf_klebstoffdatenblatt",
        "label": "Klebstoff-Datenblatt (LOCTITE BSP)",
        "description": "Technisches Datenblatt eines Klebstoffs für Flächenverklebung/Keilzinkung (z.B. LOCTITE HB S ECO PURBOND).",
        # Materialbezug: Beschreibt einen Produkt-TYP (LOCTITE), keine Charge. Verknuepfung im
        # Graph ueber das Bauteil, das damit verleimt wurde -- nicht ueber EPCIS.
        "material_ref": MATERIAL_REF_NONE,
        "doc_class": "Technisches Datenblatt",
        "data_type": "pdf_klebstoffdatenblatt",
        "main_class": "tc:Adhesive",
        "subject_path": "adhesive",
        "sections": [
            {
                "id": "produkt",
                "title": "Produktbeschreibung",
                "fields": [
                    _f("produktname", "Produktbezeichnung", "tc:name", "Produktbezeichnung", required=True),
                    _f("technologie", "Technologie", "tc:technology", "Technologie"),
                    _f("produkttyp", "Produkttyp", "tc:type", "Produkttyp"),
                    _f("auftrag", "Auftrag", "tc:applicationMethod", "Auftrag"),
                    _f("komponenten", "Komponenten", "tc:components", "Komponenten"),
                    _f("basis", "Basis", "tc:baseMaterial", "Basis"),
                    _f("beschaffenheit", "Beschaffenheit", "tc:consistency", "Beschaffenheit"),
                    _f("aussehen", "Aussehen", "tc:appearance", "Aussehen"),
                    _f("aushaertung", "Aushärtung", "tc:curingType", "Aushärtung"),
                ],
            },
            {
                "id": "anwendung",
                "title": "Anwendung",
                "fields": [
                    _f("anwendungsbereich", "Anwendungsbereich", "tc:intendedUse", "Anwendungsbereich"),
                    _f("produkteigenschaft1", "Produkteigenschaft 1", "tc:description", "Produkteigenschaft_1"),
                    _f("produkteigenschaft2", "Produkteigenschaft 2", "tc:description", "Produkteigenschaft_2"),
                    _f("produkteigenschaft3", "Produkteigenschaft 3", "tc:description", "Produkteigenschaft_3"),
                    _f("produkteigenschaft4", "Produkteigenschaft 4", "tc:description", "Produkteigenschaft_4"),
                    _f("produkteigenschaft5", "Produkteigenschaft 5", "tc:description", "Produkteigenschaft_5"),
                ],
            },
            {
                "id": "technischeDaten",
                "title": "Technische Daten",
                "fields": [
                    _f("feststoffgehalt", "Feststoffgehalt", "tc:solidsContent", "Feststoffgehalt", ftype="number", unit="%"),
                    _f("viskositaet", "Viskosität (Brookfield)", "tc:viscosity", "Viskosität_Brookfield", ftype="number", unit="mPa·s"),
                    _f("messtemperatur", "Messtemperatur (Brookfield)", "tc:viscosityConditions", "Messtemperatur_Brookfield"),
                    _f("messzeitpunkt", "Messzeitpunkt (Brookfield)", "tc:viscosityConditions", "Messzeitpunkt_Brookfield"),
                    _f("dichte", "Dichte", "tc:density", "Dichte", ftype="number", unit="g/cm³"),
                    _f("anmerkungen", "Anmerkungen", "tc:comment", "Anmerkungen"),
                    _f("anmerkungenScherverhalten", "Anmerkungen Scherverhalten", "tc:comment", "Anmerkungen_Scherverhalten"),
                ],
            },
            {
                "id": "verarbeitung",
                "title": "Verarbeitung & Sicherheit",
                "fields": [
                    _f("verarbeitungshinweise", "Verarbeitungshinweise", "tc:processingNote", "Verarbeitungshinweise"),
                    _f("sicherheitsmassnahmen", "Sicherheitsmaßnahmen", "tc:safetyNote", "Sicherheitsmaßnahmen"),
                    _f("reinigung", "Reinigung", "tc:cleaningNote", "Reinigung"),
                    _f("lagerbedingungen", "Lagerbedingungen", "tc:storageConditions", "Lagerbedingungen"),
                    _f("kennzeichnung", "Kennzeichnung", "tc:labeling", "Kennzeichnung"),
                    _f("haftungsausschluss", "Haftungsausschluss", "tc:comment", "Haftungsausschluss"),
                    _f("tdsDatum", "Datum des Datenblatts", "tc:date", "Datum"),
                ],
            },
        ],
    },
    # -------------------------------------------------------------------------
    # 3. Schnittbild (48 Felder)
    # -------------------------------------------------------------------------
    "pdf_schnittbild": {
        "id": "pdf_schnittbild",
        "label": "Schnittbild",
        "description": "Einschnittplan eines Stammes im Sägewerk: Haupt-/Seitenware, Fugen, Vor- und Nachschnitt.",
        # Materialbezug: Rundholz -> Schnittholz, fachlich eine Transformation. Wertvollster
        # Verknuepfungspunkt; im Formular fehlte bisher jedes Nummernfeld.
        "material_ref": MATERIAL_REF_REQUIRED,
        "doc_class": "Schnittbild",
        "data_type": "pdf_schnittbild",
        "main_class": "tc:CuttingPattern",
        "subject_path": "cuttingpattern",
        "sections": [
            # EPC-Bezug zuerst: der Nutzer soll das Material waehlen,
            # bevor er Detaildaten eintraegt.
            _material_ref_section(
                "Aus welchem Rundholz-Stamm entsteht dieser Einschnitt? Die Auswahl verknuepft Rundholz und Schnittholz.",
                required=True,
            ),
            {
                "id": "kopf",
                "title": "Stamm & Ausbeute",
                "fields": [
                    _f("box", "Box", "tc:box", "Box"),
                    _f("zopf", "Zopf", "tc:zopf", "Zopf"),
                    _f("mitte", "Mitte", "tc:mitte", "Mitte"),
                    _f("stock", "Stock", "tc:stock", "Stock"),
                    _f("rhBedarfFestmeter", "RH-Bedarf (Festmeter)", "tc:rH_Bedarf_Festmeter", "RH-Bedarf Festmeter"),
                    _f("rhBedarfStueck", "RH-Bedarf (Stück)", "tc:rH_Bedarf_Stueck", "RH-Bedarf Stueck"),
                    _f("holzart", "Holzart", "tc:holzart", "Holzart", required=True),
                    _f("laenge", "Länge", "tc:laenge_v2", "Laenge", unit="m"),
                    _f("klasse", "Klasse", "tc:klasse", "Klasse"),
                    _f("hauptware", "Hauptware", "tc:hauptware", "Hauptware"),
                    _f("seitenware", "Seitenware", "tc:seitenware", "Seitenware"),
                    _f("hwKorrektur", "HW-Korrektur", "tc:hW_Korrektur", "HW-Korrektur"),
                    _f("gesamt", "Gesamt", "tc:gesamt", "Gesamt"),
                    _f("restholz", "Restholz", "tc:restholz", "Restholz"),
                    _f("saegespaene", "Sägespäne", "tc:saegespaene", "Saegespaene"),
                ],
            },
            {
                "id": "fugen",
                "title": "Hauptware — Fugen in mm",
                "fields": [
                    _f("fugenVorschnitt", "Fugen in mm (Vorschnitt)", "tc:fugen_in_mm_Vorschnitt", "Fugen in mm Vorschnitt", ftype="number", unit="mm"),
                    _f("fugenNachschnitt", "Fugen in mm (Nachschnitt)", "tc:fugen_in_mm_Nachschnitt", "Fugen in mm Nachschnitt", ftype="number", unit="mm"),
                    _f("fugenVorschnittHwHw", "Vorschnitt: HW → HW", "tc:fugen_in_mm_Vorschnitt_HW___Hw", "HW  HW Vorschnitt", ftype="number", unit="mm"),
                    _f("fugenNachschnittHwHw", "Nachschnitt: HW → HW", "tc:fugen_in_mm_Nachschnitt_HW___Hw", "HW  HW Nachschnitt", ftype="number", unit="mm"),
                    _f("fugenVorschnittHwSw1", "Vorschnitt: HW → SW1", "tc:fugen_in_mm_Vorschnitt_HW___SW1", "HW  SW1 Vorschnitt", ftype="number", unit="mm"),
                    _f("fugenNachschnittHwSw1", "Nachschnitt: HW → SW1", "tc:fugen_in_mm_Nachschnitt_HW___SW1", "HW  SW1 Nachschnitt", ftype="number", unit="mm"),
                    _f("fugenVorschnittSw1Swn", "Vorschnitt: SW1 → SWN", "tc:fugen_in_mm_Vorschnitt_SW1___SWN", "SW1  SWN Vorschnitt", ftype="number", unit="mm"),
                    _f("fugenNachschnittSw1Swn", "Nachschnitt: SW1 → SWN", "tc:fugen_in_mm_Nachschnitt_SW1___SWN", "SW1  SWN Nachschnitt", ftype="number", unit="mm"),
                    _f("fugenVorschnittSaegeseg", "Vorschnitt: Sägeseg.", "tc:fugen_in_mm_Vorschnitt_Saegeseg", "Saegeseg Vorschnitt", ftype="number", unit="mm"),
                    _f("fugenNachschnittSaegeseg", "Nachschnitt: Sägeseg.", "tc:fugen_in_mm_Nachschnitt_Saegeseg", "Saegeseg Nachschnitt", ftype="number", unit="mm"),
                    _f("fugenVorschnittPutzsaege", "Vorschnitt: Putzsäge", "tc:fugen_in_mm_Vorschnitt_Putzsaege", "Putzsaege Vorschnitt", ftype="number", unit="mm"),
                    _f("fugenNachschnittPutzsaege", "Nachschnitt: Putzsäge", "tc:fugen_in_mm_Nachschnitt_Putzsaege", "Putzsaege Nachschnitt", ftype="number", unit="mm"),
                ],
            },
            {
                "id": "hauptwareSchnitt",
                "title": "Hauptware — Vorschnitt / Nachschnitt / Auftrennung",
                "fields": [
                    _f("hwVorschnittStk", "Vorschnitt: Stk", "tc:hauptware_Vorschnitt_Stueck", "Vorschnitt Stueck", ftype="number"),
                    _f("hwVorschnittEm", "Vorschnitt: EM", "tc:hauptware_Vorschnitt_EM", "Vorschnitt EM", ftype="number"),
                    _f("hwVorschnittVm", "Vorschnitt: VM", "tc:hauptware_Vorschnitt_VM", "Vorschnitt VM", ftype="number"),
                    _f("hwVorschnittSchnittkl", "Vorschnitt: Schnittkl.", "tc:hauptware_Vorschnitt_Schnittkl", "Vorschnitt Schnittkl"),
                    _f("hwNachschnittStk", "Nachschnitt: Stk", "tc:hauptware_Nachschnitt_Stueck", "Nachschnitt Stueck", ftype="number"),
                    _f("hwNachschnittEm", "Nachschnitt: EM", "tc:hauptware_Nachschnitt_EM", "Nachschnitt EM", ftype="number"),
                    _f("hwNachschnittVm", "Nachschnitt: VM", "tc:hauptware_Nachschnitt_VM", "Nachschnitt VM", ftype="number"),
                    _f("hwNachschnittSchnittkl", "Nachschnitt: Schnittkl.", "tc:hauptware_Nachschnitt_Schnittkl", "Nachschnitt Schnittkl,"),
                    _f("hwAuftrennungEm", "Auftrennung: EM", "tc:hauptware_Auftrennung_EM", "Auftrennung EM", ftype="number"),
                    _f("hwAuftrennungVm", "Auftrennung: VM", "tc:hauptware_Auftrennung_VM", "Auftrennung VM", ftype="number"),
                    _f("hwAuftrennungFuge", "Auftrennung: Fuge", "tc:hauptware_Auftrennung_Fuge", "Auftrennung Fuge", ftype="number"),
                ],
            },
            {
                "id": "seitenwareSchnitt",
                "title": "Seitenware — Vorschnitt / Nachschnitt",
                "fields": [
                    _f("swVorschnittStk", "Vorschnitt: Stk", "tc:seitenware_Vorschnitt_Stueck", "Seitenware Vorschnitt Stueck", ftype="number"),
                    _f("swVorschnittEm", "Vorschnitt: EM", "tc:seitenware_Vorschnitt_EM", "Seitenware Vorschnitt EM", ftype="number"),
                    _f("swVorschnittSchnittkl", "Vorschnitt: Schnittkl.", "tc:seitenware_Vorschnitt_Schnittkl", "Seitenware Vorschnitt Schnittkl"),
                    _f("swVorschnittVm", "Vorschnitt: VM", "tc:seitenware_Vorschnitt_VM", "Seitenware Vorschnitt VM", ftype="number"),
                    _f("swVorschnittLaenge", "Vorschnitt: Länge", "tc:seitenware_Vorschnitt_Laenge", "Seitenware Vorschnitt Laenge", ftype="number", unit="m"),
                    _f("swNachschnittStk", "Nachschnitt: Stk", "tc:seitenware_Nachschnitt_Stueck", "Seitenware Nachschnitt Stueck", ftype="number"),
                    _f("swNachschnittEm", "Nachschnitt: EM", "tc:seitenware_Nachschnitt_EM", "Seitenware Nachschnitt EM", ftype="number"),
                    _f("swNachschnittSchnittkl", "Nachschnitt: Schnittkl.", "tc:seitenware_Nachschnitt_Schnittkl", "Seitenware Nachschnitt Schnittkl"),
                    _f("swNachschnittVm", "Nachschnitt: VM", "tc:seitenware_Nachschnitt_VM", "Seitenware Nachschnitt VM", ftype="number"),
                    _f("swNachschnittLaenge", "Nachschnitt: Länge", "tc:seitenware_Nachschnitt_Laenge", "Seitenware Nachschnitt Laenge", ftype="number", unit="m"),
                ],
            },
        ],
    },
    # -------------------------------------------------------------------------
    # 4. Biegepruefung Schnittholz (6 Kopffelder + 10 Spalten x 22 Zeilen)
    # -------------------------------------------------------------------------
    "pdf_biegepruefung": {
        "id": "pdf_biegepruefung",
        "label": "Biegeprüfung Schnittholz",
        "description": "Prüfprotokoll einer Biegeprüfung (WPK): Prüfparameter und bis zu 22 Einzelproben.",
        # Materialbezug: Prueft Proben aus konkretem Schnittholz (auftragsNr ist Pflichtfeld).
        "material_ref": MATERIAL_REF_REQUIRED,
        "doc_class": "Prüfprotokoll",
        "data_type": "pdf_biegepruefung",
        "main_class": "tc:TestReport",
        # Eigener Pfad, obwohl die Klasse dieselbe ist wie beim
        # Pruefzertifikat: sonst bauen beide Templates die URI
        # ".../testreport/<docId>", und dasselbe PDF ueber beide Vorlagen
        # uebertragen ergaebe EIN Subjekt mit vermischten Aussagen.
        "subject_path": "bendingtest",
        "sections": [
            # EPC-Bezug zuerst: der Nutzer soll das Material waehlen,
            # bevor er Detaildaten eintraegt.
            _material_ref_section(
                "Aus welchem Schnittholz stammen die geprueften Proben?",
                required=True,
            ),
            {
                "id": "kopf",
                "title": "Prüfparameter",
                "fields": [
                    _f("druckdatum", "Druckdatum", "tc:printedAt", "Druckdatum"),
                    _f("pruefstelle", "Prüfstelle / Firma", "tc:businessName", "Titel"),
                    _f("auftragsNr", "Auftrags-Nr.", "tc:orderNumber", "Auftrags-Nr", required=True),
                    _f("probenentnahme", "Probenentnahme", "tc:samplingNote", "Probenentnahme"),
                    _f("vorkraft", "Vorkraft", "tc:preForce", "Vorkraft", ftype="number", unit="N"),
                    _f("pruefgeschwindigkeit", "Prüfgeschwindigkeit", "tc:testSpeed", "Prüfgeschwindigkeit", ftype="number", unit="mm/min"),
                ],
            },
            {
                "id": "proben",
                "title": "Prüfergebnisse (Einzelproben)",
                "repeatable": True,
                "item_label": "Probe",
                "row_count": 22,
                "entity": {
                    "suffix": "probe",
                    "class": "tc:BendingTest",
                    "link_predicate": "tc:hasTest",
                },
                "fields": [
                    _f("probenNr", "Proben-Nr.", "tc:sampleId", "Proben-Nr._{n}"),
                    _f("probenbezeichnung", "Probenbezeichnung", "tc:label", "Probenbezeichnung_{n}"),
                    _f("probenlaenge", "Probenlänge", "tc:sampleLength", "Probenlänge_{n}", ftype="number", unit="mm"),
                    _f("probenstaerke", "Probenstärke", "tc:sampleThickness", "Probenstärke_{n}", ftype="number", unit="mm"),
                    _f("fmax", "Fmax", "tc:maxForce", "Fmax_{n}", ftype="number", unit="N"),
                    _f("dlBeiFmax", "dl bei Fmax", "tc:deformationAtMaxForce", "dL_bei_Fmax_{n}", ftype="number", unit="mm"),
                    _f("tPruefung", "t Prüfung", "tc:testDuration", "Prüfung_{n}", ftype="number", unit="s"),
                    _f("datumUhrzeit", "Datum / Uhrzeit", "tc:dateTime", "Datum/ Uhrzeit_(Zwick)_{n}"),
                    _f("anmerkung", "Anmerkung", "tc:comment", "Anmerkung_{n}"),
                    _f("pruefer", "Prüfer", "tc:testerName", "Prüfer_{n}"),
                ],
            },
        ],
    },
    # -------------------------------------------------------------------------
    # 5. Leistungserklaerung Schnittholz (31 Felder)
    # -------------------------------------------------------------------------
    "pdf_leistungserklaerung": {
        "id": "pdf_leistungserklaerung",
        "label": "Leistungserklärung Schnittholz",
        "description": "Leistungserklärung gemäß Verordnung (EU) Nr. 305/2011 mit mechanischen und bauphysikalischen Eigenschaften.",
        # Materialbezug: Erklaert Eigenschaften einer Produktfamilie nach EU 305/2011.
        # typennummer ist eine Artikelnummer, keine Losnummer.
        "material_ref": MATERIAL_REF_NONE,
        "doc_class": "Leistungserklärung",
        "data_type": "pdf_leistungserklaerung",
        "main_class": "tc:DeclarationOfPerformance",
        "subject_path": "dop",
        "sections": [
            {
                "id": "allgemein",
                "title": "Allgemeine Angaben",
                "fields": [
                    _f("nr", "Nr. der Leistungserklärung", "tc:identifier", "Nummer", required=True),
                    _f("typ", "1. Typ", "tc:type", "Typ"),
                    _f("typennummer", "2. Typennummer", "tc:typeNumber", "Typennummer"),
                    _f("verwendung", "3. Verwendung", "tc:intendedUse", "Verwendung"),
                    _f("herstellerbezeichnung", "4. Herstellerbezeichnung", "tc:productName", "Herstellerbezeichnung"),
                    _f("herstellerName", "Hersteller: Name", "tc:manufacturer", "Name_Hersteller"),
                    _f("herstellerStrasse", "Hersteller: Straße", "tc:manufacturerAddress", "Straße_Hersteller"),
                    _f("herstellerOrt", "Hersteller: Ort", "tc:manufacturerAddress", "Ort_Hersteller"),
                    _f("herstellerLand", "Hersteller: Land", "tc:manufacturerAddress", "Land_Hersteller"),
                    _f("konformitaetssystem", "6. Konformitätssystem (EU 305, Anhang V)", "tc:conformitySystem", "Konformitätsystem"),
                    _f("harmonisierteNorm", "7. Bauprodukt gemäß harmonisierter Norm", "tc:standardReference", "Bauprodukt gemäß harmonisierter Norm"),
                ],
            },
            {
                "id": "zertifizierung",
                "title": "Notifizierte Stelle",
                "fields": [
                    _f("zertNummer", "Zertifikat-Nr.", "tc:zertifikatsnummer", "Nummer_Zertifizierungsstelle"),
                    _f("zertName", "Name der Zertifizierungsstelle", "tc:notifiedBody", "Name_Zertifizierungsstelle"),
                    _f("zertStrasse", "Zertifizierungsstelle: Straße", "tc:notifiedBodyAddress", "Straße_Zertifizierungsstelle"),
                    _f("zertOrt", "Zertifizierungsstelle: Ort", "tc:notifiedBodyAddress", "Ort_Zertifizierungsstelle"),
                    _f("zertLand", "Zertifizierungsstelle: Land", "tc:notifiedBodyAddress", "Land_Zertifizierungsstelle"),
                ],
            },
            {
                "id": "mechanisch",
                "title": "Mechanische Eigenschaften",
                "fields": [
                    _f("dichte", "Dichte", "tc:density", "Dichte", ftype="number", unit="kg/m³"),
                    _f("biegung", "Biegung EN 338", "tc:bendingStrength", "Biegung EN 338", ftype="number", unit="N/mm²"),
                    _f("zugFaser", "Zug in Faserrichtung EN 338", "tc:tensileStrengthParallel", "Zug in Faserrichtung EN 338", ftype="number", unit="N/mm²"),
                    _f("zugRechtwinklig", "Zug rechtwinklig zur Faserrichtung EN 338", "tc:tensileStrengthPerpendicular", "Zug rechtwinklig zur Faserrichtung EN 338", ftype="number", unit="N/mm²"),
                    _f("druckFaser", "Druck in Faserrichtung EN 338", "tc:compressiveStrengthParallel", "Druck in Faserrichtung EN 338", ftype="number", unit="N/mm²"),
                    _f("druckRechtwinklig", "Druck rechtwinklig zur Faserrichtung EN 338", "tc:compressiveStrengthPerpendicular", "Druck rechtwinklig zur Faserrichtung EN 338", ftype="number", unit="N/mm²"),
                    _f("schub", "Schub EN 338", "tc:shearStrength", "Schub EN 338", ftype="number", unit="N/mm²"),
                    _f("eModul", "Mittelwert des Elastizitätsmoduls in Faserrichtung", "tc:elasticModulus", "Mittelwert des Elastizitätsmoduls in Faserrichtung", ftype="number", unit="kN/mm²"),
                ],
            },
            {
                "id": "toleranzen",
                "title": "Allgemeine Toleranzen",
                "fields": [
                    _f("dickenBreitenToleranz", "Dicken- und Breitentoleranz EN 336", "tc:thicknessTolerance", "Dicken- und Breitentolreanz EN 336", unit="mm"),
                ],
            },
            {
                "id": "bauphysik",
                "title": "Bauphysikalische Eigenschaften",
                "fields": [
                    _f("brandverhalten", "Brandklasse (EN 13501-1)", "tc:fireResistanceClass", "Brandklasse", ftype="select"),
                    _f("feuerwiderstand", "Feuerwiderstandsklasse (DIN 4102)", "tc:fireResistanceClassNational", "Feuerwiderstandsklasse", ftype="select"),
                    _f("dauerhaftigkeitPilze", "Natürliche Dauerhaftigkeit gegen holzzerstörende Pilze", "tc:durabilityClass", "Natürliche Dauherhaftigkeit gegen holzsterstörende Pilze", ftype="select"),
                    _f("dauerhaftigkeitInsekten", "Biologische Dauerhaftigkeit gegen Insekten, Termiten, maritime Holzzerstörer", "tc:durabilityInsects", "Biologische Dauerhaftigkeit gegen Insekten, Termiten, maritime Holzzerstörer", ftype="select"),
                ],
            },
            {
                "id": "eigenschaften",
                "title": "Allgemeine Eigenschaften",
                "fields": [
                    _f("holzart", "Holzart", "tc:species", "Holzart", ftype="select"),
                    _f("reach", "Abgabe von gefährlichen Stoffen", "tc:hazardousSubstanceEmission", "Abgabe von gefährlichen Stoffen"),
                ],
            },
        ],
    },
    # -------------------------------------------------------------------------
    # 6. Transportauftrag Schnittholz (34 Felder)
    # -------------------------------------------------------------------------
    "pdf_transportauftrag": {
        "id": "pdf_transportauftrag",
        "label": "Transportauftrag Schnittholz",
        "description": "Transportauftrag mit Transportüberblick, Spedition und Lieferungsdaten (Belade-/Entladestelle).",
        # Materialbezug: Beschreibt eine Bewegung konkreten Holzes -- wie ein eldat-Lieferschein.
        "material_ref": MATERIAL_REF_REQUIRED,
        "doc_class": "Transportauftrag",
        "data_type": "pdf_transportauftrag",
        "main_class": "tc:TransportOrder",
        "subject_path": "transportorder",
        "sections": [
            # EPC-Bezug zuerst: der Nutzer soll das Material waehlen,
            # bevor er Detaildaten eintraegt.
            _material_ref_section(
                "Welches Holz wird mit diesem Auftrag transportiert?",
                required=True,
            ),
            {
                "id": "kopf",
                "title": "Transport",
                "fields": [
                    _f("transportNr", "Transportnummer", "tc:transportNumber", "Transportnummer", required=True),
                    _f("lieferungsnummern", "Lieferungsnummer", "tc:deliveryNumber", "Lieferungsnummer"),
                    _f("gedruckt", "Gedruckt", "tc:printedAt", "gedruckt"),
                    _f("letzteAenderung", "Letzte Änderung", "tc:modifiedAt", "Letzte Änderung"),
                ],
            },
            {
                "id": "ueberblick",
                "title": "Transportüberblick",
                "fields": [
                    _f("transporeonId", "Transporeon-ID", "tc:identifier", "Transporeon-ID"),
                    _f("dispositionsstelle", "Dispositionsstelle", "tc:dispatchOffice", "Dispositionsstelle"),
                    _f("disponent", "Disponent", "tc:dispatcherName", "Disponent"),
                    _f("gewicht", "Gewicht", "tc:grossWeight", "Gewicht", ftype="number", unit="kg"),
                    _f("volumen", "Volumen", "tc:volume", "Volumen", ftype="number", unit="m³"),
                    _f("co2Emission", "CO₂-Emissionen", "tc:emission", "CO2-Emissionen", ftype="number", unit="kg"),
                ],
            },
            {
                "id": "spedition",
                "title": "Spedition",
                "fields": [
                    _f("spedition", "Name der Spedition", "tc:businessName", "Name_Spedition"),
                    _f("speditionStrasse", "Straße", "tc:street", "Straße_Spedition"),
                    _f("speditionOrt", "Ort", "tc:city", "Ort_Spedition"),
                    _f("speditionTel", "Telefonnummer", "tc:phone", "Telefonnummer_Spedition"),
                    _f("speditionFax", "Faxnummer", "tc:fax", "Faxnummer_Spedition"),
                ],
            },
            {
                "id": "weitereAngaben",
                "title": "Weitere Angaben",
                "fields": [
                    _f("messageRequired", "Message required", "tc:messageRequired", "Message required"),
                    _f("beladestelle", "Beladestelle", "tc:loadingPointDescription", "Beladestelle"),
                    _f("maxPreis", "Max. Preis", "tc:maxPrice", "Max. Preis", ftype="number", unit="€"),
                    _f("actPreis", "Act. Preis", "tc:actualPrice", "Act._Preis", ftype="number", unit="€"),
                    _f("transportAbgefertigt", "Transport abgefertigt", "tc:transportStatus", "Transport_abgefertigt"),
                    _f("oceanSeaRtv", "Ocean/Sea RTV enabled", "tc:oceanTransportEnabled", "Ocean/Sea RTV enabled"),
                    _f("tdlnrParam", "custom.tdlnr.param", "tc:reference", "custom.tdlnr.param"),
                ],
            },
            {
                "id": "lieferung",
                "title": "Lieferung",
                "entity": {
                    "suffix": "lieferung",
                    "class": "tc:DeliveryOrder",
                    "link_predicate": "tc:hasDeliveryOrder",
                },
                "fields": [
                    _f("beladeName", "Beladestelle: Name", "tc:loadingAddress", "Name_Beladestelle"),
                    _f("beladeStrasse", "Beladestelle: Straße", "tc:loadingAddress", "Straße_Beladestelle"),
                    _f("beladeOrt", "Beladestelle: Ort", "tc:loadingAddress", "Ort_Beladestelle"),
                    _f("datumBeladung", "Datum der Beladung", "tc:startDate", "Datum_Beladung"),
                    _f("entladeName", "Entladestelle: Name", "tc:unloadingAddress", "Name_Entladestelle"),
                    _f("entladeStrasse", "Entladestelle: Straße", "tc:unloadingAddress", "Straße_Entladestelle"),
                    _f("entladeOrt", "Entladestelle: Ort", "tc:unloadingAddress", "Ort_Entladestelle"),
                    _f("entladeTel", "Entladestelle: Telefonnummer", "tc:phone", "Telefonnummer_Entladestelle"),
                    _f("datumEntladung", "Datum der Entladung", "tc:endDate", "Datum_Entladung"),
                    _f("incoterm", "Incoterm", "tc:incoterm", "Incoterm"),
                    _f("gefahrenklasse", "Gefahrenklasse / Gefahrennr.", "tc:hazardClass", "Gefahrenklasse/ Gefahrennr"),
                    _f("purchaseOrderNo", "Purchase order no", "tc:orderNumber", "Purchase_order_no"),
                ],
            },
        ],
    },
    # -------------------------------------------------------------------------
    # 7. Stammzertifikat fuer Vermehrungsgut (49 Felder inkl. 6 Checkboxen)
    # -------------------------------------------------------------------------
    "pdf_stammzertifikat": {
        "id": "pdf_stammzertifikat",
        "label": "Stammzertifikat Vermehrungsgut",
        "description": "Stammzertifikat für forstliches Vermehrungsgut von Samenplantagen und Familieneltern (Bundesrepublik Deutschland).",
        # Materialbezug: vorlaeuferZertifikatNr verweist explizit auf die groessere Partie,
        # aus der geteilt wurde.
        "material_ref": MATERIAL_REF_REQUIRED,
        "doc_class": "Stammzertifikat",
        "data_type": "pdf_stammzertifikat",
        "main_class": "tc:Certificate",
        "subject_path": "certificate",
        "sections": [
            # EPC-Bezug zuerst: der Nutzer soll das Material waehlen,
            # bevor er Detaildaten eintraegt.
            _material_ref_section(
                "Auf welches Vermehrungsgut bezieht sich dieses Zertifikat? Bei Teilung einer groesseren Partie das Ausgangsmaterial waehlen.",
                required=True,
            ),
            # Pflicht: ohne Flaeche laesst sich spaeter kein Produkt ueber seine
            # GPS-Position dem Pflanzvorgang zuordnen -- genau dafuer ist sie da.
            _planting_area_section(
                "Zeichnen Sie auf der Karte die Fläche ein, auf der dieses Vermehrungsgut gepflanzt wurde. Über diese Fläche werden später Produkte anhand ihrer GPS-Position diesem Pflanzvorgang zugeordnet.",
                required=True,
            ),
            {
                "id": "kopf",
                "title": "Zertifikat",
                "fields": [
                    _f("zertifikatNr", "Stammzertifikat-Nr.", "tc:identifier", "STAMMZERTIFIKATNR", required=True, demo="DE-NW-2026-04711"),
                    _f("verteilerErntegut", "Verteiler: Erntegut Original", "tc:distributionList", "Erntegut Original", ftype="checkbox", demo=True),
                    _f("verteilerWaldbesitzer", "Verteiler: Waldbesitzer Abdruck", "tc:distributionList", "Waldbesitzer Abdruck", ftype="checkbox", demo=True),
                    _f("verteilerBehoerde", "Verteiler: zust. Behörde Abdruck", "tc:distributionList", "zust Behörde Abdruck", ftype="checkbox"),
                    _f("verteilerKontrollstelle", "Verteiler: Kontrollstelle Abdruck", "tc:distributionList", "Kontrollstelle Abdruck", ftype="checkbox"),
                    _f("rechtEgRichtlinie", "Erzeugt gemäß EG-Richtlinie", "tc:guideline", "gemäß EG-Richtlinie", ftype="checkbox", demo=True),
                    _f("rechtUebergangsregelungen", "Erzeugt gemäß Übergangsregelungen", "tc:guideline", "gemäß Übergangsregelungen", ftype="checkbox"),
                ],
            },
            {
                "id": "material",
                "title": "1.–5. Vermehrungsgut",
                "fields": [
                    _f("baumart", "1. Baumart (botanische und deutsche Bezeichnung)", "tc:species", "Baumart_deutsche_und_botanische_Bezeichnung", demo="Fichte (Picea abies (L.) H. Karst.)"),
                    _f("ausgangsmaterialName", "Name des Ausgangsmaterials (lt. Register)", "tc:sourceMaterialName", "Name_des_Ausgangsmaterials", demo="Samenplantage Arnsberger Wald"),
                    _f("artVermehrungsgut", "2. Art des Vermehrungsgutes", "tc:propagationMaterialType", "Art_des_Vermehrungsgutes", ftype="select", demo="Saatgut"),
                    _f("vermehrungsgutkategorie", "3. Vermehrungsgutkategorie", "tc:propagationCategory", "Vermehrungsgutkategorie", ftype="select", demo="Qualifiziert"),
                    _f("artAusgangsmaterial", "4. Art des Ausgangsmaterials", "tc:sourceType", "Art_des_Ausgangsmaterials", ftype="select", demo="Samenplantage"),
                    _f("verwendungszweck", "5. Verwendungszweck", "tc:intendedUse", "Verwendungszweck", ftype="select", demo="forstlich"),
                ],
            },
            {
                "id": "herkunft",
                "title": "6.–9. Herkunft",
                "fields": [
                    _f("registerzeichen", "6. Registerzeichen", "tc:registerSign", "Registerzeichen", demo="NW-840-05-2019"),
                    _f("eigentuemerZulassungseinheit", "Eigentümer der Zulassungseinheit", "tc:admissionUnitOwner", "Eigentümer der Zulassungseinheit", demo="Landesbetrieb Wald und Holz NRW"),
                    _f("eigentuemerZulassungseinheit2", "Eigentümer der Zulassungseinheit (2)", "tc:admissionUnitOwner", "Eigentümer_der_Zulassungseinheit", demo="Landesbetrieb Wald und Holz NRW"),
                    _f("gebietsursprung", "7. Gebietsursprung", "tc:origin", "Gebietsursprung", ftype="select", demo="autochthon"),
                    _f("landAusgangsmaterial", "9. Land des Ausgangsmaterials", "tc:sourceMaterialCountry", "Land_des_Ausgangsmaterials", demo="Deutschland"),
                    _f("herkunftsgebietBezeichnung", "Bezeichnung des Herkunftsgebiets", "tc:provenanceRegionName", "Bezeichnung_Herkunftsgebiet_des_Ausgangsmaterials", demo="Sauerland und Bergisches Land"),
                    _f("herkunftsgebietNr", "Nr. des Herkunftsgebiets", "tc:provenanceRegionNumber", "Nr._des_Herkunftsgebiets_des_Ausgangsmaterials", demo="84005"),
                ],
            },
            {
                "id": "saatgut",
                "title": "10.–12. Saatgut & Menge",
                "fields": [
                    _f("saatgutAus", "10. Saatgut aus", "tc:seedOrigin", "Saatgut_aus", ftype="select", demo="freier Abblüte"),
                    _f("reifejahr", "11. Reifejahr", "tc:maturityYear", "Reifejahr", demo="2025"),
                    _f("menge", "12. Menge des Vermehrungsgutes", "tc:amount", "Menge_des_Vermehrungsgutes", ftype="number", unit="kg", demo="12,5"),
                    _f("mengeInWorten", "Menge i.W.", "tc:amountInWords", "Menge_des_Vermehrungsgutes_in_Worten", demo="zwölf Komma fünf Kilogramm"),
                    _f("verpackungseinheiten", "Anzahl und Art der Verpackungseinheiten", "tc:count", "Anzahl_und_Art_der_Verpackungseinheiten", demo="5 Vakuumbeutel à 2,5 kg"),
                    _f("aufbereitungszustand", "Aufbereitungszustand", "tc:processingState", "Bei_Saatgut_Aufbereitungszustand", ftype="select", demo="maschinengereinigt"),
                    _f("anteilReinesSaatgut", "Anteil des reinen Saatguts an der Gesamtmenge", "tc:purity", "Anteil_des_reinen_Saatgutes_an_der_Gesamtmenge", ftype="number", unit="%", demo="98,4"),
                ],
            },
            {
                "id": "partie",
                "title": "13. Teilung einer größeren Partie",
                "fields": [
                    _f("teilungGroesserePartie", "13. Ergebnis der Teilung einer größeren Partie?", "tc:materialAuthenticity", "Teil_einer_größeren_Partie", ftype="select", demo="Ja"),
                    _f("vorlaeuferZertifikatNr", "Nr. des Vorläufer-Zertifikates", "tc:predecessorCertificateNumber", "Nr._des_Vorläufer-Zertifikates", demo="DE-NW-2025-03980"),
                    _f("mengeAnfangspartie", "Menge der Anfangspartie", "tc:initialLotAmount", "Menge_der_Anfangspartie", demo="40 kg"),
                ],
            },
            {
                "id": "anzucht",
                "title": "14.–19. Anzucht & Vermehrung",
                "fields": [
                    _f("anzuchtDauer", "14. Dauer der Anzucht in einer Baumschule", "tc:nurseryCultivationDuration", "Dauer_der_Anzucht_in_einer_Baumschule", demo="2 Jahre (2+0)"),
                    _f("familien", "15. Anzahl vertretener Komponenten: Familien", "tc:familyCount", "Anzahl_der_vertretenden_Komponenten_Familien", ftype="number", datatype="xsd:integer", demo="32"),
                    _f("klone", "Anzahl vertretener Komponenten: Klone", "tc:cloneCount", "Anzahl_der_vertretenden_Komponenten_Klone", ftype="number", datatype="xsd:integer", demo="48"),
                    _f("gentechnik", "17. Mit Hilfe gentechnischer Verfahren erzeugt?", "tc:geneticModification", "Wurde_das_Ausgangsmaterial_mit_Hilfe_gentechnischer_Verfahren_erzeugt?", ftype="select", demo="Nein"),
                    _f("kreuzungsmethode", "18. Kreuzungsmethode (bei Familieneltern)", "tc:crossingMethod", "Keurzungsmethode", demo="Polycross"),
                    _f("komponentenfamilien", "Prozentuale Zusammensetzung von Komponentenfamilien", "tc:componentFamilyComposition", "Prozentuale_Zusammensetzung_von_Komponentenfamilien", demo="je Familie ca. 3 %"),
                    _f("vegetativVermehrt", "19. Bereits aus Samen erwachsenes Material vegetativ vermehrt?", "tc:vegetativePropagation", "Wurde_bereits_aus_Samen_erwachsenes_Material_vegetativ_vermehrt?", ftype="select", demo="Nein"),
                    _f("vermehrungsmethode", "Vermehrungsmethode", "tc:propagationMethod", "Vermehrungsmethode", demo="generativ (Saatgut)"),
                    _f("vermehrungszyklen", "Anzahl der Vermehrungszyklen", "tc:propagationCycleCount", "Anzahl_der_Vermehrungszyklen", ftype="number", datatype="xsd:integer", demo="1"),
                ],
            },
            {
                "id": "beteiligte",
                "title": "20.–21. Beteiligte & Ausstellung",
                "fields": [
                    _f("empfaengerName", "Name des 1. Empfängers", "tc:firstRecipientName", "Name_des_Empfängers", demo="Forstbaumschule Sauerland GmbH"),
                    _f("empfaengerAnschrift", "Anschrift des 1. Empfängers", "tc:firstRecipientAddress", "Anschrift_des_Empfängers", demo="Waldweg 12, 59821 Arnsberg"),
                    _f("lieferantName", "21. Name des Lieferanten", "tc:supplierName", "Name_des_Lieferanten", demo="Landesbetrieb Wald und Holz NRW"),
                    _f("lieferantAnschrift", "Anschrift des Lieferanten", "tc:supplierAddress", "Anschrift_des_Lieferanten", demo="Albrecht-Thaer-Str. 34, 48147 Münster"),
                    _f("lieferantBetriebsnummer", "Betriebsnummer des Lieferanten", "tc:businessId", "Betriebsnummer_des_Lieferanten", demo="NW-05-1147"),
                    _f("landesstelleName", "Name der Landesstelle", "tc:stateAuthorityName", "Name_der_Landesstelle", demo="Landesbetrieb Wald und Holz NRW — Zentrum für Wald und Holzwirtschaft"),
                    _f("landesstelleAnschrift", "Anschrift der Landesstelle", "tc:stateAuthorityAddress", "Anschrift_der_Landesstelle", demo="Obereimer 13, 59821 Arnsberg"),
                    _f("ort", "Ort", "tc:city", "Ort_an_dem_das_Stammzertifikat_ausgefüllt_wurde", demo="Arnsberg"),
                    _f("datum", "Datum", "tc:date", "Datum_an_dem_das_Stammzertifikat_ausgefüllt_wurde_af_date", demo="2026-03-12"),
                    _f("bevollmaechtigter", "Name des Bevollmächtigten", "tc:authorizedPersonName", "Name_des_Bevollmächtigten", demo="Dr. Andrea Sommer"),
                ],
            },
        ],
    },
    # -------------------------------------------------------------------------
    # 8. Transportauftrag Rundholz (45 Felder)
    # -------------------------------------------------------------------------
    #
    # Gegenstueck zum Transportauftrag Schnittholz, eine Stufe frueher: der
    # Abtransport vom Polter im Wald zum Saegewerk. Die Ontologie fuehrt die
    # Felder dieses Formulars bereits als eigene Properties (tc:polter_Nummer,
    # tc:abfuhrfrist, tc:ladezone_Name ...) -- sie werden hier uebernommen und
    # nicht durch allgemeinere ersetzt, damit Auswertungen ueber Rundholz-
    # transporte die Angaben unverwechselbar wiederfinden.
    "pdf_transportauftrag_rundholz": {
        "id": "pdf_transportauftrag_rundholz",
        "label": "Transportauftrag Rundholz",
        "description": "Transportauftrag für den Abtransport von Rundholz vom Polter zum Sägewerk, mit Spediteur, Ladezone, Poltermenge und Abfuhrscheinübersicht.",
        # Materialbezug: beschreibt die Bewegung konkreten Rundholzes.
        "material_ref": MATERIAL_REF_REQUIRED,
        "doc_class": "Transportauftrag",
        "data_type": "pdf_transportauftrag_rundholz",
        "main_class": "tc:TransportOrder",
        "subject_path": "transportorderrundholz",
        "sections": [
            _material_ref_section(
                "Welches Rundholz wird mit diesem Auftrag abgefahren?",
                required=True,
            ),
            {
                "id": "kopf",
                "title": "Auftrag",
                "fields": [
                    _f("kaufnummer", "Kaufnummer", "tc:kaufnummer", "Kaufnummer", required=True),
                    _f("losNr", "Los-Nr.", "tc:los_Nr", "Los-Nr"),
                    _f("datum", "Datum", "tc:datum", "Datum"),
                    _f("abfuhrfrist", "Abfuhrfrist", "tc:abfuhrfrist", "Abfuhrfrist"),
                    _f("gueltigkeitVon", "Gültigkeit von", "tc:gueltigkeit_von", "Gueltigkeit_von"),
                    _f("gueltigkeitBis", "Gültigkeit bis", "tc:gueltigkeit_bis", "Gueltigkeit_bis"),
                ],
            },
            {
                "id": "auftraggeber",
                "title": "Auftraggeber",
                "fields": [
                    _f("firmenname", "Firmenname", "tc:firmenname", "Firmenname"),
                    _f("strasse", "Straße", "tc:strasse", "Straße"),
                    _f("plz", "PLZ", "tc:pLZ", "PLZ"),
                    _f("stadt", "Stadt", "tc:stadt", "Stadt"),
                    _f("land", "Land", "tc:land", "Land"),
                ],
            },
            {
                "id": "lieferant",
                "title": "Lieferant (Forstbetrieb)",
                "fields": [
                    _f("lieferantForstamt", "Forstamt", "tc:lieferant_Forstamt", "Lieferant:_Forstamt"),
                    _f("lieferantReviername", "Reviername", "tc:lieferant_Reviername", "Lieferant:_Reviername"),
                    _f("lieferantRevierleiter", "Revierleiter", "tc:lieferant_Revierleiter", "Lieferant:_Revierleiter"),
                    _f("lieferantTelefon", "Telefonnummer", "tc:lieferant_Telefonnummer", "Lieferant:_Telefonnummer"),
                ],
            },
            {
                "id": "spediteur",
                "title": "Spediteur",
                "fields": [
                    _f("spediteurFirmenname", "Firmenname", "tc:spediteur_Firmenname", "Spediteur:_Firmenname"),
                    _f("spediteurStrasse", "Straße", "tc:spediteur_Strasse", "Spediteur:_Straße"),
                    _f("spediteurPostleitzahl", "Postleitzahl", "tc:spediteur_Postleitzahl", "Spediteur:_Postleitzahl"),
                    _f("spediteurStadt", "Stadt", "tc:spediteur_Stadt", "Spediteur:_Stadt"),
                    _f("spediteurOrt", "Ort", "tc:spediteur_Ort", "Spediteur:_Ort"),
                    _f("spediteurAnsprechVorname", "Ansprechpartner: Vorname", "tc:spediteur_Ansprechpartner_Vorname", "Spediteur:_Ansprechpartner:_Vorname"),
                    _f("spediteurAnsprechName", "Ansprechpartner: Name", "tc:spediteur_Ansprechpartner_Name", "Spediteur:_Ansprechpartner:_Name"),
                    _f("spediteurAnsprechTelefon", "Ansprechpartner: Telefonnummer", "tc:spediteur_Ansprechpartner_Telefonnummer", "Spediteur:_Ansprechpartner:_Telefonnummer"),
                    _f("spediteurAnsprechEmail", "Ansprechpartner: E-Mail", "tc:spediteur_Ansprechpartner_Email_Adresse", "Spediteur:_Ansprechpartner:_Email-Adresse"),
                ],
            },
            {
                "id": "ladezone",
                "title": "Ladezone",
                "fields": [
                    _f("ladezoneName", "Name", "tc:ladezone_Name", "Ladezone:_Name"),
                    _f("ladezonePlz", "PLZ", "tc:ladezone_PLZ", "Ladezone:_PLZ"),
                    _f("ladezoneStadt", "Stadt", "tc:ladezone_Stadt", "Ladezone:_Stadt"),
                    _f("ladezoneDistanz", "Distanz", "tc:ladezone_Distanz", "Ladezone:_Distanz"),
                    _f("abt", "Abteilung", "tc:abt", "Abt"),
                    # N/E sind die Polterkoordinaten. Bewusst als Text: das
                    # Formular laesst Grad-Minuten-Schreibweise zu, eine
                    # Zahlpruefung wuerde gueltige Eingaben verwerfen.
                    _f("koordinateN", "Koordinate N", "tc:n", "N"),
                    _f("koordinateE", "Koordinate E", "tc:e", "E"),
                ],
            },
            {
                "id": "holz",
                "title": "Holz & Menge",
                "fields": [
                    _f("polterNummer", "Polter-Nummer", "tc:polter_Nummer", "Polter_Nummer"),
                    _f("baumart", "Baumart", "tc:baumart", "Baumart"),
                    _f("produktart", "Produktart", "tc:de_Produktart", "Produktart"),
                    _f("guete", "Güte", "tc:guete", "Guete"),
                    _f("laenge", "Länge", "tc:laenge", "Laenge", unit="m"),
                    _f("mengeFestmeter", "Menge (Festmeter)", "tc:menge_Festmeter", "Menge_(Festmeter)", unit="fm"),
                    _f("mengeStueck", "Menge (Stück)", "tc:menge_Stueck", "Menge_(Stueck)", unit="Stk"),
                    _f("summeFestmeter", "Summe Festmeter", "tc:summe_Festmeter", "Summe_Festmeter", unit="fm"),
                    # Die Ontologie schreibt diese Property mit "summer_" --
                    # Tippfehler im Vokabular, hier uebernommen, weil ein
                    # abweichender Name kein definierter Term waere.
                    _f("summeStueck", "Summe Stück", "tc:summer_Stueck", "Summe_Stueck", unit="Stk"),
                ],
            },
            {
                "id": "abfuhrscheine",
                "title": "Abfuhrscheinübersicht",
                "fields": [
                    _f("abfuhrStand", "Stand", "tc:abfuhrscheinuebersicht_Stand", "Abfuhrscheinuebersicht:_Stand"),
                    _f("abfuhrKontingent", "Kontingent", "tc:abfuhrscheinuebersicht_Kontigent", "Abfuhrscheinuebersicht:_Kontigent"),
                    _f("abfuhrGesamtzahl", "Gesamtzahl Abfuhrscheine", "tc:abfuhrscheinuebersicht_Gesamtzahl_Abfuhrscheine", "Abfuhrscheinuebersicht:_Gesamtzahl_Abfuhrscheine"),
                    _f("abfuhrGenutzte", "Genutzte Abfuhrscheine", "tc:abfuhrscheinuebersicht_Genutzte_Abfuhrscheine", "Abfuhrscheinuebersicht:_Genutzte_Abfuhrscheine"),
                    _f("abfuhrOffene", "Offene Abfuhrscheine", "tc:abfuhrscheinuebersicht_offene_Abfuhrscheine", "Abfuhrscheinuebersicht:_offene_Abfuhrscheine"),
                ],
            },
        ],
    },
    # -------------------------------------------------------------------------
    # 9. Fertigungsauftrag Saege (58 Felder)
    # -------------------------------------------------------------------------
    #
    # Der Auftrag, mit dem das Saegewerk den Einschnitt fahrt. Die Mengen-
    # tabelle liegt im Formular als Spaltenpaar vor (Variante _1 und _2, bei
    # den Lagerzeilen zusaetzlich _3). Beide Spalten beschreiben dieselbe
    # Groesse fuer zwei Sortimente, teilen sich also das Praedikat -- genau
    # wie die Adressbestandteile im Transportauftrag.
    "pdf_fertigungsauftrag_saege": {
        "id": "pdf_fertigungsauftrag_saege",
        "label": "Fertigungsauftrag Säge",
        "description": "Fertigungsauftrag für den Einschnitt im Sägewerk: Arbeitsplatz, Produktionszeitraum, Rundholzvorgaben sowie Soll-Mengen für Haupt- und Seitenware.",
        # Materialbezug: beschreibt den Einschnitt konkreten Rundholzes.
        "material_ref": MATERIAL_REF_REQUIRED,
        "doc_class": "Fertigungsauftrag",
        "data_type": "pdf_fertigungsauftrag_saege",
        "main_class": "tc:ProductionOrder",
        "subject_path": "productionorder",
        "sections": [
            _material_ref_section(
                "Welches Holz wird mit diesem Auftrag eingeschnitten?",
                required=True,
            ),
            {
                "id": "kopf",
                "title": "Auftrag",
                "fields": [
                    _f("vorgangsnummer", "Vorgangsnummer", "tc:vorgangsnummer", "Vorgangsnummer", required=True),
                    _f("arbeitsplatz", "Arbeitsplatz", "tc:arbeitsplatz", "Arbeitsplatz"),
                    _f("datum", "Datum", "tc:datum", "Datum"),
                    _f("kaufnummer", "Kaufnummer", "tc:kaufnummer", "Kaufnummer"),
                    _f("boxSortiment", "Box / Sortiment", "tc:box_Sortiment", "Box_Sortiment"),
                    _f("fertigungshinweis", "Fertigungshinweis Säge", "tc:fertigungshinweise_Saege", "Fertigungshinweis_Säge"),
                ],
            },
            {
                "id": "kunde",
                "title": "Kunde",
                "fields": [
                    _f("kundennummer", "Kundennummer", "tc:kundennummer", "Kundennummer"),
                    _f("kundenbez", "Kundenbezeichnung", "tc:kundenbez", "Kundenbez"),
                    _f("lieferanschrift", "Lieferanschrift", "tc:lieferanschrift", "Lieferanschrift"),
                ],
            },
            {
                "id": "produktion",
                "title": "Produktion",
                "fields": [
                    _f("produktionsstart", "Produktionsstart", "tc:produktionsstart", "Produktionsstart"),
                    _f("produktionsende", "Produktionsende", "tc:produktionsende", "Produktionsende"),
                    _f("einschnittdauer", "Einschnittdauer", "tc:einschnittdauer", "Einschnittdauer"),
                ],
            },
            {
                "id": "rundholzvorgabe",
                "title": "Rundholzvorgaben",
                "fields": [
                    _f("zopfMin", "Zopf min.", "tc:zopf_min", "Zopf_min"),
                    _f("zopfMax", "Zopf max.", "tc:zopf_max", "Zopf_max"),
                    _f("laengeMin", "Länge min.", "tc:laenge_min", "Länge_min"),
                    _f("laengeMax", "Länge max.", "tc:laenge_max", "Länge_max"),
                ],
            },
            {
                "id": "boxenLager",
                "title": "Boxen & Lager",
                "fields": [
                    _f("box1", "Box 1", "tc:box", "Box_1"),
                    _f("box2", "Box 2", "tc:box_v2", "Box_2"),
                    _f("box3", "Box 3", "tc:box_v2", "Box_3"),
                    _f("lager1", "Lager 1", "tc:lager", "Lager_1"),
                    _f("lager2", "Lager 2", "tc:lager", "Lager_2"),
                    _f("lager3", "Lager 3", "tc:lager", "Lager_3"),
                    _f("stueck1", "Stück 1", "tc:stueck", "Stück_1", ftype="number", unit="Stk"),
                    _f("stueck2", "Stück 2", "tc:stueck", "Stück_2", ftype="number", unit="Stk"),
                    _f("stueck3", "Stück 3", "tc:stueck", "Stück_3", ftype="number", unit="Stk"),
                    _f("fm1", "Festmeter 1", "tc:fM", "FM_1", ftype="number", unit="fm"),
                    _f("fm2", "Festmeter 2", "tc:fM", "FM_2", ftype="number", unit="fm"),
                    _f("fm3", "Festmeter 3", "tc:fM", "FM_3", ftype="number", unit="fm"),
                    # Zwei Leerspalten des Formulars. Sie tragen im Original
                    # keine Beschriftung; ohne Eintrag hier waeren sie
                    # allerdings ungemappte Felder (test_pdf_field_names).
                    _f("leer1", "Freifeld 1", "tc:leer", "Leer_1"),
                    _f("leer3", "Freifeld 3", "tc:leer", "Leer_3"),
                ],
            },
            {
                "id": "hauptware",
                "title": "Hauptware",
                "fields": [
                    _f("hauptwareStueck1", "Stück (1)", "tc:hauptware_Stueck", "Hauptware_Stück_1", ftype="number", unit="Stk"),
                    _f("hauptwareStueck2", "Stück (2)", "tc:hauptware_Stueck", "Hauptware_Stück_2", ftype="number", unit="Stk"),
                    _f("hauptwareStaerkeEm1", "Stärke EM (1)", "tc:hauptware_Staerke_EM", "Hauptware_Stärke_EM_1", ftype="number", unit="mm"),
                    _f("hauptwareStaerkeEm2", "Stärke EM (2)", "tc:hauptware_Staerke_EM", "Hauptware_Stärke_EM_2", ftype="number", unit="mm"),
                    _f("hauptwareStaerkeVm1", "Stärke VM (1)", "tc:hauptware_Staerke_VM", "Hauptware_Stärke_VM_1", ftype="number", unit="mm"),
                    _f("hauptwareStaerkeVm2", "Stärke VM (2)", "tc:hauptware_Staerke_VM", "Hauptware_Stärke_VM_2", ftype="number", unit="mm"),
                    _f("hauptwareBreiteEm1", "Breite EM (1)", "tc:hauptware_Breite_EM", "Hauptware_Breite_EM_1", ftype="number", unit="mm"),
                    _f("hauptwareBreiteEm2", "Breite EM (2)", "tc:hauptware_Breite_EM", "Hauptware_Breite_EM_2", ftype="number", unit="mm"),
                    _f("hauptwareBreiteVm1", "Breite VM (1)", "tc:hauptware_Breite_VM", "Hauptware_Breite_VM_1", ftype="number", unit="mm"),
                    _f("hauptwareBreiteVm2", "Breite VM (2)", "tc:hauptware_Breite_VM", "Hauptware_Breite_VM_2", ftype="number", unit="mm"),
                    _f("hauptwareSollM31", "Soll m³ (1)", "tc:hauptware_Soll_m3", "Hauptware_Soll_m3_1", ftype="number", unit="m³"),
                    _f("hauptwareSollM32", "Soll m³ (2)", "tc:hauptware_Soll_m3", "Hauptware_Soll_m3_2", ftype="number", unit="m³"),
                    _f("hauptwareSollPakete1", "Soll Pakete (1)", "tc:hauptware_Soll_Pakete", "Hauptware_Soll_Pakete_1", ftype="number"),
                    _f("hauptwareSollPakete2", "Soll Pakete (2)", "tc:hauptware_Soll_Pakete", "Hauptware_Soll_Pakete_2", ftype="number"),
                ],
            },
            {
                "id": "seitenware",
                "title": "Seitenware",
                "fields": [
                    _f("seitenwareStueck1", "Stück (1)", "tc:seitenware_Stueck", "Seitenware_Stück_1", ftype="number", unit="Stk"),
                    _f("seitenwareStueck2", "Stück (2)", "tc:seitenware_Stueck", "Seitenware_Stück_2", ftype="number", unit="Stk"),
                    _f("seitenwareStaerkeEm1", "Stärke EM (1)", "tc:seitenware_Staerke_EM", "Seitenware_Stärke_EM_1", ftype="number", unit="mm"),
                    _f("seitenwareStaerkeEm2", "Stärke EM (2)", "tc:seitenware_Staerke_EM", "Seitenware_Stärke_EM_2", ftype="number", unit="mm"),
                    _f("seitenwareStaerkeVm1", "Stärke VM (1)", "tc:seitenware_Staerke_VM", "Seitenware_Stärke_VM_1", ftype="number", unit="mm"),
                    _f("seitenwareStaerkeVm2", "Stärke VM (2)", "tc:seitenware_Staerke_VM", "Seitenware_Stärke_VM_2", ftype="number", unit="mm"),
                    _f("seitenwareBreiteEm1", "Breite EM (1)", "tc:seitenware_Breite_EM", "Seitenware_Breite_EM_1", ftype="number", unit="mm"),
                    _f("seitenwareBreiteEm2", "Breite EM (2)", "tc:seitenware_Breite_EM", "Seitenware_Breite_EM_2", ftype="number", unit="mm"),
                    _f("seitenwareBreiteVm1", "Breite VM (1)", "tc:seitenware_Breite_VM", "Seitenware_Breite_VM_1", ftype="number", unit="mm"),
                    _f("seitenwareBreiteVm2", "Breite VM (2)", "tc:seitenware_Breite_VM", "Seitenware_Breite_VM_2", ftype="number", unit="mm"),
                    _f("seitenwareSollM31", "Soll m³ (1)", "tc:seitenware_Soll_m3", "Seitenware_Soll_m3_1", ftype="number", unit="m³"),
                    _f("seitenwareSollM32", "Soll m³ (2)", "tc:seitenware_Soll_m3", "Seitenware_Soll_m3_2", ftype="number", unit="m³"),
                    _f("seitenwareSollPakete1", "Soll Pakete (1)", "tc:seitenware_Soll_Pakete", "Seitenware_Soll_Pakete_1", ftype="number"),
                    _f("seitenwareSollPakete2", "Soll Pakete (2)", "tc:seitenware_Soll_Pakete", "Seitenware_Soll_Pakete_2", ftype="number"),
                ],
            },
        ],
    },
    # -------------------------------------------------------------------------
    # 10. Leistungserklaerung Brettsperrholz (66 Felder)
    # -------------------------------------------------------------------------
    #
    # Eigenes Template, kein Sonderfall der Schnittholz-Leistungserklaerung:
    # Brettsperrholz wird nach EN 16351 erklaert und traegt Kennwerte, die es
    # bei Schnittholz nicht gibt (Rollschub, Lagenaufbau, Klebstoffe).
    #
    # Gruppe C: die Erklaerung beschreibt einen Produkt-TYP, nicht eine
    # konkrete Platte. Den Ident bringt das ausgestellte Dokument mit; die
    # Sektion dafuer haengt _attach_document_ident_sections automatisch an.
    "pdf_leistungserklaerung_bsp": {
        "id": "pdf_leistungserklaerung_bsp",
        "label": "Leistungserklärung Brettsperrholz",
        "description": "Leistungserklärung für Brettsperrholz (BSP/CLT) nach EN 16351 mit Aufbau, mechanischen Kennwerten und bauphysikalischen Eigenschaften.",
        "material_ref": MATERIAL_REF_NONE,
        "doc_class": "Leistungserklärung",
        "data_type": "pdf_leistungserklaerung_bsp",
        "main_class": "tc:DeclarationOfPerformance",
        "subject_path": "dopbsp",
        "sections": [
            {
                "id": "allgemein",
                "title": "Allgemeine Angaben",
                "fields": [
                    _f("nr", "Nr. der Leistungserklärung", "tc:identifier", "Nummer", required=True),
                    _f("titel", "Titel", "tc:title", "Titel"),
                    _f("kenncode", "Eindeutiger Kenncode des Produkttyps", "tc:typeNumber", "Eindeutiger_Kenncode_des_Produkttyps"),
                    _f("verwendungszweck", "Verwendungszweck", "tc:intendedUse", "Verwendungszweck"),
                    _f("konformitaetssystem", "System zur Bewertung und Überprüfung der Leistungsbeständigkeit", "tc:conformitySystem", "System_zur_Bewertung_und_ueberpruefung_der_Leistungsbestaendigkeit"),
                    _f("mechanischeFestigkeit", "Mechanische Festigkeit und Standsicherheit", "tc:structuralUsage", "Mechanische_Festigkeit_und_Standsicherheit"),
                ],
            },
            {
                "id": "hersteller",
                "title": "Hersteller",
                "fields": [
                    _f("hersteller", "Name", "tc:manufacturer", "Hersteller"),
                    _f("herstellerStrasse", "Straße", "tc:manufacturerAddress", "Strasse_Hersteller"),
                    _f("herstellerPlz", "PLZ", "tc:manufacturerAddress", "PLZ_Hersteller"),
                    _f("herstellerStadt", "Stadt", "tc:manufacturerAddress", "Stadt_Hersteller"),
                    _f("herstellerLand", "Land", "tc:manufacturerAddress", "Land_Hersteller"),
                    _f("herstellerTel", "Telefon", "tc:phone", "Tel_Hersteller"),
                    _f("herstellerFax", "Fax", "tc:fax", "Fax_Hersteller"),
                    _f("herstellerWebsite", "Website", "tc:contactInformation", "Website_Hersteller"),
                    _f("bevollmaechtigter", "Bevollmächtigter", "tc:authorizedPersonName", "Bevollmaechtigter"),
                ],
            },
            {
                "id": "zertifizierung",
                "title": "Bewertung & notifizierte Stelle",
                "fields": [
                    _f("notifizierteStelle", "Notifizierte Stelle", "tc:notifiedBody", "Notifizierte_Stelle"),
                    _f("bewertungsstelle", "Technische Bewertungsstelle", "tc:notifiedBody", "Technische_Bewertungsstelle"),
                    _f("bewertungsdokument", "Europäisches Bewertungsdokument", "tc:standardReference", "Europaeisches_Bewertungsdokument"),
                    _f("technischeBewertung", "Europäische Technische Bewertung", "tc:standardReference", "Europaeisch_Technische_Bewertung"),
                ],
            },
            {
                "id": "aufbau",
                "title": "Aufbau & Geometrie",
                "fields": [
                    _f("anzahlLagen", "Anzahl der Lagen", "tc:layer", "Anzahl_der_Lagen", ftype="number"),
                    _f("dicke", "Dicke", "tc:thickness", "Dicke", unit="mm"),
                    _f("breite", "Breite", "tc:breite", "Breite", unit="m"),
                    _f("laenge", "Länge", "tc:laenge", "Laenge", unit="m"),
                    _f("holzart", "Holzart", "tc:holzart", "Holzart"),
                    _f("festigkeitsklasse", "Festigkeitsklasse", "tc:strengthClass", "Festigkeitsklasse"),
                    _f("toleranzenDicken", "Toleranzen für Dicken", "tc:thicknessTolerance", "Toleranzen_fuer_Dicken"),
                    _f("toleranzenBreitenLaengen", "Toleranzen für Breiten und Längen", "tc:widthTolerance", "Toleranzen_fuer_Breiten_und_Laengen"),
                    _f("dimensionsstabilitaet", "Dimensionsstabilität (Feuchte im Lieferzustand)", "tc:moistureContent", "Dimensionsstabilitaet_als_Feuchte_im_Lieferzustand"),
                    _f("waermeausdehnung", "Wärmeausdehnungskoeffizient", "tc:thermalExpansionCoefficient", "Waermeausdehnungskoeffizient"),
                    _f("nutzungsklasse", "Nutzungsklasse", "tc:serviceClass", "Nutzungsklasse"),
                    _f("dauerhaftigkeitLamellen", "Dauerhaftigkeitsklasse der unbehandelten Lamellen", "tc:durabilityClass", "Umgebungsbedingungen_als_Dauerhaftigkeitsklasse_der_unbehandelten_Lamellen"),
                    _f("verwendeteKlebstoffe", "Verwendete Klebstoffe", "tc:adhesiveType", "Verwendete_Klebstoffe"),
                    _f("klebfugenintegritaet", "Klebfugenintegrität (Delaminierungsprüfung)", "tc:delaminationResistance", "Klebfugenintegritaet_als_Delaminierungspruefung"),
                ],
            },
            {
                "id": "mechanikPlatte",
                "title": "Mechanik senkrecht zur Plattenebene",
                "fields": [
                    _f("biegungSenkrecht", "Charakteristische Biegefestigkeit", "tc:bendingStrengthFlatwise", "Charakteristische_Biegefestigkeit_senkrecht_zur_Platte", unit="N/mm²"),
                    _f("druckSenkrecht", "Charakteristische Druckfestigkeit", "tc:compressiveStrengthPerpendicular", "Charakteristische_Druckfestigkeit_senkrecht_zur_Platte", unit="N/mm²"),
                    _f("rollschubSenkrecht", "Rollschubfestigkeit", "tc:rollingShearStrength", "Schubfestigkeit_rechtwinklig_zur_Faserrichtung_der_Bretter_(Rollschubfestigkeit)_senkrecht_zur_Platte", unit="N/mm²"),
                    _f("eModulParallelSenkrecht", "E-Modul parallel zur Faserrichtung", "tc:elasticModulusFlatwise", "Elastizitaetsmoduls_parallel_zur_Faserrichtung_der_Bretter_senkrecht_zur_Platte", unit="N/mm²"),
                    _f("eModulRechtwinkligSenkrecht", "E-Modul rechtwinklig zur Faserrichtung", "tc:elasticModulusPerpendicularToGrain", "Elastizitaetsmoduls_rechtwinklig_zur_Faserrichtung_der_Bretter_senkrecht_zur_Platte", unit="N/mm²"),
                    _f("schubmodulParallelSenkrecht", "Schubmodul parallel zur Faserrichtung", "tc:shearModulusFlatwise", "Schubmodul_parallel_zur_Faserrichtung_der_Bretter_senkrecht_zur_Platte", unit="N/mm²"),
                    _f("rollschubmodulSenkrecht", "Rollschubmodul", "tc:rollingShearModulus", "Schubmodul_rechtwinklig_zur_Faserrichtung_der_Bretter_(Rollschubmodul)_senkrecht_zur_Platte", unit="N/mm²"),
                ],
            },
            {
                "id": "mechanikEbene",
                "title": "Mechanik in Plattenebene",
                "fields": [
                    _f("biegungEbene", "Charakteristische Biegefestigkeit", "tc:bendingStrengthEdgewise", "Charakteristische_Biegefestigkeit__in_Plattenebene", unit="N/mm²"),
                    _f("druckParallel", "Charakteristische Druckfestigkeit parallel zur Faserrichtung", "tc:compressiveStrengthParallel", "Charakteristische_Druckfestigkeit_parallel_zur_Faserrichtung_der_Bretter", unit="N/mm²"),
                    _f("zugParallel", "Charakteristische Zugfestigkeit parallel zur Faserrichtung", "tc:tensileStrengthParallel", "Charakteristische_Zugfestigkeit_parallel_zur_Faserrichtung_der_Bretter,_die_parallel_zur_Faserrichtung_beansprucht_werden", unit="N/mm²"),
                    _f("zugRechtwinklig", "Charakteristische Zugfestigkeit rechtwinklig zur Faserrichtung", "tc:tensileStrengthPerpendicular", "Charakteristische_Zugfestigkeit_rechtwinklig_zur_Faserrichtung_der_Bretter", unit="N/mm²"),
                    _f("schubBruttoquerschnitt", "Schubfestigkeit (Bruttoquerschnitt)", "tc:shearStrength", "Schubfestigkeit_fuer_die_Bemessung_mit_dem_Bruttoquerschnitt", unit="N/mm²"),
                    _f("eModulParallelEbene", "E-Modul parallel zur Faserrichtung", "tc:elasticModulusEdgewise", "Elastizitaetsmoduls_parallel_zur_Faserrichtung_der_Bretter", unit="N/mm²"),
                    _f("schubmodulParallelEbene", "Schubmodul parallel zur Faserrichtung", "tc:shearModulusEdgewise", "Schubmodul_parallel_zur_Faserrichtung_der_Bretter", unit="N/mm²"),
                    _f("rollschubfestigkeit", "Charakteristische Rollschubfestigkeit", "tc:rollingShearStrength", "Charakteristische_Rollschubfestigkeit", unit="N/mm²"),
                    _f("schubmodulMittel", "Mittelwert des Schubmoduls", "tc:meanShearModulus", "Mittelwert_des_Schubmoduls", unit="N/mm²"),
                    _f("torsionsschub", "Torsionsschubfestigkeit der Kreuzungsflächen", "tc:torsionalShearStrength", "Charakteristische_Torsionsschubfestigkeit_der_Kreuzungsflaechen", unit="N/mm²"),
                    _f("rollschubmodulMittel", "Mittlerer Rollschubmodul", "tc:rollingShearModulus", "Mittlerer_Rollschubmodul", unit="N/mm²"),
                    _f("lochleibung", "Lochleibungsfestigkeit", "tc:embedmentStrength", "Lochleibungsfestigkeit_als_Maximum_der_Lochleibungstiefe"),
                ],
            },
            {
                "id": "brandschutz",
                "title": "Brandschutz",
                "fields": [
                    _f("brandverhalten", "Brandverhalten", "tc:fireResistanceClass", "Brandverhalten"),
                    _f("feuerwiderstand", "Feuerwiderstand", "tc:fireResistanceClassNational", "Feuerwiderstand"),
                    _f("abbrandrate", "Abbrandrate", "tc:charringRate", "Abbrandrate", unit="mm/min"),
                ],
            },
            {
                "id": "bauphysik",
                "title": "Bauphysik & Emissionen",
                "fields": [
                    _f("kriechen", "Kriechen und Lasteinwirkungsdauer (Modifikationsbeiwerte)", "tc:creepFactor", "Kriechen_und_Lasteinwirkungsdauer_als_Modifikationsbeiwerte"),
                    _f("formaldehyd", "Formaldehydemissionsklasse", "tc:hazardousSubstanceEmission", "Formaldehydemission_als_Formaldehydemissionsklasse"),
                    _f("wasserdampfdiffusion", "Wasserdampfdiffusionswiderstandszahl", "tc:vapourDiffusionResistance", "Wasserdampfdiffusionswiderstandszahl_der_Flaeche"),
                    _f("gefaehrlicheStoffe", "Andere gefährliche Inhaltsstoffe", "tc:hazardousSubstanceEmission", "andere_gefaehrliche_Inhaltsstoffe"),
                    _f("schlagfestigkeit", "Schlagfestigkeit (weicher Körper)", "tc:impactResistance", "Schlagfestigkeit_mit_einem_weichen_Koerper"),
                    _f("luftschall", "Luftschalldämmung", "tc:airborneSoundInsulation", "Luftschalldaemmung"),
                    _f("trittschall", "Trittschalldämmung", "tc:impactSoundInsulation", "Trittschalldaemmung"),
                    _f("schallabsorption", "Schallabsorption", "tc:soundAbsorption", "Schallabsorption"),
                    _f("waermeleitfaehigkeit", "Wärmeleitfähigkeit", "tc:thermalTransmittance", "Waermeleitfaehigkeit", unit="W/(m·K)"),
                    _f("luftdurchlaessigkeit", "Luftdurchlässigkeit", "tc:airPermeability", "Luftdurchlaessigkeit"),
                    _f("thermischeTraegheit", "Thermische Trägheit (spez. Wärmespeicherkapazität)", "tc:thermalMass", "Thermische_Traegheit_als_spezifische_Waermespeicherkapazitaet"),
                ],
            },
        ],
    },
}


# Templates, die eine Umwandlung von Material beschreiben: aus Vormaterial
# entsteht etwas Neues mit eigenem Ident. Nur sie bekommen das Input-Feld --
# ein Pruefbericht oder Transportauftrag wandelt nichts um, dort waere die
# Frage "woraus entstanden?" sinnlos und das Feld nur Rauschen.
_TRANSFORMING_TEMPLATES = {
    # Zuschnitt: aus Schnittholz werden Zuschnitt-Teile. Einzelner Bezug,
    # solange kein n:m-Bedarf besteht.
    "pdf_schnittbild": (
        "Aus welchem Material wurde zugeschnitten? Der Ident wird beim "
        "Hochladen aus dem Dokument gelesen."
    ),
}

# Templates, die ihre Umwandlung als Saegevorgangs-Array fuehren (EECC-Format).
# Sie bekommen KEIN einzelnes materialInputEpc/materialEpc auf fields-Ebene --
# saemtliche Idente stehen in "sawings". Genau eine Stelle pro Dokumenttyp, an
# der Idente zu suchen sind; zwei waeren fuer den EECC-Parser eine Ratefrage.
_SAWING_TEMPLATES = {
    "pdf_leistungserklaerung": (
        "Welche Rundhölzer wurden zu welchen Schnittholzlamellen verarbeitet? "
        "Die Idente werden beim Hochladen aus dem Dokument gelesen."
    ),
}


def _attach_material_input_sections() -> None:
    """Haengt das Vormaterial-Feld an die umwandelnden Templates."""
    for tid, hint in _TRANSFORMING_TEMPLATES.items():
        template = TEMPLATES[tid]
        if any(s.get("material_input") for s in template["sections"]):
            continue
        template["sections"].append(_material_input_section(hint))


def _attach_sawings_sections() -> None:
    """Haengt die Saegevorgangs-Sektion an die betreffenden Templates."""
    for tid, hint in _SAWING_TEMPLATES.items():
        template = TEMPLATES[tid]
        if any(s.get("sawings") for s in template["sections"]):
            continue
        template["sections"].append(_sawings_section(hint))


def _attach_document_ident_sections() -> None:
    """Sorgt dafuer, dass JEDES Template ein Ident-Feld hat.

    Templates der Gruppe A/B haben es bereits als Materialbezug; nur Gruppe C
    bekommt hier eine eigene Sektion. Beide fuehren auf denselben Feld-Key
    (MATERIAL_REF_KEY), damit es im JSON genau EIN Ident-Feld gibt.

    Bewusst zentral statt pro Template eingetragen: der eingebettete Ident ist
    eine Eigenschaft des hochgeladenen PDFs, keine Eigenschaft der Vorlage.
    Ein neu hinzugefuegtes Template bekommt ihn damit automatisch -- ihn zu
    vergessen wuerde bedeuten, dass dessen Produktdaten spaeter nicht ueber
    den Ident auffindbar sind.
    """
    for template in TEMPLATES.values():
        # Templates mit Saegevorgaengen fuehren ihre Idente ausschliesslich
        # dort -- ein zusaetzliches materialEpc auf fields-Ebene waere eine
        # zweite Stelle, an der eine ID stehen koennte.
        if any(s.get("sawings") for s in template["sections"]):
            continue
        has_ident_field = any(
            f["key"] == MATERIAL_REF_KEY
            for s in template["sections"]
            for f in s["fields"]
        )
        if has_ident_field:
            continue
        template["sections"].append(_document_ident_section())


_attach_sawings_sections()
_attach_material_input_sections()
_attach_document_ident_sections()


# =============================================================================
# Oeffentliche API
# =============================================================================

def get_template(template_id: str) -> dict:
    template = TEMPLATES.get(template_id)
    if not template:
        raise PDFTemplateError(
            f"Unbekanntes PDF-Template: {template_id}. "
            f"Verfügbar: {', '.join(sorted(TEMPLATES.keys()))}"
        )
    return template


def get_template_pdf_path(template_id: str) -> Path:
    """Pfad zur ausfuellbaren Template-PDF."""
    get_template(template_id)  # validiert die ID
    path = PDF_TEMPLATES_DIR / f"{template_id}.pdf"
    if not path.exists():
        raise PDFTemplateError(f"Template-PDF nicht gefunden: {path.name}")
    return path


def get_templates_public() -> list[dict]:
    """Template-Liste fuer das Frontend (ohne RDF-Interna)."""
    result = []
    for template in TEMPLATES.values():
        sections = []
        for section in template["sections"]:
            sections.append({
                "id": section["id"],
                "title": section["title"],
                "description": section.get("description"),
                "repeatable": bool(section.get("repeatable")),
                "itemLabel": section.get("item_label"),
                # True = Sektion enthaelt den EPC-Bezug; der Viewer rendert hier
                # eine Auswahl der im Pod vorhandenen EPCs statt eines Textfelds.
                "materialRef": bool(section.get("material_ref")),
                # True = Sektion enthaelt die auf der Karte gezeichnete
                # Pflanzflaeche; der Viewer zeigt dafuer einen eigenen
                # Karten-Schritt nach dem Ausfuellen des Formulars.
                "plantingArea": bool(section.get("planting_area")),
                # True = Sektion traegt den beim Upload aus dem PDF gelesenen
                # Ident. Der Viewer zeigt dafuer KEINEN eigenen Schritt an --
                # der Wert kommt aus der Datei, nicht vom Nutzer.
                "documentIdent": bool(section.get("document_ident")),
                "fields": [
                    {
                        "key": f["key"],
                        "label": f["label"],
                        "type": f["type"],
                        "unit": f["unit"],
                        "required": f["required"],
                        "pdfField": f["pdf"],
                        # Beispielwert fuer die Demo-Befuellung im Viewer.
                        "demo": f.get("demo"),
                    }
                    # Abgeleitete Felder (WKT, Zentroid) sind Backend-Interna --
                    # der Nutzer fuellt sie nicht aus, also zeigt sie der
                    # Viewer auch nicht an.
                    for f in section["fields"]
                    if f["type"] != "derived"
                ],
            })
        result.append({
            "id": template["id"],
            "label": template["label"],
            "description": template["description"],
            "docClass": template["doc_class"],
            "dataType": template["data_type"],
            # "required" / "optional" / "none" -- steuert, ob der Viewer nach
            # dem bezogenen Holz fragt und ob daraus ein Event entstehen kann.
            "materialRef": template["material_ref"],
            "fileUrl": f"/api/converter/pdf-templates/{template['id']}/file",
            "sections": sections,
        })
    return result


def material_ref_of(template_id: str) -> str:
    """Materialbezug-Einstufung eines Templates (required/optional/none)."""
    return get_template(template_id)["material_ref"]


def epc_reference_of(document: dict) -> Optional[str]:
    """Den vom Nutzer gewaehlten EPC-Bezug aus einem Extraktor-Dokument lesen.

    ``None`` wenn das Template keinen Bezug kennt oder keiner angegeben wurde.
    """
    return (document.get("fields") or {}).get(MATERIAL_REF_KEY)


def planting_area_of(document: dict) -> Optional[dict]:
    """Die Pflanzflaeche aus einem Extraktor-Dokument lesen.

    ``None`` wenn das Template keine Flaeche kennt oder keine gezeichnet wurde.
    """
    fields = document.get("fields") or {}
    geojson = fields.get(PLANTING_AREA_KEY)
    if not geojson:
        return None
    return {
        "geojson": geojson,
        "wkt": fields.get(PLANTING_AREA_WKT_KEY),
        "lat": fields.get(PLANTING_AREA_LAT_KEY),
        "lon": fields.get(PLANTING_AREA_LON_KEY),
    }


# =============================================================================
# Extraktor: AcroForm-Werte -> Formulardaten -> maschinenlesbares JSON
# =============================================================================

# Zahl irgendwo im Text finden (erlaubt Einheiten-Suffixe wie "874g", "49,90 mm")
_NUMBER_SEARCH_RE = re.compile(r"-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?")


def _coerce_number(raw: Any, label: str) -> float | int:
    """Zahl aus Formulareingabe: deutsches Komma, Tausenderpunkte und
    Einheiten-Suffixe ("874g") werden toleriert."""
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return raw
    text = str(raw).strip()
    match = _NUMBER_SEARCH_RE.search(text)
    if not match:
        raise PDFTemplateError(f"Feld '{label}': '{raw}' enthält keine gültige Zahl")
    number = match.group(0)
    if "," in number:
        number = number.replace(".", "").replace(",", ".")
    value = float(number)
    return int(value) if value.is_integer() else value


_EMPTY_SELECT_RE = re.compile(r"^\s*-+\s*Ausw(ä|ae?)hlen\s*-+\s*$", re.IGNORECASE)
_CHECKBOX_OFF = {"", "off", "false", "0", "no", "nein"}

# GS1-EPC in URN-Form, wie ihn timber-event/ident_injector erzeugen:
#   urn:epc:id:sgtin:<gcp>.<itemref>.<serial>      (Einzelstueck, hpr)
#   urn:epc:class:lgtin:<gcp>.<itemref>.<lot>      (Los, eldat)
#
# Zusaetzlich toleriert: urn:epc:class:sgtin:. Nach GS1-Standard steht eine
# SGTIN unter urn:epc:id:, class: ist fuer Klassen-Idente (LGTIN) vorgesehen --
# das EECC verwendet in seinen Beispielen fuer die Leistungserklaerung aber
# class:sgtin. Hier abzulehnen wuerde die Zusammenarbeit blockieren, ohne dass
# die Datenqualitaet gewinnt: der Wert ist eindeutig ein GS1-Ident, nur der
# Namensraum ist strittig. Die Schreibweise ist mit dem EECC zu klaeren; bis
# dahin gehen beide Formen durch.
_EPC_URN_RE = re.compile(
    r"^urn:epc:(id:sgtin|class:sgtin|class:lgtin):[0-9]+\.[0-9]+\.[A-Za-z0-9_-]+$"
)


def _clean_epc_list(raw: Any, label: str) -> list[str]:
    """Eine Liste von GS1-EPCs pruefen und normalisieren.

    Akzeptiert auch einen einzelnen String -- ein Saegevorgang mit genau einem
    Rundholz ist der Normalfall bei hoher Aufloesung, und ein Aussteller, der
    dort keinen Array schreibt, soll nicht scheitern.
    """
    if raw is None:
        return []
    values = raw if isinstance(raw, list) else [raw]
    out: list[str] = []
    for value in values:
        epc = str(value).strip()
        if not epc:
            continue
        if not _EPC_URN_RE.match(epc):
            raise PDFTemplateError(
                f"{label}: '{value}' ist kein gültiger GS1-EPC. "
                "Erwartet wird urn:epc:id:sgtin:…, urn:epc:class:sgtin:… "
                "oder urn:epc:class:lgtin:…"
            )
        if epc not in out:  # Doppelnennungen im selben Vorgang zusammenfassen
            out.append(epc)
    return out


def _clean_sawings(raw: Any) -> Optional[list[dict]]:
    """Das Saegevorgangs-Array pruefen (EECC-Format, siehe SAWINGS_KEY).

    Ein Vorgang ohne Input ODER ohne Output wird verworfen: daraus laesst sich
    kein TransformationEvent bilden, und ein halber Vorgang im JSON wuerde dem
    Leser eine Verknuepfung vorspiegeln, die es nicht gibt.
    """
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise PDFTemplateError(
            "Feld 'Sägevorgänge': erwartet wird eine Liste von Vorgängen"
        )
    out: list[dict] = []
    for index, entry in enumerate(raw, start=1):
        if not isinstance(entry, dict):
            raise PDFTemplateError(
                f"Sägevorgang {index}: erwartet wird ein Objekt mit "
                f"'{MATERIAL_INPUT_KEY}' und '{MATERIAL_REF_KEY}'"
            )
        inputs = _clean_epc_list(
            entry.get(MATERIAL_INPUT_KEY), f"Sägevorgang {index}, Rundholz"
        )
        outputs = _clean_epc_list(
            entry.get(MATERIAL_REF_KEY), f"Sägevorgang {index}, Schnittholz"
        )
        if not inputs or not outputs:
            continue
        out.append({MATERIAL_INPUT_KEY: inputs, MATERIAL_REF_KEY: outputs})
    return out or None


# -----------------------------------------------------------------------------
# Pflanzflaeche: GeoJSON -> WKT + Zentroid
# -----------------------------------------------------------------------------

# Deutschland-Bounding-Box (grosszuegig). Dient nur dazu, offensichtlich
# vertauschte lat/lon oder voellig falsche Koordinaten frueh zu erkennen --
# eine Pflanzflaeche mitten im Pazifik ist ein Eingabefehler, kein Datenpunkt.
_DE_LON_RANGE = (5.0, 16.0)
_DE_LAT_RANGE = (46.0, 56.0)


def _polygon_ring(raw: Any) -> list[tuple[float, float]]:
    """Aeusseren Ring eines GeoJSON-Polygons als [(lon, lat), ...] lesen.

    Akzeptiert Feature, Geometry oder den blanken Koordinaten-Array, weil
    Karten-Bibliotheken sich hier unterschiedlich verhalten.
    """
    if isinstance(raw, str):
        import json as json_lib
        try:
            raw = json_lib.loads(raw)
        except ValueError:
            raise PDFTemplateError("Pflanzfläche: kein gültiges GeoJSON")

    if isinstance(raw, dict):
        if raw.get("type") == "Feature":
            raw = raw.get("geometry")
        if not isinstance(raw, dict):
            raise PDFTemplateError("Pflanzfläche: GeoJSON ohne Geometrie")
        geom_type = raw.get("type")
        coords = raw.get("coordinates")
        if geom_type == "Polygon":
            rings = coords
        elif geom_type == "MultiPolygon":
            # Nur die erste Teilflaeche: eine Pflanzflaeche ist fachlich ein
            # zusammenhaengendes Stueck Wald.
            rings = (coords or [[]])[0]
        else:
            raise PDFTemplateError(
                f"Pflanzfläche: Geometrietyp '{geom_type}' wird nicht unterstützt — Polygon erwartet"
            )
    else:
        rings = raw

    if not isinstance(rings, list) or not rings or not isinstance(rings[0], list):
        raise PDFTemplateError("Pflanzfläche: leeres oder ungültiges Polygon")

    ring: list[tuple[float, float]] = []
    for point in rings[0]:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            raise PDFTemplateError("Pflanzfläche: ungültiger Koordinatenpunkt")
        try:
            lon, lat = float(point[0]), float(point[1])
        except (TypeError, ValueError):
            raise PDFTemplateError("Pflanzfläche: Koordinaten sind keine Zahlen")
        if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
            raise PDFTemplateError("Pflanzfläche: Koordinaten außerhalb des gültigen Bereichs")
        ring.append((lon, lat))

    # Geschlossenen Ring nicht doppelt zaehlen
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring = ring[:-1]
    if len(ring) < 3:
        raise PDFTemplateError(
            "Pflanzfläche: mindestens drei Punkte nötig, um eine Fläche aufzuspannen"
        )

    if not all(
        _DE_LON_RANGE[0] <= lon <= _DE_LON_RANGE[1]
        and _DE_LAT_RANGE[0] <= lat <= _DE_LAT_RANGE[1]
        for lon, lat in ring
    ):
        raise PDFTemplateError(
            "Pflanzfläche: liegt außerhalb von Deutschland — bitte die Fläche neu einzeichnen"
        )

    return ring


def _ring_centroid(ring: list[tuple[float, float]]) -> tuple[float, float]:
    """Flaechenschwerpunkt eines einfachen Polygons (Shoelace).

    Faellt bei entarteten Flaechen (kollinear, Flaeche 0) auf den Mittelwert
    der Eckpunkte zurueck -- der liegt immer noch im Bereich der Zeichnung.
    """
    area2 = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(len(ring)):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % len(ring)]
        cross = x0 * y1 - x1 * y0
        area2 += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross

    if abs(area2) < 1e-12:
        return (
            sum(p[0] for p in ring) / len(ring),
            sum(p[1] for p in ring) / len(ring),
        )
    factor = 1.0 / (3.0 * area2)
    return cx * factor, cy * factor


def _derive_planting_area(raw: Any) -> dict[str, Any]:
    """GeoJSON-Polygon -> {geojson, wkt, lat, lon}.

    WKT in GeoSPARQL-Achsenreihenfolge fuer CRS84: "lon lat".
    """
    import json as json_lib

    ring = _polygon_ring(raw)
    closed = ring + [ring[0]]
    points = ", ".join(f"{lon:.6f} {lat:.6f}" for lon, lat in closed)
    wkt = f"POLYGON(({points}))"
    lon_c, lat_c = _ring_centroid(ring)

    geojson = {
        "type": "Polygon",
        "coordinates": [[[round(lon, 6), round(lat, 6)] for lon, lat in closed]],
    }
    return {
        "geojson": json_lib.dumps(geojson, separators=(",", ":")),
        "wkt": wkt,
        "lat": round(lat_c, 6),
        "lon": round(lon_c, 6),
    }


def _clean_value(field: dict, raw: Any) -> Any:
    if raw is None:
        return None
    if field["type"] == "derived":
        # Abgeleitete Felder fuellt der Extraktor selbst; hier nichts zu tun.
        return None
    if field["type"] == "polygon":
        # Der Wert wird in build_document_json expandiert (WKT + Zentroid);
        # hier nur die Roh-Geometrie pruefen und normalisieren.
        if isinstance(raw, str) and not raw.strip():
            return None
        return _derive_planting_area(raw)["geojson"]
    if field["type"] == "checkbox":
        # PDF.js liefert bool; PDF-Exportwerte wie "/Off" oder den Feldnamen
        # behandeln wir tolerant. Wert des Datenpunkts ist das Feld-Label
        # (z.B. "Verteiler: Erntegut Original" -> "Erntegut Original").
        if isinstance(raw, bool):
            checked = raw
        else:
            checked = str(raw).strip().lstrip("/").lower() not in _CHECKBOX_OFF
        if not checked:
            return None
        return field["pdf"]
    if isinstance(raw, str):
        raw = raw.strip()
    if raw == "" or (isinstance(raw, str) and _EMPTY_SELECT_RE.match(raw)):
        return None
    if field["type"] == "epc_reference":
        # Streng validieren: ein falsch geschriebener EPC erzeugt eine
        # Verknuepfung, die im Graph genauso echt aussieht wie eine richtige,
        # aber ins Leere zeigt. Lieber hier abbrechen.
        epc = str(raw).strip()
        if not _EPC_URN_RE.match(epc):
            raise PDFTemplateError(
                f"Feld '{field['label']}': '{raw}' ist kein gültiger GS1-EPC. "
                "Erwartet wird urn:epc:id:sgtin:… oder urn:epc:class:lgtin:…"
            )
        return epc
    if field["type"] == "sawings":
        return _clean_sawings(raw)
    if field["type"] == "number":
        value = _coerce_number(raw, field["label"])
        if field.get("datatype") == "xsd:integer":
            return int(value)
        return value
    return str(raw)


def pdf_fields_to_form_data(
    template_id: str,
    pdf_fields: dict,
    extra_fields: Optional[dict] = None,
) -> dict:
    """Rohes AcroForm-Abbild {feldname: wert} in die Formulardaten-Struktur
    {fields: {...}, rows: {sectionId: [...]}} uebersetzen.

    Tabellen-Zeilen werden ueber das ``{n}``-Muster der Registry erkannt
    (z.B. "Fmax_7" -> Zeile 7, Key "fmax").

    ``extra_fields`` sind die im Viewer erhobenen Werte, die es bewusst NICHT
    als AcroForm-Feld gibt (EPC-Bezug, gezeichnete Pflanzflaeche). Sie kommen
    bereits mit Registry-Keys und werden unveraendert uebernommen.
    """
    template = get_template(template_id)

    flat_map: dict[str, str] = {}
    row_patterns: list[tuple[str, re.Pattern, str]] = []  # (section_id, regex, key)
    for section in template["sections"]:
        for field in section["fields"]:
            pdf_name = field["pdf"]
            if not pdf_name:
                # Viewer-Feld ohne AcroForm-Entsprechung (EPC-Bezug,
                # Pflanzflaeche) -- kommt ueber extra_fields, nicht von hier.
                continue
            if section.get("repeatable"):
                pattern = re.compile(
                    "^" + re.escape(pdf_name).replace(r"\{n\}", r"(\d+)") + "$"
                )
                row_patterns.append((section["id"], pattern, field["key"]))
            else:
                flat_map[pdf_name] = field["key"]

    fields_out: dict[str, Any] = {}
    rows_acc: dict[str, dict[int, dict[str, Any]]] = {}

    for name, raw in (pdf_fields or {}).items():
        if raw is None:
            continue
        if name in flat_map:
            fields_out[flat_map[name]] = raw
            continue
        for section_id, pattern, key in row_patterns:
            match = pattern.match(name)
            if match:
                row_no = int(match.group(1))
                rows_acc.setdefault(section_id, {}).setdefault(row_no, {})[key] = raw
                break
        # Unbekannte Feldnamen werden ignoriert (z.B. reine Anzeige-Felder)

    # Viewer-Felder (EPC-Bezug, Pflanzflaeche) kommen mit Registry-Keys und
    # gewinnen gegen gleichnamige AcroForm-Werte -- sie sind die bewusste
    # Auswahl des Nutzers im Viewer.
    known_keys = {
        f["key"]
        for section in template["sections"]
        for f in section["fields"]
    }
    for key, value in (extra_fields or {}).items():
        if key in known_keys and value is not None:
            fields_out[key] = value

    rows_out = {
        section_id: [row for _, row in sorted(numbered.items())]
        for section_id, numbered in rows_acc.items()
    }
    return {"fields": fields_out, "rows": rows_out}


def build_document_json(
    template_id: str,
    form_data: dict,
    doc_id: str,
    epc_source: Optional[str] = None,
) -> dict:
    """Extraktor: uebertraegt die Formularwerte in das maschinenlesbare
    JSON-Dokument, das die RML-Mappings referenzieren.

    ``epc_source`` haelt fest, woher der Ident stammt (EPC_SOURCE_DOCUMENT =
    aus dem versteckten PDF-Feld gelesen, EPC_SOURCE_USER = im Viewer
    ausgewaehlt). Landet als Metadatum in ``timberconnect_pdf``, nicht in
    ``fields``: es ist kein Datenpunkt des Dokuments, und in ``fields`` waere
    es ein zweiter Eintrag, der wie eine weitere ID aussieht.
    """
    from datetime import datetime, timezone

    template = get_template(template_id)
    fields_in: dict = form_data.get("fields") or {}
    rows_in: dict = form_data.get("rows") or {}

    if not re.match(r"^[A-Za-z0-9_-]+$", doc_id or ""):
        raise PDFTemplateError(f"Ungültige Dokument-ID: {doc_id!r}")

    out_fields: dict[str, Any] = {"__docId": doc_id}
    out_rows: dict[str, list[dict]] = {}
    errors: list[str] = []

    # Der Ident steht in genau einem Feld (MATERIAL_REF_KEY). Ob er aus dem
    # Dokument oder vom Nutzer stammt, sagt der Aufrufer ueber epc_source --
    # das ist nicht aus den Werten ableitbar, sobald beide dasselbe Feld
    # benutzen, und Raten waere hier die falsche Antwort.

    for section in template["sections"]:
        if section.get("repeatable"):
            cleaned_rows: list[dict] = []
            for raw_row in rows_in.get(section["id"], []) or []:
                if not isinstance(raw_row, dict):
                    continue
                cleaned: dict[str, Any] = {}
                for field in section["fields"]:
                    try:
                        value = _clean_value(field, raw_row.get(field["key"]))
                    except PDFTemplateError as e:
                        errors.append(str(e))
                        value = None
                    if value is not None:
                        cleaned[field["key"]] = value
                if cleaned:  # leere Zeilen verwerfen
                    cleaned["__docId"] = doc_id
                    cleaned["__rowIndex"] = len(cleaned_rows) + 1
                    cleaned_rows.append(cleaned)
            # Ident in jede Zeile spiegeln -- siehe _inject_ident_into_rows.
            if cleaned_rows:
                out_rows[section["id"]] = cleaned_rows
        else:
            for field in section["fields"]:
                try:
                    value = _clean_value(field, fields_in.get(field["key"]))
                except PDFTemplateError as e:
                    errors.append(str(e))
                    value = None
                if value is None and field["required"]:
                    errors.append(f"Pflichtfeld '{field['label']}' fehlt")
                if value is not None:
                    out_fields[field["key"]] = value
                    if field["type"] == "polygon":
                        # WKT + Zentroid als eigene Datenpunkte ergaenzen. Sie
                        # stehen in der Registry als "derived"-Felder und haben
                        # damit ihr eigenes Praedikat im Mapping.
                        derived = _derive_planting_area(fields_in.get(field["key"]))
                        out_fields[PLANTING_AREA_WKT_KEY] = derived["wkt"]
                        out_fields[PLANTING_AREA_LAT_KEY] = derived["lat"]
                        out_fields[PLANTING_AREA_LON_KEY] = derived["lon"]

    if errors:
        raise PDFTemplateError("; ".join(errors))

    # Den Ident in JEDE Zeile spiegeln, damit auch Zeilen-Subjekte
    # (Biegepruefungs-Proben, Transport-Lieferung) ihn direkt tragen. Ohne das
    # waere eine Probe nur ueber einen Umweg ueber das Hauptsubjekt auffindbar
    # -- die Abfrage "gib mir alle Produktdaten zu diesem Ident" wuerde sie
    # schlicht nicht zurueckliefern.
    #
    # Bei Saegevorgaengen gibt es keinen EINEN Ident des Dokuments (es sind
    # viele Lamellen aus vielen Rundhoelzern) -- dort bleibt die Spiegelung
    # aus; die Zuordnung steht in "sawings".
    effective_epc = out_fields.get(MATERIAL_REF_KEY)
    if effective_epc:
        for rows in out_rows.values():
            for row in rows:
                row[ROW_EPC_KEY] = effective_epc

    # Saegevorgaenge durchnummerieren und die Dokument-ID mitgeben: das
    # RML-Mapping bildet daraus die Subjekt-URI des Vorgangs. Beide Schluessel
    # tragen "__" und zaehlen damit nicht als Datenpunkt.
    for index, sawing in enumerate(out_fields.get(SAWINGS_KEY) or [], start=1):
        sawing["__docId"] = doc_id
        sawing[SAWING_INDEX_KEY] = index

    # Datenpunkte zaehlen (speist die Bepreisung: 1 Datenpunkt = 1 Token).
    # Schluessel mit "__" sind technisch (Dokument-ID, Zeilenindex, der in die
    # Zeilen gespiegelte Ident) und zaehlen nicht mit.
    #
    # Saegevorgaenge zaehlen als EIN Datenpunkt je Vorgang, nicht je EPC: der
    # Datenpunkt ist die Aussage "aus diesen Rundhoelzern wurden jene Lamellen".
    # Die einzelnen Idente sind die Schluessel dieser Aussage, nicht je eine
    # eigene -- sie einzeln zu berechnen wuerde eine Leistungserklaerung mit
    # feiner Aufloesung um ein Vielfaches teurer machen als dieselbe Aussage
    # grob erfasst.
    sawing_count = len(out_fields.get(SAWINGS_KEY) or [])
    counted_keys = [
        k for k in out_fields if not k.startswith("__") and k != SAWINGS_KEY
    ]
    datapoint_count = len(counted_keys) + sawing_count + sum(
        len([k for k in row if not k.startswith("__")])
        for rows in out_rows.values()
        for row in rows
    )
    if datapoint_count == 0:
        raise PDFTemplateError("Keine Datenpunkte übertragen — bitte mindestens ein Feld ausfüllen")

    meta: dict[str, Any] = {
        "template": template_id,
        "document_id": doc_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    # Herkunft des Idents -- als Metadatum, nicht als Feld: sie ist kein
    # Datenpunkt des Dokuments, und in "fields" saehe sie wie eine zweite ID
    # aus. Nachgelagerte Systeme lesen den Ident aus genau einem Feld.
    if effective_epc and epc_source:
        meta["epcSource"] = epc_source

    document = {
        "timberconnect_pdf": meta,
        "fields": out_fields,
        "rows": out_rows,
    }
    return document
