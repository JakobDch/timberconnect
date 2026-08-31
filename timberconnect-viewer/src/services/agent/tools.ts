/**
 * Die Werkzeuge des Assistenten.
 *
 * Ein Ort fuer beides -- die JSON-Schemas, die das Sprachmodell zu sehen
 * bekommt, UND die Funktionen, die sie ausfuehren. Zwei getrennte Listen
 * laufen beim ersten Umbenennen auseinander, und der Fehler zeigt sich dann
 * erst zur Laufzeit als "unbekanntes Werkzeug".
 *
 * Grundregel fuer alle Werkzeuge: FEHLER WERDEN ZURUECKGEGEBEN, NICHT GEWORFEN.
 * Ein geworfener Fehler beendet die Agentenschleife; ein zurueckgegebener
 * bringt dem Modell bei, was es falsch gemacht hat, und es versucht es besser.
 * Deshalb liefert jedes Werkzeug entweder ``{ok: true, ...}`` oder
 * ``{ok: false, error, hint}``.
 */

import { queryEpcisEvents, collectEpcs } from '../epcisService';
import {
  executeQuery,
  queryPlantingAreas,
  queryPlantingAreaByEpc,
  type PlantingAreaResult,
} from '../sparqlService';
import { areasContaining } from '../geoService';
import { filterSourcesByRole } from '../accessControlService';
import { getCurrentRole } from '../authFetch';
import { NAMESPACES, getAllProductsAsync } from '../../config/solidPods';
import { runScopedQuery } from './agentSparqlService';
import type { EpcScope } from './epcScopeService';
import type { SchemaPack } from './schemaContextService';

// ---------------------------------------------------------------------------
// Schemas fuer das Modell (OpenAI-/DeepSeek-Format)
// ---------------------------------------------------------------------------

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * ES GIBT BEWUSST KEIN WERKZEUG ZUR SCHEMA-SUCHE.
 *
 * Ein "search_schema" stand hier zunaechst -- gestrichen, nachdem die Messung
 * an den echten Daten die Grundlage widerlegt hat. Das vollstaendige
 * Datenmodell aller 15 Mappings sind 47 Klassen mit 716 Eigenschaften und rund
 * 11.900 Token; es steht komplett in der Systemnachricht. Das Modell sieht
 * jede Eigenschaft also bereits -- ein Werkzeug, das ihm zeigt, was ohnehin
 * vor ihm liegt, kostet nur einen Schleifendurchlauf.
 *
 * Dazu kam ein handfester Mangel: die Suche haette ueber die deutschen
 * rdfs:label laufen sollen, aber nur 73% der genutzten Eigenschaften tragen
 * eines. Zentrale Begriffe wie tc:harvestDate, tc:ForestSource und
 * tc:adhesiveType fehlen in der Ontologie ganz -- eine Suche nach "Erntedatum"
 * fand tc:harvestDate NICHT, obwohl der Term woertlich im Prompt steht.
 *
 * Die Labels bleiben trotzdem nuetzlich: sie stehen als Kommentar an den
 * Zeilen des Schema-Blocks (renderClass), wo es sie gibt. Nur haengt jetzt
 * nichts mehr an ihrer Vollstaendigkeit.
 */
/**
 * Der Name des Antwort-Werkzeugs -- an mehreren Stellen gebraucht, deshalb
 * eine Konstante statt einer Zeichenkette im Code.
 */
export const ANSWER_TOOL = 'antwort';

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: ANSWER_TOOL,
      description:
        'Gib deine fertige Antwort an den Nutzer. Das ist der EINZIGE Weg, auf ' +
        'dem Text den Nutzer erreicht — freier Fließtext neben Werkzeugaufrufen ' +
        'wird verworfen und nie angezeigt. Rufe dies genau einmal auf, wenn du ' +
        'die Frage beantworten kannst oder sicher weißt, dass die Daten fehlen.',
      parameters: {
        type: 'object',
        properties: {
          antwort: {
            type: 'string',
            description:
              'Die Antwort auf die Frage des Nutzers, auf Deutsch, mit Belegen ' +
              '[Q<n>.<variable>]. Nur das Ergebnis — keine Beschreibung deines ' +
              'Vorgehens, keine Überlegungen, was du als Nächstes versuchen ' +
              'könntest, keine Erwähnung von Abfragen oder Werkzeugen.',
          },
          verwendete_daten: {
            type: 'array',
            description:
              'Genau die Werte, die in deiner Antwort vorkommen — nur diese werden ' +
              'dem Nutzer berechnet. Was du unterwegs gesehen, aber nicht verwendet ' +
              'hast, gehört NICHT hierher. Nennst du eine Holzart, steht hier ein ' +
              'Eintrag für die Holzart; nennst du keine, steht auch keiner hier. ' +
              'Eine Antwort ohne Datenwerte ("dazu liegen keine Angaben vor") hat ' +
              'eine leere Liste.',
            items: {
              type: 'object',
              properties: {
                abfrage: {
                  type: 'integer',
                  description: 'Die Nummer der Abfrage (die 3 aus [Q3.holzart]).',
                },
                variable: {
                  type: 'string',
                  description: 'Der Variablenname (das "holzart" aus [Q3.holzart]).',
                },
                wert: {
                  type: 'string',
                  description:
                    'Der Wert selbst, exakt wie im Abfrageergebnis ("Fichte"). ' +
                    'Nicht umformuliert und nicht übersetzt.',
                },
              },
              required: ['abfrage', 'variable', 'wert'],
            },
          },
        },
        required: ['antwort', 'verwendete_daten'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_sparql',
      description:
        'Führt eine SPARQL-SELECT- oder ASK-Abfrage gegen die Pod-Daten dieses ' +
        'Bauteils aus. Die Quellen werden automatisch gesetzt — gib KEINE ' +
        'FROM-Klausel und kein SERVICE an. Die Abfrage muss sich auf einen EPC ' +
        'dieses Bauteils beziehen, außer bei kind="probe".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Die vollständige SPARQL-Abfrage inkl. PREFIX-Zeilen.' },
          purpose: {
            type: 'string',
            description:
              'Ein Satz auf Deutsch: wozu dient diese Abfrage? Wird dem Nutzer angezeigt.',
          },
          kind: {
            type: 'string',
            enum: ['probe', 'data'],
            description:
              'probe = Sondierung der Datenlage (ASK/kleines LIMIT), ohne EPC-Pflicht; ' +
              'Sondierungsergebnisse dürfen NICHT zitiert werden. ' +
              'data = echte Datenabfrage (Standard).',
          },
        },
        required: ['query', 'purpose'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'match_forest_origin',
      description:
        'Ordnet eine Einschlagsposition (Koordinate) den Pflanzflächen aus den ' +
        'Stammzertifikaten zu — der Weg, auf dem die Waldherkunft im Datenraum ' +
        'hergestellt wird. Nutze dies, wenn du an einem Stamm eine Position ' +
        '(geo:lat/geo:long) gefunden hast und wissen willst, aus welcher Pflanzung ' +
        'das Holz stammt. Ohne Argumente werden alle Positionen der Lieferkette geprüft.',
      parameters: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Breitengrad der Einschlagsposition.' },
          lon: { type: 'number', description: 'Längengrad der Einschlagsposition.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_related_epcs',
      description:
        'Liefert die EPCIS-Ereignisse zu einem EPC dieses Bauteils und alle darüber ' +
        'verknüpften EPCs (Vorprodukte, Chargen, Aggregationen). Nutze dies, wenn die ' +
        'Frage die Vorkette betrifft und der gescannte EPC allein nicht reicht.',
      parameters: {
        type: 'object',
        properties: {
          epc: {
            type: 'string',
            description:
              'Optional. Standard ist der gescannte EPC. Zulässig sind nur EPCs, die ' +
              'bereits als verknüpft bekannt sind.',
          },
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Ausfuehrung
// ---------------------------------------------------------------------------

export interface ToolContext {
  scope: EpcScope;
  pack: SchemaPack;
}

export type ToolResult = Record<string, unknown>;

export interface ToolCallInput {
  name: string;
  args: Record<string, unknown>;
}

/** Ein unbekannter Name ist ein Modellfehler -- lehrend beantworten, nicht werfen. */
function unknownTool(name: string): ToolResult {
  return {
    ok: false,
    error: `Unbekanntes Werkzeug: ${name}.`,
    hint: `Verfügbar sind: ${TOOL_SCHEMAS.map((t) => t.function.name).join(', ')}.`,
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Ein Werkzeug ausfuehren.
 *
 * Gibt zusaetzlich zum Modell-sichtbaren ``result`` die Rohzeilen zurueck
 * (``rows``), damit der Aufrufer sie in den Kaufledger legen kann, ohne sie
 * ein zweites Mal abfragen zu muessen. ``billable`` sagt, ob sie dort
 * hineingehoeren -- Sondierungen tun das nicht.
 */
export async function executeTool(
  call: ToolCallInput,
  context: ToolContext,
): Promise<{ result: ToolResult; rows?: unknown[]; billable: boolean }> {
  const { scope } = context;

  switch (call.name) {
    case 'run_sparql': {
      const query = asString(call.args.query);
      if (!query) {
        return {
          result: {
            ok: false,
            error: 'query fehlt.',
            hint: 'Gib die vollständige SPARQL-Abfrage inklusive PREFIX-Zeilen an.',
          },
          billable: false,
        };
      }
      const kind = call.args.kind === 'probe' ? 'probe' : 'data';
      const result = await runScopedQuery(query, scope, { kind });

      if (!result.ok) return { result, billable: false };

      // Nicht der Wunsch des Modells entscheidet, sondern das Ergebnis.
      const wasProbe = result.effectiveKind === 'probe';

      return {
        result: {
          ok: true,
          row_count: result.row_count,
          truncated: result.truncated,
          variables: result.variables,
          rows: result.rows,
          sources_used: result.sources_used,
          ...(kind === 'probe' && !wasProbe
            ? {
                hinweis:
                  `Diese Abfrage lieferte ${result.row_count} Zeilen und gilt daher als ` +
                  'Datenabruf, nicht als Sondierung — sie ist zitierbar und wird abgerechnet. ' +
                  'Sondierungen dürfen höchstens 5 Zeilen liefern (LIMIT 3).',
              }
            : {}),
          ...(result.truncated
            ? {
                note:
                  `Nur die ersten ${result.rows.length} von ${result.row_count} Zeilen. ` +
                  'Filtere enger oder setze ein kleineres LIMIT.',
              }
            : {}),
        },
        rows: result.rows,
        // Sondierungen bleiben aus dem Kaufledger heraus: der Nutzer soll nicht
        // dafuer zahlen, dass der Agent sich orientiert. Massgeblich ist aber
        // effectiveKind -- eine "Sondierung" mit 40 Zeilen ist ein Datenabruf.
        billable: !wasProbe,
      };
    }

    case 'match_forest_origin': {
      // Der Herkunftsnachweis im Datenraum laeuft NICHT ueber eine
      // Property "hatWald", sondern GEOMETRISCH: beim Pflanzvorgang wird eine
      // Flaeche auf der Karte gezeichnet (Stammzertifikat, geosparql:asWKT),
      // und der Einschlag traegt eine Position. Wessen Position in welcher
      // Flaeche liegt, sagt die Punkt-in-Polygon-Pruefung.
      //
      // Beides liegt in getrennten Dokumenten und ist durch keine gemeinsame
      // Id verbunden -- ohne diesen Abgleich bleibt die Waldherkunft
      // unauffindbar, egal wie oft man den Graphen abfragt.
      const lat = typeof call.args.lat === 'number' ? call.args.lat : null;
      const lon = typeof call.args.lon === 'number' ? call.args.lon : null;

      try {
        // BREITER SUCHRAUM -- und warum das hier zulaessig ist.
        //
        // scope.sources enthaelt nur Dokumente, die einen Ident dieser Kette
        // TRAGEN. Ein Stammzertifikat traegt aber den Pflanzungs-EPC (siehe
        // pdf_stammzertifikat.rml.ttl: tc:epc = materialEpc am selben Subjekt
        // wie das Polygon) -- und der steht nicht in relatedEpcs, weil die
        // EPCIS-Kette beim Stamm endet. Das Zertifikat kam also nie in den
        // Suchraum, und die Herkunft war strukturell unauffindbar.
        //
        // Der Produktpass loest das seit je so: PlantingAreaCard sucht ueber
        // ALLE Katalogquellen, weil das Zertifikat in einem fremden Pod liegt
        // (Baumschule statt Saegewerk). Genau dieser Weg wird hier uebernommen.
        //
        // Zwei Schranken halten fremde Zertifikate draussen:
        //
        //   1. ROLLE -- nicht freigegebene Pods werden vorher entfernt.
        //   2. GEOMETRIE -- zurueckgegeben wird ausschliesslich, was eine
        //      Einschlagsposition DIESES Bauteils enthaelt. Ein fremdes
        //      Zertifikat wird geladen, enthaelt den Punkt aber nicht und
        //      erreicht das Modell nie.
        //
        // Die Erweiterung bleibt bewusst IN DIESEM WERKZEUG. scope.sources
        // anzufassen waere der falsche Ort: der Agent formuliert SPARQL frei
        // und koennte mit "SELECT ?s ?p ?o" fremde Pods auslesen -- genau
        // deshalb ist die Ident-Schranke dort scharf (epcScopeService.ts).
        const areas = await plantingAreaSearchSpace(scope);
        if (areas.length === 0) {
          return {
            result: {
              ok: true,
              matches: [],
              note:
                'Es ist kein Stammzertifikat mit gezeichneter Pflanzfläche ' +
                'erreichbar. Die Waldherkunft ist damit geometrisch nicht ' +
                'bestimmbar.',
            },
            billable: false,
          };
        }

        // Weg 1: direkter Bezug ueber tc:epc. Ein Zertifikat, das auf einen
        // Ident dieser Kette zeigt, ist die belastbarere Aussage als eine
        // Punktlage -- deshalb zuerst, genau wie im Produktpass.
        if (lat === null && lon === null) {
          const direct = await plantingAreasByChainEpc(scope);
          if (direct.length > 0) {
            return {
              result: {
                ok: true,
                matches: direct.map((area) => ({
                  position: null,
                  subject: null,
                  certificate: area.certificateIri,
                  certificate_number: area.certificateNumber,
                  species: area.species,
                  maturity_year: area.maturityYear,
                  seed_epc: area.epc,
                  bezug: 'direkt',
                })),
                planting_areas: areas.length,
              },
              billable: true,
            };
          }
        }

        // Weg 2: Punkt in Polygon. Ohne Koordinate die Positionen der
        // Lieferkette selbst suchen.
        const points: Array<{ lat: number; lon: number; subject?: string }> =
          lat !== null && lon !== null
            ? [{ lat, lon }]
            : await harvestPositionsIn(scope);

        if (points.length === 0) {
          return {
            result: {
              ok: true,
              matches: [],
              planting_areas: areas.length,
              note:
                `${areas.length} Pflanzfläche(n) gefunden, aber keine Einschlagsposition ` +
                'in der Lieferkette. Ohne Position lässt sich nicht zuordnen — suche ' +
                'geo:lat/geo:long an den Stamm-Identen und übergib sie hier.',
            },
            billable: false,
          };
        }

        const matches = points.flatMap((point) =>
          areasContaining(point, areas).map((area) => ({
            position: { lat: point.lat, lon: point.lon },
            subject: point.subject ?? null,
            certificate: area.certificateIri,
            ...(area as PlantingAreaResult).certificateNumber !== undefined
              ? {
                  certificate_number: (area as PlantingAreaResult).certificateNumber,
                  species: (area as PlantingAreaResult).species,
                  maturity_year: (area as PlantingAreaResult).maturityYear,
                  seed_epc: (area as PlantingAreaResult).epc,
                }
              : {},
          })),
        );

        return {
          result: {
            ok: true,
            matches,
            planting_areas: areas.length,
            positions_checked: points.length,
            ...(matches.length === 0
              ? {
                  note:
                    'Keine der Einschlagspositionen liegt in einer der hinterlegten ' +
                    'Pflanzflächen. Das Holz stammt dann nicht aus den dokumentierten ' +
                    'Pflanzungen — oder die Fläche wurde nicht erfasst.',
                }
              : {}),
          },
          billable: false,
        };
      } catch (err) {
        return {
          result: {
            ok: false,
            error: `Geoabgleich fehlgeschlagen: ${err instanceof Error ? err.message : 'unbekannt'}`,
            hint: 'Frage die Positionsangaben (geo:lat/geo:long) direkt per run_sparql ab.',
          },
          billable: false,
        };
      }
    }

    case 'get_related_epcs': {
      const requested = asString(call.args.epc) ?? scope.epc;

      // Nicht nach aussen laufen lassen: waere jeder EPC zulaessig, koennte der
      // Agent den Graphen beliebig weit ablaufen und fremde Produkte einsammeln.
      if (!scope.relatedEpcs.has(requested)) {
        return {
          result: {
            ok: false,
            error: `Der EPC ${requested} gehört nicht zu diesem Bauteil.`,
            hint:
              'Zulässig sind nur bereits verknüpfte EPCs: ' +
              `${[...scope.relatedEpcs].join(', ')}`,
          },
          billable: false,
        };
      }

      // Der gescannte EPC ist beim Aufbau des Scopes bereits abgefragt worden --
      // kein zweiter Netzaufruf fuer dieselbe Antwort.
      if (requested === scope.epc) {
        return {
          result: {
            ok: true,
            epc: scope.epc,
            related_epcs: [...scope.relatedEpcs],
            events: summarizeEvents(scope.events),
            events_filtered_out: scope.eventsFilteredOut,
            ...(scope.eventsFilteredOut > 0
              ? {
                  note:
                    `${scope.eventsFilteredOut} Ereignis(se) wurden per Consent gefiltert und ` +
                    'sind für diese Rolle nicht sichtbar.',
                }
              : {}),
          },
          billable: false,
        };
      }

      try {
        const result = await queryEpcisEvents(requested);
        const related = new Set([requested, ...collectEpcs(result.events)]);
        return {
          result: {
            ok: true,
            epc: requested,
            related_epcs: [...related],
            events: summarizeEvents(result.events),
            events_filtered_out: result.filteredOut,
          },
          billable: false,
        };
      } catch (err) {
        return {
          result: {
            ok: false,
            error: `EPCIS-Abfrage fehlgeschlagen: ${err instanceof Error ? err.message : 'unbekannt'}`,
            hint: 'Arbeite mit den bereits bekannten verknüpften EPCs weiter.',
          },
          billable: false,
        };
      }
    }

    default:
      return { result: unknownTool(call.name), billable: false };
  }
}

/**
 * Die Quellen, in denen nach Pflanzflaechen gesucht wird.
 *
 * BREITER als scope.sources -- und nur hier, nicht im Scope selbst.
 *
 * Das Stammzertifikat liegt typischerweise im Pod der Baumschule, nicht in
 * dem des Saegewerks, und traegt den Pflanzungs-EPC statt eines Idents dieser
 * Kette. Die Ident-Schranke des Scopes schliesst es damit aus -- weshalb die
 * Waldherkunft strukturell unauffindbar war. Der Produktpass loest das seit
 * je ueber alle Katalogquellen (PlantingAreaCard); genau das wird hier
 * uebernommen.
 *
 * Der Rollenfilter bleibt scharf: nicht freigegebene Pods fallen weg. Die
 * zweite Schranke ist die Geometrie -- der Aufrufer gibt nur zurueck, was
 * eine Position DIESES Bauteils enthaelt.
 */
async function plantingAreaSources(scope: EpcScope): Promise<string[]> {
  try {
    const products = await getAllProductsAsync();
    const all = new Set<string>([...scope.sources, ...products.flatMap((p) => p.sources)]);
    const { allowed } = await filterSourcesByRole([...all], getCurrentRole());
    return allowed;
  } catch (err) {
    // Katalog nicht erreichbar -> lieber die engen Quellen als gar keine.
    console.warn('[agent] Katalogquellen fuer Pflanzflaechen nicht ermittelbar:', err);
    return scope.sources;
  }
}

/** Alle erreichbaren Pflanzflaechen -- der Suchraum, noch ungefiltert. */
async function plantingAreaSearchSpace(scope: EpcScope): Promise<PlantingAreaResult[]> {
  return queryPlantingAreas(await plantingAreaSources(scope));
}

/**
 * Weg 1: Zertifikate, die per tc:epc direkt auf einen Ident dieser Kette
 * zeigen. Belastbarer als eine Punktlage, deshalb zuerst gefragt -- dieselbe
 * Reihenfolge wie im Produktpass.
 */
async function plantingAreasByChainEpc(scope: EpcScope): Promise<PlantingAreaResult[]> {
  const sources = await plantingAreaSources(scope);
  const seen = new Map<string, PlantingAreaResult>();

  for (const ident of [scope.epc, ...scope.relatedEpcs]) {
    const areas = await queryPlantingAreaByEpc(ident, sources).catch(() => []);
    for (const area of areas) {
      if (!seen.has(area.certificateIri)) seen.set(area.certificateIri, area);
    }
  }
  return [...seen.values()];
}

/**
 * Die Einschlagspositionen der Lieferkette suchen.
 *
 * DER IDENT UND DIE KOORDINATE SITZEN AN VERSCHIEDENEN SUBJEKTEN.
 *
 * Das war der Grund, warum die geometrische Zuordnung nie zustande kam: die
 * Abfrage verlangte beides am selben Subjekt. In den Erntedaten (stanford_hpr)
 * haengt die Position aber an einem EIGENEN Knoten:
 *
 *   tc:Stem  --tc:hasMachinePosition-->  tc:MachinePosition (geo:lat/long)
 *   (tc:sgtin)                           (kein Ident)
 *
 * Der Stamm traegt seinen Ident erst durch die Ident-Injektion des Konverters
 * (ident_injector.py haengt tc:sgtin an tc:Stem/tc:Log); die Koordinate liegt
 * unter .../stem/{StemKey}/coordinates/machine. Beide Seiten sind da, nur nie
 * am selben Knoten -- die alte Abfrage lieferte deshalb konstant null Zeilen,
 * und die Antwort lautete "keine Einschlagsposition vorhanden", obwohl die
 * Daten im Pod lagen.
 *
 * Deshalb ZWEI Wege: die Koordinate direkt am Ident-Subjekt, oder einen
 * Schritt weiter ueber eine beliebige Kante.
 *
 * Bewusst ueber eine BELIEBIGE Kante statt einer Liste bekannter Namen
 * (hasMachinePosition, hasCraneTipPosition, hasLogPosition): eine Namensliste
 * haette genau den Fehler wiederholt, den wir hier beheben -- ein neues
 * Mapping mit anderer Bezeichnung waere wieder still durchgefallen. Die
 * Einschraenkung leistet ohnehin der Knoten selbst: er muss beide Koordinaten
 * tragen. Ein Schritt, nicht mehr -- eine offene Pfadsuche (``+``) waere in
 * Comunica langsam und wuerde ueber die halbe Kette laufen.
 */
async function harvestPositionsIn(
  scope: EpcScope,
): Promise<Array<{ lat: number; lon: number; subject?: string }>> {
  const idents = [...scope.relatedEpcs].map((id) => `<${id}> "${id}"`).join(' ');
  const query = `
PREFIX tc: <${NAMESPACES.tc}>
PREFIX geo: <${NAMESPACES.geo}>
SELECT DISTINCT ?subject ?lat ?long WHERE {
  VALUES ?ident { ${idents} }
  { ?traeger tc:epc ?ident } UNION { ?traeger tc:sgtin ?ident } UNION
  { ?traeger tc:lgtin ?ident }
  {
    # Koordinate am Ident-Subjekt selbst
    BIND(?traeger AS ?subject)
    ?subject geo:lat ?lat ; geo:long ?long .
  } UNION {
    # ... oder einen Schritt weiter (tc:hasMachinePosition,
    # tc:hasCraneTipPosition, tc:hasLogPosition, ...)
    ?traeger ?kante ?subject .
    ?subject geo:lat ?lat ; geo:long ?long .
  }
}
LIMIT 50`.trim();

  const rows = await executeQuery(query, scope.sources);
  const points: Array<{ lat: number; lon: number; subject?: string }> = [];
  for (const row of rows) {
    const lat = Number(row.lat?.value);
    const lon = Number(row.long?.value);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      points.push({ lat, lon, subject: row.subject?.value });
    }
  }
  return points;
}

/** Events auf das reduzieren, was fuer die Beantwortung zaehlt. */
function summarizeEvents(events: Array<Record<string, unknown>>) {
  return events.slice(0, 25).map((ev) => ({
    type: ev.type ?? null,
    eventTime: ev.eventTime ?? null,
    bizStep: ev.bizStep ?? null,
    epcs: [
      ...((ev.epcList as string[] | undefined) ?? []),
      ...(((ev.quantityList as Array<{ epcClass?: string }> | undefined) ?? [])
        .map((q) => q.epcClass)
        .filter(Boolean) as string[]),
    ],
  }));
}
