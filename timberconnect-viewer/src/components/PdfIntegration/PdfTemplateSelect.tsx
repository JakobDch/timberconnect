import { AlertTriangle, FileText, Loader2 } from 'lucide-react';
import type { PdfTemplate } from '../../services/pdfDocumentService';

/**
 * Zuordnung "welches Dokument ist dieses PDF?" — direkt in der Dateiliste des
 * Vorgangs, nicht mehr als Sheet nach dem Upload.
 *
 * Der Nutzer laedt die AUSGEFUELLTE Vorlage hoch; die Werte stehen damit schon
 * in der Datei. Was die App noch braucht, ist allein die Vorlage, gegen die
 * gelesen wird — deshalb ist das hier ein einzelnes Auswahlfeld und kein
 * eigener Schritt.
 *
 * Vorschlaege des Vorgangs stehen oben in einer eigenen Gruppe; die Auswahl
 * bleibt aber vollstaendig, damit ein Dokument nicht deshalb falsch zugeordnet
 * wird, weil es im erwarteten Satz fehlt.
 */

interface PdfTemplateSelectProps {
  templates: PdfTemplate[];
  isLoading: boolean;
  loadError: string | null;
  value: string | null;
  onChange: (templateId: string | null) => void;
  /** Template-IDs, die in diesem Vorgang typischerweise anfallen. */
  suggestedTemplateIds?: string[];
  disabled?: boolean;
}

export function PdfTemplateSelect({
  templates,
  isLoading,
  loadError,
  value,
  onChange,
  suggestedTemplateIds = [],
  disabled = false,
}: PdfTemplateSelectProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-night-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Vorlagen werden geladen...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-300">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
        <span>{loadError} — das PDF wird nur als Original abgelegt.</span>
      </div>
    );
  }

  const suggested = templates.filter((t) => suggestedTemplateIds.includes(t.id));
  const others = templates.filter((t) => !suggestedTemplateIds.includes(t.id));

  return (
    <div>
      <label className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] text-night-300 uppercase mb-1.5">
        <FileText className="w-3 h-3" />
        Um welches Dokument handelt es sich?
      </label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="w-full px-3 py-2 bg-night-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-acid-400/60 focus:ring-4 focus:ring-acid-400/10 disabled:opacity-50"
      >
        <option value="">Nur Original ablegen (keine Datenübernahme)</option>
        {suggested.length > 0 && (
          <optgroup label="Zu diesem Vorgang">
            {suggested.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label={suggested.length > 0 ? 'Weitere Dokumente' : 'Dokumente'}>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <p className="text-[11px] text-night-400 mt-1.5">
        Die im PDF eingetragenen Werte werden beim Registrieren automatisch
        übernommen.
      </p>
    </div>
  );
}
