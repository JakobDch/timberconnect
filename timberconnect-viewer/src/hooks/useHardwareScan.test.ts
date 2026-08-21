/**
 * Prueft die Burst-Erkennung: ein Scanner tippt unmenschlich schnell, ein
 * Mensch nicht. Der Negativtest ist hier der wichtigere — wenn getippter Text
 * faelschlich als Scan gilt, wird die App im Alltag unbenutzbar.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHardwareScan, injectScan } from './useHardwareScan';

/** Sendet Zeichen mit einem gewaehlten Abstand, abgeschlossen mit Enter. */
function sendKeys(value: string, gapMs: number, withEnter = true): void {
  let t = 1000;
  for (const char of value) {
    const ev = new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true });
    // timeStamp ist schreibgeschuetzt — fuer den Test ueberschreiben.
    Object.defineProperty(ev, 'timeStamp', { value: t });
    document.dispatchEvent(ev);
    t += gapMs;
  }
  if (withEnter) {
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'timeStamp', { value: t });
    document.dispatchEvent(ev);
  }
}

describe('useHardwareScan', () => {
  let onScan: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onScan = vi.fn();
  });

  it('erkennt einen Scan bei Scanner-Tempo', () => {
    renderHook(() => useHardwareScan({ onScan }));
    sendKeys('01040471114510062112A3D4567', 10);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan.mock.calls[0][0]).toBe('01040471114510062112A3D4567');
  });

  it('ignoriert von Hand getippten Text', () => {
    renderHook(() => useHardwareScan({ onScan }));
    // 120 ms pro Zeichen — normales Tippen.
    sendKeys('urn:epc:id', 120);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('ignoriert zu kurze Folgen', () => {
    renderHook(() => useHardwareScan({ onScan }));
    sendKeys('ab', 10);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('meldet einen RFID-Hex als RFID-Quelle', () => {
    renderHook(() => useHardwareScan({ onScan }));
    sendKeys('301134C52500941CBE991A6D', 8);
    expect(onScan.mock.calls[0][1].source).toBe('wedge-rfid');
  });

  it('meldet einen Ziffern-Elementstring als Barcode-Quelle', () => {
    renderHook(() => useHardwareScan({ onScan }));
    sendKeys('010404711140592421123456789101', 8);
    expect(onScan.mock.calls[0][1].source).toBe('wedge-barcode');
  });

  it('reicht von aussen eingespeiste Scans durch', () => {
    renderHook(() => useHardwareScan({ onScan }));
    injectScan('urn:epc:id:sgtin:404711145.0100.12A3D4567', 'simulated');
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan.mock.calls[0][1].source).toBe('simulated');
  });

  it('lauscht nicht, wenn abgeschaltet', () => {
    renderHook(() => useHardwareScan({ onScan, enabled: false }));
    sendKeys('01040471114510062112A3D4567', 10);
    expect(onScan).not.toHaveBeenCalled();
  });
});
