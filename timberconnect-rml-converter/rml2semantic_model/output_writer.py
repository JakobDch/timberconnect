"""
Output Writer for Semantic Models

Serializes SemanticModel to TTL format in the npdv-style:
  Class predicate1 type1 ;
      predicate2 type2 .
"""

from typing import List, Optional
from pathlib import Path
from rdflib import URIRef

from .semantic_model import SemanticModel, ClassInfo, PropertyInfo
from .namespace_manager import NamespaceManager


class OutputWriter:
    """
    Writes semantic models to TTL format.

    Output format follows the npdv-style where:
    - Data properties point to XSD types
    - Object properties point to other class URIs
    - Properties are sorted alphabetically (data first, then object)
    """

    def __init__(self, namespace_manager: NamespaceManager):
        """
        Initialize the writer.

        Args:
            namespace_manager: NamespaceManager with prefix bindings
        """
        self.ns_manager = namespace_manager

    def write(self, model: SemanticModel, output_path: str):
        """
        Write the semantic model to a TTL file.

        Args:
            model: SemanticModel to serialize
            output_path: Path for the output file
        """
        content = self.to_string(model)

        # Ensure parent directory exists
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(content)

    def to_string(self, model: SemanticModel) -> str:
        """
        Convert the semantic model to a TTL string.

        Args:
            model: SemanticModel to serialize

        Returns:
            TTL string representation
        """
        lines: List[str] = []

        # Write prefix declarations
        lines.extend(self._format_prefixes(model))
        lines.append("")  # Empty line after prefixes

        # Write class blocks (sorted by class name)
        sorted_classes = sorted(
            model.classes.values(),
            key=lambda c: self._get_sort_key(c.class_uri)
        )

        for i, class_info in enumerate(sorted_classes):
            class_block = self._format_class_block(class_info)
            if class_block:
                if i > 0:
                    lines.append("")  # Empty line between classes
                lines.append(class_block)

        # Ensure file ends with newline
        if lines and lines[-1] != "":
            lines.append("")

        return "\n".join(lines)

    def _format_prefixes(self, model: SemanticModel) -> List[str]:
        """Format prefix declarations."""
        lines = []

        # Get all used prefixes from namespace manager
        prefixes = self.ns_manager.get_used_prefixes()

        # Also include prefixes from model
        for prefix, ns in model.namespaces.items():
            if prefix not in prefixes:
                prefixes[prefix] = ns

        # Sort prefixes alphabetically
        for prefix in sorted(prefixes.keys()):
            ns = prefixes[prefix]
            lines.append(f"@prefix {prefix}: <{ns}> .")

        return lines

    def _format_class_block(self, class_info: ClassInfo) -> str:
        """
        Format a class and its properties as a TTL block.

        Returns empty string if class has no properties.
        """
        # Get all properties as (predicate, range, is_object_prop, constant_value) tuples
        prop_tuples = []

        # Data properties
        for pred, prop in class_info.data_properties.items():
            prop_tuples.append((pred, prop.range_type, False, prop.constant_value))

        # Object properties (can have multiple targets per predicate)
        for pred, targets in class_info.object_properties.items():
            for target in sorted(targets, key=lambda t: self._get_sort_key(t)):
                prop_tuples.append((pred, target, True, None))

        if not prop_tuples:
            return ""

        # Sort: data properties first (alphabetically), then object properties (alphabetically)
        prop_tuples.sort(key=lambda p: (p[2], self._get_sort_key(p[0]), self._get_sort_key(p[1])))

        # Format class URI
        class_name = self.ns_manager.get_prefixed_name(class_info.class_uri)

        # Format properties
        prop_strs = []
        for pred, range_type, _, constant_value in prop_tuples:
            pred_name = self.ns_manager.get_prefixed_name(pred)
            range_name = self.ns_manager.get_prefixed_name(range_type)
            if constant_value is not None:
                # Format as literal with value: "value"^^xsd:type
                prop_strs.append(f'{pred_name} "{constant_value}"^^{range_name}')
            else:
                prop_strs.append(f"{pred_name} {range_name}")

        if len(prop_strs) == 1:
            # Single property: all on one line
            return f"{class_name} {prop_strs[0]} ."
        else:
            # Multiple properties: use semicolon notation with indentation
            lines = [f"{class_name} {prop_strs[0]} ;"]
            for prop_str in prop_strs[1:-1]:
                lines.append(f"    {prop_str} ;")
            lines.append(f"    {prop_strs[-1]} .")
            return "\n".join(lines)

    def _get_sort_key(self, uri: URIRef) -> str:
        """Get a sort key for a URI (uses local name)."""
        return self.ns_manager.get_local_name(uri).lower()
