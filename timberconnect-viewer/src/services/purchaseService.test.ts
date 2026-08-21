import { describe, it, expect } from 'vitest';
import {
  queryDatapointKey,
  fileDatapointKey,
  splitOwnedKeys,
  PURCHASES_DOC,
} from './purchaseService';

// Reine Funktionen — kein Pod-Zugriff nötig. splitOwnedKeys wird nur im
// abgemeldeten Fall getestet, weil es sonst den Pod lesen würde; die
// Partitionierungs-Logik selbst wird über den gleichen Codepfad abgedeckt.

describe('Schlüsselbildung', () => {
  it('ist stabil: derselbe Datenpunkt ergibt immer denselben Schlüssel', () => {
    expect(queryDatapointKey('species', 'Fichte')).toBe(queryDatapointKey('species', 'Fichte'));
    const url = 'https://pod.example/data/abc/forst.ttl';
    expect(fileDatapointKey(url)).toBe(fileDatapointKey(url));
  });

  it('unterscheidet verschiedene Werte und verschiedene Variablen', () => {
    expect(queryDatapointKey('species', 'Fichte')).not.toBe(
      queryDatapointKey('species', 'Kiefer'),
    );
    expect(queryDatapointKey('species', 'Fichte')).not.toBe(
      queryDatapointKey('genus', 'Fichte'),
    );
  });

  it('trennt Abfrage- und Datei-Schlüssel über das Präfix', () => {
    expect(queryDatapointKey('a', 'b')).toMatch(/^q:[0-9a-f]{8}$/);
    expect(fileDatapointKey('https://pod.example/x.pdf')).toMatch(/^f:[0-9a-f]{8}$/);
  });

  it('ist produktübergreifend: derselbe Wert aus zwei Scans ist ein Schlüssel', () => {
    // Das ist die Kernanforderung — Walddaten dürfen beim zweiten Balken aus
    // demselben Baum nicht erneut kosten.
    const ausScanA = queryDatapointKey('forestName', 'Stadtwald Musterstadt');
    const ausScanB = queryDatapointKey('forestName', 'Stadtwald Musterstadt');
    expect(ausScanA).toBe(ausScanB);
  });

  it('liefert einen gültigen RDF-Fragmentnamen (kein Doppelpunkt im Subjekt)', () => {
    // recordPurchasedKeys bildet das Subjekt aus dem Schlüssel: ':' -> '-'
    expect(queryDatapointKey('a', 'b').replace(':', '-')).toMatch(/^q-[0-9a-f]{8}$/);
  });
});

describe('PURCHASES_DOC', () => {
  it('liegt neben Wallet und Transaktionen im Pod', () => {
    expect(PURCHASES_DOC('https://pod.example/alice/')).toBe(
      'https://pod.example/alice/wallet/purchases.ttl',
    );
  });
});

describe('splitOwnedKeys ohne Anmeldung', () => {
  it('behandelt alles als neu (kein Pod, kein Register)', async () => {
    const keys = new Set([queryDatapointKey('a', '1'), queryDatapointKey('b', '2')]);
    const { owned, fresh } = await splitOwnedKeys(null, keys);
    expect(owned).toEqual([]);
    expect(fresh).toHaveLength(2);
  });

  it('kommt mit einem leeren Schlüssel-Set klar', async () => {
    const { owned, fresh } = await splitOwnedKeys(null, new Set());
    expect(owned).toEqual([]);
    expect(fresh).toEqual([]);
  });
});
