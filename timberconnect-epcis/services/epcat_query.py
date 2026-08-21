"""
Query client for the EECC EPCAT repository (GS1 EPCIS 2.0 REST query interface).

GS1 EPCIS 2.0 REST bindings:
  GET  {base}/events                 -> list events (supports EPCIS query params)
  POST {base}/queries / {base}/events with a query body for richer filtering.

This client only reads. It is used by the authorizing proxy in main.py, which
gates the returned events by the caller's role and the data owner's consent.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)


class EPCATQueryError(Exception):
    pass


@dataclass
class QueryResult:
    events: list[dict[str, Any]]
    raw: dict[str, Any]


class EPCATQueryClient:
    def __init__(
        self,
        base_url: str,
        auth: str = "",
        timeout: float = 30.0,
        enabled: bool = True,
        page_size: int = 100,
    ):
        self.base_url = base_url.rstrip("/")
        self.auth = auth
        self.timeout = timeout
        self.enabled = enabled
        # OpenEPCIS requires a perPage parameter on event searches; without it the
        # repository returns 500 ("invalid id: [null]"). Always send one.
        self.page_size = page_size

    def _headers(self) -> dict[str, str]:
        # Offer both: EECC's epcat2-mongo cannot produce ld+json (406 if it is
        # the only offer), OpenEPCIS prefers it — let the server pick.
        headers = {
            "Accept": "application/json, application/ld+json",
            "GS1-EPCIS-Version": "2.0",
        }
        if self.auth:
            headers["Authorization"] = self.auth
        return headers

    async def query_events(
        self,
        *,
        epc: Optional[str] = None,
        params: Optional[dict[str, str]] = None,
    ) -> QueryResult:
        """Fetch events from EPCAT, optionally filtered by an EPC match.

        Uses GET {base}/events with EPCIS query parameters. Instance-level EPCs
        (e.g. SGTIN, urn:epc:id:...) live in epcList and match via MATCH_anyEPC;
        class-level EPCs (e.g. LGTIN, urn:epc:class:...) live in quantityList and
        only match via MATCH_anyEPCClass — MATCH_anyEPC returns nothing for them.
        """
        if not self.enabled:
            logger.info("EPCAT query disabled (dry run): returning no events")
            return QueryResult(events=[], raw={})

        query: dict[str, str] = dict(params or {})
        if epc:
            if epc.startswith("urn:epc:class:"):
                query["MATCH_anyEPCClass"] = epc
            else:
                query["MATCH_anyEPC"] = epc
        # Mandatory for OpenEPCIS event searches (else HTTP 500). Caller-supplied
        # perPage in `params` wins.
        query.setdefault("perPage", str(self.page_size))

        url = f"{self.base_url}/events"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(url, params=query, headers=self._headers())
        except httpx.TimeoutException as exc:
            raise EPCATQueryError(f"Query timed out after {self.timeout}s") from exc
        except httpx.RequestError as exc:
            raise EPCATQueryError(f"Network error during query: {exc}") from exc

        if resp.status_code != 200:
            raise EPCATQueryError(
                f"Query failed with status {resp.status_code}: {resp.text[:500]}"
            )

        try:
            body = resp.json()
        except ValueError as exc:
            raise EPCATQueryError(f"Query returned non-JSON body: {resp.text[:200]}") from exc

        events = _extract_event_list(body)
        return QueryResult(events=events, raw=body)


def _extract_event_list(body: dict[str, Any]) -> list[dict[str, Any]]:
    """Pull the eventList out of an EPCIS QueryResults / Document envelope."""
    if not isinstance(body, dict):
        return []
    # EPCISQueryDocument: { epcisBody: { queryResults: { resultsBody: { eventList } } } }
    epcis_body = body.get("epcisBody", {})
    if isinstance(epcis_body, dict):
        qr = epcis_body.get("queryResults", {})
        results_body = qr.get("resultsBody", {}) if isinstance(qr, dict) else {}
        events = results_body.get("eventList")
        if isinstance(events, list):
            return events
        # Plain EPCISDocument: { epcisBody: { eventList } }
        events = epcis_body.get("eventList")
        if isinstance(events, list):
            return events
    # Some deployments return a bare list
    if isinstance(body.get("eventList"), list):
        return body["eventList"]
    return []


def epcs_of_event(event: dict[str, Any]) -> list[str]:
    """All EPCs referenced by an event: epcList + quantityList epcClass + childEPCs."""
    epcs: list[str] = []
    for key in ("epcList", "childEPCs", "inputEPCList", "outputEPCList"):
        val = event.get(key)
        if isinstance(val, list):
            epcs.extend(str(e) for e in val)
    for qkey in ("quantityList", "inputQuantityList", "outputQuantityList"):
        ql = event.get(qkey)
        if isinstance(ql, list):
            for q in ql:
                if isinstance(q, dict) and q.get("epcClass"):
                    epcs.append(str(q["epcClass"]))
    return epcs
