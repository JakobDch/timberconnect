"""
Namespace Manager for handling RDF namespace prefixes.

Extracts and manages namespace prefixes from input RML graphs
and ensures proper prefix declarations in output.
"""

from typing import Dict, Optional, Set
from rdflib import Graph, Namespace, URIRef
from rdflib.namespace import XSD, RDF, RDFS


# Standard RML/R2RML namespaces to exclude from output
RML_NAMESPACES = {
    "http://www.w3.org/ns/r2rml#",
    "http://semweb.mmlab.be/ns/rml#",
    "http://semweb.mmlab.be/ns/ql#",
    "http://semweb.mmlab.be/ns/fnml#",
    "https://w3id.org/function/ontology#",
}

# Standard prefixes that should always be included if used
STANDARD_PREFIXES = {
    "xsd": Namespace("http://www.w3.org/2001/XMLSchema#"),
    "rdf": Namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#"),
    "rdfs": Namespace("http://www.w3.org/2000/01/rdf-schema#"),
}


class NamespaceManager:
    """
    Manages namespace prefixes for RDF graphs.

    Extracts prefixes from input graphs and provides methods
    to resolve and manage namespace mappings.
    """

    def __init__(self):
        self._prefixes: Dict[str, Namespace] = {}
        self._used_namespaces: Set[str] = set()

    def extract_from_graph(self, graph: Graph):
        """
        Extract namespace prefixes from an rdflib Graph.

        Excludes RML/R2RML specific namespaces as they're not
        relevant for the output semantic model.
        """
        for prefix, namespace in graph.namespaces():
            ns_str = str(namespace)
            # Skip RML-specific namespaces
            if ns_str in RML_NAMESPACES:
                continue
            if prefix and ns_str:
                self._prefixes[prefix] = Namespace(namespace)

    def add_namespace(self, prefix: str, namespace: Namespace):
        """Add or update a namespace prefix."""
        self._prefixes[prefix] = namespace

    def mark_used(self, uri: URIRef):
        """Mark a namespace as used based on a URI."""
        uri_str = str(uri)
        for prefix, ns in self._prefixes.items():
            ns_str = str(ns)
            if uri_str.startswith(ns_str):
                self._used_namespaces.add(prefix)
                return
        # Check standard prefixes
        for prefix, ns in STANDARD_PREFIXES.items():
            ns_str = str(ns)
            if uri_str.startswith(ns_str):
                self._used_namespaces.add(prefix)
                if prefix not in self._prefixes:
                    self._prefixes[prefix] = ns
                return

    def ensure_xsd_prefix(self):
        """Ensure xsd prefix is present and marked as used."""
        if "xsd" not in self._prefixes:
            self._prefixes["xsd"] = STANDARD_PREFIXES["xsd"]
        self._used_namespaces.add("xsd")

    def get_prefix(self, uri: URIRef) -> Optional[str]:
        """Get the prefix for a URI, or None if not found."""
        uri_str = str(uri)
        for prefix, ns in self._prefixes.items():
            ns_str = str(ns)
            if uri_str.startswith(ns_str):
                return prefix
        return None

    def get_local_name(self, uri: URIRef) -> str:
        """Get the local name (fragment) of a URI."""
        uri_str = str(uri)
        if "#" in uri_str:
            return uri_str.split("#")[-1]
        return uri_str.rstrip("/").split("/")[-1]

    def get_prefixed_name(self, uri: URIRef) -> str:
        """
        Get the prefixed form of a URI (e.g., 'npdv:Discovery').

        Falls back to full URI if no prefix is found.
        """
        prefix = self.get_prefix(uri)
        if prefix:
            local = self.get_local_name(uri)
            return f"{prefix}:{local}"
        return f"<{uri}>"

    def get_all_prefixes(self) -> Dict[str, Namespace]:
        """Return all registered namespace prefixes."""
        return dict(self._prefixes)

    def get_used_prefixes(self) -> Dict[str, Namespace]:
        """Return only the namespace prefixes that have been marked as used."""
        return {prefix: ns for prefix, ns in self._prefixes.items()
                if prefix in self._used_namespaces}

    def get_namespace_for_uri(self, uri: URIRef) -> Optional[Namespace]:
        """Get the Namespace object for a URI."""
        uri_str = str(uri)
        for prefix, ns in self._prefixes.items():
            ns_str = str(ns)
            if uri_str.startswith(ns_str):
                return ns
        return None

    def __repr__(self):
        return f"NamespaceManager(prefixes={len(self._prefixes)}, used={len(self._used_namespaces)})"
