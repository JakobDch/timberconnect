import { describe, it, expect } from 'vitest';
import {
  containerOf,
  containerProcessId,
  podOf,
  matchLocalIndex,
  matchDocumentLinks,
  type ProcessInfo,
} from './processLookupService';
import type { ProcessRecord } from './processService';

/**
 * Diese Tests halten den Rueckweg fest, der den bspwerk-Bestand vom
 * 28.08.2026 wieder seinem Vorgang zuordnet: Dateien in "data/<hash>/",
 * process.ttl in "data/VG-2026-0828-xxxx/". Ohne ihn standen registrierte
 * Vorgaenge als "ohne Vorgang" da.
 */

const POD = 'https://pod.example/bspwerk/';
const VG = `${POD}data/VG-2026-0828-ab12/`;
const HASH_A = `${POD}data/f76f16bd6e075733/`;
const HASH_B = `${POD}data/04ee53c238797b0f/`;

function record(over: Partial<ProcessRecord> = {}): ProcessRecord {
  return {
    id: 'VG-2026-0828-ab12',
    type: 'herstellung',
    registeredAt: '2026-08-28T14:00:00.000Z',
    containerUrl: VG,
    ownerWebId: `${POD}profile/card#me`,
    title: 'Herstellungsvorgang vom 28.8.2026',
    files: [
      {
        name: 'erp.xlsx',
        size: 1,
        url: `${HASH_A}f76f16bd6e075733_herstellung.ttl`,
        isLeadDoc: true,
        dataType: 'herstellung',
        addedAt: '2026-08-28T14:00:10.000Z',
      },
    ],
    eventIds: [],
    materialEpcs: [],
    ...over,
  };
}

function info(over: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    label: 'Herstellungsvorgang',
    title: null,
    registeredAt: new Date('2026-08-28T14:00:00.000Z'),
    processId: 'VG-2026-0828-ab12',
    source: 'container',
    ...over,
  };
}

describe('containerOf / podOf / containerProcessId', () => {
  it('schneidet die Container-URL ab', () => {
    expect(containerOf(`${HASH_A}x.ttl`)).toBe(HASH_A);
  });
  it('liest die Pod-Basis', () => {
    expect(podOf(`${HASH_A}x.ttl`)).toBe(POD);
  });
  it('erkennt eine Vorgangs-ID nur im VG-Schema', () => {
    expect(containerProcessId(VG)).toBe('VG-2026-0828-ab12');
    expect(containerProcessId(HASH_A)).toBeNull();
  });
});

describe('matchLocalIndex', () => {
  it('trifft den Vorgangscontainer direkt', () => {
    const hit = matchLocalIndex(VG, [record()]);
    expect(hit?.label).toBe('Herstellungsvorgang');
    expect(hit?.source).toBe('local-index');
  });

  it('findet einen Hash-Container rueckwaerts ueber die Datei-URLs des Vorgangs', () => {
    // Der Bestand vom 28.08.: die Datei liegt NICHT im Vorgangscontainer.
    const hit = matchLocalIndex(HASH_A, [record()]);
    expect(hit?.processId).toBe('VG-2026-0828-ab12');
  });

  it('ordnet einen fremden Hash-Container keinem Vorgang zu', () => {
    expect(matchLocalIndex(HASH_B, [record()])).toBeNull();
  });
});

describe('matchDocumentLinks', () => {
  it('findet den Vorgang, dessen process.ttl auf eine Datei im Container zeigt', () => {
    const hit = matchDocumentLinks(HASH_A, [
      { info: info(), documentUrls: [`${HASH_A}f76f16bd6e075733_herstellung.ttl`] },
    ]);
    expect(hit?.label).toBe('Herstellungsvorgang');
    expect(hit?.source).toBe('document-link');
  });

  it('haelt zwei Hash-Container verschiedener Vorgaenge auseinander', () => {
    const docs = [
      { info: info(), documentUrls: [`${HASH_A}a.ttl`] },
      {
        info: info({ label: 'Aufsägevorgang', processId: 'VG-2026-0828-cd34' }),
        documentUrls: [`${HASH_B}b.ttl`],
      },
    ];
    expect(matchDocumentLinks(HASH_A, docs)?.processId).toBe('VG-2026-0828-ab12');
    expect(matchDocumentLinks(HASH_B, docs)?.processId).toBe('VG-2026-0828-cd34');
  });

  it('ignoriert Vorgangscontainer ohne Label (unlesbar oder leer)', () => {
    const hit = matchDocumentLinks(HASH_A, [
      { info: info({ label: null, unreadable: true, status: 403 }), documentUrls: [`${HASH_A}a.ttl`] },
    ]);
    expect(hit).toBeNull();
  });

  it('verwechselt keine Praefixe ("data/ab/" trifft nicht "data/abc/")', () => {
    const short = `${POD}data/ab/`;
    const hit = matchDocumentLinks(short, [
      { info: info(), documentUrls: [`${POD}data/abc/x.ttl`] },
    ]);
    expect(hit).toBeNull();
  });
});
