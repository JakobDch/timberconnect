"""
Semantic Model data structures.

Represents the extracted schema-level information from RML mappings.
"""

from dataclasses import dataclass, field
from typing import Dict, Set, Optional, Any
from rdflib import URIRef, Namespace, Literal
from rdflib.namespace import XSD


@dataclass
class PropertyInfo:
    """
    Represents a property (data or object property) in the semantic model.

    Attributes:
        predicate: The property URI
        range_type: XSD type for data properties, class URI for object properties
        is_object_property: True if this links to another class
        constant_value: Optional constant literal value (for metadata properties)
    """
    predicate: URIRef
    range_type: URIRef
    is_object_property: bool = False
    constant_value: Optional[str] = None  # The actual literal value if constant

    def __hash__(self):
        return hash((self.predicate, self.range_type, self.is_object_property, self.constant_value))

    def __eq__(self, other):
        if not isinstance(other, PropertyInfo):
            return False
        return (self.predicate == other.predicate and
                self.range_type == other.range_type and
                self.is_object_property == other.is_object_property and
                self.constant_value == other.constant_value)


@dataclass
class ClassInfo:
    """
    Represents a class in the semantic model with its properties.

    Attributes:
        class_uri: The class URI
        data_properties: Dict mapping predicate to PropertyInfo for data properties
        object_properties: Dict mapping predicate to Set of target class URIs
    """
    class_uri: URIRef
    data_properties: Dict[URIRef, PropertyInfo] = field(default_factory=dict)
    object_properties: Dict[URIRef, Set[URIRef]] = field(default_factory=dict)

    def add_data_property(self, predicate: URIRef, xsd_type: URIRef, constant_value: Optional[str] = None):
        """Add a data property with the given XSD type and optional constant value."""
        prop = PropertyInfo(
            predicate=predicate,
            range_type=xsd_type,
            is_object_property=False,
            constant_value=constant_value
        )
        self.data_properties[predicate] = prop

    def add_object_property(self, predicate: URIRef, target_class: URIRef):
        """Add an object property linking to another class. Supports multiple ranges."""
        if predicate not in self.object_properties:
            self.object_properties[predicate] = set()
        self.object_properties[predicate].add(target_class)

    def get_all_properties_flat(self) -> list:
        """Return all properties as flat list of (predicate, range, is_object_prop) tuples."""
        props = []
        for pred, prop in self.data_properties.items():
            props.append((pred, prop.range_type, False))
        for pred, targets in self.object_properties.items():
            for target in targets:
                props.append((pred, target, True))
        return props


class SemanticModel:
    """
    In-memory representation of the semantic model schema.

    Contains all discovered classes and their properties,
    as well as namespace prefix mappings.
    """

    def __init__(self):
        self.classes: Dict[URIRef, ClassInfo] = {}
        self.namespaces: Dict[str, Namespace] = {}

    def add_class(self, class_uri: URIRef) -> ClassInfo:
        """
        Add a class to the model. Returns existing class if already present.
        """
        if class_uri not in self.classes:
            self.classes[class_uri] = ClassInfo(class_uri=class_uri)
        return self.classes[class_uri]

    def get_class(self, class_uri: URIRef) -> Optional[ClassInfo]:
        """Get a class by URI, or None if not found."""
        return self.classes.get(class_uri)

    def add_data_property(self, class_uri: URIRef, predicate: URIRef, xsd_type: URIRef,
                          constant_value: Optional[str] = None):
        """Add a data property to a class with optional constant value."""
        class_info = self.add_class(class_uri)
        class_info.add_data_property(predicate, xsd_type, constant_value)

    def add_object_property(self, class_uri: URIRef, predicate: URIRef, target_class: URIRef):
        """Add an object property linking two classes."""
        class_info = self.add_class(class_uri)
        class_info.add_object_property(predicate, target_class)
        # Also ensure target class exists in model
        self.add_class(target_class)

    def add_namespace(self, prefix: str, namespace: Namespace):
        """Add a namespace prefix mapping."""
        self.namespaces[prefix] = namespace

    def merge(self, other: 'SemanticModel'):
        """
        Merge another semantic model into this one.
        Properties from the other model are added to existing classes.
        """
        # Merge namespaces
        for prefix, ns in other.namespaces.items():
            if prefix not in self.namespaces:
                self.namespaces[prefix] = ns

        # Merge classes and their properties
        for class_uri, class_info in other.classes.items():
            if class_uri in self.classes:
                # Merge properties into existing class
                existing = self.classes[class_uri]
                for pred, prop in class_info.data_properties.items():
                    if pred not in existing.data_properties:
                        existing.data_properties[pred] = prop
                for pred, targets in class_info.object_properties.items():
                    if pred not in existing.object_properties:
                        existing.object_properties[pred] = set()
                    existing.object_properties[pred].update(targets)
            else:
                # Add new class
                self.classes[class_uri] = class_info

    def get_all_class_uris(self) -> Set[URIRef]:
        """Return all class URIs in the model."""
        return set(self.classes.keys())

    def __repr__(self):
        return f"SemanticModel(classes={len(self.classes)}, namespaces={len(self.namespaces)})"
