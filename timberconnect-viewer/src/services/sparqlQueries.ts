/**
 * Predefined SPARQL Queries for TimberConnect
 *
 * These queries are used to fetch product and supply chain data
 * from Solid Pods containing RDF/TTL files.
 */

import { NAMESPACES } from '../config/solidPods';

// SPARQL Prefix declarations
const PREFIXES = `
PREFIX tc: <${NAMESPACES.tc}>
PREFIX tcr: <${NAMESPACES.tcr}>
PREFIX eldat: <${NAMESPACES.eldat}>
PREFIX vlex: <${NAMESPACES.vlex}>
PREFIX geo: <${NAMESPACES.geo}>
PREFIX xsd: <${NAMESPACES.xsd}>
PREFIX rdf: <${NAMESPACES.rdf}>
PREFIX rdfs: <${NAMESPACES.rdfs}>
`;

/**
 * Query for BSP Panel product data (final product)
 * Simplified query that works better with Comunica
 */
export function createProductQuery(traceId: string): string {
  return `${PREFIXES}
SELECT ?panel ?artikel ?traceId ?fsc ?pefc
       ?holzart ?holzartBezeichnung ?festigkeit
       ?laenge ?breite ?hoehe
       ?beschreibung ?status
WHERE {
  ?panel a vlex:BSPPanel ;
         tc:traceId "${traceId}" ;
         tc:traceId ?traceId .

  OPTIONAL { ?panel vlex:artikel ?artikel }
  OPTIONAL { ?panel tc:fscCertification ?fsc }
  OPTIONAL { ?panel tc:pefcCertification ?pefc }

  OPTIONAL {
    ?panel vlex:hasConfiguration ?config .
    ?config vlex:holzart ?holzart .
  }
  OPTIONAL {
    ?panel vlex:hasConfiguration ?config2 .
    ?config2 vlex:holzartBezeichnung ?holzartBezeichnung .
  }
  OPTIONAL {
    ?panel vlex:hasConfiguration ?config3 .
    ?config3 vlex:festigkeit ?festigkeit .
  }

  OPTIONAL {
    ?panel vlex:hasDimension ?dim .
    ?dim vlex:laengeGesamt ?laenge .
  }
  OPTIONAL {
    ?panel vlex:hasDimension ?dim2 .
    ?dim2 vlex:breite ?breite .
  }
  OPTIONAL {
    ?panel vlex:hasDimension ?dim3 .
    ?dim3 vlex:hoehe ?hoehe .
  }

  OPTIONAL {
    ?panel vlex:hasProduction ?prod .
    ?prod vlex:beschreibung ?beschreibung .
  }
  OPTIONAL {
    ?panel vlex:hasProduction ?prod2 .
    ?prod2 vlex:status ?status .
  }
}
LIMIT 1
`;
}

/**
 * Query for forest source data (origin)
 */
export function createForestQuery(traceId: string): string {
  return `${PREFIXES}
SELECT ?forestryOffice ?district ?harvestDate ?stemKey ?lat ?long
WHERE {
  ?source a tc:ForestSource ;
          tc:stemKey ?stemKey .

  OPTIONAL { ?source tc:forestryOffice ?forestryOffice }
  OPTIONAL { ?source tc:district ?district }
  OPTIONAL { ?source tc:harvestDate ?harvestDate }

  FILTER(?stemKey = "${traceId}")
}
LIMIT 1
`;
}

/**
 * Query for stem data (raw forest data from StanForD HPR file)
 * The stem data is in 01_Forst_StanForD_HPR.ttl with stemKey matching traceId
 */
export function createStemQuery(traceId: string): string {
  return `${PREFIXES}
SELECT ?stem ?forestryOffice ?district ?harvestDate ?dbh ?fsc ?pefc ?lat ?long ?alt ?species
       ?analyzedLength ?referenceDiameter ?destinationSawmill ?gnssQuality ?stemNumber
       ?horizontalAccuracy ?verticalAccuracy ?satellitesInUse
WHERE {
  ?stem a tc:Stem ;
        tc:stemKey "${traceId}" .

  OPTIONAL { ?stem tc:forestryOffice ?forestryOffice }
  OPTIONAL { ?stem tc:district ?district }
  OPTIONAL { ?stem tc:harvestDate ?harvestDate }
  OPTIONAL { ?stem tc:dbh ?dbh }
  OPTIONAL { ?stem tc:fscCertification ?fsc }
  OPTIONAL { ?stem tc:pefcCertification ?pefc }
  OPTIONAL { ?stem tc:speciesGroupKey ?species }
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
}
LIMIT 1
`;
}

/**
 * Query for sawmill/polter data (from ELDAT HBA file)
 * Gets polter details including volume, pieces, and delivery date from WoodAllocation
 */
export function createSawmillQuery(traceId: string): string {
  return `${PREFIXES}
SELECT ?company ?deliveryDate ?polterId ?totalVolume ?totalPieces ?polterLat ?polterLong ?destinationProduct
WHERE {
  # From Sägewerk ELDAT file: Polter with trace reference
  ?polter a eldat:Polter ;
          eldat:polterId ?polterId .

  OPTIONAL { ?polter eldat:totalVolume ?totalVolume }
  OPTIONAL { ?polter eldat:totalPieces ?totalPieces }
  OPTIONAL { ?polter geo:lat ?polterLat }
  OPTIONAL { ?polter geo:long ?polterLong }

  ?polter tc:hasTraceReference ?trace .
  ?trace tc:traceId "${traceId}" .

  # Get delivery/creation date from WoodAllocation
  OPTIONAL {
    ?alloc eldat:hasPolter ?polter .
    ?alloc eldat:creationDateTime ?deliveryDate .
  }

  # Get sawmill company from SawmillSource in BSP file
  OPTIONAL {
    ?panel tc:hasSawmillSource ?source ;
           tc:traceId "${traceId}" .
    ?source tc:company ?company .
  }

  # Get destination product from WoodData
  OPTIONAL {
    ?polter tc:hasWoodData ?woodData .
    ?woodData tc:destinationProduct ?destinationProduct .
  }
}
LIMIT 1
`;
}

/**
 * Query for BSP-Werk production data with extended details
 */
export function createBspWerkQuery(traceId: string): string {
  return `${PREFIXES}
SELECT ?company ?productionDate ?orderId ?status ?beschreibung ?konstruktionsnummer
       ?cncAbbund ?cncMaschine ?zusatzabbund ?zusatzabbundBeschreibung ?produktionsstandort
       ?anzahlSchichten ?brandschutzklasse ?bspTyp ?bspTypBezeichnung ?plattencode ?plattencodeBezeichnung
       ?produktnorm ?nettoVolumen ?bruttoVolumen
       ?optikSeite1 ?decklageBspSeite1
WHERE {
  ?source a tc:BSPWerkSource .

  OPTIONAL { ?source tc:company ?company }
  OPTIONAL { ?source tc:productionDate ?productionDate }
  OPTIONAL { ?source tc:orderId ?orderId }

  ?panel tc:hasBSPWerkSource ?source ;
         tc:traceId "${traceId}" .

  OPTIONAL {
    ?panel vlex:hasProduction ?prod .
    OPTIONAL { ?prod vlex:status ?status }
    OPTIONAL { ?prod vlex:beschreibung ?beschreibung }
    OPTIONAL { ?prod vlex:konstruktionsnummer ?konstruktionsnummer }
    OPTIONAL { ?prod vlex:cncAbbund ?cncAbbund }
    OPTIONAL { ?prod vlex:cncMaschine ?cncMaschine }
    OPTIONAL { ?prod vlex:zusatzabbund ?zusatzabbund }
    OPTIONAL { ?prod vlex:zusatzabbundBeschreibung ?zusatzabbundBeschreibung }
    OPTIONAL { ?prod vlex:produktionsstandort ?produktionsstandort }
  }

  OPTIONAL {
    ?panel vlex:hasConfiguration ?config .
    OPTIONAL { ?config vlex:anzahlSchichten ?anzahlSchichten }
    OPTIONAL { ?config vlex:brandschutzklasse ?brandschutzklasse }
    OPTIONAL { ?config vlex:bspTyp ?bspTyp }
    OPTIONAL { ?config vlex:bspTypBezeichnung ?bspTypBezeichnung }
    OPTIONAL { ?config vlex:plattencode ?plattencode }
    OPTIONAL { ?config vlex:plattencodeBezeichnung ?plattencodeBezeichnung }
    OPTIONAL { ?config vlex:produktnorm ?produktnorm }
  }

  OPTIONAL {
    ?panel vlex:hasDimension ?dim .
    OPTIONAL { ?dim vlex:nettoVolumen ?nettoVolumen }
    OPTIONAL { ?dim vlex:bruttoVolumen ?bruttoVolumen }
  }

  OPTIONAL {
    ?panel vlex:hasSurfaceQuality ?surf .
    OPTIONAL { ?surf vlex:optikSeite1 ?optikSeite1 }
    OPTIONAL { ?surf vlex:decklageBspSeite1 ?decklageBspSeite1 }
  }
}
LIMIT 1
`;
}

/**
 * Query for complete supply chain (all sources)
 */
export function createSupplyChainQuery(traceId: string): string {
  return `${PREFIXES}
SELECT ?station ?company ?date ?sourceFormat ?location
WHERE {
  ?panel tc:traceId "${traceId}" .

  {
    ?panel tc:hasForestSource ?source .
    ?source tc:station ?station .
    OPTIONAL { ?source tc:forestryOffice ?company }
    OPTIONAL { ?source tc:harvestDate ?date }
    OPTIONAL { ?source tc:sourceFormat ?sourceFormat }
    OPTIONAL { ?source tc:district ?location }
  }
  UNION
  {
    ?panel tc:hasSawmillSource ?source .
    ?source tc:station ?station .
    OPTIONAL { ?source tc:company ?company }
    OPTIONAL { ?source tc:deliveryDate ?date }
    OPTIONAL { ?source tc:sourceFormat ?sourceFormat }
  }
  UNION
  {
    ?panel tc:hasBSPWerkSource ?source .
    ?source tc:station ?station .
    OPTIONAL { ?source tc:company ?company }
    OPTIONAL { ?source tc:productionDate ?date }
    OPTIONAL { ?source tc:sourceFormat ?sourceFormat }
  }
}
ORDER BY ?date
`;
}

/**
 * Query for business partners in the supply chain (from ELDAT file)
 * Business partners are linked via WoodAllocation -> Polter -> TraceReference
 */
export function createBusinessPartnersQuery(traceId: string): string {
  return `${PREFIXES}
SELECT ?name ?role ?city ?street ?postcode
WHERE {
  ?partner a eldat:BusinessPartner ;
           eldat:name ?name ;
           eldat:role ?role .

  OPTIONAL { ?partner eldat:city ?city }
  OPTIONAL { ?partner eldat:street ?street }
  OPTIONAL { ?partner eldat:postcode ?postcode }

  ?partner eldat:belongsToAllocation ?alloc .
  ?alloc eldat:hasPolter ?polter .
  ?polter tc:hasTraceReference ?trace .
  ?trace tc:traceId "${traceId}" .
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
