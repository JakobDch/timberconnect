/**
 * PDF Document Service
 *
 * Flow "ausgefülltes PDF -> Pod + Knowledge Graph" (ein Schritt):
 *
 * Der Nutzer lädt die AUSGEFÜLLTE Template-PDF hoch — die Werte stehen bereits
 * in den AcroForm-Feldern, es wird nichts mehr in der App abgetippt. Damit
 * verhält sich der PDF-Upload wie der maschinenlesbare Upload (StanForD, ELDAT,
 * ERP-Excel): eine Datei rein, Original + RDF im Pod raus.
 *
 *  1. extractPdfForm(): Feldwerte + eingebetteter GS1-Ident direkt aus der
 *     hochgeladenen Datei lesen (verstecktes AcroForm-Feld "Identity").
 *  2. convertPdfForm(): Backend materialisiert die Formulardaten per
 *     RML-Mapping zu TTL.
 *  3. Original-PDF, JSON-Extrakt und TTL landen gemeinsam unter
 *     data/<docId>/ im Pod des Uploaders (docId = SHA-256 des PDFs, 16 Hex),
 *     dazu ACL, pricing.ttl (1 Datenpunkt = 1 Token) und die
 *     Katalog-Registrierung.
 *
 * `uploadPdfDocument()` führt diese drei Schritte aus. Schlägt die
 * Konvertierung fehl, bleibt das Original trotzdem im Pod — eine hochgeladene
 * Datei zu verwerfen, weil ihr Formular unvollständig ist, wäre der schlechtere
 * Verlust.
 */

import {
  stampContainerAcl,
  getAllowedRoles,
  podBaseFromUrl,
  podBaseFromWebId,
  writeEpcisConsent,
} from './accessControlService';
import { writePricingDoc } from './pricingService';
import { registerDatasetInOwnPod } from './catalogWriteService';
import {
  extractPdfForm,
  type PdfFormValues,
  type PdfIdentity,
} from './pdfIdentityService';
import { containerForPdf } from './podPaths';

const getConverterApiUrl = () => {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/converter`;
  }
  return '/api/converter';
};

// ---------------------------------------------------------------------------
// Typen (Spiegel des Backend-Schemas aus pdf_template_service.py)
// ---------------------------------------------------------------------------

export interface PdfTemplateField {
  key: string;
  label: string;
  /**
   * 'epc_reference' und 'polygon' sind keine PDF-Formularfelder, sondern im
   * Viewer erhobene Werte: die Auswahl des bezogenen Holzes (SGTIN/LGTIN aus
   * dem Pod) bzw. die auf der Karte gezeichnete Pflanzflaeche.
   */
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'epc_reference' | 'polygon';
  unit: string | null;
  required: boolean;
  /** AcroForm-Feldname in der Template-PDF (Zeilen-Muster mit "{n}"). */
  pdfField: string;
  /**
   * Realistischer Beispielwert aus der Registry, fuer die Demo-Befuellung.
   * ``null`` = fuer dieses Feld ist kein Beispiel hinterlegt.
   */
  demo: unknown;
}

export interface PdfTemplateSection {
  id: string;
  title: string;
  /** Erklaerender Hilfetext ueber der Sektion (derzeit nur Materialbezug). */
  description: string | null;
  repeatable: boolean;
  itemLabel: string | null;
  /**
   * true = Sektion enthaelt den EPC-Bezug. Er hat kein AcroForm-Feld: der Wert
   * kommt aus dem im hochgeladenen PDF eingebetteten Ident-Feld ("Identity").
   */
  materialRef: boolean;
  /**
   * true = Sektion enthaelt die Pflanzflaeche. Der einzige Wert, den ein PDF
   * nicht tragen kann — eine Flaeche tippt man nicht ab, man zeichnet sie.
   * Dafuer zeigt der Viewer vor dem Registrieren einen Karten-Schritt.
   */
  plantingArea: boolean;
  fields: PdfTemplateField[];
}

/**
 * Materialbezug eines Templates:
 *   'required' — beschreibt eine Bewegung/Umwandlung konkreten Holzes;
 *                der EPC-Bezug ist Pflicht, ein Event kann entstehen.
 *   'optional' — Bezug erlaubt, aber nicht zwingend.
 *   'none'     — beschreibt einen Produkt-TYP (z.B. Klebstoff-Datenblatt).
 *                Bekommt bewusst keine SGTIN/LGTIN; die Verknuepfung laeuft
 *                ueber Eigenschaften im Graph, nicht ueber EPCIS.
 */
export type MaterialRef = 'required' | 'optional' | 'none';

export interface PdfTemplate {
  id: string;
  label: string;
  description: string;
  docClass: string;
  dataType: string;
  materialRef: MaterialRef;
  /** Relativer Pfad zur ausfuellbaren Template-PDF (AcroForm). */
  fileUrl: string;
  sections: PdfTemplateSection[];
}

/** Rohes AcroForm-Abbild aus PDF.js: {vollqualifizierter Feldname: Wert}. */
export type PdfFieldValues = Record<string, unknown>;

/**
 * Im Viewer erhobene Werte ohne AcroForm-Entsprechung, mit Registry-Keys:
 * der EPC-Bezug ('materialEpc') und die gezeichnete Pflanzflaeche
 * ('pflanzflaeche', GeoJSON-Polygon in [lon, lat]).
 */
export type PdfExtraFields = Record<string, unknown>;

/** Registry-Key der auf der Karte gezeichneten Pflanzflaeche. */
export const PLANTING_AREA_KEY = 'pflanzflaeche';

/**
 * Registry-Key der auf der Flaeche ausgebrachten Saatgutmenge, in Gramm.
 *
 * NICHT dasselbe wie das AcroForm-Feld "menge" (Punkt 12 des
 * Stammzertifikats): Jenes nennt die Menge der zertifizierten Partie, dieses
 * die davon auf DIESER Flaeche ausgebrachte Teilmenge. Eine Partie wird in
 * aller Regel auf mehrere Flaechen verteilt — die beiden Zahlen sind darum
 * verschieden und beide richtig.
 *
 * Der Wert ist zugleich die Mengenangabe zur LGTIN des Saatguts und wird vom
 * seed-Treiber als quantity/uom in die quantityList des ObjectEvents
 * uebernommen.
 */
export const SEED_QUANTITY_KEY = 'ausgebrachteMenge';

/** Registry-Key des im Viewer gewaehlten Materialbezugs (GS1-EPC). */
export const MATERIAL_REF_KEY = 'materialEpc';

/**
 * Woher der Ident stammt. Geht als eigenes Feld an das Backend und landet dort
 * als Metadatum (`timberconnect_pdf.epcSource`) — NICHT als zweiter Eintrag in
 * `fields`.
 *
 * Der Grund: die erzeugte JSON ist eine Schnittstelle für nachgelagerte
 * Systeme (EPCIS-Event-Generierung). Dort darf es genau EIN Feld geben, das
 * als ID des Materials in Frage kommt. Zwei Felder mit einem Ident zwingen den
 * Leser zu raten, und ein falsch geratenes Feld erzeugt Events am falschen
 * Objekt.
 */
export type EpcSource = 'document' | 'user';

/**
 * Registry-Key des Vormaterial-Idents: woraus das beschriebene Material
 * entstanden ist.
 *
 * Eigenes Feld, nicht MATERIAL_REF_KEY — Input und Output sind entgegen-
 * gesetzte Aussagen. Zusammen ergeben sie ein EPCIS-TransformationEvent.
 */
export const MATERIAL_INPUT_KEY = 'materialInputEpc';

/**
 * Registry-Key der Saegevorgaenge (EECC-Format, 08/2026).
 *
 * Ein Array von Vorgaengen, jeder mit `materialInputEpc` (Rundhoelzer) und
 * `materialEpc` (Lamellen). Bei Dokumenten mit Saegevorgaengen stehen die
 * Idente ausschliesslich hier — nicht zusaetzlich als Einzelfeld.
 */
export const SAWINGS_KEY = 'sawings';

/** Absolute URL der ausfuellbaren Template-PDF. */
export function templateFileUrl(template: PdfTemplate): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${template.fileUrl}`;
  }
  return template.fileUrl;
}

export interface PdfFormConvertResponse {
  success: boolean;
  template_id: string;
  doc_id: string;
  data_type: string;
  json_content: string;
  json_filename: string;
  rdf_content: string;
  rdf_filename: string;
  triple_count: number | null;
  message?: string;
  /** Nur bei Pflichtdokumenten gesetzt (heute: Leistungserklaerung). */
  epcis_captured?: boolean | null;
  epcis_message?: string | null;
  epcis_event_count?: number | null;
}

/** Ergebnis des Original-Uploads eines PDFs. */
export interface PdfUploadOutcome {
  file: File;
  docId: string;
  pdfUrl: string;
  containerUrl: string;
  podBase: string;
  /**
   * Im PDF eingebetteter GS1-Ident (verstecktes AcroForm-Feld), falls
   * vorhanden. Bestimmt den Materialbezug des Dokuments.
   */
  identity: PdfIdentity | null;
  /**
   * Die vom Nutzer bereits im PDF ausgefuellten AcroForm-Werte. Sie sind die
   * Quelle der Datenuebernahme — in der App wird nichts mehr eingetragen.
   */
  fields: PdfFormValues;
  /** Anzahl ausgefuellter Felder (fuer die Rueckmeldung an den Nutzer). */
  fieldCount: number;
}

export interface PdfPublishResult {
  ttlUrl: string;
  jsonUrl: string;
  datapoints: number;
}

/**
 * Ergebnis eines vollstaendigen PDF-Uploads: Original im Pod, und — sofern das
 * Formular Werte trug — auch JSON + TTL.
 */
export interface PdfDocumentResult {
  outcome: PdfUploadOutcome;
  /** null, wenn das PDF keine ausgefuellten Felder hatte. */
  published: PdfPublishResult | null;
  /**
   * Warum keine Daten uebernommen wurden bzw. woran die Konvertierung
   * scheiterte. Das Original liegt in beiden Faellen im Pod.
   */
  warning: string | null;
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

/** Dokument-ID: erste 16 Hex-Zeichen des SHA-256 des PDF-Inhalts
 * (gleiches Schema wie das Backend in /convert-only). */
export async function computeDocId(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bytes = atob(b64);
  const buffer = new ArrayBuffer(bytes.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    view[i] = bytes.charCodeAt(i);
  }
  return buffer;
}

async function putToPod(
  authenticatedFetch: typeof fetch,
  url: string,
  content: ArrayBuffer | Blob,
  contentType: string,
): Promise<string> {
  const body = content instanceof Blob ? content : new Blob([content], { type: contentType });
  const response = await authenticatedFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error(`Authentifizierung fehlgeschlagen für ${url}`);
    if (response.status === 403) throw new Error(`Keine Berechtigung für ${url}`);
    throw new Error(`Upload fehlgeschlagen (${response.status}): ${url}`);
  }
  return url;
}

// ---------------------------------------------------------------------------
// 1. Original-PDF in den Pod
// ---------------------------------------------------------------------------

export async function uploadPdfOriginal(
  file: File,
  authenticatedFetch: typeof fetch,
  ownerWebId: string,
  /**
   * Container des Vorgangs, zu dem dieses PDF gehoert. Gesetzt heisst: Das
   * Dokument landet dort statt in einem eigenen Ordner je Dokument-Hash.
   * Die Regel samt Begruendung steht in `containerForPdf` (podPaths.ts).
   */
  processContainerUrl?: string | null,
): Promise<PdfUploadOutcome> {
  const buffer = await file.arrayBuffer();
  const docId = await computeDocId(buffer);
  const podBase = podBaseFromWebId(ownerWebId);
  const containerUrl = containerForPdf(podBase, docId, processContainerUrl);
  const pdfUrl = `${containerUrl}${docId}_dokument.pdf`;

  // Formularwerte und Ident aus dem Original lesen, bevor der Puffer
  // weitergereicht wird. Schlaegt nie fehl: ohne AcroForm bleibt `fields` leer
  // und es wird lediglich das Original abgelegt.
  const extract = await extractPdfForm(buffer);
  if (extract.identity) {
    console.info(
      `[pdf-upload] Ident aus Feld "${extract.identity.fieldName}" gelesen:`,
      extract.identity.epc,
    );
  }

  await putToPod(authenticatedFetch, pdfUrl, buffer, 'application/pdf');

  // Gleiches Zugriffsmodell wie beim maschinenlesbaren Upload: Owner-Control,
  // Read fuer die vom Owner freigegebenen Rollen.
  //
  // Nur fuer den EIGENEN Container des Dokuments. Liegt das PDF im Container
  // eines Vorgangs, traegt der seine ACL bereits aus createProcess — ihn hier
  // erneut zu stempeln waere nicht nur ueberfluessig, sondern wuerde eine
  // inzwischen gesetzte dokumentweise Freigabe wieder platt schreiben.
  try {
    const pod = podBaseFromUrl(containerUrl);
    const allowedRoles = await getAllowedRoles(pod);
    if (!processContainerUrl) {
      await stampContainerAcl(containerUrl, ownerWebId, allowedRoles);
    }
    // Die EPCIS-Einwilligung haengt am Nutzer, nicht am Container — sie gilt
    // unabhaengig davon, wo das Dokument liegt.
    await writeEpcisConsent(ownerWebId, allowedRoles);
  } catch (err) {
    console.warn('[pdf-upload] ACL konnte nicht gesetzt werden:', err);
  }

  return {
    file,
    docId,
    pdfUrl,
    containerUrl,
    podBase,
    identity: extract.identity,
    fields: extract.fields,
    fieldCount: extract.fieldCount,
  };
}

// ---------------------------------------------------------------------------
// 2. Templates laden
// ---------------------------------------------------------------------------

export async function fetchPdfTemplates(): Promise<PdfTemplate[]> {
  const response = await fetch(`${getConverterApiUrl()}/pdf-templates`);
  if (!response.ok) {
    throw new Error(`PDF-Templates konnten nicht geladen werden (${response.status})`);
  }
  const data = await response.json();
  return data.templates as PdfTemplate[];
}

// ---------------------------------------------------------------------------
// 3. Formulardaten materialisieren + veroeffentlichen
// ---------------------------------------------------------------------------

export async function convertPdfForm(
  templateId: string,
  docId: string,
  pdfFields: PdfFieldValues,
  extraFields?: PdfExtraFields,
  epcSource?: EpcSource,
  /** Pod-Container des Original-PDFs -- wird zur EPCIS-bizTransaction. */
  docBaseUrl?: string,
): Promise<PdfFormConvertResponse> {
  const response = await fetch(`${getConverterApiUrl()}/convert-pdf-form`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      template_id: templateId,
      doc_id: docId,
      pdf_fields: pdfFields,
      extra_fields: extraFields,
      epc_source: epcSource,
      doc_base_url: docBaseUrl,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unbekannter Fehler' }));
    throw new Error(error.detail || `Konvertierung fehlgeschlagen (${response.status})`);
  }
  return response.json();
}

/**
 * Kompletter Absenden-Flow: materialisieren, JSON + TTL in den Container des
 * Original-PDFs laden, pricing.ttl schreiben, im Katalog registrieren.
 */
export async function publishPdfForm(
  outcome: PdfUploadOutcome,
  template: PdfTemplate,
  pdfFields: PdfFieldValues,
  authenticatedFetch: typeof fetch,
  ownerWebId: string,
  userName?: string | null,
  extraFields?: PdfExtraFields,
  epcSource?: EpcSource,
): Promise<PdfPublishResult> {
  // doc_base_url wird zur bizTransaction: timber-event bildet
  // `${doc_base_url}/${TransaktionsId}`. Die Transaktions-Id waehlt der
  // Treiber selbst -- sawdecl nimmt die Dokumentnummer aus dem Formular
  // (z.B. "DoP-SAE-2026-0728"), NICHT die doc_id des Uploads.
  //
  // Deshalb hier der data-Ordner OHNE Container: sonst zeigte die
  // bizTransaction auf .../data/<hash>/<Dokumentnummer>, also eine Ebene zu
  // tief, und sourcesFromBizTransactions liest das letzte Pfadsegment als
  // Container-Id -- es wuerde die Dokumentnummer fuer den Container halten
  // und nichts finden.
  //
  // Der Preis: die bizTransaction zeigt auf .../data/<Dokumentnummer> statt
  // auf den echten Container .../data/<hash>/. Aufgeloest wird das ueber den
  // Katalog des Pods, nicht ueber diesen Link (siehe fetchProductDataByEpc).
  const docBaseUrl = outcome.containerUrl.replace(/\/[^/]+\/$/, '');

  const converted = await convertPdfForm(
    template.id,
    outcome.docId,
    pdfFields,
    extraFields,
    epcSource,
    docBaseUrl,
  );

  const jsonUrl = await putToPod(
    authenticatedFetch,
    `${outcome.containerUrl}${converted.json_filename}`,
    base64ToArrayBuffer(converted.json_content),
    'application/json',
  );
  const ttlUrl = await putToPod(
    authenticatedFetch,
    `${outcome.containerUrl}${converted.rdf_filename}`,
    base64ToArrayBuffer(converted.rdf_content),
    'text/turtle',
  );

  const datapoints = converted.triple_count ?? 0;

  // Preis-Metadaten: Datenpunkte der TTL, Zahlungsempfaenger = Uploader.
  if (datapoints > 0) {
    try {
      await writePricingDoc(outcome.containerUrl, [
        { fileUrl: ttlUrl, datapoints, recipientWebId: ownerWebId },
      ]);
    } catch (err) {
      console.warn('[pdf-publish] pricing.ttl konnte nicht geschrieben werden:', err);
    }
  }

  // Katalogeintrag im EIGENEN Pod (best effort, blockiert den Erfolg nicht).
  // Ohne ihn liegt das Dokument zwar im Pod, ist aber fuer keine Abfrage
  // sichtbar: die Quellen entstehen aus den Katalogeintraegen.
  const catalogResult = await registerDatasetInOwnPod(authenticatedFetch, {
    ownerWebId,
    title: `${template.label} - ${outcome.docId}`,
    description: `${template.description || template.label} (Dokument-ID: ${outcome.docId})`,
    downloadUrl: ttlUrl,
    rawUrl: outcome.pdfUrl,
    publisher: userName || undefined,
    theme: template.docClass || undefined,
  });
  if (!catalogResult.ok) {
    console.warn('[pdf-publish] Katalogeintrag fehlgeschlagen:', catalogResult.error);
  }

  return { ttlUrl, jsonUrl, datapoints };
}

// ---------------------------------------------------------------------------
// 4. Vollstaendiger Upload: Original + Datenuebernahme in einem Schritt
// ---------------------------------------------------------------------------

/**
 * Baut die im Viewer erhobenen Zusatzfelder aus dem, was das PDF selbst
 * mitbringt.
 *
 * Genau EIN Ident-Feld: Saegevorgaenge (n:m-Umwandlung) haben Vorrang, denn
 * liegen sie vor, tragen sie saemtliche Idente des Dokuments. Ein zusaetzliches
 * Einzelfeld waere eine zweite Stelle, an der eine ID stehen koennte — und eine
 * willkuerliche Auswahl aus vielen gleichrangigen EPCs.
 *
 * `epcSource` ist hier immer 'document': die Werte stammen ausschliesslich aus
 * dem hochgeladenen Dokument, nicht aus einer Auswahl in der App.
 */
function extraFieldsFromIdentity(identity: PdfIdentity | null): {
  extraFields: PdfExtraFields;
  epcSource: EpcSource | undefined;
} {
  const extraFields: PdfExtraFields = {};
  if (!identity) return { extraFields, epcSource: undefined };

  if (identity.sawings && identity.sawings.length > 0) {
    extraFields[SAWINGS_KEY] = identity.sawings;
    return { extraFields, epcSource: 'document' };
  }

  extraFields[MATERIAL_REF_KEY] = identity.epc;
  // Vormaterial: woraus das beschriebene Material entstanden ist. Zusammen mit
  // dem Ident bildet das EECC daraus ein TransformationEvent (Input -> Output).
  if (identity.inputEpc) {
    extraFields[MATERIAL_INPUT_KEY] = identity.inputEpc;
  }
  return { extraFields, epcSource: 'document' };
}

/**
 * Kompletter PDF-Upload — das Gegenstueck zu `convertAndUploadWithSession`
 * fuer maschinenlesbare Dateien.
 *
 * Original in den Pod, Formularwerte aus der Datei materialisieren, JSON + TTL
 * daneben ablegen. Ohne ausgefuellte Felder bleibt es beim Original; das ist
 * kein Fehler, sondern ein PDF, das nur als Dokument abgelegt werden soll.
 *
 * Eine fehlgeschlagene Konvertierung wirft NICHT: das Original ist zu diesem
 * Zeitpunkt bereits sicher im Pod, und der Vorgang soll deswegen nicht
 * scheitern. Der Grund kommt als `warning` zurueck.
 */
export async function uploadPdfDocument(
  file: File,
  template: PdfTemplate | null,
  authenticatedFetch: typeof fetch,
  ownerWebId: string,
  userName?: string | null,
  /**
   * Auf der Karte gezeichnete Pflanzflaeche (GeoJSON). Der einzige Wert, den
   * ein PDF nicht tragen kann — er wird vor dem Upload separat erhoben.
   */
  plantingArea?: unknown,
  /** Auf dieser Flaeche ausgebrachte Saatgutmenge in Gramm. */
  seedQuantityGrams?: number | null,
  /**
   * Container des Vorgangs. Gesetzt heisst: Das Dokument gehoert zu diesem
   * Vorgang und wird dort abgelegt, statt einen eigenen Container zu bekommen.
   */
  processContainerUrl?: string | null,
): Promise<PdfDocumentResult> {
  const outcome = await uploadPdfOriginal(
    file,
    authenticatedFetch,
    ownerWebId,
    processContainerUrl,
  );

  if (!template) {
    return {
      outcome,
      published: null,
      warning: `${file.name}: Keine Vorlage zugeordnet — nur das Original wurde abgelegt.`,
    };
  }
  // Ohne jeden Wert gibt es nichts zu materialisieren. Ein eingebetteter Ident
  // oder eine gezeichnete Flaeche sind aber fuer sich schon Aussagen — dann
  // wird konvertiert, auch wenn das Formular selbst leer blieb.
  if (
    outcome.fieldCount === 0 &&
    !outcome.identity &&
    !plantingArea &&
    !seedQuantityGrams
  ) {
    return {
      outcome,
      published: null,
      warning: `${file.name}: Keine ausgefüllten Formularfelder gefunden — nur das Original wurde abgelegt.`,
    };
  }

  const { extraFields, epcSource } = extraFieldsFromIdentity(outcome.identity);
  if (plantingArea) extraFields[PLANTING_AREA_KEY] = plantingArea;
  if (seedQuantityGrams) extraFields[SEED_QUANTITY_KEY] = seedQuantityGrams;

  try {
    const published = await publishPdfForm(
      outcome,
      template,
      outcome.fields,
      authenticatedFetch,
      ownerWebId,
      userName,
      extraFields,
      epcSource,
    );
    return { outcome, published, warning: null };
  } catch (err) {
    return {
      outcome,
      published: null,
      warning: `${file.name}: Daten konnten nicht übernommen werden (${
        err instanceof Error ? err.message : 'Unbekannter Fehler'
      }). Das Original liegt im Pod.`,
    };
  }
}
