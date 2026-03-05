"""
RML to Semantic Model Converter

Main conversion logic that transforms RML/R2RML mappings
into semantic model schemas.
"""

import logging
from typing import List, Optional, Set
from pathlib import Path
from rdflib import Graph, URIRef, Namespace
from rdflib.namespace import XSD

from .semantic_model import SemanticModel
from .rml_parser import RMLParser, TriplesMapInfo, ObjectMapInfo, RR
from .namespace_manager import NamespaceManager
from .output_writer import OutputWriter


logger = logging.getLogger(__name__)


class RMLToSemanticModelConverter:
    """
    Converts RML/R2RML mappings to semantic model schemas.

    The converter extracts schema-level information (classes, properties)
    from RML mappings without generating instance data.
    """

    def __init__(self, verbose: bool = False):
        """
        Initialize the converter.

        Args:
            verbose: If True, enable verbose logging
        """
        self.verbose = verbose
        self.parser = RMLParser()
        self.namespace_manager = NamespaceManager()
        self.model = SemanticModel()

        if verbose:
            logging.basicConfig(level=logging.DEBUG)
        else:
            logging.basicConfig(level=logging.WARNING)

    def convert_file(self, input_path: str) -> SemanticModel:
        """
        Convert a single RML/R2RML file to a semantic model.

        Args:
            input_path: Path to the RML/R2RML TTL file

        Returns:
            SemanticModel containing extracted schema
        """
        logger.info(f"Processing: {input_path}")

        # Parse the RML file
        graph = self.parser.parse_file(input_path)

        # Extract namespaces from the input graph
        self.namespace_manager.extract_from_graph(graph)

        # Extract TriplesMap definitions
        triples_maps = self.parser.extract_triples_maps()
        logger.info(f"Found {len(triples_maps)} TriplesMap definitions")

        # Convert to semantic model
        self.model = SemanticModel()
        for tm_uri, tm_info in triples_maps.items():
            self._process_triples_map(tm_info)

        # Copy namespaces to model
        for prefix, ns in self.namespace_manager.get_used_prefixes().items():
            self.model.add_namespace(prefix, ns)

        return self.model

    def convert_files(self, input_paths: List[str], merge: bool = True) -> SemanticModel:
        """
        Convert multiple RML/R2RML files.

        Args:
            input_paths: List of paths to RML/R2RML TTL files
            merge: If True, merge all results into a single model

        Returns:
            SemanticModel containing extracted schema(s)
        """
        if merge:
            merged_model = SemanticModel()
            for path in input_paths:
                model = self.convert_file(path)
                merged_model.merge(model)
            return merged_model
        else:
            # Return only the last model (for non-merge use case)
            model = SemanticModel()
            for path in input_paths:
                model = self.convert_file(path)
            return model

    def _process_triples_map(self, tm_info: TriplesMapInfo):
        """Process a single TriplesMap and add to the semantic model."""
        classes = tm_info.subject_map.classes

        if not classes:
            logger.debug(f"Skipping TriplesMap {tm_info.uri} - no class defined")
            return

        # Process each class defined in this TriplesMap
        for class_uri in classes:
            self._add_class_with_properties(class_uri, tm_info)

    def _add_class_with_properties(self, class_uri: URIRef, tm_info: TriplesMapInfo):
        """Add a class and its properties to the model."""
        # Mark class namespace as used
        self.namespace_manager.mark_used(class_uri)

        # Add the class
        self.model.add_class(class_uri)

        # Process predicate-object maps
        for pom_info in tm_info.predicate_object_maps:
            for predicate in pom_info.predicates:
                self._process_property(class_uri, predicate, pom_info, tm_info)

    def _process_property(self, class_uri: URIRef, predicate: URIRef,
                          pom_info, tm_info: TriplesMapInfo):
        """
        Process a property and determine if it's a data or object property.
        """
        # Mark predicate namespace as used
        self.namespace_manager.mark_used(predicate)

        # Check for constant object (shortcut notation)
        if pom_info.constant_object:
            # Constant URI object - treat as object property
            target = pom_info.constant_object
            self.namespace_manager.mark_used(target)
            # Check if target is a known class
            if self._is_likely_class(target):
                self.model.add_object_property(class_uri, predicate, target)
            return

        if not pom_info.object_map:
            logger.debug(f"No object map for predicate {predicate}")
            return

        om = pom_info.object_map

        # Case 1: Explicit parentTriplesMap -> Object Property
        if om.parent_triples_map:
            target_classes = self.parser.get_classes_for_triples_map(om.parent_triples_map)
            if target_classes:
                for target_class in target_classes:
                    self.namespace_manager.mark_used(target_class)
                    self.model.add_object_property(class_uri, predicate, target_class)
            else:
                logger.debug(f"No class found for parentTriplesMap {om.parent_triples_map}")
            return

        # Case 2: termType is IRI or BlankNode -> Object Property
        if om.term_type in (RR.IRI, RR.BlankNode):
            # Try to resolve target class from template
            if om.template:
                target_classes = self.parser.resolve_classes_from_template(om.template)
                if target_classes:
                    for target_class in target_classes:
                        self.namespace_manager.mark_used(target_class)
                        self.model.add_object_property(class_uri, predicate, target_class)
                    return
            # No target class found - skip this property
            logger.debug(f"Object property {predicate} without resolvable target class")
            return

        # Case 3: Template without parentTriplesMap -> try to resolve
        if om.template and not om.datatype:
            target_classes = self.parser.resolve_classes_from_template(om.template)
            if target_classes:
                for target_class in target_classes:
                    self.namespace_manager.mark_used(target_class)
                    self.model.add_object_property(class_uri, predicate, target_class)
                return

        # Case 4: Constant URI -> Object Property
        if om.constant and not om.datatype:
            target = om.constant
            self.namespace_manager.mark_used(target)
            if self._is_likely_class(target):
                self.model.add_object_property(class_uri, predicate, target)
            return

        # Case 5: Data Property
        xsd_type = self._determine_datatype(om)
        self.namespace_manager.mark_used(xsd_type)
        # Pass constant literal value if present (for metadata properties)
        self.model.add_data_property(class_uri, predicate, xsd_type, om.constant_literal)

    def _determine_datatype(self, om: ObjectMapInfo) -> URIRef:
        """Determine the XSD datatype for a data property."""
        # Priority 1: Explicit datatype
        if om.datatype:
            return om.datatype

        # Default: xsd:string
        return XSD.string

    def _is_likely_class(self, uri: URIRef) -> bool:
        """
        Heuristic to determine if a URI is likely a class.

        Checks if the URI matches any known class in the model
        or has a class-like naming pattern.
        """
        # Check if it's an XSD type (not a class)
        if str(uri).startswith(str(XSD)):
            return False

        # Check if it's already a known class
        if uri in self.model.classes:
            return True

        # Heuristic: Check if local name starts with uppercase (common for classes)
        local_name = self.namespace_manager.get_local_name(uri)
        if local_name and local_name[0].isupper():
            return True

        return False

    def write_output(self, output_path: str, model: Optional[SemanticModel] = None):
        """
        Write the semantic model to a TTL file.

        Args:
            output_path: Path for the output TTL file
            model: SemanticModel to write (uses self.model if not provided)
        """
        if model is None:
            model = self.model

        writer = OutputWriter(self.namespace_manager)
        writer.write(model, output_path)
        logger.info(f"Written: {output_path}")

    def get_ttl_string(self, model: Optional[SemanticModel] = None) -> str:
        """
        Get the semantic model as a TTL string.

        Args:
            model: SemanticModel to serialize (uses self.model if not provided)

        Returns:
            TTL string representation
        """
        if model is None:
            model = self.model

        writer = OutputWriter(self.namespace_manager)
        return writer.to_string(model)
