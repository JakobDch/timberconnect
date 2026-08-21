import { describe, it, expect } from 'vitest';
import {
  buildDamageReportTtl,
  emptyDamageDraft,
  generateDamageReportId,
  validateDamageReport,
  type DamageReportDraft,
  type DamageReportRecord,
} from './damageReportService';

const EPC = 'urn:epc:id:sgtin:404711148.0401.143138262901';

/** Gueltiger Entwurf als Ausgangspunkt -- einzelne Felder werden verbogen. */
function draft(overrides: Partial<DamageReportDraft> = {}): DamageReportDraft {
  return {
    epc: EPC,
    date: '2026-08-20',
    kind: 'Feuchte / Schimmel',
    description: 'Dunkle Verfärbung an der Unterseite, ca. 40 × 20 cm.',
    reportedBy: 'Bauleitung HB-2026-0047',
    moisture: '18,5',
    ...overrides,
  };
}

describe('generateDamageReportId', () => {
  it('folgt dem Muster SD-<jahr>-<mmdd>-<hex>', () => {
    const id = generateDamageReportId(new Date('2026-08-21T10:00:00Z'));
    expect(id).toMatch(/^SD-2026-0821-[0-9a-f]{4}$/);
  });

  it('vergibt bei gleichem Datum verschiedene Ids', () => {
    const now = new Date('2026-08-21T10:00:00Z');
    const ids = new Set(Array.from({ length: 20 }, () => generateDamageReportId(now)));
    // Bei 4 Hex-Zeichen sind Kollisionen moeglich, aber 20 identische Ids
    // waeren ein Zeichen dafuer, dass gar nicht zufaellig gezogen wird.
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe('emptyDamageDraft', () => {
  it('setzt das Schadensdatum auf heute', () => {
    const result = emptyDamageDraft(EPC, new Date('2026-08-21T10:00:00Z'));
    expect(result.date).toBe('2026-08-21');
    expect(result.epc).toBe(EPC);
    expect(result.kind).toBe('');
  });
});

describe('validateDamageReport', () => {
  it('akzeptiert einen vollstaendigen Entwurf', () => {
    const result = validateDamageReport(draft());
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });

  it('verlangt ein Bauteil', () => {
    const result = validateDamageReport(draft({ epc: '  ' }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Bauteil');
  });

  it('verlangt eine Schadensart', () => {
    const result = validateDamageReport(draft({ kind: '' }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Schadensart');
  });

  it('verlangt eine aussagekraeftige Beschreibung', () => {
    const result = validateDamageReport(draft({ description: 'nass' }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('beschreiben');
  });

  it('weist ein Schadensdatum in der Zukunft zurueck', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const result = validateDamageReport(draft({ date: future.toISOString().slice(0, 10) }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Zukunft');
  });

  it('weist eine unplausible Holzfeuchte zurueck', () => {
    expect(validateDamageReport(draft({ moisture: '150' })).ok).toBe(false);
    expect(validateDamageReport(draft({ moisture: 'nass' })).ok).toBe(false);
  });

  it('akzeptiert die Holzfeuchte mit Komma', () => {
    const result = validateDamageReport(draft({ moisture: '18,5' }));
    expect(result.ok).toBe(true);
  });

  it('weist auf Durchfeuchtung hin, ohne zu blockieren', () => {
    // Ueber 20 % ist der Wert, der einen Feuchteschaden stuetzt -- der
    // Hinweis darf die Meldung deshalb nicht verhindern.
    const result = validateDamageReport(draft({ moisture: '24' }));
    expect(result.ok).toBe(true);
    expect(result.hint).toContain('durchfeuchtet');
  });

  it('regt eine Messung an, wenn die Holzfeuchte fehlt', () => {
    const result = validateDamageReport(draft({ moisture: '' }));
    expect(result.ok).toBe(true);
    expect(result.hint).toContain('IST-Zustand');
  });
});

describe('buildDamageReportTtl', () => {
  const record: DamageReportRecord = {
    id: 'SD-2026-0821-ab12',
    epc: EPC,
    date: '2026-08-20',
    kind: 'Feuchte / Schimmel',
    description: 'Dunkle Verfärbung an der Unterseite.',
    reportedBy: 'Bauleitung HB-2026-0047',
    moisture: '18.5',
    createdAt: '2026-08-21T08:00:00.000Z',
    containerUrl: 'https://pod.example/tc/data/schaden/SD-2026-0821-ab12/',
    ownerWebId: 'https://pod.example/tc/profile/card#me',
  };

  it('nutzt den Namespace der v6-Ontologie', () => {
    // Mit einem anderen Namespace waeren die Tripel fuer Abfragen gegen das
    // tc:-Vokabular unsichtbar -- genau der Fehler, der in processService.ts
    // dokumentiert ist.
    expect(buildDamageReportTtl(record)).toContain(
      '@prefix tc: <http://timberconnect.2050.de/ontology#>',
    );
  });

  it('verknuepft die Meldung ueber tc:epc mit dem Bauteil', () => {
    const ttl = buildDamageReportTtl(record);
    expect(ttl).toContain('a tc:DamageReport ;');
    expect(ttl).toContain(`tc:epc <${EPC}>`);
  });

  it('schliesst das letzte Tripel mit einem Punkt ab', () => {
    const ttl = buildDamageReportTtl(record).trimEnd();
    expect(ttl.endsWith(' .')).toBe(true);
    expect(ttl).not.toContain(' ;\n.');
  });

  it('laesst die Holzfeuchte weg, wenn sie nicht gemessen wurde', () => {
    const ttl = buildDamageReportTtl({ ...record, moisture: null });
    expect(ttl).not.toContain('tc:moistureMeasured');
    expect(ttl.trimEnd().endsWith(' .')).toBe(true);
  });

  it('maskiert Anfuehrungszeichen in der Beschreibung', () => {
    // Ohne Maskierung waere das erzeugte Turtle nicht mehr parsbar.
    const ttl = buildDamageReportTtl({
      ...record,
      description: 'Riss am "oberen" Rand',
    });
    expect(ttl).toContain('\\"oberen\\"');
  });
});
