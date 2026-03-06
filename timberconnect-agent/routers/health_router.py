"""
Health Router for TimberConnect Chat Agent

Provides health check endpoints.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict, Any

from config import settings

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    service: str
    version: str


class LLMStatusResponse(BaseModel):
    """LLM provider status response"""
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
    return LLMStatusResponse(
        deepseek={
            "available": True,
            "note": "Requires user API key",
            "model": settings.deepseek_model
        }
    )
