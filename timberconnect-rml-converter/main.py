"""
TimberConnect RML Converter API

FastAPI application for converting raw data files to RDF using RML mappings
and storing them in a Solid Pod.
"""

import os
import re
import logging
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.rml_converter import RMLConverter, RMLConverterError
from services.solid_client import SolidClient, SolidClientError
from services.file_detector import detect_file_type, get_data_type_name, DetectionResult, FileType
from services.semantic_model_service import SemanticModelService, SemanticModelServiceError
from services.catalog_client import CatalogClient, CatalogRegistration, CatalogClientError
from services.epcis_client import EPCISClient, EPCISClientError
from services.ident_injector import inject_idents
from services.pdf_template_service import (
    PDFTemplateError,
    build_document_json,
    get_template,
    get_template_pdf_path,
    get_templates_public,
    pdf_fields_to_form_data,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration from environment
SOLID_POD_URL = os.getenv(
    "SOLID_POD_URL",
    "https://solid-community-server.tmdt.info/epcisrepository"
)

# Initialize services
converter = RMLConverter()
solid_client = SolidClient(SOLID_POD_URL)
semantic_model_service = SemanticModelService()
catalog_client = CatalogClient()
epcis_client = EPCISClient()

# Solid Pod folder where raw uploads land (used to build the EPCIS doc base URL,
# i.e. the EPCIS<->SOLID namespace bridge that lands in the event bizTransaction).
RAW_UPLOADS_BASE = f"{SOLID_POD_URL.rstrip('/')}/public/uploads"

# FastAPI app
app = FastAPI(
    title="TimberConnect RML Converter",
    description="Converts raw timber data files to RDF and stores them in Solid Pods",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Response models
class MappingConfig(BaseModel):
    id: str
    name: str
    inputFormat: str
    description: str
    dataType: str


class MappingsResponse(BaseModel):
    mappings: list[MappingConfig]


class FileResult(BaseModel):
    raw_url: Optional[str] = None
    rdf_url: Optional[str] = None


class ConvertResponse(BaseModel):
    success: bool
    trace_id: str
    files: dict[str, FileResult]
    converted_at: str
    message: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    version: str
    solid_pod_url: str
    rmlmapper_available: bool


class DetectedFile(BaseModel):
    filename: str
    file_type: str
    data_type: str
    data_type_name: str
    trace_id: Optional[str]
    mapping_id: str
    confidence: float
    is_recognized: bool
    error: Optional[str] = None


class DetectResponse(BaseModel):
    files: list[DetectedFile]
    detected_trace_id: Optional[str]
    all_recognized: bool


class AutoConvertResponse(BaseModel):
    success: bool
    trace_id: str
    files: dict[str, FileResult]
    detection_warnings: list[str]
    converted_at: str
    message: Optional[str] = None
    catalog_registrations: Optional[dict[str, str]] = None  # data_type -> dataset_identifier


class ConvertedFileData(BaseModel):
    """Data for a single converted file."""
    filename: str
    data_type: str
    raw_content: str  # Base64 encoded
    raw_content_type: str
    rdf_content: Optional[str] = None  # Base64 encoded TTL
    rdf_filename: Optional[str] = None
    # Anzahl RDF-Triples (= Datenpunkte) — Preisgrundlage der Token-Währung.
    triple_count: Optional[int] = None
    # Maschinenlesbares JSON-Zwischendokument (ERP-Excel), Base64 — wird wie
    # beim PDF-Pfad neben Original und TTL im Pod-Container abgelegt.
    json_content: Optional[str] = None
    json_filename: Optional[str] = None
    # Im Dokument eingebettete GS1-Idente (ERP-Excel, Blatt "Identifikation"):
    # epcs = Output (tc:epc), input_epcs = Vormaterial (tc:derivedFrom).
    # Der Viewer heftet sie an den Vorgang (attachProcessIdents).
    epcs: Optional[list[str]] = None
    input_epcs: Optional[list[str]] = None
    error: Optional[str] = None


class ConvertOnlyResponse(BaseModel):
    """Response for convert-only endpoint (no upload)."""
    success: bool
    trace_id: str
    files: list[ConvertedFileData]
    detection_warnings: list[str]
    converted_at: str
    message: Optional[str] = None


def count_triples(rdf_data: bytes) -> Optional[int]:
    """Count the RDF triples (= Datenpunkte) in a Turtle document.

    The count is computed once at conversion time and stored alongside the
    data (pricing.ttl in the pod) so the viewer never has to re-count.
    """
    try:
        from rdflib import Graph
        g = Graph()
        g.parse(data=rdf_data, format="turtle")
        return len(g)
    except Exception as e:
        logger.warning(f"Triple counting failed: {e}")
        return None


# Endpoints
@app.get("/api/converter/health", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint.
    Returns service status and configuration.
    """
    from services.rml_converter import RMLMAPPER_JAR

    return HealthResponse(
        status="healthy",
        version="1.0.0",
        solid_pod_url=SOLID_POD_URL,
        rmlmapper_available=RMLMAPPER_JAR.exists()
    )


@app.get("/api/converter/mappings", response_model=MappingsResponse)
async def get_mappings():
    """
    Get available RML mappings.
    Returns list of mapping configurations with metadata.
    """
    mappings = RMLConverter.get_available_mappings()
    return MappingsResponse(mappings=[MappingConfig(**m) for m in mappings])


@app.post("/api/converter/convert", response_model=ConvertResponse)
async def convert_files(
    trace_id: str = Form(..., description="TimberConnect Trace ID (e.g., TC-2025-005)"),
    forst_file: Optional[UploadFile] = File(None, description="Forest data file (XML)"),
    forst_mapping: Optional[str] = Form(None, description="Mapping for forest data"),
    saegewerk_file: Optional[UploadFile] = File(None, description="Sawmill data file (JSON)"),
    saegewerk_mapping: Optional[str] = Form(None, description="Mapping for sawmill data"),
    bspwerk_file: Optional[UploadFile] = File(None, description="BSP factory data file (JSON)"),
    bspwerk_mapping: Optional[str] = Form(None, description="Mapping for BSP factory data")
):
    """
    Convert uploaded files to RDF and store in Solid Pod.

    Accepts up to 3 files (forest, sawmill, BSP factory) with their respective RML mappings.
    Each file is:
    1. Converted to RDF using the specified RML mapping
    2. Uploaded to the Solid Pod (both raw file and RDF)

    Returns URLs of all uploaded files.
    """
    # Validate trace_id format
    if not trace_id or len(trace_id) < 3:
        raise HTTPException(
            status_code=400,
            detail="Invalid trace_id. Must be at least 3 characters."
        )

    # Check that at least one file is provided
    files_to_process = []
    if forst_file and forst_mapping:
        files_to_process.append(("forst", forst_file, forst_mapping))
    if saegewerk_file and saegewerk_mapping:
        files_to_process.append(("saegewerk", saegewerk_file, saegewerk_mapping))
    if bspwerk_file and bspwerk_mapping:
        files_to_process.append(("bspwerk", bspwerk_file, bspwerk_mapping))

    if not files_to_process:
        raise HTTPException(
            status_code=400,
            detail="At least one file with its mapping must be provided."
        )

    results: dict[str, FileResult] = {}
    errors: list[str] = []

    for data_type, upload_file, mapping_type in files_to_process:
        try:
            logger.info(f"Processing {data_type} file: {upload_file.filename}")

            # Read file content
            content = await upload_file.read()

            if len(content) == 0:
                errors.append(f"{data_type}: Empty file")
                results[data_type] = FileResult()
                continue

            # Convert to RDF
            try:
                rdf_content, rdf_filename = converter.convert(
                    source_content=content,
                    source_filename=upload_file.filename or f"{trace_id}_{data_type}",
                    mapping_type=mapping_type,
                    trace_id=trace_id,
                    data_type=data_type
                )
            except RMLConverterError as e:
                logger.error(f"Conversion error for {data_type}: {e}")
                errors.append(f"{data_type}: Conversion failed - {str(e)}")
                results[data_type] = FileResult()
                continue

            # Determine raw filename
            ext = ".xml" if mapping_type == "stanford_hpr" else ".json"
            type_suffix = {
                "forst": "Forst_StanForD_HPR",
                "saegewerk": "Saegewerk_ELDAT_HBA",
                "bspwerk": "BSPWerk_VLEX_Materialfluss"
            }.get(data_type, data_type)
            raw_filename = f"{trace_id}_{type_suffix}{ext}"

            # Upload to Solid Pod
            try:
                # Upload raw file
                raw_url = await solid_client.upload_raw_file(content, raw_filename)

                # Upload RDF file
                rdf_url = await solid_client.upload_rdf_file(rdf_content, rdf_filename)

                results[data_type] = FileResult(raw_url=raw_url, rdf_url=rdf_url)
                logger.info(f"Successfully processed {data_type}")

            except SolidClientError as e:
                logger.error(f"Upload error for {data_type}: {e}")
                errors.append(f"{data_type}: Upload failed - {str(e)}")
                results[data_type] = FileResult()

        except Exception as e:
            logger.error(f"Unexpected error processing {data_type}: {e}")
            errors.append(f"{data_type}: Unexpected error - {str(e)}")
            results[data_type] = FileResult()

    # Determine overall success
    success = any(
        r.rdf_url is not None
        for r in results.values()
    )

    message = None
    if errors:
        message = "; ".join(errors)

    return ConvertResponse(
        success=success,
        trace_id=trace_id,
        files=results,
        converted_at=datetime.utcnow().isoformat() + "Z",
        message=message
    )


@app.post("/api/converter/detect", response_model=DetectResponse)
async def detect_files(
    files: list[UploadFile] = File(..., description="Files to detect")
):
    """
    Detect file types and extract trace IDs from uploaded files.

    Analyzes file content to determine:
    - File type (StanForD HPR, ELDAT HBA, VLEX)
    - Data type (forst, saegewerk, bspwerk)
    - Trace ID (extracted from file content)
    - Appropriate RML mapping

    This endpoint does NOT convert or store files - use /convert-auto for that.
    """
    detected_files: list[DetectedFile] = []
    trace_ids: list[str] = []

    for upload_file in files:
        content = await upload_file.read()
        # Reset file position for potential reuse
        await upload_file.seek(0)

        result = detect_file_type(content, upload_file.filename or "unknown")

        detected_files.append(DetectedFile(
            filename=upload_file.filename or "unknown",
            file_type=result.file_type.value,
            data_type=result.data_type,
            data_type_name=get_data_type_name(result.data_type),
            trace_id=result.trace_id,
            mapping_id=result.mapping_id,
            confidence=result.confidence,
            is_recognized=result.is_recognized,
            error=result.error
        ))

        if result.trace_id:
            trace_ids.append(result.trace_id)

    # Determine the most likely trace ID (most common one)
    detected_trace_id = None
    if trace_ids:
        from collections import Counter
        detected_trace_id = Counter(trace_ids).most_common(1)[0][0]

    all_recognized = all(f.is_recognized for f in detected_files)

    return DetectResponse(
        files=detected_files,
        detected_trace_id=detected_trace_id,
        all_recognized=all_recognized
    )


@app.post("/api/converter/convert-only", response_model=ConvertOnlyResponse)
async def convert_files_only(
    files: list[UploadFile] = File(..., description="Files to convert"),
    trace_id_override: Optional[str] = Form(None, description="Override trace ID (optional)"),
    ifc_epc: Optional[str] = Form(
        None,
        description=(
            "GS1-EPC des in der IFC-Datei geplanten Bauteils. Pflicht, sobald "
            "eine IFC-Datei hochgeladen wird: Die Ausfuehrungsplanung kennt die "
            "GS1-Serie des gefertigten Bauteils nicht, der Bezug muss deshalb "
            "beim Upload hergestellt werden."
        ),
    ),
    doc_base_url: Optional[str] = Form(
        None,
        description=(
            "Base URL of the container the frontend will upload the raw document "
            "to (e.g. the uploader's own pod data/ container). Used as the EPCIS "
            "bizTransaction base so events link back to the owner's pod."
        ),
    ),
    company_prefix: Optional[str] = Form(
        None,
        description=(
            "GS1 Company Prefix des angemeldeten Uploaders (bei der Registrierung "
            "festgelegt). Pflicht — Uploads ohne Login/Registrierung werden "
            "abgelehnt. Die erzeugten SGTINs/LGTINs tragen diesen Prefix."
        ),
    ),
):
    """
    Convert files to RDF without uploading to Solid Pod.

    This endpoint:
    1. Analyzes each file to detect its type and trace ID
    2. Converts recognized files to RDF using the appropriate mapping
    3. Returns the converted data (Base64 encoded) for frontend upload

    The frontend is responsible for uploading to the Solid Pod using the user's
    authenticated session.
    """
    import base64

    # Upload ohne Login/Registrierung ist nicht erlaubt: Ohne den bei der
    # Registrierung festgelegten Company Prefix duerfen keine GS1-Idente
    # erzeugt werden (jeder Teilnehmer identifiziert sich ueber seinen GCP).
    cleaned_prefix = (company_prefix or "").strip()
    if not re.fullmatch(r"\d{4,12}", cleaned_prefix):
        raise HTTPException(
            status_code=400,
            detail=(
                "Upload erfordert eine Anmeldung mit abgeschlossener Registrierung: "
                "Es wurde kein gültiger GS1 Company Prefix (4-12 Ziffern) übermittelt."
            ),
        )

    detection_warnings: list[str] = []
    converted_files: list[ConvertedFileData] = []
    doc_hashes: list[str] = []
    failed_files: list[str] = []  # recognized files that failed RML or EPCIS

    for upload_file in files:
        content = await upload_file.read()
        filename = upload_file.filename or "unknown"
        detection = detect_file_type(content, filename)

        # Determine content type for raw file
        raw_content_type = "application/xml" if filename.endswith(".xml") else "application/json"
        source_ext = filename.split('.')[-1] if '.' in filename else "dat"

        # PDF: nur als Original durchreichen (kein RML, kein EPCIS). Die
        # Dokument-ID ist der SHA-256-Hash des PDFs; der Viewer legt das
        # Original unter data/<hash>/ ab und kann die Daten anschliessend
        # optional per Template in den Knowledge Graph uebertragen.
        if detection.file_type == FileType.PDF:
            import hashlib
            doc_hash = hashlib.sha256(content).hexdigest()[:16]
            doc_hashes.append(doc_hash)
            converted_files.append(ConvertedFileData(
                filename=f"{doc_hash}_dokument.pdf",
                data_type="dokument",
                raw_content=base64.b64encode(content).decode('utf-8'),
                raw_content_type="application/pdf",
            ))
            continue

        if not detection.is_recognized:
            warning = f"Datei '{filename}' konnte nicht erkannt werden"
            if detection.error:
                warning += f": {detection.error}"
            detection_warnings.append(warning)

            # Return raw file data without conversion
            converted_files.append(ConvertedFileData(
                filename=filename,
                data_type="unknown",
                raw_content=base64.b64encode(content).decode('utf-8'),
                raw_content_type=raw_content_type,
                error=detection.error
            ))
            continue

        # ERP-Excel (Herstellungsvorgang): eigener Pfad. Die GS1-Idente kommen
        # hier — anders als bei HPR/ELDAT — bereits AUS der Datei (Blatt
        # "Identifikation", vom ERP aus der Auftragsnummer abgeleitet), darum
        # keine Ident-GENERIERUNG. Excel -> JSON-Zwischendokument -> RML.
        #
        # Das EPCIS-CAPTURE findet trotzdem statt: Die Idente in der Datei
        # benennen nur Platte und Lamellen, sie verknuepfen sie nicht. Diese
        # Verknuepfung lebt ausschliesslich im TransformationEvent
        # (identityInput -> inputEpcList, identity -> outputEpcList). Ohne
        # Capture liegen die Daten zwar im Pod, aber ein Scan der Platte
        # findet im EPCAT kein Event und damit keine Vorkette.
        if detection.file_type == FileType.ERP_XLSX:
            import hashlib
            import json as json_lib
            from services.erp_excel_service import parse_erp_excel, ERPExcelError

            doc_hash = hashlib.sha256(content).hexdigest()[:16]
            try:
                document, erp_warnings = parse_erp_excel(content, doc_hash, filename)
                detection_warnings.extend(f"{filename}: {w}" for w in erp_warnings)
                json_bytes = json_lib.dumps(
                    document, ensure_ascii=False, indent=2
                ).encode("utf-8")
                rdf_data, _ = converter.convert(
                    json_bytes,
                    f"{doc_hash}_herstellung.json",
                    "erp_bsp",
                    doc_hash,
                    "herstellung",
                )
                # Capture des TransformationEvents. Uebergeben wird das
                # JSON-Zwischendokument, NICHT die .xlsx: Der module-Treiber
                # des EECC liest identification.identity/-Input und kann mit
                # der Excel-Binaerdatei nichts anfangen — sie fuehrt zu
                # "affords input EPCs or EPC class quantities" (exit 1).
                try:
                    await epcis_client.generate_and_capture(
                        content=json_bytes,
                        filename=f"{doc_hash}_herstellung.json",
                        data_type="herstellung",
                        doc_base_url=(doc_base_url or RAW_UPLOADS_BASE).rstrip("/"),
                        doc_id=doc_hash,
                        gcp=cleaned_prefix,
                    )
                except EPCISClientError as e:
                    # Nicht blockierend: RDF und Original sind gueltig und
                    # gehoeren in den Pod. Fehlt nur das Event, bleibt das
                    # Produkt auffindbar — lediglich ohne Vorkette.
                    detection_warnings.append(
                        f"{filename}: EPCIS-Capture fehlgeschlagen — die "
                        f"Verknuepfung zu den Lamellen fehlt: {str(e)}"
                    )

                doc_hashes.append(doc_hash)
                converted_files.append(ConvertedFileData(
                    filename=f"{doc_hash}_herstellung.xlsx",
                    data_type="herstellung",
                    raw_content=base64.b64encode(content).decode('utf-8'),
                    raw_content_type=(
                        "application/vnd.openxmlformats-officedocument"
                        ".spreadsheetml.sheet"
                    ),
                    rdf_content=base64.b64encode(rdf_data).decode('utf-8'),
                    rdf_filename=f"{doc_hash}_herstellung.ttl",
                    triple_count=count_triples(rdf_data),
                    json_content=base64.b64encode(json_bytes).decode('utf-8'),
                    json_filename=f"{doc_hash}_herstellung.json",
                    # identity ist eine Liste (Array-Notation fuer den
                    # module-Treiber), enthaelt aber genau einen Eintrag.
                    epcs=list(document["identification"]["identity"]),
                    input_epcs=document["identification"]["identityInput"],
                ))
            except ERPExcelError as e:
                error = f"ERP-Excel ungültig: {str(e)}"
                detection_warnings.append(f"{filename}: {error}")
                failed_files.append(f"{filename}: {error}")
            except RMLConverterError as e:
                error = f"Konvertierung fehlgeschlagen: {str(e)}"
                detection_warnings.append(f"{filename}: {error}")
                failed_files.append(f"{filename}: {error}")
            continue

        # IFC (Ausfuehrungsplanung): wie der ERP-Pfad ohne EPCIS-Identgenerierung.
        # Der Ident kommt hier allerdings NICHT aus der Datei — die Planung kennt
        # die GS1-Serie des gefertigten Bauteils nicht — sondern als Formularfeld
        # ifc_epc vom Upload. IFC -> JSON-Zwischendokument -> RML.
        if detection.file_type == FileType.IFC:
            import hashlib
            import json as json_lib
            from services.ifc_service import parse_ifc, IFCError

            doc_hash = hashlib.sha256(content).hexdigest()[:16]
            try:
                document, ifc_warnings = parse_ifc(
                    content, doc_hash, (ifc_epc or "").strip(), filename
                )
                detection_warnings.extend(f"{filename}: {w}" for w in ifc_warnings)
                json_bytes = json_lib.dumps(
                    document, ensure_ascii=False, indent=2
                ).encode("utf-8")
                rdf_data, _ = converter.convert(
                    json_bytes,
                    f"{doc_hash}_planung.json",
                    "ifc_planung",
                    doc_hash,
                    "planung",
                )
                doc_hashes.append(doc_hash)
                converted_files.append(ConvertedFileData(
                    filename=f"{doc_hash}_planung.ifc",
                    data_type="planung",
                    raw_content=base64.b64encode(content).decode('utf-8'),
                    raw_content_type="application/x-step",
                    rdf_content=base64.b64encode(rdf_data).decode('utf-8'),
                    rdf_filename=f"{doc_hash}_planung.ttl",
                    triple_count=count_triples(rdf_data),
                    json_content=base64.b64encode(json_bytes).decode('utf-8'),
                    json_filename=f"{doc_hash}_planung.json",
                    # Kein neuer Ident: Die Planung beschreibt ein BESTEHENDES
                    # Bauteil. Ein EPCIS-Event wuerde einen Vorgang behaupten,
                    # den es nicht gab.
                    epcs=list(document["identification"]["identity"]),
                ))
            except IFCError as e:
                error = f"IFC-Datei ungültig: {str(e)}"
                detection_warnings.append(f"{filename}: {error}")
                failed_files.append(f"{filename}: {error}")
            except RMLConverterError as e:
                error = f"Konvertierung fehlgeschlagen: {str(e)}"
                detection_warnings.append(f"{filename}: {error}")
                failed_files.append(f"{filename}: {error}")
            continue

        # Convert to RDF
        rdf_content = None
        rdf_filename = None
        triple_count = None
        # Filenames are derived from the canonical document hash returned by the
        # EPCIS service (no trace id). Provisional names until the hash is known.
        raw_filename = f"{detection.data_type}.{source_ext}"
        error = None

        # The -u/--url base for the EPCIS document is the container the frontend
        # will upload to (the owner's pod); the EPCIS service appends the document
        # hash to form the bizTransaction. Fallback: legacy central uploads folder.
        effective_doc_base_url = (doc_base_url or RAW_UPLOADS_BASE).rstrip("/")

        try:
            # Convert using RML (internal id only; output is renamed by hash below)
            rdf_data, _ = converter.convert(
                content,
                filename,
                detection.mapping_id,
                detection.data_type,
                detection.data_type
            )

            # Generate GS1 EPCIS identifiers and inject them into the RDF.
            # MANDATORY: an EPCIS failure aborts the conversion of this file.
            epcis_result = await epcis_client.generate_and_capture(
                content=content,
                filename=filename,
                data_type=detection.data_type,
                doc_base_url=effective_doc_base_url,
                gcp=cleaned_prefix,
            )
            if epcis_result:  # None only when EPCIS_ENABLED=false (operator switch)
                # Das Originaldokument mitgeben: aus ihm liest der Injector
                # die Zuordnung Ident -> Stamm/Abschnitt (HPR). Ohne sie
                # landen vorgegebene Idente samtlich auf der Dokumentebene.
                rdf_data = inject_idents(rdf_data, epcis_result, content)
                # Name raw + TTL files after the canonical document hash.
                doc_hash = epcis_result.doc_hash or detection.data_type
                doc_hashes.append(doc_hash)
                raw_filename = f"{doc_hash}_{detection.data_type}.{source_ext}"
                rdf_filename = f"{doc_hash}_{detection.data_type}.ttl"
                if not epcis_result.captured and epcis_result.capture_message:
                    detection_warnings.append(
                        f"{filename}: EPCIS-Idente erzeugt, EPCAT-Capture: "
                        f"{epcis_result.capture_message}"
                    )
            else:
                rdf_filename = f"{detection.data_type}.ttl"

            # Datenpunkte zählen (nach Ident-Injektion = finaler Stand).
            triple_count = count_triples(rdf_data)

            rdf_content = base64.b64encode(rdf_data).decode('utf-8')

        except RMLConverterError as e:
            error = f"Konvertierung fehlgeschlagen: {str(e)}"
            detection_warnings.append(f"{filename}: {error}")
            failed_files.append(f"{filename}: {error}")
        except EPCISClientError as e:
            error = f"EPCIS-Identgenerierung fehlgeschlagen: {str(e)}"
            detection_warnings.append(f"{filename}: {error}")
            failed_files.append(f"{filename}: {error}")

        converted_files.append(ConvertedFileData(
            filename=raw_filename,
            data_type=detection.data_type,
            raw_content=base64.b64encode(content).decode('utf-8'),
            raw_content_type=raw_content_type,
            rdf_content=rdf_content,
            rdf_filename=rdf_filename,
            triple_count=triple_count,
            error=error
        ))

    # EPCIS identifiers are mandatory: if any recognized file failed conversion
    # or EPCIS generation, abort the whole request — no partial pod upload.
    if failed_files:
        raise HTTPException(
            status_code=502,
            detail="Verarbeitung fehlgeschlagen (EPCIS-Idente sind verpflichtend): "
            + "; ".join(failed_files)
        )

    return ConvertOnlyResponse(
        success=len([f for f in converted_files if f.rdf_content]) > 0,
        trace_id=doc_hashes[0] if doc_hashes else "unknown",
        files=converted_files,
        detection_warnings=detection_warnings,
        converted_at=datetime.utcnow().isoformat() + "Z"
    )


@app.post("/api/converter/convert-auto", response_model=AutoConvertResponse)
async def convert_files_auto(
    files: list[UploadFile] = File(..., description="Files to convert (auto-detected)"),
    trace_id_override: Optional[str] = Form(None, description="Override trace ID (optional)"),
    authorization: Optional[str] = Header(None, description="Bearer token for Solid authentication")
):
    """
    Automatically detect, convert, and upload files to Solid Pod.

    This endpoint:
    1. Analyzes each file to detect its type and trace ID
    2. Converts recognized files to RDF using the appropriate mapping
    3. Uploads both raw files and RDF to the Solid Pod
    4. Returns warnings for unrecognized files (but still uploads them)

    Unlike /convert, this endpoint does NOT require manual mapping selection.

    If an Authorization header is provided, it will be used for authenticated
    uploads to the Solid Pod.
    """
    # Create a SolidClient instance with the auth token if provided
    access_token = None
    if authorization and authorization.startswith("Bearer "):
        access_token = authorization[7:]  # Remove "Bearer " prefix
    elif authorization and authorization.startswith("DPoP "):
        access_token = authorization[5:]  # Remove "DPoP " prefix

    # Use authenticated client if token provided, otherwise use default
    client = SolidClient(SOLID_POD_URL, access_token=access_token) if access_token else solid_client

    logger.info(f"Processing convert-auto request with {'authenticated' if access_token else 'anonymous'} client")

    detection_warnings: list[str] = []
    results: dict[str, FileResult] = {}
    errors: list[str] = []

    # First pass: detect all files
    file_detections: list[tuple[UploadFile, bytes, DetectionResult]] = []

    for upload_file in files:
        content = await upload_file.read()
        result = detect_file_type(content, upload_file.filename or "unknown")
        file_detections.append((upload_file, content, result))

        if not result.is_recognized:
            warning = f"Datei '{upload_file.filename}' konnte nicht erkannt werden"
            if result.error:
                warning += f": {result.error}"
            detection_warnings.append(warning)

    # Files are identified solely by their canonical document hash (GS1 EPCIS),
    # filled in per file during conversion below.
    doc_hash_by_type: dict[str, str] = {}

    # Second pass: convert and upload files
    for upload_file, content, detection in file_detections:
        data_type = detection.data_type

        # PDFs: nur das Original hochladen (kein RML, kein EPCIS)
        if detection.file_type == FileType.PDF:
            try:
                import hashlib
                doc_hash = hashlib.sha256(content).hexdigest()[:16]
                raw_filename = f"{doc_hash}_dokument.pdf"
                raw_url = await client.upload_file(
                    content,
                    raw_filename,
                    folder="public/uploads"
                )
                results[raw_filename] = FileResult(raw_url=raw_url, rdf_url=None)
                logger.info(f"Uploaded PDF document: {raw_filename}")
            except SolidClientError as e:
                errors.append(f"Upload fehlgeschlagen fuer '{upload_file.filename}': {str(e)}")
            continue

        # For unrecognized files, still try to upload raw file
        if not detection.is_recognized:
            try:
                # Upload raw file without conversion
                raw_filename = f"unbekannt_{upload_file.filename}"
                raw_url = await client.upload_file(
                    content,
                    raw_filename,
                    folder="public/uploads"
                )
                results[f"unbekannt_{upload_file.filename}"] = FileResult(
                    raw_url=raw_url,
                    rdf_url=None
                )
                logger.info(f"Uploaded unrecognized file: {raw_filename}")
            except SolidClientError as e:
                errors.append(f"Upload fehlgeschlagen fuer '{upload_file.filename}': {str(e)}")
            continue

        # ERP-Excel (Herstellungsvorgang): Idente stehen bereits in der Datei
        # (Blatt "Identifikation") — keine Ident-GENERIERUNG, eigener Pfad.
        # Das Capture des TransformationEvents findet dennoch statt, sonst
        # bliebe die Platte ohne Verknuepfung zu ihren Lamellen (siehe den
        # ausfuehrlichen Kommentar im ERP-Zweig von /convert-only).
        if detection.file_type == FileType.ERP_XLSX:
            import hashlib
            import json as json_lib
            from services.erp_excel_service import parse_erp_excel, ERPExcelError

            doc_hash = hashlib.sha256(content).hexdigest()[:16]
            try:
                document, erp_warnings = parse_erp_excel(
                    content, doc_hash, upload_file.filename or "herstellung.xlsx"
                )
                detection_warnings.extend(
                    f"{upload_file.filename}: {w}" for w in erp_warnings
                )
                json_bytes = json_lib.dumps(
                    document, ensure_ascii=False, indent=2
                ).encode("utf-8")
                rdf_content, _ = converter.convert(
                    json_bytes,
                    f"{doc_hash}_herstellung.json",
                    "erp_bsp",
                    doc_hash,
                    "herstellung",
                )
                doc_hash_by_type[data_type] = doc_hash
                raw_url = await client.upload_raw_file(
                    content, f"{doc_hash}_herstellung.xlsx"
                )
                await client.upload_raw_file(
                    json_bytes, f"{doc_hash}_herstellung.json"
                )
                rdf_url = await client.upload_rdf_file(
                    rdf_content, f"{doc_hash}_herstellung.ttl"
                )
                results[data_type] = FileResult(raw_url=raw_url, rdf_url=rdf_url)

                # Nach dem Pod-Upload: das JSON-Zwischendokument (nicht die
                # .xlsx) an EPCIS geben. Erst danach, damit ein
                # fehlgeschlagener Upload kein Event hinterlaesst, das auf ein
                # nicht existierendes Dokument zeigt.
                try:
                    await epcis_client.generate_and_capture(
                        content=json_bytes,
                        filename=f"{doc_hash}_herstellung.json",
                        data_type="herstellung",
                        doc_base_url=RAW_UPLOADS_BASE,
                        doc_id=doc_hash,
                    )
                except EPCISClientError as e:
                    detection_warnings.append(
                        f"{upload_file.filename}: EPCIS-Capture fehlgeschlagen "
                        f"— die Verknuepfung zu den Lamellen fehlt: {str(e)}"
                    )

                logger.info(f"Successfully processed {data_type}")
            except ERPExcelError as e:
                errors.append(f"{data_type}: ERP-Excel ungültig - {str(e)}")
                results[data_type] = FileResult()
            except RMLConverterError as e:
                errors.append(f"{data_type}: Konvertierung fehlgeschlagen - {str(e)}")
                results[data_type] = FileResult()
            except SolidClientError as e:
                errors.append(f"{data_type}: Upload fehlgeschlagen - {str(e)}")
                results[data_type] = FileResult()
            continue

        # Convert recognized files
        try:
            logger.info(f"Processing {data_type} file: {upload_file.filename}")

            # Convert to RDF (internal id only; files are renamed by hash below)
            try:
                rdf_content, _ = converter.convert(
                    source_content=content,
                    source_filename=upload_file.filename or data_type,
                    mapping_type=detection.mapping_id,
                    trace_id=data_type,
                    data_type=data_type
                )
            except RMLConverterError as e:
                logger.error(f"Conversion error for {data_type}: {e}")
                errors.append(f"{data_type}: Konvertierung fehlgeschlagen - {str(e)}")
                results[data_type] = FileResult()
                continue

            ext = ".xml" if detection.mapping_id == "stanford_hpr" else ".json"

            # Generate GS1 EPCIS identifiers and inject them into the RDF.
            # MANDATORY: an EPCIS failure raises and aborts upload of this file
            # (caught by the outer handler — no raw/TTL is written to the pod).
            epcis_result = await epcis_client.generate_and_capture(
                content=content,
                filename=upload_file.filename or f"{data_type}{ext}",
                data_type=data_type,
                doc_base_url=RAW_UPLOADS_BASE,
            )
            if epcis_result:  # None only when EPCIS_ENABLED=false (operator switch)
                rdf_content = inject_idents(rdf_content, epcis_result, content)
                doc_hash = epcis_result.doc_hash or data_type
                if not epcis_result.captured and epcis_result.capture_message:
                    detection_warnings.append(
                        f"{data_type}: EPCIS-Idente erzeugt, EPCAT-Capture: "
                        f"{epcis_result.capture_message}"
                    )
            else:
                doc_hash = data_type
            doc_hash_by_type[data_type] = doc_hash

            # Filenames derived from the document hash.
            raw_filename = f"{doc_hash}_{data_type}{ext}"
            rdf_filename = f"{doc_hash}_{data_type}.ttl"

            # Upload to Solid Pod
            try:
                raw_url = await client.upload_raw_file(content, raw_filename)
                rdf_url = await client.upload_rdf_file(rdf_content, rdf_filename)

                results[data_type] = FileResult(raw_url=raw_url, rdf_url=rdf_url)
                logger.info(f"Successfully processed {data_type}")

            except SolidClientError as e:
                logger.error(f"Upload error for {data_type}: {e}")
                errors.append(f"{data_type}: Upload fehlgeschlagen - {str(e)}")
                results[data_type] = FileResult()

        except EPCISClientError as e:
            logger.error(f"EPCIS error for {data_type}: {e}")
            errors.append(f"{data_type}: EPCIS-Identgenerierung fehlgeschlagen - {str(e)}")
            results[data_type] = FileResult()
        except Exception as e:
            logger.error(f"Unexpected error processing {data_type}: {e}")
            errors.append(f"{data_type}: Unerwarteter Fehler - {str(e)}")
            results[data_type] = FileResult()

    # Determine overall success
    success = any(
        r.rdf_url is not None
        for r in results.values()
    )

    message = None
    if errors:
        message = "; ".join(errors)

    # Catalog Registration (best-effort - failures don't block upload success)
    catalog_registrations: dict[str, str] = {}

    if catalog_client.is_enabled():
        for data_type, file_result in results.items():
            if file_result.rdf_url:
                try:
                    # Find the mapping_id for this data_type
                    mapping_id = None
                    for _, _, detection in file_detections:
                        if detection.data_type == data_type:
                            mapping_id = detection.mapping_id
                            break

                    if not mapping_id or not semantic_model_service.is_valid_mapping_id(mapping_id):
                        logger.debug(f"Skipping catalog registration for {data_type}: no valid mapping_id")
                        continue

                    # Extract semantic model from RML mapping
                    sm_content, sm_filename = semantic_model_service.extract_model(mapping_id)

                    # Create registration data (use default catalog_id from env for backend uploads)
                    registration = CatalogRegistration(
                        trace_id=doc_hash_by_type.get(data_type, data_type),
                        data_type=data_type,
                        rdf_url=file_result.rdf_url,
                        semantic_model_content=sm_content,
                        semantic_model_filename=sm_filename,
                        mapping_id=mapping_id,
                        catalog_id=catalog_client.catalog_id,  # Use default from env
                        webid=None,  # Could be extracted from auth header in future
                        raw_url=file_result.raw_url
                    )

                    # Register in catalog
                    result = await catalog_client.register_dataset(
                        registration,
                        authorization=authorization
                    )

                    catalog_registrations[data_type] = result.get("identifier", "registered")
                    logger.info(f"Registered {data_type} in catalog: {result.get('identifier')}")

                except SemanticModelServiceError as e:
                    logger.warning(f"Semantic model extraction failed for {data_type}: {e}")
                except CatalogClientError as e:
                    logger.warning(f"Catalog registration failed for {data_type}: {e}")
                except Exception as e:
                    logger.warning(f"Unexpected error during catalog registration for {data_type}: {e}")

    return AutoConvertResponse(
        success=success,
        trace_id=next(iter(doc_hash_by_type.values()), "unknown"),
        files=results,
        detection_warnings=detection_warnings,
        converted_at=datetime.utcnow().isoformat() + "Z",
        message=message,
        catalog_registrations=catalog_registrations if catalog_registrations else None
    )


class CatalogRegistrationRequest(BaseModel):
    """Request for registering a dataset in the catalog."""
    trace_id: str
    data_type: str
    mapping_id: str
    rdf_url: str
    raw_url: Optional[str] = None
    catalog_id: int  # ID of the catalog to register in
    publisher: Optional[str] = None  # Solid user name from authentication
    # WebID des Pod-Eigentuemers. Pflichtfeld der Katalog-API
    # (DatasetWriteRequest.ownerWebId) -- ohne sie laesst sich der Datensatz
    # keinem Pod zuordnen und die Registrierung wird abgewiesen.
    owner_webid: Optional[str] = None


class CatalogRegistrationResponse(BaseModel):
    """Response from catalog registration."""
    success: bool
    identifier: Optional[str] = None
    message: Optional[str] = None


@app.post("/api/converter/register-catalog", response_model=CatalogRegistrationResponse)
async def register_in_catalog(
    request: CatalogRegistrationRequest,
    authorization: Optional[str] = Header(None, description="Bearer token for authentication")
):
    """
    Register an uploaded dataset in the Semantic Data Catalog.

    This endpoint is called by the frontend after successfully uploading
    files to the Solid Pod. It extracts the semantic model from the
    corresponding RML mapping and creates a catalog entry.

    Args:
        request: Registration data including trace_id, data_type, mapping_id, and rdf_url
        authorization: Optional authorization header

    Returns:
        Registration result with the created dataset identifier
    """
    if not catalog_client.is_enabled():
        return CatalogRegistrationResponse(
            success=False,
            message="Catalog registration is disabled"
        )

    # Validate mapping_id
    if not semantic_model_service.is_valid_mapping_id(request.mapping_id):
        return CatalogRegistrationResponse(
            success=False,
            message=f"Invalid mapping_id: {request.mapping_id}. "
                    f"Available: {', '.join(semantic_model_service.get_available_mappings().keys())}"
        )

    try:
        logger.info(f"Registering {request.data_type} in catalog {request.catalog_id} for trace_id: {request.trace_id}")

        # Extract semantic model from RML mapping
        sm_content, sm_filename = semantic_model_service.extract_model(request.mapping_id)

        # Create registration data
        registration = CatalogRegistration(
            trace_id=request.trace_id,
            data_type=request.data_type,
            rdf_url=request.rdf_url,
            semantic_model_content=sm_content,
            semantic_model_filename=sm_filename,
            mapping_id=request.mapping_id,
            catalog_id=request.catalog_id,
            webid=request.owner_webid,
            raw_url=request.raw_url,
            publisher=request.publisher
        )

        # Register in catalog
        result = await catalog_client.register_dataset(
            registration,
            authorization=authorization
        )

        identifier = result.get("identifier", "registered")
        logger.info(f"Successfully registered {request.data_type} in catalog: {identifier}")

        return CatalogRegistrationResponse(
            success=True,
            identifier=identifier,
            message=f"Dataset registered successfully"
        )

    except SemanticModelServiceError as e:
        error_msg = f"Semantic model extraction failed: {str(e)}"
        logger.error(error_msg)
        return CatalogRegistrationResponse(
            success=False,
            message=error_msg
        )

    except CatalogClientError as e:
        error_msg = f"Catalog registration failed: {str(e)}"
        logger.error(error_msg)
        return CatalogRegistrationResponse(
            success=False,
            message=error_msg
        )

    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        logger.error(error_msg)
        return CatalogRegistrationResponse(
            success=False,
            message=error_msg
        )


# ---------------------------------------------------------------------------
# PDF-Templates: manuelle Datenuebernahme aus PDF-Dokumenten
# ---------------------------------------------------------------------------

class PdfTemplatesResponse(BaseModel):
    """Verfuegbare PDF-Templates inkl. Formular-Schema."""
    templates: list[dict]


class PdfFormConvertRequest(BaseModel):
    """Vom Viewer uebertragene Formulardaten eines PDF-Templates.

    Entweder ``pdf_fields`` (rohes AcroForm-Abbild {feldname: wert}, wie es
    PDF.js aus dem ausgefuellten Template liefert) oder ``form_data``
    ({fields, rows} mit Registry-Keys).
    """
    template_id: str
    # Dokument-ID = SHA-256-Hash (16 Hex-Zeichen) des Original-PDFs; verknuepft
    # Original, JSON-Extrakt und materialisierte TTL im selben Pod-Container.
    doc_id: str
    form_data: Optional[dict] = None
    pdf_fields: Optional[dict] = None
    # Im Viewer erhobene Werte ohne AcroForm-Entsprechung, mit Registry-Keys:
    # der EPC-Bezug und die auf der Karte gezeichnete Pflanzflaeche (GeoJSON).
    extra_fields: Optional[dict] = None
    # Herkunft des Idents: "document" (aus dem versteckten AcroForm-Feld des
    # hochgeladenen PDFs gelesen) oder "user" (im Viewer ausgewaehlt). Landet
    # als Metadatum im JSON, nicht als zweites Ident-Feld.
    epc_source: Optional[str] = None
    # Pod-Container, in dem Original, JSON und TTL dieses Dokuments liegen.
    # Wird zur bizTransaction des EPCIS-Events: nur darueber findet der Viewer
    # spaeter die Quelldaten zum Ident zurueck. Fehlt sie, faellt der Aufruf
    # auf RAW_UPLOADS_BASE zurueck.
    doc_base_url: Optional[str] = None


class PdfFormConvertResponse(BaseModel):
    success: bool
    template_id: str
    doc_id: str
    data_type: str
    json_content: str  # Base64: maschinenlesbares JSON (Extraktor-Ausgabe)
    json_filename: str
    rdf_content: str  # Base64: materialisierte TTL
    rdf_filename: str
    triple_count: Optional[int] = None
    message: Optional[str] = None
    # EPCIS-Ergebnis, nur bei Pflichtdokumenten gesetzt (siehe
    # EPCIS_PDF_DATA_TYPES). Der Viewer zeigt eine Warnung, wenn Idente
    # erzeugt, aber nicht ins EPCAT-Repository uebernommen wurden.
    epcis_captured: Optional[bool] = None
    epcis_message: Optional[str] = None
    epcis_event_count: Optional[int] = None


@app.get("/api/converter/pdf-templates", response_model=PdfTemplatesResponse)
async def get_pdf_templates():
    """
    Liste der verfuegbaren PDF-Templates mit Formular-Schema.

    Der Viewer rendert daraus das Uebertragungsformular (Original links,
    Template rechts bzw. Tabs in der Mobilansicht).
    """
    return PdfTemplatesResponse(templates=get_templates_public())


@app.get("/api/converter/pdf-templates/{template_id}/file")
async def get_pdf_template_file(template_id: str):
    """
    Ausfuellbare Template-PDF (AcroForm) ausliefern.

    Der Viewer rendert diese PDF interaktiv (PDF.js) neben dem Original,
    der Nutzer traegt die Werte direkt in die Formularfelder ein.
    """
    from fastapi.responses import FileResponse

    try:
        path = get_template_pdf_path(template_id)
    except PDFTemplateError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return FileResponse(
        path,
        media_type="application/pdf",
        filename=f"{template_id}.pdf",
    )


# PDF-Templates, die ein EPCIS-Event ausloesen sollen -- Abbildung von der
# Registry-``data_type`` auf den Datentyp des EPCIS-Dienstes (dort haengt der
# timber-event-Treiber dran).
#
# BEWUSST NUR PFLICHTDOKUMENTE. Ein Event beschreibt einen Vorgang der
# Lieferkette; Beidokumente (Biegepruefung, Schnittbild, Klebstoffdatenblatt)
# beschreiben keinen, sie haengen ueber tc:epc am selben Material. Fuer sie
# genuegt die Verknuepfung ueber den Ident, und ein zusaetzliches Event wuerde
# denselben Vorgang mehrfach behaupten.
#
# Heute nur die Leistungserklaerung: sie traegt in ihren versteckten
# AcroForm-Feldern (Identity_<n> / IdentityInput_<n>) die n:m-Zuordnung
# Rundholz -> Lamellen und ist damit die einzige PDF-Quelle, aus der ein
# TransformationEvent entstehen kann.
EPCIS_PDF_DATA_TYPES = {
    "pdf_leistungserklaerung": "leistungserklaerung",
}


@app.post("/api/converter/convert-pdf-form", response_model=PdfFormConvertResponse)
async def convert_pdf_form(request: PdfFormConvertRequest):
    """
    Formulardaten eines PDF-Templates in RDF materialisieren.

    Ablauf (Gegenstueck zu /convert-only fuer maschinenlesbare Dateien):
    1. Extraktor: Formulardaten -> maschinenlesbares JSON-Dokument
    2. RML-Mapping des Templates -> TTL (TimberConnect-Ontologie v6)
    3. Rueckgabe Base64-codiert; der Viewer laedt JSON + TTL mit der
       Solid-Session des Nutzers in den Container des Original-PDFs hoch.
    """
    try:
        template = get_template(request.template_id)
        form_data = request.form_data
        if request.pdf_fields is not None:
            form_data = pdf_fields_to_form_data(
                request.template_id, request.pdf_fields, request.extra_fields
            )
        if form_data is None:
            raise PDFTemplateError("Entweder 'pdf_fields' oder 'form_data' angeben")
        document = build_document_json(
            request.template_id, form_data, request.doc_id, request.epc_source
        )
    except PDFTemplateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    import base64
    import json as json_lib

    json_bytes = json_lib.dumps(document, ensure_ascii=False, indent=2).encode("utf-8")
    json_filename = f"{request.doc_id}_{request.template_id}.json"
    rdf_filename = f"{request.doc_id}_{request.template_id}.ttl"

    try:
        rdf_data, _ = converter.convert(
            source_content=json_bytes,
            source_filename=json_filename,
            mapping_type=request.template_id,
            trace_id=request.doc_id,
            data_type=template["data_type"],
        )
    except RMLConverterError as e:
        logger.error(f"PDF-Form conversion error ({request.template_id}): {e}")
        raise HTTPException(
            status_code=502,
            detail=f"RML-Konvertierung fehlgeschlagen: {str(e)}"
        )

    triple_count = count_triples(rdf_data)
    if not triple_count:
        raise HTTPException(
            status_code=502,
            detail="RML-Konvertierung lieferte keine Datenpunkte (0 Triples)"
        )

    # --- EPCIS-Ereignis aus dem erzeugten JSON ------------------------------
    #
    # Das oben gebaute JSON ist bereits die Eingabe, die timber-event erwartet
    # -- fuer die Leistungserklaerung enthaelt es die Saegevorgaenge
    # (sawings[]) und damit input-/outputEPCList eines TransformationEvents.
    #
    # Dieser Schritt fehlte hier: die Funktion erzeugte JSON und TTL und warf
    # die JSON als Ereignisgrundlage weg. Die Daten landeten im Pod, der
    # Vorgang aber in keinem Event -- die Stufe blieb eine Insel, und im
    # Herkunftsnachweis fehlten die Akteure, die nur dieses Dokument benennt.
    epcis_captured: Optional[bool] = None
    epcis_message: Optional[str] = None
    epcis_event_count: Optional[int] = None

    epcis_data_type = EPCIS_PDF_DATA_TYPES.get(template["data_type"])
    if epcis_data_type:
        try:
            epcis_result = await epcis_client.generate_and_capture(
                content=json_bytes,
                filename=json_filename,
                data_type=epcis_data_type,
                # Der Container des Original-PDFs -- die bizTransaction muss
                # dorthin zeigen, sonst findet der Viewer die Quelldaten nicht.
                doc_base_url=request.doc_base_url or RAW_UPLOADS_BASE,
                doc_id=request.doc_id,
            )
        except EPCISClientError as e:
            # Nicht abbrechen: TTL und JSON sind gueltig und gehoeren in den
            # Pod. Ohne Event fehlt nur die Verkettung -- das meldet der
            # Viewer als Warnung, statt den ganzen Upload zu verwerfen.
            logger.error(f"EPCIS error for {request.template_id}: {e}")
            epcis_captured = False
            epcis_message = str(e)
        else:
            if epcis_result:  # None nur bei EPCIS_ENABLED=false
                rdf_data = inject_idents(rdf_data, epcis_result, json_bytes)
                triple_count = count_triples(rdf_data) or triple_count
                epcis_captured = epcis_result.captured
                epcis_message = epcis_result.capture_message
                epcis_event_count = len(
                    (epcis_result.epcis_document or {})
                    .get("epcisBody", {})
                    .get("eventList", [])
                )
                logger.info(
                    f"PDF-Form EPCIS: {request.template_id} doc={request.doc_id} "
                    f"events={epcis_event_count} captured={epcis_captured}"
                )

    logger.info(
        f"PDF-Form converted: {request.template_id} doc={request.doc_id} "
        f"triples={triple_count}"
    )

    return PdfFormConvertResponse(
        success=True,
        template_id=request.template_id,
        doc_id=request.doc_id,
        data_type=template["data_type"],
        json_content=base64.b64encode(json_bytes).decode("utf-8"),
        json_filename=json_filename,
        rdf_content=base64.b64encode(rdf_data).decode("utf-8"),
        rdf_filename=rdf_filename,
        triple_count=triple_count,
        epcis_captured=epcis_captured,
        epcis_message=epcis_message,
        epcis_event_count=epcis_event_count,
    )


@app.get("/api/converter/products")
async def get_uploaded_products():
    """
    Get list of products that have been uploaded.
    This is a placeholder - in a full implementation, this would
    query the Solid Pod or a database for uploaded products.
    """
    # For now, return empty list
    # In production, this could scan the Solid Pod for uploaded files
    return {"products": []}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
