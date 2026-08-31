import { describe, it, expect } from 'vitest';
import { toPathSegment } from './uploadService';

/**
 * Der Ordnername des Uploads.
 *
 * Hintergrund: die trace_id ist bei hpr/eldat kein TC-Kuerzel, sondern der
 * erste EPC der Datei. Ungefiltert als Pfadsegment benutzt, zerlegen die
 * Doppelpunkte den Pfad -- der Container entsteht nie, der PUT landet
 * ungestempelt und der Server antwortet mit 401 ("Authentifizierung
 * fehlgeschlagen", obwohl die Session gilt).
 */
describe('toPathSegment', () => {
  it('ersetzt die Doppelpunkte eines EPC-Idents', () => {
    expect(toPathSegment('urn:epc:id:sgtin:404711145.0100.12A3D4567')).toBe(
      'urn_epc_id_sgtin_404711145.0100.12A3D4567',
    );
  });

  it('laesst eine gewoehnliche Vorgangs-/Trace-Id unveraendert', () => {
    expect(toPathSegment('VG-2026-0831-5035')).toBe('VG-2026-0831-5035');
    expect(toPathSegment('TC-2025-001')).toBe('TC-2025-001');
  });

  it('entschaerft auch die uebrigen pfadwirksamen Zeichen', () => {
    expect(toPathSegment('a/b\\c?d#e[f]g@h')).toBe('a_b_c_d_e_f_g_h');
  });

  it('erhaelt den Punkt — er trennt die GS1-Bestandteile', () => {
    expect(toPathSegment('404711145.0100.12A3D4567')).toContain('.');
  });
});

/**
 * Die Ableitung des Zielordners, wie sie in convertAndUploadWithSession steht.
 * Hier als reine Funktion nachgebildet: die Originalstelle haengt an einem
 * Netzwerkaufruf, die Regel selbst ist aber die eigentliche Aussage.
 */
function dataFolderFor(
  podBase: string,
  traceId: string,
  processContainerUrl?: string | null,
): string {
  return processContainerUrl && processContainerUrl.startsWith(podBase)
    ? processContainerUrl.slice(podBase.length).replace(/\/$/, '')
    : `data/${toPathSegment(traceId)}`;
}

describe('Zielordner des Uploads', () => {
  const podBase = 'https://solid-community-server.tmdt.info/user2/';
  const epcTraceId = 'urn:epc:id:sgtin:404711145.0100.12A3D4567';

  it('legt die Dateien in den Container des Vorgangs', () => {
    expect(
      dataFolderFor(podBase, epcTraceId, `${podBase}data/VG-2026-0831-5035/`),
    ).toBe('data/VG-2026-0831-5035');
  });

  it('faellt ohne Vorgang auf einen gesaeuberten trace_id-Ordner zurueck', () => {
    expect(dataFolderFor(podBase, epcTraceId, null)).toBe(
      'data/urn_epc_id_sgtin_404711145.0100.12A3D4567',
    );
  });

  it('erzeugt in keinem Fall ein Segment mit Doppelpunkt', () => {
    for (const container of [null, `${podBase}data/VG-1/`]) {
      expect(dataFolderFor(podBase, epcTraceId, container)).not.toContain(':');
    }
  });

  it('ignoriert einen Container ausserhalb des eigenen Pods', () => {
    // Ein blindes replace() liesse hier eine absolute URL stehen, die
    // anschliessend hinter podBase geklebt wuerde.
    const fremd = 'https://anderer.server/user9/data/VG-1/';
    expect(dataFolderFor(podBase, epcTraceId, fremd)).toBe(
      'data/urn_epc_id_sgtin_404711145.0100.12A3D4567',
    );
  });
});
