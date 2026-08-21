"""
Configuration for the TimberConnect EPCIS service.

All settings are read from environment variables (prefix TC_EPCIS_) with
sensible defaults so the service runs out of the box for local development.
"""

import os
from dataclasses import dataclass, field


def _env(name: str, default: str) -> str:
    return os.getenv(name, default)


@dataclass
class Settings:
    # --- timber-event (EECC) ---
    # Directory holding timber-event plus the format driver subdirectories
    # (hpr/, eldat/, seed/, sawdecl/, module/), each with a .shar archive.
    scripts_dir: str = _env("TC_EPCIS_SCRIPTS_DIR", "/app/scripts")
    script_timeout: float = float(_env("TC_EPCIS_SCRIPT_TIMEOUT", "60"))

    # --- GS1 identifiers (see epcis-serial-import-script memory) ---
    # GS1 Company Prefix. Single prefix for all TimberConnect wood by default;
    # the example values supplied by EECC are used as documented defaults.
    gcp: str = _env("TC_EPCIS_GCP", "4047111124")
    # Item reference per data type. Only consulted for the formats that build
    # identifiers themselves (hpr without embedded Identity, eldat). The JSON
    # formats (seed/sawdecl/module) carry ready-made EPCs in the document, so
    # their item reference is never used -- kept for a uniform call signature.
    item_ref_forst: str = _env("TC_EPCIS_ITEMREF_FORST", "015")
    item_ref_saegewerk: str = _env("TC_EPCIS_ITEMREF_SAEGEWERK", "091")
    item_ref_bspwerk: str = _env("TC_EPCIS_ITEMREF_BSPWERK", "100")
    # Stammzertifikat (Saatgut-Los) and Schnittholz-Lamellen.
    item_ref_stammzertifikat: str = _env("TC_EPCIS_ITEMREF_STAMMZERTIFIKAT", "001")
    item_ref_leistungserklaerung: str = _env("TC_EPCIS_ITEMREF_LEISTUNGSERKLAERUNG", "021")
    item_ref_herstellung: str = _env("TC_EPCIS_ITEMREF_HERSTELLUNG", "100")

    # Base URL for the document reference (-u / --url). This is the bridge that
    # maps EPCIS namespaces onto the SOLID namespaces and lands in the event's
    # bizTransactionList. When the caller does not supply one we fall back to
    # the Solid Pod public uploads container.
    default_doc_base_url: str = _env(
        "TC_EPCIS_DOC_BASE_URL",
        "https://solid-community-server.tmdt.info/epcisrepository/public/uploads",
    )

    # --- EPCAT repository (EECC, live) ---
    # Capture endpoint base. This is the live EECC-hosted repository; it needs
    # TC_EPCIS_EPCAT_AUTH ("Bearer <token>") to be set. There is no local or
    # test repository any more -- everything captured here is real.
    epcat_base_url: str = _env(
        "TC_EPCIS_EPCAT_BASE_URL", "https://epcat2-timber.prod-k8s.eecc.de/api"
    )
    # Authorization header value, e.g. "Bearer xyz" or "Basic ...". Empty = none.
    epcat_auth: str = _env("TC_EPCIS_EPCAT_AUTH", "")
    epcat_timeout: float = float(_env("TC_EPCIS_EPCAT_TIMEOUT", "30"))
    # When false, /capture is a dry run (event is built + logged, never sent).
    # Kept in sync with docker-compose.yml / .env.example, which also default
    # to true; capture writes to the live repo, so use the dry run deliberately.
    epcat_enabled: bool = _env("TC_EPCIS_EPCAT_ENABLED", "true").lower() == "true"

    # --- Capture robustness (OpenEPCIS has a sporadic capture race condition) ---
    # The capture is async: we poll the job status and retry on a failed job.
    # Number of capture attempts before giving up (1 = no retry).
    epcat_max_attempts: int = int(_env("TC_EPCIS_EPCAT_MAX_ATTEMPTS", "3"))
    # Seconds to wait before re-sending after a failed capture job.
    epcat_retry_backoff: float = float(_env("TC_EPCIS_EPCAT_RETRY_BACKOFF", "1.5"))
    # Seconds to wait between polls of the async capture job status.
    epcat_poll_interval: float = float(_env("TC_EPCIS_EPCAT_POLL_INTERVAL", "2"))
    # Max seconds to wait for a capture job to finish before treating as failed.
    # Generous by default: under host I/O load (e.g. heavy DB queries sharing the
    # disk) OpenEPCIS jobs can take much longer than the usual 1-3s to persist.
    epcat_poll_timeout: float = float(_env("TC_EPCIS_EPCAT_POLL_TIMEOUT", "90"))
    # Minimum spacing (s) between consecutive captures, to avoid bursting the
    # repository's capture pipeline. Applied service-wide.
    epcat_min_spacing: float = float(_env("TC_EPCIS_EPCAT_MIN_SPACING", "0.5"))

    # --- Authorizing query proxy (role + consent gated event reads) ---
    # When true, the /events endpoint requires a verified Solid-OIDC token and
    # filters events by the caller's role and the data owner's consent. When
    # false, the proxy runs in open demo mode (no auth, no consent filter).
    auth_required: bool = _env("TC_EPCIS_AUTH_REQUIRED", "true").lower() == "true"
    # Timeout (s) for Solid pod reads (role.ttl / epcis-consent.ttl / JWKS).
    solid_read_timeout: float = float(_env("TC_EPCIS_SOLID_READ_TIMEOUT", "10"))
    # Page size for EPCAT event searches. Mandatory perPage param (OpenEPCIS 500s
    # without it; and rejects >100 with QueryTooLargeException). 100 = the max.
    epcat_query_page_size: int = int(_env("TC_EPCIS_QUERY_PAGE_SIZE", "100"))

    # Max EPCs (epcList / quantityList entries) per ObjectEvent. OpenEPCIS'
    # Kafka capture pipeline (CaptureContextTopology) rejects very large single
    # events with "Expected JSON ObjectNode but got MISSING"; the observed
    # threshold sits between 50 and 100. We split large identifier sets across
    # several ObjectEvents (same eventTime/bizStep/bizTransaction, fresh eventID)
    # to stay safely below it. 0 disables splitting.
    max_epcs_per_event: int = int(_env("TC_EPCIS_MAX_EPCS_PER_EVENT", "50"))

    # Map our data_type -> (item_ref, biz_step). biz_step kept aligned with the
    # timber-event param__* functions ("commissioning").
    def item_ref_for(self, data_type: str) -> str:
        return {
            "forst": self.item_ref_forst,
            "saegewerk": self.item_ref_saegewerk,
            "bspwerk": self.item_ref_bspwerk,
            "stammzertifikat": self.item_ref_stammzertifikat,
            "leistungserklaerung": self.item_ref_leistungserklaerung,
            "herstellung": self.item_ref_herstellung,
        }.get(data_type, self.item_ref_forst)


settings = Settings()
