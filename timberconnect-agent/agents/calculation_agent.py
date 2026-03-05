"""
Calculation Agent for TimberConnect

Performs aggregations and metric calculations on product data.
"""

from typing import Dict, Any, List, Optional
from datetime import datetime
import re

from models.context import AgentContext
from llm_services import BaseLLM
from prompts.visualization_prompts import CALCULATION_PROMPT


class CalculationAgent:
    """Agent for calculations and metrics"""

    # Emission factors for CO2 calculation (kg CO2 per unit)
    EMISSION_FACTORS = {
        "transport_per_km": 0.1,  # kg CO2 per ton-km for truck transport
        "sawmill_per_m3": 15.0,   # kg CO2 per m³ processed at sawmill
        "bsp_per_m3": 25.0,       # kg CO2 per m³ BSP production
    }

    def __init__(self, llm: BaseLLM, context: AgentContext):
        self.llm = llm
        self.context = context

    async def calculate(self, request: str) -> Dict[str, Any]:
        """
        Perform calculation based on user request.

        Supports:
        - CO2 footprint estimation
        - Supply chain metrics (distance, time)
        - Volume aggregations
        """
        request_lower = request.lower()

        # Determine calculation type
        if any(word in request_lower for word in ["co2", "kohlenstoff", "emission", "fußabdruck"]):
            result = self._calculate_co2_footprint()
        elif any(word in request_lower for word in ["distanz", "entfernung", "km", "kilometer", "strecke"]):
            result = self._calculate_distance()
        elif any(word in request_lower for word in ["zeit", "dauer", "tage", "verarbeitungszeit"]):
            result = self._calculate_processing_time()
        elif any(word in request_lower for word in ["volumen", "m³", "kubikmeter", "menge"]):
            result = self._calculate_volume()
        else:
            # Use LLM for custom calculations
            result = await self._custom_calculation(request)

        # Store for follow-up
        self.context.store_calculation_results(result)

        # Generate natural language response
        response = self._format_response(request, result)

        return {
            "response": response,
            "calculation": result
        }

    def _calculate_co2_footprint(self) -> Dict[str, Any]:
        """Estimate CO2 footprint of the product"""
        pc = self.context.product_context
        details = []
        total_co2 = 0.0

        # Transport emissions (rough estimate)
        transport_steps = [s for s in pc.supply_chain if "transport" in s.get("stage", "").lower()]
        if transport_steps:
            # Assume average 100km per transport step, 1 ton weight
            transport_co2 = len(transport_steps) * 100 * self.EMISSION_FACTORS["transport_per_km"]
            total_co2 += transport_co2
            details.append({
                "category": "Transport",
                "value": round(transport_co2, 2),
                "unit": "kg CO2"
            })

        # Sawmill processing
        sawmill_steps = [s for s in pc.supply_chain
                        if "sägewerk" in s.get("title", "").lower() or
                        s.get("stage") == "sawmill"]
        if sawmill_steps:
            # Assume 1 m³ volume
            sawmill_co2 = self.EMISSION_FACTORS["sawmill_per_m3"]
            total_co2 += sawmill_co2
            details.append({
                "category": "Sägewerk-Verarbeitung",
                "value": round(sawmill_co2, 2),
                "unit": "kg CO2"
            })

        # BSP production
        bsp_steps = [s for s in pc.supply_chain
                    if "bsp" in s.get("title", "").lower() or
                    s.get("stage") == "manufacturer"]
        if bsp_steps:
            bsp_co2 = self.EMISSION_FACTORS["bsp_per_m3"]
            total_co2 += bsp_co2
            details.append({
                "category": "BSP-Produktion",
                "value": round(bsp_co2, 2),
                "unit": "kg CO2"
            })

        # Carbon sequestration (negative emissions for wood)
        if pc.dimensions:
            volume_m3 = self._calculate_volume_m3()
            if volume_m3 > 0:
                # Wood stores about 900 kg CO2 per m³
                sequestered = volume_m3 * 900
                details.append({
                    "category": "Gespeicherter Kohlenstoff (im Holz)",
                    "value": round(-sequestered, 2),
                    "unit": "kg CO2"
                })

        return {
            "value": round(total_co2, 2),
            "unit": "kg CO2",
            "description": "Geschätzter CO2-Fußabdruck der Lieferkette",
            "details": details,
            "note": "Dies ist eine Schätzung basierend auf Durchschnittswerten."
        }

    def _calculate_distance(self) -> Dict[str, Any]:
        """Calculate total supply chain distance"""
        pc = self.context.product_context

        # This would require actual coordinates
        # For now, estimate based on supply chain steps
        steps = len(pc.supply_chain)
        estimated_distance = steps * 80  # Assume average 80km between steps

        return {
            "value": estimated_distance,
            "unit": "km",
            "description": "Geschätzte Gesamttransportdistanz",
            "details": [
                {
                    "category": "Anzahl Transportetappen",
                    "value": max(0, steps - 1)
                },
                {
                    "category": "Durchschnittliche Distanz pro Etappe",
                    "value": 80,
                    "unit": "km"
                }
            ],
            "note": "Schätzung basierend auf der Anzahl der Lieferkettenschritte."
        }

    def _calculate_processing_time(self) -> Dict[str, Any]:
        """Calculate processing time from harvest to final product"""
        pc = self.context.product_context

        dates = []
        for step in pc.supply_chain:
            date_str = step.get("date")
            if date_str:
                try:
                    # Try different date formats
                    for fmt in ["%Y-%m-%d", "%d.%m.%Y", "%Y-%m-%dT%H:%M:%S"]:
                        try:
                            dates.append(datetime.strptime(date_str[:10], fmt))
                            break
                        except ValueError:
                            continue
                except Exception:
                    continue

        if len(dates) >= 2:
            dates.sort()
            delta = dates[-1] - dates[0]
            days = delta.days

            return {
                "value": days,
                "unit": "Tage",
                "description": "Verarbeitungszeit von Ernte bis Endprodukt",
                "details": [
                    {"category": "Startdatum", "value": dates[0].strftime("%d.%m.%Y")},
                    {"category": "Enddatum", "value": dates[-1].strftime("%d.%m.%Y")}
                ]
            }

        return {
            "value": None,
            "unit": "Tage",
            "description": "Verarbeitungszeit konnte nicht berechnet werden",
            "note": "Nicht genügend Datumsinformationen verfügbar."
        }

    def _calculate_volume(self) -> Dict[str, Any]:
        """Calculate product volume"""
        volume_m3 = self._calculate_volume_m3()

        if volume_m3 > 0:
            return {
                "value": round(volume_m3, 4),
                "unit": "m³",
                "description": "Produktvolumen",
                "details": [
                    {
                        "category": "Maße",
                        "value": f"{self.context.product_context.dimensions}"
                    }
                ]
            }

        return {
            "value": None,
            "unit": "m³",
            "description": "Volumen konnte nicht berechnet werden",
            "note": "Keine vollständigen Maßangaben verfügbar."
        }

    def _calculate_volume_m3(self) -> float:
        """Helper to calculate volume in cubic meters"""
        pc = self.context.product_context
        if not pc.dimensions:
            return 0.0

        dims = pc.dimensions
        length = dims.get("length", 0)
        width = dims.get("width", 0)
        thickness = dims.get("thickness", dims.get("height", 0))

        if length and width and thickness:
            # Assume dimensions are in mm, convert to m
            return (length / 1000) * (width / 1000) * (thickness / 1000)

        return 0.0

    async def _custom_calculation(self, request: str) -> Dict[str, Any]:
        """Use LLM for custom calculations"""
        # For now, return a generic response
        return {
            "value": None,
            "unit": "",
            "description": "Benutzerdefinierte Berechnung",
            "note": f"Die angeforderte Berechnung '{request}' konnte nicht automatisch durchgeführt werden."
        }

    def _format_response(self, request: str, result: Dict[str, Any]) -> str:
        """Format calculation result as natural language"""
        if result.get("value") is None:
            return result.get("note", "Die Berechnung konnte nicht durchgeführt werden.")

        response_parts = []

        # Main result
        value = result["value"]
        unit = result.get("unit", "")
        description = result.get("description", "Ergebnis")

        response_parts.append(f"{description}: **{value} {unit}**")

        # Details
        if result.get("details"):
            response_parts.append("\n**Aufschlüsselung:**")
            for detail in result["details"]:
                cat = detail.get("category", "")
                val = detail.get("value", "")
                detail_unit = detail.get("unit", "")
                response_parts.append(f"- {cat}: {val} {detail_unit}".strip())

        # Note
        if result.get("note"):
            response_parts.append(f"\n*Hinweis: {result['note']}*")

        return "\n".join(response_parts)
