/**
 * Der lokale Vorgangsindex (localStorage) und der Pod koennen auseinander
 * laufen: Geloescht wird im Pod, der Index merkt davon nichts. Bleibt er
 * stehen, zeigt die Vorgangssuche Eintraege, deren Dateien 404 liefern — und
 * ein erneuter Upload desselben Vorgangs stuende doppelt in der Liste.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { forgetProcessesByContainer, getProcesses } from './processService';

const POD = 'https://solid-community-server.tmdt.info/epcisrepository/';
const KEY = 'tc.processes';

function seed(containerUrls: string[]): void {
  localStorage.setItem(
    KEY,
    JSON.stringify(
      containerUrls.map((url, i) => ({
        id: `proc-${i}`,
        type: 'faellung',
        title: `Vorgang ${i}`,
        registeredAt: `2026-09-0${i + 1}T10:00:00.000Z`,
        ownerWebId: `${POD}profile/card#me`,
        containerUrl: url,
        files: [],
        eventIds: [],
        materialEpcs: [],
      })),
    ),
  );
}

describe('forgetProcessesByContainer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('entfernt genau den geloeschten Vorgang', () => {
    const pflanzung = `${POD}data/proc-0/`;
    const faellung = `${POD}data/proc-1/`;
    seed([pflanzung, faellung]);

    const removed = forgetProcessesByContainer([faellung]);

    expect(removed).toBe(1);
    expect(getProcesses().map((p) => p.containerUrl)).toEqual([pflanzung]);
  });

  it('laesst den Index unveraendert, wenn nichts zutrifft', () => {
    seed([`${POD}data/proc-0/`]);

    const removed = forgetProcessesByContainer([`${POD}data/gibt-es-nicht/`]);

    expect(removed).toBe(0);
    expect(getProcesses()).toHaveLength(1);
  });

  it('kommt mit einem leeren Index zurecht', () => {
    expect(forgetProcessesByContainer([`${POD}data/proc-0/`])).toBe(0);
  });

  it('entfernt mehrere Vorgaenge auf einmal', () => {
    const urls = [`${POD}data/proc-0/`, `${POD}data/proc-1/`, `${POD}data/proc-2/`];
    seed(urls);

    const removed = forgetProcessesByContainer([urls[0], urls[2]]);

    expect(removed).toBe(2);
    expect(getProcesses().map((p) => p.containerUrl)).toEqual([urls[1]]);
  });
});
