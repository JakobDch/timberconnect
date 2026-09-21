import { describe, it, expect, vi } from 'vitest';
import {
  endpointOf,
  reportPodQuery,
  reportServiceQuery,
  subscribeActivity,
} from './dataspaceActivity';

describe('endpointOf', () => {
  it('fasst einen Pod ueber Host UND erstes Pfadsegment zusammen', () => {
    // Alle Demo-Pods liegen auf demselben Server. Nur der Host wuerde sie zu
    // einem einzigen Knoten verschmelzen -- genau das darf nicht passieren.
    const a = endpointOf('https://solid-community-server.tmdt.info/bspwerk/data/x_bspwerk.ttl');
    const b = endpointOf('https://solid-community-server.tmdt.info/saegewerk/data/y.ttl');
    expect(a).toBe('solid-community-server.tmdt.info/bspwerk');
    expect(b).toBe('solid-community-server.tmdt.info/saegewerk');
    expect(a).not.toBe(b);
  });

  it('haelt alle Dateien EINES Pods auf demselben Knoten', () => {
    const base = 'https://solid-community-server.tmdt.info/bspwerk';
    expect(endpointOf(`${base}/data/a/a_forst.ttl`)).toBe(
      endpointOf(`${base}/public/b.ttl`),
    );
  });

  it('faellt bei unbrauchbaren Eingaben nicht um', () => {
    expect(endpointOf('kein-url')).toBeTruthy();
  });
});

describe('Meldungen', () => {
  it('erreichen die Zuhoerer mit Art und Gegenstelle', () => {
    const seen: string[] = [];
    const off = subscribeActivity((e) => seen.push(`${e.endpointKind}:${e.endpoint}:${e.kind}`));

    reportPodQuery('https://host.example/podname/data/x.ttl', 'request');
    reportServiceQuery('EPCIS', 'hit');
    off();
    reportPodQuery('https://host.example/podname/data/y.ttl', 'hit');

    expect(seen).toEqual(['pod:host.example/podname:request', 'service:EPCIS:hit']);
  });

  it('laesst einen fehlerhaften Zuhoerer die uebrigen nicht mitreissen', () => {
    // Der Melder sitzt mitten im Abfrageweg. Wirft ein Zuhoerer, darf das
    // niemals die laufende Pod-Abfrage scheitern lassen.
    const spy = vi.fn();
    const offBad = subscribeActivity(() => {
      throw new Error('kaputt');
    });
    const offGood = subscribeActivity(spy);

    expect(() => reportPodQuery('https://host.example/pod/x.ttl', 'miss')).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);

    offBad();
    offGood();
  });
});
