/**
 * Vorlagen mit Material-IDs ausgeben.
 *
 * Die leeren PDF-Vorlagen tragen keine Ident-Felder. Wer sie herunterlaedt,
 * ausfuellt und hochlaedt, haette ein Dokument ohne Materialbezug; wer die
 * Demo-Dateien nimmt, traegt deren IDs, die im Datenraum laengst vergeben
 * sind -- die Vorab-Pruefung (uploadPreflightService) sperrt sie zu Recht.
 *
 * Darum bettet die App beim Herunterladen IDs gleich mit ein, als versteckte
 * Felder, so wie es eine ausstellende Stelle in Acrobat taete -- und zwar
 * IMMER FRISCHE: Jedes Ident-Feld (Erzeugnis, Eingang, Bezug) bekommt neue,
 * nachweislich unbenutzte IDs. In der Testumgebung ist gleichgueltig, welche
 * ID ein Stamm traegt; es zaehlt nur, dass sie gueltig ist und mit nichts
 * Vorhandenem kollidiert. Der Nutzer wird nichts gefragt.
 *
 * Eindeutig wird eine ID durch den Firmenpraefix des Teilnehmers, eine
 * zufaellige Seriennummer und die Gegenprobe am EPCIS-Repository vor der
 * Ausgabe. Eine zentrale Liste aller ausgegebenen IDs braucht es dafuer
 * nicht.
 */

import { checkProposedDocuments } from './uploadPreflightService';

// ---------------------------------------------------------------------------
// Produktarten und ihre Artikelnummern
// ---------------------------------------------------------------------------

export type IdentKind = 'saatgut' | 'stamm' | 'lamelle' | 'platte' | 'klebstoff';

/**
 * Artikelnummer je Produktart -- dieselben Werte wie in den Demo-Daten
 * (0001 Saatgut, 0100 Stamm, 0212 Lamelle, 0401 Platte, 00301 Klebstoff).
 * Sie bestimmen keine Bedeutung im Code, gruppieren aber die Kettenverfolgung
 * (supplyChainWalk, itemRefOf): je Produktart muss sie verschieden sein.
 */
const KIND_ITEM_REF: Record<IdentKind, number> = {
  saatgut: 1,
  stamm: 100,
  lamelle: 212,
  platte: 401,
  klebstoff: 301,
};

/** Losware (Saatgut, Klebstoff) traegt eine Chargen-ID, Stueckware eine Seriennummer. */
const KIND_IS_LOT: Record<IdentKind, boolean> = {
  saatgut: true,
  stamm: false,
  lamelle: false,
  platte: false,
  klebstoff: true,
};

export const KIND_LABEL: Record<IdentKind, { one: string; many: string }> = {
  saatgut: { one: 'Saatgut-Partie', many: 'Saatgut-Partien' },
  stamm: { one: 'Stamm', many: 'Stämme' },
  lamelle: { one: 'Lamelle', many: 'Lamellen' },
  platte: { one: 'BSP-Platte', many: 'BSP-Platten' },
  klebstoff: { one: 'Klebstoff-Charge', many: 'Klebstoff-Chargen' },
};

/**
 * Welche IDs eine Vorlage braucht.
 *
 *   create             neue IDs fuer das Erzeugnis (`outputKind`)
 *   sawing             Eingang waehlen (`inputKind`), Ausgang neu (`outputKind`)
 *   reference          bestehende IDs waehlen (`referenceKind`), Pflicht
 *   optional-reference bestehende ID waehlen, darf leer bleiben
 */
export interface TemplateIdentSpec {
  mode: 'create' | 'sawing' | 'reference' | 'optional-reference';
  outputKind?: IdentKind;
  inputKind?: IdentKind;
  referenceKind?: IdentKind;
  /** Mehrere IDs zulaessig (Transport: viele Staemme in einem Auftrag). */
  multiple?: boolean;
}

export const TEMPLATE_IDENT_SPECS: Record<string, TemplateIdentSpec> = {
  pdf_stammzertifikat: { mode: 'create', outputKind: 'saatgut' },
  pdf_pruefzertifikat: { mode: 'reference', referenceKind: 'saatgut' },
  pdf_transportauftrag_rundholz: { mode: 'reference', referenceKind: 'stamm', multiple: true },
  pdf_leistungserklaerung: { mode: 'sawing', inputKind: 'stamm', outputKind: 'lamelle' },
  pdf_fertigungsauftrag_saege: { mode: 'reference', referenceKind: 'lamelle', multiple: true },
  pdf_schnittbild: { mode: 'reference', referenceKind: 'lamelle' },
  pdf_biegepruefung: { mode: 'reference', referenceKind: 'lamelle' },
  pdf_transportauftrag: { mode: 'reference', referenceKind: 'lamelle', multiple: true },
  pdf_leistungserklaerung_bsp: { mode: 'optional-reference', referenceKind: 'platte' },
  pdf_klebstoffdatenblatt: { mode: 'optional-reference', referenceKind: 'klebstoff' },
};

export function identSpecFor(templateId: string): TemplateIdentSpec {
  return TEMPLATE_IDENT_SPECS[templateId] ?? { mode: 'optional-reference' };
}

/** Hoechstzahl neuer IDs je Download -- schuetzt die Gegenprobe vor Lastspitzen. */
export const MAX_NEW_IDENTS = 50;

// ---------------------------------------------------------------------------
// IDs bilden
// ---------------------------------------------------------------------------

const EPC_RE =
  /^urn:epc:(id:sgtin|class:sgtin|class:lgtin):[0-9]+\.[0-9]+\.[A-Za-z0-9_-]+$/;

export function isValidEpc(value: string): boolean {
  return EPC_RE.test(value.trim());
}

/** Mehrere IDs aus freier Eingabe (Semikolon, Komma, Leerzeichen, Zeilen). */
export function parseEpcList(text: string): { valid: string[]; invalid: string[] } {
  const parts = text.split(/[;\s,]+/).map((p) => p.trim()).filter(Boolean);
  const valid = Array.from(new Set(parts.filter(isValidEpc)));
  const invalid = parts.filter((p) => !isValidEpc(p));
  return { valid, invalid };
}

/**
 * Artikelnummer passend zum Firmenpraefix.
 *
 * GS1: Praefix + Artikelnummer ergeben zusammen 12 Stellen (13 mit der
 * Indikatorziffer, die im URN vorn an der Artikelnummer steht). Ein
 * 10-stelliger Praefix laesst also 3 Stellen, ein 9-stelliger 4.
 */
export function itemRefFor(kind: IdentKind, companyPrefix: string): string {
  const digits = 13 - companyPrefix.length;
  const value = String(KIND_ITEM_REF[kind]);
  if (digits < 1 || value.length > digits) {
    throw new Error(
      `Ihr Firmenpräfix (${companyPrefix.length} Stellen) lässt keine Artikelnummer für „${KIND_LABEL[kind].one}“ zu. ` +
        'Für Testvorlagen bitte einen Präfix mit höchstens 10 Stellen verwenden.',
    );
  }
  return value.padStart(digits, '0');
}

/** Die Produktart einer ID, sofern sie einer der bekannten Artikelnummern entspricht. */
export function kindOfEpc(epc: string): IdentKind | null {
  const match = /^urn:epc:(?:id|class):(?:sgtin|lgtin):[0-9]+\.([0-9]+)\./.exec(epc);
  if (!match) return null;
  const ref = Number.parseInt(match[1], 10);
  const hit = (Object.keys(KIND_ITEM_REF) as IdentKind[]).find((k) => KIND_ITEM_REF[k] === ref);
  return hit ?? null;
}

const SERIAL_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Seriennummer: "T" + Datum + 6 Zufallszeichen, z.B. T261105K3F9QX.
 *
 * Das "T" kennzeichnet die ID als aus der App ausgegeben (Testvorlage), das
 * Datum macht sie lesbar sortierbar, der Zufallsteil eindeutig: 34^6 ≈ 1,5
 * Milliarden Moeglichkeiten je Tag, Praefix und Produktart. Ohne I und O,
 * damit niemand beim Abtippen 1 und 0 verwechselt.
 */
export function newSerial(now: Date = new Date(), random: () => number = cryptoRandom): string {
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  let tail = '';
  for (let i = 0; i < 6; i++) {
    tail += SERIAL_ALPHABET[Math.floor(random() * SERIAL_ALPHABET.length)];
  }
  return `T${yy}${mm}${dd}${tail}`;
}

function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

export function buildEpc(kind: IdentKind, companyPrefix: string, serial: string): string {
  const itemRef = itemRefFor(kind, companyPrefix);
  return KIND_IS_LOT[kind]
    ? `urn:epc:class:lgtin:${companyPrefix}.${itemRef}.${serial}`
    : `urn:epc:id:sgtin:${companyPrefix}.${itemRef}.${serial}`;
}

type TakenCheck = (epcs: string[]) => Promise<Set<string>>;

/** Gegenprobe am EPCIS-Repository: welche dieser IDs sind schon vergeben? */
const checkTaken: TakenCheck = async (epcs) => {
  const { verdicts } = await checkProposedDocuments([
    {
      label: 'Neue Material-IDs',
      fileName: '',
      eventType: 'ObjectEvent',
      outputEpcs: epcs,
      inputEpcs: [],
    },
  ]);
  return new Set(verdicts.flatMap((v) => v.takenEpcs));
};

/**
 * Neue, freie IDs ausgeben.
 *
 * Kollidiert eine zufaellige ID doch mit einer vergebenen, wird nur sie neu
 * gezogen. Nach drei Runden ist etwas grundsaetzlich falsch (z.B. eine
 * kaputte Zufallsquelle) -- dann lieber abbrechen als eine vergebene ID
 * ausliefern.
 *
 * Ist das Repository fuer die Gegenprobe NICHT ERREICHBAR, wird NICHTS
 * ausgegeben (Entscheidung 05.11.2026): Schon die heruntergeladene Vorlage
 * soll nur nachweislich freie IDs tragen. Der Fehler des EPCIS-Dienstes ist
 * bereits Klartext ("Verzeichnis ... gerade nicht erreichbar") und wird
 * unveraendert an den Nutzer weitergereicht.
 */
export async function issueNewEpcs(
  kind: IdentKind,
  count: number,
  companyPrefix: string,
  deps: { taken?: TakenCheck; serial?: () => string } = {},
): Promise<string[]> {
  if (count < 1 || count > MAX_NEW_IDENTS) {
    throw new Error(`Anzahl neuer IDs muss zwischen 1 und ${MAX_NEW_IDENTS} liegen.`);
  }
  const taken = deps.taken ?? checkTaken;
  const serial = deps.serial ?? (() => newSerial());

  const fresh = () => {
    const out = new Set<string>();
    while (out.size < count) out.add(buildEpc(kind, companyPrefix, serial()));
    return out;
  };

  let current = fresh();
  for (let round = 0; round < 3; round++) {
    const collisions = await taken([...current]);
    if (collisions.size === 0) return [...current];
    for (const epc of collisions) current.delete(epc);
    while (current.size < count) current.add(buildEpc(kind, companyPrefix, serial()));
  }
  throw new Error('Es konnten keine freien Material-IDs erzeugt werden. Bitte erneut versuchen.');
}

// ---------------------------------------------------------------------------
// Vorlage mit eingebetteten IDs holen
// ---------------------------------------------------------------------------

/**
 * Feldbelegung fuer den Konverter.
 *
 * Saegevorgang: EIN nummeriertes Paar Identity_1 / IdentityInput_1 -- das
 * Format, das pdfIdentityService.extractSawings beim Upload liest und aus
 * dem der sawdecl-Treiber ein TransformationEvent baut. Beide Seiten sind
 * Pflicht: ohne Eingang verwirft der Upload das Paar. Sonst ein einzelnes
 * Identity-Feld (Erzeugnis bzw. Bezug).
 */
export function prefillFields(
  spec: TemplateIdentSpec,
  outputEpcs: string[],
  inputEpcs: string[],
): Record<string, string[]> {
  if (spec.mode === 'sawing') return { Identity_1: outputEpcs, IdentityInput_1: inputEpcs };
  if (spec.mode === 'create') return { Identity: outputEpcs };
  return inputEpcs.length ? { Identity: inputEpcs } : {};
}

const converterUrl = () =>
  typeof window !== 'undefined' ? `${window.location.origin}/api/converter` : '/api/converter';

export async function fetchPrefilledTemplate(
  templateId: string,
  fields: Record<string, string[]>,
): Promise<Blob> {
  const response = await fetch(`${converterUrl()}/pdf-templates/${templateId}/prefilled`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((b) => b.detail)
      .catch(() => null);
    throw new Error(detail || `Vorlage konnte nicht erzeugt werden (${response.status})`);
  }
  return response.blob();
}

/** Datei im Browser speichern. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Belegung: immer frische IDs, keine Fragen an den Nutzer
// ---------------------------------------------------------------------------

/** Wie viele IDs ein Feld bekommt. */
const FRESH_COUNT = { single: 1, multiple: 5, lamellen: 7, staemme: 3 } as const;

/** Belegung EINES Ident-Feldes. */
export interface SlotPlan {
  kind: IdentKind;
  count: number;
}

export interface TemplateIdentPlan {
  /** Erzeugnis (Stammzertifikat, Lamellen der Leistungserklaerung). */
  output: SlotPlan | null;
  /** Eingang (Saegevorgang) bzw. Bezug (Beidokumente). */
  input: SlotPlan | null;
}

/**
 * Jedes Ident-Feld einer Vorlage mit frischen IDs belegen.
 *
 * Auch der Bezug eines Beidokuments (Transportauftrag, Pruefung) und der
 * Eingang eines Saegevorgangs bekommen neue IDs: In der Testumgebung muss
 * das Dokument nur gueltig und kollisionsfrei sein, nicht an vorhandenes
 * Material anschliessen.
 */
export function planTemplateIdents(templateId: string): TemplateIdentPlan {
  const spec = identSpecFor(templateId);
  const output: SlotPlan | null =
    (spec.mode === 'create' || spec.mode === 'sawing') && spec.outputKind
      ? {
          kind: spec.outputKind,
          count: spec.mode === 'sawing' ? FRESH_COUNT.lamellen : FRESH_COUNT.single,
        }
      : null;

  const inputKind = spec.mode === 'sawing' ? spec.inputKind : spec.referenceKind;
  if (!inputKind || spec.mode === 'create') return { output, input: null };

  const count =
    spec.mode === 'sawing'
      ? FRESH_COUNT.staemme
      : spec.multiple
        ? FRESH_COUNT.multiple
        : FRESH_COUNT.single;
  return { output, input: { kind: inputKind, count } };
}

export function countLabel(kind: IdentKind, n: number): string {
  return `${n} ${n === 1 ? KIND_LABEL[kind].one : KIND_LABEL[kind].many}`;
}
