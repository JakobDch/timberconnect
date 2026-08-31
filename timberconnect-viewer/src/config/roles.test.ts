import { describe, it, expect } from 'vitest';
import {
  ROLES,
  getRoleById,
  getRoleByIri,
  normalizeRoleIris,
} from './roles';
import { NAMESPACES } from './solidPods';

/**
 * Rollen frueherer Listenstaende.
 *
 * In bereits registrierten Pods steht die Rolle als IRI in profile/role.ttl.
 * Nach einer Umbenennung zeigt dieser Eintrag ins Leere -- und die Oberflaeche
 * liess die Rolle dann stillschweigend verschwinden: In der Dokumentfreigabe
 * stand "6 von 6 Rollen ausgewaehlt", waehrend nur eine Karte erschien.
 */
describe('Rollen frueherer Listenstaende', () => {
  const LEGACY: Array<[string, string]> = [
    ['Forst', 'Forstbetrieb'],
    ['BspWerk', 'Holzwerkstoffproduzent'],
    ['Holzbauplanung', 'FachplanerHolzbau'],
  ];

  it('loest den alten IRI auf die heutige Rolle auf', () => {
    for (const [legacy, current] of LEGACY) {
      const role = getRoleByIri(`${NAMESPACES.tc}${legacy}`);
      expect(role, `${legacy} muss aufloesbar sein`).not.toBeNull();
      expect(role?.id).toBe(current);
    }
  });

  it('loest auch die alte Id auf', () => {
    for (const [legacy, current] of LEGACY) {
      expect(getRoleById(legacy)?.id).toBe(current);
    }
  });

  it('schreibt beim Aufloesen immer die heutige Form zurueck', () => {
    // Wichtig fuers Zugriffsmodell: eine role-policy.ttl, die tc:Forstbetrieb
    // erlaubt, laesst tc:Forst sonst nicht durch.
    const normalized = normalizeRoleIris([`${NAMESPACES.tc}Forst`]);
    expect(normalized).toEqual([`${NAMESPACES.tc}Forstbetrieb`]);
  });

  it('entfernt Dubletten, wenn alte und neue Form nebeneinander stehen', () => {
    const normalized = normalizeRoleIris([
      `${NAMESPACES.tc}Forst`,
      `${NAMESPACES.tc}Forstbetrieb`,
    ]);
    expect(normalized).toEqual([`${NAMESPACES.tc}Forstbetrieb`]);
  });

  it('verwirft unbekannte IRIs, statt sie durchzureichen', () => {
    expect(normalizeRoleIris([`${NAMESPACES.tc}GibtEsNicht`])).toEqual([]);
  });

  it('laesst die aktuellen Rollen unveraendert', () => {
    const all = ROLES.map((r) => r.iri);
    expect(normalizeRoleIris(all)).toEqual(all);
  });

  it('ueberschreibt keine bestehende Rolle mit einem Alias', () => {
    // Ein Alias, der zufaellig wie eine aktuelle Id heisst, wuerde deren
    // Aufloesung still umbiegen.
    for (const [legacy] of LEGACY) {
      expect(
        ROLES.some((r) => r.id === legacy),
        `${legacy} darf keine aktuelle Rolle sein`,
      ).toBe(false);
    }
  });
});
