import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Gruppierung der Katalog-Datensaetze zu einem Produkt.
 *
 * Der gemeldete Fall: Eine BSP-Platte wurde als "Produktart nicht bestimmbar"
 * angezeigt. Ursache war nicht die Erkennung, sondern die QUELLENLISTE -- der
 * ERP-Auszug mit ``a tc:Panel`` fehlte darin.
 *
 * Zum Bauteil gehoeren drei Dokumente im Pod des BSP-Werks: der ERP-Auszug,
 * die Leistungserklaerung und das Klebstoffdatenblatt. ``detectDataType``
 * ordnet alle drei der Station "bspwerk" zu -- und die hatte genau EINEN
 * Platz. Jeder Datensatz ueberschrieb den vorigen, uebrig blieb der zuletzt
 * eingelesene. Welcher das ist, entscheidet die Reihenfolge im Container.
 */

// getAuthFetch() wird von extractIdFromData benutzt, um die TTL zu laden und
// daraus die Gruppierungs-Id (hier: der EPC) zu lesen.
const ttlFor = new Map<string, string>();
vi.mock('./authFetch', () => ({
  getAuthFetch: () => (url: string) =>
    Promise.resolve({
      ok: ttlFor.has(url),
      text: () => Promise.resolve(ttlFor.get(url) ?? ''),
    }),
}));

const { groupDatasetsToProducts } = await import('./catalogService');

const POD = 'https://solid-community-server.tmdt.info/bspwerk/data';
const ERP = `${POD}/f76f16bd6e075733/f76f16bd6e075733_herstellung.ttl`;
const DOP = `${POD}/04ee53c238797b0f/04ee53c238797b0f_pdf_leistungserklaerung_bsp.ttl`;
const GLUE = `${POD}/f480a0b2124409e5/f480a0b2124409e5_pdf_klebstoffdatenblatt.ttl`;

const PANEL_EPC = 'urn:epc:id:sgtin:404711148.0401.143138262901';

/** Datensatz in der Form, die fetchAndParseDataset liefert. */
const ds = (title: string, url: string) =>
  ({
    identifier: url.split('/').pop(),
    title,
    description: null,
    issued: null,
    modified: null,
    is_public: true,
    access_url_dataset: url,
    access_url_semantic_model: null,
    file_format: null,
  }) as never;

beforeEach(() => {
  ttlFor.clear();
  // Alle drei Dokumente nennen denselben Bauteil-Ident -- sie gehoeren also
  // zum selben Produkt. Der ERP-Auszug traegt zusaetzlich a tc:Panel.
  ttlFor.set(ERP, `<x> a tc:Panel ; tc:epc <${PANEL_EPC}> .`);
  ttlFor.set(DOP, `<y> a tc:DeclarationOfPerformance ; tc:epc <${PANEL_EPC}> .`);
  ttlFor.set(GLUE, `<z> a tc:Adhesive ; tc:epc <${PANEL_EPC}> .`);
});

describe('groupDatasetsToProducts — mehrere Dokumente derselben Station', () => {
  it('behaelt alle drei BSP-Werk-Dokumente als Quellen', async () => {
    const products = await groupDatasetsToProducts([
      ds('Herstellungsdaten BSP (ERP) - f76f16bd6e075733', ERP),
      ds('Leistungserklärung Brettsperrholz - 04ee53c238797b0f', DOP),
      ds('Klebstoff-Datenblatt (LOCTITE BSP) - f480a0b2124409e5', GLUE),
    ]);

    expect(products).toHaveLength(1);
    expect(products[0].sources).toHaveLength(3);
    // Der ERP-Auszug ist der einzige Traeger der Produktklasse -- er darf
    // unter keinen Umstaenden herausfallen.
    expect(products[0].sources).toContain(ERP);
    expect(products[0].sources).toContain(DOP);
    expect(products[0].sources).toContain(GLUE);
  });

  it('haengt nicht an der Reihenfolge der Datensaetze', async () => {
    // Vorher entschied genau diese Reihenfolge, welches Dokument ueberlebt.
    const reversed = await groupDatasetsToProducts([
      ds('Klebstoff-Datenblatt (LOCTITE BSP) - f480a0b2124409e5', GLUE),
      ds('Leistungserklärung Brettsperrholz - 04ee53c238797b0f', DOP),
      ds('Herstellungsdaten BSP (ERP) - f76f16bd6e075733', ERP),
    ]);

    expect(reversed[0].sources).toHaveLength(3);
    expect(reversed[0].sources).toContain(ERP);
  });

  it('gruppiert Dokumente verschiedener Stationen unter einem Produkt', async () => {
    const forst = `${POD}/aaa/aaa_forst.ttl`;
    ttlFor.set(forst, `<f> a tc:Stem ; tc:epc <${PANEL_EPC}> .`);

    const products = await groupDatasetsToProducts([
      ds('Forstdaten StanForD - aaa', forst),
      ds('Herstellungsdaten BSP (ERP) - f76f16bd6e075733', ERP),
    ]);

    expect(products).toHaveLength(1);
    expect(products[0].sources).toEqual([forst, ERP]); // Wald vor Werk
  });
});
