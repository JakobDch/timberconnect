"""
Configuration for TimberConnect Chat Agent

Supports both Ollama (free, local) and DeepSeek API.
"""

from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    # Ollama Configuration (free Llama3.3)
    ollama_base_url: str = "http://132.195.160.35:11434"
    ollama_model: str = "llama3.3"

    # DeepSeek API Configuration (user provides key)
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"

    # Default LLM provider
    default_llm_provider: str = "ollama"

    # SPARQL/Query settings
    sparql_timeout: int = 30

    # Agent settings
    max_conversation_history: int = 20

    class Config:
        env_prefix = "TC_AGENT_"


settings = Settings()
