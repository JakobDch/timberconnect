import { describe, expect, it } from 'vitest';
import {
  extractStems,
  matchStemsToAreas,
  hasOriginLink,
  proposeOrigin,
} from './stemOriginService';
import type { PlantingAreaResult } from './sparqlService';

/**
 * Ein Stammblock im Aufbau des echten Demo-Protokolls
 * (demo-dateien_v3/2_Faellvorgang/PFLICHT_faellvorgang_stanford.hpr):
 * zwei StemCoordinates (Basismaschine + Kranspitze), der Ident am Log.
 */
function stemBlock({
  stemKey,
  epc,
  machineLat,
  machineLon,
  craneLat,
  craneLon,
}: {
  stemKey: string;
  epc?: string | null;
  machineLat?: number;
  machineLon?: number;
  craneLat?: number;
  craneLon?: number;
}): string {
  const coords = [];
  if (machineLat !== undefined && machineLon !== undefined) {
    coords.push(`
      <StemCoordinates receiverPosition="Base machine position" coordinateReferenceSystem="WGS84">
        <Latitude latitudeCategory="North">${machineLat}</Latitude>
        <Longitude longitudeCategory="East">${machineLon}</Longitude>
        <Altitude>412.0</Altitude>
      </StemCoordinates>`);
  }
  if (craneLat !== undefined && craneLon !== undefined) {
    coords.push(`
      <StemCoordinates receiverPosition="Crane tip position when felling the tree" coordinateReferenceSystem="WGS84">
        <Latitude latitudeCategory="North">${craneLat}</Latitude>
        <Longitude longitudeCategory="East">${craneLon}</Longitude>
        <Altitude>412.0</Altitude>
      </StemCoordinates>`);
  }
  const identity = epc
    ? `<Identities><Identity type="http://stanford.org/gs1/urn">${epc}</Identity></Identities>`
    : '';
  return `
    <Stem>
      <StemKey>${stemKey}</StemKey>
      <StemNumber>1</StemNumber>${coords.join('')}
      <SingleTreeProcessedStem>
        <Log>
          <LogKey>1</LogKey>
          ${identity}
        </Log>
      </SingleTreeProcessedStem>
    </Stem>`;
}

/** Quadrat um (51.45, 8.00) mit ca. 0.01 Grad Kantenlaenge. Ring ist [lon, lat]. */
function squareArea(
  iri: string,
  epc: string | null,
  lonMin = 7.995,
  lonMax = 8.005,
  latMin = 51.445,
  latMax = 51.455,
): PlantingAreaResult {
  return {
    certificateIri: iri,
    ring: [
      [lonMin, latMin],
      [lonMax, latMin],
      [lonMax, latMax],
      [lonMin, latMax],
      [lonMin, latMin],
    ],
    centroid: { lat: (latMin + latMax) / 2, lon: (lonMin + lonMax) / 2 },
    epc,
    certificateNumber: 'SZ-2026-01',
    species: 'Fichte',
    maturityYear: '2026',
  };
}

describe('extractStems', () => {
  it('liest StemKey, Ident und Position je Stamm', () => {
    const xml = `<HarvestedProduction>${stemBlock({
      stemKey: '56400',
      epc: 'urn:epc:id:sgtin:404711145.0100.12A3D4567',
      machineLat: 51.451471,
      machineLon: 7.997697,
      craneLat: 51.451511,
      craneLon: 7.997757,
    })}</HarvestedProduction>`;

    const stems = extractStems(xml);

    expect(stems).toHaveLength(1);
    expect(stems[0].stemKey).toBe('56400');
    expect(stems[0].epc).toBe('urn:epc:id:sgtin:404711145.0100.12A3D4567');
  });

  it('bevorzugt die Kranspitze gegenueber der Basismaschine', () => {
    // Die Kranspitze steht am Baum, die Basismaschine auf der Rueckegasse.
    // An einer Flaechengrenze entscheidet genau das ueber die Zuordnung.
    const xml = stemBlock({
      stemKey: '1',
      machineLat: 51.451471,
      machineLon: 7.997697,
      craneLat: 51.451511,
      craneLon: 7.997757,
    });

    const [stem] = extractStems(xml);

    expect(stem.positionSource).toBe('crane');
    expect(stem.position).toEqual({ lat: 51.451511, lon: 7.997757 });
  });

  it('faellt auf die Basismaschine zurueck, wenn die Kranspitze fehlt', () => {
    const xml = stemBlock({
      stemKey: '1',
      machineLat: 51.451471,
      machineLon: 7.997697,
    });

    const [stem] = extractStems(xml);

    expect(stem.positionSource).toBe('machine');
    expect(stem.position).toEqual({ lat: 51.451471, lon: 7.997697 });
  });

  it('meldet fehlende Position als null statt zu raten', () => {
    const [stem] = extractStems(stemBlock({ stemKey: '1', epc: null }));

    expect(stem.position).toBeNull();
    expect(stem.positionSource).toBeNull();
  });

  it('wertet Suedbreite und Westlaenge als negative Werte', () => {
    // StanForD nennt den Betrag und die Himmelsrichtung getrennt. Ohne diese
    // Auswertung landete ein Bestand auf der Suedhalbkugel spiegelverkehrt.
    const xml = `
      <Stem>
        <StemKey>9</StemKey>
        <StemCoordinates receiverPosition="Crane tip position" coordinateReferenceSystem="WGS84">
          <Latitude latitudeCategory="South">33.9</Latitude>
          <Longitude longitudeCategory="West">18.4</Longitude>
        </StemCoordinates>
      </Stem>`;

    const [stem] = extractStems(xml);

    expect(stem.position).toEqual({ lat: -33.9, lon: -18.4 });
  });

  it('liefert eine leere Liste fuer ein Protokoll ohne Staemme', () => {
    expect(extractStems('<HarvestedProduction></HarvestedProduction>')).toEqual([]);
  });
});

describe('matchStemsToAreas', () => {
  const inside = { stemKey: '1', epc: 'urn:epc:id:sgtin:1.1.A', position: { lat: 51.45, lon: 8.0 }, positionSource: 'crane' as const };
  const outside = { stemKey: '2', epc: 'urn:epc:id:sgtin:1.1.B', position: { lat: 52.9, lon: 9.9 }, positionSource: 'crane' as const };

  it('ordnet einen Stamm der Flaeche zu, in der er liegt', () => {
    const area = squareArea('cert-1', 'urn:epc:class:lgtin:404711145.0001.Pflanzung01');

    const result = matchStemsToAreas([inside], [area]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].seedEpc).toBe(
      'urn:epc:class:lgtin:404711145.0001.Pflanzung01',
    );
    expect(result.groups[0].stems).toHaveLength(1);
    expect(result.unmatched).toHaveLength(0);
  });

  it('laesst Staemme ohne Treffer uebrig, statt sie zuzuordnen', () => {
    // Altbestand hat nie ein Stammzertifikat gesehen — das ist kein Fehler.
    const area = squareArea('cert-1', 'urn:epc:class:lgtin:1.1.Seed');

    const result = matchStemsToAreas([inside, outside], [area]);

    expect(result.groups[0].stems).toHaveLength(1);
    expect(result.unmatched.map((s) => s.stemKey)).toEqual(['2']);
  });

  it('gruppiert je Flaeche, wenn ein Einschlag ueber zwei Flaechen laeuft', () => {
    // Ein Event fuer beide wuerde eine gemeinsame Herkunft behaupten, die die
    // Koordinaten nicht hergeben.
    const areaA = squareArea('cert-A', 'urn:epc:class:lgtin:1.1.A');
    const areaB = squareArea('cert-B', 'urn:epc:class:lgtin:1.1.B', 9.0, 9.01, 52.0, 52.01);
    const stemB = {
      stemKey: '3',
      epc: 'urn:epc:id:sgtin:1.1.C',
      position: { lat: 52.005, lon: 9.005 },
      positionSource: 'crane' as const,
    };

    const result = matchStemsToAreas([inside, stemB], [areaA, areaB]);

    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((g) => g.area.certificateIri).sort()).toEqual([
      'cert-A',
      'cert-B',
    ]);
  });

  it('ordnet einen Stamm in zwei Flaechen keiner davon zu', () => {
    // Ueberlappende Flaechen soll die Konfliktpruefung verhindern. Trifft es
    // doch zu, ist die Herkunft nicht entscheidbar und darf nicht geraten
    // werden.
    const areaA = squareArea('cert-A', 'urn:epc:class:lgtin:1.1.A');
    const areaB = squareArea('cert-B', 'urn:epc:class:lgtin:1.1.B');

    const result = matchStemsToAreas([inside], [areaA, areaB]);

    expect(result.groups).toHaveLength(0);
    expect(result.ambiguous.map((s) => s.stemKey)).toEqual(['1']);
  });

  it('ueberspringt Flaechen ohne EPC — eine Kante ins Leere ist keine', () => {
    const result = matchStemsToAreas([inside], [squareArea('cert-1', null)]);

    expect(result.groups).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
  });

  it('trennt fehlende Position von fehlendem Treffer', () => {
    // Zwei verschiedene Aussagen: hier wurde nicht geprueft, dort wurde
    // geprueft und nichts gefunden.
    const noPos = { stemKey: '4', epc: null, position: null, positionSource: null };
    const area = squareArea('cert-1', 'urn:epc:class:lgtin:1.1.A');

    const result = matchStemsToAreas([inside, outside, noPos], [area]);

    expect(result.withoutPosition.map((s) => s.stemKey)).toEqual(['4']);
    expect(result.unmatched.map((s) => s.stemKey)).toEqual(['2']);
    expect(result.totalStems).toBe(3);
  });

  it('sortiert die groesste Gruppe nach vorn', () => {
    const areaA = squareArea('cert-A', 'urn:epc:class:lgtin:1.1.A');
    const areaB = squareArea('cert-B', 'urn:epc:class:lgtin:1.1.B', 9.0, 9.01, 52.0, 52.01);
    const inB = (k: string) => ({
      stemKey: k,
      epc: null,
      position: { lat: 52.005, lon: 9.005 },
      positionSource: 'crane' as const,
    });

    const result = matchStemsToAreas(
      [inside, inB('3'), inB('4')],
      [areaA, areaB],
    );

    expect(result.groups[0].area.certificateIri).toBe('cert-B');
  });
});

describe('proposeOrigin', () => {
  /** Ein geglueckter Ladevorgang mit den uebergebenen Flaechen. */
  const loaded = (areas: PlantingAreaResult[]) => async () => ({
    areas,
    reason: 'ok' as const,
    sourceCount: 1,
    error: null,
  });

  it('meldet no-stems, wenn das Protokoll keine Staemme enthaelt', async () => {
    const result = await proposeOrigin('<HarvestedProduction/>', loaded([]));

    expect(result.groups).toHaveLength(0);
    expect(result.blocker).toBe('no-stems');
  });

  /**
   * Der Kern der Aenderung vom 02.09.2026: Ein Ausfall der Flaechenabfrage
   * darf nicht wie "keine Herkunft gefunden" aussehen. Genau diese Verwechslung
   * liess einen Faellvorgang ohne TransformationEvent durchlaufen.
   */
  it('unterscheidet einen Ladefehler von "nichts gefunden"', async () => {
    const xml = stemBlock({ stemKey: '1', craneLat: 51.45, craneLon: 8.0 });

    const result = await proposeOrigin(xml, async () => ({
      areas: [],
      reason: 'query-failed' as const,
      sourceCount: 3,
      error: 'Pod nicht erreichbar',
    }));

    expect(result.groups).toHaveLength(0);
    expect(result.blocker).toBe('areas-unavailable');
    expect(result.blockerDetail).toContain('Pod nicht erreichbar');
  });

  it('meldet no-sources, wenn der Katalog keine Quellen kennt', async () => {
    const xml = stemBlock({ stemKey: '1', craneLat: 51.45, craneLon: 8.0 });

    const result = await proposeOrigin(xml, async () => ({
      areas: [],
      reason: 'no-sources' as const,
      sourceCount: 0,
      error: null,
    }));

    expect(result.blocker).toBe('no-sources');
  });

  it('bleibt ohne Blocker, wenn sauber geprueft und nichts getroffen wurde', async () => {
    // Stamm weit weg von der Flaeche: ein echtes "keine Herkunft", kein Fehler.
    const xml = stemBlock({ stemKey: '1', craneLat: 10, craneLon: 10 });
    const area = squareArea('cert-1', 'urn:epc:class:lgtin:1.1.Seed');

    const result = await proposeOrigin(xml, loaded([area]));

    expect(result.groups).toHaveLength(0);
    expect(result.blocker).toBeNull();
    expect(result.unmatched).toHaveLength(1);
  });

  it('meldet no-usable-areas, wenn Flaechen ohne EPC vorliegen', async () => {
    const xml = stemBlock({ stemKey: '1', craneLat: 51.45, craneLon: 8.0 });
    const area = squareArea('cert-1', null);

    const result = await proposeOrigin(xml, loaded([area]));

    expect(result.blocker).toBe('no-usable-areas');
    expect(result.areasLoaded).toBe(1);
    expect(result.areasUsable).toBe(0);
  });

  it('verbindet Extraktion und Zuordnung', async () => {
    const xml = stemBlock({
      stemKey: '56400',
      epc: 'urn:epc:id:sgtin:404711145.0100.12A3D4567',
      craneLat: 51.45,
      craneLon: 8.0,
    });
    const area = squareArea('cert-1', 'urn:epc:class:lgtin:1.1.Seed');

    const result = await proposeOrigin(xml, loaded([area]));

    expect(hasOriginLink(result)).toBe(true);
    expect(result.groups[0].stems[0].epc).toBe(
      'urn:epc:id:sgtin:404711145.0100.12A3D4567',
    );
  });
});
