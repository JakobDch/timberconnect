"""
Solid Pod Client

HTTP client for uploading files to a Solid Pod.
"""

import os
import httpx
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Authentication token from environment
SOLID_ACCESS_TOKEN = os.getenv("SOLID_ACCESS_TOKEN", "")


class SolidClientError(Exception):
    """Exception raised when Solid Pod operations fail."""
    pass


class SolidClient:
    """
    HTTP client for interacting with a Solid Pod.
    Supports uploading files via HTTP PUT requests.

    Authentication can be provided via:
    - SOLID_ACCESS_TOKEN environment variable (Bearer token)
    """

    # Content type mappings
    CONTENT_TYPES = {
        ".ttl": "text/turtle",
        ".rdf": "application/rdf+xml",
        ".json": "application/json",
        ".xml": "application/xml",
        ".jsonld": "application/ld+json",
    }

    def __init__(
        self,
        pod_base_url: str,
        timeout: float = 30.0,
        access_token: Optional[str] = None
    ):
        """
        Initialize the Solid client.

        Args:
            pod_base_url: Base URL of the Solid Pod (e.g., https://tmdt-solid.../epcisrepository)
            timeout: HTTP request timeout in seconds
            access_token: Optional Bearer token for authentication
        """
        self.pod_base_url = pod_base_url.rstrip('/')
        self.timeout = timeout
        self.access_token = access_token or SOLID_ACCESS_TOKEN

    def _get_content_type(self, filename: str) -> str:
        """
        Determine content type based on file extension.

        Args:
            filename: Name of the file

        Returns:
            MIME content type string
        """
        for ext, content_type in self.CONTENT_TYPES.items():
            if filename.lower().endswith(ext):
                return content_type
        return "application/octet-stream"

    async def upload_file(
        self,
        content: bytes,
        filename: str,
        folder: str = "public",
        content_type: Optional[str] = None
    ) -> str:
        """
        Upload a file to the Solid Pod.

        Args:
            content: File content as bytes
            filename: Name for the file in the Pod
            folder: Folder within the Pod (default: "public")
            content_type: MIME type (auto-detected if not provided)

        Returns:
            URL of the uploaded file

        Raises:
            SolidClientError: If upload fails
        """
        if content_type is None:
            content_type = self._get_content_type(filename)

        url = f"{self.pod_base_url}/{folder}/{filename}"

        logger.info(f"Uploading to Solid Pod: {url}")

        try:
            headers = {"Content-Type": content_type}

            # Add authentication if token is available
            if self.access_token:
                headers["Authorization"] = f"Bearer {self.access_token}"

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.put(
                    url,
                    content=content,
                    headers=headers
                )

                if response.status_code in (200, 201, 204):
                    logger.info(f"Successfully uploaded: {url}")
                    return url

                # Handle specific error cases
                if response.status_code == 401:
                    raise SolidClientError(
                        f"Authentication required for {url}. "
                        "The Solid Pod may require authentication."
                    )
                elif response.status_code == 403:
                    raise SolidClientError(
                        f"Permission denied for {url}. "
                        "Check write permissions on the Pod."
                    )
                elif response.status_code == 404:
                    raise SolidClientError(
                        f"Container not found: {url}. "
                        "The folder may not exist in the Pod."
                    )
                else:
                    raise SolidClientError(
                        f"Upload failed with status {response.status_code}: "
                        f"{response.text[:500]}"
                    )

        except httpx.TimeoutException:
            raise SolidClientError(f"Upload timed out after {self.timeout}s")
        except httpx.RequestError as e:
            raise SolidClientError(f"Network error during upload: {str(e)}")
        except Exception as e:
            if isinstance(e, SolidClientError):
                raise
            raise SolidClientError(f"Upload error: {str(e)}")

    async def upload_raw_file(
        self,
        content: bytes,
        filename: str
    ) -> str:
        """
        Upload a raw data file to the uploads folder.

        Args:
            content: File content
            filename: Filename

        Returns:
            URL of the uploaded file
        """
        return await self.upload_file(content, filename, folder="public/uploads")

    async def upload_rdf_file(
        self,
        content: bytes,
        filename: str
    ) -> str:
        """
        Upload an RDF/TTL file to the public folder.

        Args:
            content: RDF content
            filename: Filename (should end with .ttl)

        Returns:
            URL of the uploaded file
        """
        return await self.upload_file(
            content,
            filename,
            folder="public",
            content_type="text/turtle"
        )

    async def check_file_exists(self, filename: str, folder: str = "public") -> bool:
        """
        Check if a file exists in the Solid Pod.

        Args:
            filename: Name of the file
            folder: Folder to check in

        Returns:
            True if file exists, False otherwise
        """
        url = f"{self.pod_base_url}/{folder}/{filename}"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.head(url)
                return response.status_code == 200
        except Exception:
            return False

    def get_file_url(self, filename: str, folder: str = "public") -> str:
        """
        Get the URL for a file in the Solid Pod.

        Args:
            filename: Name of the file
            folder: Folder containing the file

        Returns:
            Full URL to the file
        """
        return f"{self.pod_base_url}/{folder}/{filename}"
