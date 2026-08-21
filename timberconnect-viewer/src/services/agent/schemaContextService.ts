/**
 * Das Datenmodell fuer den Assistenten -- angereichert mit deutschen Labels.
 *
 * Der Agent muss wissen, welche Klassen und Eigenschaften es gibt, bevor er
 * eine SPARQL-Abfrage schreiben kann. Die semantischen Modelle liegen bereits
 * im Katalog: der Konverter erzeugt sie aus jedem RML-Mapping und veroeffentlicht
 * sie als ``dct:conformsTo`` (access_url_semantic_model). Sie haben die flache
 * Form
 *
 *     vlex:BSPPanel vlex:artikel xsd:string ;
 *         tc:hasForestSource tc:ForestSource .
 *
 * also "Klasse Praedikat Wertebereich" -- keine OWL-Axiome, kein Reasoning.
 *
 * BEWUSST KEIN EMBEDDING-INDEX. Alle Modelle zusammen sind rund 7.000 Token und
 * passen vollstaendig in einen Prompt. Ein Vektorindex ueber ~48 Klassenbloecke
 * waere mehr Infrastruktur bei schlechterer Trefferquote -- und DeepSeek bietet
 * ohnehin keine Embeddings an.
 *
 * Was die Suche stattdessen traegt, sind die LABELS: die Ontologie v6 beschriftet
 * praktisch jede Klasse und Eigenschaft auf Deutsch (829 rdfs:label@de). Ohne sie
 * ist ``vlex:decklageBspSeite1`` undurchsichtig, mit "Decklage BSP Seite 1" nicht
 * mehr. Nutzer fragen deutsch -- also muss das Modell deutsch nachschlagen koennen.
 */

import { Parser, type Quad } from 'n3';
import { getAuthFetch } from '../authFetch';
import { fetchCatalogDatasets } from '../catalogService';
import { NAMESPACES } from '../../config/solidPods';
import type { EpcScope } from './epcScopeService';

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';

/** Wo die Ontologie liegt -- als statisches Asset des Viewers ausgeliefert. */
const ONTOLOGY_URL = `${import.meta.env.BASE_URL}ontology/timberconnect_ontology_v6.ttl`;

export interface TermAnnotation {
  labelDe: string | null;
  labelEn: string | null;
  comment: string | null;
}

export interface SchemaProperty {
  /** Kurzform, z.B. "tc:hasForestSource". */
  name: string;
  /** Wertebereich als Kurzform, z.B. "xsd:string" oder "tc:ForestSource". */
  range: string;
  /** True, wenn der Wertebereich eine Klasse ist (kein xsd:-Datentyp). */
  isObjectProperty: boolean;
  annotation: TermAnnotation;
}

export interface SchemaClass {
  name: string;
  properties: SchemaProperty[];
  /** Klassen, die von hier aus ueber Object-Properties erreichbar sind. */
  connectsTo: string[];
  /** Aus welchem semantischen Modell die Klasse stammt (Herkunftsangabe). */
  sourceModel: string;
  annotation: TermAnnotation;
}

export interface SchemaPack {
  classes: SchemaClass[];
  /** Fertig formatierter Block fuer den Systemprompt. */
  prompt: string;
  /** PREFIX-Zeilen, die zu jeder Abfrage gehoeren. */
  prefixes: string;
  /** Hinweise fuer die Oberflaeche (z.B. nicht ladbare Modelle). */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Kurzformen
// ---------------------------------------------------------------------------

const PREFIX_ENTRIES = Object.entries(NAMESPACES) as Array<[string, string]>;

/** IRI -> "prefix:local", sofern ein bekannter Namensraum passt. */
export function toCurie(iri: string): string {
  for (const [prefix, ns] of PREFIX_ENTRIES) {
    if (iri.startsWith(ns)) return `${prefix}:${iri.slice(ns.length)}`;
  }
  return iri;
}

/** PREFIX-Block, wie ihn jede Abfrage braucht. */
export const PREFIX_BLOCK = PREFIX_ENTRIES.map(
  ([prefix, ns]) => `PREFIX ${prefix}: <${ns}>`,
).join('\n');

// ---------------------------------------------------------------------------
// Ontologie-Labels
// ---------------------------------------------------------------------------

let annotationCache: Map<string, TermAnnotation> | null = null;
let annotationInflight: Promise<Map<string, TermAnnotation>> | null = null;

/**
 * Labels und Kommentare aus der Ontologie.
 *
 * Faellt bei einem Fehler auf eine leere Map zurueck statt zu werfen: ohne
 * Labels ist das Schema aermer, aber immer noch benutzbar. Ein toter Assistent
 * waere die schlechtere Antwort auf eine nicht erreichbare Datei.
 */
export async function loadAnnotations(): Promise<Map<string, TermAnnotation>> {
  if (annotationCache) return annotationCache;
  if (annotationInflight) return annotationInflight;

  annotationInflight = (async () => {
    const map = new Map<string, TermAnnotation>();
    try {
      const response = await fetch(ONTOLOGY_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const ttl = await response.text();
      const quads: Quad[] = new Parser().parse(ttl);

      for (const quad of quads) {
        const predicate = quad.predicate.value;
        if (predicate !== RDFS_LABEL && predicate !== RDFS_COMMENT) continue;
        if (quad.object.termType !== 'Literal') continue;

        const key = toCurie(quad.subject.value);
        const entry = map.get(key) ?? { labelDe: null, labelEn: null, comment: null };
        const lang = (quad.object.language || '').toLowerCase();

        if (predicate === RDFS_LABEL) {
          // Sprachloses Label als Deutsch werten -- besser als es zu verwerfen.
          if (lang === 'de' || lang === '') entry.labelDe ??= quad.object.value;
          else if (lang === 'en') entry.labelEn ??= quad.object.value;
        } else if (lang === 'de' || lang === '') {
          entry.comment ??= quad.object.value;
        }
        map.set(key, entry);
      }
    } catch (err) {
      console.warn('[agent] Ontologie-Labels nicht ladbar:', err);
    }
    annotationCache = map;
    annotationInflight = null;
    return map;
  })();

  return annotationInflight;
}

const EMPTY_ANNOTATION: TermAnnotation = { labelDe: null, labelEn: null, comment: null };

// ---------------------------------------------------------------------------
// Semantische Modelle einlesen
// ---------------------------------------------------------------------------

/**
 * Ein semantisches Modell in Klassen zerlegen.
 *
 * Die Modelle sind absichtlich flach: Subjekt = Klasse, Praedikat =
 * Eigenschaft, Objekt = Wertebereich. Genau so wird hier gelesen -- ohne
 * Annahmen ueber OWL.
 */
export function parseSemanticModel(
  ttl: string,
  sourceModel: string,
  annotations: Map<string, TermAnnotation>,
): SchemaClass[] {
  let quads: Quad[];
  try {
    quads = new Parser().parse(ttl);
  } catch (err) {
    console.warn(`[agent] Semantisches Modell ${sourceModel} nicht lesbar:`, err);
    return [];
  }

  const byClass = new Map<string, SchemaClass>();
  for (const quad of quads) {
    if (quad.object.termType === 'Literal') continue;

    const className = toCurie(quad.subject.value);
    const name = toCurie(quad.predicate.value);
    const range = toCurie(quad.object.value);
    // Alles ausser xsd: zeigt auf eine andere Klasse -- das macht aus der
    // Liste einen Graphen, ueber den der Agent joinen kann.
    const isObjectProperty = !range.startsWith('xsd:');

    const entry =
      byClass.get(className) ??
      ({
        name: className,
        properties: [],
        connectsTo: [],
        sourceModel,
        annotation: annotations.get(className) ?? EMPTY_ANNOTATION,
      } satisfies SchemaClass);

    if (!entry.properties.some((p) => p.name === name && p.range === range)) {
      entry.properties.push({
        name,
        range,
        isObjectProperty,
        annotation: annotations.get(name) ?? EMPTY_ANNOTATION,
      });
      if (isObjectProperty && !entry.connectsTo.includes(range)) {
        entry.connectsTo.push(range);
      }
    }
    byClass.set(className, entry);
  }

  // Datatype- vor Object-Properties, wie in den Modellen selbst -- das liest
  // sich als "erst die Werte, dann die Verbindungen".
  for (const entry of byClass.values()) {
    entry.properties.sort((a, b) =>
      a.isObjectProperty === b.isObjectProperty
        ? a.name.localeCompare(b.name)
        : Number(a.isObjectProperty) - Number(b.isObjectProperty),
    );
  }

  return [...byClass.values()];
}

// ---------------------------------------------------------------------------
// Darstellung fuer den Prompt
// ---------------------------------------------------------------------------

/** Ein Term mit Label als Kommentar, sofern eines vorliegt. */
function annotate(term: string, annotation: TermAnnotation, pad = 0): string {
  const label = annotation.labelDe ?? annotation.labelEn;
  if (!label) return term;
  return `${term.padEnd(pad)}  # ${label}`;
}

/** Klassenblock in der Form, in der auch die Modelle geschrieben sind. */
export function renderClass(schemaClass: SchemaClass): string {
  const head = annotate(schemaClass.name, schemaClass.annotation);
  if (schemaClass.properties.length === 0) return head;

  const width = Math.max(
    ...schemaClass.properties.map((p) => `    ${p.name} ${p.range}`.length),
  );
  const lines = schemaClass.properties.map((p) => {
    const body = `    ${p.name} ${p.range}`;
    return annotate(body, p.annotation, width);
  });
  return `${head}\n${lines.join(' ;\n')} .`;
}

/**
 * Der Schema-Block fuer den Systemprompt.
 *
 * Vollstaendig statt gefiltert: das Modell soll gar nicht erst raten muessen,
 * ob es eine Eigenschaft gibt. Erfundene Prefixe sind der haeufigste Fehler
 * solcher Agenten, und ein vollstaendiges Schema im Kontext macht sie nahezu
 * unmoeglich.
 */
export function renderSchemaPrompt(classes: SchemaClass[]): string {
  const byModel = new Map<string, SchemaClass[]>();
  for (const c of classes) {
    const list = byModel.get(c.sourceModel) ?? [];
    list.push(c);
    byModel.set(c.sourceModel, list);
  }

  const sections = [...byModel.entries()].map(([model, list]) => {
    const body = list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(renderClass)
      .join('\n\n');
    return `## ${model}\n\n${body}`;
  });

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Zusammenbau
// ---------------------------------------------------------------------------

const packCache = new Map<string, SchemaPack>();

/**
 * Das Datenmodell zu einem Scope laden.
 *
 * Es werden nur die Modelle der Datensaetze geladen, deren Daten im Scope
 * ueberhaupt abfragbar sind -- der Agent soll nicht das Schema von Daten
 * sehen, die er gar nicht lesen darf.
 */
export async function loadSchemaPack(scope: EpcScope): Promise<SchemaPack> {
  const cacheKey = [...scope.sources].sort().join('|');
  const cached = packCache.get(cacheKey);
  if (cached) return cached;

  const notes: string[] = [];
  const annotations = await loadAnnotations();

  let modelUrls: string[] = [];
  try {
    const datasets = await fetchCatalogDatasets();
    const inScope = new Set(scope.sources);
    const urls = new Set<string>();
    for (const dataset of datasets) {
      const modelUrl = dataset.access_url_semantic_model;
      if (!modelUrl) continue;
      // Ohne Datensatz-URL laesst sich der Bezug nicht pruefen -- dann lieber
      // mitnehmen: ein fehlendes Schema kostet Antwortqualitaet, ein
      // ueberzaehliges Schema kostet nur Kontext (die Daten bleiben gesperrt).
      if (!dataset.access_url_dataset || inScope.has(dataset.access_url_dataset)) {
        urls.add(modelUrl);
      }
    }
    modelUrls = [...urls];
  } catch (err) {
    notes.push(
      `Datenmodelle nicht ermittelbar: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
    );
  }

  const authFetch = getAuthFetch();
  const classes: SchemaClass[] = [];
  const seen = new Set<string>();

  await Promise.all(
    modelUrls.map(async (url) => {
      try {
        const response = await authFetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const ttl = await response.text();
        const name = url.split('/').filter(Boolean).pop() ?? url;
        for (const schemaClass of parseSemanticModel(ttl, name, annotations)) {
          // Dasselbe Mapping erscheint in mehreren Datensaetzen -- Klassen
          // duerfen sich im Prompt nicht wiederholen.
          const key = `${schemaClass.sourceModel}#${schemaClass.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          classes.push(schemaClass);
        }
      } catch (err) {
        console.warn(`[agent] Datenmodell ${url} nicht ladbar:`, err);
      }
    }),
  );

  if (classes.length === 0) {
    notes.push('Kein Datenmodell verfügbar — der Assistent kennt die Struktur der Daten nicht.');
  }

  const pack: SchemaPack = {
    classes,
    prompt: renderSchemaPrompt(classes),
    prefixes: PREFIX_BLOCK,
    notes,
  };
  packCache.set(cacheKey, pack);
  return pack;
}

/** Nur fuer Tests. */
export function resetSchemaCache(): void {
  packCache.clear();
  annotationCache = null;
  annotationInflight = null;
}
