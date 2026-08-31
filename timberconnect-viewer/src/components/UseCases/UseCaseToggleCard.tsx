import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Info } from 'lucide-react';
import { ToggleSwitch } from '../UI/ToggleSwitch';
import { UseCaseIcon } from './UseCaseIcon';
import { type UseCaseDefinition } from '../../config/useCases';

interface UseCaseToggleCardProps {
  useCase: UseCaseDefinition;
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  onClick: () => void;
  /** Fuer dieses Bauteil nutzbar? Kommt aus useCaseAvailability(). */
  available?: boolean;
  /** Warum nicht — wird beim Hovern/Antippen eingeblendet. */
  unavailableReason?: string;
}

export function UseCaseToggleCard({
  useCase,
  isEnabled,
  onToggle,
  onClick,
  available = true,
  unavailableReason,
}: UseCaseToggleCardProps) {
  const isInteractive = available && isEnabled;

  // Auf dem Touchscreen gibt es kein Hovern — deshalb laesst sich der Grund
  // auch antippen. Ohne das waere die Begruendung am Geraet unerreichbar.
  const [showReason, setShowReason] = useState(false);
  const canExplain = !available && !!unavailableReason;

  return (
    <motion.div
      className={`
        relative h-full p-5 rounded-2xl border transition-all
        ${isInteractive
          ? 'bg-night-800 border-white/10 hover:border-acid-400/40'
          : 'bg-night-800/50 border-white/5'
        }
      `}
      whileHover={isInteractive ? { y: -2 } : {}}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => canExplain && setShowReason(true)}
      onMouseLeave={() => setShowReason(false)}
    >
      {/* Toggle oben rechts */}
      <div className="absolute top-4 right-4">
        <ToggleSwitch
          checked={isEnabled}
          onChange={onToggle}
          disabled={!available}
          size="sm"
        />
      </div>

      <UseCaseIcon
        useCase={useCase}
        size="lg"
        muted={!(isEnabled && available)}
        className="mb-4"
      />

      <h3
        className={`font-bold mb-1.5 text-base pr-12 ${
          isEnabled && available ? 'text-white' : 'text-night-400'
        }`}
      >
        {useCase.title}
      </h3>

      <p
        className={`text-sm leading-relaxed mb-5 line-clamp-2 ${
          isEnabled && available ? 'text-night-300' : 'text-night-400/70'
        }`}
      >
        {useCase.description}
      </p>

      {isInteractive ? (
        <button
          onClick={onClick}
          className="flex items-center text-acid-300 text-sm font-semibold hover:text-acid-200 transition-colors group"
        >
          <span>Öffnen</span>
          <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
        </button>
      ) : canExplain ? (
        <button
          type="button"
          onClick={() => setShowReason((v) => !v)}
          aria-expanded={showReason}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-night-700 hover:bg-night-600 text-night-300 rounded-full transition-colors"
        >
          <Info className="w-3.5 h-3.5" />
          Nicht verfügbar
        </button>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-night-700 text-night-300 rounded-full">
          Deaktiviert
        </span>
      )}

      {/* Begruendung — nennt den Grund, statt die Kachel wortlos auszugrauen */}
      <AnimatePresence>
        {canExplain && showReason && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            role="tooltip"
            className="absolute left-4 right-4 bottom-4 z-10 px-3.5 py-3 rounded-xl bg-night-950/95 border border-acid-400/30 shadow-xl shadow-black/50 backdrop-blur-sm"
          >
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-acid-300 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-night-200 leading-relaxed">
                {unavailableReason}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
