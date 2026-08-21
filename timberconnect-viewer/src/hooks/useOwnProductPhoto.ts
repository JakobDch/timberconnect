import { useEffect, useState } from 'react';
import type { Product } from '../types';
import type { ProductDataResult } from '../services/sparqlService';
import { findProductPhoto } from '../services/productPhotoService';
import { useAuth } from '../auth/AuthContext';

/**
 * Das eigene Produktfoto zu einem Produkt suchen -- falls der Uploader beim
 * Registrieren des Vorgangs eines hinterlegt hat.
 *
 * Liefert ``null``, solange nichts gefunden ist; die Aufrufer zeigen dann das
 * Standardbild der Produktart. Bewusst als Hook, damit die Suche genau einmal
 * je Produkt laeuft und beide Ansichten (Scan-Uebersicht und Bauteilkarte im
 * Rueckbau-Awf) dieselbe Logik teilen.
 *
 * Gesucht wird mit dem angemeldeten Nutzer: das Foto liegt im
 * WAC-geschuetzten Vorgangs-Container, ein anonymer Abruf scheitert dort. Ohne
 * Anmeldung wird deshalb gar nicht erst gefragt.
 */
export function useOwnProductPhoto(
  product: Product | null | undefined,
  productData: ProductDataResult | null | undefined,
): string | null {
  const { isLoggedIn, authenticatedFetch } = useAuth();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  // Nur die verfuegbaren Quellen kommen infrage; ihre Container sind die
  // Orte, an denen ein Foto liegen kann.
  const sources = (productData?.sourceStatus ?? [])
    .filter((s) => s.available)
    .map((s) => s.url);
  const sourceKey = sources.join('|');
  const epc = product?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    setPhotoUrl(null);

    if (!isLoggedIn || sources.length === 0) return;

    (async () => {
      const found = await findProductPhoto(authenticatedFetch, sources, epc);
      if (!cancelled) setPhotoUrl(found);
    })();

    return () => {
      cancelled = true;
    };
    // sourceKey statt sources: das Array ist bei jedem Render neu, sein
    // Inhalt aber meist gleich -- sonst liefe die Suche endlos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, authenticatedFetch, sourceKey, epc]);

  return photoUrl;
}
