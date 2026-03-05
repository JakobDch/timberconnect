"""Prompts package for TimberConnect Chat Agent"""

from prompts.orchestrator_prompts import (
    SYSTEM_PROMPT,
    INTENT_CLASSIFICATION_PROMPT,
    RESPONSE_GENERATION_PROMPT,
    WELCOME_MESSAGE
)
from prompts.sparql_prompts import (
    SPARQL_GENERATION_PROMPT,
    SPARQL_RESPONSE_PROMPT,
    SPARQL_PREFIXES
)
from prompts.visualization_prompts import (
    VISUALIZATION_CODE_PROMPT,
    TC_COLORS
)

__all__ = [
    "SYSTEM_PROMPT",
    "INTENT_CLASSIFICATION_PROMPT",
    "RESPONSE_GENERATION_PROMPT",
    "WELCOME_MESSAGE",
    "SPARQL_GENERATION_PROMPT",
    "SPARQL_RESPONSE_PROMPT",
    "SPARQL_PREFIXES",
    "VISUALIZATION_CODE_PROMPT",
    "TC_COLORS"
]
