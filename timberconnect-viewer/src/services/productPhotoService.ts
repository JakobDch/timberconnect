/**
 * Eigene Produktfotos -- aufgenommen oder hochgeladen beim Registrieren eines
 * Vorgangs, verknuepft mit dem Ident (EPC) des erzeugten Materials.
 *
 * Die App zeigt zu jedem Produkt ein Bild. Ohne eigenes Foto ist das ein
 * generisches Standardbild je Produktart (siehe productImageService); mit
 * dieser Datei kann der Uploader stattdessen das TATSAECHLICHE Stueck zeigen --
 * die konkrete Platte, den konkreten Stamm.
 *
 * Ablage: im selben WAC-geschuetzten Container wie die uebrigen Dateien des
 * Vorgangs (``data/<traceId>/``), unter einem festen Namen. Damit gilt fuer das
 * Foto automatisch dieselbe Zugriffskontrolle wie fuer die Belege -- wer den
 * Vorgang nicht sehen darf, sieht auch das Bild nicht.
 *
 * Die Zuordnung Foto -> Ident steht in einer kleinen JSON-Datei neben dem Bild
 * (``product-photos.json``). Bewusst NICHT im RDF-Graph: das Foto ist kein
 * Merkmal der Informationsbedarfstiefe, und die Mappings sind aus den
 * Quellformaten generiert -- ein Bildverweis haette dort keine Entsprechung.
 */

import { podBaseFromWebId } from './accessControlService';

/** Dateiname des Fotos im Vorgangs-Container. */
const PHOTO_FILE = 'produktfoto.jpg';

/** Zuordnungsdatei Ident -> Foto, liegt neben dem Bild. */
const INDEX_FILE = 'product-photos.json';

/**
 * Beide Dateien gehoeren NICHT in die Dokumentenlisten der Anwendungsfaelle.
 *
 * Dort stehen Belege -- Leistungserklaerung, Zertifikate, Datenblaetter --,
 * die der Rueckbauer oder Pruefer herunterlaedt. Das Produktfoto ist
 * Bebilderung der Oberflaeche: es taucht ohnehin sichtbar in der Ansicht auf,
 * und als "Dokument" gelistet wuerde es die Belegliste verwaessern und waere
 * ueber die Token-Schranke sogar bepreisbar.
 */
export function isProductPhotoFile(url: string): boolean {
  const name = url.slice(url.lastIndexOf('/') + 1).toLowerCase();
  return name === PHOTO_FILE || name === INDEX_FILE;
}

/** Groesse, auf die ein aufgenommenes Bild vor dem Upload gebracht wird. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export interface ProductPhotoIndex {
  /** EPC (SGTIN/LGTIN) -> absolute URL des Fotos. */
  [epc: string]: string;
}

// ---------------------------------------------------------------------------
// Aufnahme vorbereiten
// ---------------------------------------------------------------------------

/**
 * Ein Kamerabild oder eine gewaehlte Datei auf Web-Groesse bringen.
 *
 * Handykameras liefern 4-12 MB pro Aufnahme. Ungeschrumpft wandert das in den
 * Pod und muss bei jeder Anzeige neu geladen werden -- deshalb wird hier
 * einmalig verkleinert und als JPEG kodiert. Laesst sich das Bild nicht
 * dekodieren (exotisches Format), wird die Originaldatei durchgereicht,
 * statt den Upload scheitern zu lassen.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);

    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

// ---------------------------------------------------------------------------
// Ablegen
// ---------------------------------------------------------------------------

/**
 * Foto in den Vorgangs-Container legen und mit den Identen verknuepfen.
 *
 * Wird NACH dem Datei-Upload aufgerufen: erst dann steht der traceId fest, und
 * der Container samt ACL existiert bereits. Die Idente stammen aus der
 * Pflichtdatei desselben Vorgangs.
 *
 * Schlaegt das Ablegen fehl, wird der Fehler nach oben gereicht, aber der
 * Vorgang selbst bleibt gueltig -- das Foto ist Beiwerk, kein Beleg.
 */
export async function uploadProductPhoto(
  authenticatedFetch: typeof fetch,
  photo: Blob,
  traceId: string,
  epcs: string[],
  ownerWebId: string,
): Promise<string> {
  const podBase = podBaseFromWebId(ownerWebId);
  const folder = `${podBase}data/${traceId}/`;
  const photoUrl = `${folder}${PHOTO_FILE}`;

  const response = await authenticatedFetch(photoUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: photo,
  });
  if (!response.ok) {
    throw new Error(`Foto konnte nicht abgelegt werden (${response.status})`);
  }

  // Zuordnung schreiben -- ohne sie fehlt dem Betrachter der Weg vom
  // gescannten Ident zum Bild.
  const index: ProductPhotoIndex = {};
  for (const epc of epcs) {
    if (epc) index[epc] = photoUrl;
  }

  if (Object.keys(index).length > 0) {
    await authenticatedFetch(`${folder}${INDEX_FILE}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(index, null, 2),
    }).catch(() => {
      // Die Zuordnung ist eine Bequemlichkeit: das Bild liegt auch ohne sie
      // im Container und wird ueber den Containerpfad noch gefunden.
    });
  }

  return photoUrl;
}

// ---------------------------------------------------------------------------
// Wiederfinden
// ---------------------------------------------------------------------------

/**
 * Foto zu einem Produkt suchen.
 *
 * Zwei Wege, in dieser Reihenfolge:
 *   1. ueber die Container der geladenen Quellen -- dort liegt das Bild, wenn
 *      der Vorgang es mitgebracht hat. Das ist der Normalfall und braucht nur
 *      eine HEAD-Anfrage je Container.
 *   2. ueber die Zuordnungsdatei, falls das Bild einem anderen Ident als dem
 *      Containernamen zugeordnet wurde.
 *
 * Gibt ``null`` zurueck, wenn nichts gefunden wird -- dann greift das
 * Standardbild der Produktart. Fehler werden geschluckt: ein fehlendes Foto
 * darf die Produktansicht nie blockieren.
 */
export async function findProductPhoto(
  fetchImpl: typeof fetch,
  sourceUrls: string[],
  epc?: string | null,
): Promise<string | null> {
  const containers = Array.from(
    new Set(sourceUrls.map((url) => url.slice(0, url.lastIndexOf('/') + 1))),
  ).filter(Boolean);

  for (const container of containers) {
    const candidate = `${container}${PHOTO_FILE}`;
    try {
      const response = await fetchImpl(candidate, { method: 'HEAD' });
      if (response.ok) return candidate;
    } catch {
      // Container nicht erreichbar oder kein Zugriff -- naechster Versuch.
    }
  }

  if (!epc) return null;

  for (const container of containers) {
    try {
      const response = await fetchImpl(`${container}${INDEX_FILE}`);
      if (!response.ok) continue;
      const index = (await response.json()) as ProductPhotoIndex;
      const hit = index[epc];
      if (hit) return hit;
    } catch {
      // Keine oder unlesbare Zuordnungsdatei -- kein Grund zur Sorge.
    }
  }

  return null;
}
