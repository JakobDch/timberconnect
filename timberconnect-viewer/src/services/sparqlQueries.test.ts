import { describe, it, expect } from 'vitest';
import { Parser } from 'sparqljs';
import {
  identGuard,
  createCertificateDataQuery,
  createTransportOrdersQuery,
  createDeclarationQuery,
  createDeconstructionQuery,
  createDocumentationQuery,
  createLiabilityQuery,
  createLcaQuery,
  createDbppQuery,
} from './sparqlQueries';

const PLATTE = 'urn:epc:id:sgtin:404711145.0401.P1';
const LAMELLE = 'urn:epc:id:sgtin:404711145.0212.L1';

describe('Ident-Schranke der Dokumentabfragen', () => {
  it('bindet die Idente der Kette als Werteliste ein', () => {
    const guard = identGuard([PLATTE, LAMELLE]);
    expect(guard).toContain(`<${PLATTE}>`);
    expect(guard).toContain(`<${LAMELLE}>`);
    expect(guard).toContain('?epc IN (');
  });

  it('laesst Dokumente ohne tc:epc durch', () => {
    // Eine Datei, die ihren Materialbezug nicht angibt, gehoert zur einzigen
    // Quelle, die sie liefert -- sie herauszufiltern wuerde Awf leeren.
    expect(identGuard([PLATTE])).toContain('!BOUND(?epc)');
  });

  it('entfaellt ohne bekannte Kette', () => {
    // Kein Filter statt eines Filters ohne Werte: "?epc IN ()" wuerde jede
    // Zeile verwerfen und die Ansicht leeren, statt sie nur unscharf zu lassen.
    expect(identGuard([])).toBe('');
  });

  it('beachtet den uebergebenen Variablennamen', () => {
    // Die UNION-Abfragen haben je Sparte eine eigene EPC-Variable.
    const guard = identGuard([PLATTE], '?dopEpc');
    expect(guard).toContain('?dopEpc IN (');
    expect(guard).toContain('!BOUND(?dopEpc)');
  });
});

describe('Zertifikatsabfrage (der Fall, der den Bug zeigte)', () => {
  it('filtert auf die Idente des Bauteils', () => {
    const query = createCertificateDataQuery([PLATTE, LAMELLE]);
    expect(query).toContain('?epc IN (');
    expect(query).toContain(`<${PLATTE}>`);
  });

  it('bleibt ohne Idente ungefiltert — abwaertskompatibel', () => {
    // Der Trace-Id-Pfad kennt keine EPC-Kette. Dort bleibt es beim alten
    // Verhalten, statt die Ansicht zu leeren.
    const query = createCertificateDataQuery();
    expect(query).not.toContain('FILTER');
    expect(query).toContain('?doc a tc:Certificate');
  });

  it('erzeugt syntaktisch geschlossene Klammern', () => {
    const query = createCertificateDataQuery([PLATTE]);
    const open = (query.match(/\(/g) ?? []).length;
    const close = (query.match(/\)/g) ?? []).length;
    expect(open).toBe(close);
  });

  it('trennt mehrere Idente mit Komma — SPARQL verlangt das', () => {
    // Ohne Komma ("IN (<a> <b>)") ist die Abfrage ungueltig. Der Fehler
    // greift erst ab ZWEI Identen und blieb deshalb lange unbemerkt: mit
    // einem Ident und mit leerer Liste ist die Ausgabe zufaellig gueltig.
    const guard = identGuard([PLATTE, LAMELLE]);
    expect(guard).toContain(`<${PLATTE}>, <${LAMELLE}>`);
  });
});

// ---------------------------------------------------------------------------
// Echte Syntaxpruefung
// ---------------------------------------------------------------------------

/**
 * Klammern zaehlen reicht nicht -- der Komma-Fehler in der IN-Liste war
 * klammerbalanciert und trotzdem ungueltig. Hier parst ein echter
 * SPARQL-Parser, derselbe, den Comunica verwendet.
 */
const AWF_QUERIES: Array<[string, (epcs: string[]) => string]> = [
  ['Transportauftraege', createTransportOrdersQuery],
  ['Zertifikate', createCertificateDataQuery],
  ['Leistungserklaerungen', createDeclarationQuery],
  ['Rueckbaubarkeit', createDeconstructionQuery],
  ['Dokumentation', createDocumentationQuery],
  ['Haftung', createLiabilityQuery],
  ['CO2-Bilanz', createLcaQuery],
  ['DBPP', createDbppQuery],
];

describe.each(AWF_QUERIES)('%s — gueltiges SPARQL', (_name, build) => {
  const parser = new Parser();

  it('ohne Idente (Trace-Id-Pfad)', () => {
    expect(() => parser.parse(build([]))).not.toThrow();
  });

  it('mit einem Ident', () => {
    expect(() => parser.parse(build([PLATTE]))).not.toThrow();
  });

  it('mit mehreren Identen — die Form, die im Betrieb auftritt', () => {
    expect(() => parser.parse(build([PLATTE, LAMELLE]))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Abdeckung: KEINE Sparte ohne Schranke
// ---------------------------------------------------------------------------

/**
 * Der eigentliche Schutz vor Datenleaks.
 *
 * Die Syntaxpruefung oben sagt nur, dass die Abfrage laeuft -- nicht, dass
 * sie filtert. Eine neue UNION-Sparte ohne Schranke waere syntaktisch
 * einwandfrei und wuerde still fremde Bauteile mitliefern. Genau so ist der
 * urspruengliche Fehler entstanden.
 *
 * Deshalb wird hier jede Sparte gezaehlt: fuer jedes ``?x a tc:Klasse`` muss
 * im selben Block ein FILTER stehen. Schlaegt der Test fehl, fehlt einer
 * neuen Sparte die Schranke -- oder ihre Klasse traegt keinen Ident und
 * braucht eine Kante (siehe relatedIdentGuard).
 */
function unguardedBranches(query: string): string[] {
  const open: string[] = [];
  let branchClass: string | null = null;
  let guarded = false;
  let depth = 0;

  for (const line of query.split('\n')) {
    const cls = /^\s*\?\w+ a ((?:tc|vlex|eldat):\w+)\s*\.?/.exec(line);
    if (cls) {
      branchClass = cls[1];
      guarded = false;
      depth = 0;
    }
    if (branchClass) {
      if (/FILTER/.test(line)) guarded = true;
      depth += (line.match(/\{/g) ?? []).length;
      depth -= (line.match(/\}/g) ?? []).length;
      // Sparte zu Ende (schliessende Klammer auf Blockebene)
      if (depth < 0) {
        if (!guarded) open.push(branchClass);
        branchClass = null;
      }
    }
  }
  if (branchClass && !guarded) open.push(branchClass);
  return open;
}

describe.each(AWF_QUERIES)('%s — jede Sparte gefiltert', (_name, build) => {
  it('laesst keine Einstiegsklasse ohne Schranke', () => {
    expect(unguardedBranches(build([PLATTE, LAMELLE]))).toEqual([]);
  });
});

describe('Der Abdeckungspruefer selbst', () => {
  // Ein Pruefer, der nie anschlaegt, ist wertlos -- diese beiden Faelle
  // zeigen, dass er eine fehlende Schranke wirklich findet.
  it('meldet eine Sparte ohne FILTER', () => {
    const query = `
SELECT ?x WHERE {
  {
    ?panel a tc:Panel .
    OPTIONAL { ?panel tc:name ?n }
  }
}`;
    expect(unguardedBranches(query)).toEqual(['tc:Panel']);
  });

  it('meldet nur die ungeschuetzte von zwei Sparten', () => {
    const query = `
SELECT ?x WHERE {
  {
    ?panel a tc:Panel .
    FILTER (?e IN (<a>))
  }
  UNION
  {
    ?order a tc:TransportOrder .
    OPTIONAL { ?order tc:name ?n }
  }
}`;
    expect(unguardedBranches(query)).toEqual(['tc:TransportOrder']);
  });
});
