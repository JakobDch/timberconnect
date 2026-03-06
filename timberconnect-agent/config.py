"""
Configuration for TimberConnect Chat Agent

Uses DeepSeek API - users provide their own API key.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    # DeepSeek API Configuration (user provides key via frontend)
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"

    # SPARQL/Query settings
    sparql_timeout: int = 30

    # Agent settings
    max_conversation_history: int = 20

    class Config:
        env_prefix = "TC_AGENT_"


settings = Settings()
