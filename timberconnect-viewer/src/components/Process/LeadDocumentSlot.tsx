import { useRef, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCheck,
  FileWarning,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import type { ProcessDraftFile, ProcessType } from '../../services/processService';
import { formatFileSize } from '../../services/recentActivity';

/**
 * Der Pflichtdatei-Slot eines Vorgangs.
 *
 * Diese Datei traegt die Verknuepfung zur Material-ID; ohne sie entsteht kein
 * Vorgang. Der Slot ist deshalb visuell vom uebrigen Upload getrennt und
 * blockiert bei leerem oder falsch erkanntem Inhalt den Absenden-Button.
 *
 * Formate mit Status 'pending' (Stammzertifikat, Leistungserklaerung,
 * ERP-Excel) sind fachlich definiert, liegen aber noch nicht als Beispiel vor.
 * Sie werden mit "Format folgt" markiert und akzeptieren vorerst jede Datei.
 */

interface LeadDocumentSlotProps {
  processType: ProcessType;
  value: ProcessDraftFile | null;
  isDetecting: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
  disabled?: boolean;
  /**
   * Zusatzfeld unterhalb der gewaehlten Datei — bei PDF-Pflichtdateien die
   * Zuordnung, gegen welche Vorlage ausgelesen wird.
   */
  children?: ReactNode;
}

export function LeadDocumentSlot({
  processType,
  value,
  isDetecting,
  onSelect,
  onRemove,
  disabled = false,
  children,
}: LeadDocumentSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { leadDoc } = processType;
  const isPending = leadDoc.status === 'pending';
  const isTemplate = leadDoc.status === 'template';

  // Bei implementierten Formaten muss der erkannte data_type passen. Bei
  // Vorlagen heisst das nur "ist ein PDF" — welches Dokument es ist, sagt die
  // Vorlagen-Zuordnung unter der Datei.
  const mismatched =
    !isPending &&
    !isDetecting &&
    value !== null &&
    leadDoc.expectedDataType !== null &&
    value.dataType !== leadDoc.expectedDataType;

  return (
    <div
      className={`rounded-2xl border p-5 transition-all ${
        mismatched
          ? 'border-red-500/40 bg-red-500/5'
          : value
            ? 'border-acid-400/40 bg-acid-400/5'
            : 'border-amber-500/30 bg-amber-500/5'
      }`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border ${
            value && !mismatched
              ? 'bg-acid-400/15 border-acid-400/30 text-acid-300'
              : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
          }`}
        >
          {value && !mismatched ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <FileWarning className="w-4 h-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-bold text-white">{leadDoc.label}</h4>
            <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
              Pflicht
            </span>
            {isPending ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                <Clock className="w-2.5 h-2.5" />
                Format folgt
              </span>
            ) : isTemplate ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full bg-acid-400/15 text-acid-300 border border-acid-400/30">
                <FileCheck className="w-2.5 h-2.5" />
                Vorlage vorhanden
              </span>
            ) : null}
          </div>
          <p className="text-xs text-night-300 mt-1">{leadDoc.note}</p>
        </div>
      </div>

      {isPending && (
        <div className="flex items-start gap-2 px-3 py-2 mb-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <Clock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300/90">
            Für dieses Format steht noch kein Beispiel und keine Vorlage bereit.
            Die Auswertung der Material-ID folgt — bis dahin wird die Datei nur
            als Pflichtdokument abgelegt.
          </p>
        </div>
      )}

      {isTemplate && (
        <div className="flex items-start gap-2 px-3 py-2 mb-3 rounded-xl bg-acid-400/10 border border-acid-400/20">
          <FileCheck className="w-3.5 h-3.5 text-acid-300 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-acid-200/90">
            Laden Sie die ausgefüllte Vorlage hoch. Die eingetragenen Werte
            werden beim Registrieren automatisch übernommen.
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={leadDoc.accept}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onSelect(file);
          e.target.value = '';
        }}
      />

      {value ? (
        <div className="px-4 py-3 bg-night-800/70 border border-white/10 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{value.file.name}</p>
              <p className="text-xs text-night-400 mt-0.5">
                {isDetecting ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Wird erkannt...
                  </span>
                ) : mismatched ? (
                  <span className="text-red-300">
                    Nicht als {leadDoc.label} erkannt
                  </span>
                ) : (
                  <>
                    {formatFileSize(value.file.size)}
                    {value.dataType && ` · ${value.dataType}`}
                  </>
                )}
              </p>
            </div>
            <button
              onClick={onRemove}
              disabled={disabled}
              className="p-1 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
              aria-label="Pflichtdatei entfernen"
            >
              <X className="w-4 h-4 text-night-400" />
            </button>
          </div>
          {children && (
            <div className="mt-3 pt-3 border-t border-white/10">{children}</div>
          )}
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-amber-500/40 bg-night-800/40 hover:border-amber-400 hover:bg-night-800/70 text-sm font-semibold text-amber-300 transition-all disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          {leadDoc.label} auswählen
        </button>
      )}

      {mismatched && (
        <div className="flex items-start gap-2 mt-3 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/25">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">
            {isTemplate
              ? `${leadDoc.label} wird als PDF erwartet. Ohne gültiges Pflichtdokument kann der Vorgang nicht registriert werden.`
              : `Diese Datei wurde nicht als ${leadDoc.label} erkannt. Ohne gültiges Pflichtdokument kann der Vorgang nicht registriert werden.`}
          </p>
        </div>
      )}
    </div>
  );
}
