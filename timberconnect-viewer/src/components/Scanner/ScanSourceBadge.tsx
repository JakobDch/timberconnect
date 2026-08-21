import { Radio, ScanBarcode, Camera, Keyboard, FlaskConical } from 'lucide-react';
import type { ScanSource } from '../../services/identifiers';

/**
 * Zeigt an, woher eine ID stammt. Beim Testen am Geraet ist das die schnellste
 * Antwort auf die Frage "hat der RFID-Auslöser oder der Imager gefeuert?".
 */

const LABELS: Record<ScanSource, { text: string; Icon: typeof Radio }> = {
  'wedge-rfid': { text: 'RFID', Icon: Radio },
  'wedge-barcode': { text: 'Barcode', Icon: ScanBarcode },
  camera: { text: 'Kamera', Icon: Camera },
  manual: { text: 'Manuell', Icon: Keyboard },
  simulated: { text: 'Simuliert', Icon: FlaskConical },
};

interface ScanSourceBadgeProps {
  source?: ScanSource | null;
  className?: string;
}

export function ScanSourceBadge({ source, className = '' }: ScanSourceBadgeProps) {
  if (!source) return null;
  const entry = LABELS[source];
  if (!entry) return null;

  const { text, Icon } = entry;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] font-semibold tracking-wide text-night-200 ${className}`}
    >
      <Icon className="w-3.5 h-3.5 text-acid-300" />
      {text}
    </span>
  );
}
