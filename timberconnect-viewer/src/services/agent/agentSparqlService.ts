/**
 * SPARQL fuer den Assistenten -- mit Leitplanken.
 *
 * Unterschied zu executeQuery (sparqlService): dort schreibt der Code die
 * Abfragen, hier schreibt sie ein Sprachmodell. Alles, worauf man sich bei
 * eigenem Code verlaesst, muss hier geprueft werden.
 *
 * Zwei Schichten sichern die Herkunft, und sie schliessen UNTERSCHIEDLICHE
 * Luecken -- keine ersetzt die andere:
 *
 *   1. QUELLEN (strukturell). ``sources`` kommt immer aus dem Scope; es gibt
 *      keinen Tool-Parameter dafuer. FROM / FROM NAMED / SERVICE werden
 *      abgewiesen, denn das sind die einzigen SPARQL-Konstrukte, die einen
 *      Graph AUSSERHALB der uebergebenen Quellen benennen koennen (SERVICE
 *      koennte sogar an einen beliebigen Endpunkt im Netz gehen).
 *
 *   2. EPC-BEZUG (Rueckmeldung). Comunica bekommt die Quellen als Parameter,
 *      nicht ueber FROM -- eine Abfrage wie "SELECT ?s ?p ?o WHERE {?s ?p ?o}"
 *      enthaelt also keinen EPC und liefert trotzdem ALLES aus jeder Quelle.
 *      Deshalb muss die Abfrage sich nachweislich auf einen EPC dieses
 *      Bauteils beziehen. Tut sie es nicht, wird NICHT ausgefuehrt, sondern
 *      ein lehrender Fehler zurueckgegeben.
 *
 * Fehler werden grundsaetzlich ZURUECKGEGEBEN, nicht geworfen: ein geworfener
 * Fehler beendet die Agentenschleife, ein zurueckgegebener bringt dem Modell
 * bei, was es falsch gemacht hat.
 */

import { executeQuery, type SparqlBinding } from '../sparqlService';
import type { EpcScope } from './epcScopeService';

/** Hoechstzahl Zeilen, die an das Modell zurueckgehen. */
export const MAX_ROWS = 50;
/** Automatisches LIMIT, wenn die Abfrage keines mitbringt. */
export const DEFAULT_LIMIT = 200;
/** Abbruch, damit eine teure Abfrage die Schleife nicht blockiert. */
export const QUERY_TIMEOUT_MS = 30_000;

export type QueryPurpose = 'probe' | 'data';

/**
 * Wie viele Zeilen eine Sondierung hoechstens liefern darf.
 *
 * Die Zahl ist die Grenze zwischen "ich schaue nach, WAS es gibt" und "ich
 * hole mir die Daten". Ohne sie ist die Unterscheidung wertlos: das Modell
 * darf ``kind`` selbst setzen, ``probe`` kostet nichts und entbindet von der
 * Ident-Pflicht -- also deklariert es alles als Sondierung. Genau das ist
 * passiert: eine ganze Antwort entstand aus lauter "Sondierungen", der
 * Kaufledger blieb leer und es wurde nichts abgerechnet.
 *
 * Deshalb entscheidet jetzt das ERGEBNIS, nicht die Behauptung: was mehr als
 * eine Handvoll Zeilen zurueckbringt, ist ein Datenabruf.
 */
export const MAX_PROBE_ROWS = 5;

export interface RunQueryOptions {
  /**
   * ``probe`` = Sondierung der Datenlage, um ueberhaupt eine sinnvolle Abfrage
   * bauen zu koennen. Nur dafuer entfaellt die Ident-Pflicht.
   *
   * ACHTUNG: das ist ein Wunsch, keine Zusicherung. Liefert die Abfrage mehr
   * als MAX_PROBE_ROWS Zeilen, wird sie als Datenabruf gewertet -- siehe
   * ``effectiveKind`` im Ergebnis.
   */
  kind?: QueryPurpose;
}

export type QueryResult =
  | {
      ok: true;
      rows: SparqlBinding[];
      row_count: number;
      truncated: boolean;
      variables: string[];
      sources_used: number;
      /**
       * Wie die Abfrage TATSAECHLICH gewertet wurde -- unabhaengig davon, was
       * das Modell als ``kind`` behauptet hat. Daran haengt die Abrechnung.
       */
      effectiveKind: QueryPurpose;
    }
  | { ok: false; error: string; hint: string };

// ---------------------------------------------------------------------------
// Statische Pruefungen
// ---------------------------------------------------------------------------

/**
 * Kommentare und Zeichenketten entfernen, bevor nach Schluesselwoertern
 * gesucht wird. Ohne das koennte ein "# FROM" im Kommentar oder ein Literal
 * "SERVICE" eine harmlose Abfrage blockieren -- und umgekehrt liesse sich ein
 * echtes Schluesselwort hinter einem Literal verstecken.
 *
 * Reihenfolge ist hier tragend. IRIs muessen VOR den Kommentaren neutralisiert
 * werden, denn '#' ist in praktisch jedem Ontologie-IRI das Trennzeichen
 * (<...ontology#>). Wer zuerst Kommentare entfernt, schneidet mitten im IRI ab,
 * zerstoert damit den PREFIX-Abschluss -- und der Prolog-Ausdruck frisst
 * anschliessend die gesamte Abfrage samt SELECT.
 */
function stripLiteralsAndComments(query: string): string {
  return query
    .replace(/<[^<>\s]*>/g, '<>')
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/'''[\s\S]*?'''/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/#[^\n]*/g, ' ');
}

/** Schreibende bzw. graph-verlassende Konstrukte. */
const FORBIDDEN: Array<{ pattern: RegExp; label: string; hint: string }> = [
  {
    pattern: /\b(INSERT|DELETE|DROP|CLEAR|LOAD|CREATE|ADD|MOVE|COPY)\b/i,
    label: 'schreibendes Schlüsselwort',
    hint: 'Der Assistent darf ausschließlich lesen. Verwende SELECT oder ASK.',
  },
  {
    pattern: /\bSERVICE\b/i,
    label: 'SERVICE',
    hint:
      'SERVICE würde eine fremde Datenquelle ansprechen. Die Quellen dieses ' +
      'Bauteils werden automatisch gesetzt — frage einfach ohne SERVICE.',
  },
  {
    // Ohne IRI-Erwartung: stripLiteralsAndComments hat IRIs bereits zu <>
    // eingedampft, ein Muster mit <...> wuerde hier nie mehr greifen.
    pattern: /\bFROM\b/i,
    label: 'FROM',
    hint:
      'FROM würde einen Graph außerhalb der freigegebenen Quellen benennen. ' +
      'Die Quellen werden automatisch gesetzt — lass die FROM-Klausel weg.',
  },
];

/** Nur SELECT und ASK; alles andere ist entweder schreibend oder unbrauchbar. */
function queryForm(stripped: string): 'SELECT' | 'ASK' | null {
  // Prologe (PREFIX/BASE) ueberspringen und die erste Klausel bestimmen.
  const withoutProlog = stripped
    .replace(/\bPREFIX\s+[^\s:]*:\s*<[^>]*>/gi, ' ')
    .replace(/\bBASE\s+<[^>]*>/gi, ' ');
  const match = /\b(SELECT|ASK|CONSTRUCT|DESCRIBE)\b/i.exec(withoutProlog);
  if (!match) return null;
  const form = match[1].toUpperCase();
  return form === 'SELECT' || form === 'ASK' ? form : null;
}

/**
 * Bezieht sich die Abfrage auf einen EPC dieses Bauteils?
 *
 * Geprueft wird gegen die ROHE Abfrage (nicht die entkernte): der EPC darf als
 * IRI <urn:epc:...> ODER als Literal "urn:epc:..." vorkommen -- beides sind
 * legitime Schreibweisen, und die Entkernung wuerde das Literal wegwerfen.
 * Gross-/Kleinschreibung wird ignoriert, weil GS1-Idente in beiden Formen
 * durch die Quellen laufen.
 */
function referencedEpcs(query: string, scope: EpcScope): string[] {
  const haystack = query.toLowerCase();
  return [...scope.relatedEpcs].filter((epc) => haystack.includes(epc.toLowerCase()));
}

/** LIMIT nachruesten, damit eine offene Abfrage nicht den halben Pod zieht. */
function withLimit(query: string, stripped: string): string {
  return /\bLIMIT\s+\d+/i.test(stripped) ? query : `${query.trimEnd()}\nLIMIT ${DEFAULT_LIMIT}`;
}

// ---------------------------------------------------------------------------
// Ausfuehrung
// ---------------------------------------------------------------------------

/**
 * Eine vom Modell formulierte Abfrage pruefen und -- wenn sie besteht --
 * gegen die Quellen des Scopes ausfuehren.
 */
export async function runScopedQuery(
  query: string,
  scope: EpcScope,
  options: RunQueryOptions = {},
): Promise<QueryResult> {
  const kind = options.kind ?? 'data';

  if (!query || !query.trim()) {
    return { ok: false, error: 'Leere Abfrage.', hint: 'Formuliere eine SELECT- oder ASK-Abfrage.' };
  }

  const stripped = stripLiteralsAndComments(query);

  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(stripped)) {
      return {
        ok: false,
        error: `Nicht erlaubt: ${rule.label}.`,
        hint: rule.hint,
      };
    }
  }

  const form = queryForm(stripped);
  if (!form) {
    return {
      ok: false,
      error: 'Nur SELECT- und ASK-Abfragen sind zulässig.',
      hint: 'CONSTRUCT und DESCRIBE werden nicht unterstützt. Formuliere die Frage als SELECT.',
    };
  }

  // Schicht 2: Identbezug. Bei Sondierungen bewusst ausgesetzt, sonst koennte
  // das Modell die Datenlage nie erkunden.
  //
  // "Ident" statt "EPC", weil beide Welten vorkommen: ein GS1-EPC
  // (urn:epc:id:sgtin:...) haengt an tc:epc/tc:sgtin/tc:lgtin, eine Trace-Id
  // (TC-2024-001) dagegen an tc:traceId. Der Hinweis muss den passenden Weg
  // nennen -- ein auf EPCs gemuenzter Text schickt das Modell bei einer
  // Trace-Id in die falsche Richtung.
  if (kind !== 'probe') {
    const hits = referencedEpcs(query, scope);
    if (hits.length === 0) {
      const idents = [...scope.relatedEpcs];
      const gs1 = idents.filter((id) => /^urn:epc:/i.test(id));
      const hint = gs1.length
        ? 'Binde einen der folgenden Idente ein, z.B. über ?subject tc:epc <IDENT>. ' +
          'WICHTIG: tc:sgtin und tc:lgtin sind Unter-Properties von tc:epc, aber die ' +
          'Endpunkte werten diese Hierarchie NICHT aus (kein Reasoner) — frage alle drei ' +
          'per UNION ab, sonst fehlen z.B. die Messwerte einzelner Stämme. '
        : 'Binde den folgenden Ident ein. Es ist eine Trace-Id, kein GS1-EPC — ' +
          'sie hängt an tc:traceId, z.B. ?subject tc:traceId "IDENT". ';
      return {
        ok: false,
        error:
          'Die Abfrage nimmt auf keinen der zu diesem Bauteil gehörenden Idente Bezug ' +
          'und wurde deshalb nicht ausgeführt.',
        hint: `${hint}Verfügbare Idente: ${idents.join(', ')}`,
      };
    }
  }

  if (scope.sources.length === 0) {
    return {
      ok: false,
      error: 'Zu diesem Bauteil ist keine Datenquelle erreichbar.',
      hint: 'Ohne erreichbare Quellen lässt sich die Frage nicht aus den Daten beantworten.',
    };
  }

  const finalQuery = withLimit(query, stripped);

  let rows: SparqlBinding[];
  try {
    rows = await withTimeout(executeQuery(finalQuery, scope.sources), QUERY_TIMEOUT_MS);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
    return {
      ok: false,
      error: `Abfrage fehlgeschlagen: ${message}`,
      hint:
        'Prüfe Syntax und Prefixe. Bei Zeitüberschreitung: enger filtern, ' +
        'weniger OPTIONAL-Blöcke, kleineres LIMIT.',
    };
  }

  const truncated = rows.length > MAX_ROWS;
  const capped = truncated ? rows.slice(0, MAX_ROWS) : rows;
  const variables = [...new Set(capped.flatMap((row) => Object.keys(row)))];

  // Eine Sondierung, die reichlich Zeilen zurueckbringt, IST ein Datenabruf --
  // egal wie sie deklariert war. Nur so ist die Unterscheidung belastbar:
  // sonst deklariert das Modell alles als Sondierung, weil das billiger ist
  // und von der Ident-Pflicht entbindet.
  const effectiveKind: QueryPurpose =
    kind === 'probe' && rows.length <= MAX_PROBE_ROWS ? 'probe' : 'data';

  return {
    ok: true,
    rows: capped,
    row_count: rows.length,
    truncated,
    variables,
    sources_used: scope.sources.length,
    effectiveKind,
  };
}

/** Comunica kennt kein eigenes Zeitlimit -- also eines darumlegen. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Zeitüberschreitung nach ${ms / 1000}s`)), ms),
    ),
  ]);
}
