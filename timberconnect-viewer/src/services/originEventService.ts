/**
 * Die Herkunftskante als EPCIS-Event schreiben.
 *
 * Aus dem bestätigten Vorschlag (siehe stemOriginService) entsteht hier je
 * Pflanzfläche ein TransformationEvent: das Saatgut-LGTIN als Eingang, die auf
 * dieser Fläche gefällten Rundholz-SGTINs als Ausgang.
 *
 * Damit ist die Kette geschlossen. `collectEpcs` in epcisService liest
 * `inputEPCList`/`outputEPCList` bereits — ohne jede Änderung dort läuft die
 * Abfrage ab sofort in beide Richtungen: von der Pflanzung vorwärts zum
 * Rundholz und von der Platte rückwärts bis zur Fläche.
 *
 * ## Warum TransformationEvent und nicht AggregationEvent
 *
 * Aus dem Saatgut WIRD das Rundholz; es wird nicht darin enthalten. Das ist
 * genau der Fall, für den GS1 das TransformationEvent vorsieht, und es ist
 * dieselbe Form, die Sägewerk und BSP-Werk schon nutzen (siehe
 * epcis_builder.build_transformation_event). Ein AggregationEvent würde eine
 * Behälterbeziehung behaupten, die es nicht gibt.
 *
 * ## Der Beleggrad steht im Event
 *
 * Diese Kante ist geometrisch erschlossen, nicht aus einem Dokument gelesen.
 * Sie ist damit schwächer belegt als eine Leistungserklärung, die zwei Akteure
 * namentlich nennt. `tc:linkBasis` hält das fest, damit später niemand raten
 * muss, woher die Verbindung kam — eine erschlossene Kante, die sich als
 * dokumentbelegte ausgibt, wäre schlimmer als gar keine.
 */

import { getAuthFetch } from './authFetch';
import type { OriginGroup, OriginProposal } from './stemOriginService';

const EPCIS_BASE =
  import.meta.env.VITE_EPCIS_SERVICE_URL ||
  (typeof window !== 'undefined'
    ? `${window.location.origin}/api/epcis`
    : '/api/epcis');

const EPCIS_CONTEXT =
  'https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld';

/**
 * CBV-BizStep der Herkunftskante.
 *
 * `commissioning` und nicht das naheliegende `transforming`: Letzteres steht
 * NICHT in der CBV-Codeliste. Das EPCAT nimmt ein solches Dokument zwar mit
 * 202 an, verwirft es aber in der asynchronen Validierung —
 * "EpcisFormatException: 'transforming' is not an allowed BizStep the GS1 CBV".
 * Weil der Capture-Job danach niemand mehr abfragte, sah der Upload erfolgreich
 * aus, waehrend im Repository nie ein Event ankam (02.09.2026).
 *
 * Am EPCAT geprueft: gueltig sind u.a. commissioning, creating_class_instance
 * und assembling; abgelehnt werden transforming, harvesting, growing und
 * production. `commissioning` ist damit der passendste verfuegbare Schritt --
 * es ist derselbe, mit dem die Kette die Stamm-Idente ohnehin in Umlauf bringt.
 */
const BIZSTEP_TRANSFORMING = 'https://ref.gs1.org/cbv/BizStep-commissioning';

/** Zeitzonen-Offset im EPCIS-Format (+02:00). */
function tzOffset(date: Date): string {
  const mins = -date.getTimezoneOffset();
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/**
 * Ein TransformationEvent für eine Fläche.
 *
 * `eventTime` ist der Zeitpunkt der Fällung, nicht der des Uploads — das Event
 * beschreibt einen Vorgang im Wald, nicht eine Handlung in der App. Fehlt er
 * (kein HarvestDate im Protokoll), wird die aktuelle Zeit genommen; eine
 * erfundene Vergangenheit wäre die schlechtere Angabe.
 */
export function buildOriginEvent(
  group: OriginGroup,
  options: {
    bizTransactionUrl?: string | null;
    eventTime?: string | null;
  } = {},
): Record<string, unknown> {
  const now = new Date();
  const stemEpcs = group.stems
    .map((s) => s.epc)
    .filter((e): e is string => !!e);

  const event: Record<string, unknown> = {
    type: 'TransformationEvent',
    eventTime: options.eventTime || now.toISOString(),
    eventTimeZoneOffset: tzOffset(now),
    eventID: `urn:uuid:${crypto.randomUUID()}`,
    // Kein "action" — der Standard erlaubt es am TransformationEvent nicht.
    bizStep: BIZSTEP_TRANSFORMING,
    inputQuantityList: [{ epcClass: group.seedEpc }],
    outputEPCList: stemEpcs,
    // Herkunft der Kante. Siehe Kopfkommentar: erschlossen, nicht belegt.
    'tc:linkBasis': 'geometric',
    'tc:linkSource': group.area.certificateIri,
  };

  if (options.bizTransactionUrl) {
    event.bizTransactionList = [{ bizTransaction: options.bizTransactionUrl }];
  }

  return event;
}

/**
 * Das EPCIS-Dokument für alle bestätigten Gruppen.
 *
 * Je Fläche ein Event — ein Einschlag kann über zwei Flächen laufen, und beide
 * in ein Event zu pressen würde eine gemeinsame Herkunft behaupten, die die
 * Koordinaten nicht hergeben.
 */
export function buildOriginDocument(
  groups: OriginGroup[],
  options: {
    bizTransactionUrl?: string | null;
    eventTime?: string | null;
  } = {},
): Record<string, unknown> {
  return {
    '@context': [EPCIS_CONTEXT, { tc: 'http://timberconnect.2050.de/ontology#' }],
    type: 'EPCISDocument',
    schemaVersion: '2.0',
    creationDate: new Date().toISOString(),
    epcisBody: {
      eventList: groups.map((g) => buildOriginEvent(g, options)),
    },
  };
}

export interface OriginCaptureResult {
  captured: boolean;
  dryRun: boolean;
  eventCount: number;
  message: string | null;
}

/**
 * Die bestätigten Gruppen ins EPCAT schreiben.
 *
 * Nur die Gruppen, die der Nutzer im Prüfschritt ausgewählt hat — deshalb
 * `selectedIris` statt des ganzen Vorschlags. Wer eine Zuordnung abwählt, will
 * sie nicht im Repository haben.
 *
 * Wirft bei Fehlern. Anders als beim Laden der Flächen ist das hier richtig:
 * Der Nutzer hat die Verknüpfung ausdrücklich bestätigt, und ein stilles
 * Scheitern würde ihm eine geschriebene Kante vorspiegeln, die es nicht gibt.
 */
export async function captureOriginLink(
  proposal: OriginProposal,
  selectedIris: string[],
  options: {
    bizTransactionUrl?: string | null;
    eventTime?: string | null;
  } = {},
): Promise<OriginCaptureResult> {
  const groups = proposal.groups.filter((g) =>
    selectedIris.includes(g.area.certificateIri),
  );
  if (groups.length === 0) {
    return { captured: false, dryRun: false, eventCount: 0, message: null };
  }

  const document = buildOriginDocument(groups, options);

  const response = await getAuthFetch()(`${EPCIS_BASE}/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ epcis_document: document }),
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((b) => b.detail)
      .catch(() => null);
    throw new Error(
      detail || `Herkunftsverknüpfung fehlgeschlagen: ${response.status}`,
    );
  }

  const body = await response.json();
  return {
    captured: body.submitted ?? false,
    dryRun: body.dry_run ?? false,
    eventCount: groups.length,
    message: body.message ?? null,
  };
}
