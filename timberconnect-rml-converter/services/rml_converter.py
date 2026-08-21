"""
RML Converter Service

Wrapper around RMLMapper JAR for converting XML/JSON files to RDF using RML mappings.
"""

import subprocess
import os
import tempfile
import shutil
from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Base directory of the application
BASE_DIR = Path(__file__).parent.parent.absolute()
MAPPINGS_DIR = BASE_DIR / "mappings"
LIB_DIR = BASE_DIR / "lib"
RMLMAPPER_JAR = LIB_DIR / "rmlmapper.jar"


class RMLConverterError(Exception):
    """Exception raised when RML conversion fails."""
    pass


class RMLConverter:
    """
    Converts source data files (XML/JSON) to RDF using RML mappings.
    """

    # Mapping type to template file
    MAPPING_TEMPLATES = {
        "stanford_hpr": "stanford_hpr.rml.ttl",
        "eldat_hba": "eldat_hba.rml.ttl",
        "vlex": "vlex.rml.ttl",
        # Herstellungsvorgang: ERP-Exceldatei, vorab von erp_excel_service
        # in ein JSON-Zwischendokument ueberfuehrt
        "erp_bsp": "erp_bsp.rml.ttl",
        # Ausfuehrungsplanung: IFC-Auszug, vorab von ifc_service in ein
        # JSON-Zwischendokument ueberfuehrt
        "ifc_planung": "ifc_planung.rml.ttl",
        # PDF-Templates (manuelle Datenuebernahme, generate_pdf_mappings.py)
        "pdf_pruefzertifikat": "pdf_pruefzertifikat.rml.ttl",
        "pdf_klebstoffdatenblatt": "pdf_klebstoffdatenblatt.rml.ttl",
        "pdf_schnittbild": "pdf_schnittbild.rml.ttl",
        "pdf_biegepruefung": "pdf_biegepruefung.rml.ttl",
        "pdf_leistungserklaerung": "pdf_leistungserklaerung.rml.ttl",
        "pdf_transportauftrag": "pdf_transportauftrag.rml.ttl",
        "pdf_stammzertifikat": "pdf_stammzertifikat.rml.ttl",
        "pdf_transportauftrag_rundholz": "pdf_transportauftrag_rundholz.rml.ttl",
        "pdf_fertigungsauftrag_saege": "pdf_fertigungsauftrag_saege.rml.ttl",
        "pdf_leistungserklaerung_bsp": "pdf_leistungserklaerung_bsp.rml.ttl",
    }

    # Mapping type to expected file extension
    MAPPING_EXTENSIONS = {
        "stanford_hpr": ".xml",
        "eldat_hba": ".json",
        "vlex": ".json",
        "erp_bsp": ".json",
        "ifc_planung": ".json",
        "pdf_pruefzertifikat": ".json",
        "pdf_klebstoffdatenblatt": ".json",
        "pdf_schnittbild": ".json",
        "pdf_biegepruefung": ".json",
        "pdf_leistungserklaerung": ".json",
        "pdf_transportauftrag": ".json",
        "pdf_stammzertifikat": ".json",
        "pdf_transportauftrag_rundholz": ".json",
        "pdf_fertigungsauftrag_saege": ".json",
        "pdf_leistungserklaerung_bsp": ".json",
    }

    def __init__(self, temp_dir: Optional[str] = None):
        """
        Initialize the RML converter.

        Args:
            temp_dir: Optional temporary directory for file processing.
                     If not provided, a system temp directory will be used.
        """
        self.temp_dir = Path(temp_dir) if temp_dir else Path(tempfile.gettempdir()) / "rml_converter"
        self.temp_dir.mkdir(parents=True, exist_ok=True)

        if not RMLMAPPER_JAR.exists():
            logger.warning(f"RMLMapper JAR not found at {RMLMAPPER_JAR}")

    def _create_mapping_file(
        self,
        mapping_type: str,
        source_filename: str,
        work_dir: Path
    ) -> Path:
        """
        Create a mapping file by replacing the source filename placeholder in the template.

        Args:
            mapping_type: Type of mapping (stanford_hpr, eldat_hba, vlex)
            source_filename: Name of the source data file
            work_dir: Working directory for the mapping file

        Returns:
            Path to the created mapping file
        """
        template_name = self.MAPPING_TEMPLATES.get(mapping_type)
        if not template_name:
            raise RMLConverterError(f"Unknown mapping type: {mapping_type}")

        template_path = MAPPINGS_DIR / template_name
        if not template_path.exists():
            raise RMLConverterError(f"Mapping template not found: {template_path}")

        # Read template
        with open(template_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Replace placeholder with actual source filename
        content = content.replace("{{SOURCE_FILE}}", source_filename)

        # Write to work directory
        output_mapping = work_dir / f"mapping_{mapping_type}.rml.ttl"
        with open(output_mapping, 'w', encoding='utf-8') as f:
            f.write(content)

        logger.info(f"Created mapping file: {output_mapping}")
        return output_mapping

    @staticmethod
    def _strip_default_xml_namespace(content: bytes) -> bytes:
        """Remove default XML namespace declarations (xmlns="...") from XML.

        RMLMapper's XPath engine cannot resolve elements that live in a default
        namespace using plain element-name paths. Removing the default namespace
        declaration (NOT prefixed xmlns:foo) lets the mapping's element paths
        match. Prefixed namespaces are left untouched.
        """
        import re

        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            text = content.decode("latin-1")

        # Drop only default-namespace declarations: xmlns="..."  (with optional
        # surrounding whitespace), keep xmlns:prefix="..." intact.
        stripped = re.sub(r'\s+xmlns="[^"]*"', "", text, count=0)

        if stripped != text:
            logger.info("Stripped default XML namespace for RMLMapper compatibility")
        return stripped.encode("utf-8")

    def convert(
        self,
        source_content: bytes,
        source_filename: str,
        mapping_type: str,
        trace_id: str,
        data_type: str  # 'forst', 'saegewerk', 'bspwerk'
    ) -> tuple[bytes, str]:
        """
        Convert source data to RDF using the specified RML mapping.

        Args:
            source_content: Raw content of the source file
            source_filename: Original filename of the source
            mapping_type: Type of RML mapping to use
            trace_id: TimberConnect trace ID for the product
            data_type: Type of data (forst, saegewerk, bspwerk)

        Returns:
            Tuple of (RDF content as bytes, output filename)

        Raises:
            RMLConverterError: If conversion fails
        """
        if not RMLMAPPER_JAR.exists():
            raise RMLConverterError(
                f"RMLMapper JAR not found at {RMLMAPPER_JAR}. "
                "Please download from: https://github.com/RMLio/rmlmapper-java/releases"
            )

        # Validate mapping type
        if mapping_type not in self.MAPPING_TEMPLATES:
            raise RMLConverterError(
                f"Unknown mapping type: {mapping_type}. "
                f"Available: {list(self.MAPPING_TEMPLATES.keys())}"
            )

        # Create unique work directory for this conversion
        work_dir = self.temp_dir / f"{trace_id}_{data_type}"
        work_dir.mkdir(parents=True, exist_ok=True)

        try:
            # Determine output filename based on data type
            type_suffix = {
                "forst": "Forst_StanForD_HPR",
                "saegewerk": "Saegewerk_ELDAT_HBA",
                "bspwerk": "BSPWerk_VLEX_Materialfluss",
                "herstellung": "Herstellung_ERP_BSP"
            }.get(data_type, data_type)

            ext = self.MAPPING_EXTENSIONS.get(mapping_type, ".dat")
            work_source_filename = f"{trace_id}_{type_suffix}{ext}"
            output_ttl_filename = f"{trace_id}_{type_suffix}.ttl"

            # RMLMapper's XPath engine is not namespace-aware: a default XML
            # namespace (e.g. StanForD's urn:skogforsk:stanford2010) makes every
            # plain XPath in the mapping match nothing. Strip default namespace
            # declarations from XML sources so the mapping's element paths work.
            if ext == ".xml":
                source_content = self._strip_default_xml_namespace(source_content)

            # Write source file to work directory
            source_path = work_dir / work_source_filename
            with open(source_path, 'wb') as f:
                f.write(source_content)

            logger.info(f"Wrote source file to: {source_path}")

            # Create mapping file with correct source filename
            mapping_path = self._create_mapping_file(
                mapping_type,
                work_source_filename,
                work_dir
            )

            # Output file path
            output_path = work_dir / output_ttl_filename

            # Run RMLMapper
            cmd = [
                "java", "-jar", str(RMLMAPPER_JAR),
                "-m", str(mapping_path),
                "-o", str(output_path),
                "-s", "turtle"
            ]

            logger.info(f"Running RMLMapper: {' '.join(cmd)}")

            result = subprocess.run(
                cmd,
                cwd=str(work_dir),
                capture_output=True,
                text=True,
                timeout=120
            )

            if result.returncode != 0:
                error_msg = result.stderr[:1000] if result.stderr else "Unknown error"
                logger.error(f"RMLMapper failed: {error_msg}")
                raise RMLConverterError(f"RML conversion failed: {error_msg}")

            # Read output
            if not output_path.exists():
                raise RMLConverterError("RMLMapper did not produce output file")

            with open(output_path, 'rb') as f:
                rdf_content = f.read()

            logger.info(f"Successfully converted to RDF: {len(rdf_content)} bytes")

            return rdf_content, output_ttl_filename

        except subprocess.TimeoutExpired:
            raise RMLConverterError("RML conversion timed out after 120 seconds")

        except Exception as e:
            if isinstance(e, RMLConverterError):
                raise
            raise RMLConverterError(f"Conversion error: {str(e)}")

        finally:
            # Clean up work directory
            try:
                shutil.rmtree(work_dir)
            except Exception as e:
                logger.warning(f"Failed to clean up work directory: {e}")

    @staticmethod
    def get_available_mappings() -> list[dict]:
        """
        Get list of available RML mappings with metadata.

        Returns:
            List of mapping configurations
        """
        return [
            {
                "id": "stanford_hpr",
                "name": "StanForD HPR - Forstdaten",
                "inputFormat": "XML",
                "description": "Harvester-Produktionsdaten im StanForD2010-Format",
                "dataType": "forst"
            },
            {
                "id": "eldat_hba",
                "name": "ELDAT HBA - Saegewerksdaten",
                "inputFormat": "JSON",
                "description": "Holzbereitstellungsanzeige im ELDAT-Format",
                "dataType": "saegewerk"
            },
            {
                "id": "vlex",
                "name": "VLEX - BSP-Plattendaten",
                "inputFormat": "JSON",
                "description": "BSP-Plattenproduktion im VLEX-Materialfluss-Format",
                "dataType": "bspwerk"
            },
            {
                "id": "erp_bsp",
                "name": "ERP-BSP-Tabelle - Herstellungsvorgang",
                "inputFormat": "XLSX",
                "description": "ERP-Export der BSP-Plattenherstellung inkl. Identifikations-Blatt",
                "dataType": "herstellung"
            },
            {
                "id": "ifc_planung",
                "name": "IFC - Ausfuehrungsplanung Brettsperrholz",
                "inputFormat": "IFC",
                "description": "Bauteilbezogener Auszug eines Ausfuehrungsplanungsmodells (Verortung im Gebaeude)",
                "dataType": "planung"
            }
        ]
