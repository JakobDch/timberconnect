import { useState } from 'react';
import { Check, Download } from 'lucide-react';
import {
  downloadUseCaseExport,
  type UseCaseExport,
} from '../../services/useCaseExportService';

/**
 * "Als JSON" -- laedt die angezeigten Daten des Anwendungsfalls herunter.
 *
 * Der Aufrufer uebergibt eine Funktion statt fertiger Daten: das JSON wird
 * erst beim Klick gebaut. Sonst rechnete jede Ansicht den Export bei jedem
 * Rendern mit, obwohl ihn die meisten Nutzer nie anfordern.
 *
 * Steht im Kopf jeder Awf-Ansicht neben "Zurueck".
 */
interface JsonExportButtonProps {
  /** Baut das Exportobjekt -- erst beim Klick aufgerufen. */
  build: () => UseCaseExport;
  /** Aus, solange keine Daten geladen sind. */
  disabled?: boolean;
}

export function JsonExportButton({ build, disabled = false }: JsonExportButtonProps) {
  // Kurze Bestaetigung: ein Browser-Download ist sonst unsichtbar, wenn er
  // direkt in den Download-Ordner laeuft.
  const [done, setDone] = useState(false);

  const handleClick = () => {
    downloadUseCaseExport(build());
    setDone(true);
    window.setTimeout(() => setDone(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title="Die angezeigten Daten dieses Anwendungsfalls als JSON-Datei speichern"
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-night-700/60 hover:bg-night-700 text-night-200 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {done ? (
        <Check className="w-3.5 h-3.5 text-acid-300" />
      ) : (
        <Download className="w-3.5 h-3.5 text-acid-300" />
      )}
      {done ? 'Gespeichert' : 'Als JSON'}
    </button>
  );
}
