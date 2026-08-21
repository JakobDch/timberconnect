"""
File Detector Service

Automatically detects file types and extracts trace IDs from TimberConnect data files.
"""

import json
import re
import logging
from typing import Optional
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class FileType(str, Enum):
    """Supported file types for TimberConnect data."""
    STANFORD_HPR = "stanford_hpr"  # Forest/Harvester data (XML)
    ELDAT_HBA = "eldat_hba"        # Sawmill data (JSON)
    VLEX = "vlex"                   # BSP-Werk data (JSON)
    ERP_XLSX = "erp_xlsx"           # Herstellungsvorgang: ERP-Exceldatei (XLSX)
    IFC = "ifc"                     # Ausfuehrungsplanung: IFC-Auszug (STEP)
    PDF = "pdf"                     # PDF document (raw storage + optional manual KG transfer)
    UNKNOWN = "unknown"


@dataclass
class DetectionResult:
    """Result of file type detection."""
    file_type: FileType
    data_type: str  # 'forst', 'saegewerk', 'bspwerk', 'unknown'
    trace_id: Optional[str]
    confidence: float  # 0.0 to 1.0
    mapping_id: str
    error: Optional[str] = None

    @property
    def is_recognized(self) -> bool:
        return self.file_type != FileType.UNKNOWN and self.confidence >= 0.5


def detect_file_type(content: bytes, filename: str) -> DetectionResult:
    """
    Detect the file type and extract trace ID from file content.

    Args:
        content: Raw file content as bytes
        filename: Original filename

    Returns:
        DetectionResult with file type, trace ID, and confidence
    """
    try:
        # PDF: wird als Original gespeichert; die Daten koennen optional manuell
        # ueber ein PDF-Template in den Knowledge Graph uebertragen werden.
        if content[:5] == b'%PDF-' or filename.lower().endswith('.pdf'):
            return DetectionResult(
                file_type=FileType.PDF,
                data_type="dokument",
                trace_id=None,
                confidence=1.0,
                mapping_id="",
                error=None
            )

        # XLSX (ZIP-Container): binaer, darf nie in die Text-Erkennung laufen.
        # Erkannt wird derzeit nur die ERP-BSP-Tabelle des Herstellungsvorgangs.
        if content[:4] == b'PK\x03\x04' or filename.lower().endswith(('.xlsx', '.xlsm')):
            return _detect_erp_xlsx(content, filename)

        # Decode content
        try:
            text = content.decode('utf-8')
        except UnicodeDecodeError:
            text = content.decode('latin-1')

        text = text.strip()

        # IFC (Ausfuehrungsplanung): STEP-Physical-File nach ISO 10303-21.
        # VOR der XML-/JSON-Pruefung, weil IFC ebenfalls Text ist -- und vor
        # allem, weil der Ident hier NICHT in der Datei steht: er wird beim
        # Upload mitgegeben. Die trace_id bleibt deshalb None.
        if text.startswith('ISO-10303-21') or filename.lower().endswith('.ifc'):
            return _detect_ifc(text, filename)

        # Check if XML (StanForD HPR)
        if text.startswith('<?xml') or text.startswith('<Stem'):
            return _detect_stanford_hpr(text, filename)

        # Check if JSON
        if text.startswith('{'):
            try:
                data = json.loads(text)
                return _detect_json_type(data, filename)
            except json.JSONDecodeError as e:
                logger.warning(f"Invalid JSON: {e}")
                return DetectionResult(
                    file_type=FileType.UNKNOWN,
                    data_type="unknown",
                    trace_id=None,
                    confidence=0.0,
                    mapping_id="",
                    error=f"Ungueltige JSON-Datei: {str(e)}"
                )

        # Unknown format
        return DetectionResult(
            file_type=FileType.UNKNOWN,
            data_type="unknown",
            trace_id=None,
            confidence=0.0,
            mapping_id="",
            error="Unbekanntes Dateiformat. Erwartet: XML (StanForD) oder JSON (ELDAT/VLEX)"
        )

    except Exception as e:
        logger.error(f"Detection error: {e}")
        return DetectionResult(
            file_type=FileType.UNKNOWN,
            data_type="unknown",
            trace_id=None,
            confidence=0.0,
            mapping_id="",
            error=f"Fehler bei der Dateierkennung: {str(e)}"
        )


def _detect_stanford_hpr(xml_text: str, filename: str) -> DetectionResult:
    """
    Detect StanForD HPR format (forest/harvester data).

    Identification:
    - XML format with <Stem> root element
    - Contains <StemKey> with trace ID
    """
    confidence = 0.0
    trace_id = None
    error = None

    # Check for <Stem> element
    if '<Stem>' in xml_text or '<Stem ' in xml_text:
        confidence += 0.4

    # Check for StanForD-specific elements
    if '<StemKey>' in xml_text:
        confidence += 0.3
        # Extract trace ID from StemKey
        match = re.search(r'<StemKey>\s*([^<]+)\s*</StemKey>', xml_text)
        if match:
            trace_id = match.group(1).strip()

    if '<HarvestDate>' in xml_text:
        confidence += 0.1

    if '<StemCoordinates' in xml_text:
        confidence += 0.1

    if '<TimberConnectRef>' in xml_text:
        confidence += 0.1

    # If low confidence, set error
    if confidence < 0.5:
        error = "XML-Datei erkannt, aber nicht als StanForD HPR Format identifizierbar"

    return DetectionResult(
        file_type=FileType.STANFORD_HPR if confidence >= 0.5 else FileType.UNKNOWN,
        data_type="forst" if confidence >= 0.5 else "unknown",
        trace_id=trace_id,
        confidence=min(confidence, 1.0),
        mapping_id="stanford_hpr" if confidence >= 0.5 else "",
        error=error
    )


def _detect_erp_xlsx(content: bytes, filename: str) -> DetectionResult:
    """
    Detect the ERP-BSP-Eingabetabelle (Herstellungsvorgang, XLSX).

    Identification:
    - XLSX container (ZIP magic bytes)
    - Known sheet names (Vertriebsauftraege, Artikelkonfiguration, ...)
    - Optional: Identity-EPC from the 'Identifikation' sheet as trace id
    """
    from services.erp_excel_service import sniff_erp_workbook

    matched_sheets, identity_epcs = sniff_erp_workbook(content)

    # Zwei wiedererkannte Blattnamen reichen als Nachweis; das Ident-Blatt
    # erhoeht die Sicherheit, ist aber fuer die ERKENNUNG nicht Pflicht —
    # die Konvertierung erzwingt es spaeter mit verstaendlicher Meldung.
    confidence = 0.0
    if matched_sheets >= 2:
        confidence = 0.5 + min(matched_sheets, 6) * 0.05
    if identity_epcs:
        confidence += 0.2
    recognized = confidence >= 0.5

    return DetectionResult(
        file_type=FileType.ERP_XLSX if recognized else FileType.UNKNOWN,
        data_type="herstellung" if recognized else "unknown",
        trace_id=identity_epcs[0] if identity_epcs else None,
        confidence=min(confidence, 1.0),
        mapping_id="erp_bsp" if recognized else "",
        error=None if recognized else (
            "Excel-Datei erkannt, aber nicht als ERP-BSP-Eingabetabelle "
            "identifizierbar (bekannte Blattnamen fehlen)"
        ),
    )


def _detect_ifc(text: str, filename: str) -> DetectionResult:
    """
    Detect an IFC extract of the execution planning (Ausfuehrungsplanung).

    Identification:
    - STEP-Physical-File header (ISO 10303-21)
    - FILE_SCHEMA naming an IFC schema (IFC2X3, IFC4, ...)
    - At least one building element class (IfcSlab, IfcWall, ...)

    trace_id bleibt bewusst None: Die Planung kennt die GS1-Serie des
    gefertigten Bauteils nicht, der Ident wird beim Upload mitgegeben.
    """
    header = text[:2000]

    confidence = 0.0
    if header.startswith('ISO-10303-21'):
        confidence += 0.4
    schema_match = re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'(IFC[^']*)'", header)
    if schema_match:
        confidence += 0.3
    if re.search(r"=\s*IFC(SLAB|WALL|WALLSTANDARDCASE|BEAM|COLUMN|PLATE|MEMBER|ROOF)\s*\(",
                 text, re.IGNORECASE):
        confidence += 0.3

    recognized = confidence >= 0.5

    return DetectionResult(
        file_type=FileType.IFC if recognized else FileType.UNKNOWN,
        data_type="planung" if recognized else "unknown",
        trace_id=None,
        confidence=min(confidence, 1.0),
        mapping_id="ifc_planung" if recognized else "",
        error=None if recognized else (
            "IFC-Datei erkannt, aber ohne auswertbares Bauteil (erwartet werden "
            "ein ISO-10303-21-Kopf, eine FILE_SCHEMA-Angabe und mindestens ein "
            "Bauteil wie IfcSlab oder IfcWall)"
        ),
    )


def _detect_json_type(data: dict, filename: str) -> DetectionResult:
    """
    Detect JSON-based formats (ELDAT HBA or VLEX).
    """
    # Check for ELDAT HBA format
    if 'document' in data and 'eldat' in data.get('document', {}):
        return _detect_eldat_hba(data, filename)

    # Check for VLEX format
    if 'timberconnect' in data and 'merkmale' in data:
        return _detect_vlex(data, filename)

    # Check if it might be ELDAT without proper structure
    if 'document' in data:
        return DetectionResult(
            file_type=FileType.UNKNOWN,
            data_type="unknown",
            trace_id=None,
            confidence=0.2,
            mapping_id="",
            error="JSON-Datei hat 'document'-Struktur, aber kein gueltiges ELDAT-Format"
        )

    # Unknown JSON structure
    return DetectionResult(
        file_type=FileType.UNKNOWN,
        data_type="unknown",
        trace_id=None,
        confidence=0.0,
        mapping_id="",
        error="JSON-Datei erkannt, aber weder ELDAT noch VLEX Format"
    )


def _detect_eldat_hba(data: dict, filename: str) -> DetectionResult:
    """
    Detect ELDAT format (sawmill / forwarding data).

    Recognises both real KWF documents:
    - document.eldat.delivery_note  (Lieferschein, e.g. kwf_delivery_note_*.eldat)
    - document.eldat.wood_allocation (HBA / Holzbereitstellungsanzeige)

    Documents are identified downstream solely by their GS1 EPCIS identifiers,
    so no TimberConnect trace id is required for recognition.
    """
    confidence = 0.0
    error = None

    document = data.get('document', {})
    eldat = document.get('eldat', {})

    # Base ELDAT structure
    if eldat:
        confidence += 0.4

    # Any known ELDAT payload section
    if eldat.get('wood_allocation'):
        confidence += 0.4
        doc_type = eldat.get('wood_allocation', {}).get('doc_type', '')
        if doc_type:
            confidence += 0.1
    elif eldat.get('delivery_note'):
        confidence += 0.4

    # An ELDAT meta block (created_by/version) corroborates the format.
    if document.get('meta'):
        confidence += 0.1

    recognized = confidence >= 0.5
    if not recognized:
        error = "JSON-Datei hat ELDAT-Struktur, aber unvollstaendig"

    return DetectionResult(
        file_type=FileType.ELDAT_HBA if recognized else FileType.UNKNOWN,
        data_type="saegewerk" if recognized else "unknown",
        trace_id=None,
        confidence=min(confidence, 1.0),
        mapping_id="eldat_hba" if recognized else "",
        error=error
    )


def _detect_vlex(data: dict, filename: str) -> DetectionResult:
    """
    Detect VLEX Materialfluss format (BSP-Werk data).

    Identification:
    - JSON with timberconnect and merkmale at root level
    - Trace ID in timberconnect.trace_id
    - Has artikel field
    """
    confidence = 0.0
    trace_id = None
    error = None

    # Check for timberconnect
    timberconnect = data.get('timberconnect', {})
    if timberconnect:
        confidence += 0.3

    # Check for merkmale
    merkmale = data.get('merkmale', {})
    if merkmale:
        confidence += 0.3

    # Check for BSP-specific fields
    if 'BSP_TYP' in merkmale or 'BSP_PLATTENCODE' in merkmale:
        confidence += 0.2

    # Check for artikel
    if 'artikel' in data:
        confidence += 0.1

    # Extract trace ID
    trace_id = timberconnect.get('trace_id')
    if trace_id:
        confidence += 0.1

    # If low confidence, set error
    if confidence < 0.5:
        error = "JSON-Datei hat VLEX-aehnliche Struktur, aber unvollstaendig"

    return DetectionResult(
        file_type=FileType.VLEX if confidence >= 0.5 else FileType.UNKNOWN,
        data_type="bspwerk" if confidence >= 0.5 else "unknown",
        trace_id=trace_id,
        confidence=min(confidence, 1.0),
        mapping_id="vlex" if confidence >= 0.5 else "",
        error=error
    )


def get_data_type_name(data_type: str) -> str:
    """Get German display name for data type."""
    names = {
        "forst": "Forst (StanForD HPR)",
        "saegewerk": "Saegewerk (ELDAT HBA)",
        "bspwerk": "BSP-Werk (VLEX)",
        "herstellung": "Herstellung (ERP-BSP-Tabelle)",
        "dokument": "PDF-Dokument",
        "unknown": "Unbekannt"
    }
    return names.get(data_type, data_type)
