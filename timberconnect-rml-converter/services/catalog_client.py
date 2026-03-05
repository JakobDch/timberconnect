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
            "is_public": "true",
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

        try:
            # Prepare multipart form data
            files = {
                "semantic_model_file": (
                    registration.semantic_model_filename,
                    registration.semantic_model_content,
                    "text/turtle"
                )
            }

            # Form data (all string values for multipart form)
            data = {
                "title": metadata["title"],
                "description": metadata["description"],
                "identifier": metadata["identifier"],
                "issued": metadata["issued"],
                "modified": metadata["modified"],
                "publisher": metadata["publisher"],
                "contact_point": metadata["contact_point"],
                "is_public": metadata["is_public"],
                "access_url_dataset": metadata["access_url_dataset"],
                "file_format": metadata["file_format"],
                "theme": metadata["theme"],
                "catalog_id": metadata["catalog_id"],
                "webid": metadata["webid"],
            }

            headers = {}
            if authorization:
                headers["Authorization"] = authorization

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    url,
                    data=data,
                    files=files,
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
