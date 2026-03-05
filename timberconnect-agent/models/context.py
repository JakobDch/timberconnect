"""
Context Models for TimberConnect Chat Agent

Defines the product context and agent context structures.
"""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List
from datetime import datetime
import uuid


@dataclass
class ProductContext:
    """
    Pre-loaded product context - always available when chat opens.
    This is the KEY DIFFERENCE from DINa: no discovery phase needed.
    """
    product_id: str
    product_name: str
    wood_type: str
    quality: Optional[str] = None
    dimensions: Optional[Dict[str, Any]] = None
    certifications: List[str] = field(default_factory=list)
    origin: Optional[Dict[str, Any]] = None
    harvest_date: Optional[str] = None
    supply_chain: List[Dict[str, Any]] = field(default_factory=list)
    data_sources: List[str] = field(default_factory=list)  # TTL file URLs
    semantic_model_url: Optional[str] = None  # From catalog

    def get_summary(self) -> str:
        """Get a human-readable summary of the product context"""
        summary_parts = [
            f"Produkt-ID: {self.product_id}",
            f"Name: {self.product_name}",
            f"Holzart: {self.wood_type}"
        ]

        if self.quality:
            summary_parts.append(f"Qualität: {self.quality}")

        if self.dimensions:
            dims = self.dimensions
            dim_str = f"{dims.get('length', '?')}x{dims.get('width', '?')}x{dims.get('thickness', '?')} mm"
            summary_parts.append(f"Maße: {dim_str}")

        if self.certifications:
            summary_parts.append(f"Zertifikate: {', '.join(self.certifications)}")

        if self.origin:
            origin_str = self.origin.get('location', self.origin.get('region', 'Unbekannt'))
            summary_parts.append(f"Herkunft: {origin_str}")

        if self.harvest_date:
            summary_parts.append(f"Erntedatum: {self.harvest_date}")

        if self.supply_chain:
            summary_parts.append(f"Lieferkettenschritte: {len(self.supply_chain)}")

        return "\n".join(summary_parts)

    def get_supply_chain_summary(self) -> str:
        """Get a summary of the supply chain"""
        if not self.supply_chain:
            return "Keine Lieferkettendaten verfügbar"

        steps = []
        for step in self.supply_chain:
            stage = step.get('stage', step.get('title', 'Unbekannt'))
            company = step.get('company', step.get('name', ''))
            date = step.get('date', '')
            step_str = f"- {stage}"
            if company:
                step_str += f": {company}"
            if date:
                step_str += f" ({date})"
            steps.append(step_str)

        return "\n".join(steps)


@dataclass
class ConversationEntry:
    """A single entry in the conversation history"""
    role: str  # "user" or "assistant"
    content: str
    timestamp: datetime = field(default_factory=datetime.now)
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class AgentContext:
    """
    Conversation context maintained throughout the chat session.
    """
    session_id: str
    product_context: ProductContext
    conversation_history: List[ConversationEntry] = field(default_factory=list)
    last_sparql_results: Optional[List[Dict]] = None
    last_sparql_query: Optional[str] = None
    last_calculation_results: Optional[Dict[str, Any]] = None

    @staticmethod
    def create_new(product_context: ProductContext) -> "AgentContext":
        """Create a new agent context with a generated session ID"""
        return AgentContext(
            session_id=str(uuid.uuid4()),
            product_context=product_context
        )

    def add_user_message(self, content: str) -> None:
        """Add a user message to the conversation history"""
        self.conversation_history.append(
            ConversationEntry(role="user", content=content)
        )

    def add_assistant_message(self, content: str, metadata: Optional[Dict] = None) -> None:
        """Add an assistant message to the conversation history"""
        self.conversation_history.append(
            ConversationEntry(role="assistant", content=content, metadata=metadata)
        )

    def get_conversation_for_llm(self, max_entries: int = 10) -> List[Dict[str, str]]:
        """
        Get the conversation history formatted for LLM input.
        Returns the most recent entries up to max_entries.
        """
        recent = self.conversation_history[-max_entries:]
        return [
            {"role": entry.role, "content": entry.content}
            for entry in recent
        ]

    def store_sparql_results(self, query: str, results: List[Dict]) -> None:
        """Store SPARQL query and results for follow-up questions"""
        self.last_sparql_query = query
        self.last_sparql_results = results

    def store_calculation_results(self, results: Dict[str, Any]) -> None:
        """Store calculation results for follow-up questions"""
        self.last_calculation_results = results

    def has_previous_results(self) -> bool:
        """Check if there are previous results available"""
        return (
            self.last_sparql_results is not None or
            self.last_calculation_results is not None
        )
