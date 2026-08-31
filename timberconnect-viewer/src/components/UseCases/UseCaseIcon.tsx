import { DEFAULT_USE_CASE_ICON, type UseCaseDefinition } from '../../config/useCases';

/**
 * Einheitliche Darstellung eines Anwendungsfall-Symbols.
 *
 * Das Symbol SELBST kam schon immer aus der Registry (config/useCases) und war
 * damit ueberall dasselbe -- der Rahmen drumherum aber nicht: die Kachel auf
 * der Startseite zeigte es lime auf transparentem Lime in rounded-xl, die
 * Toggle-Karte dunkel auf vollflaechigem Lime, das Seitenmenue lime auf Weiss
 * in rounded-full. Derselbe Anwendungsfall sah dadurch an drei Stellen
 * verschieden aus (Rueckmeldung Anni, 24.08.2026: "Die Icons der Awf sollten
 * immer einheitlich sein").
 *
 * Deshalb liegt die Darstellung jetzt hier, analog zur Registry: ein Ort,
 * drei Groessen, ein Erscheinungsbild. Wer eine weitere Oberflaeche baut,
 * nimmt diese Komponente und erbt das Aussehen automatisch mit.
 *
 * Gestalterisch gewinnt die Variante der Toggle-Karte -- vollflaechiges Lime
 * mit dunklem Symbol: sie hat den staerksten Kontrast und trug den
 * "aktiv"-Zustand schon vorher.
 */

interface UseCaseIconProps {
  useCase: UseCaseDefinition;
  /** Gedaempft darstellen (nicht verfuegbar / abgeschaltet). */
  muted?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: { box: 'w-8 h-8 rounded-lg', icon: 'w-4 h-4' },
  md: { box: 'w-11 h-11 rounded-xl', icon: 'w-5 h-5' },
  lg: { box: 'w-12 h-12 rounded-xl', icon: 'w-6 h-6' },
} as const;

export function UseCaseIcon({
  useCase,
  muted = false,
  size = 'md',
  className = '',
}: UseCaseIconProps) {
  const Icon = useCase.icon ?? DEFAULT_USE_CASE_ICON;
  const { box, icon } = SIZES[size];

  return (
    <div
      className={`${box} flex items-center justify-center border flex-shrink-0 ${
        muted
          ? 'bg-night-700 border-white/5'
          : 'bg-acid-400 border-acid-300 shadow-lg shadow-acid-400/20'
      } ${className}`}
    >
      <Icon className={`${icon} ${muted ? 'text-night-400' : 'text-night-950'}`} />
    </div>
  );
}
