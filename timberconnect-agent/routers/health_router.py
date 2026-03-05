"""
Health Router for TimberConnect Chat Agent

Provides health check endpoints.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict, Any

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    service: str
    version: str


class LLMStatusResponse(BaseModel):
    """LLM provider status response"""
    ollama: Dict[str, Any]
    deepseek: Dict[str, Any]


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Basic health check endpoint"""
    return HealthResponse(
        status="healthy",
        service="timberconnect-agent",
        version="1.0.0"
    )


@router.get("/health/llm", response_model=LLMStatusResponse)
async def llm_status():
    """Check LLM provider availability"""
    import httpx
    from config import settings

    ollama_status = {"available": False, "model": settings.ollama_model}
    deepseek_status = {"available": True, "note": "Requires API key"}

    # Check Ollama availability
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{settings.ollama_base_url}/api/tags")
            if response.status_code == 200:
                ollama_status["available"] = True
                data = response.json()
                models = [m["name"] for m in data.get("models", [])]
                ollama_status["models"] = models
    except Exception as e:
        ollama_status["error"] = str(e)

    return LLMStatusResponse(
        ollama=ollama_status,
        deepseek=deepseek_status
    )
