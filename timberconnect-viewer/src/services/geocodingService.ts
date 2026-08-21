/**
 * Adressen zu Koordinaten aufloesen (Nominatim/OpenStreetMap).
 *
 * Warum ueberhaupt: der Herkunftsnachweis zeigt alle drei Akteure auf einer
 * Karte. Fuer den Wald liegen echte Messkoordinaten aus StanForD vor, fuer
 * Saegewerk und Holzwerkstoffproduzent stehen in den Daten aber nur
 * Textadressen. Ohne Geocoding blieben zwei der drei Marker leer.
 *
 * Nominatim ist ein fremder, kostenloser Dienst -- entsprechend zurueckhaltend
 * wird er benutzt:
 *   - hoechstens 1 Anfrage/Sekunde (Nutzungsrichtlinie), streng sequentiell
 *   - dauerhafter Cache in localStorage: eine Adresse wird nie zweimal geholt
 *   - Negativtreffer werden mitgecacht, sonst fragt jede Ansicht erneut
 *   - jeder Fehler und jeder Timeout endet in ``null``, nicht in einer
 *     Exception -- die Ansicht muss auch ohne Netz vollstaendig laden
 *
 * Bewusst KEIN Schluessel/Proxy: die Anfrage geht direkt aus dem Browser, es
 * ist keine CSP gesetzt, und pro Produkt fallen hoechstens zwei Anfragen an.
 */

import type { Coordinates } from '../types';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const CACHE_PREFIX = 'tc:geocode:';
const MIN_INTERVAL_MS = 1100; // Nutzungsrichtlinie: max. 1 Anfrage/Sekunde
const TIMEOUT_MS = 5000;

/** Cache fuer diese Session -- vermeidet auch localStorage-Zugriffe. */
const memoryCache = new Map<string, Coordinates | null>();

/** Serialisiert alle Anfragen; haelt zugleich den Mindestabstand ein. */
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

/** Adresse auf einen stabilen Cache-Schluessel normalisieren. */
function cacheKey(address: string): string {
  return CACHE_PREFIX + address.toLowerCase().replace(/\s+/g, ' ').trim();
}

function readCache(key: string): { hit: boolean; value: Coordinates | null } {
  if (memoryCache.has(key)) return { hit: true, value: memoryCache.get(key) ?? null };
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return { hit: false, value: null };
    // "null" ist ein gueltiger Cache-Eintrag: Adresse ist nicht aufloesbar.
    const parsed = JSON.parse(raw) as Coordinates | null;
    memoryCache.set(key, parsed);
    return { hit: true, value: parsed };
  } catch {
    return { hit: false, value: null };
  }
}

function writeCache(key: string, value: Coordinates | null): void {
  memoryCache.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kein localStorage (Privatmodus/Quota) -- der Memory-Cache reicht.
  }
}

/** Wartet, bis der Mindestabstand zur letzten Anfrage eingehalten ist. */
function respectRateLimit(): Promise<void> {
  const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - Date.now());
  return new Promise((resolve) => setTimeout(resolve, wait));
}

async function requestNominatim(address: string): Promise<Coordinates | null> {
  await respectRateLimit();
  lastRequestAt = Date.now();

  const params = new URLSearchParams({
    format: 'json',
    limit: '1',
    countrycodes: 'de',
    q: address,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${NOMINATIM_URL}?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      console.warn('[geocode] Nominatim antwortete mit', response.status);
      return null;
    }

    const results = (await response.json()) as Array<{ lat?: string; lon?: string }>;
    const first = results?.[0];
    if (!first?.lat || !first?.lon) return null;

    const lat = Number(first.lat);
    const lng = Number(first.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch (err) {
    // Abbruch, Netzfehler, CORS -- alles endet als "nicht aufloesbar".
    console.warn('[geocode] Aufloesung fehlgeschlagen fuer', address, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Eine Adresse aufloesen. Liefert ``null``, wenn sie unbekannt ist oder der
 * Dienst nicht erreichbar war -- der Aufrufer zeigt dann schlicht keinen
 * Marker.
 */
export async function geocodeAddress(address: string | null): Promise<Coordinates | null> {
  if (!address || address.trim().length < 3) return null;

  const key = cacheKey(address);
  const cached = readCache(key);
  if (cached.hit) return cached.value;

  // Anfragen an die Warteschlange haengen, damit nie zwei parallel laufen.
  const result = queue.then(() => requestNominatim(address));
  queue = result.catch(() => null);

  const coordinates = await result;
  writeCache(key, coordinates);
  return coordinates;
}

/**
 * Mehrere Adressen nacheinander aufloesen (Reihenfolge bleibt erhalten).
 * Sequentiell, nicht parallel -- siehe Nutzungsrichtlinie im Kopfkommentar.
 */
export async function geocodeAll(
  addresses: Array<string | null>,
): Promise<Array<Coordinates | null>> {
  const results: Array<Coordinates | null> = [];
  for (const address of addresses) {
    results.push(await geocodeAddress(address));
  }
  return results;
}
