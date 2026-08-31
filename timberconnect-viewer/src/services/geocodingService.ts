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
 * Standort eines Akteurs aufloesen -- Firmenname und Anschrift getrennt.
 *
 * WARUM NICHT EIN EINZIGER STRING: Nominatim sucht die Bestandteile einer
 * Anfrage konjunktiv. Beide Angaben in ein Feld zu werfen laesst die Suche
 * daher genau dann scheitern, wenn eine der beiden nicht in OSM steht -- und
 * das trifft in den echten Lieferkettendaten beide Richtungen:
 *
 *   - "Im Kissen 19, 59929" findet das Saegewerk; mit angehaengtem Firmennamen
 *     ("... , Egger Saegewerk Brilon GmbH") kommt nichts zurueck, weil der
 *     Betrieb dort nicht als benanntes Objekt erfasst ist.
 *   - Beim Holzwerkstoffproduzenten ist es umgekehrt: die Hausnummer der
 *     Industriestrasse fehlt in OSM, die Firma "Poppensieker & Derix" ist als
 *     Objekt aber vorhanden und liefert den Treffer.
 *
 * Eine feste Reihenfolge kann das nicht loesen, deshalb werden mehrere
 * Varianten der Reihe nach probiert -- von der genauesten zur groebsten:
 *
 *   1. Anschrift allein              (Hausnummer-genau, wenn erfasst)
 *   2. Firmenname + Ort              (benanntes Objekt, ohne Hausnummer)
 *   3. Firmenname allein
 *   4. Ort/Postleitzahl aus der Anschrift  (Naeherung auf den Ort)
 *
 * Schritt 4 ist bewusst grob: ein Marker im richtigen Ort ist fuer den
 * Herkunftsnachweis aussagekraeftiger als gar keiner. Alle Treffer aus dieser
 * Kaskade sind ``approximate``, das Kennzeichen setzt der Aufrufer.
 *
 * Der Kaskade liegt derselbe Cache zugrunde wie `geocodeAddress`; zusaetzlich
 * wird das Endergebnis unter einem eigenen Schluessel abgelegt, damit ein
 * zweiter Aufruf nicht erneut durch alle Stufen laeuft.
 */
export async function geocodeActorLocation(
  name: string | null,
  address: string | null,
): Promise<Coordinates | null> {
  const cleanName = name?.trim() || null;
  const cleanAddress = address?.trim() || null;
  if (!cleanName && !cleanAddress) return null;

  // Eigener Schluessel fuer das Gesamtergebnis der Kaskade.
  const key = cacheKey(`actor|${cleanName ?? ''}|${cleanAddress ?? ''}`);
  const cached = readCache(key);
  if (cached.hit) return cached.value;

  // Ortsteil aus der Anschrift: alles nach dem letzten Komma, also der Teil,
  // der Postleitzahl und Ort traegt ("Im Kissen 19, 59929 Brilon" -> "59929
  // Brilon"). Ohne Komma taugt die ganze Zeichenkette nur, wenn sie keine
  // Hausnummer enthaelt -- sonst ist sie als Ortsangabe unbrauchbar.
  const localityPart = cleanAddress?.includes(',')
    ? cleanAddress.slice(cleanAddress.lastIndexOf(',') + 1).trim()
    : cleanAddress && !/\d+\s*[a-zA-Z]?$/.test(cleanAddress)
      ? cleanAddress
      : null;

  const attempts = [
    cleanAddress,
    cleanName && localityPart ? `${cleanName}, ${localityPart}` : null,
    cleanName,
    localityPart,
  ].filter((q): q is string => !!q && q.length >= 3);

  // Doppelte Varianten entfernen -- sonst geht dieselbe Anfrage mehrfach
  // hinaus, und jede kostet nach der Nutzungsrichtlinie eine Sekunde.
  const seen = new Set<string>();
  for (const attempt of attempts) {
    const normalized = attempt.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const position = await geocodeAddress(attempt);
    if (position) {
      writeCache(key, position);
      return position;
    }
  }

  // Keine Variante hat getroffen -- auch das wird gecacht, sonst laeuft die
  // ganze Kaskade bei jedem Ansichtswechsel erneut.
  writeCache(key, null);
  return null;
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

// ---------------------------------------------------------------------------
// Ortssuche (Karte)
// ---------------------------------------------------------------------------

/**
 * Ein Suchtreffer der Ortssuche.
 *
 * Anders als `geocodeAddress` liefert die Suche MEHRERE Kandidaten samt
 * Bounding-Box. Beides ist hier wesentlich:
 *
 *   - Mehrere Treffer, weil der Nutzer tippt statt eine gepflegte Adresse aus
 *     den Daten zu uebergeben. "Arnsberg" ist mehrdeutig; die Auswahl gehoert
 *     ihm, nicht dem ersten Ergebnis.
 *   - Die Bounding-Box, weil ein Waldstueck eine Flaeche ist. Nur auf den
 *     Mittelpunkt zu springen liesse offen, mit welchem Zoom -- bei einem
 *     Forstort waere das entweder zu weit weg oder mitten im Bestand.
 */
export interface PlaceResult {
  /** Anzeigename, wie Nominatim ihn liefert. */
  label: string;
  center: Coordinates;
  /**
   * Umschliessendes Rechteck [sued, nord, west, ost], falls vorhanden. Die
   * Karte zoomt darauf; ohne Box bleibt nur der Mittelpunkt.
   */
  bbox: [number, number, number, number] | null;
}

/** Nominatim liefert die Box als Strings in der Reihenfolge [S, N, W, O]. */
function parseBoundingBox(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const values = raw.map((v) => Number(v));
  return values.every((v) => Number.isFinite(v))
    ? (values as [number, number, number, number])
    : null;
}

async function requestSearch(query: string, limit: number): Promise<PlaceResult[]> {
  await respectRateLimit();
  lastRequestAt = Date.now();

  const params = new URLSearchParams({
    format: 'json',
    limit: String(limit),
    countrycodes: 'de',
    // Liefert die Bounding-Box mit -- ohne sie wuesste die Karte nicht, wie
    // weit sie aufziehen soll.
    addressdetails: '0',
    q: query,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${NOMINATIM_URL}?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      console.warn('[geocode] Ortssuche antwortete mit', response.status);
      return [];
    }

    const results = (await response.json()) as Array<{
      lat?: string;
      lon?: string;
      display_name?: string;
      boundingbox?: unknown;
    }>;

    return (results ?? []).flatMap((entry) => {
      const lat = Number(entry.lat);
      const lng = Number(entry.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      return [
        {
          label: entry.display_name?.trim() || `${lat}, ${lng}`,
          center: { lat, lng },
          bbox: parseBoundingBox(entry.boundingbox),
        },
      ];
    });
  } catch (err) {
    // Abbruch, Netzfehler, CORS -- die Suche bleibt ohne Treffer, die Karte
    // aber bedienbar. Von Hand suchen geht weiterhin.
    console.warn('[geocode] Ortssuche fehlgeschlagen fuer', query, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Orte zu einer Sucheingabe finden.
 *
 * BEWUSST OHNE CACHE, im Gegensatz zu `geocodeAddress`: Dort werden gepflegte
 * Adressen aus den Daten aufgeloest, hier tippt ein Mensch. Ein
 * zwischengespeicherter Negativtreffer wuerde einen Tippfehler dauerhaft
 * festhalten -- dieselbe Eingabe bliebe auch nach dem Korrigieren des
 * Dienstes erfolglos, und niemand kaeme darauf, warum.
 *
 * Wirft nie: keine Treffer und kein Netz sind dasselbe Ergebnis -- eine leere
 * Liste. Der Karten-Schritt darf daran nicht scheitern.
 */
export async function searchPlaces(query: string, limit = 5): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  // An dieselbe Warteschlange wie das Adress-Geocoding: Nominatim sieht nur
  // EINEN Client, und das Limit von 1 Anfrage/Sekunde gilt fuer ihn als
  // Ganzes -- nicht je Aufrufer.
  const result = queue.then(() => requestSearch(trimmed, limit));
  queue = result.catch(() => []);
  return result;
}
