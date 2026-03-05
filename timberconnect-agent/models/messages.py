"""
Message Models for TimberConnect Chat Agent

Defines chat message and SSE event structures.
"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List, Literal
from enum import Enum


class LLMProvider(str, Enum):
    """Supported LLM providers"""
    OLLAMA = "ollama"
    DEEPSEEK = "deepseek"


class ProductContextRequest(BaseModel):
    """Product context sent from frontend"""
    product_id: str = Field(..., description="Unique product/trace ID")
    product_name: str = Field(..., description="Product name")
    wood_type: str = Field(..., description="Type of wood (e.g., Fichte, Tanne)")
    quality: Optional[str] = Field(None, description="Quality grade (e.g., C24)")
    dimensions: Optional[Dict[str, Any]] = Field(None, description="Product dimensions")
    certifications: List[str] = Field(default_factory=list, description="Certifications (FSC, PEFC)")
    origin: Optional[Dict[str, Any]] = Field(None, description="Origin information")
    harvest_date: Optional[str] = Field(None, description="Harvest date")
    supply_chain: List[Dict[str, Any]] = Field(default_factory=list, description="Supply chain steps")
    data_sources: List[str] = Field(default_factory=list, description="TTL file URLs")
    semantic_model_url: Optional[str] = Field(None, description="Semantic model URL from catalog")


class ChatRequest(BaseModel):
    """Chat message request from frontend"""
    message: str = Field(..., description="User's chat message")
    product_context: ProductContextRequest = Field(..., description="Current product context")
    session_id: Optional[str] = Field(None, description="Existing session ID for conversation continuity")
    llm_provider: LLMProvider = Field(default=LLMProvider.OLLAMA, description="LLM provider to use")
    deepseek_api_key: Optional[str] = Field(None, description="DeepSeek API key (required if using DeepSeek)")


class ChatMessage(BaseModel):
    """A single chat message"""
    role: Literal["user", "assistant", "system"] = Field(..., description="Message role")
    content: str = Field(..., description="Message content")
    timestamp: Optional[str] = Field(None, description="ISO timestamp")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")


class SSEEventType(str, Enum):
    """Types of SSE events sent to frontend"""
    MESSAGE_CHUNK = "message_chunk"  # Streaming text content
    MESSAGE_COMPLETE = "message_complete"  # Full message when not streaming
    VISUALIZATION = "visualization"  # Base64 encoded chart
    CALCULATION_RESULT = "calculation_result"  # Structured calculation results
    SPARQL_QUERY = "sparql_query"  # Generated SPARQL (for debugging)
    STATUS = "status"  # Processing status update
    ERROR = "error"  # Error information
    END_STREAM = "end_stream"  # Stream completion signal


class SSEEvent(BaseModel):
    """Server-Sent Event structure"""
    event_type: SSEEventType
    data: Dict[str, Any]

    def format(self) -> str:
        """Format as SSE string"""
        import json
        return f"event: {self.event_type.value}\ndata: {json.dumps(self.data, ensure_ascii=False)}\n\n"


class VisualizationData(BaseModel):
    """Data for visualization events"""
    chart_type: str = Field(..., description="Type of chart (bar, pie, line, timeline)")
    image_base64: str = Field(..., description="Base64 encoded PNG image")
    title: Optional[str] = Field(None, description="Chart title")
    description: Optional[str] = Field(None, description="Chart description")


class CalculationResultData(BaseModel):
    """Data for calculation result events"""
    summary: Dict[str, Any] = Field(..., description="Summary values")
    details: Optional[List[Dict[str, Any]]] = Field(None, description="Detailed breakdown")
    unit: Optional[str] = Field(None, description="Unit of measurement")
    description: Optional[str] = Field(None, description="Description of calculation")
