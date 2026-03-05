"""
LLM Service Abstraction for TimberConnect Chat Agent

Provides unified interface for Ollama and DeepSeek LLMs.
"""

from abc import ABC, abstractmethod
from typing import Optional, AsyncGenerator
import httpx
from openai import AsyncOpenAI
from config import settings


class BaseLLM(ABC):
    """Abstract base class for LLM providers"""

    @abstractmethod
    async def generate(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Generate a response for the given prompt"""
        pass

    @abstractmethod
    async def generate_stream(
        self,
        prompt: str,
        system_prompt: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """Stream a response for the given prompt"""
        pass


class OllamaLLM(BaseLLM):
    """Ollama LLM client for local Llama3.3"""

    def __init__(
        self,
        base_url: str = settings.ollama_base_url,
        model: str = settings.ollama_model
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.client = httpx.AsyncClient(timeout=120.0)

    async def generate(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Generate a complete response"""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        response = await self.client.post(
            f"{self.base_url}/api/chat",
            json={
                "model": self.model,
                "messages": messages,
                "stream": False
            }
        )
        response.raise_for_status()
        data = response.json()
        return data.get("message", {}).get("content", "")

    async def generate_stream(
        self,
        prompt: str,
        system_prompt: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """Stream response chunks"""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        async with self.client.stream(
            "POST",
            f"{self.base_url}/api/chat",
            json={
                "model": self.model,
                "messages": messages,
                "stream": True
            }
        ) as response:
            async for line in response.aiter_lines():
                if line:
                    import json
                    try:
                        data = json.loads(line)
                        content = data.get("message", {}).get("content", "")
                        if content:
                            yield content
                    except json.JSONDecodeError:
                        continue

    async def close(self):
        """Close the HTTP client"""
        await self.client.aclose()


class DeepSeekLLM(BaseLLM):
    """DeepSeek LLM client using OpenAI-compatible API"""

    def __init__(
        self,
        api_key: str,
        base_url: str = settings.deepseek_base_url,
        model: str = settings.deepseek_model
    ):
        self.model = model
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url
        )

    async def generate(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Generate a complete response"""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            stream=False
        )
        return response.choices[0].message.content or ""

    async def generate_stream(
        self,
        prompt: str,
        system_prompt: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """Stream response chunks"""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        stream = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            stream=True
        )

        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def close(self):
        """Close the client"""
        await self.client.close()


def get_llm_for_provider(
    provider: str,
    api_key: Optional[str] = None
) -> BaseLLM:
    """
    Factory function to get LLM instance for the specified provider.

    Args:
        provider: Either "ollama" or "deepseek"
        api_key: Required for DeepSeek provider

    Returns:
        LLM instance

    Raises:
        ValueError: If provider is invalid or API key is missing for DeepSeek
    """
    if provider == "ollama":
        return OllamaLLM()
    elif provider == "deepseek":
        if not api_key:
            raise ValueError("DeepSeek API-Key ist erforderlich")
        return DeepSeekLLM(api_key=api_key)
    else:
        raise ValueError(f"Unbekannter LLM-Provider: {provider}")
