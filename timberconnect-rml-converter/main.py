"""
TimberConnect RML Converter API

FastAPI application for converting raw data files to RDF using RML mappings
and storing them in a Solid Pod.
"""

import os
import logging
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.rml_converter import RMLConverter, RMLConverterError
from services.solid_client import SolidClient, SolidClientError
from services.file_detector import detect_file_type, get_data_type_name, DetectionResult
from services.semantic_model_service import SemanticModelService, SemanticModelServiceError
from services.catalog_client import CatalogClient, CatalogRegistration, CatalogClientError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration from environment
SOLID_POD_URL = os.getenv(
    "SOLID_POD_URL",
    "https://tmdt-solid-community-server.de/epcisrepository"
)

# Initialize services
converter = RMLConverter()
solid_client = SolidClient(SOLID_POD_URL)
semantic_model_service = SemanticModelService()
catalog_client = CatalogClient()

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
    error: Optional[str] = None


class ConvertOnlyResponse(BaseModel):
    """Response for convert-only endpoint (no upload)."""
    success: bool
    trace_id: str
    files: list[ConvertedFileData]
    detection_warnings: list[str]
    converted_at: str
    message: Optional[str] = None


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
    trace_id_override: Optional[str] = Form(None, description="Override trace ID (optional)")
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

    detection_warnings: list[str] = []
    converted_files: list[ConvertedFileData] = []
    trace_ids_found: list[str] = []

    for upload_file in files:
        content = await upload_file.read()
        filename = upload_file.filename or "unknown"
        detection = detect_file_type(content, filename)

        if detection.trace_id:
            trace_ids_found.append(detection.trace_id)

        # Determine content type for raw file
        raw_content_type = "application/xml" if filename.endswith(".xml") else "application/json"

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

        # Convert to RDF
        rdf_content = None
        rdf_filename = None
        error = None

        try:
            # Determine trace ID for filename
            file_trace_id = trace_id_override or detection.trace_id or "unknown"

            # Convert using RML
            rdf_data, rdf_filename = converter.convert(
                content,
                filename,
                detection.mapping_id,
                file_trace_id,
                detection.data_type
            )
            rdf_content = base64.b64encode(rdf_data).decode('utf-8')

        except RMLConverterError as e:
            error = f"Konvertierung fehlgeschlagen: {str(e)}"
            detection_warnings.append(f"{filename}: {error}")

        # Generate raw filename with trace ID
        file_trace_id = trace_id_override or detection.trace_id or "unknown"
        data_type_suffix = {
            "forst": "Forst_StanForD_HPR",
            "saegewerk": "Saegewerk_ELDAT_HBA",
            "bspwerk": "BSPWerk_VLEX"
        }.get(detection.data_type, detection.data_type)
        raw_filename = f"{file_trace_id}_{data_type_suffix}.{filename.split('.')[-1]}"

        converted_files.append(ConvertedFileData(
            filename=raw_filename,
            data_type=detection.data_type,
            raw_content=base64.b64encode(content).decode('utf-8'),
            raw_content_type=raw_content_type,
            rdf_content=rdf_content,
            rdf_filename=rdf_filename,
            error=error
        ))

    # Determine trace ID
    if trace_id_override:
        trace_id = trace_id_override
    elif trace_ids_found:
        from collections import Counter
        trace_id = Counter(trace_ids_found).most_common(1)[0][0]
    else:
        raise HTTPException(
            status_code=400,
            detail="Keine Trace-ID in den Dateien gefunden. Bitte trace_id_override angeben."
        )

    return ConvertOnlyResponse(
        success=len([f for f in converted_files if f.rdf_content]) > 0,
        trace_id=trace_id,
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
    trace_ids_found: list[str] = []

    # First pass: detect all files
    file_detections: list[tuple[UploadFile, bytes, DetectionResult]] = []

    for upload_file in files:
        content = await upload_file.read()
        result = detect_file_type(content, upload_file.filename or "unknown")
        file_detections.append((upload_file, content, result))

        if result.trace_id:
            trace_ids_found.append(result.trace_id)

        if not result.is_recognized:
            warning = f"Datei '{upload_file.filename}' konnte nicht erkannt werden"
            if result.error:
                warning += f": {result.error}"
            detection_warnings.append(warning)

    # Determine trace ID to use
    if trace_id_override:
        trace_id = trace_id_override
    elif trace_ids_found:
        from collections import Counter
        trace_id = Counter(trace_ids_found).most_common(1)[0][0]
    else:
        raise HTTPException(
            status_code=400,
            detail="Keine Trace-ID in den Dateien gefunden. Bitte trace_id_override angeben."
        )

    # Second pass: convert and upload files
    for upload_file, content, detection in file_detections:
        data_type = detection.data_type

        # For unrecognized files, still try to upload raw file
        if not detection.is_recognized:
            try:
                # Upload raw file without conversion
                raw_filename = f"{trace_id}_unbekannt_{upload_file.filename}"
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

        # Convert recognized files
        try:
            logger.info(f"Processing {data_type} file: {upload_file.filename}")

            # Convert to RDF
            try:
                rdf_content, rdf_filename = converter.convert(
                    source_content=content,
                    source_filename=upload_file.filename or f"{trace_id}_{data_type}",
                    mapping_type=detection.mapping_id,
                    trace_id=trace_id,
                    data_type=data_type
                )
            except RMLConverterError as e:
                logger.error(f"Conversion error for {data_type}: {e}")
                errors.append(f"{data_type}: Konvertierung fehlgeschlagen - {str(e)}")
                results[data_type] = FileResult()
                continue

            # Determine raw filename
            ext = ".xml" if detection.mapping_id == "stanford_hpr" else ".json"
            type_suffix = {
                "forst": "Forst_StanForD_HPR",
                "saegewerk": "Saegewerk_ELDAT_HBA",
                "bspwerk": "BSPWerk_VLEX_Materialfluss"
            }.get(data_type, data_type)
            raw_filename = f"{trace_id}_{type_suffix}{ext}"

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
                        trace_id=trace_id,
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
        trace_id=trace_id,
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
            webid=None,
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
