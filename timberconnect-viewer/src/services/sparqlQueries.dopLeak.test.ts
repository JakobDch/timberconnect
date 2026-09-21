import { describe, it, expect } from 'vitest';
import { QueryEngine } from '@comunica/query-sparql';
import { Store, Parser as N3Parser } from 'n3';
import { createBspWerkQuery, createSawmillQuery } from './sparqlQueries';

/**
 * Die beiden Leistungserklaerungen tragen dieselbe Klasse -- und jede darf
 * nur in IHRER Sparte auftauchen (Befund 18.09.2026, Umfang "Vorangegangene
 * Kette" fuer eine Lamelle: das Saegewerk stand als Holzwerkstoffproduzent
 * in der Kette).
 *
 *   Saegewerks-DoP: Ident am tc:SawingProcess, verlinkt per hasSawingProcess.
 *   BSP-DoP:        Ident direkt am Dokument.
 */
describe('Leistungserklaerungen bleiben in ihrer Sparte', { timeout: 120_000 }, () => {
  const tc = 'http://timberconnect.2050.de/ontology#';

  const LAMELLE = 'urn:epc:id:sgtin:404711148.0301.L1';
  const STAMM = 'urn:epc:id:sgtin:404711148.0201.S1';
  const PLATTE = 'urn:epc:id:sgtin:404711148.0401.P1';

  const TTL = `
@prefix tc: <${tc}> .

<urn:dop:saege> a tc:DeclarationOfPerformance ;
  tc:manufacturer "EGGER Sägewerk Brilon GmbH" ;
  tc:manufacturerAddress "Im Kissen 19" ;
  tc:hasSawingProcess <urn:dop:saege/sp/1> .
<urn:dop:saege/sp/1> a tc:SawingProcess ;
  tc:materialInputEpc <${STAMM}> ;
  tc:epc <${LAMELLE}> .

<urn:dop:bsp> a tc:DeclarationOfPerformance ;
  tc:manufacturer "Poppensieker & Derix GmbH & Co.KG" ;
  tc:epc <${PLATTE}> .
`;

  const engine = new QueryEngine();
  const store = new Store();
  store.addQuads(new N3Parser().parse(TTL));

  async function frage(query: string) {
    const res = await engine.queryBindings(query, { sources: [store] });
    const rows = await res.toArray();
    return rows.map((b) => Object.fromEntries([...b].map(([k, v]) => [k.value, v.value])));
  }

  it('BSP-Werk-Abfrage: die Saegewerks-DoP kommt NICHT als Hersteller', async () => {
    // DER REGRESSIONSTEST. ?dopEpc war bei der Saegewerks-DoP ungebunden,
    // und identGuard laesst Ungebundenes passieren.
    const rows = await frage(createBspWerkQuery([LAMELLE, STAMM]));
    expect(rows.map((r) => r.company).filter(Boolean)).toEqual([]);
  });

  it('BSP-Werk-Abfrage: die BSP-DoP kommt bei der Platte', async () => {
    const rows = await frage(createBspWerkQuery([PLATTE]));
    expect(rows.map((r) => r.company)).toContain('Poppensieker & Derix GmbH & Co.KG');
    expect(rows.map((r) => r.company)).not.toContain('EGGER Sägewerk Brilon GmbH');
  });

  it('Saegewerks-Abfrage: nur die Saegewerks-DoP, nie die BSP-DoP', async () => {
    const lamelle = await frage(createSawmillQuery([LAMELLE]));
    expect(lamelle.map((r) => r.company)).toContain('EGGER Sägewerk Brilon GmbH');

    const platte = await frage(createSawmillQuery([PLATTE]));
    expect(platte.map((r) => r.company).filter(Boolean)).toEqual([]);
  });
});
