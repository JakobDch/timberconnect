"""
EPCIS Client

HTTP client for the timberconnect-epcis service. Sends raw uploaded files to
the EPCIS service which derives GS1 identifiers (SGTIN/LGTIN) via the EECC
timber-event script, builds an EPCIS 2.0 event, and (optionally) captures it
in the EECC EPCAT repository.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

# Base URL of the timberconnect-epcis service (service name in docker-compose).
EPCIS_SERVICE_URL = os.getenv("EPCIS_SERVICE_URL", "http://timberconnect-epcis:8003")
# Master switch: when off, the converter skips EPCIS entirely.
EPCIS_ENABLED = os.getenv("EPCIS_ENABLED", "true").lower() == "true"
EPCIS_TIMEOUT = float(os.getenv("EPCIS_TIMEOUT", "90"))

# data_type values the EPCIS service can map onto a timber-event format driver.
# Mirrors FORMAT_FOR_TYPE in timberconnect-epcis/services/serial_import.py.
SUPPORTED_DATA_TYPES = {
    "forst",             # -> hpr
    "saegewerk",         # -> eldat
    "bspwerk",           # -> module
    "herstellung",       # -> module   (ERP-Auszug BSP)
    "stammzertifikat",   # -> seed
    "leistungserklaerung",  # -> sawdecl
}


class EPCISClientError(Exception):
    pass


@dataclass
class EPCISResult:
    data_type: str
    gcp: str = ""
    item_ref: str = ""
    biz_transaction_url: Optional[str] = None
    doc_hash: Optional[str] = None
    sgtins: list[str] = field(default_factory=list)
    quantities: list[dict[str, Any]] = field(default_factory=list)
    epcis_document: dict[str, Any] = field(default_factory=dict)
    captured: bool = False
    capture_message: Optional[str] = None
    # Format driver that ran, and the raw-material side of a TransformationEvent
    # (leistungserklaerung / herstellung). Empty for the ObjectEvent formats.
    format: str = ""
    is_transformation: bool = False
    input_epcs: list[str] = field(default_factory=list)
    input_quantities: list[dict[str, Any]] = field(default_factory=list)

    @property
    def output_epcs(self) -> list[str]:
        """The EPCs this document brings into existence (or observes)."""
        return list(self.sgtins) + [
            q.get("epcClass") for q in self.quantities if q.get("epcClass")
        ]

    @property
    def consumed_epcs(self) -> list[str]:
        """The EPCs this document consumes as raw material (transformation only)."""
        return list(self.input_epcs) + [
            q.get("epcClass") for q in self.input_quantities if q.get("epcClass")
        ]

    @property
    def all_epcs(self) -> list[str]:
        return self.output_epcs + self.consumed_epcs


class EPCISClient:
    def __init__(
        self,
        service_url: str = EPCIS_SERVICE_URL,
        enabled: bool = EPCIS_ENABLED,
        timeout: float = EPCIS_TIMEOUT,
    ):
        self.service_url = service_url.rstrip("/")
        self.enabled = enabled
        self.timeout = timeout

    async def generate_and_capture(
        self,
        *,
        content: bytes,
        filename: str,
        data_type: str,
        doc_base_url: Optional[str] = None,
        doc_id: Optional[str] = None,
        gcp: Optional[str] = None,
    ) -> Optional[EPCISResult]:
        """Send a raw file to the EPCIS service and return its identifiers.

        EPCIS identifier generation is a MANDATORY part of the conversion. This
        method raises EPCISClientError on any failure (service unreachable, error
        response, or no identifiers produced) so the caller aborts conversion.

        The single exception is the explicit ``EPCIS_ENABLED=false`` operator
        switch, which returns None to disable the whole step on purpose.
        """
        if not self.enabled:
            logger.info("EPCIS disabled via EPCIS_ENABLED=false; skipping")
            return None
        if data_type not in SUPPORTED_DATA_TYPES:
            raise EPCISClientError(
                f"EPCIS-Identgenerierung für Datentyp '{data_type}' nicht unterstützt"
            )

        url = f"{self.service_url}/api/epcis/generate-and-capture"
        data = {"data_type": data_type}
        if doc_base_url:
            data["doc_base_url"] = doc_base_url
        if doc_id:
            data["doc_id"] = doc_id
        if gcp:
            # Company Prefix des Uploaders — die erzeugten SGTINs/LGTINs tragen
            # dessen GCP statt des globalen Service-Defaults.
            data["gcp"] = gcp
        file_field = {"file": (filename, content)}

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(url, data=data, files=file_field)
        except httpx.RequestError as exc:
            raise EPCISClientError(f"EPCIS-Service nicht erreichbar ({url}): {exc}") from exc

        if resp.status_code != 200:
            raise EPCISClientError(
                f"EPCIS-Service antwortete mit Status {resp.status_code}: {resp.text[:300]}"
            )

        payload = resp.json()
        idents = payload.get("idents", {})
        capture = payload.get("capture", {})
        result = EPCISResult(
            data_type=idents.get("data_type", data_type),
            gcp=idents.get("gcp", ""),
            item_ref=idents.get("item_ref", ""),
            biz_transaction_url=idents.get("biz_transaction_url"),
            doc_hash=idents.get("doc_hash"),
            sgtins=idents.get("sgtins", []),
            quantities=idents.get("quantities", []),
            epcis_document=payload.get("epcis_document", {}),
            captured=bool(capture.get("submitted")),
            capture_message=capture.get("message"),
            format=idents.get("format", ""),
            is_transformation=bool(idents.get("is_transformation")),
            input_epcs=idents.get("input_epcs", []),
            input_quantities=idents.get("input_quantities", []),
        )
        if not result.all_epcs:
            raise EPCISClientError(
                "EPCIS-Service hat keine Idente erzeugt"
            )
        return result
