import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import { useAuth } from '../../auth/AuthContext';
import { getAuthFetch } from '../../services/authFetch';
import {
  DAMAGE_KINDS,
  createDamageReport,
  emptyDamageDraft,
  validateDamageReport,
  type DamageKind,
  type DamageReportDraft,
  type DamageReportRecord,
} from '../../services/damageReportService';

/**
 * Erfassung einer Schadensmeldung am gescannten Bauteil.
 *
 * Der Anwendungsfall ist aus Sicht der Versicherungsgutachterin gedacht: sie
 * gleicht im Schadensfall die dokumentierten Daten mit dem IST-Zustand vor Ort
 * ab (Handskizze zum Awf). Dieses Sheet erfasst diesen IST-Zustand.
 *
 * Die Validierung liegt vollstaendig im Service -- hier wird nur angezeigt,
 * was sie sagt. ``hint`` blockiert bewusst NICHT: der Hinweis auf die fehlende
 * Feuchtemessung soll zum besseren Nachweis anregen, aber niemanden davon
 * abhalten, einen Schaden ueberhaupt zu melden.
 */

interface DamageReportSheetProps {
  /** EPC des betroffenen Bauteils. */
  epc: string;
  /** Anzeigename fuers Sheet -- nur Kontext, nicht gespeichert. */
  componentName: string | null;
  onClose: () => void;
  /** Meldung gespeichert -- die Ansicht nimmt sie in ihre Liste auf. */
  onSaved: (record: DamageReportRecord) => void;
}

/** Feldrahmen mit Label und Fehlerzustand (Muster aus ProfileSheet). */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold text-night-300">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-night-300 leading-relaxed">{hint}</p>}
    </div>
  );
}

const INPUT_CLASS =
  'w-full px-3 py-2 rounded-xl bg-night-900 border border-white/10 text-sm text-night-100 placeholder:text-night-400 focus:outline-none focus:border-acid-400/60';

export function DamageReportSheet({
  epc,
  componentName,
  onClose,
  onSaved,
}: DamageReportSheetProps) {
  useBodyScrollLock(true);
  const { isLoggedIn, webId } = useAuth();

  const [draft, setDraft] = useState<DamageReportDraft>(() => emptyDamageDraft(epc));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Erst nach dem ersten Absendeversuch meckern -- sonst ist das Formular
      schon rot, bevor irgendetwas eingegeben wurde. */
  const [touched, setTouched] = useState(false);

  const validation = useMemo(() => validateDamageReport(draft), [draft]);

  const update = <K extends keyof DamageReportDraft>(key: K, value: DamageReportDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaveError(null);
  };

  const handleSubmit = async () => {
    setTouched(true);
    if (!validation.ok) return;
    if (!isLoggedIn || !webId) {
      setSaveError('Zum Melden eines Schadens ist eine Anmeldung erforderlich.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const record = await createDamageReport(draft, webId, getAuthFetch());
      onSaved(record);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SheetPortal>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div
          className="absolute inset-0 bg-night-950/80 backdrop-blur-sm"
          onClick={saving ? undefined : onClose}
        />
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          // max-h-[92%] statt vh: Prozent misst gegen das `fixed inset-0`
          // darueber, also gegen den WIRKLICH sichtbaren Bereich. `90vh` meint
          // auf iOS Safari die Hoehe MIT eingefahrener Adressleiste -- steht
          // sie, rutschten die Knoepfe unter die Browserleiste. Aufteilung in
          // festen Kopf + scrollenden Rumpf wie in allen anderen Sheets.
          className="relative w-full sm:max-w-lg max-h-[92%] sm:max-h-[85%] flex flex-col bg-night-800 border border-white/10 rounded-t-3xl sm:rounded-3xl"
        >
          <div className="flex items-start justify-between gap-3 p-5 pb-4 flex-shrink-0">
            <div className="min-w-0">
              <h2 className="text-lg font-extrabold text-white">Schaden melden</h2>
              <p className="text-xs text-night-300 mt-1 truncate">
                {componentName ?? 'Bauteil'}
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={saving}
              aria-label="Schließen"
              className="p-1.5 rounded-lg text-night-300 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50 flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* pb-[max(...)] haelt die Knoepfe ueber dem Home-Indicator. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="space-y-4">
            <Field id="damage-date" label="Schadensdatum">
              <input
                id="damage-date"
                type="date"
                value={draft.date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => update('date', e.target.value)}
                className={INPUT_CLASS}
              />
            </Field>

            <Field id="damage-kind" label="Schadensart">
              <select
                id="damage-kind"
                value={draft.kind}
                onChange={(e) => update('kind', e.target.value as DamageKind | '')}
                className={INPUT_CLASS}
              >
                <option value="">Bitte auswählen …</option>
                {DAMAGE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id="damage-description"
              label="Beschreibung"
              hint="Was ist zu sehen, wo am Bauteil, seit wann?"
            >
              <textarea
                id="damage-description"
                rows={4}
                value={draft.description}
                onChange={(e) => update('description', e.target.value)}
                placeholder="z. B. dunkle Verfärbung an der Unterseite, ca. 40 × 20 cm, seit dem Starkregen am Vortag"
                className={`${INPUT_CLASS} resize-none`}
              />
            </Field>

            <Field id="damage-reporter" label="Gemeldet von">
              <input
                id="damage-reporter"
                type="text"
                value={draft.reportedBy}
                onChange={(e) => update('reportedBy', e.target.value)}
                placeholder="Name oder Funktion, z. B. Bauleitung HB-2026-0047"
                className={INPUT_CLASS}
              />
            </Field>

            <Field
              id="damage-moisture"
              label="Gemessene Holzfeuchte (%)"
              hint="Optional — aber der Wert, an dem sich die Schuldfrage bei Feuchteschäden entscheidet."
            >
              <input
                id="damage-moisture"
                type="text"
                inputMode="decimal"
                value={draft.moisture}
                onChange={(e) => update('moisture', e.target.value)}
                placeholder="z. B. 18,5"
                className={INPUT_CLASS}
              />
            </Field>
          </div>

          {/* Hinweis (nicht blockierend) */}
          {validation.hint && !saveError && (
            <p className="mt-4 text-xs text-night-300 leading-relaxed">{validation.hint}</p>
          )}

          {/* Fehler -- erst nach dem ersten Absendeversuch */}
          {((touched && validation.error) || saveError) && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-400/10 border border-amber-400/30 px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-100 leading-relaxed">
                {saveError ?? validation.error}
              </p>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-semibold text-night-200 hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              Abbrechen
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-acid-400 text-night-950 text-sm font-semibold hover:bg-acid-300 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Speichern …' : 'Meldung speichern'}
            </button>
          </div>

          <p className="mt-3 text-[11px] text-night-300 leading-relaxed">
            Die Meldung wird in Ihrem eigenen Pod gespeichert und mit dem Bauteil
            verknüpft. Das Erfassen ist kostenfrei.
          </p>
          </div>
        </motion.div>
      </div>
    </SheetPortal>
  );
}
