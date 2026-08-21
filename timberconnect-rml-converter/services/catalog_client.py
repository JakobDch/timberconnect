"""
Catalog Client Service

HTTP client for registering datasets in the Semantic Data Catalog.
"""

import os
import logging
from datetime import datetime
from typing import Optional, Dict, Any
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


class CatalogClientError(Exception):
    """Exception raised when catalog registration fails."""
    pass


@dataclass
class CatalogRegistration:
    """Data for registering a dataset in the catalog."""
    trace_id: str
    data_type: str
    rdf_url: str
    semantic_model_content: bytes
    semantic_model_filename: str
    mapping_id: str
    catalog_id: int  # Required: ID of the catalog to register in
    webid: Optional[str] = None
    raw_url: Optional[str] = None
    publisher: Optional[str] = None  # Solid user name from authentication


class CatalogClient:
    """
    HTTP client for the Semantic Data Catalog API.

    Registers converted datasets automatically after successful upload.
    """

    # Metadata for different data types
    DATA_TYPE_INFO: Dict[str, Dict[str, str]] = {
        "forst": {
            "title": "Forstdaten",
            "description": "Harvester-Produktionsdaten im StanForD2010-Format",
            "theme": "Forstwirtschaft",
        },
        "saegewerk": {
            "title": "Saegewerksdaten",
            "description": "Holzbereitstellungsanzeige im ELDAT-Format",
            "theme": "Holzverarbeitung",
        },
        "bspwerk": {
            "title": "BSP-Plattendaten",
            "description": "BSP-Plattenproduktion im VLEX-Format",
            "theme": "Holzbau",
        },
        "herstellung": {
            "title": "Herstellungsdaten BSP",
            "description": "ERP-Auszug einer Brettsperrholz-Fertigung",
            "theme": "Holzbau",
        },
        # PDF-Templates: manuell uebernommene Dokumentdaten. Ohne eigenen
        # Eintrag griffe der Fallback ("Datensatz"/"Sonstiges") -- der Katalog
        # wuerde die Dokumente zwar fuehren, aber nicht mehr unterscheidbar
        # machen. Genau das Auffinden ist aber sein Zweck.
        "pdf_pruefzertifikat": {
            "title": "Pruefzertifikat Saatgut",
            "description": "Untersuchungsergebnisse einer Saatgutpartie (KJZ)",
            "theme": "Forstwirtschaft",
        },
        "pdf_stammzertifikat": {
            "title": "Stammzertifikat",
            "description": "Stammzertifikat fuer forstliches Vermehrungsgut",
            "theme": "Forstwirtschaft",
        },
        "pdf_transportauftrag_rundholz": {
            "title": "Transportauftrag Rundholz",
            "description": "Abtransport von Rundholz vom Polter zum Saegewerk",
            "theme": "Logistik",
        },
        "pdf_fertigungsauftrag_saege": {
            "title": "Fertigungsauftrag Saege",
            "description": "Auftrag fuer den Einschnitt im Saegewerk",
            "theme": "Holzverarbeitung",
        },
        "pdf_schnittbild": {
            "title": "Schnittbild",
            "description": "Einschnittbild eines Rundholzstammes",
            "theme": "Holzverarbeitung",
        },
        "pdf_biegepruefung": {
            "title": "Biegepruefung Schnittholz",
            "description": "Pruefprotokoll der Biegefestigkeit von Schnittholzproben",
            "theme": "Holzverarbeitung",
        },
        "pdf_leistungserklaerung": {
            "title": "Leistungserklaerung Schnittholz",
            "description": "Leistungserklaerung nach EN 14081 mit Saegevorgaengen",
            "theme": "Holzverarbeitung",
        },
        "pdf_transportauftrag": {
            "title": "Transportauftrag Schnittholz",
            "description": "Transportauftrag vom Saegewerk zum Verarbeiter",
            "theme": "Logistik",
        },
        "pdf_leistungserklaerung_bsp": {
            "title": "Leistungserklaerung Brettsperrholz",
            "description": "Leistungserklaerung nach EN 16351 fuer BSP-Elemente",
            "theme": "Holzbau",
        },
        "pdf_klebstoffdatenblatt": {
            "title": "Klebstoff-Datenblatt",
            "description": "Technisches Datenblatt eines Konstruktionsklebstoffs",
            "theme": "Holzbau",
        },
    }

    def __init__(
        self,
        api_url: Optional[str] = None,
        catalog_id: Optional[int] = None,
        default_publisher: Optional[str] = None,
        default_contact: Optional[str] = None,
        timeout: float = 30.0
    ):
        """
        Initialize the catalog client.

        Args:
            api_url: Base URL of the catalog API
            catalog_id: Default catalog ID for registrations
            default_publisher: Default publisher name
            default_contact: Default contact email
            timeout: HTTP request timeout in seconds
        """
        self.api_url = api_url or os.getenv(
            "CATALOG_API_URL",
            "http://semantic-data-catalog-backend:8000"
        )
        self.catalog_id = catalog_id or int(os.getenv("CATALOG_ID", "1"))
        self.default_publisher = default_publisher or os.getenv(
            "CATALOG_DEFAULT_PUBLISHER",
            "TimberConnect RML Converter"
        )
        self.default_contact = default_contact or os.getenv(
            "CATALOG_DEFAULT_CONTACT",
            "timberconnect@2050.de"
        )
        # Whether the DATA behind a catalog entry is world-readable. The catalog
        # entry itself stays discoverable either way; this flag only describes the
        # data's access policy. Now that uploads land in WAC-protected containers
        # (not public/), this defaults to false and the entry is marked as
        # access-controlled via dct:accessRights.
        self.data_public = os.getenv("CATALOG_DATA_PUBLIC", "false").lower() == "true"
        self.timeout = timeout

        logger.info(
            f"CatalogClient initialized: api_url={self.api_url}, "
            f"catalog_id={self.catalog_id}"
        )

    def _generate_metadata(self, registration: CatalogRegistration) -> Dict[str, Any]:
        """
        Generate catalog metadata from registration data.

        Args:
            registration: Registration data

        Returns:
            Dictionary of metadata fields for the API
        """
        info = self.DATA_TYPE_INFO.get(registration.data_type, {
            "title": "Datensatz",
            "description": "Automatisch konvertierte Daten",
            "theme": "Sonstiges",
        })

        now = datetime.utcnow()

        return {
            "title": f"{info['title']} - {registration.trace_id}",
            "description": (
                f"{info['description']} "
                f"(Trace-ID: {registration.trace_id}, "
                f"Konvertiert aus: {registration.mapping_id})"
            ),
            "identifier": f"{registration.trace_id}_{registration.data_type}",
            "issued": now.isoformat() + "Z",
            "modified": now.isoformat() + "Z",
            "publisher": registration.publisher or self.default_publisher,
            "contact_point": self.default_contact,
            # Catalog entry stays discoverable; is_public reflects the DATA's
            # access policy. Default false now that data sits behind WAC.
            "is_public": "true" if self.data_public else "false",
            "access_rights": "public" if self.data_public else "restricted",
            "access_url_dataset": registration.rdf_url,
            "file_format": "text/turtle",
            "theme": info["theme"],
            "catalog_id": str(registration.catalog_id),
            "webid": registration.webid or "https://timberconnect.2050.de/system",
        }

    async def register_dataset(
        self,
        registration: CatalogRegistration,
        authorization: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Register a converted dataset in the catalog.

        Args:
            registration: Registration data
            authorization: Optional authorization header value

        Returns:
            API response as dictionary

        Raises:
            CatalogClientError: If registration fails
        """
        metadata = self._generate_metadata(registration)

        url = f"{self.api_url}/api/datasets"

        logger.info(f"Registering dataset in catalog: {metadata['identifier']}")
        logger.debug(f"Catalog API URL: {url}")
        logger.debug(f"Metadata: {metadata}")

        # Die Katalog-API erwartet application/json (Schema
        # DatasetWriteRequest), NICHT multipart/form-data. Ein Multipart-Body
        # kommt dort als eine einzige Zeichenkette an und wird mit HTTP 422
        # abgewiesen ("Input should be a valid dictionary") -- der Upload gilt
        # dann trotzdem als erfolgreich, die Daten sind aber nirgends
        # registriert und damit fuer jede Abfrage unsichtbar.
        #
        # Pflichtfelder laut Schema: ownerWebId, title, access_url_dataset.
        # "catalog_id" und "access_rights" kennt die API nicht mehr; das
        # semantische Modell wird nicht mehr als Datei hochgeladen, sondern
        # per URL referenziert (access_url_semantic_model).
        if not registration.webid:
            raise CatalogClientError(
                "ownerWebId fehlt: Die Katalog-API verlangt die WebID des "
                "Pod-Eigentuemers. Ohne sie kann der Datensatz keinem Pod "
                "zugeordnet werden."
            )

        # "identifier" wird BEWUSST nicht gesetzt: die API verlangt dort eine
        # UUID und vergibt sie selbst ("identifier must be a UUID. Omit it to
        # generate one."). Unser sprechender Schluessel <hash>_<data_type>
        # steckt statt dessen im Titel und in der access_url.
        payload = {
            "ownerWebId": registration.webid,
            "title": metadata["title"],
            "description": metadata["description"],
            "issued": metadata["issued"],
            "modified": metadata["modified"],
            "publisher": metadata["publisher"],
            "contact_point": metadata["contact_point"],
            # metadata["is_public"] ist ein STRING ("true"/"false", Altlast des
            # frueheren Multipart-Wegs). bool("false") waere True -- damit
            # waeren alle Datensaetze faelschlich oeffentlich.
            "is_public": str(metadata["is_public"]).lower() == "true",
            "access_url_dataset": metadata["access_url_dataset"],
            "file_format": metadata["file_format"],
            "theme": metadata["theme"],
            # Bestehenden Eintrag ersetzen statt zu duplizieren: dieselbe
            # Datei zweimal hochzuladen soll einen Eintrag ergeben, nicht zwei.
            "overwrite": True,
        }
        if registration.raw_url:
            payload["access_url_semantic_model"] = registration.raw_url

        try:
            headers = {}
            if authorization:
                headers["Authorization"] = authorization

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers=headers
                )

                if response.status_code in (200, 201):
                    result = response.json()
                    logger.info(
                        f"Successfully registered dataset: "
                        f"{result.get('identifier', metadata['identifier'])}"
                    )
                    return result
                else:
                    error_detail = response.text[:500]
                    logger.error(
                        f"Catalog registration failed: "
                        f"{response.status_code} - {error_detail}"
                    )
                    raise CatalogClientError(
                        f"Registration failed with status {response.status_code}: "
                        f"{error_detail}"
                    )

        except httpx.TimeoutException:
            error_msg = f"Catalog registration timed out after {self.timeout}s"
            logger.error(error_msg)
            raise CatalogClientError(error_msg)

        except httpx.RequestError as e:
            error_msg = f"Network error during catalog registration: {str(e)}"
            logger.error(error_msg)
            raise CatalogClientError(error_msg)

        except Exception as e:
            if isinstance(e, CatalogClientError):
                raise
            error_msg = f"Unexpected error during catalog registration: {str(e)}"
            logger.error(error_msg)
            raise CatalogClientError(error_msg) from e

    async def check_health(self) -> bool:
        """
        Check if the catalog API is reachable.

        Returns:
            True if API is healthy, False otherwise
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.api_url}/api/catalogs")
                return response.status_code == 200
        except Exception as e:
            logger.warning(f"Catalog health check failed: {e}")
            return False

    def is_enabled(self) -> bool:
        """
        Check if catalog registration is enabled.

        Returns:
            True if enabled, False otherwise
        """
        enabled = os.getenv("CATALOG_REGISTRATION_ENABLED", "true").lower()
        return enabled in ("true", "1", "yes")
