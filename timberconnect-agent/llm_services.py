"""
LLM Service for TimberConnect Chat Agent

Uses DeepSeek API - users provide their own API key.
"""

from typing import Optional, AsyncGenerator
from openai import AsyncOpenAI
from config import settings


class DeepSeekLLM:
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


# Type alias for backwards compatibility with agents
BaseLLM = DeepSeekLLM


def get_llm(api_key: str) -> DeepSeekLLM:
    """
    Create DeepSeek LLM instance.

    Args:
        api_key: DeepSeek API key (required)

    Returns:
        DeepSeekLLM instance

    Raises:
        ValueError: If API key is missing
    """
    if not api_key:
        raise ValueError("DeepSeek API-Key ist erforderlich")
    return DeepSeekLLM(api_key=api_key)
