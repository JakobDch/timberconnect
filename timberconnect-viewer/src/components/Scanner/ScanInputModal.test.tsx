/**
 * Prueft den Sofort-Modus: ein Scan muss die Suche ohne Enter ausloesen,
 * getippter Text darf sie NICHT ausloesen.
 *
 * Der Test bildet beide Ausgabearten von DataWedge ab — Blockeinfuegung und
 * schnelle Zeichenfolge. Die erste Fassung reagierte nur auf keydown und
 * verpasste dadurch die Blockeinfuegung: die ID stand im Feld, es passierte
 * aber nichts.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ScanInputModal } from './ScanInputModal';

const ID = 'urn:epc:id:sgtin:404711145.0100.12A3D4567';

// Ohne Cleanup bleibt der vorige Dialog im Dokument stehen und die Abfragen
// treffen das falsche Feld.
afterEach(() => {
  cleanup();
});

function setup(onSubmit = vi.fn()) {
  render(<ScanInputModal isOpen onClose={() => {}} onSubmit={onSubmit} />);
  return { onSubmit, input: screen.getByLabelText('Produkt-ID') as HTMLInputElement };
}

/** DataWedge fuegt den Text in einem Zug ein. */
function pasteBlock(input: HTMLInputElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
}

/** DataWedge tippt zeichenweise, sehr schnell. */
function typeFast(input: HTMLInputElement, text: string) {
  let acc = '';
  for (const ch of text) {
    acc += ch;
    fireEvent.change(input, { target: { value: acc } });
  }
}

describe('ScanInputModal — Sofort-Modus', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sucht nach einer Blockeinfuegung ohne Enter', async () => {
    const { onSubmit, input } = setup();
    pasteBlock(input, ID);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toBe(ID);
    expect(onSubmit.mock.calls[0][1]).toBe('wedge-barcode');
  });

  it('sucht nach schneller Zeichenfolge ohne Enter', async () => {
    const { onSubmit, input } = setup();
    typeFast(input, '01040471114510062112A3D4567');
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('loest bei Enter sofort aus', () => {
    const { onSubmit, input } = setup();
    pasteBlock(input, ID);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toBe(ID);
  });

  it('loest nur ein einziges Mal aus', async () => {
    const { onSubmit, input } = setup();
    pasteBlock(input, ID);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('ignoriert zu kurze Eingaben', async () => {
    const { onSubmit, input } = setup();
    pasteBlock(input, 'ab');
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ScanInputModal — Modus "Vorher pruefen"', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('tc-scan-mode', 'review');
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sucht NICHT von selbst', async () => {
    const { onSubmit, input } = setup();
    pasteBlock(input, ID);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sucht erst auf Knopfdruck', async () => {
    const { onSubmit, input } = setup();
    pasteBlock(input, ID);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(screen.getByRole('button', { name: /Bauteil suchen/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('ScanInputModal — Zustandsanzeige', () => {
  it('zeigt die Ladeanimation statt des Feldes', () => {
    render(
      <ScanInputModal isOpen isLoading onClose={() => {}} onSubmit={() => {}} />,
    );
    expect(screen.getByText(/Bauteil wird gesucht/i)).toBeTruthy();
    expect(screen.queryByLabelText('Produkt-ID')).toBeNull();
  });

  it('zeigt einen Fehler im Dialog an', () => {
    render(
      <ScanInputModal
        isOpen
        error="GTIN 04047111405924, Serie 123456789101 — kein Bauteil gefunden"
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByText(/kein Bauteil gefunden/i)).toBeTruthy();
    // Das Feld bleibt sichtbar, damit sofort neu gescannt werden kann.
    expect(screen.getByLabelText('Produkt-ID')).toBeTruthy();
  });
});
