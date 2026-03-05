"""
RML to Semantic Model Converter

Converts RML/R2RML mapping files to schema-level semantic models (TTL format).
Extracts classes and their properties without generating instance data.
"""

__version__ = "1.0.0"

from .semantic_model import SemanticModel, ClassInfo, PropertyInfo
from .converter import RMLToSemanticModelConverter
from .rml_parser import RMLParser
from .output_writer import OutputWriter

__all__ = [
    "SemanticModel",
    "ClassInfo",
    "PropertyInfo",
    "RMLToSemanticModelConverter",
    "RMLParser",
    "OutputWriter",
]
