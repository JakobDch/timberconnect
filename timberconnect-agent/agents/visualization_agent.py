"""
Visualization Agent for TimberConnect

Generates charts and graphs using matplotlib.
"""

from typing import Dict, Any, List, Optional
import base64
import io

from models.context import AgentContext
from llm_services import BaseLLM
from prompts.visualization_prompts import TC_COLORS, VISUALIZATION_CODE_PROMPT


class VisualizationAgent:
    """Agent for generating visualizations"""

    def __init__(self, llm: BaseLLM, context: AgentContext):
        self.llm = llm
        self.context = context

    async def create_visualization(self, request: str) -> Dict[str, Any]:
        """
        Create a visualization based on user request.

        Supports:
        - Supply chain timeline
        - Bar charts for metrics
        - Pie charts for distribution
        """
        request_lower = request.lower()

        # Determine chart type based on request
        if any(word in request_lower for word in ["lieferkette", "timeline", "zeitstrahl", "ablauf"]):
            return await self._create_supply_chain_chart()
        elif any(word in request_lower for word in ["balken", "bar"]):
            return await self._create_bar_chart(request)
        elif any(word in request_lower for word in ["kreis", "pie", "torte", "verteilung"]):
            return await self._create_pie_chart(request)
        else:
            # Default to supply chain visualization
            return await self._create_supply_chain_chart()

    async def _create_supply_chain_chart(self) -> Dict[str, Any]:
        """Create supply chain timeline visualization"""
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        import matplotlib.patches as mpatches

        pc = self.context.product_context
        supply_chain = pc.supply_chain

        if not supply_chain:
            return {
                "response": "Keine Lieferkettendaten für die Visualisierung verfügbar.",
                "image_base64": None,
                "chart_type": "supply_chain"
            }

        # Create figure
        fig, ax = plt.subplots(figsize=(12, 6))

        # Colors for different stages
        stage_colors = {
            "forest": TC_COLORS["forest"],
            "forst": TC_COLORS["forest"],
            "forstwirtschaft": TC_COLORS["forest"],
            "transport": TC_COLORS["copper"],
            "logistik": TC_COLORS["copper"],
            "sawmill": TC_COLORS["timber"],
            "sägewerk": TC_COLORS["timber"],
            "manufacturer": TC_COLORS["bark"],
            "verarbeitung": TC_COLORS["bark"],
            "bspwerk": TC_COLORS["bark"],
            "construction": TC_COLORS["forest_light"],
            "verbau": TC_COLORS["forest_light"],
        }

        # Plot timeline
        y_pos = 0.5
        x_positions = []
        labels = []

        for i, step in enumerate(supply_chain):
            x = i * 2
            x_positions.append(x)

            stage = step.get("stage", step.get("title", "")).lower()
            color = stage_colors.get(stage, TC_COLORS["timber"])

            # Draw circle for each step
            circle = plt.Circle((x, y_pos), 0.3, color=color, zorder=3)
            ax.add_patch(circle)

            # Draw connecting line
            if i > 0:
                ax.plot([x_positions[i-1], x], [y_pos, y_pos],
                       color=TC_COLORS["text"], linewidth=2, zorder=1)

            # Add label below
            title = step.get("title", step.get("stage", f"Schritt {i+1}"))
            company = step.get("company", step.get("name", ""))
            date = step.get("date", "")

            label_text = f"{title}"
            if company:
                label_text += f"\n{company}"
            if date:
                # Format date if possible
                if "T" in date:
                    date = date.split("T")[0]
                if "-" in date:
                    parts = date.split("-")
                    if len(parts) == 3:
                        date = f"{parts[2]}.{parts[1]}.{parts[0]}"
                label_text += f"\n{date}"

            ax.text(x, y_pos - 0.6, label_text,
                   ha='center', va='top', fontsize=9,
                   color=TC_COLORS["text"])

        # Set axis limits and remove axes
        if x_positions:
            ax.set_xlim(-1, max(x_positions) + 1)
        ax.set_ylim(-0.5, 1.5)
        ax.set_aspect('equal')
        ax.axis('off')

        # Title
        ax.set_title(f'Lieferkette: {pc.product_name}',
                    fontsize=14, fontweight='bold', color=TC_COLORS["text"],
                    pad=20)

        plt.tight_layout()

        # Save to base64
        buffer = io.BytesIO()
        plt.savefig(buffer, format='png', dpi=150, bbox_inches='tight',
                   facecolor='white', edgecolor='none')
        buffer.seek(0)
        image_base64 = base64.b64encode(buffer.read()).decode('utf-8')
        plt.close()

        return {
            "response": f"Hier ist die Visualisierung der Lieferkette für {pc.product_name}:",
            "image_base64": image_base64,
            "chart_type": "supply_chain"
        }

    async def _create_bar_chart(self, request: str) -> Dict[str, Any]:
        """Create a bar chart based on available data"""
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt

        pc = self.context.product_context

        # Default: Create bar chart of supply chain stages
        stages = []
        values = []

        for i, step in enumerate(pc.supply_chain):
            title = step.get("title", step.get("stage", f"Schritt {i+1}"))
            stages.append(title)
            values.append(i + 1)  # Just sequential values for demo

        if not stages:
            return {
                "response": "Keine Daten für ein Balkendiagramm verfügbar.",
                "image_base64": None,
                "chart_type": "bar"
            }

        # Create figure
        fig, ax = plt.subplots(figsize=(10, 6))

        bars = ax.bar(stages, values, color=TC_COLORS["forest"])

        ax.set_xlabel('Station', fontsize=12, color=TC_COLORS["text"])
        ax.set_ylabel('Wert', fontsize=12, color=TC_COLORS["text"])
        ax.set_title(f'Übersicht: {pc.product_name}',
                    fontsize=14, fontweight='bold', color=TC_COLORS["text"])

        # Rotate x labels if needed
        if len(stages) > 3:
            plt.xticks(rotation=45, ha='right')

        plt.tight_layout()

        # Save to base64
        buffer = io.BytesIO()
        plt.savefig(buffer, format='png', dpi=150, bbox_inches='tight',
                   facecolor='white', edgecolor='none')
        buffer.seek(0)
        image_base64 = base64.b64encode(buffer.read()).decode('utf-8')
        plt.close()

        return {
            "response": "Hier ist das Balkendiagramm:",
            "image_base64": image_base64,
            "chart_type": "bar"
        }

    async def _create_pie_chart(self, request: str) -> Dict[str, Any]:
        """Create a pie chart based on available data"""
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt

        pc = self.context.product_context

        # Example: Show distribution of supply chain stages
        stage_types = {}
        for step in pc.supply_chain:
            stage = step.get("stage", step.get("title", "Sonstige"))
            stage_types[stage] = stage_types.get(stage, 0) + 1

        if not stage_types:
            return {
                "response": "Keine Daten für ein Kreisdiagramm verfügbar.",
                "image_base64": None,
                "chart_type": "pie"
            }

        # Create figure
        fig, ax = plt.subplots(figsize=(8, 8))

        colors = [
            TC_COLORS["forest"],
            TC_COLORS["timber"],
            TC_COLORS["copper"],
            TC_COLORS["bark"],
            TC_COLORS["forest_light"]
        ]

        labels = list(stage_types.keys())
        sizes = list(stage_types.values())

        ax.pie(sizes, labels=labels, colors=colors[:len(labels)],
               autopct='%1.1f%%', startangle=90)
        ax.axis('equal')

        ax.set_title(f'Verteilung der Lieferkettenschritte: {pc.product_name}',
                    fontsize=14, fontweight='bold', color=TC_COLORS["text"])

        plt.tight_layout()

        # Save to base64
        buffer = io.BytesIO()
        plt.savefig(buffer, format='png', dpi=150, bbox_inches='tight',
                   facecolor='white', edgecolor='none')
        buffer.seek(0)
        image_base64 = base64.b64encode(buffer.read()).decode('utf-8')
        plt.close()

        return {
            "response": "Hier ist das Kreisdiagramm:",
            "image_base64": image_base64,
            "chart_type": "pie"
        }
