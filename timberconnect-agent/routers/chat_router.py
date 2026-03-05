"""
Chat Router for TimberConnect Chat Agent

Provides SSE streaming endpoint for chat interactions.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional
import json
import uuid

from models.messages import ChatRequest, LLMProvider, SSEEventType
from models.context import ProductContext, AgentContext
from llm_services import get_llm_for_provider
from agents.orchestrating_agent import OrchestratingAgent, format_sse_event

router = APIRouter(prefix="/chat", tags=["Chat"])

# Session storage (in production, use Redis or similar)
sessions: dict[str, AgentContext] = {}


def convert_request_to_product_context(request: ChatRequest) -> ProductContext:
    """Convert request product context to internal ProductContext"""
    pc = request.product_context
    return ProductContext(
        product_id=pc.product_id,
        product_name=pc.product_name,
        wood_type=pc.wood_type,
        quality=pc.quality,
        dimensions=pc.dimensions,
        certifications=pc.certifications,
        origin=pc.origin,
        harvest_date=pc.harvest_date,
        supply_chain=pc.supply_chain,
        data_sources=pc.data_sources,
        semantic_model_url=pc.semantic_model_url
    )


@router.post("/message", summary="Send chat message with SSE response")
async def chat_message(request: ChatRequest):
    """
    Process a chat message and stream the response via SSE.

    The response includes various event types:
    - status: Processing status updates
    - message_chunk: Streaming text response
    - visualization: Base64 encoded chart image
    - calculation_result: Structured calculation results
    - error: Error information
    - end_stream: Completion signal
    """
    # Validate LLM configuration
    if request.llm_provider == LLMProvider.DEEPSEEK and not request.deepseek_api_key:
        raise HTTPException(
            status_code=400,
            detail="DeepSeek API-Key ist erforderlich"
        )

    # Get or create session
    session_id = request.session_id or str(uuid.uuid4())

    if session_id in sessions:
        context = sessions[session_id]
        # Update product context in case it changed
        context.product_context = convert_request_to_product_context(request)
    else:
        product_context = convert_request_to_product_context(request)
        context = AgentContext(
            session_id=session_id,
            product_context=product_context
        )
        sessions[session_id] = context

    # Get LLM instance
    try:
        llm = get_llm_for_provider(
            request.llm_provider.value,
            request.deepseek_api_key
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Create orchestrating agent
    agent = OrchestratingAgent(llm, context)

    async def event_generator():
        """Generate SSE events"""
        try:
            async for event in agent.process_message(request.message):
                yield event

            # Send completion event
            yield format_sse_event(
                {"message": "completed", "session_id": session_id},
                "end_stream"
            )
        except Exception as e:
            yield format_sse_event(
                {"error": str(e), "message": "Ein Fehler ist aufgetreten."},
                "error"
            )
        finally:
            # Cleanup
            try:
                await llm.close()
            except Exception:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*"
        }
    )


@router.post("/welcome", summary="Get welcome message for a product")
async def get_welcome(request: ChatRequest):
    """
    Get a personalized welcome message for the current product.
    Does not require LLM - uses templates.
    """
    product_context = convert_request_to_product_context(request)
    session_id = request.session_id or str(uuid.uuid4())

    context = AgentContext(
        session_id=session_id,
        product_context=product_context
    )
    sessions[session_id] = context

    # Get LLM for welcome message (use Ollama by default for welcome)
    llm = get_llm_for_provider("ollama")
    agent = OrchestratingAgent(llm, context)

    welcome_message = await agent.get_welcome_message()

    return {
        "session_id": session_id,
        "message": welcome_message
    }


@router.delete("/session/{session_id}", summary="Clear chat session")
async def clear_session(session_id: str):
    """Clear a chat session"""
    if session_id in sessions:
        del sessions[session_id]
        return {"status": "cleared", "session_id": session_id}

    raise HTTPException(status_code=404, detail="Session nicht gefunden")


@router.get("/session/{session_id}/history", summary="Get conversation history")
async def get_history(session_id: str):
    """Get conversation history for a session"""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session nicht gefunden")

    context = sessions[session_id]
    history = [
        {
            "role": entry.role,
            "content": entry.content,
            "timestamp": entry.timestamp.isoformat()
        }
        for entry in context.conversation_history
    ]

    return {"session_id": session_id, "history": history}
