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
        # Decode content
        try:
            text = content.decode('utf-8')
        except UnicodeDecodeError:
            text = content.decode('latin-1')

        text = text.strip()

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
    Detect ELDAT HBA format (sawmill data).

    Identification:
    - JSON with document.eldat.wood_allocation structure
    - doc_type should be "hba"
    - Trace ID in document.meta.timberconnect.trace_id
    """
    confidence = 0.0
    trace_id = None
    error = None

    document = data.get('document', {})
    eldat = document.get('eldat', {})
    wood_allocation = eldat.get('wood_allocation', {})

    # Check for ELDAT structure
    if eldat:
        confidence += 0.3

    # Check for wood_allocation
    if wood_allocation:
        confidence += 0.2

    # Check doc_type
    doc_type = wood_allocation.get('doc_type', '')
    if doc_type == 'hba':
        confidence += 0.3
    elif doc_type:
        confidence += 0.1

    # Extract trace ID
    meta = document.get('meta', {})
    timberconnect = meta.get('timberconnect', {})
    trace_id = timberconnect.get('trace_id')

    if trace_id:
        confidence += 0.2

    # If low confidence, set error
    if confidence < 0.5:
        error = "JSON-Datei hat ELDAT-Struktur, aber unvollstaendig"

    return DetectionResult(
        file_type=FileType.ELDAT_HBA if confidence >= 0.5 else FileType.UNKNOWN,
        data_type="saegewerk" if confidence >= 0.5 else "unknown",
        trace_id=trace_id,
        confidence=min(confidence, 1.0),
        mapping_id="eldat_hba" if confidence >= 0.5 else "",
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
        "unknown": "Unbekannt"
    }
    return names.get(data_type, data_type)
