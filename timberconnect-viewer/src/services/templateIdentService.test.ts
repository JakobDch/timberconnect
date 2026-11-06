import { describe, it, expect, vi } from 'vitest';

// Der Dienst haengt fuer die Gegenprobe am Preflight-Dienst; der zieht
// pdfjs-dist nach, das ausserhalb des Browsers nicht ladbar ist.
vi.mock('./uploadPreflightService', () => ({ checkProposedDocuments: vi.fn() }));

import {
  buildEpc,
  identSpecFor,
  issueNewEpcs,
  isValidEpc,
  itemRefFor,
  kindOfEpc,
  newSerial,
  parseEpcList,
  planTemplateIdents,
  prefillFields,
} from './templateIdentService';

const GCP10 = '4047111124';
const GCP9 = '404711145';

describe('itemRefFor', () => {
  it('fuellt die Artikelnummer auf 13 Stellen zusammen mit dem Praefix auf', () => {
    expect(itemRefFor('lamelle', GCP10)).toBe('212');
    expect(itemRefFor('stamm', GCP9)).toBe('0100');
    expect(itemRefFor('saatgut', GCP9)).toBe('0001');
  });

  it('lehnt Praefixe ab, die fuer die Produktart keinen Platz lassen', () => {
    expect(() => itemRefFor('lamelle', '404711112345')).toThrow(/Firmenpräfix/);
  });
});

describe('buildEpc / kindOfEpc', () => {
  it('bildet SGTIN fuer Stueckware und LGTIN fuer Losware', () => {
    expect(buildEpc('lamelle', GCP10, 'T261105ABCDEF')).toBe(
      'urn:epc:id:sgtin:4047111124.212.T261105ABCDEF',
    );
    expect(buildEpc('saatgut', GCP10, 'T261105ABCDEF')).toBe(
      'urn:epc:class:lgtin:4047111124.001.T261105ABCDEF',
    );
  });

  it('erkennt die Produktart auch an den Demo-IDs', () => {
    expect(kindOfEpc('urn:epc:id:sgtin:404711145.0100.12A3D4567')).toBe('stamm');
    expect(kindOfEpc('urn:epc:id:sgtin:404711146.0212.120231002917')).toBe('lamelle');
    expect(kindOfEpc('urn:epc:id:sgtin:404711148.0401.143138262901')).toBe('platte');
    expect(kindOfEpc('urn:epc:class:lgtin:404711145.0001.Pflanzung01')).toBe('saatgut');
    expect(kindOfEpc('urn:epc:class:lgtin:40471113.00301.242363084703')).toBe('klebstoff');
    expect(kindOfEpc('urn:epc:id:sgtin:404711145.0777.X')).toBeNull();
  });

  it('erzeugt IDs, die der Upload als gueltig liest', () => {
    for (const kind of ['saatgut', 'stamm', 'lamelle', 'platte', 'klebstoff'] as const) {
      expect(isValidEpc(buildEpc(kind, GCP10, newSerial()))).toBe(true);
    }
  });
});

describe('newSerial', () => {
  it('traegt Datum und Zufallsteil ohne verwechselbare Zeichen', () => {
    const serial = newSerial(new Date(2026, 10, 5), () => 0.5);
    expect(serial).toMatch(/^T261105[0-9A-HJ-NP-Z]{6}$/);
  });
});

describe('issueNewEpcs', () => {
  it('liefert die verlangte Zahl verschiedener IDs', async () => {
    let n = 0;
    const epcs = await issueNewEpcs('lamelle', 5, GCP10, {
      taken: async () => new Set(),
      serial: () => `S${n++}`,
    });
    expect(epcs).toHaveLength(5);
    expect(new Set(epcs).size).toBe(5);
  });

  it('zieht nur die vergebenen IDs neu', async () => {
    let n = 0;
    const taken = vi
      .fn()
      .mockResolvedValueOnce(new Set([`urn:epc:id:sgtin:${GCP10}.212.S0`]))
      .mockResolvedValueOnce(new Set());
    const epcs = await issueNewEpcs('lamelle', 2, GCP10, { taken, serial: () => `S${n++}` });
    expect(epcs).not.toContain(`urn:epc:id:sgtin:${GCP10}.212.S0`);
    expect(epcs).toHaveLength(2);
    expect(taken).toHaveBeenCalledTimes(2);
  });

  it('gibt keine IDs aus, wenn das Repository nicht erreichbar ist', async () => {
    await expect(
      issueNewEpcs('saatgut', 1, GCP10, {
        taken: async () => {
          throw new Error('Das Verzeichnis der Material-IDs im Datenraum ist gerade nicht erreichbar.');
        },
      }),
    ).rejects.toThrow(/nicht erreichbar/);
  });

  it('bricht ab statt eine vergebene ID auszuliefern', async () => {
    await expect(
      issueNewEpcs('stamm', 1, GCP10, {
        taken: async (epcs) => new Set(epcs),
        serial: () => 'IMMERGLEICH',
      }),
    ).rejects.toThrow(/keine freien/);
  });
});

describe('prefillFields', () => {
  const STAMM = 'urn:epc:id:sgtin:404711145.0100.12A3D4567';
  const LAM = `urn:epc:id:sgtin:${GCP10}.212.T1`;

  it('legt fuer die Leistungserklaerung ein Saegevorgangs-Paar an', () => {
    expect(prefillFields(identSpecFor('pdf_leistungserklaerung'), [LAM], [STAMM])).toEqual({
      Identity_1: [LAM],
      IdentityInput_1: [STAMM],
    });
  });

  it('schreibt den Bezug eines Beidokuments ins Identity-Feld', () => {
    expect(prefillFields(identSpecFor('pdf_transportauftrag_rundholz'), [], [STAMM])).toEqual({
      Identity: [STAMM],
    });
  });

  it('schreibt das Erzeugnis des Stammzertifikats ins Identity-Feld', () => {
    expect(prefillFields(identSpecFor('pdf_stammzertifikat'), [STAMM], [])).toEqual({
      Identity: [STAMM],
    });
  });
});

describe('parseEpcList', () => {
  it('trennt an Semikolon und Zeilenumbruch und meldet Ungueltiges', () => {
    const { valid, invalid } = parseEpcList(
      'urn:epc:id:sgtin:404711145.0100.A;\nurn:epc:id:sgtin:404711145.0100.B quatsch',
    );
    expect(valid).toHaveLength(2);
    expect(invalid).toEqual(['quatsch']);
  });
});

describe('planTemplateIdents', () => {
  it('belegt die Leistungserklaerung beidseitig mit frischen IDs', () => {
    expect(planTemplateIdents('pdf_leistungserklaerung')).toEqual({
      output: { kind: 'lamelle', count: 7 },
      input: { kind: 'stamm', count: 3 },
    });
  });

  it('vergibt fuer das Stammzertifikat genau eine neue Saatgut-ID', () => {
    expect(planTemplateIdents('pdf_stammzertifikat')).toEqual({
      output: { kind: 'saatgut', count: 1 },
      input: null,
    });
  });

  it('gibt auch Beidokumenten frische Bezugs-IDs', () => {
    expect(planTemplateIdents('pdf_transportauftrag_rundholz').input).toEqual({ kind: 'stamm', count: 5 });
    expect(planTemplateIdents('pdf_biegepruefung').input).toEqual({ kind: 'lamelle', count: 1 });
    expect(planTemplateIdents('pdf_klebstoffdatenblatt').input).toEqual({ kind: 'klebstoff', count: 1 });
  });
});
