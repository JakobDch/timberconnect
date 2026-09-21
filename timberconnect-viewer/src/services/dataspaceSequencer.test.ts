import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  attachSequencer,
  beginRun,
  getSequencerState,
  resetSequencer,
  waitForIdle,
  LEG_DURATION,
  RETURN_DURATION,
} from './dataspaceSequencer';
import { reportPodQuery } from './dataspaceActivity';

const POD_A = 'https://host.example/forst/data/a.ttl';
const POD_B = 'https://host.example/saegewerk/data/b.ttl';

describe('Sequenzer — eine Straße, ein Strom', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    attachSequencer();
    resetSequencer();
  });

  afterEach(() => {
    resetSequencer();
    vi.useRealTimers();
  });

  it('spielt zwei Meldungen NACHEINANDER ab, nie gleichzeitig', () => {
    reportPodQuery(POD_A, 'hit');
    reportPodQuery(POD_B, 'hit');

    // Erster Strom laeuft.
    const ersterEndpoint = getSequencerState().endpoint;
    expect(ersterEndpoint).toBe('host.example/forst');
    expect(getSequencerState().state).toBe('querying');

    // Der zweite ist noch NICHT zu sehen -- das ist der Kern: auf der Kette
    // darf immer nur ein Strom zugleich laufen.
    vi.advanceTimersByTime(LEG_DURATION);
    expect(getSequencerState().endpoint).toBe(ersterEndpoint);
    expect(getSequencerState().state).toBe('hit');

    // Erst nach Hin- und Rueckweg kommt der zweite dran.
    vi.advanceTimersByTime(RETURN_DURATION + 300);
    expect(getSequencerState().endpoint).toBe('host.example/saegewerk');
  });

  it('behaelt denselben pulse ueber Hin- UND Rueckweg', () => {
    // Der Graph benutzt pulse als React-key. Wechselt er zwischen den
    // Etappen, verwirft React das Element und die laufende Bewegung beginnt
    // bei t=0 statt umzukehren -- der Rueckweg war deshalb nie zu sehen.
    reportPodQuery(POD_A, 'hit');
    const hinweg = getSequencerState();
    expect(hinweg.state).toBe('querying');

    vi.advanceTimersByTime(LEG_DURATION);
    const rueckweg = getSequencerState();
    expect(rueckweg.state).toBe('hit');
    expect(rueckweg.pulse).toBe(hinweg.pulse);
  });

  it('laesst dem Rueckweg volle Zeit, bevor der naechste Schritt beginnt', () => {
    reportPodQuery(POD_A, 'hit');
    reportPodQuery(POD_B, 'hit');

    // Kurz VOR Ende des Rueckwegs laeuft noch der erste Schritt.
    vi.advanceTimersByTime(LEG_DURATION + RETURN_DURATION - 50);
    expect(getSequencerState().endpoint).toBe('host.example/forst');

    // Erst danach uebernimmt der zweite.
    vi.advanceTimersByTime(400);
    expect(getSequencerState().endpoint).toBe('host.example/saegewerk');
  });

  it('spielt Fehlschlaege GAR NICHT ab', () => {
    // Ein 404 ist hier kein Befund ueber einen Akteur: bei einer ID ausserhalb
    // des Katalogs raet buildPotentialSources sechs Dateinamen, von denen
    // hoechstens einer existiert. Alle zeigen zudem auf denselben Pod, sodass
    // die Fehlschlaege einer beliebigen Station zugeordnet wuerden -- im
    // Graphen stand dann "Keine Daten an dieser Stelle" ueber einem Akteur,
    // bei dem nichts schiefgelaufen war.
    reportPodQuery(POD_A, 'miss');
    expect(getSequencerState().playing).toBe(false);
    expect(getSequencerState().endpoint).toBeNull();
  });

  it('spielt den Treffer ab, auch wenn davor ein Fehlschlag kam', () => {
    reportPodQuery(POD_A, 'miss');
    reportPodQuery(POD_B, 'hit');
    expect(getSequencerState().endpoint).toBe('host.example/saegewerk');
    expect(getSequencerState().state).toBe('querying');
  });

  it('meldet jede Gegenstelle nur EINMAL je Lauf', () => {
    reportPodQuery(POD_A, 'hit');
    // Dieselbe Gegenstelle nochmal: eine zweite Datei desselben Pods.
    reportPodQuery('https://host.example/forst/data/zweite.ttl', 'hit');

    vi.advanceTimersByTime(LEG_DURATION + RETURN_DURATION + 300);
    // Nach dem einen Strom ist Schluss -- kein zweiter fuer denselben Pod.
    vi.advanceTimersByTime(1000);
    expect(getSequencerState().playing).toBe(false);
  });

  it('ignoriert reine request-Meldungen', () => {
    // Ein 'request' allein hat noch keinen Ausgang; ihn abzuspielen hiesse,
    // einen Rueckweg zu zeigen, den es vielleicht nie gibt.
    reportPodQuery(POD_A, 'request');
    expect(getSequencerState().playing).toBe(false);
  });

  describe('waitForIdle', () => {
    it('kehrt sofort zurueck, wenn nichts laeuft', async () => {
      const spy = vi.fn();
      void waitForIdle().then(spy);
      await vi.runOnlyPendingTimersAsync();
      expect(spy).toHaveBeenCalled();
    });

    it('wartet, bis die Folge durch ist — der Scan darf nicht vorher fertig sein', async () => {
      reportPodQuery(POD_A, 'hit');

      const spy = vi.fn();
      void waitForIdle().then(spy);

      // Mitten im Strom: noch nicht aufgeloest.
      await vi.advanceTimersByTimeAsync(LEG_DURATION);
      expect(spy).not.toHaveBeenCalled();

      // Nach Rueckweg und Nachlauffrist: aufgeloest.
      await vi.advanceTimersByTimeAsync(RETURN_DURATION + 1200);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('beginRun — der Cache-Fall', () => {
    it('haelt die Folge offen, auch wenn keine Meldung kommt', async () => {
      // Genau der Fall aus der Rueckmeldung: alles im Cache, niemand meldet
      // etwas. Ohne beginRun bliebe der Graph stumm.
      beginRun();
      expect(getSequencerState().playing).toBe(true);

      const spy = vi.fn();
      void waitForIdle().then(spy);
      expect(spy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(3000);
      expect(spy).toHaveBeenCalled();
    });

    it('spielt im Cache-Lauf Stationen ab, die frueher geantwortet haben', async () => {
      // Erster Lauf: echte Meldung, der Pod wird als Treffer gemerkt.
      reportPodQuery(POD_A, 'hit');
      await vi.advanceTimersByTimeAsync(LEG_DURATION + RETURN_DURATION + 1200);
      expect(getSequencerState().playing).toBe(false);

      // Zweiter Lauf: nichts wird gemeldet (alles aus dem Cache).
      beginRun();
      await vi.advanceTimersByTimeAsync(300);
      expect(getSequencerState().endpoint).toBe('host.example/forst');
      expect(getSequencerState().state).toBe('querying');
    });
  });
});
