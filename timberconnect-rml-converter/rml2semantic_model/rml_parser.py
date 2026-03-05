"""
RML/R2RML Parser

Parses RML and R2RML mapping files using rdflib and extracts
structural elements (TriplesMap, SubjectMap, PredicateObjectMap).
"""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple
from rdflib import Graph, Namespace, URIRef, BNode, Literal
from rdflib.namespace import RDF, XSD


# RML/R2RML Namespaces
RR = Namespace("http://www.w3.org/ns/r2rml#")
RML = Namespace("http://semweb.mmlab.be/ns/rml#")
QL = Namespace("http://semweb.mmlab.be/ns/ql#")


@dataclass
class ObjectMapInfo:
    """Information extracted from an object map."""
    datatype: Optional[URIRef] = None
    parent_triples_map: Optional[URIRef] = None
    term_type: Optional[URIRef] = None
    template: Optional[str] = None
    constant: Optional[URIRef] = None
    constant_literal: Optional[str] = None  # Literal constant value (for metadata)
    reference: Optional[str] = None


@dataclass
class PredicateObjectMapInfo:
    """Information about a predicate-object map."""
    predicates: List[URIRef] = field(default_factory=list)
    object_map: Optional[ObjectMapInfo] = None
    constant_object: Optional[URIRef] = None


@dataclass
class SubjectMapInfo:
    """Information extracted from a subject map."""
    classes: Set[URIRef] = field(default_factory=set)
    template: Optional[str] = None
    term_type: Optional[URIRef] = None


@dataclass
class TriplesMapInfo:
    """Complete information about a TriplesMap."""
    uri: URIRef
    subject_map: SubjectMapInfo = field(default_factory=SubjectMapInfo)
    predicate_object_maps: List[PredicateObjectMapInfo] = field(default_factory=list)
    logical_source_type: Optional[str] = None  # CSV, SQL, JSON, XML


class RMLParser:
    """
    Parser for RML/R2RML mapping files.

    Extracts structural information from mappings that is needed
    to build the semantic model schema.
    """

    def __init__(self):
        self.graph: Optional[Graph] = None
        self.triples_maps: Dict[URIRef, TriplesMapInfo] = {}
        self._template_to_classes: Dict[str, Set[URIRef]] = {}

    def parse_file(self, file_path: str) -> Graph:
        """Parse an RML/R2RML TTL file and return the graph."""
        self.graph = Graph()
        self.graph.parse(file_path, format="turtle")
        return self.graph

    def parse_graph(self, graph: Graph) -> Graph:
        """Use an existing graph."""
        self.graph = graph
        return self.graph

    def extract_triples_maps(self) -> Dict[URIRef, TriplesMapInfo]:
        """
        Extract all TriplesMap definitions from the graph.

        Returns a dictionary mapping TriplesMap URIs to their info.
        """
        if self.graph is None:
            raise ValueError("No graph loaded. Call parse_file() first.")

        self.triples_maps = {}

        # Find all TriplesMap instances
        # Method 1: Explicit rdf:type rr:TriplesMap
        for tm in self.graph.subjects(RDF.type, RR.TriplesMap):
            if isinstance(tm, URIRef):
                self.triples_maps[tm] = self._parse_triples_map(tm)

        # Method 2: Implicit TriplesMap (has rr:subjectMap or rml:logicalSource)
        for tm in set(self.graph.subjects(RR.subjectMap, None)) | \
                  set(self.graph.subjects(RML.logicalSource, None)) | \
                  set(self.graph.subjects(RR.logicalTable, None)):
            if isinstance(tm, URIRef) and tm not in self.triples_maps:
                self.triples_maps[tm] = self._parse_triples_map(tm)

        # Build template-to-class mapping for later resolution
        self._build_template_class_mapping()

        return self.triples_maps

    def _parse_triples_map(self, tm_uri: URIRef) -> TriplesMapInfo:
        """Parse a single TriplesMap."""
        info = TriplesMapInfo(uri=tm_uri)

        # Parse subject map
        info.subject_map = self._parse_subject_map(tm_uri)

        # Parse predicate-object maps
        for pom in self.graph.objects(tm_uri, RR.predicateObjectMap):
            pom_info = self._parse_predicate_object_map(pom)
            if pom_info.predicates:  # Only add if we found predicates
                info.predicate_object_maps.append(pom_info)

        # Detect logical source type
        info.logical_source_type = self._detect_source_type(tm_uri)

        return info

    def _parse_subject_map(self, tm_uri: URIRef) -> SubjectMapInfo:
        """Parse the subject map of a TriplesMap."""
        info = SubjectMapInfo()

        # Get subject map (could be blank node or URI)
        sm = self.graph.value(tm_uri, RR.subjectMap)

        if sm:
            # Extract classes from subject map
            for cls in self.graph.objects(sm, RR["class"]):
                if isinstance(cls, URIRef):
                    info.classes.add(cls)

            # Extract template
            template = self.graph.value(sm, RR.template)
            if template:
                info.template = str(template)

            # Extract term type
            term_type = self.graph.value(sm, RR.termType)
            if isinstance(term_type, URIRef):
                info.term_type = term_type

        # Also check for rr:class directly on TriplesMap (shortcut notation)
        for cls in self.graph.objects(tm_uri, RR["class"]):
            if isinstance(cls, URIRef):
                info.classes.add(cls)

        return info

    def _parse_predicate_object_map(self, pom) -> PredicateObjectMapInfo:
        """Parse a single predicate-object map."""
        info = PredicateObjectMapInfo()

        # Get predicates
        # Method 1: Direct rr:predicate
        for pred in self.graph.objects(pom, RR.predicate):
            if isinstance(pred, URIRef):
                info.predicates.append(pred)

        # Method 2: rr:predicateMap with rr:constant
        pred_map = self.graph.value(pom, RR.predicateMap)
        if pred_map:
            const = self.graph.value(pred_map, RR.constant)
            if isinstance(const, URIRef):
                info.predicates.append(const)

        # Get object map
        om = self.graph.value(pom, RR.objectMap)
        if om:
            info.object_map = self._parse_object_map(om)
        else:
            # Check for shortcut rr:object
            obj = self.graph.value(pom, RR.object)
            if isinstance(obj, URIRef):
                info.constant_object = obj
            elif isinstance(obj, Literal):
                # Constant literal - create object map with datatype and value
                info.object_map = ObjectMapInfo(
                    datatype=obj.datatype if obj.datatype else XSD.string,
                    constant_literal=str(obj)  # Store the literal value
                )

        return info

    def _parse_object_map(self, om) -> ObjectMapInfo:
        """Parse an object map."""
        info = ObjectMapInfo()

        # Check for parentTriplesMap (indicates object property)
        ptm = self.graph.value(om, RR.parentTriplesMap)
        if isinstance(ptm, URIRef):
            info.parent_triples_map = ptm

        # Check for datatype (indicates data property)
        dt = self.graph.value(om, RR.datatype)
        if isinstance(dt, URIRef):
            info.datatype = dt

        # Check for termType
        tt = self.graph.value(om, RR.termType)
        if isinstance(tt, URIRef):
            info.term_type = tt

        # Check for template
        template = self.graph.value(om, RR.template)
        if template:
            info.template = str(template)

        # Check for constant
        const = self.graph.value(om, RR.constant)
        if isinstance(const, URIRef):
            info.constant = const
        elif isinstance(const, Literal):
            info.datatype = const.datatype if const.datatype else XSD.string
            info.constant_literal = str(const)  # Store the literal value

        # Check for reference (column/field reference)
        ref = self.graph.value(om, RML.reference) or self.graph.value(om, RR.column)
        if ref:
            info.reference = str(ref)

        return info

    def _detect_source_type(self, tm_uri: URIRef) -> Optional[str]:
        """Detect the type of data source (CSV, SQL, JSON, XML)."""
        # Check for RML logicalSource
        ls = self.graph.value(tm_uri, RML.logicalSource)
        if ls:
            ref_form = self.graph.value(ls, RML.referenceFormulation)
            if ref_form:
                ref_str = str(ref_form)
                if "CSV" in ref_str:
                    return "CSV"
                elif "JSONPath" in ref_str:
                    return "JSON"
                elif "XPath" in ref_str:
                    return "XML"

        # Check for R2RML logicalTable
        lt = self.graph.value(tm_uri, RR.logicalTable)
        if lt:
            return "SQL"

        return None

    def _build_template_class_mapping(self):
        """Build a mapping from normalized templates to their associated classes."""
        self._template_to_classes = {}

        for tm_uri, tm_info in self.triples_maps.items():
            if tm_info.subject_map.template and tm_info.subject_map.classes:
                normalized = self._normalize_template(tm_info.subject_map.template)
                if normalized not in self._template_to_classes:
                    self._template_to_classes[normalized] = set()
                self._template_to_classes[normalized].update(tm_info.subject_map.classes)

    def _normalize_template(self, template: str) -> str:
        """
        Normalize a template by replacing variable placeholders.

        Example: "http://example.org/person/{id}" -> "http://example.org/person/{VAR}"
        """
        return re.sub(r'\{[^}]+\}', '{VAR}', template)

    def resolve_classes_from_template(self, template: str) -> Set[URIRef]:
        """
        Find classes associated with a template pattern.

        Used to resolve target classes for object properties
        that use templates instead of parentTriplesMap.
        """
        normalized = self._normalize_template(template)
        return self._template_to_classes.get(normalized, set())

    def get_classes_for_triples_map(self, tm_uri: URIRef) -> Set[URIRef]:
        """Get the classes defined for a TriplesMap."""
        if tm_uri in self.triples_maps:
            return self.triples_maps[tm_uri].subject_map.classes
        return set()
