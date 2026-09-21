import { describe, it, expect } from 'vitest';
import { fit } from './dataspaceTopology';

describe('fit — Beschriftung fuer den Ring', () => {
  it('nimmt die gebraeuchliche Kurzform statt abzuschneiden', () => {
    // "Holzwerkstoffpr…" war die Wortruine, die das Abschneiden erzeugte.
    expect(fit('Holzwerkstoffproduzent')).toBe('Holzwerkstoffe');
    expect(fit('Fachplaner Holzbau')).toBe('Fachplanung');
  });

  it('laesst kurze Rollennamen unveraendert', () => {
    expect(fit('Sägewerk')).toBe('Sägewerk');
    expect(fit('Forstbetrieb')).toBe('Forstbetrieb');
    expect(fit('Zertifizierer')).toBe('Zertifizierer');
  });

  it('schneidet nur ab, wenn es keine Kurzform gibt', () => {
    // Rueckfall fuer neue Rollen, fuer die noch niemand eine Kurzform
    // hinterlegt hat -- der Ring darf davon nicht auseinanderfallen.
    const out = fit('Eine sehr lange neue Rollenbezeichnung');
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out.endsWith('…')).toBe(true);
  });

  it('haelt jede Kurzform innerhalb der Ringbreite', () => {
    const lang = [
      'Holzwerkstoffproduzent',
      'Materialkatasterdienstleister',
      'Verbindungsmittelhersteller',
      'Wissenschaft und Forschung',
      'Fachplaner Holzbau',
      'Transportunternehmen',
      'Rückbauunternehmen',
      'Generalunternehmer',
      'Projektentwickler',
      'Unternehmensberatung',
      'Facility Management',
      'Forstunternehmen',
      'Holzbauunternehmen',
    ];
    for (const rolle of lang) {
      expect(fit(rolle).length).toBeLessThanOrEqual(16);
    }
  });
});
