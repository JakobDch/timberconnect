"""
TimberConnect Chat Agent API

FastAPI application providing intelligent chat capabilities
for wood product traceability queries.

Supports:
- Ollama (free, local Llama3.3)
- DeepSeek API (user provides key)

Features:
- Multi-agent architecture (SPARQL, Calculation, Visualization)
- SSE streaming for real-time responses
- German language support
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from routers import chat_router, health_router
from config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    print("TimberConnect Chat Agent starting...")
    print(f"DeepSeek API URL: {settings.deepseek_base_url}")
    print(f"DeepSeek Model: {settings.deepseek_model}")
    yield
    # Shutdown
    print("TimberConnect Chat Agent shutting down...")


app = FastAPI(
    title="TimberConnect Chat Agent",
    description="""
    KI-gestützter Chat-Assistent für Holzprodukt-Rückverfolgbarkeit.

    ## Features

    - **Datenabfragen**: Fragen zu Produktdaten aus Solid Pods
    - **Berechnungen**: CO2-Fußabdruck, Transportdistanzen, Metriken
    - **Visualisierungen**: Lieferketten-Diagramme, Charts
    - **Konversation**: Natürliche Gespräche auf Deutsch

    ## LLM-Unterstützung

    - **Ollama**: Kostenlos, lokal (Llama3.3)
    - **DeepSeek**: API mit eigenem Key
    """,
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health_router, prefix="/api")
app.include_router(chat_router, prefix="/api")


@app.get("/")
async def root():
    """Root endpoint with service info"""
    return {
        "service": "TimberConnect Chat Agent",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/api/health"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
