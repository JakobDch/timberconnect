"""
Visualization Prompts for TimberConnect Chat Agent

Prompts for chart generation and TimberConnect color palette.
"""

# TimberConnect color palette
TC_COLORS = {
    'forest': '#2D5A27',       # Forest green (primary)
    'forest_light': '#4A8B3D', # Light forest green
    'timber': '#8B4513',       # Timber brown
    'timber_light': '#A0522D', # Light timber
    'copper': '#B87333',       # Copper accent
    'bark': '#4A3728',         # Bark brown
    'leaf': '#90EE90',         # Light green
    'earth': '#654321',        # Earth brown
    'background': '#F5F5DC',   # Beige background
    'text': '#333333',         # Dark text
}

VISUALIZATION_CODE_PROMPT = """Du bist ein Python-Visualisierungs-Experte für das TimberConnect-System.

VERFÜGBARE DATEN:
Variablen: {variables}
Beispieldaten (erste 5 Einträge):
{sample_data}

BENUTZERANFRAGE: {user_query}

TIMBERCONNECT FARBPALETTE:
- Waldgrün (primary): #2D5A27
- Helles Waldgrün: #4A8B3D
- Holzbraun: #8B4513
- Kupfer (Akzent): #B87333
- Rindenbraun: #4A3728

ANFORDERUNGEN:
1. Verwende NUR matplotlib (import matplotlib.pyplot as plt)
2. Die Daten sind als Liste von Dictionaries in der Variable 'data' verfügbar
3. KEINE print-Statements
4. KEINE plt.show() - das Bild wird automatisch gespeichert
5. Verwende die TimberConnect-Farbpalette
6. Setze einen deutschen Titel
7. Beschrifte Achsen auf Deutsch
8. Verwende plt.tight_layout() am Ende

BEISPIEL-CODE-STRUKTUR:
```python
import matplotlib.pyplot as plt

# TimberConnect Farben
forest_green = '#2D5A27'
timber_brown = '#8B4513'

# Daten vorbereiten
labels = [d.get('station', 'Unbekannt') for d in data]
values = [d.get('value', 0) for d in data]

# Chart erstellen
fig, ax = plt.subplots(figsize=(10, 6))
ax.bar(labels, values, color=forest_green)

ax.set_title('Titel auf Deutsch', fontsize=14, fontweight='bold')
ax.set_xlabel('X-Achse', fontsize=12)
ax.set_ylabel('Y-Achse', fontsize=12)

plt.tight_layout()
```

Generiere NUR den Python-Code ohne Erklärungen:"""

CALCULATION_PROMPT = """Du bist ein Berechnungs-Experte für das TimberConnect-System.

VERFÜGBARE DATEN:
{data_summary}

BENUTZERANFRAGE: {user_query}

MÖGLICHE BERECHNUNGEN:
- CO2-Fußabdruck: ca. 0.5 kg CO2 pro km Transport
- Transportdistanz: Summe aller Etappen
- Verarbeitungszeit: Differenz zwischen Ernte- und Produktionsdatum
- Volumenaggregation: Summe der Volumina
- Effizienz: Verhältnis Output/Input

Erstelle einen Python-Code der:
1. Die Berechnung durchführt
2. Ein Dictionary namens 'result' erstellt mit:
   - 'value': Der berechnete Wert
   - 'unit': Die Einheit (z.B. "kg CO2", "km", "Tage")
   - 'description': Kurze deutsche Beschreibung
   - 'details': Optionale Aufschlüsselung als Liste

Die Daten sind in der Variable 'data' als Liste von Dictionaries verfügbar.

Python-Code:"""

SUPPLY_CHAIN_VISUALIZATION_PROMPT = """Erstelle eine Visualisierung der Lieferkette als Timeline.

LIEFERKETTENDATEN:
{supply_chain_data}

Der Code soll:
1. Eine horizontale Timeline erstellen
2. Jeden Schritt als Knoten darstellen
3. Verbindungslinien zwischen den Schritten
4. Station, Firma und Datum anzeigen
5. TimberConnect-Farben verwenden
6. Icons oder Symbole für jeden Stationstyp (Wald, Transport, Sägewerk, BSP-Werk)

Generiere den matplotlib Python-Code:"""
