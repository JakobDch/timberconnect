/**
 * Schadensmeldung zum Anwendungsfall "Nachweis der Haftung".
 *
 * Die Handskizze zum Anwendungsfall zeigt den eigentlichen Ablauf: ein
 * Schadensfall tritt ein, die Versicherungsgutachterin gleicht die
 * dokumentierten Daten mit dem IST-Zustand vor Ort ab. Diese Datei setzt die
 * ERFASSUNG dieses IST-Zustands um; das Gutachten selbst bleibt ein Dokument
 * im Downloadbereich.
 *
 * BEWUSSTE ABWEICHUNG vom sonstigen Weg: Seit dem Umbau auf vorausgefuellte
 * PDF-Vorlagen (10.08.2026) wird in dieser App nichts mehr abgetippt -- Werte
 * kommen aus dem AcroForm der hochgeladenen Vorlage, nicht aus Eingabefeldern
 * (siehe Kopf von pdfDocumentService.ts). Eine Schadensmeldung hat aber keine
 * Vorlage: sie entsteht unangekuendigt am Bauteil vor Ort, oft am Handy. Ein
 * Formular ist hier deshalb die richtige Wahl und kein Rueckfall in die alte
 * Erfassungslogik. Sobald es eine Schadensmeldungs-Vorlage als PDF gibt,
 * sollte dieser Pfad durch den Vorlagen-Upload ersetzt werden.
 *
 * Gespeichert wird im EIGENEN Pod des Melders -- nur dort hat er das
 * Control-Recht, das zum Setzen der ACL noetig ist (dieselbe Begruendung wie
 * in uploadService.ts). Der Bezug zum betroffenen Bauteil laeuft ueber tc:epc,
 * dieselbe Ober-Property, an der auch alle Dokumentquellen haengen; damit
 * findet die Abfrage des Anwendungsfalls die Meldung ohne Sonderfall wieder.
 */

import {
  stampContainerAcl,
  getAllowedRoles,
  podBaseFromUrl,
  podBaseFromWebId,
  writeEpcisConsent,
} from './accessControlService';

/** Schadensarten -- die im Interview genannten Faelle, "Sonstiges" als Auffang. */
export const DAMAGE_KINDS = [
  'Feuchte / Schimmel',
  'Riss / Bruch',
  'Delaminierung',
  'Oberflächenschaden',
  'Sonstiges',
] as const;

export type DamageKind = (typeof DAMAGE_KINDS)[number];

/** Die Eingaben des Formulars, bevor sie geprueft sind. */
export interface DamageReportDraft {
  /** EPC des betroffenen Bauteils -- der Bezugspunkt der Meldung. */
  epc: string;
  /** Schadensdatum als ISO-Datum (yyyy-mm-dd), wie vom date-Input geliefert. */
  date: string;
  kind: DamageKind | '';
  description: string;
  reportedBy: string;
  /** Gemessene Holzfeuchte in Prozent -- optional, aber der wertvollste Wert. */
  moisture: string;
}

export interface DamageReportValidation {
  ok: boolean;
  error: string | null;
  hint: string | null;
}

export interface DamageReportRecord {
  id: string;
  epc: string;
  date: string;
  kind: string;
  description: string;
  reportedBy: string;
  moisture: string | null;
  createdAt: string;
  containerUrl: string;
  ownerWebId: string;
}

/** Leerer Entwurf -- Datum auf heute, das ist in fast allen Faellen richtig. */
export function emptyDamageDraft(epc: string, now: Date = new Date()): DamageReportDraft {
  return {
    epc,
    date: now.toISOString().slice(0, 10),
    kind: '',
    description: '',
    reportedBy: '',
    moisture: '',
  };
}

/** Schadens-ID: SD-<yyyy>-<mmdd>-<4 zufaellige Hex>, analog zur Vorgangs-ID. */
export function generateDamageReportId(now: Date = new Date()): string {
  const year = now.getFullYear();
  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `SD-${year}-${mmdd}-${suffix}`;
}

/**
 * Pruefung des Entwurfs -- Muster von validateProcessDraft: ein Ergebnis mit
 * blockierendem ``error`` UND nicht-blockierendem ``hint``.
 *
 * Die Holzfeuchte ist bewusst optional, aber wenn sie angegeben ist, muss sie
 * plausibel sein. Ein Tippfehler an dieser Stelle waere teuer: die Feuchte ist
 * der Wert, an dem sich die Schuldfrage bei Wasserschaeden entscheidet.
 */
export function validateDamageReport(draft: DamageReportDraft): DamageReportValidation {
  if (!draft.epc.trim()) {
    return { ok: false, error: 'Kein Bauteil ausgewählt.', hint: null };
  }
  if (!draft.date.trim()) {
    return { ok: false, error: 'Bitte das Schadensdatum angeben.', hint: null };
  }
  if (Number.isNaN(new Date(draft.date).getTime())) {
    return { ok: false, error: 'Das Schadensdatum ist kein gültiges Datum.', hint: null };
  }
  if (new Date(draft.date) > new Date()) {
    return {
      ok: false,
      error: 'Das Schadensdatum liegt in der Zukunft.',
      hint: null,
    };
  }
  if (!draft.kind) {
    return { ok: false, error: 'Bitte die Schadensart auswählen.', hint: null };
  }
  if (draft.description.trim().length < 10) {
    return {
      ok: false,
      error:
        'Bitte den Schaden kurz beschreiben (mindestens 10 Zeichen) — die Beschreibung ist der Kern der Meldung.',
      hint: null,
    };
  }
  if (!draft.reportedBy.trim()) {
    return { ok: false, error: 'Bitte angeben, wer den Schaden meldet.', hint: null };
  }

  if (draft.moisture.trim()) {
    const value = Number(draft.moisture.replace(',', '.'));
    if (!Number.isFinite(value)) {
      return { ok: false, error: 'Die Holzfeuchte muss eine Zahl sein.', hint: null };
    }
    if (value < 0 || value > 100) {
      return {
        ok: false,
        error: 'Die Holzfeuchte muss zwischen 0 und 100 % liegen.',
        hint: null,
      };
    }
    if (value > 20) {
      return {
        ok: true,
        error: null,
        hint: 'Über 20 % Holzfeuchte gilt Brettsperrholz als durchfeuchtet — dieser Wert stützt einen Feuchteschaden.',
      };
    }
    return { ok: true, error: null, hint: null };
  }

  return {
    ok: true,
    error: null,
    hint: 'Ohne gemessene Holzfeuchte bleibt der IST-Zustand unbelegt — falls ein Messgerät zur Hand ist, lohnt sich der Wert.',
  };
}

// ---------------------------------------------------------------------------
// Lokaler Index -- der Pod ist die Wahrheit
// ---------------------------------------------------------------------------

const DAMAGE_KEY = 'tc.damageReports';

function readReports(): DamageReportRecord[] {
  try {
    const raw = localStorage.getItem(DAMAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DamageReportRecord[]) : [];
  } catch {
    return [];
  }
}

function writeReports(list: DamageReportRecord[]): void {
  try {
    localStorage.setItem(DAMAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage nicht verfuegbar -> Index entfaellt, Pod-Daten bleiben
  }
}

/** Meldungen zu einem Bauteil, neueste zuerst. */
export function getDamageReports(epc?: string): DamageReportRecord[] {
  return readReports()
    .filter((entry) => !epc || entry.epc === epc)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Schreiben in den Pod
// ---------------------------------------------------------------------------

// Muss der Namespace der v6-Ontologie sein -- mit einem anderen waeren die
// Tripel fuer Abfragen gegen das tc:-Vokabular unsichtbar (siehe die
// gleichlautende Warnung in processService.ts).
const TC = 'http://timberconnect.2050.de/ontology#';

/** report.ttl -- die Meldung als RDF. */
export function buildDamageReportTtl(record: DamageReportRecord): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const lines = [
    `@prefix tc: <${TC}> .`,
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
    '',
    `<${record.containerUrl}report.ttl#meldung> a tc:DamageReport ;`,
    `    tc:damageReportId "${esc(record.id)}" ;`,
    `    tc:epc <${record.epc}> ;`,
    `    tc:damageDate "${record.date}"^^xsd:date ;`,
    `    tc:damageKind "${esc(record.kind)}" ;`,
    `    tc:description "${esc(record.description)}" ;`,
    `    tc:reportedBy "${esc(record.reportedBy)}" ;`,
    `    tc:created "${record.createdAt}"^^xsd:dateTime ;`,
    `    tc:owner <${record.ownerWebId}> ;`,
  ];
  if (record.moisture) {
    lines.push(`    tc:moistureMeasured "${esc(record.moisture)}"^^xsd:decimal ;`);
  }
  lines[lines.length - 1] = lines[lines.length - 1].replace(/ ;$/, ' .');
  return lines.join('\n') + '\n';
}

async function putTurtle(
  authenticatedFetch: typeof fetch,
  url: string,
  content: string,
): Promise<void> {
  const response = await authenticatedFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle' },
    body: new Blob([content], { type: 'text/turtle' }),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentifizierung fehlgeschlagen — bitte erneut anmelden.');
    }
    if (response.status === 403) {
      throw new Error(`Keine Berechtigung zum Speichern unter ${url}`);
    }
    throw new Error(`Speichern fehlgeschlagen (${response.status}): ${url}`);
  }
}

/**
 * Schadensmeldung anlegen: Container im eigenen Pod, report.ttl schreiben,
 * ACL setzen, lokal indizieren.
 *
 * Die ACL-Sequenz ist dieselbe wie bei Upload und Vorgang
 * (getAllowedRoles -> stampContainerAcl -> writeEpcisConsent). Schlaegt sie
 * fehl, bleibt die Meldung trotzdem bestehen: eine gespeicherte Meldung ohne
 * Freigabe ist deutlich besser als eine verlorene Meldung -- der Schaden ist
 * schon eingetreten, die Freigabe laesst sich nachziehen.
 */
export async function createDamageReport(
  draft: DamageReportDraft,
  ownerWebId: string,
  authenticatedFetch: typeof fetch,
): Promise<DamageReportRecord> {
  const validation = validateDamageReport(draft);
  if (!validation.ok) {
    throw new Error(validation.error ?? 'Die Schadensmeldung ist unvollständig.');
  }

  const id = generateDamageReportId();
  const podBase = podBaseFromWebId(ownerWebId);
  const containerUrl = `${podBase}data/schaden/${id}/`;

  const record: DamageReportRecord = {
    id,
    epc: draft.epc.trim(),
    date: draft.date,
    kind: draft.kind,
    description: draft.description.trim(),
    reportedBy: draft.reportedBy.trim(),
    moisture: draft.moisture.trim() ? draft.moisture.trim().replace(',', '.') : null,
    createdAt: new Date().toISOString(),
    containerUrl,
    ownerWebId,
  };

  await putTurtle(authenticatedFetch, `${containerUrl}report.ttl`, buildDamageReportTtl(record));

  try {
    const pod = podBaseFromUrl(containerUrl);
    const allowedRoles = await getAllowedRoles(pod);
    await stampContainerAcl(containerUrl, ownerWebId, allowedRoles);
    await writeEpcisConsent(ownerWebId, allowedRoles);
  } catch (err) {
    console.warn('[damage] ACL konnte nicht gesetzt werden:', err);
  }

  const list = readReports().filter((entry) => entry.id !== record.id);
  list.push(record);
  writeReports(list);

  return record;
}
