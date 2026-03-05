"""
SPARQL Prompts for TimberConnect Chat Agent

Prompts for SPARQL query generation and result interpretation.
"""

SPARQL_PREFIXES = """PREFIX tc: <http://timberconnect.2050.de/ontology#>
PREFIX tcr: <http://timberconnect.2050.de/resource/>
PREFIX eldat: <http://timberconnect.2050.de/ontology/eldat#>
PREFIX vlex: <http://timberconnect.2050.de/ontology/vlex#>
PREFIX geo: <http://www.w3.org/2003/01/geo/wgs84_pos#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
"""

SPARQL_GENERATION_PROMPT = """Du bist ein SPARQL-Experte für das TimberConnect-System.

PRODUKTKONTEXT:
- Produkt-ID (traceId): {product_id}
- Datenquellen: {data_sources}

VERFÜGBARE NAMESPACES:
{prefixes}

VERFÜGBARE KLASSEN UND EIGENSCHAFTEN:

1. FORST-DATEN (StanForD HPR Format):
   tc:Stem - Stammdaten aus dem Wald
   - tc:stemKey (Stamm-ID)
   - tc:dbh (Durchmesser in cm)
   - tc:harvestDate (Erntedatum)
   - tc:speciesCode (Baumart-Code)
   - tc:originLatitude, tc:originLongitude (Koordinaten)
   - tc:forestryOffice (Forstamt)
   - tc:district (Revier)
   - tc:destinationSawmill (Ziel-Sägewerk)

2. SÄGEWERK-DATEN (ELDAT HBA Format):
   eldat:Polter - Polter-Daten
   - eldat:polterId (Polter-ID)
   - eldat:totalVolume (Gesamtvolumen in m³)
   - eldat:totalPieces (Anzahl Stämme)
   - eldat:deliveryDate (Lieferdatum)
   - eldat:species (Holzart)

3. BSP-WERK-DATEN (VLEX Format):
   vlex:BSPPanel - Brettsperrholz-Panel
   - vlex:artikel (Artikel-Nummer)
   - vlex:productionDate (Produktionsdatum)
   - vlex:layerCount (Schichtenanzahl)
   - vlex:fireResistanceClass (Brandschutzklasse)

   tc:BSPWerkSource - Produktionsdaten
   - tc:company (Firma)
   - tc:productionDate (Datum)
   - tc:orderId (Auftragsnummer)

4. LIEFERKETTE:
   tc:SupplyChainStep - Lieferkettenschritt
   - tc:station (Station: forst, transport, sawmill, bspwerk, construction)
   - tc:company (Firma)
   - tc:date (Datum)
   - tc:format (Datenformat)

5. GESCHÄFTSPARTNER:
   tc:BusinessPartner
   - tc:partnerName (Name)
   - tc:partnerRole (Rolle: lie=Lieferant, abn=Abnehmer, end=Endkunde)
   - tc:street, tc:city, tc:postalCode (Adresse)

REGELN:
1. Verwende den traceId "{product_id}" zum Filtern (z.B. FILTER(CONTAINS(STR(?s), "{product_id}")))
2. Nutze OPTIONAL für Felder, die nicht immer vorhanden sind
3. Verwende LIMIT bei erwarteten Einzelergebnissen
4. Kombiniere Daten mit UNION wenn aus mehreren Quellen nötig
5. Gib nur valide SPARQL zurück, keine Erklärungen

NUTZERANFRAGE: {question}

SPARQL-Query:"""

SPARQL_RESPONSE_PROMPT = """Du bist der TimberConnect Assistent. Erkläre die SPARQL-Ergebnisse dem Benutzer auf verständliche Weise.

BENUTZERANFRAGE:
{question}

SPARQL-ERGEBNISSE:
{results}

ANZAHL ERGEBNISSE: {result_count}

ANWEISUNGEN:
- Fasse die Ergebnisse verständlich zusammen
- Verwende die deutschen Begriffe (Forstamt, Sägewerk, etc.)
- Bei Koordinaten: Erwähne die Region wenn möglich
- Bei Daten: Formatiere als deutsches Datum (TT.MM.JJJJ)
- Bei leeren Ergebnissen: Erkläre, dass keine Daten gefunden wurden

Antwort:"""

# Pre-defined query templates for common questions
QUERY_TEMPLATES = {
    "forest_origin": """
{prefixes}
SELECT ?forestryOffice ?district ?harvestDate ?lat ?long ?speciesCode ?dbh
WHERE {{
    ?stem a tc:Stem .
    FILTER(CONTAINS(STR(?stem), "{product_id}"))
    OPTIONAL {{ ?stem tc:forestryOffice ?forestryOffice }}
    OPTIONAL {{ ?stem tc:district ?district }}
    OPTIONAL {{ ?stem tc:harvestDate ?harvestDate }}
    OPTIONAL {{ ?stem tc:originLatitude ?lat }}
    OPTIONAL {{ ?stem tc:originLongitude ?long }}
    OPTIONAL {{ ?stem tc:speciesCode ?speciesCode }}
    OPTIONAL {{ ?stem tc:dbh ?dbh }}
}}
LIMIT 10
""",

    "sawmill_data": """
{prefixes}
SELECT ?polterId ?volume ?pieces ?deliveryDate ?species ?sawmill
WHERE {{
    ?polter a eldat:Polter .
    FILTER(CONTAINS(STR(?polter), "{product_id}"))
    OPTIONAL {{ ?polter eldat:polterId ?polterId }}
    OPTIONAL {{ ?polter eldat:totalVolume ?volume }}
    OPTIONAL {{ ?polter eldat:totalPieces ?pieces }}
    OPTIONAL {{ ?polter eldat:deliveryDate ?deliveryDate }}
    OPTIONAL {{ ?polter eldat:species ?species }}
    OPTIONAL {{ ?polter tc:destinationSawmill ?sawmill }}
}}
LIMIT 10
""",

    "bsp_production": """
{prefixes}
SELECT ?company ?productionDate ?artikel ?layerCount ?fireClass ?orderId
WHERE {{
    {{
        ?bsp a vlex:BSPPanel .
        FILTER(CONTAINS(STR(?bsp), "{product_id}"))
        OPTIONAL {{ ?bsp vlex:artikel ?artikel }}
        OPTIONAL {{ ?bsp vlex:productionDate ?productionDate }}
        OPTIONAL {{ ?bsp vlex:layerCount ?layerCount }}
        OPTIONAL {{ ?bsp vlex:fireResistanceClass ?fireClass }}
    }} UNION {{
        ?source a tc:BSPWerkSource .
        FILTER(CONTAINS(STR(?source), "{product_id}"))
        OPTIONAL {{ ?source tc:company ?company }}
        OPTIONAL {{ ?source tc:productionDate ?productionDate }}
        OPTIONAL {{ ?source tc:orderId ?orderId }}
    }}
}}
LIMIT 10
""",

    "supply_chain": """
{prefixes}
SELECT ?station ?company ?date ?format
WHERE {{
    ?step a tc:SupplyChainStep .
    FILTER(CONTAINS(STR(?step), "{product_id}"))
    OPTIONAL {{ ?step tc:station ?station }}
    OPTIONAL {{ ?step tc:company ?company }}
    OPTIONAL {{ ?step tc:date ?date }}
    OPTIONAL {{ ?step tc:format ?format }}
}}
ORDER BY ?date
""",

    "certifications": """
{prefixes}
SELECT ?certification
WHERE {{
    ?product tc:hasCertification ?certification .
    FILTER(CONTAINS(STR(?product), "{product_id}"))
}}
""",

    "business_partners": """
{prefixes}
SELECT ?name ?role ?street ?city ?postalCode
WHERE {{
    ?partner a tc:BusinessPartner .
    FILTER(CONTAINS(STR(?partner), "{product_id}"))
    OPTIONAL {{ ?partner tc:partnerName ?name }}
    OPTIONAL {{ ?partner tc:partnerRole ?role }}
    OPTIONAL {{ ?partner tc:street ?street }}
    OPTIONAL {{ ?partner tc:city ?city }}
    OPTIONAL {{ ?partner tc:postalCode ?postalCode }}
}}
"""
}
