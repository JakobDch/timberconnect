"""
Client for the EECC EPCAT repository (GS1 EPCIS 2.0 REST capture interface).

GS1 EPCIS 2.0 REST bindings (https://github.com/gs1/EPCIS, REST Bindings/openapi.yaml):
  POST {base}/capture            -> submit an EPCIS document. Returns 202 with a
                                    Location header pointing at the async job.
  GET  {base}/capture/{id}        -> poll capture job status.

Headers: Content-Type: application/ld+json, GS1-EPCIS-Version: 2.0,
         optionally GS1-Capture-Error-Behaviour: rollback.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

# Shutter shared by all captures of one process: serialises captures and keeps a
# minimum spacing between them, so we never burst the repository's pipeline.
_capture_lock = asyncio.Lock()
_last_capture_at = 0.0


class EPCATError(Exception):
    pass


@dataclass
class CaptureResult:
    submitted: bool
    status_code: Optional[int] = None
    capture_job_url: Optional[str] = None
    message: Optional[str] = None
    dry_run: bool = False
    attempts: int = 1


class EPCATClient:
    def __init__(
        self,
        base_url: str,
        auth: str = "",
        timeout: float = 30.0,
        enabled: bool = True,
        max_attempts: int = 3,
        retry_backoff: float = 1.5,
        poll_interval: float = 1.5,
        poll_timeout: float = 20.0,
        min_spacing: float = 0.5,
    ):
        self.base_url = base_url.rstrip("/")
        self.auth = auth
        self.timeout = timeout
        self.enabled = enabled
        self.max_attempts = max(1, max_attempts)
        self.retry_backoff = retry_backoff
        self.poll_interval = poll_interval
        self.poll_timeout = poll_timeout
        self.min_spacing = min_spacing

    def _headers(self) -> dict[str, str]:
        # NOTE: do NOT send GS1-CBV-Version or an Accept header — OpenEPCIS
        # rejects the capture with 406 Not Acceptable ("detail":"GS1-CBV-Version")
        # when GS1-CBV-Version is present. GS1-EPCIS-Version + the ld+json
        # Content-Type are sufficient and standards-conformant.
        headers = {
            "Content-Type": "application/ld+json",
            "GS1-EPCIS-Version": "2.0",
            "GS1-Capture-Error-Behaviour": "rollback",
        }
        if self.auth:
            headers["Authorization"] = self.auth
        return headers

    async def capture(self, document: dict[str, Any]) -> CaptureResult:
        """Submit an EPCIS document and confirm it actually persisted.

        The capture is asynchronous: a 202 only means "accepted for processing".
        OpenEPCIS has a sporadic race in its capture pipeline that fails an
        otherwise-valid event. We therefore poll the async job status and, on a
        failed job, retry with a fresh eventID (up to max_attempts). Consecutive
        captures are also spaced apart to avoid bursting the pipeline.
        """
        if not self.enabled:
            logger.info(
                "EPCAT disabled (dry run): would POST %d-byte document to %s/capture",
                len(json.dumps(document)),
                self.base_url,
            )
            return CaptureResult(submitted=False, dry_run=True, message="EPCAT disabled (dry run)")

        last_error = ""
        for attempt in range(1, self.max_attempts + 1):
            # Each attempt uses a fresh document copy with new eventIDs so a retry
            # never risks duplicating a partially-processed event.
            doc = self._with_fresh_event_ids(document)

            await self._respect_spacing()
            job_url, status_code = await self._post_capture(doc)

            outcome, detail = await self._await_job_outcome(job_url)

            if outcome == "ok":
                if attempt > 1:
                    logger.info("EPCAT capture succeeded on attempt %d", attempt)
                return CaptureResult(
                    submitted=True, status_code=status_code,
                    capture_job_url=job_url, message="accepted", attempts=attempt,
                )

            if outcome == "timeout":
                # The job was accepted and is still processing (typically slow
                # persistence under host I/O load). Retrying would only add load
                # and risk duplicates, so accept it as pending rather than fail.
                logger.warning(
                    "EPCAT capture still processing after %.0fs; accepted as pending (job=%s)",
                    self.poll_timeout, job_url,
                )
                return CaptureResult(
                    submitted=True, status_code=status_code,
                    capture_job_url=job_url, message="accepted (still processing)",
                    attempts=attempt,
                )

            # outcome == "failed": a genuine pipeline rejection — retry.
            last_error = detail
            logger.warning(
                "EPCAT capture job failed (attempt %d/%d): %s",
                attempt, self.max_attempts, detail,
            )
            # Ein Formatfehler ist deterministisch: derselbe ungueltige BizStep
            # scheitert beim dritten Versuch genauso wie beim ersten. Nur die
            # sporadische Pipeline-Race, wegen der es die Wiederholung gibt,
            # rechtfertigt einen zweiten Anlauf.
            if "EpcisFormatException" in detail or "not an allowed" in detail:
                raise EPCATError(f"Capture rejected (invalid document): {detail}")
            if attempt < self.max_attempts:
                await asyncio.sleep(self.retry_backoff)

        raise EPCATError(
            f"Capture failed after {self.max_attempts} attempts: {last_error}"
        )

    async def _post_capture(self, document: dict[str, Any]) -> tuple[str, int]:
        """POST the document, return (job_url, status_code). Raises on transport/HTTP error."""
        url = f"{self.base_url}/capture"
        # Send via `content=` so httpx does NOT override our Content-Type with
        # application/json (OpenEPCIS requires application/ld+json -> else 406).
        payload = json.dumps(document).encode("utf-8")
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(url, content=payload, headers=self._headers())
        except httpx.TimeoutException as exc:
            raise EPCATError(f"Capture timed out after {self.timeout}s") from exc
        except httpx.RequestError as exc:
            raise EPCATError(f"Network error during capture: {exc}") from exc

        if resp.status_code not in (200, 201, 202):
            raise EPCATError(
                f"Capture failed with status {resp.status_code}: {resp.text[:500]}"
            )

        job_url = resp.headers.get("Location")
        if not job_url:
            # Das EECC-EPCAT setzt KEINEN Location-Header, sondern liefert die
            # captureID im Rumpf. Ohne diesen Zweig blieb job_url None, und
            # _await_job_outcome wertete das als "synchron erfolgreich" —
            # jede asynchrone Ablehnung ging damit lautlos verloren. Genau so
            # verschwand am 02.09.2026 ein TransformationEvent mit ungueltigem
            # BizStep: 202 im Log, nichts im Repository.
            try:
                capture_id = (resp.json() or {}).get("captureID")
            except ValueError:
                capture_id = None
            if capture_id:
                job_url = f"{self.base_url}/capture/{capture_id}"
        if job_url and job_url.startswith("/"):
            job_url = f"{self.base_url}{job_url}"
        logger.info("EPCAT capture accepted (%s), job=%s", resp.status_code, job_url)
        return job_url, resp.status_code

    async def _await_job_outcome(self, job_url: Optional[str]) -> tuple[str, str]:
        """Poll the async capture job. Returns (outcome, detail).

        outcome is "ok" (persisted), "failed" (pipeline rejected it), or
        "timeout" (still running when the poll budget ran out).

        If there is no job URL (a repo that captures synchronously), assume the
        2xx already meant success.
        """
        if not job_url:
            return "ok", ""

        waited = 0.0
        while waited < self.poll_timeout:
            await asyncio.sleep(self.poll_interval)
            waited += self.poll_interval
            try:
                status = await self.capture_status(job_url)
            except EPCATError as exc:
                # A missing job often means it completed and was cleaned up; treat
                # transient lookup errors as "keep waiting" until timeout.
                logger.debug("capture status poll error: %s", exc)
                continue

            if status.get("running"):
                continue
            if status.get("success"):
                return "ok", ""
            # Das EECC-EPCAT liefert `errors` als Liste von Strings
            # ("EpcisFormatException: ..."), die GS1-Referenz als Liste von
            # Objekten mit `title`. Beides auswerten, sonst steht im Log nur
            # "unknown capture error" und der eigentliche Grund geht verloren.
            errors = status.get("errors") or []
            detail = "unknown capture error"
            if errors:
                first = errors[0]
                if isinstance(first, str):
                    detail = first
                elif isinstance(first, dict):
                    detail = first.get("title") or first.get("detail") or detail
            return "failed", detail

        # Still running when the poll budget ran out — accepted but not confirmed.
        return "timeout", f"capture job still running after {self.poll_timeout}s"

    @staticmethod
    def _with_fresh_event_ids(document: dict[str, Any]) -> dict[str, Any]:
        """Deep-copy the document and assign a fresh eventID to every event."""
        doc = copy.deepcopy(document)
        events = doc.get("epcisBody", {}).get("eventList", [])
        for ev in events:
            ev["eventID"] = f"urn:uuid:{uuid.uuid4()}"
        return doc

    async def _respect_spacing(self) -> None:
        """Serialise captures and keep a minimum gap between them."""
        global _last_capture_at
        if self.min_spacing <= 0:
            return
        async with _capture_lock:
            loop = asyncio.get_event_loop()
            now = loop.time()
            gap = now - _last_capture_at
            if gap < self.min_spacing:
                await asyncio.sleep(self.min_spacing - gap)
            _last_capture_at = loop.time()

    async def capture_status(self, job_url: str) -> dict[str, Any]:
        """GET an async capture job status by its URL."""
        if not job_url.startswith("http"):
            job_url = f"{self.base_url}{job_url}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(job_url, headers=self._headers())
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPError as exc:
            raise EPCATError(f"Failed to fetch capture status: {exc}") from exc
