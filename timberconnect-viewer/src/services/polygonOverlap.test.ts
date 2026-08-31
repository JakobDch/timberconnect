import { describe, expect, it } from 'vitest';
import { findOverlaps, intersectRings, openRing, type Ring } from './polygonOverlap';
import { ringAreaHectares } from './geoService';

/**
 * Tests der Überschneidungsprüfung.
 *
 * Clipping ist der Teil dieser Funktion, bei dem ein Vorzeichenfehler nicht
 * auffällt, sondern still ein falsches Ergebnis liefert — deshalb wird hier
 * gegen von Hand nachrechenbare Flächen geprüft und nicht gegen einen
 * Referenzlauf.
 *
 * Alle Koordinaten in [lon, lat]. Die Testquadrate liegen im Sauerland, damit
 * die Größenordnung (Grad -> Hektar) realistisch bleibt.
 */

/** Achsenparalleles Rechteck als offener Ring. */
function rect(west: number, south: number, east: number, north: number): Ring {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ];
}

/** Fläche aller Ergebnisringe zusammen, in Hektar. */
function totalHectares(rings: Ring[]): number {
  return rings.reduce((sum, ring) => sum + ringAreaHectares(ring), 0);
}

describe('openRing', () => {
  it('entfernt den doppelten Schlusspunkt', () => {
    const closed: Ring = [
      [8.1, 51.3],
      [8.2, 51.3],
      [8.2, 51.4],
      [8.1, 51.3],
    ];
    expect(openRing(closed)).toHaveLength(3);
  });

  it('lässt einen offenen Ring unverändert', () => {
    expect(openRing(rect(8.1, 51.3, 8.2, 51.4))).toHaveLength(4);
  });
});

describe('intersectRings', () => {
  it('meldet nichts bei getrennten Flächen', () => {
    const a = rect(8.10, 51.30, 8.15, 51.35);
    const b = rect(8.30, 51.30, 8.35, 51.35);
    expect(intersectRings(a, b)).toEqual([]);
  });

  it('findet die Überlappung zweier sich kreuzender Rechtecke', () => {
    // Überlappungsbereich: lon 8.15..8.20, lat 51.32..51.35
    const a = rect(8.10, 51.30, 8.20, 51.35);
    const b = rect(8.15, 51.32, 8.30, 51.40);

    const result = intersectRings(a, b);
    expect(result.length).toBeGreaterThan(0);

    // Gegenrechnung über die bekannte Schnittfläche.
    const expected = ringAreaHectares(rect(8.15, 51.32, 8.20, 51.35));
    expect(totalHectares(result)).toBeCloseTo(expected, 1);
  });

  it('erkennt vollständige Enthaltung (klein in groß)', () => {
    const big = rect(8.00, 51.20, 8.50, 51.60);
    const small = rect(8.10, 51.30, 8.15, 51.35);

    const result = intersectRings(small, big);
    expect(result.length).toBe(1);
    expect(totalHectares(result)).toBeCloseTo(ringAreaHectares(small), 1);
  });

  it('erkennt vollständige Enthaltung auch umgekehrt (groß in klein)', () => {
    const big = rect(8.00, 51.20, 8.50, 51.60);
    const small = rect(8.10, 51.30, 8.15, 51.35);

    const result = intersectRings(big, small);
    expect(result.length).toBe(1);
    expect(totalHectares(result)).toBeCloseTo(ringAreaHectares(small), 1);
  });

  it('meldet identische Flächen als volle Überschneidung', () => {
    const a = rect(8.10, 51.30, 8.20, 51.35);
    const result = intersectRings(a, [...a]);
    expect(totalHectares(result)).toBeCloseTo(ringAreaHectares(a), 1);
  });

  it('wertet reine Berührung an einer Kante NICHT als Überschneidung', () => {
    // Gemeinsame Kante bei lon 8.20 — aneinandergrenzende Bestände.
    const a = rect(8.10, 51.30, 8.20, 51.35);
    const b = rect(8.20, 51.30, 8.30, 51.35);
    expect(totalHectares(intersectRings(a, b))).toBeCloseTo(0, 3);
  });

  it('kommt mit einem konkaven (L-förmigen) Polygon zurecht', () => {
    // L-Form: das Rechteck 8.0..8.2 / 51.0..51.2 ohne das obere rechte Viertel.
    const lShape: Ring = [
      [8.0, 51.0],
      [8.2, 51.0],
      [8.2, 51.1],
      [8.1, 51.1],
      [8.1, 51.2],
      [8.0, 51.2],
    ];
    // Liegt genau in der AUSSPARUNG des L — darf nichts überlappen.
    const inNotch = rect(8.12, 51.12, 8.18, 51.18);
    expect(totalHectares(intersectRings(inNotch, lShape))).toBeCloseTo(0, 3);

    // Im ausgefüllten unteren Schenkel — muss überlappen.
    const inLeg = rect(8.12, 51.02, 8.18, 51.08);
    expect(totalHectares(intersectRings(inLeg, lShape))).toBeCloseTo(
      ringAreaHectares(inLeg),
      1,
    );
  });

  it('ist unabhängig vom Umlaufsinn der Eingabe', () => {
    const a = rect(8.10, 51.30, 8.20, 51.35);
    const b = rect(8.15, 51.32, 8.30, 51.40);
    const clockwise = [...b].reverse();

    expect(totalHectares(intersectRings(a, b))).toBeCloseTo(
      totalHectares(intersectRings(a, clockwise)),
      3,
    );
  });

  it('verarbeitet geschlossene Ringe wie offene', () => {
    const a = rect(8.10, 51.30, 8.20, 51.35);
    const b = rect(8.15, 51.32, 8.30, 51.40);
    const closedA: Ring = [...a, a[0]];
    const closedB: Ring = [...b, b[0]];

    expect(totalHectares(intersectRings(closedA, closedB))).toBeCloseTo(
      totalHectares(intersectRings(a, b)),
      3,
    );
  });

  it('liefert nichts bei entarteten Eingaben', () => {
    expect(intersectRings([[8.1, 51.3]], rect(8.1, 51.3, 8.2, 51.4))).toEqual([]);
    expect(intersectRings([], [])).toEqual([]);
  });
});

describe('findOverlaps', () => {
  const candidate = rect(8.10, 51.30, 8.20, 51.35);

  it('nennt die betroffenen Zertifikate', () => {
    const hits = findOverlaps(
      candidate,
      [
        { certificateIri: 'urn:cert:A', ring: rect(8.15, 51.32, 8.30, 51.40) },
        { certificateIri: 'urn:cert:B', ring: rect(8.50, 51.50, 8.60, 51.60) },
      ],
      ringAreaHectares,
    );

    expect(hits).toHaveLength(1);
    expect(hits[0].certificateIri).toBe('urn:cert:A');
    expect(hits[0].rings.length).toBeGreaterThan(0);
  });

  it('ignoriert Überschneidungen unterhalb der Mindestgröße', () => {
    // Nur ein hauchdünner Streifen (~1 m) — Rundungsrauschen, kein Konflikt.
    const sliver = rect(8.199_99, 51.30, 8.30, 51.35);
    const hits = findOverlaps(
      candidate,
      [{ certificateIri: 'urn:cert:A', ring: sliver }],
      ringAreaHectares,
    );
    expect(hits).toEqual([]);
  });

  it('meldet mehrere betroffene Flächen', () => {
    const hits = findOverlaps(
      candidate,
      [
        { certificateIri: 'urn:cert:A', ring: rect(8.10, 51.30, 8.14, 51.35) },
        { certificateIri: 'urn:cert:B', ring: rect(8.16, 51.30, 8.20, 51.35) },
      ],
      ringAreaHectares,
    );
    expect(hits.map((h) => h.certificateIri).sort()).toEqual([
      'urn:cert:A',
      'urn:cert:B',
    ]);
  });

  it('gibt bei leerem Bestand nichts zurück (erster Vorgang überhaupt)', () => {
    expect(findOverlaps(candidate, [], ringAreaHectares)).toEqual([]);
  });
});
