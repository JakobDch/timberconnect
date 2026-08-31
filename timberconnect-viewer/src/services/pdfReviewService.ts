/**
 * Aufbereitung der ausgelesenen PDF-Werte fuer die Pruefansicht.
 *
 * Vor dem Upload sieht der Nutzer, WAS aus seinem Dokument gelesen wurde —
 * nicht die rohen AcroForm-Feldnamen, sondern die Beschriftungen der Vorlage,
 * gruppiert nach ihren Abschnitten. Erst danach entscheidet er, ob
 * hochgeladen wird.
 *
 * Die Zuordnung bildet `pdf_fields_to_form_data` aus dem Converter-Backend
 * nach: Feldname der Vorlage -> Registry-Key, wiederholbare Sektionen ueber
 * das ``{n}``-Muster als Zeilen. Sie MUSS dasselbe Ergebnis liefern, sonst
 * bestaetigt der Nutzer etwas anderes, als spaeter materialisiert wird.
 *
 * Bewusst nur lesend und ohne Netzaufruf: Die Werte stecken bereits in der
 * lokal geparsten Datei. Eine Vorschau, die erst das Backend fragt, waere ein
 * Upload vor der Zustimmung — genau das soll dieser Schritt verhindern.
 */

import type { PdfTemplate, PdfTemplateField } from './pdfDocumentService';
import type { PdfFormValues, PdfIdentity } from './pdfIdentityService';
import { IDENTITY_BEARING_FIELDS } from './pdfIdentityService';

/**
 * Traegt dieses Feld einen Ident?
 *
 * Ident-Felder stehen bewusst NICHT im Feld-Mapping der Vorlage — sie werden
 * von pdfIdentityService gelesen und als EPC verarbeitet, nicht als
 * Formularwert angezeigt. Als "nicht zugeordnet" zu zaehlen waere deshalb
 * falsch: der Wert geht nicht verloren, er nimmt nur einen anderen Weg.
 *
 * Die Zaehlvariante ("IdentityInput_1", "IdentityInput_24") faellt darunter:
 * eine Leistungserklaerung listet jedes Vormaterial in einem eigenen Feld.
 */
const IDENT_SUFFIX_RE = /_\d+$/;
function isIdentityField(name: string): boolean {
  const base = name.replace(IDENT_SUFFIX_RE, '');
  return IDENTITY_BEARING_FIELDS.includes(base);
}

/** Ein ausgelesener Einzelwert, fertig zur Anzeige. */
export interface ReviewValue {
  key: string;
  label: string;
  /** Angezeigter Wert, bereits formatiert (Einheit inbegriffen). */
  display: string;
}

/** Eine Zeile einer wiederholbaren Sektion (Tabelle). */
export interface ReviewRow {
  /** Zeilennummer aus dem Feldnamen ("Fmax_7" -> 7). */
  index: number;
  values: ReviewValue[];
}

export interface ReviewSection {
  id: string;
  title: string;
  values: ReviewValue[];
  rows: ReviewRow[];
}

export interface PdfReview {
  sections: ReviewSection[];
  /** Anzahl aller ausgelesenen Einzelwerte — die Zahl, die zaehlt. */
  valueCount: number;
  /**
   * Ausgefuellte Felder, die zu keinem Feld der Vorlage passen. Ihre Zahl ist
   * der ehrliche Hinweis darauf, dass die falsche Vorlage gewaehlt wurde.
   */
  unmappedCount: number;
}

/** Wert eines Checkbox-Felds lesbar machen. */
/**
 * Ausdrueckliche Nicht-Angabe ("keine Angabe", "entfällt", "—").
 *
 * Muss zum Muster ``_NO_VALUE_RE`` im Backend passen: was dort in einem
 * Zahlenfeld als "kein Wert" gilt, darf die Vorschau nicht als Zahl mit
 * Einheit zeigen ("keine Angabe %") — der Nutzer bestaetigt sonst etwas
 * anderes, als spaeter materialisiert wird.
 */
const NO_VALUE_RE =
  /^\s*(?:-+|\/|k\.?\s*A\.?|keine\s+Angabe[n]?|entf(ä|ae)llt|n\.?\s*a\.?|nicht\s+zutreffend)\s*$/i;

function formatValue(field: PdfTemplateField, raw: unknown): string {
  if (field.type === 'checkbox') {
    const truthy =
      raw === true || (typeof raw === 'string' && raw.trim() !== '' && raw !== 'Off');
    return truthy ? 'Ja' : 'Nein';
  }
  const text = String(raw).trim();
  if (field.type === 'number' && NO_VALUE_RE.test(text)) return text;
  return field.unit ? `${text} ${field.unit}` : text;
}

/** Regex aus dem ``{n}``-Muster eines wiederholbaren Feldnamens. */
function rowPattern(pdfField: string): RegExp {
  const escaped = pdfField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\\\{n\\\}/g, '(\\d+)')}$`);
}

/**
 * Die ausgelesenen Werte gegen die Vorlage auflösen.
 *
 * @param fields  Rohe AcroForm-Werte {vollqualifizierter Feldname: Wert}
 * @param extras  Im Viewer erhobene Werte mit Registry-Keys (Pflanzflaeche,
 *                Saatgutmenge). Sie haben kein AcroForm-Feld und muessen
 *                deshalb gesondert einfliessen — sonst zeigte die Pruefansicht
 *                genau die Angaben nicht, die der Nutzer eben selbst gemacht
 *                hat.
 */
export function buildPdfReview(
  template: PdfTemplate,
  fields: PdfFormValues,
  extras: Record<string, { label: string; display: string }> = {},
): PdfReview {
  // Feldname -> (Sektion, Feld) fuer einfache Felder; Muster fuer Tabellen.
  const flat = new Map<string, { sectionId: string; field: PdfTemplateField }>();
  const repeat: { sectionId: string; regex: RegExp; field: PdfTemplateField }[] = [];

  for (const section of template.sections) {
    for (const field of section.fields) {
      if (!field.pdfField) continue; // Viewer-Feld, kommt ueber `extras`
      if (section.repeatable) {
        repeat.push({ sectionId: section.id, regex: rowPattern(field.pdfField), field });
      } else {
        flat.set(field.pdfField, { sectionId: section.id, field });
      }
    }
  }

  const bySection = new Map<string, ReviewValue[]>();
  const rowsBySection = new Map<string, Map<number, ReviewValue[]>>();
  let unmappedCount = 0;

  for (const [name, raw] of Object.entries(fields)) {
    if (raw === null || raw === undefined) continue;
    // Idente werden ausgewertet, nur nicht ueber das Feld-Mapping.
    if (isIdentityField(name)) continue;

    const direct = flat.get(name);
    if (direct) {
      const list = bySection.get(direct.sectionId) ?? [];
      list.push({
        key: direct.field.key,
        label: direct.field.label,
        display: formatValue(direct.field, raw),
      });
      bySection.set(direct.sectionId, list);
      continue;
    }

    const match = repeat
      .map((r) => ({ r, m: r.regex.exec(name) }))
      .find((x) => x.m !== null);
    if (match?.m) {
      const rowNo = Number(match.m[1]);
      const rows = rowsBySection.get(match.r.sectionId) ?? new Map<number, ReviewValue[]>();
      const row = rows.get(rowNo) ?? [];
      row.push({
        key: match.r.field.key,
        label: match.r.field.label,
        display: formatValue(match.r.field, raw),
      });
      rows.set(rowNo, row);
      rowsBySection.set(match.r.sectionId, rows);
      continue;
    }

    unmappedCount++;
  }

  // Viewer-Werte ihren Sektionen zuordnen (Pflanzflaeche, Saatgutmenge).
  for (const [key, extra] of Object.entries(extras)) {
    const section = template.sections.find((s) => s.fields.some((f) => f.key === key));
    const sectionId = section?.id ?? template.sections[0]?.id ?? 'sonstiges';
    const list = bySection.get(sectionId) ?? [];
    list.push({ key, label: extra.label, display: extra.display });
    bySection.set(sectionId, list);
  }

  // In der Reihenfolge der Vorlage ausgeben — sie folgt dem Papierdokument,
  // und genau daran gleicht der Nutzer ab.
  const sections: ReviewSection[] = [];
  let valueCount = 0;
  for (const section of template.sections) {
    const values = bySection.get(section.id) ?? [];
    const rowMap = rowsBySection.get(section.id);
    const rows: ReviewRow[] = rowMap
      ? Array.from(rowMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([index, values]) => ({ index, values }))
      : [];
    if (values.length === 0 && rows.length === 0) continue;
    valueCount += values.length + rows.reduce((sum, r) => sum + r.values.length, 0);
    sections.push({ id: section.id, title: section.title, values, rows });
  }

  return { sections, valueCount, unmappedCount };
}

/** Die Idente eines Dokuments flach auflisten — fuer die Pruefansicht. */
export function identityLines(identity: PdfIdentity | null): {
  label: string;
  epcs: string[];
}[] {
  if (!identity) return [];
  if (identity.sawings?.length) {
    return identity.sawings.flatMap((s, i) => [
      { label: `Sägevorgang ${i + 1} — Eingang`, epcs: s.materialInputEpc },
      { label: `Sägevorgang ${i + 1} — Ergebnis`, epcs: s.materialEpc },
    ]);
  }
  const lines = [{ label: 'Material-ID', epcs: [identity.epc] }];
  if (identity.inputEpc) {
    lines.push({ label: 'Vormaterial', epcs: [identity.inputEpc] });
  }
  return lines;
}
