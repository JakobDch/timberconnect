/**
 * Product Mapper for TimberConnect
 *
 * Maps SPARQL query results to TypeScript interfaces used in the UI.
 */

import type { Product, ProductType, SupplyChainStep } from '../types';
import type { SparqlBinding } from './sparqlService';
import { SPECIES_MAP, SPECIES_SCIENTIFIC } from '../config/solidPods';

/**
 * Helper to get a value from a SPARQL binding
 */
function getValue(binding: SparqlBinding | undefined, key: string): string | undefined {
  return binding?.[key]?.value;
}

/**
 * Parse a date string from RDF to a readable format
 * Handles ISO 8601 dates like "2025-01-15T09:23:15.000+01:00"
 */
function parseDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    // Check if date is valid
    if (isNaN(date.getTime())) {
      // Try to extract just the date part (YYYY-MM-DD)
      const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        return `${match[3]}.${match[2]}.${match[1]}`;
      }
      return dateStr;
    }
    return date.toLocaleDateString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

/**
 * Map species code to German name
 */
function mapSpeciesCode(code: string | undefined): string {
  if (!code) return 'Unbekannt';
  return SPECIES_MAP[code] || code;
}

/**
 * Get scientific name for species
 */
function getScientificName(germanName: string): string {
  return SPECIES_SCIENTIFIC[germanName] || '';
}

/**
 * Determine product type based on available data
 * - 'finished' for BSP plates (processed products)
 * - 'raw_material' for stems/logs
 */
function determineProductType(
  productData: SparqlBinding[],
  bspWerkData?: SparqlBinding[]
): ProductType {
  const product = productData[0];
  const artikel = getValue(product, 'artikel')?.toLowerCase() || '';
  const bspTyp = getValue(product, 'bspTypBezeichnung');

  // If BSP data exists or product name indicates BSP plate
  if (
    (bspWerkData && bspWerkData.length > 0) ||
    bspTyp ||
    artikel.includes('bsp') ||
    artikel.includes('platte') ||
    artikel.includes('clt')
  ) {
    return 'finished';
  }

  return 'raw_material';
}

/**
 * Map SPARQL bindings to Product interface
 */
export function mapToProduct(
  productData: SparqlBinding[],
  stemData: SparqlBinding[],
  forestData: SparqlBinding[],
  bspWerkData?: SparqlBinding[]
): Product | null {
  const product = productData[0];
  const stem = stemData[0];
  const forest = forestData[0];

  // Need at least some data
  if (!product && !stem) {
    return null;
  }

  // Determine wood type from various sources
  const holzartCode = getValue(product, 'holzart');
  const holzartBezeichnung = getValue(product, 'holzartBezeichnung');
  const woodType = holzartBezeichnung || mapSpeciesCode(holzartCode);
  const woodTypeScientific = holzartBezeichnung
    ? getScientificName(holzartBezeichnung)
    : getScientificName(woodType);

  // Get dimensions
  const laenge = getValue(product, 'laenge');
  const breite = getValue(product, 'breite');
  const hoehe = getValue(product, 'hoehe');

  // Get origin from stem or forest data
  const forestryOffice = getValue(stem, 'forestryOffice') || getValue(forest, 'forestryOffice');
  const district = getValue(stem, 'district') || getValue(forest, 'district');
  const lat = getValue(stem, 'lat');
  const long = getValue(stem, 'long');

  // Get harvest date
  const harvestDate = getValue(stem, 'harvestDate') || getValue(forest, 'harvestDate');

  // Get certifications
  const fsc = getValue(product, 'fsc') || getValue(stem, 'fsc');
  const pefc = getValue(product, 'pefc') || getValue(stem, 'pefc');
  const certifications: string[] = [];
  if (fsc) certifications.push('FSC');
  if (pefc) certifications.push('PEFC');

  // Get product name
  const artikel = getValue(product, 'artikel');
  const traceId = getValue(product, 'traceId');
  const name = artikel || `Holzprodukt ${traceId || ''}`;

  // Get description
  const beschreibung = getValue(product, 'beschreibung');
  const status = getValue(product, 'status');
  const description = beschreibung || status || '';

  return {
    id: traceId || getValue(stem, 'stemKey') || '',
    name,
    description,
    woodType,
    woodTypeScientific,
    quality: getValue(product, 'festigkeit') || 'C24',
    dimensions: {
      length: laenge ? parseFloat(laenge) : 0,
      width: breite ? parseFloat(breite.replace(',', '.')) * 1000 : 0, // Convert m to mm
      thickness: hoehe ? parseFloat(hoehe) : 0,
      unit: 'mm'
    },
    origin: {
      forestryOffice: forestryOffice || '',
      district: district || '',
      location: district || '',
      region: district ? `${district}${forestryOffice ? `, ${forestryOffice}` : ''}` : 'Deutschland',
      country: 'Deutschland',
      harvestDate: parseDate(harvestDate),
      coordinates: {
        lat: lat ? parseFloat(lat) : 0,
        lng: long ? parseFloat(long) : 0
      }
    },
    harvestDate: parseDate(harvestDate),
    certifications,
    productType: determineProductType(productData, bspWerkData)
  };
}

/**
 * Map SPARQL bindings to SupplyChainStep array
 */
export function mapToSupplyChain(
  forestData: SparqlBinding[],
  sawmillData: SparqlBinding[],
  bspWerkData: SparqlBinding[],
  _supplyChainData: SparqlBinding[],
  businessPartners: SparqlBinding[],
  stemData: SparqlBinding[] = []
): SupplyChainStep[] {
  const steps: SupplyChainStep[] = [];

  // Forest step with extended details
  // Use stemData for detailed measurements, forestData as fallback
  const stem = stemData[0];
  const forest = forestData[0];
  const forestSource = stem || forest;

  if (forestSource) {
    // Prefer stem data for detailed measurements (from StanForD HPR)
    const lat = getValue(stem, 'lat') || getValue(forest, 'lat');
    const long = getValue(stem, 'long') || getValue(forest, 'long');
    const alt = getValue(stem, 'alt');
    const dbh = getValue(stem, 'dbh');
    const analyzedLength = getValue(stem, 'analyzedLength');
    const gnssQuality = getValue(stem, 'gnssQuality');
    const destinationSawmill = getValue(stem, 'destinationSawmill');

    const forestryOffice = getValue(stem, 'forestryOffice') || getValue(forest, 'forestryOffice');
    const district = getValue(stem, 'district') || getValue(forest, 'district');
    const harvestDate = getValue(stem, 'harvestDate') || getValue(forest, 'harvestDate');

    const forestDetails = [
      { label: 'Forstamt', value: forestryOffice || 'Keine Daten verfügbar' },
      { label: 'Revier', value: district || 'Keine Daten verfügbar' },
      { label: 'BHD (Brusthöhendurchmesser)', value: dbh ? `${dbh} mm` : 'Keine Daten verfügbar' },
      { label: 'Stammlänge', value: analyzedLength ? `${(parseFloat(analyzedLength) / 100).toFixed(2)} m` : 'Keine Daten verfügbar' },
      { label: 'Koordinaten', value: lat && long ? `${parseFloat(lat).toFixed(6)}° N, ${parseFloat(long).toFixed(6)}° E` : 'Keine Daten verfügbar' },
      { label: 'Höhe ü. NN', value: alt ? `${parseFloat(alt).toFixed(1)} m` : 'Keine Daten verfügbar' },
      { label: 'GPS-Qualität', value: gnssQuality || 'Keine Daten verfügbar' },
      { label: 'Zielsägewerk', value: destinationSawmill || 'Keine Daten verfügbar' }
    ];

    steps.push({
      id: 1,
      stage: 'forest',
      company: forestryOffice || 'Forstbetrieb',
      date: parseDate(harvestDate),
      location: district || '',
      description: 'Holzernte und Aufarbeitung',
      details: forestDetails,
      icon: 'tree'
    });
  }

  // Sawmill data (needed for transport and sawmill steps)
  const sawmill = sawmillData[0];
  const deliveryDate = getValue(sawmill, 'deliveryDate');

  // Add transport step between forest and sawmill
  // Use deliveryDate from sawmill data (WoodAllocation creationDateTime)
  if (forestSource) {
    steps.push({
      id: 2,
      stage: 'transport',
      company: 'Holztransport',
      date: deliveryDate ? parseDate(deliveryDate) : '',
      location: '',
      description: 'Transport zum Sägewerk',
      details: [
        { label: 'Lieferdatum', value: deliveryDate ? parseDate(deliveryDate) : 'Keine Daten verfügbar' },
        { label: 'Strecke', value: 'Wald → Sägewerk' }
      ],
      icon: 'truck'
    });
  }

  // Sawmill step
  if (sawmill) {
    const totalVolume = getValue(sawmill, 'totalVolume');
    const totalPieces = getValue(sawmill, 'totalPieces');
    const destinationProduct = getValue(sawmill, 'destinationProduct');

    steps.push({
      id: 3,
      stage: 'sawmill',
      company: getValue(sawmill, 'company') || 'Sägewerk',
      date: parseDate(deliveryDate),
      location: '',
      description: 'Einschnitt und Schnittholzproduktion',
      details: [
        { label: 'Unternehmen', value: getValue(sawmill, 'company') || 'Keine Daten verfügbar' },
        { label: 'Polter-Nr.', value: getValue(sawmill, 'polterId') || 'Keine Daten verfügbar' },
        { label: 'Volumen', value: totalVolume ? `${totalVolume} m³` : 'Keine Daten verfügbar' },
        { label: 'Stückzahl', value: totalPieces ? `${totalPieces} Stämme` : 'Keine Daten verfügbar' },
        { label: 'Zielprodukt', value: destinationProduct || 'Keine Daten verfügbar' }
      ],
      icon: 'factory'
    });
  }

  // BSP-Werk (manufacturer) step with extended details
  const bspWerk = bspWerkData[0];
  if (bspWerk) {
    const anzahlSchichten = getValue(bspWerk, 'anzahlSchichten');
    const brandschutzklasse = getValue(bspWerk, 'brandschutzklasse');
    const bspTypBezeichnung = getValue(bspWerk, 'bspTypBezeichnung');
    const plattencodeBezeichnung = getValue(bspWerk, 'plattencodeBezeichnung');
    const produktnorm = getValue(bspWerk, 'produktnorm');
    const cncMaschine = getValue(bspWerk, 'cncMaschine');
    const zusatzabbundBeschreibung = getValue(bspWerk, 'zusatzabbundBeschreibung');
    const nettoVolumen = getValue(bspWerk, 'nettoVolumen');
    const bruttoVolumen = getValue(bspWerk, 'bruttoVolumen');
    const optikSeite1 = getValue(bspWerk, 'optikSeite1');
    const produktionsstandort = getValue(bspWerk, 'produktionsstandort');

    const bspDetails = [
      { label: 'Unternehmen', value: getValue(bspWerk, 'company') || 'Keine Daten verfügbar' },
      { label: 'Auftragsnr.', value: getValue(bspWerk, 'orderId') || 'Keine Daten verfügbar' },
      { label: 'Status', value: getValue(bspWerk, 'status') || 'Keine Daten verfügbar' },
      { label: 'Konstruktionsnr.', value: getValue(bspWerk, 'konstruktionsnummer') || 'Keine Daten verfügbar' },
      { label: 'Plattentyp', value: bspTypBezeichnung || 'Keine Daten verfügbar' },
      { label: 'Schichtaufbau', value: plattencodeBezeichnung || 'Keine Daten verfügbar' },
      { label: 'Anzahl Schichten', value: anzahlSchichten || 'Keine Daten verfügbar' },
      { label: 'Brandschutzklasse', value: brandschutzklasse || 'Keine Daten verfügbar' },
      { label: 'Produktnorm', value: produktnorm || 'Keine Daten verfügbar' },
      { label: 'CNC-Maschine', value: cncMaschine || 'Keine Daten verfügbar' },
      { label: 'Zusatzbearbeitung', value: zusatzabbundBeschreibung || 'Keine' },
      { label: 'Netto-Volumen', value: nettoVolumen ? `${nettoVolumen} m³` : 'Keine Daten verfügbar' },
      { label: 'Brutto-Volumen', value: bruttoVolumen ? `${bruttoVolumen} m³` : 'Keine Daten verfügbar' },
      { label: 'Oberfläche', value: optikSeite1 || 'Keine Daten verfügbar' },
      { label: 'Produktionsstandort', value: produktionsstandort || 'Keine Daten verfügbar' }
    ];

    steps.push({
      id: 4,
      stage: 'manufacturer',
      company: getValue(bspWerk, 'company') || 'BSP-Werk',
      date: parseDate(getValue(bspWerk, 'productionDate')),
      location: produktionsstandort || '',
      description: getValue(bspWerk, 'beschreibung') || 'BSP-Plattenproduktion',
      details: bspDetails,
      icon: 'building'
    });
  }

  // Add business partner information if available
  for (const partner of businessPartners) {
    const role = getValue(partner, 'role');
    const name = getValue(partner, 'name');
    const city = getValue(partner, 'city');

    // Find matching step and add business partner info
    if (role === 'lie' && steps.find(s => s.stage === 'forest')) {
      // Lieferant = supplier (forest)
      const forestStep = steps.find(s => s.stage === 'forest');
      if (forestStep && name) {
        forestStep.company = name;
        if (city) forestStep.location = city;
      }
    } else if (role === 'abn' && steps.find(s => s.stage === 'sawmill')) {
      // Abnehmer = buyer (sawmill)
      const sawmillStep = steps.find(s => s.stage === 'sawmill');
      if (sawmillStep && name) {
        sawmillStep.company = name;
        if (city) sawmillStep.location = city;
      }
    } else if (role === 'end' && steps.find(s => s.stage === 'manufacturer')) {
      // Endabnehmer = end buyer (manufacturer)
      const manuStep = steps.find(s => s.stage === 'manufacturer');
      if (manuStep && name) {
        manuStep.company = name;
        if (city) manuStep.location = city;
      }
    }
  }

  // Sort by id
  return steps.sort((a, b) => a.id - b.id);
}
