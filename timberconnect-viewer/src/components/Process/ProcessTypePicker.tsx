import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Axe,
  ChevronRight,
  Clock,
  Factory,
  Info,
  Ruler,
  Sprout,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  processTypesForRole,
  type ProcessType,
  type ProcessTypeId,
} from '../../services/processService';
import { useAuth } from '../../auth/AuthContext';

/**
 * Schritt 1 des Uploads: Welcher Vorgang im Leben des Produkts wird
 * registriert? Nicht die Datei ist der Einstieg, sondern der Lebensabschnitt.
 *
 * Gezeigt werden ausschliesslich die Vorgaenge der eigenen Rolle. Fremde
 * Vorgaenge erscheinen nicht — weder ausgegraut noch mit Hinweis, denn eine
 * sichtbare, aber unwaehlbare Option ist nur eine Sackgasse mit Beschriftung.
 *
 * Vorgaenge, deren Pflichtdatei-Format noch nicht implementiert ist, bleiben
 * waehlbar, tragen aber das Badge "Format folgt" — der Slot akzeptiert dann
 * vorerst eine beliebige Datei als Platzhalter.
 */

// Lucide hat keine "Saw"-Ikone; Axe steht fuer die Faellung, Factory fuer
// beide Werksvorgaenge (Aufsaegen/Herstellung wird ueber das Label getrennt).
const PROCESS_ICONS: Record<ProcessType['icon'], LucideIcon> = {
  sprout: Sprout,
  axe: Axe,
  saw: Factory,
  factory: Factory,
  // Die Ausfuehrungsplanung ist kein Werksvorgang -- Ruler steht fuer das
  // Planungsmodell und grenzt sie sichtbar von den drei Fabrik-Ikonen ab.
  blueprint: Ruler,
};

interface ProcessTypePickerProps {
  selected: ProcessTypeId | null;
  onSelect: (type: ProcessTypeId) => void;
  disabled?: boolean;
}

export function ProcessTypePicker({ selected, onSelect, disabled = false }: ProcessTypePickerProps) {
  const { role } = useAuth();
  const types = useMemo(() => processTypesForRole(role?.id), [role]);

  // Rollen, die keinen eigenen Vorgang durchfuehren (Versicherer, Finanzamt,
  // Forschung, ...). Sie lesen den Datenraum, sie speisen ihn nicht — das
  // gehoert gesagt, statt eine leere Flaeche zu zeigen.
  if (types.length === 0) {
    return (
      <div className="flex items-start gap-3 px-4 py-3.5 bg-night-700/40 border border-white/10 rounded-2xl">
        <Info className="w-4 h-4 text-night-300 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-white">
            Für Ihre Rolle ist kein Vorgang vorgesehen
          </p>
          <p className="text-xs text-night-300 mt-1 leading-relaxed">
            {role?.label ?? 'Ihre Rolle'} registriert selbst keine Vorgänge im
            Leben des Produkts. Sie können weiterhin freigegebene Daten
            einsehen und Dateien zu bestehenden Vorgängen nachreichen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {types.map((type, index) => {
        const Icon = PROCESS_ICONS[type.icon];
        const isSelected = selected === type.id;
        const isPending = type.leadDoc.status === 'pending';

        return (
          <motion.button
            key={type.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
            onClick={() => onSelect(type.id)}
            disabled={disabled}
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-all group border disabled:opacity-50 disabled:cursor-not-allowed ${
              isSelected
                ? 'bg-acid-400/10 border-acid-400/50'
                : 'bg-night-700/50 hover:bg-night-700/80 border-white/5 hover:border-acid-400/40'
            }`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                isSelected
                  ? 'bg-acid-400 border-acid-300 text-night-950'
                  : 'bg-acid-400/15 border-acid-400/30 text-acid-300'
              }`}
            >
              <Icon className="w-5 h-5" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-white">{type.label}</span>
                {isPending && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 flex-shrink-0">
                    <Clock className="w-2.5 h-2.5" />
                    Format folgt
                  </span>
                )}
              </div>
              <p className="text-xs text-night-400 mt-0.5">{type.description}</p>
              <p className="text-xs text-night-300 mt-1">
                Pflichtdatei:{' '}
                <span className="text-night-300">
                  {type.leadDoc.label} ({type.leadDoc.fileExt})
                </span>
              </p>
            </div>

            <ChevronRight
              className={`w-5 h-5 flex-shrink-0 transition-colors ${
                isSelected ? 'text-acid-300' : 'text-night-400 group-hover:text-acid-300'
              }`}
            />
          </motion.button>
        );
      })}
    </div>
  );
}
