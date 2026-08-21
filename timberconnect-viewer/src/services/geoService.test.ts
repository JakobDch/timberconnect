import { describe, it, expect } from 'vitest';
import { haversineKm } from './geoService';

describe('haversineKm', () => {
  it('liefert 0 fuer identische Punkte', () => {
    const p = { lat: 51.4, lon: 8.57 };
    expect(haversineKm(p, p)).toBe(0);
  });

  it('trifft die Luftlinie Meschede-Brilon (~21 km)', () => {
    const meschede = { lat: 51.35, lon: 8.28 };
    const brilon = { lat: 51.4, lon: 8.57 };
    const km = haversineKm(meschede, brilon);
    expect(km).toBeGreaterThan(18);
    expect(km).toBeLessThan(24);
  });

  it('ist symmetrisch', () => {
    const a = { lat: 51.0, lon: 7.0 };
    const b = { lat: 52.0, lon: 9.0 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });
});
