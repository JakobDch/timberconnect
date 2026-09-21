import { ArrowRight, Loader2 } from 'lucide-react';
import { SegmentedControl, type SegmentedOption } from '../UI/SegmentedControl';
import type { ProductStage } from '../../services/productImageService';
import type { ChainScope } from '../../services/supplyChainWalk';

/**
 * Umfang der Kette -- als Bild, nicht nur als Schalter.
 *
 * Vorschlag der Praxispartner ("Feedback App_Allgemein", 17.09.2026,
 * Folien 5-7): Der Umfang war als Wort ("Ganze Kette", "Herkunft", "Nur
 * dieses Produkt") schwer zu verstehen. Jetzt zeigt eine Abbildung die vier
 * identifizierten Stufen Baum -> Rundholz -> Schnittholz -> BSP; die
 * gescannte Stufe ist eingekreist, und was ausserhalb des gewaehlten
 * Umfangs liegt, wird abgeblendet.
 *
 * Die Wahl hat nur noch ZWEI Stellungen (Vorgabe):
 *   "Gesamte Kette"        -> alles, was mit dem Bauteil verknuepft ist,
 *                             auch was daraus entstanden ist (scope 'full')
 *   "Vorangegangene Kette" -> das Bauteil und seine Vorstufen (scope 'upstream')
 *
 * Bei der BSP-Platte gibt es keine Wahl: sie ist das Ende der Kette, ihre
 * "vorangegangene" und ihre "gesamte" Kette sind dasselbe. Der Schalter
 * entfaellt dort, der Text sagt, warum.
 *
 * "Nur dieses Produkt" (scope 'self') wird nicht mehr angeboten. Der Wert
 * bleibt im Typ ChainScope, weil Kettenverfolgung und Kaufregister ihn
 * kennen; erreichbar ist er ueber die Oberflaeche nicht mehr.
 *
 * Die Bilder sind Ausschnitte der von den Partnern gelieferten Grafik
 * (public/images/chain-*.png, siehe LIESMICH.md dort).
 */

const STAGES: { stage: ProductStage; label: string; file: string; alt: string }[] = [
  { stage: 'seedling', label: 'Baum', file: 'chain-seedling.png', alt: 'Stehende Baeume im Wald' },
  { stage: 'stem', label: 'Rundholz', file: 'chain-stem.png', alt: 'Gestapelte Rundholzstaemme' },
  { stage: 'lamella', label: 'Schnittholz', file: 'chain-lamella.png', alt: 'Gestapeltes Schnittholz' },
  { stage: 'clt-panel', label: 'BSP', file: 'chain-clt-panel.png', alt: 'Brettsperrholzplatte' },
];

const SCOPE_OPTIONS: SegmentedOption<ChainScope>[] = [
  {
    id: 'full',
    label: 'Gesamte Kette',
    hint: 'Alles, was mit diesem Bauteil verknüpft ist — auch was daraus entstanden ist.',
  },
  {
    id: 'upstream',
    label: 'Vorangegangene Kette',
    hint: 'Das Bauteil und seine Vorstufen — nichts, was zeitlich danach kommt.',
  },
];

interface ChainScopePickerProps {
  /** Erkannte Stufe des gescannten Objekts; null = nicht bestimmbar. */
  stage: ProductStage | null;
  scope: ChainScope;
  onChange?: (scope: ChainScope) => void;
  /** Waehrend nachgeladen wird. */
  loading?: boolean;
}

export function ChainScopePicker({
  stage,
  scope,
  onChange,
  loading = false,
}: ChainScopePickerProps) {
  const scannedIndex = stage ? STAGES.findIndex((s) => s.stage === stage) : -1;
  const isPanel = stage === 'clt-panel';

  /** Liegt die Stufe im gewaehlten Umfang? Ohne bekannte Stufe: alles. */
  const inScope = (index: number): boolean => {
    if (scannedIndex < 0 || scope === 'full') return true;
    if (scope === 'upstream') return index <= scannedIndex;
    return index === scannedIndex; // 'self' -- nur noch aus Altzustand erreichbar
  };

  const hint = isPanel
    ? 'Bei einer BSP-Platte wird immer die gesamte Kette angezeigt — sie ist das Ende der Kette.'
    : (SCOPE_OPTIONS.find((o) => o.id === scope)?.hint ??
      SCOPE_OPTIONS[0].hint);

  return (
    <div className="mb-6 rounded-2xl bg-night-800 border border-white/5 p-4 sm:p-5">
      {/* Kopfzeile: Beschriftung + Schalter (oder Festwert bei BSP) */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 text-sm shrink-0">
          <span className="font-semibold text-white">Umfang</span>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-sky-400" />}
        </div>
        {isPanel ? (
          <span className="inline-flex self-start items-center px-3 py-1.5 rounded-full bg-acid-400/15 border border-acid-400/30 text-acid-300 text-sm font-semibold">
            Gesamte Kette
          </span>
        ) : (
          <SegmentedControl
            ariaLabel="Umfang der Lieferkette"
            options={SCOPE_OPTIONS}
            value={scope === 'upstream' ? 'upstream' : 'full'}
            onChange={(next) => onChange?.(next)}
            disabled={loading || !onChange}
            className="w-full sm:w-auto sm:shrink-0"
          />
        )}
        <p className="text-xs text-night-400 sm:flex-1 sm:min-w-0">{hint}</p>
      </div>

      {/* Abbildung der Kette */}
      <ol
        className="mt-4 flex items-end justify-between gap-1 sm:gap-3"
        aria-label="Stufen der Wertschöpfungskette"
      >
        {STAGES.map((entry, index) => {
          const active = inScope(index);
          const scanned = index === scannedIndex;
          return (
            <li key={entry.stage} className="contents">
              {index > 0 && (
                <ArrowRight
                  aria-hidden="true"
                  className={`w-5 h-5 sm:w-6 sm:h-6 mb-7 sm:mb-8 flex-shrink-0 transition-opacity ${
                    active && inScope(index - 1) ? 'text-acid-400' : 'text-night-600 opacity-40'
                  }`}
                />
              )}
              <div
                className={`flex-1 min-w-0 flex flex-col items-center gap-1.5 rounded-2xl px-1 py-2 sm:px-2 sm:py-3 border transition-all ${
                  scanned
                    ? 'border-acid-400 bg-acid-400/10 shadow-[0_0_24px_rgba(223,233,75,0.25)]'
                    : 'border-transparent'
                } ${active ? '' : 'opacity-30 grayscale'}`}
                aria-current={scanned ? 'true' : undefined}
              >
                <div className="h-14 sm:h-20 w-full flex items-end justify-center">
                  <img
                    src={`${import.meta.env.BASE_URL}images/${entry.file}`}
                    alt={entry.alt}
                    className="max-h-full max-w-full object-contain"
                    draggable={false}
                  />
                </div>
                <span
                  className={`text-[11px] sm:text-xs font-semibold text-center leading-tight ${
                    scanned ? 'text-acid-300' : 'text-night-200'
                  }`}
                >
                  {entry.label}
                </span>
                <span
                  className={`text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider leading-none ${
                    scanned ? 'text-acid-300' : 'text-transparent'
                  }`}
                >
                  Gescannt
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
