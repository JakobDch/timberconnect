/**
 * Predefined SPARQL Queries for TimberConnect
 *
 * These queries are used to fetch product and supply chain data
 * from Solid Pods containing RDF/TTL files.
 */

import { NAMESPACES } from '../config/solidPods';

/**
 * A product id is either a legacy trace id (TC-YYYY-NNN) or a GS1 doc_hash.
 * For trace ids the data carries tc:traceId / tc:stemKey to filter on; for
 * doc_hash uploads each source file holds exactly one product, so no in-file
 * id filter is needed (and none exists in the data).
 */
export function isTraceId(id: string): boolean {
  return /^TC-\d{4}-\d{3,}$/i.test(id);
}

/**
 * True if the id is a GS1 EPC URN (SGTIN or LGTIN), e.g.
 * urn:epc:id:sgtin:4047111124.015.S1605T56441L1. These enter the EPCIS-centric
 * retrieval flow (query EPCAT -> resolve EPCs -> query pods), not the trace-id flow.
 */
export function isEpc(id: string): boolean {
  // Beide Namensraeume: SGTIN steht unter urn:epc:id:, LGTIN kanonisch unter
  // urn:epc:class: (so normalisiert serial_import.py, und so schreiben es die
  // PDF-Mappings). urn:epc:id:lgtin: kommt aus aelteren Quellen weiterhin vor
  // und bleibt deshalb erlaubt.
  return /^urn:epc:(id|class):(sgtin|lgtin):/i.test(id.trim());
}

// SPARQL Prefix declarations
const PREFIXES = `
PREFIX tc: <${NAMESPACES.tc}>
PREFIX tcr: <${NAMESPACES.tcr}>
PREFIX eldat: <${NAMESPACES.eldat}>
PREFIX vlex: <${NAMESPACES.vlex}>
PREFIX geo: <${NAMESPACES.geo}>
PREFIX geosparql: <${NAMESPACES.geosparql}>
PREFIX xsd: <${NAMESPACES.xsd}>
PREFIX rdf: <${NAMESPACES.rdf}>
PREFIX rdfs: <${NAMESPACES.rdfs}>
`;

/**
 * Die Ident-Schranke der dokumentbezogenen Abfragen.
 *
 * ALLE PDF-Vorgaenge tragen ihren Materialbezug auf ``tc:epc`` (im Mapping:
 * ``materialEpc``) -- Stammzertifikat, Pruefzertifikat, Leistungserklaerung,
 * Transportauftrag, Klebstoffdatenblatt, Schnittbild. Das ist der gemeinsame
 * Anker, an dem sich ein Dokument einem Bauteil zuordnen laesst.
 *
 * WARUM DAS NOETIG IST: Die Awf-Abfragen liefen ohne jeden Filter ueber ALLE
 * geladenen Quellen -- und geladen wird der gesamte Katalog. Solange nur ein
 * Stammzertifikat existierte, fiel das nicht auf. Beim zweiten haette der
 * Herkunftsnachweis fremde Baumarten und Reifejahre als die eigenen
 * ausgewiesen; dasselbe gilt fuer Rueckbaubarkeit, Dokumentation, Haftung,
 * CO2-Bilanz und DBPP.
 *
 * ``epcs`` ist die Ident-Kette des Bauteils (gescannter EPC + Vorprodukte aus
 * den EPCIS-Ereignissen). Ein leeres Array laesst die Schranke bewusst
 * WEGFALLEN: dann ist keine Kette bekannt (Trace-Id-Pfad, Katalog ohne
 * EPCIS), und ein Filter ohne Werte wuerde jede Zeile verwerfen -- die Awf
 * waeren leer statt unscharf.
 *
 * Dokumente OHNE ``tc:epc`` bleiben erhalten (``!BOUND``): eine Datei, die
 * ihren Bezug nicht angibt, gehoert zur einzigen Quelle, die sie liefert.
 * Sie herauszufiltern haette bestehende Awf-Ansichten geleert.
 */
export function identGuard(epcs: string[], variable = '?epc'): string {
  if (epcs.length === 0) return '';
  const values = epcs.map((e) => `<${e}>`).join(', ');
  return `  FILTER (!BOUND(${variable}) || ${variable} IN (${values}))`;
}

/**
 * Die Ident-Schranke fuer Knoten OHNE eigenen ``tc:epc``.
 *
 * Drei Klassen tragen ihren Bezug nicht selbst, haengen aber ueber eine
 * echte Kante an einem Knoten, der ihn traegt:
 *
 *   tc:Project    <- tc:belongsToProject     <- tc:BuildingElement
 *   tc:Invoice    <- tc:hasInvoice           <- tc:Panel
 *   tc:Declaration... -> tc:hasSawingProcess -> tc:SawingProcess (Saegewerk-Variante)
 *
 * Gefiltert wird ueber den Nachbarn. ``FILTER EXISTS`` statt eines Joins,
 * damit die Sparte ihre eigene Ergebnisform behaelt -- der Nachbar soll die
 * Zeile pruefen, nicht vervielfachen.
 *
 * ``inverse`` dreht die Kantenrichtung: normalerweise zeigt der Nachbar auf
 * unseren Knoten (``?nachbar <kante> ?knoten``), bei tc:hasSawingProcess ist
 * es umgekehrt.
 */
export function relatedIdentGuard(
  epcs: string[],
  node: string,
  edge: string,
  opts: { inverse?: boolean } = {},
): string {
  if (epcs.length === 0) return '';
  const values = epcs.map((e) => `<${e}>`).join(', ');
  const neighbour = `${node}_via`;
  const triple = opts.inverse
    ? `${node} ${edge} ${neighbour} .`
    : `${neighbour} ${edge} ${node} .`;
  return `  FILTER EXISTS { ${triple} ${neighbour} tc:epc ?e . FILTER(?e IN (${values})) }`;
}

/**
 * Die Ident-Schranke der Leistungserklaerung -- ein Sonderfall mit ZWEI Ankern.
 *
 * Es gibt zwei Vorlagen: die BSP-Leistungserklaerung traegt ``tc:epc`` am
 * Dokument selbst (pdf_leistungserklaerung_bsp.rml.ttl), die Saegewerk-Variante
 * NICHT -- dort haengt der Bezug am Unterknoten ``tc:SawingProcess``, den das
 * Dokument per ``tc:hasSawingProcess`` verlinkt (pdf_leistungserklaerung.rml.ttl).
 *
 * Beide muessen gelten, sonst faellt eine der beiden Vorlagen komplett aus der
 * Ansicht -- schlimmer als der Leak, den wir schliessen wollen.
 */
export function dopIdentGuard(epcs: string[], node = '?dop'): string {
  if (epcs.length === 0) return '';
  const values = epcs.map((e) => `<${e}>`).join(', ');
  const suffix = node.replace(/^\?/, '');
  return (
    `  FILTER (` +
    `EXISTS { ${node} tc:epc ?e_${suffix} . FILTER(?e_${suffix} IN (${values})) } || ` +
    `EXISTS { ${node} tc:hasSawingProcess ?sp_${suffix} . ` +
    `?sp_${suffix} tc:epc ?spe_${suffix} . FILTER(?spe_${suffix} IN (${values})) })`
  );
}

/**
 * Stammdaten der BSP-Platte.
 *
 * AUF v6 UMGESTELLT. Vorher fragte diese Abfrage ``vlex:BSPPanel`` mit
 * ``tc:traceId`` und drei Unterknoten (hasConfiguration/hasDimension/
 * hasProduction). Dieses Vokabular stammt aus ``vlex.rml.ttl`` -- dem einzigen
 * Mapping, das die v6-Migration nie erfasst hat. Es wird von keinem aktuellen
 * Upload mehr erzeugt, und ``tc:traceId`` existiert in v6 nirgends. Die
 * Abfrage lieferte deshalb beim Ident-Pfad ausnahmslos null Zeilen.
 *
 * In v6 liegen alle Felder FLACH am ``tc:Panel`` (erp_bsp.rml.ttl), das seinen
 * Ident direkt auf ``tc:epc`` traegt. Die Unterknoten entfallen ersatzlos.
 *
 * Ohne v6-Entsprechung und deshalb entfallen: ``traceId`` (gibt es nicht mehr),
 * ``fsc`` (FSC haengt am Stamm, nicht an der Platte -- siehe createStemQuery)
 * und ``holzartBezeichnung`` (v6 fuehrt nur ein Holzart-Feld).
 */
export function createProductQuery(epcs: string[] = []): string {
  return `${PREFIXES}
SELECT ?panel ?artikel ?pefc
       ?holzart ?festigkeit
       ?laenge ?breite ?hoehe
       ?beschreibung ?status ?produktnorm
       ?schichten ?nettoVolumen ?bruttoVolumen
WHERE {
  ?panel a tc:Panel .
  OPTIONAL { ?panel tc:epc ?epc }

  OPTIONAL { ?panel tc:hasArticle ?article . ?article tc:artikel ?artikel }
  OPTIONAL { ?panel tc:pEFC ?pefc }
  OPTIONAL { ?panel tc:holzart_v3 ?holzart }
  OPTIONAL { ?panel tc:festigkeit__Material_Produkt ?festigkeit }
  OPTIONAL { ?panel tc:laenge_v3 ?laenge }
  OPTIONAL { ?panel tc:breite ?breite }
  OPTIONAL { ?panel tc:hoehe__Staerke ?hoehe }
  OPTIONAL { ?panel tc:beschreibung_Freitext ?beschreibung }
  OPTIONAL { ?panel tc:bauteilstatus_Produktion ?status }
  OPTIONAL { ?panel tc:produktnorm ?produktnorm }
  OPTIONAL { ?panel tc:anzahl_der_Schichten_innerhalb_einer_BSP_Platte ?schichten }
  OPTIONAL { ?panel tc:nettovolumen_Produkt ?nettoVolumen }
  OPTIONAL { ?panel tc:bruttovolumen_Produkt ?bruttoVolumen }
${identGuard(epcs)}
}
LIMIT 1
`;
}

/**
 * Waldherkunft.
 *
 * AUF v6 UMGESTELLT -- und zwar auf denselben Knoten wie createStemQuery.
 * ``tc:ForestSource`` war ein rein synthetischer Zwischenknoten aus
 * ``vlex.rml.ttl`` und existiert in v6 nicht mehr; die Waldangaben stehen
 * seither direkt am ``tc:Stem`` (stanford_hpr.rml.ttl). Die frueheren
 * SELECT-Variablen ``?lat``/``?long`` waren ueberdies nie an ein Muster
 * gebunden -- sie blieben auch im alten Vokabular immer leer.
 *
 * Der Ident haengt am Abschnitt, nicht am Stamm (siehe stemIdentGuard).
 */
export function createForestQuery(epcs: string[] = []): string {
  return `${PREFIXES}
SELECT ?forestryOffice ?district ?harvestDate ?stemKey ?lat ?long
WHERE {
  ?stem a tc:Stem ;
        tc:stemKey ?stemKey .

  OPTIONAL { ?stem tc:forestryOffice ?forestryOffice }
  OPTIONAL { ?stem tc:district ?district }
  OPTIONAL { ?stem tc:harvestDate ?harvestDate }
  OPTIONAL { ?stem tc:hasMachinePosition ?pos . ?pos geo:lat ?lat }
  OPTIONAL { ?stem tc:hasMachinePosition ?pos2 . ?pos2 geo:long ?long }
${stemIdentGuard(epcs)}
}
LIMIT 1
`;
}

/**
 * Die Ident-Schranke des Stamms -- er traegt seinen Ident NICHT selbst.
 *
 * Im HPR steht ``<Identity>`` innerhalb von ``<Log>``, nicht am ``<Stem>``:
 * ein Baum hat keinen eigenen GS1-Ident, seine Abschnitte haben ihn. Der
 * Ident-Injektor folgt dem und haengt den SGTIN bevorzugt an den Abschnitt
 * (ident_injector.py: "Den Abschnitt bevorzugen, wenn es ihn gibt"); nur ohne
 * LogKey landet er am Stamm. Gefiltert wird deshalb ueber den Abschnitt, der
 * per ``tc:belongsToStem`` auf den Stamm zeigt (stanford_hpr.rml.ttl).
 *
 * Beide Ident-Prädikate pruefen: der Injektor schreibt ``tc:sgtin``, waehrend
 * die PDF-Vorgaenge ``tc:epc`` fuehren. ``tc:sgtin`` ist in der Ontologie zwar
 * als Unter-Property von ``tc:epc`` deklariert -- Comunica macht aber kein
 * Reasoning, eine Abfrage auf ``tc:epc`` allein faende den injizierten Ident
 * also nicht.
 *
 * Der zweite Zweig deckt den Fallback des Injektors ab (Ident direkt am
 * Stamm, HPR ohne LogKey).
 *
 * BEIDE Zweige muessen den Ident SELBST matchen. Frueher stand hier
 *
 *     { ?stem tc:hasLog|^tc:belongsToStem ?identNode }
 *     UNION { BIND(?stem AS ?identNode) }
 *     { ?identNode tc:epc ?identValue } UNION { ?identNode tc:sgtin ?identValue }
 *
 * -- und das hat die Schranke praktisch AUFGEHOBEN. Ein BIND sieht die
 * Variablen ausserhalb seiner Gruppe nicht: ``?stem`` ist im UNION-Zweig
 * ungebunden, ``?identNode`` wird dort also an nichts gebunden. Der Zweig
 * verknuepft ``?stem`` und ``?identValue`` daher nicht mehr, sondern laesst
 * jeden Stamm durch, sobald der Ident IRGENDWO im Graphen vorkommt.
 * Nachgemessen an einer Mini-TTL mit zwei Staemmen: die Abfrage nach dem
 * Ident von Stamm A lieferte A UND B. Mit ``LIMIT 1`` (createForestQuery)
 * gewinnt dann ein beliebiger Stamm -- bei der BSP-Platte einer ohne
 * Erntekoordinate, weshalb der Faellort aus der Karte verschwand.
 *
 * Kein Fehler, kein Log -- deshalb sieht das Ergebnis wie eine Datenluecke
 * aus. Siehe denselben Fehler in ``agent/epcScopeService.ts``.
 */
function stemIdentGuard(epcs: string[]): string {
  if (epcs.length === 0) return '';
  // VALUES statt FILTER(?x IN (...)): der Wert wird GEBUNDEN, statt jeden
  // Kandidaten gegen eine lange Liste zu pruefen. Bei einer Kette mit 169
  // Lamellen ist das der Unterschied zwischen einer Abfrage, die zurueckkommt,
  // und einer, die den Browser stehen laesst -- das EXISTS lief sonst als
  // Kreuzprodukt ueber alle Log-Knoten je Kandidat.
  const values = epcs.map((e) => `<${e}>`).join(' ');
  return `  {
    VALUES ?identValue { ${values} }
    {
      # Normalfall: der Ident haengt am Abschnitt.
      ?stem tc:hasLog|^tc:belongsToStem ?logNode .
      { ?logNode tc:epc ?identValue } UNION { ?logNode tc:sgtin ?identValue }
    }
    UNION
    {
      # Fallback des Injektors: HPR ohne LogKey, Ident direkt am Stamm.
      { ?stem tc:epc ?identValue } UNION { ?stem tc:sgtin ?identValue }
    }
  }`;
}

/**
 * Query for stem data (raw forest data from StanForD HPR file)
 * The stem data is in 01_Forst_StanForD_HPR.ttl with stemKey matching traceId
 *
 * ``epcs`` schraenkt auf die Ident-Kette des Bauteils ein. OHNE diese Schranke
 * war die Abfrage beim EPC-Pfad voellig ungefiltert: ``isTraceId`` schlaegt bei
 * einem EPC fehl, die einzige Filterzeile verschwand, und uebrig blieb
 * ``?stem a tc:Stem`` + ``LIMIT 1`` ueber den GESAMTEN Katalog. Der
 * Herkunftsnachweis wies damit einen BELIEBIGEN fremden Stamm als Herkunft des
 * gescannten Bauteils aus -- mit nur einem hochgeladenen Stammzertifikat faellt
 * das nicht auf, beim zweiten wird es zur Falschaussage. Derselbe Fehler war
 * fuer die dokumentbezogenen Abfragen bereits behoben (siehe identGuard).
 */
export function createStemQuery(traceId: string, epcs: string[] = []): string {
  return `${PREFIXES}
SELECT ?stem ?forestryOffice ?district ?harvestDate ?dbh ?fsc ?pefc ?lat ?long ?alt ?species ?speciesName
       ?analyzedLength ?referenceDiameter ?destinationSawmill ?gnssQuality ?stemNumber
       ?horizontalAccuracy ?verticalAccuracy ?satellitesInUse
       ?ownerName ?ownerCity ?ownerCountry
WHERE {
  ?stem a tc:Stem .
  ${isTraceId(traceId) ? `?stem tc:stemKey "${traceId}" .` : ''}
${stemIdentGuard(epcs)}

  OPTIONAL { ?stem tc:forestryOffice ?forestryOffice }
  OPTIONAL { ?stem tc:district ?district }
  OPTIONAL { ?stem tc:harvestDate ?harvestDate }
  OPTIONAL { ?stem tc:dbh ?dbh }
  OPTIONAL { ?stem tc:fscCertification ?fsc }
  OPTIONAL { ?stem tc:pefcCertification ?pefc }
  OPTIONAL { ?stem tc:speciesGroupKey ?species }
  OPTIONAL { ?stem tc:hasSpeciesGroup ?sg . ?sg tc:speciesGroupName ?speciesName }
  OPTIONAL { ?stem tc:analyzedLength ?analyzedLength }
  OPTIONAL { ?stem tc:referenceDiameter ?referenceDiameter }
  OPTIONAL { ?stem tc:destinationSawmill ?destinationSawmill }
  OPTIONAL { ?stem tc:gnssQualityIndicator ?gnssQuality }
  OPTIONAL { ?stem tc:stemNumber ?stemNumber }
  OPTIONAL { ?stem tc:horizontalAccuracy ?horizontalAccuracy }
  OPTIONAL { ?stem tc:verticalAccuracy ?verticalAccuracy }
  OPTIONAL { ?stem tc:satellitesInUse ?satellitesInUse }

  OPTIONAL {
    ?stem tc:hasMachinePosition ?pos .
    ?pos geo:lat ?lat .
  }
  OPTIONAL {
    ?stem tc:hasMachinePosition ?pos2 .
    ?pos2 geo:long ?long .
  }
  OPTIONAL {
    ?stem tc:hasMachinePosition ?pos3 .
    ?pos3 geo:alt ?alt .
  }

  # Maschinenbesitzer = Forstbetrieb (I-16/I-17 im Herkunftsnachweis).
  # Das HPR-Mapping schreibt hier businessName/city/country, aber keine
  # Strasse -- die Adresse bleibt deshalb zwangslaeufig unvollstaendig.
  #
  # Der Besitzer haengt an der MASCHINE, nicht am Stamm: das Mapping bildet
  # <#MachineOwnerMapping> auf .../machine/{MachineKey}/owner ab und der Stamm
  # zeigt ueber tc:hasMachine dorthin. Ohne dieses Zwischenglied bleibt der
  # erste Akteur des Herkunftsnachweises leer, obwohl er im Graph steht.
  OPTIONAL {
    ?stem tc:hasMachine ?machine .
    ?machine tc:hasMachineOwner ?owner .
    OPTIONAL { ?owner tc:businessName ?ownerName }
    OPTIONAL { ?owner tc:city ?ownerCity }
    OPTIONAL { ?owner tc:country ?ownerCountry }
  }
}
LIMIT 1
`;
}

/**
 * Query for sawmill/polter data (from ELDAT HBA file)
 * Gets polter details including volume, pieces, and delivery date from WoodAllocation
 */
export function createSawmillQuery(epcs: string[] = []): string {
  return `${PREFIXES}
SELECT ?company ?street ?postcode ?city ?country ?deliveryDate
       ?polterId ?totalVolume ?totalPieces ?destinationProduct
WHERE {
  {
    # Das Saegewerk ist der EMPFAENGER des Rundholz-Transportauftrags.
    # Eine eigene Saegewerks-Klasse gibt es in v6 nicht; der Auftrag traegt
    # Firma und Anschrift flach (pdf_transportauftrag_rundholz.rml.ttl) und
    # haengt selbst am Ident.
    ?order a tc:TransportOrder .
    OPTIONAL { ?order tc:epc ?epc }
    OPTIONAL { ?order tc:firmenname ?company }
    OPTIONAL { ?order tc:strasse ?street }
    OPTIONAL { ?order tc:pLZ ?postcode }
    OPTIONAL { ?order tc:stadt ?city }
    OPTIONAL { ?order tc:land ?country }
    OPTIONAL { ?order tc:datum ?deliveryDate }
    OPTIONAL { ?order tc:polter_Nummer ?polterId }
    OPTIONAL { ?order tc:summe_Festmeter ?totalVolume }
    OPTIONAL { ?order tc:summer_Stueck ?totalPieces }
${identGuard(epcs)}
  }
  UNION
  {
    # Zweitquelle: die Saegewerks-Leistungserklaerung. Sie traegt den Ident
    # nicht selbst, sondern am Unterknoten tc:SawingProcess -- dafuer gibt es
    # dopIdentGuard.
    ?dop a tc:DeclarationOfPerformance .
    ?dop tc:manufacturer ?company .
    OPTIONAL { ?dop tc:manufacturerAddress ?street }
${dopIdentGuard(epcs)}
  }
  UNION
  {
    # Bestimmungssaegewerk aus den Maschinendaten -- nur ein Name, keine
    # Anschrift, aber die frueheste Aussage in der Kette.
    ?stem a tc:Stem .
    ?stem tc:destinationSawmill ?destinationProduct .
${stemIdentGuard(epcs)}
  }
}
`;
}

/**
 * Herstellungsangaben der BSP-Platte.
 *
 * AUF v6 UMGESTELLT. ``tc:BSPWerkSource`` und die vlex-Unterknoten sind mit
 * ``vlex.rml.ttl`` entfallen; in v6 steht alles flach am ``tc:Panel``
 * (erp_bsp.rml.ttl), das ``tc:epc`` direkt traegt.
 *
 * Der HERSTELLERNAME kommt nicht von dort: ``tc:organisation`` am Panel ist
 * ein ERP-Schluessel, kein Klartext. Den Namen samt Anschrift fuehrt die
 * BSP-Leistungserklaerung (pdf_leistungserklaerung_bsp.rml.ttl), die ihren
 * Ident ebenfalls direkt traegt -- daher der zweite Zweig.
 *
 * Ohne v6-Entsprechung: ``zusatzabbundBeschreibung``, ``bspTypBezeichnung``,
 * ``plattencodeBezeichnung`` (v6 fuehrt je nur ein Feld statt Code+Klartext).
 */
export function createBspWerkQuery(epcs: string[] = []): string {
  return `${PREFIXES}
SELECT ?company ?street ?postcode ?city ?country
       ?productionDate ?orderId ?status ?beschreibung ?konstruktionsnummer
       ?cncAbbund ?cncMaschine ?zusatzabbund ?produktionsstandort ?organisation
       ?anzahlSchichten ?brandschutzklasse ?bspTyp ?plattencode
       ?produktnorm ?nettoVolumen ?bruttoVolumen
       ?optikSeite1 ?decklageBspSeite1
WHERE {
  {
    ?panel a tc:Panel .
    OPTIONAL { ?panel tc:epc ?epc }

    OPTIONAL { ?panel tc:organisation ?organisation }
    OPTIONAL { ?panel tc:ist_Beginndatum ?productionDate }
    OPTIONAL { ?panel tc:vertriebsauftragsnummer ?orderId }
    OPTIONAL { ?panel tc:bauteilstatus_Produktion ?status }
    OPTIONAL { ?panel tc:beschreibung_Freitext ?beschreibung }
    OPTIONAL { ?panel tc:konstruktionsnummer ?konstruktionsnummer }
    OPTIONAL { ?panel tc:cNC_Abbund ?cncAbbund }
    OPTIONAL { ?panel tc:cNC_Maschiene ?cncMaschine }
    OPTIONAL { ?panel tc:zusatzabbund ?zusatzabbund }
    OPTIONAL { ?panel tc:produktionsstandort ?produktionsstandort }
    OPTIONAL { ?panel tc:anzahl_der_Schichten_innerhalb_einer_BSP_Platte ?anzahlSchichten }
    OPTIONAL { ?panel tc:brandschutzklasse_Produkt ?brandschutzklasse }
    OPTIONAL { ?panel tc:typ_der_BSP_Platte ?bspTyp }
    OPTIONAL { ?panel tc:plattencode_BSP ?plattencode }
    OPTIONAL { ?panel tc:produktnorm ?produktnorm }
    OPTIONAL { ?panel tc:nettovolumen_Produkt ?nettoVolumen }
    OPTIONAL { ?panel tc:bruttovolumen_Produkt ?bruttoVolumen }
    OPTIONAL { ?panel tc:optik_Seite_1 ?optikSeite1 }
    OPTIONAL { ?panel tc:deckelage_BSP ?decklageBspSeite1 }
${identGuard(epcs)}
  }
  UNION
  {
    # Herstellername + Anschrift. Die Adresse steht als BEUTEL auf demselben
    # Praedikat (Strasse/PLZ/Stadt/Land) -- deshalb ein Kreuzprodukt, das der
    # Mapper aufloest, statt hier vier Variablen zu behaupten.
    ?dop a tc:DeclarationOfPerformance .
    ?dop tc:manufacturer ?company .
    OPTIONAL { ?dop tc:epc ?dopEpc }
    OPTIONAL { ?dop tc:manufacturerAddress ?street }
${identGuard(epcs, '?dopEpc')}
  }
}
`;
}

/**
 * Die Stationen der Lieferkette.
 *
 * AUF v6 UMGESTELLT -- mit geaenderter Herleitung. Die frueheren
 * ``tc:hasForestSource``/``hasSawmillSource``/``hasBSPWerkSource``-Knoten
 * waren ein synthetisches vlex-Konstrukt: eine Datei behauptete die ganze
 * Kette. In v6 gibt es diese Knoten nicht mehr, und das ist eine Verbesserung:
 * jede Station belegt sich jetzt selbst.
 *
 *   Wald       -> tc:Stem (Maschinendaten des Fällvorgangs)
 *   Saegewerk  -> Empfaenger des Rundholz-Transportauftrags
 *   BSP-Werk   -> Hersteller der Leistungserklaerung
 *
 * ``station`` wird hier fest gesetzt, statt aus den Daten gelesen: die
 * Stationsbezeichnung war ein Feld des vlex-Knotens und hat in v6 keine
 * Entsprechung -- sie ergibt sich aus der Herkunft der Zeile.
 */
export function createSupplyChainQuery(epcs: string[] = []): string {
  return `${PREFIXES}
SELECT ?station ?company ?date ?location
WHERE {
  {
    ?stem a tc:Stem .
    OPTIONAL { ?stem tc:forestryOffice ?company }
    OPTIONAL { ?stem tc:harvestDate ?date }
    OPTIONAL { ?stem tc:district ?location }
${stemIdentGuard(epcs)}
    BIND("Forst" AS ?station)
  }
  UNION
  {
    ?order a tc:TransportOrder .
    OPTIONAL { ?order tc:epc ?epc }
    OPTIONAL { ?order tc:firmenname ?company }
    OPTIONAL { ?order tc:datum ?date }
    OPTIONAL { ?order tc:stadt ?location }
${identGuard(epcs)}
    BIND("Sägewerk" AS ?station)
  }
  UNION
  {
    ?dop a tc:DeclarationOfPerformance .
    ?dop tc:manufacturer ?company .
    OPTIONAL { ?dop tc:epc ?dopEpc }
${identGuard(epcs, '?dopEpc')}
    BIND("BSP-Werk" AS ?station)
  }
}
`;
}

/**
 * Die Akteure der Kette mit Anschrift.
 *
 * AUF v6 UMGESTELLT. ``eldat:BusinessPartner`` hat es nie gegeben (vor v6 hiess
 * die Klasse ``eldat:Supplier``), und der Pfad ueber ``eldat:hasPolter`` /
 * ``tc:hasTraceReference`` ist mit der v6-Migration entfallen. Das heutige
 * ELDAT-Mapping erzeugt nur LogPile/DeliveryNote/Carrier/Transport -- ohne
 * Rollen, ohne Anschriften und ohne Ident.
 *
 * Die Akteure stehen in v6 in den TRANSPORTAUFTRAEGEN: der Rundholzauftrag
 * fuehrt Absender (Forst) und Empfaenger (Saegewerk) flach, der
 * Schnittholzauftrag Be- und Entladestelle als eigene Knoten.
 */
export function createBusinessPartnersQuery(epcs: string[] = []): string {
  return `${PREFIXES}
SELECT ?name ?role ?city ?street ?postcode ?country
WHERE {
  {
    # Rundholz-Transportauftrag: Empfaengerfirma ist das Saegewerk.
    ?order a tc:TransportOrder .
    ?order tc:firmenname ?name .
    OPTIONAL { ?order tc:epc ?epc }
    OPTIONAL { ?order tc:strasse ?street }
    OPTIONAL { ?order tc:pLZ ?postcode }
    OPTIONAL { ?order tc:stadt ?city }
    OPTIONAL { ?order tc:land ?country }
${identGuard(epcs)}
    BIND("Sägewerk" AS ?role)
  }
  UNION
  {
    # Rundholz-Transportauftrag: der Lieferant ist das Forstamt.
    ?order2 a tc:TransportOrder .
    ?order2 tc:lieferant_Forstamt ?name .
    OPTIONAL { ?order2 tc:epc ?epc2 }
${identGuard(epcs, '?epc2')}
    BIND("Forstbetrieb" AS ?role)
  }
  UNION
  {
    # Hersteller aus der Leistungserklaerung.
    ?dop a tc:DeclarationOfPerformance .
    ?dop tc:manufacturer ?name .
    OPTIONAL { ?dop tc:epc ?dopEpc }
    OPTIONAL { ?dop tc:manufacturerAddress ?street }
${identGuard(epcs, '?dopEpc')}
    BIND("Hersteller" AS ?role)
  }
}
`;
}

/**
 * Query for wood data from sawmill (links stem to destination product)
 */
export function createWoodDataQuery(traceId: string): string {
  return `${PREFIXES}
SELECT ?destinationOrder ?destinationProduct ?harvesterStemKey
WHERE {
  ?woodData a tc:WoodData ;
            tc:harvesterStemKey "${traceId}" .

  OPTIONAL { ?woodData tc:destinationOrder ?destinationOrder }
  OPTIONAL { ?woodData tc:destinationProduct ?destinationProduct }
}
LIMIT 1
`;
}

/**
 * Transportauftraege (Herkunftsnachweis I-19..I-26).
 *
 * Achtung -- Adressen kommen als *Beutel* zurueck, nicht als Einzelfelder:
 * das PDF-Template schreibt tc:loadingAddress DREIMAL an dasselbe Subjekt
 * (Name, Strasse, Ort) als drei einfache Literale. SPARQL kann sie nicht
 * auseinanderhalten, also liefert die Abfrage ein Kreuzprodukt (3x3 Zeilen je
 * Lieferung). Gruppiert und klassifiziert wird clientseitig in
 * provenanceMapper.classifyAddressParts().
 *
 * Kein traceId-Filter: die Dokumente haengen ueber tc:epc am Material, nicht
 * ueber eine Trace-ID, und pro Pod-Datei liegt ohnehin ein Vorgang.
 *
 * ZWEI VOKABULARE, nicht eines. Die beiden Transportauftrags-Vorlagen sind
 * unabhaengig voneinander entstanden und schreiben verschiedene Praedikate:
 *
 *   Schnittholzlamelle (I-22..I-25) -- pdf_transportauftrag:
 *       tc:TransportOrder -> tc:hasDeliveryOrder -> tc:DeliveryOrder
 *       mit tc:loadingAddress / tc:unloadingAddress / tc:startDate / tc:endDate
 *
 *   Rundholz (I-19..I-21) -- pdf_transportauftrag_rundholz:
 *       tc:TransportOrder FLACH, ohne Lieferauftrag, mit deutschen
 *       Feldnamen-Praedikaten: tc:firmenname / tc:strasse / tc:pLZ /
 *       tc:stadt / tc:datum. Die Empfaengerfirma ist hier das SAEGEWERK.
 *
 * Frueher verlangte diese Abfrage ``?order tc:hasDeliveryOrder ?delivery`` als
 * Pflichtmuster und las nur die englischen Praedikate. Der Rundholz-Auftrag
 * erfuellt das nie -- er fiel damit komplett aus dem Ergebnis, und mit ihm der
 * Akteur "Saegewerk" (I-19..I-21). Genau deshalb blieb in der Ansicht nur der
 * Forstbetrieb uebrig.
 *
 * Der Lieferauftrag ist jetzt OPTIONAL, und die flachen Felder werden
 * zusaetzlich gelesen. ?flatName/?flatStreet/?flatCity sind bereits sauber
 * getrennt -- sie brauchen die Rateheuristik nicht.
 */
export function createTransportOrdersQuery(epcs: string[] = []): string {
  return `${PREFIXES}
SELECT ?order ?delivery ?transportNumber ?spedition ?epc
       ?loadingAddress ?unloadingAddress ?startDate ?endDate
       ?flatName ?flatStreet ?flatCity ?flatPostcode ?flatDate ?supplier
WHERE {
  ?order a tc:TransportOrder .

  OPTIONAL { ?order tc:transportNumber ?transportNumber }
  OPTIONAL { ?order tc:businessName ?spedition }
  OPTIONAL { ?order tc:epc ?epc }

  # --- Variante A: Schnittholz-Vorlage mit eigenem Lieferauftrag ----------
  OPTIONAL {
    ?order tc:hasDeliveryOrder ?delivery .
    OPTIONAL { ?delivery tc:loadingAddress ?loadingAddress }
    OPTIONAL { ?delivery tc:unloadingAddress ?unloadingAddress }
    OPTIONAL { ?delivery tc:startDate ?startDate }
    OPTIONAL { ?delivery tc:endDate ?endDate }
  }

  # --- Variante B: Rundholz-Vorlage, flach und deutsch benannt ------------
  # Empfaenger dieses Auftrags ist das Saegewerk (I-19 Name, I-20 Strasse,
  # I-21 Ort); tc:datum ist das Transportdatum (I-18/I-22).
  OPTIONAL { ?order tc:firmenname ?flatName }
  OPTIONAL { ?order tc:strasse ?flatStreet }
  OPTIONAL { ?order tc:stadt ?flatCity }
  OPTIONAL { ?order tc:pLZ ?flatPostcode }
  OPTIONAL { ?order tc:datum ?flatDate }
  OPTIONAL { ?order tc:lieferant_Forstamt ?supplier }
${identGuard(epcs)}
}
`;
}

/**
 * Zertifikate und Pruefberichte (Herkunftsnachweis I-5/I-6/I-7).
 *
 * Stammzertifikat (tc:Certificate) und Pruefzertifikat (tc:TestReport) tragen
 * Holzart und Reifejahr des Vermehrungsguts. Auch hier ist ?species
 * mehrdeutig: das Pruefzertifikat schreibt die botanische UND die deutsche
 * Bezeichnung auf dasselbe Praedikat -- unterschieden wird clientseitig.
 */
export function createCertificateDataQuery(epcs: string[] = []): string {
  return `${PREFIXES}
SELECT ?doc ?type ?species ?maturityYear ?reportNumber ?identifier ?registerSign ?epc
WHERE {
  { ?doc a tc:TestReport } UNION { ?doc a tc:Certificate }

  OPTIONAL { ?doc rdf:type ?type }
  OPTIONAL { ?doc tc:species ?species }
  OPTIONAL { ?doc tc:maturityYear ?maturityYear }
  OPTIONAL { ?doc tc:reportNumber ?reportNumber }
  OPTIONAL { ?doc tc:identifier ?identifier }
  OPTIONAL { ?doc tc:registerSign ?registerSign }
  OPTIONAL { ?doc tc:epc ?epc }
${identGuard(epcs)}
}
`;
}

/**
 * Leistungserklaerung + ERP-Vorgang (Herkunftsnachweis I-1..I-4, I-27, I-28).
 *
 * Handelsname und Beschreibung stammen laut Informationsbedarfstiefe aus der
 * Leistungserklaerung (M-1077/M-1078 fuer die Platte, M-X630/M-X629 fuer die
 * Lamelle) -- NICHT aus den Maschinendaten. Bisher las der Herkunftsnachweis
 * beides aus dem Produktobjekt, das nur aus den Forst-/Saege-/BSP-TTLs
 * gespeist wird; die hochgeladene Leistungserklaerung wurde nie abgefragt.
 * Deshalb blieb "Beschreibung" leer, obwohl das Dokument im Pod liegt.
 *
 * Das Mapping schreibt den Handelsnamen auf tc:title und den
 * Verwendungszweck -- fachlich die Beschreibung des tragenden Elements --
 * auf tc:intendedUse.
 *
 * Der Kaeufer (I-27/I-28) steht im proprietaeren ERP-Vorgang des
 * Holzwerkstoffproduzenten als Rechnungsempfaenger.
 */
export function createDeclarationQuery(epcs: string[] = []): string {
  return `${PREFIXES}
SELECT ?doc ?title ?intendedUse ?typeNumber ?holzart ?strengthClass
       ?manufacturer ?epc
       ?buyerName ?buyerAddress ?buyer
WHERE {
  {
    ?doc a tc:DeclarationOfPerformance .
    OPTIONAL { ?doc tc:title ?title }
    OPTIONAL { ?doc tc:intendedUse ?intendedUse }
    OPTIONAL { ?doc tc:typeNumber ?typeNumber }
    OPTIONAL { ?doc tc:holzart ?holzart }
    OPTIONAL { ?doc tc:strengthClass ?strengthClass }
    OPTIONAL { ?doc tc:manufacturer ?manufacturer }
    OPTIONAL { ?doc tc:epc ?epc }
${identGuard(epcs)}
  }
  UNION
  {
    # I-27/I-28: Rechnungsempfaenger aus dem ERP-Herstellungsvorgang.
    # Die Rechnung traegt keinen eigenen Ident, haengt aber per tc:hasInvoice
    # an der Platte, die einen hat (erp_bsp.rml.ttl).
    ?buyer a tc:Invoice .
    OPTIONAL { ?buyer tc:rechnungsempfaenger_Name ?buyerName }
    OPTIONAL { ?buyer tc:rechnungsempfaenger_Adresse ?buyerAddress }
    OPTIONAL { ?buyer tc:rechnungsempfaenger ?buyerName }
${relatedIdentGuard(epcs, '?buyer', 'tc:hasInvoice')}
  }
}
`;
}

/**
 * Merkmale des Anwendungsfalls "Rueckbaubarkeit" (I-29..I-56).
 *
 * Drei Quellen, die der Herkunftsnachweis nicht anfasst, liefern hier den
 * Grossteil der Informationsbedarfstiefe:
 *
 *   1. tc:Panel aus dem proprietaeren ERP-Standard -- Abmessungen (I-32..I-36),
 *      Festigkeitsklasse (I-29) und die Holzzertifizierung (I-15, tc:pEFC),
 *      aus der die Materialherkunft (I-37) abgeleitet wird.
 *   2. tc:DeclarationOfPerformance -- die vollstaendige Herstelleranschrift
 *      (I-41..I-48) sowie Formaldehydklasse und gefaehrliche Inhaltsstoffe
 *      (I-38/I-39). Die bestehende createDeclarationQuery holt davon nur
 *      Titel und Verwendungszweck; sie wird bewusst nicht erweitert, damit der
 *      Herkunftsnachweis unveraendert bleibt.
 *   3. tc:Adhesive aus dem technischen Datenblatt -- Produktbezeichnung (I-49)
 *      und Schadstoffkennzeichnung (I-50).
 *
 * Bewusst OHNE traceId-Filter: die Dokumentquellen tragen ihren Bezug ueber
 * tc:epc, nicht ueber tc:traceId. Gefiltert wird -- wie bei den Zertifikaten
 * und Transportauftraegen -- ueber die Auswahl der abgefragten Quellen.
 *
 * Formaldehyd und gefaehrliche Stoffe liegen im Mapping auf DEMSELBEN
 * Praedikat (tc:hazardousSubstanceEmission). Sie kommen deshalb als
 * Mehrfachbindung zurueck und werden im Mapper getrennt -- siehe
 * splitHazardousValues() in deconstructionMapper.ts.
 */
export function createDeconstructionQuery(epcs: string[] = []): string {
  return `${PREFIXES}
SELECT ?panel ?festigkeit ?produktionsdatum ?menge ?hoehe ?breite ?laenge
       ?schichten ?pefc ?anstrich ?artikel ?panelHolzart
       ?dop ?dopTitle ?dopIntendedUse ?dopManufacturer ?dopAddress
       ?dopPhone ?dopFax ?dopWebsite ?dopHazard ?dopTypeNumber ?dopEpc
       ?dopHolzart ?dopStrengthClass
       ?adhesive ?adhesiveName ?adhesiveLabeling ?adhesiveType ?adhesiveEpc
WHERE {
  {
    ?panel a tc:Panel .
    OPTIONAL { ?panel tc:epc ?panelEpc }
${identGuard(epcs, '?panelEpc')}
    OPTIONAL { ?panel tc:festigkeit__Material_Produkt ?festigkeit }
    OPTIONAL { ?panel tc:nettovolumen_Produkt ?menge }
    OPTIONAL { ?panel tc:hoehe__Staerke ?hoehe }
    OPTIONAL { ?panel tc:breite ?breite }
    OPTIONAL { ?panel tc:laenge_v3 ?laenge }
    OPTIONAL { ?panel tc:anzahl_der_Schichten_innerhalb_einer_BSP_Platte ?schichten }
    OPTIONAL { ?panel tc:pEFC ?pefc }
    OPTIONAL { ?panel tc:anstrich_vorhanden ?anstrich }
    OPTIONAL { ?panel tc:ist_Beginndatum ?produktionsdatum }
    OPTIONAL { ?panel tc:holzart_v3 ?panelHolzart }
    OPTIONAL { ?panel tc:hasArticle ?art . ?art tc:artikel ?artikel }
  }
  UNION
  {
    ?dop a tc:DeclarationOfPerformance .
    OPTIONAL { ?dop tc:title ?dopTitle }
    OPTIONAL { ?dop tc:intendedUse ?dopIntendedUse }
    OPTIONAL { ?dop tc:typeNumber ?dopTypeNumber }
    OPTIONAL { ?dop tc:manufacturer ?dopManufacturer }
    OPTIONAL { ?dop tc:manufacturerAddress ?dopAddress }
    OPTIONAL { ?dop tc:phone ?dopPhone }
    OPTIONAL { ?dop tc:fax ?dopFax }
    OPTIONAL { ?dop tc:contactInformation ?dopWebsite }
    OPTIONAL { ?dop tc:hazardousSubstanceEmission ?dopHazard }
    OPTIONAL { ?dop tc:holzart ?dopHolzart }
    OPTIONAL { ?dop tc:strengthClass ?dopStrengthClass }
    OPTIONAL { ?dop tc:epc ?dopEpc }
${identGuard(epcs, '?dopEpc')}
  }
  UNION
  {
    ?adhesive a tc:Adhesive .
    OPTIONAL { ?adhesive tc:name ?adhesiveName }
    OPTIONAL { ?adhesive tc:labeling ?adhesiveLabeling }
    OPTIONAL { ?adhesive tc:type ?adhesiveType }
    OPTIONAL { ?adhesive tc:epc ?adhesiveEpc }
${identGuard(epcs, '?adhesiveEpc')}
  }
}
`;
}

/**
 * Find data for a single GS1 identifier (SGTIN or LGTIN).
 *
 * This is the entry point for retrieval: a scanned EPC (resolved to a set of
 * related EPCs via the EPCAT repository) is looked up in the pod. Matches
 * three cases:
 *   - object level: SGTIN on a Stem/Log subject (StanForD HPR)
 *   - document level: LGTIN on an EpcisDocument (ELDAT)
 *   - product data: any subject carrying tc:epc — this covers everything the
 *     PDF mappings materialise (Certificate, TestReport, Adhesive, and their
 *     row subjects), whose rdf:type is NOT tc:EpcisDocument.
 *
 * Der dritte Zweig ist bewusst untypisiert: er darf nicht auf bekannte
 * Klassen eingeschraenkt werden, sonst faellt jede kuenftig hinzukommende
 * Dokumentart still aus der Abfrage heraus, obwohl ihr Ident im Graph steht.
 */
export function createEpcQuery(epc: string): string {
  return `${PREFIXES}
SELECT ?subject ?type ?epcisDoc ?bizTransaction ?quantity ?uom
WHERE {
  {
    ?subject tc:sgtin <${epc}> .
    OPTIONAL { ?subject rdf:type ?type }
    OPTIONAL { ?subject tc:hasEpcisEvent ?epcisDoc }
  } UNION {
    ?epcisDoc a tc:EpcisDocument ;
              tc:lgtin <${epc}> .
    OPTIONAL { ?epcisDoc tc:gs1Quantity ?quantity }
    OPTIONAL { ?epcisDoc tc:gs1Uom ?uom }
  } UNION {
    ?subject tc:epc <${epc}> .
    OPTIONAL { ?subject rdf:type ?type }
    OPTIONAL { ?subject tc:hasEpcisEvent ?epcisDoc }
  }
  OPTIONAL {
    ?epcisDoc tc:bizTransaction ?bizTransaction .
  }
}
`;
}

/**
 * Alle Produktdaten zu einem Ident — die Abfrage, die ein gescannter oder in
 * einem PDF gefundener Ident ausloest.
 *
 * Liefert jedes Subjekt, das den Ident traegt, mit allen seinen Aussagen.
 * Anders als createEpcQuery geht es hier nicht um die Zuordnung zu EPCIS,
 * sondern um den Inhalt: "was wissen wir ueber dieses Material?"
 */
export function createProductDataByEpcQuery(epc: string): string {
  // tc:sgtin und tc:lgtin sind Unter-Properties von tc:epc. Die Endpunkte
  // werten diese Hierarchie NICHT aus (kein Reasoner), deshalb muessen die
  // Unter-Properties hier ausdruecklich mitgefragt werden.
  //
  // Ohne sie faellt genau der Fall aus, um den es geht: der Ident eines
  // einzelnen Stammes/Abschnitts steht unter tc:sgtin an dessen Subjekt --
  // seine Messwerte (Durchmesser, Erntedatum, Position) waeren fuer diese
  // Abfrage unsichtbar, obwohl sie im Graph liegen.
  return `${PREFIXES}
SELECT ?subject ?type ?predicate ?value
WHERE {
  { ?subject tc:epc <${epc}> }
  UNION { ?subject tc:sgtin <${epc}> }
  UNION { ?subject tc:lgtin <${epc}> }
  ?subject ?predicate ?value .
  OPTIONAL { ?subject rdf:type ?type }
}
`;
}

/**
 * Alle Pflanzflaechen (aus Stammzertifikaten) mit ihrer Geometrie.
 *
 * Die Flaeche zeichnet der Nutzer beim Pflanzvorgang auf der Karte ein; sie
 * liegt als GeoSPARQL-WKT am Zertifikat, zusammen mit dem Zentroid und dem
 * EPC-Bezug auf das Vermehrungsgut.
 *
 * Der Punkt-in-Polygon-Test laeuft anschliessend clientseitig
 * (geoService.areasContaining) — die Pod-Endpunkte werten keine
 * GeoSPARQL-Filterfunktionen aus.
 */
export function createPlantingAreaQuery(): string {
  return `${PREFIXES}
SELECT ?certificate ?wkt ?lat ?long ?epc ?zertifikatNr ?baumart ?reifejahr
WHERE {
  # Die Flaeche haengt am Saatgut-Subjekt (tc:Seed), die Angaben zum Beleg
  # dagegen am Zertifikat. Seit beide getrennt sind, verbindet tc:describes
  # sie -- ohne diesen Weg lieferte die Abfrage zwar das Polygon, aber keine
  # Zertifikatsnummer und keine Baumart mehr, und jede Flaeche hiesse in der
  # Anzeige nur noch "Pflanzvorgang".
  #
  # Der Beleg-Teil ist OPTIONAL: Aeltere Datensaetze tragen die Flaeche noch
  # direkt am Zertifikat, dort bleibt ?doc ungebunden. Deshalb faellt die
  # Beschriftung ueber COALESCE auf das Flaechen-Subjekt selbst zurueck.
  ?area geosparql:asWKT ?wkt .
  OPTIONAL { ?doc tc:describes ?area }

  OPTIONAL { ?area geo:lat ?lat }
  OPTIONAL { ?area geo:long ?long }
  OPTIONAL { ?area tc:epc ?epcDirect }
  OPTIONAL { ?doc tc:epc ?epcDoc }
  OPTIONAL { ?doc tc:identifier ?nrDoc }
  OPTIONAL { ?area tc:identifier ?nrDirect }
  OPTIONAL { ?doc tc:species ?artDoc }
  OPTIONAL { ?area tc:species ?artDirect }
  OPTIONAL { ?doc tc:maturityYear ?jahrDoc }
  OPTIONAL { ?area tc:maturityYear ?jahrDirect }

  BIND(COALESCE(?doc, ?area) AS ?certificate)
  BIND(COALESCE(?epcDirect, ?epcDoc) AS ?epc)
  BIND(COALESCE(?nrDoc, ?nrDirect) AS ?zertifikatNr)
  BIND(COALESCE(?artDoc, ?artDirect) AS ?baumart)
  BIND(COALESCE(?jahrDoc, ?jahrDirect) AS ?reifejahr)
}
`;
}

/**
 * Die Pflanzflaeche zu einem konkreten Vermehrungsgut-EPC.
 *
 * Vorwaertsrichtung: "Wo wurde dieses Material gepflanzt?" — im Produktpass,
 * um den Ursprungsort auf der Karte zu zeigen.
 */
export function createPlantingAreaByEpcQuery(epc: string): string {
  return `${PREFIXES}
SELECT ?certificate ?wkt ?lat ?long ?zertifikatNr ?baumart
WHERE {
  # Wie in createPlantingAreaQuery: Flaeche am Saatgut, Belegangaben am
  # Zertifikat, verbunden ueber tc:describes. Der EPC steht an beiden, die
  # Bindung an <${epc}> greift also unabhaengig davon, welches Subjekt die
  # Flaeche traegt.
  ?area tc:epc <${epc}> ;
        geosparql:asWKT ?wkt .
  OPTIONAL { ?doc tc:describes ?area }

  OPTIONAL { ?area geo:lat ?lat }
  OPTIONAL { ?area geo:long ?long }
  OPTIONAL { ?doc tc:identifier ?nrDoc }
  OPTIONAL { ?area tc:identifier ?nrDirect }
  OPTIONAL { ?doc tc:species ?artDoc }
  OPTIONAL { ?area tc:species ?artDirect }

  BIND(COALESCE(?doc, ?area) AS ?certificate)
  BIND(COALESCE(?nrDoc, ?nrDirect) AS ?zertifikatNr)
  BIND(COALESCE(?artDoc, ?artDirect) AS ?baumart)
}
`;
}

/**
 * Merkmale des Anwendungsfalls "CO2-Bilanz" (Module A1-A5).
 *
 * Vier Quellen liefern die Eingangsgroessen der Berechnung (siehe
 * lcaService.ts) und die Zusatzinformationen der Informationsbedarfstiefe:
 *
 *   1. tc:Panel aus dem ERP-Vorgang -- Nettovolumen (M-927, die Pflicht-
 *      Bezugsgroesse), Gewicht/Abmessungen, die Gesamtmenge der Lieferung
 *      (M-997, tc:zu_liefernde_Menge_m) sowie Abhol-/Lieferort als
 *      A4-Fallback fuer die fehlende Boardcomputer-Strecke (M-849).
 *      Alle ERP-Felder haengen FLACH am Panel-Subjekt -- die Referenzpfade
 *      des Mappings (deliveryOrder.*, transportOrder.*) sind nur JSON-Pfade.
 *   2. tc:TransportOrder -- ZWEI Vorlagen mit verschiedenen Vokabularen
 *      (siehe createTransportOrdersQuery): der Rundholz-Auftrag traegt
 *      Strecke (M-665, tc:ladezone_Distanz) und Menge (M-675, als deutsche
 *      Formularwerte "18 km"/"13,20"!), der Schnittholz-Auftrag das
 *      Transportvolumen (Ersatz fuer M-584) und die Belade-/Entladeadressen
 *      fuer das A2-Geocoding (Adress-Beutel, Kreuzprodukt wie dort).
 *   3. tc:DeclarationOfPerformance -- Handelsname/Hersteller der Platte und
 *      der Schnittholzlamelle (zwei Dokumente, unterschieden am Titel).
 *   4. tc:Adhesive -- Produktbezeichnung des Klebstoffs (I-49).
 *
 * Bewusst OHNE traceId-Filter (die Dokumente haengen ueber tc:epc am
 * Material) und bewusst als EIGENE Query: die bestehenden Queries der
 * anderen Anwendungsfaelle werden nach Haus-Konvention nicht erweitert.
 */
export function createLcaQuery(epcs: string[] = []): string {
  // Die Platte traegt ihren Ident auf tc:epc (erp_bsp.rml.ttl) -- daran haengt
  // die Schranke. Die uebrigen Sparten (Transportauftrag, Leistungserklaerung,
  // Klebstoff) binden hier keinen eigenen Ident und bleiben ungefiltert; sie
  // haengen ueber ihre Subjekte an derselben Datei.
  return `${PREFIXES}
SELECT ?panel ?panelEpc ?nettovolumen ?nettogewicht ?gesamtmengeBsp ?hoehe ?breite ?laenge
       ?schichten ?oberflaeche ?produktnorm ?pefc ?holzart ?beschreibung ?artikel
       ?abholungPlz ?abholungOrt ?lieferungPlz ?lieferungOrt
       ?order ?ladezoneDistanz ?mengeFestmeter ?summeFestmeter ?orderVolume
       ?loadingAddress ?unloadingAddress
       ?dop ?dopTitle ?dopTypeNumber ?dopManufacturer ?dopIntendedUse ?dopHolzart
       ?adhesive ?adhesiveName
WHERE {
  {
    ?panel a tc:Panel .
    OPTIONAL { ?panel tc:nettovolumen_Produkt ?nettovolumen }
    OPTIONAL { ?panel tc:nettogewicht ?nettogewicht }
    OPTIONAL { ?panel tc:zu_liefernde_Menge_m ?gesamtmengeBsp }
    OPTIONAL { ?panel tc:hoehe__Staerke ?hoehe }
    OPTIONAL { ?panel tc:breite ?breite }
    OPTIONAL { ?panel tc:laenge_v3 ?laenge }
    OPTIONAL { ?panel tc:epc ?panelEpc }
${identGuard(epcs, '?panelEpc')}
    OPTIONAL { ?panel tc:anzahl_der_Schichten_innerhalb_einer_BSP_Platte ?schichten }
    OPTIONAL { ?panel tc:oberflaeche_einer_Plattenseite ?oberflaeche }
    OPTIONAL { ?panel tc:produktnorm ?produktnorm }
    OPTIONAL { ?panel tc:pEFC ?pefc }
    OPTIONAL { ?panel tc:holzart_v3 ?holzart }
    OPTIONAL { ?panel tc:beschreibung_Freitext ?beschreibung }
    OPTIONAL { ?panel tc:abholung_PLZ ?abholungPlz }
    OPTIONAL { ?panel tc:abholung_Ort ?abholungOrt }
    OPTIONAL { ?panel tc:lieferung_PLZ ?lieferungPlz }
    OPTIONAL { ?panel tc:lieferung_Ort ?lieferungOrt }
    OPTIONAL { ?panel tc:hasArticle ?art . ?art tc:artikel ?artikel }
  }
  UNION
  {
    ?order a tc:TransportOrder .
    OPTIONAL { ?order tc:epc ?orderEpc }
${identGuard(epcs, '?orderEpc')}
    # Rundholz-Vorlage (flach, deutsche Feldnamen)
    OPTIONAL { ?order tc:ladezone_Distanz ?ladezoneDistanz }
    OPTIONAL { ?order tc:menge_Festmeter ?mengeFestmeter }
    OPTIONAL { ?order tc:summe_Festmeter ?summeFestmeter }
    # Schnittholz-Vorlage (Volumen am Auftrag, Adressen am Lieferauftrag)
    OPTIONAL { ?order tc:volume ?orderVolume }
    OPTIONAL {
      ?order tc:hasDeliveryOrder ?delivery .
      OPTIONAL { ?delivery tc:loadingAddress ?loadingAddress }
      OPTIONAL { ?delivery tc:unloadingAddress ?unloadingAddress }
    }
  }
  UNION
  {
    ?dop a tc:DeclarationOfPerformance .
    OPTIONAL { ?dop tc:title ?dopTitle }
    OPTIONAL { ?dop tc:typeNumber ?dopTypeNumber }
    OPTIONAL { ?dop tc:manufacturer ?dopManufacturer }
    OPTIONAL { ?dop tc:intendedUse ?dopIntendedUse }
    OPTIONAL { ?dop tc:holzart ?dopHolzart }
    # Zwei Vorlagen, zwei Anker: die BSP-Leistungserklaerung traegt tc:epc
    # selbst, die Saegewerk-Variante haengt ihn an den tc:SawingProcess
    # (pdf_leistungserklaerung.rml.ttl). Beide Wege gelten.
    OPTIONAL { ?dop tc:epc ?dopEpc }
${dopIdentGuard(epcs)}
  }
  UNION
  {
    ?adhesive a tc:Adhesive .
    OPTIONAL { ?adhesive tc:name ?adhesiveName }
    OPTIONAL { ?adhesive tc:epc ?adhesiveEpc }
${identGuard(epcs, '?adhesiveEpc')}
  }
}
`;
}

/**
 * List all GS1 identifiers (EPCs) present in a pod.
 *
 * Speist die Materialauswahl beim PDF-Transfer. Bewusst NICHT auf
 * tc:EpcisDocument eingeschraenkt: Idente haengen auch an Produktdaten aus
 * PDFs (Certificate, TestReport, ...) und an Stem/Log aus Maschinendaten.
 * Die frueher hier verlangte Klasse hat genau diese Idente ausgeblendet — im
 * Pod vorhanden, in der Auswahl unsichtbar.
 */
export function createEpcListQuery(): string {
  return `${PREFIXES}
SELECT ?epcisDoc ?bizTransaction ?epc
WHERE {
  ?epcisDoc tc:epc ?epc .
  OPTIONAL { ?epcisDoc tc:bizTransaction ?bizTransaction }
}
`;
}

/**
 * Merkmale des Anwendungsfalls "Dokumentation" (I-78..I-89 sowie die
 * Ergaenzungen I-59/I-60/I-57 gegenueber der Rueckbaubarkeit).
 *
 * Der Awf "Dokumentation" bezieht den GROESSTEN Teil seiner
 * Informationsanforderungen aus Quellen, die createDeconstructionQuery bereits
 * abfragt (ERP-Panel, Leistungserklaerung, Klebstoff) -- Handelsname, Holzart,
 * Abmessungen und die komplette Herstelleranschrift sind dort deckungsgleich.
 * Diese Query holt deshalb NUR das, was dort fehlt:
 *
 *   1. tc:BuildingPart -- die Verortung im Gebaeude (I-79..I-87) aus der
 *      Ausfuehrungsplanung (IFC, M-1168..M-1180). Das ist die Kategorie, die
 *      der Awf gegenueber der Rueckbaubarkeit neu einfuehrt.
 *   2. tc:ConstructionProject -- das Bauvorhaben oberhalb des Geschosses.
 *   3. tc:Panel -- Nettogewicht (I-59, M-992), Oberflaeche einer Plattenseite
 *      (I-60, M-956) und Produktnorm (I-57, M-946). Die Rueckbaubarkeit
 *      braucht sie nicht, die Dokumentation schon.
 *
 * Bewusst OHNE traceId-Filter und als EIGENE Query -- wie bei den uebrigen
 * Anwendungsfaellen werden bestehende Queries nicht erweitert, damit ein
 * neuer Fall keinen alten veraendert.
 */
export function createDocumentationQuery(epcs: string[] = []): string {
  // Die Platte traegt ihren Ident auf tc:epc (erp_bsp.rml.ttl) -- daran haengt
  // die Schranke. Die IFC-Sparten (BuildingElement, Project) binden hier
  // keinen eigenen Ident; sie kommen aus der Planungsdatei des Projekts.
  return `${PREFIXES}
SELECT ?buildingElement ?panelEpc ?ifcGlobalId ?ifcTyp ?planBezeichnung ?planMaterial
       ?planBauteil ?geschoss ?bauabschnitt ?teilgruppe ?einbau
       ?noProductionList ?sku ?abbundBvn ?sichtqualitaet
       ?ifcSchema ?planSourceFile
       ?geplanteNettoflaeche ?geplantesNettovolumen
       ?geplanteHoehe ?geplanteBreite ?geplanteLaenge
       ?project ?projektnummer ?projektname ?projektphase
       ?panel ?nettogewicht ?oberflaeche ?produktnorm ?beschreibung
WHERE {
  {
    ?buildingElement a tc:BuildingElement .
    OPTIONAL { ?buildingElement tc:epc ?buildingElementEpc }
${identGuard(epcs, '?buildingElementEpc')}
    OPTIONAL { ?buildingElement tc:ifcGlobalId ?ifcGlobalId }
    OPTIONAL { ?buildingElement tc:ifcClass ?ifcTyp }
    OPTIONAL { ?buildingElement tc:name ?planBezeichnung }
    OPTIONAL { ?buildingElement tc:revitType ?planMaterial }
    OPTIONAL { ?buildingElement tc:ifcObjectType ?planBauteil }
    OPTIONAL { ?buildingElement tc:buildingStorey ?geschoss }
    OPTIONAL { ?buildingElement tc:constructionPhase ?bauabschnitt }
    OPTIONAL { ?buildingElement tc:assemblyGroup ?teilgruppe }
    OPTIONAL { ?buildingElement tc:deliveryPhase ?einbau }
    OPTIONAL { ?buildingElement tc:productionListNumber ?noProductionList }
    OPTIONAL { ?buildingElement tc:sku ?sku }
    OPTIONAL { ?buildingElement tc:productionNumber ?abbundBvn }
    OPTIONAL { ?buildingElement tc:surfaceQuality ?sichtqualitaet }
    OPTIONAL { ?buildingElement tc:ifcSchema ?ifcSchema }
    OPTIONAL { ?buildingElement tc:fileName ?planSourceFile }
    OPTIONAL { ?buildingElement tc:area ?geplanteNettoflaeche }
    OPTIONAL { ?buildingElement tc:volume ?geplantesNettovolumen }
    OPTIONAL { ?buildingElement tc:height ?geplanteHoehe }
    OPTIONAL { ?buildingElement tc:width ?geplanteBreite }
    OPTIONAL { ?buildingElement tc:length ?geplanteLaenge }
  }
  UNION
  {
    # Das Projekt traegt keinen eigenen Ident, haengt aber per
    # tc:belongsToProject am BuildingElement, das einen hat (ifc_planung.rml.ttl).
    ?project a tc:Project .
    OPTIONAL { ?project tc:projectNumber ?projektnummer }
    OPTIONAL { ?project tc:projectName ?projektname }
    OPTIONAL { ?project tc:projectPhase ?projektphase }
${relatedIdentGuard(epcs, '?project', 'tc:belongsToProject')}
  }
  UNION
  {
    ?panel a tc:Panel .
    OPTIONAL { ?panel tc:nettogewicht ?nettogewicht }
    OPTIONAL { ?panel tc:oberflaeche_einer_Plattenseite ?oberflaeche }
    OPTIONAL { ?panel tc:produktnorm ?produktnorm }
    OPTIONAL { ?panel tc:beschreibung_Freitext ?beschreibung }
    OPTIONAL { ?panel tc:epc ?panelEpc }
${identGuard(epcs, '?panelEpc')}
  }
}
`;
}

/**
 * Merkmale des Anwendungsfalls "Nachweis der Haftung" (I-1..I-44).
 *
 * Der Awf weist aus versicherungstechnischer Sicht nach, OB und in WELCHER
 * Herstellungsstufe eine Abweichung von den geforderten Eigenschaften vorlag
 * (Festigkeit, Verklebung, Feuchte) und WELCHER Akteur dafuer verantwortlich
 * war. EPCIS liefert dazu nur das Geruest -- das "WAS/WANN" der Objektkette;
 * das "WIE GUT" steht ausschliesslich in den Dokumentquellen. Genau die holt
 * diese Query.
 *
 * Der Befund, der diesen Fall traegt: die RML-Mappings schreiben die
 * Pruefwerte laengst in den Pod (pdf_biegepruefung, pdf_leistungserklaerung,
 * pdf_leistungserklaerung_bsp, pdf_klebstoffdatenblatt), aber KEINE bestehende
 * Query hat sie je gelesen. tc:bendingStrength, tc:density, tc:testerName,
 * tc:curingType, tc:qS_Kontrolle & Co. kamen in dieser Datei bis hierher kein
 * einziges Mal vor -- im Pod vorhanden, in der Anwendung unsichtbar.
 *
 * Fuenf UNION-Bloecke, die sich NICHT mit createDeconstructionQuery
 * ueberschneiden (Panel-Stammdaten, DoP-Anschrift und Klebstoffname kommen von
 * dort und werden im Mapper wiederverwendet, nicht erneut abgefragt):
 *
 *   1. tc:TestReport / tc:BendingTest -- die Biegepruefung der Lamelle
 *      (I-10..I-15). Zwei Subjekte, kein Fehler: der Bericht traegt Pruefer
 *      und Druckzeitpunkt, die einzelne PROBE traegt Probennummer und
 *      Messwerte (siehe pdf_biegepruefung.rml.ttl -- ein Subjekt je Zeile).
 *   2. Leistungserklaerung SCHNITTHOLZ (I-7..I-9): Konformitaetssystem,
 *      notifizierte Stelle, Zertifikatsnummer.
 *   3. Leistungserklaerung BSP (I-26..I-40): Feuchte im Lieferzustand,
 *      Delaminierung, Biegefestigkeit und Rollschub.
 *   4. tc:Adhesive -- Aushaertung, Lagerbedingungen und der explizit
 *      haftungsdefinierende Haftungsausschluss (I-18..I-21).
 *   5. tc:Panel -- zustaendiger Mitarbeiter (I-24, M-984) und QS-Kontrolle
 *      (I-25, M-1026). Die einzigen beiden M-IDs der Awf-Tabelle, die in der
 *      Ontologie v6 ueberhaupt als skos:notation aufloesen.
 *
 * Beide Leistungserklaerungen tragen DIESELBE Klasse
 * tc:DeclarationOfPerformance -- sie lassen sich per rdf:type nicht trennen.
 * Getrennt wird deshalb ueber die Praedikate, die nur je eine von beiden fuehrt
 * (tc:zertifikatsnummer beim Schnittholz, tc:moistureContent beim BSP); die
 * Zuordnung selbst passiert im Mapper.
 *
 * Der letzte Block liest die im Anwendungsfall selbst erfassten
 * Schadensmeldungen (tc:DamageReport, siehe damageReportService.ts) zurueck,
 * damit eine gespeicherte Meldung nach dem Neuladen wieder erscheint.
 *
 * Bewusst OHNE traceId-Filter und als EIGENE Query -- Hauskonvention: ein
 * neuer Anwendungsfall veraendert keinen alten.
 */
export function createLiabilityQuery(epcs: string[] = []): string {
  return `${PREFIXES}
SELECT ?report ?reportEpc ?tester ?testDateTime ?printedAt
       ?sample ?sampleId ?sampleEpc ?maxForce ?testSpeed
       ?dop ?dopEpc ?conformitySystem ?notifiedBody ?zertifikatsnummer
       ?dopDensity ?dopBendingStrength ?dopDurability ?dopSpecies
       ?bspDop ?bspEpc ?moistureContent ?delamination ?bendingFlatwise
       ?rollingShear ?bspStrengthClass ?bspAdhesiveType ?bspStandard
       ?adhesive ?adhesiveEpc ?adhesiveProductName ?curingType
       ?storageConditions ?safetyNote ?processingNote
       ?panel ?mitarbeiter ?qsKontrolle
       ?damage ?damageEpc ?damageDate ?damageKind ?damageDescription
       ?damageReporter ?damageMoisture ?damageCreated
WHERE {
  {
    # 1a. Pruefbericht Biegepruefung -- Kopfdaten (I-14, I-15)
    ?report a tc:TestReport .
    OPTIONAL { ?report tc:epc ?reportEpc }
${identGuard(epcs, '?reportEpc')}
    OPTIONAL { ?report tc:testerName ?tester }
    OPTIONAL { ?report tc:dateTime ?testDateTime }
    OPTIONAL { ?report tc:printedAt ?printedAt }
  }
  UNION
  {
    # 1b. Einzelne Probe (I-13) -- eigenes Subjekt je Tabellenzeile
    ?sample a tc:BendingTest .
    OPTIONAL { ?sample tc:sampleId ?sampleId }
    OPTIONAL { ?sample tc:epc ?sampleEpc }
${identGuard(epcs, '?sampleEpc')}
    OPTIONAL { ?sample tc:maxForce ?maxForce }
    OPTIONAL { ?sample tc:testSpeed ?testSpeed }
    OPTIONAL { ?sample tc:dateTime ?testDateTime }
    OPTIONAL { ?sample tc:testerName ?tester }
  }
  UNION
  {
    # 2. Leistungserklaerung Schnittholzlamelle (I-7..I-12)
    ?dop a tc:DeclarationOfPerformance .
    ?dop tc:zertifikatsnummer ?zertifikatsnummer .
    OPTIONAL { ?dop tc:epc ?dopEpc }
${identGuard(epcs, '?dopEpc')}
    OPTIONAL { ?dop tc:conformitySystem ?conformitySystem }
    OPTIONAL { ?dop tc:notifiedBody ?notifiedBody }
    OPTIONAL { ?dop tc:density ?dopDensity }
    OPTIONAL { ?dop tc:bendingStrength ?dopBendingStrength }
    OPTIONAL { ?dop tc:durabilityClass ?dopDurability }
    OPTIONAL { ?dop tc:species ?dopSpecies }
  }
  UNION
  {
    # 3. Leistungserklaerung Brettsperrholz (I-26..I-40)
    ?bspDop a tc:DeclarationOfPerformance .
    ?bspDop tc:moistureContent ?moistureContent .
    OPTIONAL { ?bspDop tc:epc ?bspEpc }
${identGuard(epcs, '?bspEpc')}
    OPTIONAL { ?bspDop tc:delaminationResistance ?delamination }
    OPTIONAL { ?bspDop tc:bendingStrengthFlatwise ?bendingFlatwise }
    OPTIONAL { ?bspDop tc:rollingShearStrength ?rollingShear }
    OPTIONAL { ?bspDop tc:strengthClass ?bspStrengthClass }
    OPTIONAL { ?bspDop tc:adhesiveType ?bspAdhesiveType }
    OPTIONAL { ?bspDop tc:standardReference ?bspStandard }
  }
  UNION
  {
    # 4. Technisches Datenblatt Klebstoff (I-18..I-21)
    ?adhesive a tc:Adhesive .
    OPTIONAL { ?adhesive tc:epc ?adhesiveEpc }
${identGuard(epcs, '?adhesiveEpc')}
    OPTIONAL { ?adhesive tc:productName ?adhesiveProductName }
    OPTIONAL { ?adhesive tc:curingType ?curingType }
    OPTIONAL { ?adhesive tc:storageConditions ?storageConditions }
    OPTIONAL { ?adhesive tc:safetyNote ?safetyNote }
    OPTIONAL { ?adhesive tc:processingNote ?processingNote }
  }
  UNION
  {
    # 5. ERP-Fertigung (I-24 M-984, I-25 M-1026)
    ?panel a tc:Panel .
    OPTIONAL { ?panel tc:epc ?panelEpc }
${identGuard(epcs, '?panelEpc')}
    OPTIONAL { ?panel tc:zustaendiger_Mitarbeiter ?mitarbeiter }
    OPTIONAL { ?panel tc:qS_Kontrolle ?qsKontrolle }
  }
  UNION
  {
    # 6. Im Anwendungsfall erfasste Schadensmeldungen
    ?damage a tc:DamageReport .
    OPTIONAL { ?damage tc:epc ?damageEpc }
${identGuard(epcs, '?damageEpc')}
    OPTIONAL { ?damage tc:damageDate ?damageDate }
    OPTIONAL { ?damage tc:damageKind ?damageKind }
    OPTIONAL { ?damage tc:description ?damageDescription }
    OPTIONAL { ?damage tc:reportedBy ?damageReporter }
    OPTIONAL { ?damage tc:moistureMeasured ?damageMoisture }
    OPTIONAL { ?damage tc:created ?damageCreated }
  }
}
`;
}

/**
 * Digitaler Bauproduktpass (DBPP).
 *
 * Der Anwendungsfall zeigt die Daten dieses Bauteils in der Gliederung, die
 * die EU fuer einen digitalen Produktpass vorsieht -- und macht sichtbar,
 * welche der dort geforderten Angaben der Datenraum heute schon hergibt.
 *
 * Zwei Rechtsakte geben die Kategorien vor:
 *   - Bauprodukteverordnung (EU) 2024/3110, Kapitel X (Art. 75-80). Art. 76
 *     zaehlt den Pflichtinhalt auf: Leistungs- und Konformitaetserklaerung
 *     (Art. 15) samt REACH-Art.-31/33-Angaben, allgemeine Produktinformation
 *     und Sicherheitshinweise (Anhang IV), technische Dokumentation,
 *     Umweltkennzeichnung und die eindeutigen Kennungen nach Art. 79.
 *   - Oekodesign-Verordnung (EU) 2024/1781 (ESPR) mit den vier persistenten
 *     Kennungen: Produkt, Wirtschaftsakteur, Betriebsstaette, Register.
 *
 * Sechs UNION-Bloecke. Sie ueberschneiden sich bewusst teilweise mit
 * createDeconstructionQuery und createLiabilityQuery: dieselbe Angabe wird in
 * einem anderen Zusammenhang gebraucht, und die Hauskonvention lautet, dass
 * ein neuer Anwendungsfall keine bestehende Query veraendert. Eine eigene
 * Query kostet einen Roundtrip, ein geteiltes SELECT kostet irgendwann einen
 * Anwendungsfall.
 *
 *   1. tc:Panel -- Identitaet, Geometrie, Fertigung (ERP-Excel). Traegt mit
 *      tc:epc die eindeutige Produktkennung und mit tc:derivedFrom die
 *      Vorprodukte, aus denen die Platte entstanden ist.
 *   2. Leistungserklaerung BSP -- die eigentliche DoPC des Bauteils.
 *   3. Leistungserklaerung SCHNITTHOLZ -- die DoPC der Lamelle, eine Stufe
 *      darunter. Wie in createLiabilityQuery ueber das jeweils exklusive
 *      Praedikat getrennt (tc:moistureContent vs. tc:zertifikatsnummer), weil
 *      beide DIESELBE Klasse tc:DeclarationOfPerformance tragen.
 *   4. tc:Adhesive -- Materialzusammensetzung und Sicherheitshinweis.
 *   5. tc:BuildingElement + tc:Project -- Verortung im Gebaeude aus der
 *      Ausfuehrungsplanung (IFC).
 *   6. tc:Certificate -- Herkunftsgebiet und Registerzeichen aus dem
 *      Stammzertifikat; die Datengrundlage fuer den EUDR-Nachweis.
 *
 * NICHT hier abgefragt werden Wald- und Lieferkettendaten (Forstamt, Revier,
 * Erntedatum, Erntekoordinaten, FSC/PEFC am Stamm). Die liegen bereits in
 * data.stem und data.forest; der Mapper liest sie von dort. Sie ein zweites
 * Mal zu holen hiesse, zwei Wahrheiten zu pflegen.
 *
 * Bewusst OHNE traceId-Filter -- eingegrenzt wird ueber die Auswahl der
 * abgefragten Quellen.
 */
export function createDbppQuery(epcs: string[] = []): string {
  return `${PREFIXES}
SELECT ?panel ?panelEpc ?panelDerivedFrom ?artikel
       ?panelHoehe ?panelBreite ?panelLaenge ?panelVolumen ?panelGewicht
       ?panelFlaeche ?panelHolzart ?panelFestigkeit ?panelNorm
       ?panelBrandschutz ?panelSchichten ?panelPefc ?panelAnstrich
       ?panelStandort ?panelDatum ?rechnungsempfaenger ?rechnungsAdresse
       ?bspDop ?bspEpc ?bspMoisture ?bspStrengthClass ?bspAdhesiveType
       ?bspDelamination ?bspServiceClass ?bspDurability ?bspFireClass
       ?bspCharring ?bspThermal ?bspVapour ?bspAirborneSound ?bspImpactSound
       ?bspHazard ?bspManufacturer ?bspAddress ?bspNotifiedBody
       ?bspConformity ?bspStandard ?bspIntendedUse
       ?dop ?dopEpc ?dopZertifikatsnummer ?dopSpecies ?dopDensity
       ?dopBendingStrength ?dopDurability ?dopHazard
       ?adhesive ?adhesiveEpc ?adhesiveName ?adhesiveProductName
       ?adhesiveType ?adhesiveBaseMaterial ?adhesiveLabeling ?adhesiveSafety
       ?element ?elementIfcId ?elementIfcClass ?elementStorey ?elementName
       ?elementMaterial ?elementVolume ?elementArea
       ?project ?projectName ?projectNumber
       ?certificate ?certEpc ?certIdentifier ?certSpecies
       ?certProvenanceName ?certProvenanceNumber ?certOrigin
       ?certCountry ?certRegisterSign
WHERE {
  {
    # 1. ERP-Fertigung: Identitaet, Geometrie, Materialkennwerte
    ?panel a tc:Panel .
    OPTIONAL { ?panel tc:epc ?panelEpc }
${identGuard(epcs, '?panelEpc')}
    OPTIONAL { ?panel tc:derivedFrom ?panelDerivedFrom }
    OPTIONAL { ?panel tc:hoehe__Staerke ?panelHoehe }
    OPTIONAL { ?panel tc:breite ?panelBreite }
    OPTIONAL { ?panel tc:laenge_v3 ?panelLaenge }
    OPTIONAL { ?panel tc:nettovolumen_Produkt ?panelVolumen }
    OPTIONAL { ?panel tc:nettogewicht ?panelGewicht }
    OPTIONAL { ?panel tc:quadratmeter_aller_6_Plattenseiten ?panelFlaeche }
    OPTIONAL { ?panel tc:holzart_v3 ?panelHolzart }
    OPTIONAL { ?panel tc:festigkeit__Material_Produkt ?panelFestigkeit }
    OPTIONAL { ?panel tc:produktnorm ?panelNorm }
    OPTIONAL { ?panel tc:brandschutzklasse_Produkt ?panelBrandschutz }
    OPTIONAL { ?panel tc:anzahl_der_Schichten_innerhalb_einer_BSP_Platte ?panelSchichten }
    OPTIONAL { ?panel tc:pEFC ?panelPefc }
    OPTIONAL { ?panel tc:anstrich_vorhanden ?panelAnstrich }
    OPTIONAL { ?panel tc:produktionsstandort ?panelStandort }
    OPTIONAL { ?panel tc:ist_Beginndatum ?panelDatum }
    OPTIONAL { ?panel tc:hasArticle ?art . ?art tc:artikel ?artikel }
    OPTIONAL {
      ?panel tc:hasInvoice ?inv .
      OPTIONAL { ?inv tc:rechnungsempfaenger_Name ?rechnungsempfaenger }
      OPTIONAL { ?inv tc:rechnungsempfaenger_Adresse ?rechnungsAdresse }
    }
  }
  UNION
  {
    # 2. Leistungserklaerung Brettsperrholz -- die DoPC des Bauteils.
    #    tc:moistureContent fuehrt nur diese, nicht die Schnittholz-DoP.
    ?bspDop a tc:DeclarationOfPerformance .
    ?bspDop tc:moistureContent ?bspMoisture .
    OPTIONAL { ?bspDop tc:epc ?bspEpc }
${identGuard(epcs, '?bspEpc')}
    OPTIONAL { ?bspDop tc:strengthClass ?bspStrengthClass }
    OPTIONAL { ?bspDop tc:adhesiveType ?bspAdhesiveType }
    OPTIONAL { ?bspDop tc:delaminationResistance ?bspDelamination }
    OPTIONAL { ?bspDop tc:serviceClass ?bspServiceClass }
    OPTIONAL { ?bspDop tc:durabilityClass ?bspDurability }
    OPTIONAL { ?bspDop tc:fireResistanceClass ?bspFireClass }
    OPTIONAL { ?bspDop tc:charringRate ?bspCharring }
    OPTIONAL { ?bspDop tc:thermalTransmittance ?bspThermal }
    OPTIONAL { ?bspDop tc:vapourDiffusionResistance ?bspVapour }
    OPTIONAL { ?bspDop tc:airborneSoundInsulation ?bspAirborneSound }
    OPTIONAL { ?bspDop tc:impactSoundInsulation ?bspImpactSound }
    OPTIONAL { ?bspDop tc:hazardousSubstanceEmission ?bspHazard }
    OPTIONAL { ?bspDop tc:manufacturer ?bspManufacturer }
    OPTIONAL { ?bspDop tc:manufacturerAddress ?bspAddress }
    OPTIONAL { ?bspDop tc:notifiedBody ?bspNotifiedBody }
    OPTIONAL { ?bspDop tc:conformitySystem ?bspConformity }
    OPTIONAL { ?bspDop tc:standardReference ?bspStandard }
    OPTIONAL { ?bspDop tc:intendedUse ?bspIntendedUse }
  }
  UNION
  {
    # 3. Leistungserklaerung Schnittholz -- die DoPC der Lamelle
    ?dop a tc:DeclarationOfPerformance .
    ?dop tc:zertifikatsnummer ?dopZertifikatsnummer .
    OPTIONAL { ?dop tc:epc ?dopEpc }
${identGuard(epcs, '?dopEpc')}
    OPTIONAL { ?dop tc:species ?dopSpecies }
    OPTIONAL { ?dop tc:density ?dopDensity }
    OPTIONAL { ?dop tc:bendingStrength ?dopBendingStrength }
    OPTIONAL { ?dop tc:durabilityClass ?dopDurability }
    OPTIONAL { ?dop tc:hazardousSubstanceEmission ?dopHazard }
  }
  UNION
  {
    # 4. Klebstoff -- Materialzusammensetzung und Sicherheitshinweis
    ?adhesive a tc:Adhesive .
    OPTIONAL { ?adhesive tc:epc ?adhesiveEpc }
${identGuard(epcs, '?adhesiveEpc')}
    OPTIONAL { ?adhesive tc:name ?adhesiveName }
    OPTIONAL { ?adhesive tc:productName ?adhesiveProductName }
    OPTIONAL { ?adhesive tc:type ?adhesiveType }
    OPTIONAL { ?adhesive tc:baseMaterial ?adhesiveBaseMaterial }
    OPTIONAL { ?adhesive tc:labeling ?adhesiveLabeling }
    OPTIONAL { ?adhesive tc:safetyNote ?adhesiveSafety }
  }
  UNION
  {
    # 5. Ausfuehrungsplanung (IFC) -- Verortung im Gebaeude
    ?element a tc:BuildingElement .
    OPTIONAL { ?element tc:epc ?elementEpc }
${identGuard(epcs, '?elementEpc')}
    OPTIONAL { ?element tc:ifcGlobalId ?elementIfcId }
    OPTIONAL { ?element tc:ifcClass ?elementIfcClass }
    OPTIONAL { ?element tc:buildingStorey ?elementStorey }
    OPTIONAL { ?element tc:name ?elementName }
    OPTIONAL { ?element tc:revitType ?elementMaterial }
    OPTIONAL { ?element tc:volume ?elementVolume }
    OPTIONAL { ?element tc:area ?elementArea }
    OPTIONAL {
      ?element tc:belongsToProject ?project .
      OPTIONAL { ?project tc:projectName ?projectName }
      OPTIONAL { ?project tc:projectNumber ?projectNumber }
    }
  }
  UNION
  {
    # 6. Stammzertifikat -- Herkunftsgebiet, Grundlage des EUDR-Nachweises
    ?certificate a tc:Certificate .
    OPTIONAL { ?certificate tc:epc ?certEpc }
${identGuard(epcs, '?certEpc')}
    OPTIONAL { ?certificate tc:identifier ?certIdentifier }
    OPTIONAL { ?certificate tc:species ?certSpecies }
    OPTIONAL { ?certificate tc:provenanceRegionName ?certProvenanceName }
    OPTIONAL { ?certificate tc:provenanceRegionNumber ?certProvenanceNumber }
    OPTIONAL { ?certificate tc:origin ?certOrigin }
    OPTIONAL { ?certificate tc:sourceMaterialCountry ?certCountry }
    OPTIONAL { ?certificate tc:registerSign ?certRegisterSign }
  }
}
`;
}
