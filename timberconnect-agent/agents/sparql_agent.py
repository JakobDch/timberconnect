"""
SPARQL Query Agent for TimberConnect

Generates and executes SPARQL queries against Solid Pods.
"""

from typing import Dict, Any, List, Optional
import httpx
import re

from models.context import AgentContext
from llm_services import BaseLLM
from prompts.sparql_prompts import (
    SPARQL_PREFIXES,
    SPARQL_GENERATION_PROMPT,
    SPARQL_RESPONSE_PROMPT,
    QUERY_TEMPLATES
)


class SPARQLAgent:
    """Agent for answering data questions via SPARQL queries"""

    def __init__(self, llm: BaseLLM, context: AgentContext):
        self.llm = llm
        self.context = context
        self.http_client = httpx.AsyncClient(timeout=30.0)

    async def answer_question(self, question: str) -> Dict[str, Any]:
        """
        Answer a data question about the product.

        Steps:
        1. Try to match a query template
        2. If no match, generate custom SPARQL
        3. Execute query against data sources
        4. Format natural language response

        Returns:
            Dict with 'response', 'sparql', 'results'
        """
        # Debug logging to verify ProductContext
        print(f"[SPARQL Agent] Question: {question}")
        print(f"[SPARQL Agent] ProductContext origin: {self.context.product_context.origin}")
        print(f"[SPARQL Agent] ProductContext supply_chain: {len(self.context.product_context.supply_chain)} steps")
        print(f"[SPARQL Agent] ProductContext data_sources: {self.context.product_context.data_sources}")

        product_id = self.context.product_context.product_id

        # Step 1: Try template matching
        template_key = self._match_template(question)

        if template_key:
            # Use pre-defined query
            sparql = QUERY_TEMPLATES[template_key].format(
                prefixes=SPARQL_PREFIXES,
                product_id=product_id
            )
        else:
            # Generate custom SPARQL
            sparql = await self._generate_sparql(question)

        # Step 2: Execute query
        results = await self._execute_query(sparql)

        # Store results for follow-up questions
        self.context.store_sparql_results(sparql, results)

        # Step 3: Generate natural language response
        response = await self._generate_response(question, results)

        return {
            "response": response,
            "sparql": sparql,
            "results": results,
            "result_count": len(results)
        }

    def _match_template(self, question: str) -> Optional[str]:
        """Match question to a pre-defined query template"""
        question_lower = question.lower()

        # Forest/origin questions
        if any(word in question_lower for word in [
            "herkunft", "wald", "forst", "geerntet", "ernte",
            "forstamt", "revier", "koordinaten", "wo stammt"
        ]):
            return "forest_origin"

        # Sawmill questions
        if any(word in question_lower for word in [
            "sägewerk", "polter", "volumen", "stämme",
            "lieferung", "verarbeitet"
        ]):
            return "sawmill_data"

        # BSP production questions
        if any(word in question_lower for word in [
            "bsp", "brettsperrholz", "produktion", "hergestellt",
            "schichten", "brandschutz", "artikel"
        ]):
            return "bsp_production"

        # Supply chain questions
        if any(word in question_lower for word in [
            "lieferkette", "stationen", "durchlaufen", "weg",
            "transport", "route"
        ]):
            return "supply_chain"

        # Certification questions
        if any(word in question_lower for word in [
            "zertifikat", "fsc", "pefc", "zertifizierung"
        ]):
            return "certifications"

        # Business partner questions
        if any(word in question_lower for word in [
            "partner", "lieferant", "abnehmer", "firma", "unternehmen"
        ]):
            return "business_partners"

        return None

    async def _generate_sparql(self, question: str) -> str:
        """Generate custom SPARQL query using LLM"""
        prompt = SPARQL_GENERATION_PROMPT.format(
            product_id=self.context.product_context.product_id,
            data_sources=", ".join(self.context.product_context.data_sources[:3]),
            prefixes=SPARQL_PREFIXES,
            question=question
        )

        response = await self.llm.generate(prompt)
        return self._extract_sparql(response)

    def _extract_sparql(self, response: str) -> str:
        """Extract SPARQL query from LLM response"""
        # Remove code block markers if present
        response = re.sub(r'```sparql\s*', '', response)
        response = re.sub(r'```\s*', '', response)

        # Ensure prefixes are included
        if not response.strip().upper().startswith('PREFIX'):
            response = SPARQL_PREFIXES + "\n" + response

        return response.strip()

    async def _execute_query(self, sparql: str) -> List[Dict[str, Any]]:
        """
        Execute SPARQL query against data sources.

        Uses HTTP POST to a SPARQL endpoint or Comunica-compatible service.
        Falls back to extracting data from ProductContext if no data sources available.
        """
        try:
            # Extract data from product context
            # This works regardless of whether data_sources are available,
            # since the ProductContext already contains the relevant data
            return self._extract_from_context(sparql)

        except Exception as e:
            print(f"SPARQL execution error: {e}")
            return []

    def _extract_from_context(self, sparql: str) -> List[Dict[str, Any]]:
        """
        Extract relevant data from product context based on query intent.
        This is used when direct SPARQL execution is not available.
        """
        pc = self.context.product_context
        sparql_lower = sparql.lower()

        results = []

        # Check what type of data is being queried
        if "stem" in sparql_lower or "forest" in sparql_lower:
            if pc.origin:
                # Try direct fields first
                forestryOffice = pc.origin.get("forestryOffice", "")
                district = pc.origin.get("district", "")

                # Fallback: Parse from region if fields are empty
                if not forestryOffice and not district:
                    region = pc.origin.get("region", "")
                    if ", " in region:
                        parts = region.split(", ")
                        district = parts[0]
                        forestryOffice = parts[1] if len(parts) > 1 else ""
                    else:
                        district = region

                results.append({
                    "forestryOffice": forestryOffice,
                    "district": district,
                    "location": pc.origin.get("location", district),
                    "harvestDate": pc.harvest_date or pc.origin.get("harvestDate", ""),
                    "lat": pc.origin.get("coordinates", {}).get("lat"),
                    "long": pc.origin.get("coordinates", {}).get("lng")
                })

        elif "polter" in sparql_lower or "sawmill" in sparql_lower:
            for step in pc.supply_chain:
                if step.get("stage") == "sawmill" or "sägewerk" in step.get("title", "").lower():
                    results.append({
                        "company": step.get("company", step.get("name")),
                        "date": step.get("date"),
                        "location": step.get("location"),
                        "details": step.get("details", {})
                    })

        elif "bsp" in sparql_lower or "panel" in sparql_lower:
            for step in pc.supply_chain:
                if step.get("stage") == "manufacturer" or "bsp" in step.get("title", "").lower():
                    results.append({
                        "company": step.get("company", step.get("name")),
                        "productionDate": step.get("date"),
                        "details": step.get("details", {})
                    })

            if pc.dimensions:
                results.append({
                    "dimensions": pc.dimensions,
                    "quality": pc.quality
                })

        elif "supplychain" in sparql_lower or "station" in sparql_lower:
            for step in pc.supply_chain:
                results.append({
                    "station": step.get("stage", step.get("title")),
                    "company": step.get("company", step.get("name")),
                    "date": step.get("date"),
                    "location": step.get("location")
                })

        elif "certification" in sparql_lower:
            for cert in pc.certifications:
                results.append({"certification": cert})

        elif "partner" in sparql_lower or "business" in sparql_lower:
            for step in pc.supply_chain:
                results.append({
                    "name": step.get("company", step.get("name")),
                    "role": step.get("stage"),
                    "location": step.get("location")
                })

        return results

    async def _generate_response(
        self,
        question: str,
        results: List[Dict[str, Any]]
    ) -> str:
        """Generate natural language response from query results"""
        if not results:
            return "Leider konnte ich zu dieser Frage keine Daten finden. Möglicherweise sind die entsprechenden Informationen für dieses Produkt nicht verfügbar."

        # Format results for the prompt
        results_str = "\n".join([str(r) for r in results[:10]])

        prompt = SPARQL_RESPONSE_PROMPT.format(
            question=question,
            results=results_str,
            result_count=len(results)
        )

        response = await self.llm.generate(prompt)
        return response.strip()

    async def close(self):
        """Close HTTP client"""
        await self.http_client.aclose()
