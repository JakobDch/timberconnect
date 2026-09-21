import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Wettlauf bei der Katalog-Initialisierung (Befund 18.09.2026).
 *
 * Direkt nach Anmeldung schlug ein Scan mit "Keine verknuepften Pod-Daten
 * erreichbar" fehl, eine halbe Minute spaeter ging er durch. Ursache: zwei
 * gleichzeitige initializeCatalog-Aufrufe; der zweite bekam vom Katalogdienst
 * einen halbfertigen Stand (0 Produkte) und erklaerte den Katalog fuer
 * initialisiert. Gleichzeitige Aufrufer muessen sich EINEN Lauf teilen.
 */

const getCatalogProducts = vi.fn();
vi.mock('../services/catalogService', () => ({
  getCatalogProducts: () => getCatalogProducts(),
  getSourcesForProductFromCatalog: () => [],
  searchProductById: async () => null,
  invalidateCache: () => {},
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('initializeCatalog', () => {
  beforeEach(() => {
    vi.resetModules();
    getCatalogProducts.mockReset();
  });

  it('teilt gleichzeitige Aufrufer einen einzigen Lauf', async () => {
    const run = deferred<{ id: string; name: string; description: string; sources: string[] }[]>();
    getCatalogProducts.mockReturnValue(run.promise);

    const pods = await import('./solidPods');
    const first = pods.initializeCatalog();
    const second = pods.getAllProductsAsync(); // z.B. Scan-Screen, waehrend der erste laeuft

    expect(getCatalogProducts).toHaveBeenCalledTimes(1);
    expect(pods.isCatalogInitialized()).toBe(false);

    run.resolve([{ id: 'urn:epc:id:sgtin:1.2.3', name: 'BSP', description: '', sources: ['a'] }]);
    await first;
    const products = await second;

    expect(products.map((p) => p.id)).toEqual(['urn:epc:id:sgtin:1.2.3']);
    expect(pods.isCatalogInitialized()).toBe(true);
  });

  it('startet nach einem Fehlschlag beim naechsten Aufruf neu', async () => {
    getCatalogProducts.mockRejectedValueOnce(new Error('Register nicht erreichbar'));
    const pods = await import('./solidPods');

    await expect(pods.initializeCatalog()).rejects.toThrow('Register nicht erreichbar');
    expect(pods.getCatalogError()).toContain('Register');

    getCatalogProducts.mockResolvedValueOnce([]);
    await pods.initializeCatalog();
    expect(getCatalogProducts).toHaveBeenCalledTimes(2);
    expect(pods.isCatalogInitialized()).toBe(true);
  });
});
