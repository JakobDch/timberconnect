"""
Orchestrating Agent for TimberConnect

Main agent that routes user queries to appropriate sub-agents.
All internal steps are hidden from the user - only natural responses are shown.
"""

from enum import Enum
from typing import AsyncGenerator, Optional, Dict, Any
import json

from models.context import AgentContext, ProductContext
from llm_services import BaseLLM
from prompts.orchestrator_prompts import (
    SYSTEM_PROMPT,
    INTENT_CLASSIFICATION_PROMPT,
    RESPONSE_GENERATION_PROMPT,
    WELCOME_MESSAGE,
    FOLLOW_UP_RESPONSE_PROMPT
)
from agents.sparql_agent import SPARQLAgent
from agents.calculation_agent import CalculationAgent
from agents.visualization_agent import VisualizationAgent


class AgentIntent(Enum):
    """User intent classification"""
    DATA_QUERY = "DATA_QUERY"          # Questions about product data
    CALCULATION = "CALCULATION"         # Aggregations, metrics
    VISUALIZATION = "VISUALIZATION"     # Charts, graphs
    GENERAL_INFO = "GENERAL_INFO"       # General product info
    FOLLOW_UP = "FOLLOW_UP"             # Follow-up to previous answer


def format_sse_event(data: Dict[str, Any], event_type: str) -> str:
    """Format data as Server-Sent Event"""
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


class OrchestratingAgent:
    """
    Main orchestrating agent for TimberConnect chat.

    Routes user queries to specialized sub-agents:
    - SPARQL Agent for data queries
    - Calculation Agent for metrics
    - Visualization Agent for charts

    Key design principle: Hide all internal processing from the user.
    Only stream natural, conversational responses.
    """

    def __init__(self, llm: BaseLLM, context: AgentContext):
        self.llm = llm
        self.context = context
        self.sparql_agent = SPARQLAgent(llm, context)
        self.calculation_agent = CalculationAgent(llm, context)
        self.visualization_agent = VisualizationAgent(llm, context)

    async def process_message(
        self,
        user_message: str
    ) -> AsyncGenerator[str, None]:
        """
        Process user message and stream response via SSE events.

        All internal agent steps are hidden - only natural responses shown.
        """
        # Add user message to history
        self.context.add_user_message(user_message)

        # Send status update (frontend can show typing indicator)
        yield format_sse_event(
            {"status": "processing", "message": "Verarbeite Ihre Anfrage..."},
            "status"
        )

        try:
            # Classify intent
            intent = await self._classify_intent(user_message)

            # Route to appropriate handler
            if intent == AgentIntent.DATA_QUERY:
                async for event in self._handle_data_query(user_message):
                    yield event
            elif intent == AgentIntent.CALCULATION:
                async for event in self._handle_calculation(user_message):
                    yield event
            elif intent == AgentIntent.VISUALIZATION:
                async for event in self._handle_visualization(user_message):
                    yield event
            elif intent == AgentIntent.FOLLOW_UP:
                async for event in self._handle_follow_up(user_message):
                    yield event
            else:  # GENERAL_INFO
                async for event in self._handle_general_info(user_message):
                    yield event

        except Exception as e:
            # Send error event with detailed message
            import traceback
            error_detail = f"{type(e).__name__}: {str(e)}"
            print(f"Agent error: {error_detail}")
            print(traceback.format_exc())
            yield format_sse_event(
                {"error": error_detail, "message": f"Fehler: {error_detail}"},
                "error"
            )

    async def _classify_intent(self, user_message: str) -> AgentIntent:
        """Classify user intent using LLM"""
        pc = self.context.product_context

        # Build conversation context
        conversation_context = ""
        recent_history = self.context.conversation_history[-4:]
        for entry in recent_history:
            role = "Benutzer" if entry.role == "user" else "Assistent"
            conversation_context += f"{role}: {entry.content[:200]}...\n"

        prompt = INTENT_CLASSIFICATION_PROMPT.format(
            product_id=pc.product_id,
            product_name=pc.product_name,
            wood_type=pc.wood_type,
            supply_chain_summary=pc.get_supply_chain_summary()[:500],
            data_sources_count=len(pc.data_sources),
            has_previous_results="Ja" if self.context.has_previous_results() else "Nein",
            user_query=user_message,
            conversation_context=conversation_context
        )

        response = await self.llm.generate(prompt)
        response = response.strip().upper()

        # Parse intent
        for intent in AgentIntent:
            if intent.value in response:
                return intent

        # Default to general info
        return AgentIntent.GENERAL_INFO

    async def _handle_data_query(
        self,
        user_message: str
    ) -> AsyncGenerator[str, None]:
        """Handle data query using SPARQL agent"""
        # Execute SPARQL query (hidden from user)
        result = await self.sparql_agent.answer_question(user_message)

        response = result["response"]

        # Stream the response
        async for event in self._stream_response(response):
            yield event

        # Add to conversation history
        self.context.add_assistant_message(response, {"intent": "DATA_QUERY"})

    async def _handle_calculation(
        self,
        user_message: str
    ) -> AsyncGenerator[str, None]:
        """Handle calculation request"""
        result = await self.calculation_agent.calculate(user_message)

        response = result["response"]

        # Stream the response
        async for event in self._stream_response(response):
            yield event

        # If there's detailed calculation data, send it
        if result.get("calculation"):
            yield format_sse_event(result["calculation"], "calculation_result")

        # Add to conversation history
        self.context.add_assistant_message(response, {"intent": "CALCULATION"})

    async def _handle_visualization(
        self,
        user_message: str
    ) -> AsyncGenerator[str, None]:
        """Handle visualization request"""
        result = await self.visualization_agent.create_visualization(user_message)

        response = result["response"]

        # Stream the text response first
        async for event in self._stream_response(response):
            yield event

        # Then send the image
        if result.get("image_base64"):
            yield format_sse_event({
                "image_base64": result["image_base64"],
                "chart_type": result.get("chart_type", "chart")
            }, "visualization")

        # Add to conversation history
        self.context.add_assistant_message(response, {
            "intent": "VISUALIZATION",
            "has_image": result.get("image_base64") is not None
        })

    async def _handle_general_info(
        self,
        user_message: str
    ) -> AsyncGenerator[str, None]:
        """Handle general information request using LLM"""
        pc = self.context.product_context

        system_prompt = SYSTEM_PROMPT.format(
            product_summary=pc.get_summary(),
            supply_chain_summary=pc.get_supply_chain_summary()
        )

        # Generate response using LLM with streaming
        async for chunk in self.llm.generate_stream(user_message, system_prompt):
            yield format_sse_event({"content": chunk}, "message_chunk")

        # Get full response for history (generate again without streaming)
        full_response = await self.llm.generate(user_message, system_prompt)
        self.context.add_assistant_message(full_response, {"intent": "GENERAL_INFO"})

    async def _handle_follow_up(
        self,
        user_message: str
    ) -> AsyncGenerator[str, None]:
        """Handle follow-up question based on previous results"""
        pc = self.context.product_context

        # Build context from previous results
        previous_context = ""
        if self.context.last_sparql_results:
            previous_context = f"Vorherige SPARQL-Ergebnisse:\n{str(self.context.last_sparql_results[:5])}"
        if self.context.last_calculation_results:
            previous_context += f"\nVorherige Berechnung:\n{str(self.context.last_calculation_results)}"

        prompt = FOLLOW_UP_RESPONSE_PROMPT.format(
            product_summary=pc.get_summary(),
            previous_context=previous_context,
            user_query=user_message
        )

        # Stream response
        async for chunk in self.llm.generate_stream(prompt):
            yield format_sse_event({"content": chunk}, "message_chunk")

        # Get full response for history
        full_response = await self.llm.generate(prompt)
        self.context.add_assistant_message(full_response, {"intent": "FOLLOW_UP"})

    async def _stream_response(
        self,
        response: str
    ) -> AsyncGenerator[str, None]:
        """Stream a pre-generated response in chunks"""
        # Split into sentences for more natural streaming
        import re
        sentences = re.split(r'(?<=[.!?])\s+', response)

        for sentence in sentences:
            if sentence:
                yield format_sse_event({"content": sentence + " "}, "message_chunk")
                # Small delay could be added here for more natural feel

    async def get_welcome_message(self) -> str:
        """Get personalized welcome message"""
        pc = self.context.product_context
        return f"""Willkommen! Ich bin Ihr TimberConnect Assistent.

Ich sehe, Sie betrachten gerade **{pc.product_name}** ({pc.product_id}).

Dieses {pc.wood_type}-Produkt hat {len(pc.supply_chain)} Stationen in der Lieferkette durchlaufen.

Ich kann Ihnen bei folgenden Fragen helfen:
- Woher stammt das Holz? (Herkunft und Zertifikate)
- Welche Stationen hat es durchlaufen? (Lieferkette)
- Wie sind die technischen Eigenschaften? (Maße, Qualität)
- Berechnungen (CO2-Fußabdruck, Transportdistanz)
- Visualisierungen (Lieferketten-Diagramm)

Stellen Sie mir gerne eine Frage!"""

    async def close(self):
        """Close all sub-agent resources"""
        await self.sparql_agent.close()
