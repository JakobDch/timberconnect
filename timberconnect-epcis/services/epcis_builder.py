"""
Build a valid EPCIS 2.0 JSON-LD document from extracted identifiers.

This mirrors the structure that timber-event aims to emit but produces
standards-conformant JSON that the EPCAT /capture endpoint accepts (the
script's own output is not valid JSON -- the comma after "@context" is
missing).

Two event shapes are produced, matching the format driver that ran:

  ObjectEvent          hpr / eldat / seed -- material enters the chain.
                       action ADD, bizStep commissioning, epcList or
                       quantityList.
  TransformationEvent  sawdecl / module -- material is consumed and new
                       material is produced. inputEpcList/inputQuantityList +
                       outputEpcList/outputQuantityList, no action.

Both carry a bizTransactionList pointing back to the source document.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from .serial_import import QuantityIdent, SerialImportResult

EPCIS_CONTEXT = "https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld"
# CBV bizStep IRI for commissioning.
BIZSTEP_COMMISSIONING = "https://ref.gs1.org/cbv/BizStep-commissioning"


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="milliseconds")


def _tz_offset() -> str:
    off = datetime.now(timezone.utc).astimezone().strftime("%z")  # e.g. +0200
    return f"{off[:3]}:{off[3:]}" if off else "+00:00"


def _chunk(items: list[Any], size: int) -> list[list[Any]]:
    """Split a list into chunks of at most `size` (size<=0 -> single chunk)."""
    if size <= 0 or len(items) <= size:
        return [items] if items else []
    return [items[i : i + size] for i in range(0, len(items), size)]


def _base_event(event_time: str, biz_transaction_url: Optional[str]) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": "ObjectEvent",
        "eventTime": event_time,
        "eventTimeZoneOffset": _tz_offset(),
        "eventID": f"urn:uuid:{uuid.uuid4()}",
        "action": "ADD",
        "bizStep": BIZSTEP_COMMISSIONING,
    }
    if biz_transaction_url:
        event["bizTransactionList"] = [{"bizTransaction": biz_transaction_url}]
    return event


def _quantity_elements(quantities: list[QuantityIdent]) -> list[dict[str, Any]]:
    return [
        {
            k: v
            for k, v in (
                ("epcClass", q.epc_class),
                ("quantity", q.quantity),
                ("uom", q.uom),
            )
            if v is not None
        }
        for q in quantities
    ]


def build_transformation_event(
    result: SerialImportResult,
    event_time: Optional[str] = None,
) -> dict[str, Any]:
    """Build a single TransformationEvent (sawdecl / module).

    Deliberately NOT split across several events the way ObjectEvents are: the
    input->output relation is what makes the product traceable to its raw
    material, and splitting would sever exactly that link. A BSP panel or a
    sawing declaration lists a bounded number of parts, so the size limit that
    motivates chunking does not bite here.
    """
    event: dict[str, Any] = {
        "type": "TransformationEvent",
        "eventTime": event_time or _now_iso(),
        "eventTimeZoneOffset": _tz_offset(),
        "eventID": f"urn:uuid:{uuid.uuid4()}",
    }
    # No "action" -- the standard does not allow it on a TransformationEvent.
    if result.input_epcs:
        event["inputEPCList"] = list(result.input_epcs)
    if result.input_quantities:
        event["inputQuantityList"] = _quantity_elements(result.input_quantities)
    if result.sgtins:
        event["outputEPCList"] = list(result.sgtins)
    if result.quantities:
        event["outputQuantityList"] = _quantity_elements(result.quantities)
    if result.biz_transaction_url:
        event["bizTransactionList"] = [{"bizTransaction": result.biz_transaction_url}]
    return event


def build_object_events(
    result: SerialImportResult,
    event_time: Optional[str] = None,
    max_epcs_per_event: int = 0,
) -> list[dict[str, Any]]:
    """Build one or more ObjectEvents from the extracted identifiers.

    Large epcList / quantityList sets are split across several events (each with
    its own eventID but the same eventTime / bizStep / bizTransaction) so no
    single event exceeds `max_epcs_per_event` — OpenEPCIS' capture pipeline
    rejects very large single events. A value <=0 disables splitting.
    """
    event_time = event_time or _now_iso()
    events: list[dict[str, Any]] = []

    if result.sgtins:
        for chunk in _chunk(list(result.sgtins), max_epcs_per_event):
            ev = _base_event(event_time, result.biz_transaction_url)
            ev["epcList"] = chunk
            events.append(ev)

    if result.quantities:
        quantities = _quantity_elements(result.quantities)
        for chunk in _chunk(quantities, max_epcs_per_event):
            ev = _base_event(event_time, result.biz_transaction_url)
            ev["quantityList"] = chunk
            events.append(ev)

    # No identifiers at all -> still emit a single (empty) event for traceability.
    if not events:
        events.append(_base_event(event_time, result.biz_transaction_url))

    return events


def build_events(
    result: SerialImportResult,
    event_time: Optional[str] = None,
    max_epcs_per_event: int = 0,
) -> list[dict[str, Any]]:
    """Build the event list appropriate for the format that produced `result`."""
    if result.is_transformation:
        return [build_transformation_event(result, event_time=event_time)]
    return build_object_events(
        result, event_time=event_time, max_epcs_per_event=max_epcs_per_event
    )


def build_document(
    result: SerialImportResult,
    doc_id: Optional[str] = None,
    event_time: Optional[str] = None,
    max_epcs_per_event: int = 0,
) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "@context": [EPCIS_CONTEXT],
        "type": "EPCISDocument",
        "schemaVersion": "2.0",
        "creationDate": _now_iso(),
        "epcisBody": {
            "eventList": build_events(
                result, event_time=event_time, max_epcs_per_event=max_epcs_per_event
            ),
        },
    }
    if doc_id:
        doc["id"] = doc_id
    return doc
