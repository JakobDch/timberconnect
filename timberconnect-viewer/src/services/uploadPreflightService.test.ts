import { describe, it, expect, vi } from 'vitest';

// pdfIdentityService zieht pdfjs-dist nach, das ausserhalb des Browsers
// nicht ladbar ist (DOMMatrix). Fuer die reinen Funktionen hier reicht ein
// leerer Ersatz; die Ident-Extraktion wird ueber deps injiziert.
vi.mock('./pdfIdentityService', () => ({ extractPdfIdentity: vi.fn() }));
vi.mock('./uploadService', () => ({ previewIdents: vi.fn() }));
vi.mock('./processService', () => ({
  forgetProcessesByContainer: vi.fn(),
  getProcesses: vi.fn(() => []),
}));
vi.mock('./podResetService', () => ({
  executePodReset: vi.fn(),
  planPodReset: vi.fn(),
  selectPlanContainers: vi.fn(),
}));
vi.mock('../config/solidPods', () => ({ getAllProductsAsync: vi.fn() }));
vi.mock('./catalogService', () => ({ invalidateCache: vi.fn() }));
vi.mock('./authFetch', () => ({ getAuthFetch: () => fetch }));

import {
  collectProposedDocuments,
  proposedFromPdfIdentity,
  proposedFromPreview,
  resolveOwnContainer,
  summarizePreflight,
  type DocumentVerdict,
  type ProposedDocument,
} from './uploadPreflightService';

const HOST = 'https://solid-community-server.tmdt.info';
const OWN = `${HOST}/user2/`;
const STAMM_1 = 'urn:epc:id:sgtin:404711145.0100.12A3D4567';
const STAMM_2 = 'urn:epc:id:sgtin:404711145.0100.56KCTQMJM';
const LAMELLE = 'urn:epc:id:sgtin:404711146.0212.120231002917';
const SAATGUT = 'urn:epc:class:lgtin:404711145.0001.Pflanzung01';

function verdict(partial: Partial<DocumentVerdict> & { label: string }): DocumentVerdict {
  return {
    status: 'free',
    ownerPods: [],
    ownBizTransactions: [],
    takenEpcs: [],
    missingInputs: [],
    existingEventCount: 0,
    ...partial,
  };
}

describe('proposedFromPdfIdentity', () => {
  it('macht aus dem Stammzertifikat ein ObjectEvent mit der Saatgut-LGTIN', () => {
    const doc = proposedFromPdfIdentity(
      'stamm.pdf',
      { label: 'Stammzertifikat', dataType: 'pdf_stammzertifikat' },
      { epc: SAATGUT, fieldName: 'Identity' },
    );
    expect(doc).toEqual({
      label: 'Stammzertifikat',
      fileName: 'stamm.pdf',
      eventType: 'ObjectEvent',
      outputEpcs: [SAATGUT],
      inputEpcs: [],
    });
  });

  it('fasst Saegevorgaenge zu einem TransformationEvent zusammen', () => {
    const doc = proposedFromPdfIdentity(
      'dop.pdf',
      { label: 'Leistungserklärung', dataType: 'pdf_leistungserklaerung' },
      {
        epc: LAMELLE,
        fieldName: 'Identity_1',
        sawings: [
          { materialInputEpc: [STAMM_1], materialEpc: [LAMELLE] },
          { materialInputEpc: [STAMM_2], materialEpc: [LAMELLE] },
        ],
      },
    );
    expect(doc?.eventType).toBe('TransformationEvent');
    expect(doc?.inputEpcs).toEqual([STAMM_1, STAMM_2]);
    expect(doc?.outputEpcs).toEqual([LAMELLE]);
  });

  it('erzeugt fuer Beidokumente nichts -- sie loesen kein Event aus', () => {
    const doc = proposedFromPdfIdentity(
      'transport.pdf',
      { label: 'Transportauftrag', dataType: 'pdf_transportauftrag' },
      { epc: STAMM_1, fieldName: 'Identity' },
    );
    expect(doc).toBeNull();
  });
});

describe('proposedFromPreview', () => {
  it('uebernimmt die Vorschau des Konverters', () => {
    const doc = proposedFromPreview({
      filename: 'x.hpr',
      data_type: 'forst',
      creates_event: true,
      event_type: 'ObjectEvent',
      output_epcs: [STAMM_1, STAMM_1, STAMM_2],
      input_epcs: [],
      error: null,
    });
    expect(doc?.outputEpcs).toEqual([STAMM_1, STAMM_2]);
  });

  it('ignoriert Dateien ohne Event (IFC, unbekannt)', () => {
    expect(
      proposedFromPreview({
        filename: 'plan.ifc',
        data_type: 'planung',
        creates_event: false,
        error: null,
      }),
    ).toBeNull();
  });
});

describe('collectProposedDocuments', () => {
  it('liest PDFs lokal und fragt fuer Maschinendaten den Konverter', async () => {
    const pdf = new File(['%PDF'], 'stamm.pdf', { type: 'application/pdf' });
    const hpr = new File(['<hpr/>'], 'x.hpr');
    const previewIdents = vi.fn(async () => [
      {
        filename: 'x.hpr',
        data_type: 'forst',
        creates_event: true,
        event_type: 'ObjectEvent' as const,
        output_epcs: [STAMM_1],
        input_epcs: [],
        error: null,
      },
    ]);
    const { documents, errors } = await collectProposedDocuments(
      [
        { file: pdf, isPdf: true, template: { label: 'Stammzertifikat', dataType: 'pdf_stammzertifikat' } },
        { file: hpr, isPdf: false, template: null },
      ],
      '4047111',
      {
        extractIdentity: async () => ({ epc: SAATGUT, fieldName: 'Identity' }),
        previewIdents,
      },
    );
    expect(errors).toEqual([]);
    expect(documents.map((d) => d.outputEpcs)).toEqual([[SAATGUT], [STAMM_1]]);
    expect(previewIdents).toHaveBeenCalledWith([hpr], '4047111');
  });

  it('fragt den Konverter nicht, wenn nur PDFs ohne Event dabei sind', async () => {
    const pdf = new File(['%PDF'], 'transport.pdf', { type: 'application/pdf' });
    const previewIdents = vi.fn();
    const { documents } = await collectProposedDocuments(
      [{ file: pdf, isPdf: true, template: { label: 'Transportauftrag', dataType: 'pdf_transportauftrag' } }],
      '4047111',
      { extractIdentity: async () => null, previewIdents },
    );
    expect(documents).toEqual([]);
    expect(previewIdents).not.toHaveBeenCalled();
  });
});

describe('summarizePreflight', () => {
  const docs: ProposedDocument[] = [
    { label: 'Harvesterprotokoll', fileName: 'x.hpr', eventType: 'ObjectEvent', outputEpcs: [STAMM_1, STAMM_2], inputEpcs: [] },
  ];

  it('ist frei, wenn kein Dokument einen Treffer hat', () => {
    const summary = summarizePreflight([verdict({ label: 'Harvesterprotokoll' })], docs);
    expect(summary.outcome).toBe('free');
    expect(summary.replaceFiles).toEqual([]);
  });

  it('bietet das Ersetzen an, wenn der eigene Vorgang inhaltsgleich vorliegt', () => {
    const summary = summarizePreflight(
      [
        verdict({
          label: 'Harvesterprotokoll',
          status: 'own-identical',
          ownerPods: [OWN],
          ownBizTransactions: [`${OWN}data/f65c`],
          takenEpcs: [STAMM_1, STAMM_2],
          existingEventCount: 9,
        }),
      ],
      docs,
    );
    expect(summary.outcome).toBe('replace');
    expect(summary.replaceFiles).toEqual(['x.hpr']);
    expect(summary.replaceEpcs).toEqual([STAMM_1, STAMM_2]);
    expect(summary.ownBizTransactions).toEqual([`${OWN}data/f65c`]);
    expect(summary.message).toContain('nur die Produktdaten in Ihrem Pod');
    // Keine Technik im Klartext.
    expect(summary.message).not.toMatch(/bizTransaction|EPCAT|urn:/);
  });

  it('sperrt bei einem fremden Pod und nennt ihn beim Namen', () => {
    const summary = summarizePreflight(
      [verdict({ label: 'Harvesterprotokoll', status: 'foreign', ownerPods: [`${HOST}/sawmill/`] })],
      docs,
    );
    expect(summary.outcome).toBe('blocked');
    expect(summary.message).toContain('anderen Teilnehmer');
    expect(summary.message).toContain('sawmill');
    expect(summary.replaceFiles).toEqual([]);
  });

  it('sperrt, sobald EIN Dokument fremd ist -- auch neben einem ersetzbaren', () => {
    const summary = summarizePreflight(
      [
        verdict({ label: 'Harvesterprotokoll', status: 'own-identical', ownerPods: [OWN] }),
        verdict({ label: 'Stammzertifikat', status: 'foreign', ownerPods: [`${HOST}/forst/`] }),
      ],
      docs,
    );
    expect(summary.outcome).toBe('blocked');
  });

  it('sperrt herrenlose Events mit Hinweis auf den Betreiber', () => {
    const summary = summarizePreflight(
      [verdict({ label: 'Harvesterprotokoll', status: 'unassigned' })],
      docs,
    );
    expect(summary.outcome).toBe('blocked');
    expect(summary.message).toContain('Betreiber');
  });

  it('sperrt den eigenen Vorgang mit anderen Ident-Listen', () => {
    const summary = summarizePreflight(
      [verdict({ label: 'Harvesterprotokoll', status: 'own-different', ownerPods: [OWN] })],
      docs,
    );
    expect(summary.outcome).toBe('blocked');
    expect(summary.message).toContain('geänderten IDs');
  });

  it('meldet unbekanntes Vormaterial als Hinweis, nicht als Sperre', () => {
    const summary = summarizePreflight(
      [verdict({ label: 'Leistungserklärung', missingInputs: [STAMM_1, STAMM_2] })],
      docs,
    );
    expect(summary.outcome).toBe('free');
    expect(summary.notes).toHaveLength(1);
    expect(summary.notes[0]).toContain('2 Material-IDs');
  });
});

describe('resolveOwnContainer', () => {
  const never = async () => false;

  it('nimmt zuerst den lokalen Vorgangsindex', async () => {
    const match = await resolveOwnContainer([STAMM_1], [], OWN, {
      getProcesses: () =>
        [
          {
            id: 'VG-2026-0902-7a04',
            containerUrl: `${OWN}data/VG-2026-0902-7a04/`,
            materialEpcs: [STAMM_1],
          },
        ] as never,
      getProducts: async () => [],
      exists: never,
    });
    expect(match).toEqual({
      containerUrl: `${OWN}data/VG-2026-0902-7a04/`,
      processId: 'VG-2026-0902-7a04',
      via: 'local-index',
    });
  });

  it('prueft die bizTransaction als Container -- Vorgangscontainer vor Hash', async () => {
    const probed: string[] = [];
    const match = await resolveOwnContainer(
      [STAMM_1],
      [`${OWN}data/VG-2026-0902-7a04/f65c_forst.ttl`],
      OWN,
      {
        getProcesses: () => [],
        getProducts: async () => [],
        exists: async (url) => {
          probed.push(url);
          return url.endsWith('/VG-2026-0902-7a04/');
        },
      },
    );
    expect(match?.via).toBe('biz-transaction');
    expect(match?.containerUrl).toBe(`${OWN}data/VG-2026-0902-7a04/`);
    expect(probed[0]).toBe(`${OWN}data/VG-2026-0902-7a04/`);
  });

  it('faellt auf den Katalog zurueck und nimmt nur Quellen im eigenen Pod', async () => {
    const match = await resolveOwnContainer([STAMM_1], [`${OWN}data/DoP-1`], OWN, {
      getProcesses: () => [],
      getProducts: async () => [
        {
          id: STAMM_1,
          name: 'x',
          description: '',
          sources: [`${HOST}/sawmill/data/abc/abc_saegewerk.ttl`, `${OWN}data/f65c/f65c_forst.ttl`],
        },
      ],
      exists: never,
    });
    expect(match).toEqual({ containerUrl: `${OWN}data/f65c/`, processId: null, via: 'catalog' });
  });

  it('raet nicht, wenn nichts gefunden wird', async () => {
    const match = await resolveOwnContainer([STAMM_1], [`${HOST}/other/data/x`], OWN, {
      getProcesses: () => [],
      getProducts: async () => [],
      exists: never,
    });
    expect(match).toBeNull();
  });
});

describe('Dokumente ohne Event: Pruefung im Datenraum', () => {
  const OWN = 'https://solid-community-server.tmdt.info/jakob/';
  const FOREIGN = 'https://solid-community-server.tmdt.info/bspwerk/';
  const PANEL = 'urn:epc:id:sgtin:404711148.0401.143138262901';
  const planung = { label: 'Ausführungsplanung', fileName: 'bauteil.ifc', kind: 'planung', epcs: [PANEL] };

  const product = (sources: string[]) => ({ id: PANEL, name: '', description: '', sources });

  it('liest die Dokumentart aus dem Dateinamen', async () => {
    const { documentKindOfUrl } = await import('./uploadPreflightService');
    expect(documentKindOfUrl(`${OWN}data/VG-2026-1106-ab12/9f3c_planung.ttl`)).toBe('planung');
    expect(documentKindOfUrl(`${OWN}data/x/1a2b_pdf_transportauftrag.ttl`)).toBe('pdf_transportauftrag');
  });

  it('findet die eigene Planung zum selben Bauteil -- Original und TTL als ein Treffer', async () => {
    const { findExistingDocuments } = await import('./uploadPreflightService');
    const hits = await findExistingDocuments([planung], OWN, {
      getProducts: async () => [product([`${OWN}data/VG-1/9f3c_planung.ttl`, `${OWN}data/VG-1/9f3c_planung.ifc`, `${OWN}data/VG-2/aa11_herstellung.ttl`])],
      getProcesses: () => [],
    });
    expect(hits).toEqual([{ label: 'Ausführungsplanung', url: `${OWN}data/VG-1/9f3c_planung.ttl`, own: true, podBase: OWN }]);
  });

  it('ignoriert Dokumente anderer Art zum selben Bauteil', async () => {
    const { findExistingDocuments } = await import('./uploadPreflightService');
    const hits = await findExistingDocuments([planung], OWN, {
      getProducts: async () => [product([`${FOREIGN}data/VG-2/aa11_herstellung.ttl`])],
      getProcesses: () => [],
    });
    expect(hits).toEqual([]);
  });

  it('kennt eigene Uploads dieser Sitzung auch ohne aktuellen Katalog', async () => {
    const { findExistingDocuments } = await import('./uploadPreflightService');
    const hits = await findExistingDocuments([planung], OWN, {
      getProducts: async () => [],
      getProcesses: () => [
        { id: 'VG-1', type: 'planung', registeredAt: '', containerUrl: `${OWN}data/VG-1/`, ownerWebId: '', title: '', eventIds: [], materialEpcs: [PANEL],
          files: [{ name: 'bauteil.ifc', size: 1, url: `${OWN}data/VG-1/9f3c_planung.ttl`, isLeadDoc: true, dataType: 'planung', addedAt: '' }] },
      ],
    });
    expect(hits.map((h) => h.own)).toEqual([true]);
  });

  it('sperrt bei fremdem Dokument und fragt bei eigenem nach', async () => {
    const { mergeExistingDocuments, summarizePreflight } = await import('./uploadPreflightService');
    const free = summarizePreflight([], []);
    const blocked = mergeExistingDocuments(free, [{ label: 'Ausführungsplanung', url: `${FOREIGN}data/x/1_planung.ttl`, own: false, podBase: FOREIGN }]);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.message).toContain('bspwerk');

    const replace = mergeExistingDocuments(free, [{ label: 'Ausführungsplanung', url: `${OWN}data/x/1_planung.ttl`, own: true, podBase: OWN }]);
    expect(replace.outcome).toBe('replace');
    expect(replace.replaceDocuments).toEqual([`${OWN}data/x/1_planung.ttl`]);
    expect(replace.replaceFiles).toEqual([]);
  });

});
