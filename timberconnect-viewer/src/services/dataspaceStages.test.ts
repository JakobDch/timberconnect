import { describe, it, expect } from 'vitest';
import { STAGES, stageForRole } from './dataspaceStages';
import { ROLES } from '../config/roles';

describe('Stationen der Kette', () => {
  it('traegt genau die sechs Stationen der Startseiten-Grafik', () => {
    // Der Graph soll als DASSELBE Bild erkennbar sein wie die Kette auf der
    // Startseite. Weicht die Liste hier ab, zeigen beide Ansichten
    // unterschiedliche Welten.
    const kette = STAGES.filter((s) => s.id !== 'begleitend').map((s) => s.label);
    expect(kette).toEqual([
      'Forstbetrieb',
      'Sägewerk',
      'Holzwerkstoffe',
      'Transport',
      'Fachplanung',
      'Holzbau',
    ]);
  });
});

describe('Stufen der Lieferkette', () => {
  it('ordnet die materialfuehrenden Rollen ihrer Station zu', () => {
    expect(stageForRole('Forstbetrieb')).toBe('forst');
    expect(stageForRole('Saegewerk')).toBe('saege');
    expect(stageForRole('Holzwerkstoffproduzent')).toBe('werkstoff');
    expect(stageForRole('Transportunternehmen')).toBe('transport');
    expect(stageForRole('FachplanerHolzbau')).toBe('planung');
    expect(stageForRole('Holzbauunternehmen')).toBe('bau');
  });

  it('stellt Rollen ohne eigene Station als begleitend ein', () => {
    expect(stageForRole('Zertifizierer')).toBe('begleitend');
    expect(stageForRole('Versicherer')).toBe('begleitend');
    expect(stageForRole('WissenschaftForschung')).toBe('begleitend');
  });

  it('behandelt Pods ohne Rolle als begleitend statt sie zu verlieren', () => {
    expect(stageForRole(null)).toBe('begleitend');
    expect(stageForRole(undefined)).toBe('begleitend');
  });

  it('verliert auch eine kuenftig ergaenzte Rolle nicht', () => {
    // Waechst config/roles.ts, darf der Graph den neuen Akteur nicht
    // stillschweigend weglassen -- er landet dann eben im Begleitband.
    expect(stageForRole('EineNochNichtErfundeneRolle')).toBe('begleitend');
  });

  it('weist jeder bekannten Rolle genau eine Stufe zu', () => {
    for (const role of ROLES) {
      const stage = stageForRole(role.id);
      expect(STAGES.some((s) => s.id === stage)).toBe(true);
    }
  });

  it('nennt keine Rolle in zwei Stufen', () => {
    const seen = new Set<string>();
    for (const stage of STAGES) {
      for (const roleId of stage.roleIds) {
        expect(seen.has(roleId)).toBe(false);
        seen.add(roleId);
      }
    }
  });

  it('verweist nur auf Rollen, die es wirklich gibt', () => {
    // Ein Tippfehler in STAGES faellt sonst nie auf: die Rolle landete
    // klammheimlich im Begleitband statt auf ihrer Station.
    const bekannt = new Set(ROLES.map((r) => r.id));
    for (const stage of STAGES) {
      for (const roleId of stage.roleIds) {
        expect(bekannt.has(roleId)).toBe(true);
      }
    }
  });
});
