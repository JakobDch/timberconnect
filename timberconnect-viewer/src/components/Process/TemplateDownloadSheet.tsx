import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, CheckCircle2, Download, Loader2, X } from 'lucide-react';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import { useAuth } from '../../auth/AuthContext';
import { fetchPdfTemplates, type PdfTemplate } from '../../services/pdfDocumentService';
import {
  fetchPrefilledTemplate,
  identSpecFor,
  issueNewEpcs,
  planTemplateIdents,
  prefillFields,
  saveBlob,
} from '../../services/templateIdentService';

/**
 * Vorlage herunterladen -- mit eingebetteten, frischen Material-IDs.
 *
 * Der Nutzer waehlt nur die Vorlage. Alle Ident-Felder belegt die App selbst
 * mit neuen, nachweislich unbenutzten IDs (planTemplateIdents). Die IDs
 * stecken unsichtbar im PDF; der Nutzer fuellt es aus und laedt es im
 * passenden Vorgang hoch. Von EPCs, Praefixen oder Seriennummern bekommt er
 * nichts zu sehen.
 */

interface TemplateDownloadSheetProps {
  isOpen: boolean;
  /** Bereits geladene Vorlagen; fehlen sie (Aufruf aus dem Menue), laedt der Dialog sie selbst. */
  templates?: PdfTemplate[];
  /** Vorauswahl, z.B. die Pflichtvorlage des gewaehlten Vorgangs. */
  initialTemplateId?: string | null;
  /** Diese Vorlagen stehen oben (Vorlagen des aktuellen Vorgangs). */
  suggestedTemplateIds?: string[];
  onClose: () => void;
}

export function TemplateDownloadSheet({
  isOpen,
  templates: givenTemplates,
  initialTemplateId,
  suggestedTemplateIds = [],
  onClose,
}: TemplateDownloadSheetProps) {
  useBodyScrollLock(isOpen);
  const { isLoggedIn, webId, companyPrefix } = useAuth();

  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loadedTemplates, setLoadedTemplates] = useState<PdfTemplate[]>([]);
  const templates = givenTemplates ?? loadedTemplates;

  useEffect(() => {
    if (!isOpen || givenTemplates || loadedTemplates.length > 0) return;
    fetchPdfTemplates()
      .then(setLoadedTemplates)
      .catch((err) => setError(err instanceof Error ? err.message : 'Vorlagen nicht ladbar'));
  }, [isOpen, givenTemplates, loadedTemplates.length]);

  const sorted = useMemo(() => {
    const rank = (id: string) => {
      const i = suggestedTemplateIds.indexOf(id);
      return i === -1 ? 1000 : i;
    };
    return [...templates].sort((a, b) => rank(a.id) - rank(b.id));
  }, [templates, suggestedTemplateIds]);

  useEffect(() => {
    if (!isOpen) return;
    setTemplateId(initialTemplateId || sorted[0]?.id || '');
    setError(null);
    setDone(null);
  }, [isOpen, initialTemplateId, sorted]);

  const template = templates.find((t) => t.id === templateId) ?? null;
  const plan = planTemplateIdents(templateId);

  const blocker = !isLoggedIn || !webId
    ? 'Bitte zuerst anmelden.'
    : !companyPrefix
      ? 'Bitte zuerst Rolle und Firmenpräfix festlegen.'
      : !template
        ? 'Bitte eine Vorlage wählen.'
        : null;

  const handleDownload = async () => {
    if (blocker || !template || !companyPrefix) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const output = plan.output
        ? await issueNewEpcs(plan.output.kind, plan.output.count, companyPrefix)
        : [];
      const input = plan.input
        ? await issueNewEpcs(plan.input.kind, plan.input.count, companyPrefix)
        : [];
      const blob = await fetchPrefilledTemplate(
        template.id,
        prefillFields(identSpecFor(template.id), output, input),
      );
      const tag = (output[0] ?? input[0])?.split('.').pop() ?? new Date().toISOString().slice(0, 10);
      const fileName = `${template.id.replace(/^pdf_/, '')}_${tag}.pdf`;
      saveBlob(blob, fileName);
      setDone(fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-night-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
          >
            <motion.div
              initial={{ y: '100%', opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-full sm:max-w-md bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden"
            >
              <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
                <h2 className="text-lg font-bold text-white min-w-0">Vorlage herunterladen</h2>
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                  aria-label="Schließen"
                >
                  <X className="w-4 h-4 text-night-300" />
                </button>
              </div>

              <div className="px-5 pb-4 space-y-3">
                <select
                  aria-label="Vorlage"
                  value={templateId}
                  onChange={(e) => {
                    setTemplateId(e.target.value);
                    setDone(null);
                    setError(null);
                  }}
                  disabled={busy}
                  className="w-full px-3 py-2.5 rounded-xl bg-night-900 border border-white/10 text-sm text-white focus:outline-none focus:border-acid-400/60"
                >
                  {sorted.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>

                {done && (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-acid-400/10 border border-acid-400/30 rounded-xl">
                    <CheckCircle2 className="w-4 h-4 text-acid-300 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-night-100">{done} wurde heruntergeladen.</p>
                  </div>
                )}

                {error && (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span className="text-xs">{error}</span>
                  </div>
                )}

                {blocker && <p className="text-xs text-night-300">{blocker}</p>}
              </div>

              <div className="border-t border-white/10 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <button
                  onClick={() => void handleDownload()}
                  disabled={!!blocker || busy}
                  className="btn btn-acid w-full"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span>{busy ? 'Wird vorbereitet…' : 'Herunterladen'}</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
