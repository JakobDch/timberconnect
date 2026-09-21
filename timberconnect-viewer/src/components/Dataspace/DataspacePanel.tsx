import { motion } from 'framer-motion';
import { useDataspaceActivity } from '../../hooks/useDataspaceActivity';
import { DataspaceGraph } from './DataspaceGraph';

/**
 * Rahmen um den Datenraum-Graphen: Ueberschrift, Graph, eine Statuszeile.
 *
 * Die Statuszeile ist bewusst die EINZIGE Stelle mit Zahlen, und auch dort
 * nur eine: wie viele Stellen gerade antworten. Das beantwortet die Frage
 * "passiert ueberhaupt etwas?", ohne zur Auswertung zu werden. Alles
 * Weitergehende — welcher Pod was geliefert hat — gehoert in die
 * Anwendungsfaelle, nicht in eine Ladeanzeige.
 */

interface DataspacePanelProps {
  isLoading?: boolean;
  className?: string;
}

export function DataspacePanel({ isLoading = false, className = '' }: DataspacePanelProps) {
  const seq = useDataspaceActivity();

  // Die Zeile beschreibt, was gerade auf der Kette laeuft. Der Sequenzer
  // gibt immer hoechstens EINEN Strom frei, deshalb gibt es hier nichts zu
  // zaehlen — es geht um die Richtung, nicht um die Menge.
  //
  // "Datenräume" (Plural) war frueher hier falsch: es gibt EINEN Datenraum,
  // in dem viele Akteure ihre eigenen Pods halten.
  // Kein Miss-Zustand mehr: "Keine Daten an dieser Stelle" stand frueher
  // ueber Akteuren, bei denen nichts schiefgelaufen war -- es meldete nur,
  // dass ein GERATENER Dateiname nicht existierte (siehe attachSequencer).
  const status =
    seq.state === 'querying'
      ? 'Anfrage läuft durch die Kette'
      : seq.state === 'hit'
        ? 'Daten kommen zurück'
        : isLoading
          ? 'Anfrage wird vorbereitet'
          : 'Bereit';

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35, duration: 0.45 }}
      className={`rounded-3xl bg-night-800/60 border border-white/5 px-5 py-5 ${className}`}
    >
      {/* Bei Handybreite darf die Statuszeile unter die Ueberschrift rutschen
          statt sich mit ihr zu draengen. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-1">
        <h2 className="text-[11px] font-bold tracking-[0.16em] text-night-300 uppercase">
          Datenraum
        </h2>
        <span
          className={`text-[11px] font-medium tabular-nums transition-colors ${
            seq.playing ? 'text-acid-300' : 'text-night-400'
          }`}
        >
          {status}
        </span>
      </div>

      <p className="text-xs text-night-400 leading-relaxed mb-1">
        Ein Datenraum, viele Akteure: Ihre Daten bleiben bei Ihnen. Eine
        Abfrage holt sie dort ab, wo sie liegen — bei jedem einzeln.
      </p>

      <DataspaceGraph />
    </motion.section>
  );
}
