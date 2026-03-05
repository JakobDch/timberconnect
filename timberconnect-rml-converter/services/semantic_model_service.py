"""
Semantic Model Service

Wrapper service for extracting semantic models from RML mappings
using the rml2semantic_model package.
"""

import logging
from pathlib import Path
from typing import Dict, Tuple, Optional

from rml2semantic_model import RMLToSemanticModelConverter

logger = logging.getLogger(__name__)


class SemanticModelServiceError(Exception):
    """Exception raised when semantic model extraction fails."""
    pass


class SemanticModelService:
    """
    Service for extracting semantic models from RML mapping files.

    Uses the rml2semantic_model converter to extract schema-level
    semantic models (classes and properties) from RML/R2RML mappings.
    """

    # Mapping from mapping_id to mapping filename
    MAPPING_FILES: Dict[str, str] = {
        "stanford_hpr": "stanford_hpr.rml.ttl",
        "eldat_hba": "eldat_hba.rml.ttl",
        "vlex": "vlex.rml.ttl",
    }

    # Human-readable descriptions for each mapping type
    MAPPING_DESCRIPTIONS: Dict[str, str] = {
        "stanford_hpr": "StanForD HPR Forstdaten - Harvester-Produktionsdaten",
        "eldat_hba": "ELDAT HBA Saegewerksdaten - Holzbereitstellungsanzeige",
        "vlex": "VLEX BSP-Plattendaten - Brettsperrholz Produktion",
    }

    def __init__(self, mappings_dir: Optional[Path] = None):
        """
        Initialize the service.

        Args:
            mappings_dir: Directory containing RML mapping files.
                         Defaults to ../mappings relative to this file.
        """
        if mappings_dir is None:
            mappings_dir = Path(__file__).parent.parent / "mappings"

        self.mappings_dir = mappings_dir
        self._cache: Dict[str, Tuple[bytes, str]] = {}

        logger.info(f"SemanticModelService initialized with mappings_dir: {mappings_dir}")

    def extract_model(self, mapping_id: str) -> Tuple[bytes, str]:
        """
        Extract semantic model from an RML mapping.

        Args:
            mapping_id: ID of the mapping (stanford_hpr, eldat_hba, vlex)

        Returns:
            Tuple of (TTL content as bytes, filename)

        Raises:
            SemanticModelServiceError: If extraction fails
        """
        # Check cache first
        if mapping_id in self._cache:
            logger.debug(f"Using cached semantic model for {mapping_id}")
            return self._cache[mapping_id]

        # Validate mapping_id
        if mapping_id not in self.MAPPING_FILES:
            available = ", ".join(self.MAPPING_FILES.keys())
            raise SemanticModelServiceError(
                f"Unknown mapping_id: {mapping_id}. Available: {available}"
            )

        # Get mapping file path
        mapping_filename = self.MAPPING_FILES[mapping_id]
        mapping_file = self.mappings_dir / mapping_filename

        if not mapping_file.exists():
            raise SemanticModelServiceError(
                f"Mapping file not found: {mapping_file}"
            )

        logger.info(f"Extracting semantic model from {mapping_file}")

        try:
            # Use the rml2semantic_model converter
            converter = RMLToSemanticModelConverter()
            model = converter.convert_file(str(mapping_file))
            ttl_string = converter.get_ttl_string(model)

            # Convert to bytes
            ttl_content = ttl_string.encode('utf-8')

            # Generate output filename
            output_filename = f"{mapping_id}_semantic_model.ttl"

            # Cache the result
            result = (ttl_content, output_filename)
            self._cache[mapping_id] = result

            logger.info(
                f"Successfully extracted semantic model for {mapping_id}: "
                f"{len(ttl_content)} bytes, {len(model.classes)} classes"
            )

            return result

        except Exception as e:
            error_msg = f"Failed to extract semantic model from {mapping_id}: {str(e)}"
            logger.error(error_msg)
            raise SemanticModelServiceError(error_msg) from e

    def get_description(self, mapping_id: str) -> str:
        """
        Get human-readable description for a mapping type.

        Args:
            mapping_id: ID of the mapping

        Returns:
            Description string
        """
        return self.MAPPING_DESCRIPTIONS.get(mapping_id, mapping_id)

    def clear_cache(self):
        """Clear the cached semantic models."""
        self._cache.clear()
        logger.info("Semantic model cache cleared")

    def is_valid_mapping_id(self, mapping_id: str) -> bool:
        """Check if a mapping_id is valid."""
        return mapping_id in self.MAPPING_FILES

    def get_available_mappings(self) -> Dict[str, str]:
        """
        Get all available mapping IDs with their descriptions.

        Returns:
            Dict mapping mapping_id to description
        """
        return dict(self.MAPPING_DESCRIPTIONS)
