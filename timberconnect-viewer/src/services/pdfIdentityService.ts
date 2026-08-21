/**
 * PDF-Formular-Extraktion (Ident + Nutzdaten)
 *
 * Der Nutzer laedt die AUSGEFUELLTE Template-PDF hoch. Alles, was der
 * Konverter braucht, steht damit bereits in der Datei — sowohl die fachlichen
 * Werte (AcroForm-Felder der Vorlage) als auch der eingebettete GS1-Ident.
 *
 * Ausstellende Stellen betten den GS1-Ident des Materials als verstecktes
 * AcroForm-Feld ein (Feldname "Identity", Sichtbarkeit=Hidden,
 * Schreibgeschuetzt=Ja). Der Wert ist damit nicht sichtbar, bleibt aber
 * Bestandteil des AcroForms und ist maschinell lesbar:
 *
 *     /T (Identity)  /FT /Tx  /Ff 1 (ReadOnly)  /F 6 (Hidden|Print)
 *     /V (urn:epc:id:sgtin:4047111124.015.0013249)
 *
 * `extractPdfFormValues` liest daneben ALLE ausgefuellten Felder aus; das ist
 * das Gegenstueck zu `pdf_fields_to_form_data` im Converter-Backend. Beides
 * geschieht in einem Durchgang ueber dieselbe geladene PDF, damit ein
 * mehrere Megabyte grosses Dokument nicht zweimal geparst wird.
 *
 * Fehlschlaege sind hier nie fatal: ein PDF ohne Ident (oder ohne AcroForm)
 * ist der Normalfall und fuehrt lediglich dazu, dass der Nutzer den
 * Materialbezug von Hand waehlt bzw. dass keine Werte uebernommen werden.
 */

import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * Feldnamen, unter denen ein eingebetteter Ident erwartet wird — in dieser
 * Reihenfolge. "Identity" ist die mit den ausstellenden Stellen vereinbarte
 * Schreibweise; die uebrigen fangen naheliegende Varianten ab, damit ein
 * abweichend benanntes Feld nicht stillschweigend verloren geht.
 */
const IDENT_FIELD_NAMES = [
  'Identity',
  'identity',
  'Ident',
  'EPC',
  'epc',
  'TimberConnectIdent',
];

/**
 * Feldnamen des VORMATERIAL-Idents: woraus das beschriebene Material
 * entstanden ist.
 *
 * Zusammen mit dem Ident oben ergibt das ein vollstaendiges
 * EPCIS-TransformationEvent (Input -> Output). Ohne den Input bleibt jede
 * Verarbeitungsstufe eine Insel: die Idente existieren, aber nichts verbindet
 * Faellvorgang, Polter und Schnittholz miteinander.
 */
const INPUT_FIELD_NAMES = [
  'IdentityInput',
  'identityInput',
  'IdentInput',
  'InputEPC',
  'TimberConnectIdentInput',
];

/**
 * Gueltiger GS1-EPC als URN. Identisch zum Muster im MaterialRefPicker und im
 * Backend (`_EPC_URN_RE` in pdf_template_service.py) — ein Ident, den das
 * Backend spaeter ablehnt, darf hier gar nicht erst als gefunden gelten.
 */
const EPC_URN_RE =
  /^urn:epc:(id:sgtin|class:sgtin|class:lgtin):[0-9]+\.[0-9]+\.[A-Za-z0-9_-]+$/;

/**
 * Trennzeichen fuer mehrere EPCs in EINEM AcroForm-Feld. Ein Saegevorgang
 * verarbeitet ein oder mehrere Rundhoelzer zu vielen Lamellen; ein Textfeld
 * kann das nur als Liste tragen.
 */
const EPC_SEPARATOR = /[;\s,]+/;

/** Alle gueltigen EPCs aus einem moeglicherweise mehrwertigen Feldwert. */
function epcList(values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const part of value.split(EPC_SEPARATOR)) {
      const trimmed = part.trim();
      if (EPC_URN_RE.test(trimmed) && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

/**
 * Ein Saegevorgang: aus einem oder mehreren Rundhoelzern entstehen mehrere
 * Schnittholzlamellen. Format nach Absprache mit dem EECC (08/2026) — jeder
 * Vorgang wird dort zu genau einem EPCIS-TransformationEvent.
 */
export interface PdfSawing {
  /** Verarbeitete Rundhoelzer (inputEPCList). */
  materialInputEpc: string[];
  /** Entstandene Lamellen (outputEPCList). */
  materialEpc: string[];
}

export interface PdfIdentity {
  /** Der gefundene GS1-EPC als URN. */
  epc: string;
  /** AcroForm-Feldname, aus dem der Wert stammt (fuer die Anzeige). */
  fieldName: string;
  /**
   * Ident des eingesetzten Vormaterials, falls das PDF ihn mitbringt
   * (Feld "IdentityInput"). Zusammen mit `epc` beschreibt er eine Umwandlung:
   * aus diesem Material ist jenes entstanden.
   */
  inputEpc?: string;
  /** AcroForm-Feldname des Vormaterial-Idents. */
  inputFieldName?: string;
  /**
   * Saegevorgaenge, falls das PDF sie mitbringt (Felder "IdentityInput_<n>"
   * und "Identity_<n>"). Bei Dokumenten mit Saegevorgaengen stehen die Idente
   * ausschliesslich hier — nicht zusaetzlich in `epc`.
   */
  sawings?: PdfSawing[];
}

/** Ausgefuellte AcroForm-Werte: {vollqualifizierter Feldname: Wert}. */
export type PdfFormValues = Record<string, unknown>;

/** Was aus einer hochgeladenen, ausgefuellten Template-PDF gelesen wurde. */
export interface PdfFormExtract {
  /** Eingebetteter GS1-Ident, falls vorhanden. */
  identity: PdfIdentity | null;
  /** Alle ausgefuellten Formularfelder. */
  fields: PdfFormValues;
  /** Anzahl ausgefuellter Felder — Grundlage der Rueckmeldung an den Nutzer. */
  fieldCount: number;
}

/**
 * Liest die Saegevorgaenge aus nummerierten Feldpaaren:
 *
 *     Identity_1      -> Lamellen des ersten Vorgangs   (mehrwertig)
 *     IdentityInput_1 -> Rundhoelzer des ersten Vorgangs (mehrwertig)
 *     Identity_2 / IdentityInput_2 -> zweiter Vorgang
 *     ...
 *
 * Mehrere EPCs in einem Feld werden durch Semikolon, Komma oder Leerraum
 * getrennt — ein AcroForm-Textfeld kann keine echte Liste tragen.
 *
 * Ein Vorgang ohne Input ODER ohne Output wird verworfen: daraus laesst sich
 * kein TransformationEvent bilden, und ein halber Vorgang wuerde eine
 * Verknuepfung vorspiegeln, die es nicht gibt.
 */
function extractSawings(
  fieldObjects: Record<string, unknown>,
  values: (entry: unknown) => unknown[],
): PdfSawing[] {
  const byIndex = new Map<number, PdfSawing>();
  const pattern = /^(Identity|IdentityInput)[_-]?(\d+)$/i;

  for (const [name, entry] of Object.entries(fieldObjects)) {
    const match = pattern.exec(name);
    if (!match) continue;
    const isInput = match[1].toLowerCase() === 'identityinput';
    const index = Number(match[2]);
    const found = epcList(values(entry));
    if (found.length === 0) continue;

    const sawing = byIndex.get(index) ?? { materialInputEpc: [], materialEpc: [] };
    if (isInput) sawing.materialInputEpc.push(...found);
    else sawing.materialEpc.push(...found);
    byIndex.set(index, sawing);
  }

  return Array.from(byIndex.entries())
    .sort(([a], [b]) => a - b)
    .map(([, sawing]) => sawing)
    .filter((s) => s.materialInputEpc.length > 0 && s.materialEpc.length > 0);
}

/** Kandidatenwerte eines pdfjs-Feldobjekts, robust gegen dessen Formvarianten. */
function candidateValues(entry: unknown): unknown[] {
  const objects = Array.isArray(entry) ? entry : [entry];
  const values: unknown[] = [];
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    const record = obj as Record<string, unknown>;
    // "value" ist der aktuelle, "defaultValue" der in den Feld-Optionen
    // hinterlegte Standardwert. Die Anleitung an die ausstellenden Stellen
    // nennt den Standardwert — beide muessen also gelesen werden.
    values.push(record.value, record.defaultValue);
  }
  return values;
}

/** Erster Wert, der ein gueltiger EPC ist. */
function firstEpc(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (EPC_URN_RE.test(trimmed)) return trimmed;
  }
  return null;
}

/**
 * Bestimmt den Ident aus bereits gelesenen AcroForm-Feldobjekten.
 *
 * Sucht zuerst die vereinbarten Feldnamen ab und faellt danach auf eine Suche
 * ueber alle Felder zurueck — ein Ident im richtigen Format ist auch dann
 * eindeutig als solcher erkennbar, wenn das Feld anders heisst.
 */
function identityFromFields(
  fieldObjects: Record<string, unknown>,
): PdfIdentity | null {
  // Saegevorgaenge zuerst: liegen nummerierte Feldpaare vor, beschreibt das
  // Dokument eine n:m-Umwandlung und traegt keinen EINEN Ident. Die
  // nummerierten Felder duerfen dann auch nicht in den Rueckfall unten
  // geraten — sonst wuerde eine beliebige Lamelle zum Dokument-Ident.
  const sawings = extractSawings(fieldObjects, candidateValues);
  if (sawings.length > 0) {
    // `epc` bleibt der erste Output, damit bestehende Anzeige-Pfade im
    // Viewer (Vorauswahl, Hinweistext) einen Wert haben. Massgeblich fuer
    // die Datenuebernahme ist `sawings`.
    return {
      epc: sawings[0].materialEpc[0],
      fieldName: 'Identity_1',
      sawings,
    };
  }

  // Vormaterial bestimmen: sein Feldname muss beim Rueckfall unten
  // ausgeschlossen werden, sonst wuerde der Input-Ident faelschlich als
  // Ident des Dokuments gelesen — und das Dokument haenge im Graph am
  // falschen Material.
  let inputEpc: string | undefined;
  let inputFieldName: string | undefined;
  for (const name of INPUT_FIELD_NAMES) {
    if (!(name in fieldObjects)) continue;
    const found = firstEpc(candidateValues(fieldObjects[name]));
    if (found) {
      inputEpc = found;
      inputFieldName = name;
      break;
    }
  }
  const input = inputEpc ? { inputEpc, inputFieldName } : {};

  for (const name of IDENT_FIELD_NAMES) {
    if (!(name in fieldObjects)) continue;
    const epc = firstEpc(candidateValues(fieldObjects[name]));
    if (epc) return { epc, fieldName: name, ...input };
  }

  // Rueckfall: irgendein Feld, dessen Wert wie ein GS1-EPC aussieht --
  // ausser dem bereits als Vormaterial erkannten.
  for (const [name, entry] of Object.entries(fieldObjects)) {
    if (name === inputFieldName) continue;
    const epc = firstEpc(candidateValues(entry));
    if (epc) return { epc, fieldName: name, ...input };
  }

  return null;
}

/**
 * Ist ein Feldwert als "ausgefuellt" zu werten?
 *
 * Leere Felder duerfen nicht als Datenpunkt gelten: eine leere Zeichenkette
 * wuerde im Graph als ausdrueckliche Aussage "dieser Wert ist leer" landen und
 * beim Preis mitgezaehlt. Nicht angekreuzte Checkboxen ("Off") und die
 * Platzhalter der Dropdowns sind derselbe Fall.
 */
function isFilledValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim();
  if (text === '' || text === 'Off') return false;
  if (/^--.*--$/.test(text)) return false;
  return true;
}

/**
 * Alle ausgefuellten AcroForm-Werte als {vollqualifizierter Feldname: Wert}.
 *
 * Gegenstueck zu `pdf_fields_to_form_data` im Converter-Backend, das diese
 * Feldnamen ueber die Template-Registry auf die Registry-Keys abbildet.
 */
function formValuesFromFields(
  fieldObjects: Record<string, unknown>,
): PdfFormValues {
  const values: PdfFormValues = {};
  for (const [name, entry] of Object.entries(fieldObjects)) {
    for (const candidate of candidateValues(entry)) {
      if (isFilledValue(candidate)) {
        values[name] = candidate;
        break;
      }
    }
  }
  return values;
}

/**
 * Liest Ident UND Formularwerte aus einem hochgeladenen PDF — in einem
 * einzigen Parse-Durchgang, weil beides aus demselben AcroForm stammt.
 *
 * @returns immer ein Ergebnis; bei nicht lesbarem PDF bzw. fehlendem AcroForm
 *          sind `identity` null und `fields` leer. Wirft nie.
 */
export async function extractPdfForm(
  buffer: ArrayBuffer,
): Promise<PdfFormExtract> {
  const empty: PdfFormExtract = { identity: null, fields: {}, fieldCount: 0 };

  // pdfjs uebernimmt den Puffer (transferiert ihn); der Aufrufer braucht ihn
  // aber noch fuer Hash und Pod-Upload, daher auf einer Kopie arbeiten.
  const task = pdfjsLib.getDocument({ data: buffer.slice(0) });
  try {
    const doc = await task.promise;

    const fieldObjects = (await doc.getFieldObjects()) as Record<
      string,
      unknown
    > | null;
    if (!fieldObjects) return empty;

    const fields = formValuesFromFields(fieldObjects);
    return {
      identity: identityFromFields(fieldObjects),
      fields,
      fieldCount: Object.keys(fields).length,
    };
  } catch (err) {
    console.warn('[pdf-identity] PDF-Formular konnte nicht gelesen werden:', err);
    return empty;
  } finally {
    // Der Worker-Task haelt sonst den Puffer und die Schrift-Caches.
    void task.destroy().catch(() => undefined);
  }
}

/**
 * Nur den eingebetteten Ident lesen.
 *
 * @returns den gefundenen Ident oder null (kein Ident / kein AcroForm /
 *          nicht lesbares PDF). Wirft nie.
 */
export async function extractPdfIdentity(
  buffer: ArrayBuffer,
): Promise<PdfIdentity | null> {
  return (await extractPdfForm(buffer)).identity;
}
