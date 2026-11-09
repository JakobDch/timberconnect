import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as solid from '@inrupt/solid-client';
import { NAMESPACES } from '../config/solidPods';

// Ein Pod im Speicher: Dokument-URL -> Dataset. Fehlende URLs liefern den
// Status aus `statusFor` (Default 404), wie es solid-client als FetchError tut.
const store = new Map<string, solid.SolidDataset>();
const statusFor = new Map<string, number>();
const headStatus = new Map<string, number>();
const saved: string[] = [];

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { statusCode: status });
}

vi.mock('@inrupt/solid-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@inrupt/solid-client')>();
  return {
    ...real,
    getSolidDataset: vi.fn(async (url: string) => {
      const ds = store.get(url);
      if (ds) return ds;
      throw httpError(statusFor.get(url) ?? 404);
    }),
    saveSolidDatasetAt: vi.fn(async (url: string, ds: solid.SolidDataset) => {
      store.set(url, ds);
      saved.push(url);
      return ds;
    }),
    // ACL-Stempel sind fuer diesen Test belanglos und duerfen scheitern.
    getSolidDatasetWithAcl: vi.fn(async () => {
      throw httpError(403);
    }),
  };
});

vi.mock('./authFetch', () => ({
  getAuthFetch: () => async (url: string) =>
    new Response(null, { status: headStatus.get(url) ?? 200 }),
}));

const { pruneOrphanedDocumentPolicies, syncEpcisConsentFromDocuments } = await import(
  './accessControlService'
);

const POD = 'https://pod.example/bspwerk/';
const TC = NAMESPACES.tc;
const ALLOWS = `${TC}allowsRole`;
const EPC = `${TC}epc`;
const LDP_CONTAINS = 'http://www.w3.org/ns/ldp#contains';
const ZERT = `${TC}Zertifizierer`;
const SAEG = `${TC}Saegewerk`;
const EPC_X = 'urn:epc:id:sgtin:404711148.0401.143138262901';
const EPC_STALE = 'urn:epc:id:sgtin:404711146.0212.999';

function dataset(things: { url: string; urls?: [string, string[]][]; restricted?: boolean }[]) {
  let ds = solid.createSolidDataset();
  for (const t of things) {
    let b = solid.buildThing(solid.createThing({ url: t.url }));
    if (t.restricted) b = b.addBoolean(`${TC}restricted`, true);
    for (const [pred, values] of t.urls ?? []) for (const v of values) b = b.addUrl(pred, v);
    ds = solid.setThing(ds, b.build());
  }
  return ds;
}

function rule(url: string, roles: string[], epcs: string[] = []) {
  return { url, restricted: true, urls: [[ALLOWS, roles], [EPC, epcs]] as [string, string[]][] };
}

function container(url: string, files: string[]) {
  return dataset([{ url, urls: [[LDP_CONTAINS, files]] }]);
}

function subjects(url: string): string[] {
  return solid.getThingAll(store.get(url)!).map((t) => solid.asUrl(t)).sort();
}

function rolesOf(url: string, subject: string): string[] {
  const thing = solid.getThing(store.get(url)!, subject);
  return thing ? solid.getUrlAll(thing, ALLOWS).sort() : [];
}

beforeEach(() => {
  store.clear();
  statusFor.clear();
  headStatus.clear();
  saved.length = 0;
  store.set(`${POD}access/role-policy.ttl`, dataset([
    { url: `${POD}access/role-policy.ttl#policy`, urls: [[ALLOWS, [ZERT, SAEG]]] },
  ]));
});

describe('pruneOrphanedDocumentPolicies', () => {
  it('entfernt nur Regeln, deren Datei der Server ausdruecklich vermisst', async () => {
    const old = `${POD}data/f76f16bd6e075733/f76f16bd6e075733_herstellung.ttl`;
    const current = `${POD}data/VG-2026-0930-7575/219ac8c758352c96_herstellung.ttl`;
    const goneInExisting = `${POD}data/VG-2026-0930-7575/weg.ttl`;
    const oddlyEncoded = `${POD}data/VG-2026-0930-7575/anders.ttl`;
    const locked = `${POD}data/gesperrt/b.ttl`;

    store.set(`${POD}access/doc-policy.ttl`, dataset([
      rule(old, [SAEG], [EPC_X]),
      rule(current, [ZERT, SAEG], [EPC_X]),
      rule(goneInExisting, [SAEG]),
      rule(oddlyEncoded, [SAEG]),
      rule(locked, [SAEG]),
    ]));
    // Alter Hash-Container ist weg (404), der aktuelle listet nur eine Datei.
    store.set(`${POD}data/VG-2026-0930-7575/`, container(`${POD}data/VG-2026-0930-7575/`, [current]));
    statusFor.set(`${POD}data/gesperrt/`, 403);
    headStatus.set(goneInExisting, 404);
    headStatus.set(oddlyEncoded, 200);

    store.set(`${POD}access/epcis-consent.ttl`, dataset([
      { url: `${TC}defaultConsent`, urls: [[ALLOWS, [ZERT, SAEG]]] },
      { url: EPC_X, urls: [[ALLOWS, [SAEG]]] },
      { url: EPC_STALE, urls: [[ALLOWS, [SAEG]]] },
    ]));

    const removed = await pruneOrphanedDocumentPolicies(POD);

    expect(removed).toBe(2);
    expect(subjects(`${POD}access/doc-policy.ttl`)).toEqual(
      [current, locked, oddlyEncoded].sort(),
    );
    // Der Ident folgt jetzt nur noch dem vorhandenen Dokument ...
    expect(rolesOf(`${POD}access/epcis-consent.ttl`, EPC_X)).toEqual([SAEG, ZERT].sort());
    // ... und ein Ident ohne Dokument faellt auf #default zurueck.
    expect(subjects(`${POD}access/epcis-consent.ttl`)).toEqual([`${TC}defaultConsent`, EPC_X].sort());
  });

  it('schreibt nichts, wenn keine Regel verwaist ist', async () => {
    const current = `${POD}data/VG-1/a.ttl`;
    store.set(`${POD}access/doc-policy.ttl`, dataset([rule(current, [SAEG])]));
    store.set(`${POD}data/VG-1/`, container(`${POD}data/VG-1/`, [current]));

    expect(await pruneOrphanedDocumentPolicies(POD)).toBe(0);
    expect(saved).toEqual([]);
  });
});

describe('syncEpcisConsentFromDocuments', () => {
  it('laesst den Consent stehen, wenn die Dokumentregeln nicht lesbar sind', async () => {
    statusFor.set(`${POD}access/doc-policy.ttl`, 503);
    store.set(`${POD}access/epcis-consent.ttl`, dataset([
      { url: EPC_X, urls: [[ALLOWS, [SAEG]]] },
    ]));

    await expect(syncEpcisConsentFromDocuments(`${POD}profile/card#me`)).rejects.toThrow();
    expect(saved).toEqual([]);
  });
});
