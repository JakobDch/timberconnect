"""
TimberConnect EPCIS Service (port 8003).

Generates GS1 identifiers (SGTIN / LGTIN) and EPCIS 2.0 events from raw forest
(.hpr / StanForD) and sawmill (.eldat / KWF) documents using the EECC-supplied
timber-event script, and forwards the events to the EECC EPCAT repository.

Endpoints (prefix /api/epcis):
  GET  /health              service + config status
  POST /generate            run timber-event on an uploaded file -> identifiers
                            + a clean EPCIS document (no capture)
  POST /capture             POST a (previously generated) EPCIS document to EPCAT
  POST /generate-and-capture  one-shot: generate + capture
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import settings
from services.epcat_client import EPCATClient, EPCATError
from services.epcat_query import EPCATQueryClient, EPCATQueryError, epcs_of_event
from services.epcis_builder import build_document
from services.serial_import import SerialImportError, run_serial_import
from services.solid_auth import SolidAuthError, verify_solid_token
from services.solid_rdf import (
    ConsentDoc,
    get_consent_for_owner,
    get_role_for_webid,
    pod_base_from_webid,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("timberconnect-epcis")

app = FastAPI(title="TimberConnect EPCIS Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _epcat_client() -> EPCATClient:
    return EPCATClient(
        base_url=settings.epcat_base_url,
        auth=settings.epcat_auth,
        timeout=settings.epcat_timeout,
        enabled=settings.epcat_enabled,
        max_attempts=settings.epcat_max_attempts,
        retry_backoff=settings.epcat_retry_backoff,
        poll_interval=settings.epcat_poll_interval,
        poll_timeout=settings.epcat_poll_timeout,
        min_spacing=settings.epcat_min_spacing,
    )


def _epcat_query_client() -> EPCATQueryClient:
    return EPCATQueryClient(
        base_url=settings.epcat_base_url,
        auth=settings.epcat_auth,
        timeout=settings.epcat_timeout,
        enabled=settings.epcat_enabled,
        page_size=settings.epcat_query_page_size,
    )


def _owner_pod_for_event(event: dict[str, Any]) -> Optional[str]:
    """Derive the data owner's pod base from an event's bizTransactionList.

    timber-event writes the Solid document URL into bizTransaction, which is
    the bridge from EPCIS namespaces back to the owning pod (see the
    epcis-serial-import-script memory). We take the first http bizTransaction and
    reduce it to its pod base (scheme://host/podname/).
    """
    for bt in event.get("bizTransactionList", []) or []:
        url = bt.get("bizTransaction") if isinstance(bt, dict) else None
        if isinstance(url, str) and url.startswith("http"):
            return pod_base_from_webid(url)
    return None


# ---------------------------------------------------------------- models -----
class IdentList(BaseModel):
    data_type: str
    gcp: str
    item_ref: str
    doc_base_url: str
    biz_transaction_url: Optional[str] = None
    doc_hash: Optional[str] = None
    sgtins: list[str] = []
    quantities: list[dict[str, Any]] = []
    # timber-event format driver that ran ("hpr", "seed", "module", ...).
    format: str = ""
    # True when the document produced a TransformationEvent; sgtins/quantities
    # then describe the *output* side and input_epcs/-quantities the consumed
    # raw material.
    is_transformation: bool = False
    input_epcs: list[str] = []
    input_quantities: list[dict[str, Any]] = []


class GenerateResponse(BaseModel):
    success: bool
    idents: IdentList
    epcis_document: dict[str, Any]


class CaptureRequest(BaseModel):
    epcis_document: dict[str, Any]


class CaptureResponse(BaseModel):
    submitted: bool
    dry_run: bool = False
    status_code: Optional[int] = None
    capture_job_url: Optional[str] = None
    message: Optional[str] = None


class GenerateAndCaptureResponse(GenerateResponse):
    capture: CaptureResponse


class EventQueryRequest(BaseModel):
    # Optional EPC to match (SGTIN/LGTIN). If omitted, all events the caller is
    # entitled to are returned.
    epc: Optional[str] = None
    # Optional extra EPCIS query parameters passed through to EPCAT.
    params: dict[str, str] = {}


class EventQueryResponse(BaseModel):
    events: list[dict[str, Any]]
    total_before_filter: int
    returned: int
    filtered_out: int
    caller_web_id: Optional[str] = None
    caller_role: Optional[str] = None
    auth_enforced: bool


# --------------------------------------------------------------- helpers -----
def _quant_dicts(quantities) -> list[dict[str, Any]]:
    return [
        {"epcClass": q.epc_class, "quantity": q.quantity, "uom": q.uom}
        for q in quantities
    ]


def _idents_from_result(result) -> IdentList:
    return IdentList(
        data_type=result.data_type,
        gcp=result.gcp,
        item_ref=result.item_ref,
        doc_base_url=result.doc_base_url,
        biz_transaction_url=result.biz_transaction_url,
        doc_hash=result.doc_hash,
        sgtins=result.sgtins,
        quantities=_quant_dicts(result.quantities),
        format=result.format,
        is_transformation=result.is_transformation,
        input_epcs=result.input_epcs,
        input_quantities=_quant_dicts(result.input_quantities),
    )


def _effective_gcp(gcp: Optional[str]) -> str:
    """Per-Teilnehmer-GCP aus dem Request; Fallback auf den konfigurierten
    Default (Demo/Legacy). Format: 4-12 Ziffern (GS1 Company Prefix)."""
    if gcp is None or gcp.strip() == "":
        return settings.gcp
    cleaned = gcp.strip()
    if not re.fullmatch(r"\d{4,12}", cleaned):
        raise HTTPException(
            status_code=422,
            detail=f"Ungültiger GS1 Company Prefix '{cleaned}' (erwartet: 4-12 Ziffern)",
        )
    return cleaned


async def _run_generate(
    *,
    file: UploadFile,
    data_type: str,
    doc_base_url: Optional[str],
    doc_id: Optional[str],
    gcp: Optional[str] = None,
):
    content = await file.read()
    item_ref = settings.item_ref_for(data_type)
    base_url = doc_base_url or settings.default_doc_base_url
    try:
        result = run_serial_import(
            content=content,
            filename=file.filename or "document",
            data_type=data_type,
            gcp=_effective_gcp(gcp),
            item_ref=item_ref,
            doc_base_url=base_url,
            scripts_dir=settings.scripts_dir,
            timeout=settings.script_timeout,
            doc_id=doc_id,
        )
    except SerialImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    document = build_document(
        result, doc_id=doc_id, max_epcs_per_event=settings.max_epcs_per_event
    )
    return result, document


# ------------------------------------------------------------ endpoints ------
@app.get("/api/epcis/health")
async def health():
    return {
        "status": "healthy",
        "service": "timberconnect-epcis",
        "version": "1.0.0",
        "gcp": settings.gcp,
        "epcat_base_url": settings.epcat_base_url,
        "epcat_enabled": settings.epcat_enabled,
    }


@app.post("/api/epcis/generate", response_model=GenerateResponse)
async def generate(
    file: UploadFile = File(...),
    data_type: str = Form(...),
    doc_base_url: Optional[str] = Form(None),
    doc_id: Optional[str] = Form(None),
    gcp: Optional[str] = Form(None, description="GS1 Company Prefix des Uploaders"),
):
    result, document = await _run_generate(
        file=file, data_type=data_type, doc_base_url=doc_base_url, doc_id=doc_id, gcp=gcp
    )
    return GenerateResponse(
        success=True, idents=_idents_from_result(result), epcis_document=document
    )


@app.post("/api/epcis/capture", response_model=CaptureResponse)
async def capture(request: CaptureRequest):
    try:
        res = await _epcat_client().capture(request.epcis_document)
    except EPCATError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return CaptureResponse(
        submitted=res.submitted,
        dry_run=res.dry_run,
        status_code=res.status_code,
        capture_job_url=res.capture_job_url,
        message=res.message,
    )


@app.post("/api/epcis/generate-and-capture", response_model=GenerateAndCaptureResponse)
async def generate_and_capture(
    file: UploadFile = File(...),
    data_type: str = Form(...),
    doc_base_url: Optional[str] = Form(None),
    doc_id: Optional[str] = Form(None),
    gcp: Optional[str] = Form(None, description="GS1 Company Prefix des Uploaders"),
):
    result, document = await _run_generate(
        file=file, data_type=data_type, doc_base_url=doc_base_url, doc_id=doc_id, gcp=gcp
    )
    # When EPCAT is enabled, a capture failure is fatal (502) — EPCIS is a
    # mandatory part of the flow. When EPCAT is disabled, capture() returns a
    # dry-run result instead of raising, so the request still succeeds.
    try:
        cap = await _epcat_client().capture(document)
    except EPCATError as exc:
        raise HTTPException(status_code=502, detail=f"EPCAT capture failed: {exc}") from exc

    return GenerateAndCaptureResponse(
        success=True,
        idents=_idents_from_result(result),
        epcis_document=document,
        capture=CaptureResponse(
            submitted=cap.submitted,
            dry_run=cap.dry_run,
            status_code=cap.status_code,
            capture_job_url=cap.capture_job_url,
            message=cap.message,
        ),
    )


@app.post("/api/epcis/events", response_model=EventQueryResponse)
async def query_events(
    request: EventQueryRequest,
    authorization: Optional[str] = Header(None),
):
    """Authorizing proxy: fetch EPCIS events from EPCAT and return only those the
    caller's role is consented to receive.

    Flow:
      1. Verify the caller's Solid-OIDC token -> WebID (unless auth disabled).
      2. Resolve the caller's role from their pod's profile/role.ttl.
      3. Query EPCAT for events (optionally pre-filtered by EPC).
      4. For each event, read the data owner's epcis-consent.ttl and keep the
         event only if EVERY EPC it exposes is consented for the caller's role.
    """
    caller_web_id: Optional[str] = None
    caller_role: Optional[str] = None

    if settings.auth_required:
        try:
            caller = await verify_solid_token(authorization, settings.solid_read_timeout)
        except SolidAuthError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        caller_web_id = caller.web_id
        caller_role = await get_role_for_webid(caller.web_id, settings.solid_read_timeout)
        if caller_role is None:
            raise HTTPException(
                status_code=403,
                detail="Caller has no declared role; cannot authorize event access.",
            )

    # Fetch candidate events from EPCAT.
    try:
        result = await _epcat_query_client().query_events(epc=request.epc, params=request.params)
    except EPCATQueryError as exc:
        raise HTTPException(status_code=502, detail=f"EPCAT query failed: {exc}") from exc

    total = len(result.events)

    # Open demo mode: no auth, no consent filter -> pass events through.
    if not settings.auth_required:
        return EventQueryResponse(
            events=result.events,
            total_before_filter=total,
            returned=total,
            filtered_out=0,
            auth_enforced=False,
        )

    # Consent filter. Cache consent docs per owner pod within this request.
    consent_cache: dict[str, ConsentDoc] = {}
    permitted: list[dict[str, Any]] = []

    for event in result.events:
        owner_pod = _owner_pod_for_event(event)
        if owner_pod is None:
            # No owner linkage -> cannot establish consent -> deny (fail closed).
            continue
        if owner_pod not in consent_cache:
            consent_cache[owner_pod] = await get_consent_for_owner(
                owner_pod, settings.solid_read_timeout
            )
        consent = consent_cache[owner_pod]

        epcs = epcs_of_event(event)
        # Keep only if the role may see every EPC the event exposes.
        if epcs and all(consent.role_may_see_epc(caller_role, epc) for epc in epcs):
            permitted.append(event)

    return EventQueryResponse(
        events=permitted,
        total_before_filter=total,
        returned=len(permitted),
        filtered_out=total - len(permitted),
        caller_web_id=caller_web_id,
        caller_role=caller_role,
        auth_enforced=True,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8003)
