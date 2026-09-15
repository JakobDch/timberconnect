/**
 * Segmentierte Auswahl -- eine Wahl aus wenigen, gleichrangigen Optionen.
 *
 * Die Form stammt aus den Zugriffseinstellungen (RoleAccessSettings), wo sie
 * als lokale TabButton-Komponente entstanden ist. Hier ist sie generisch,
 * damit nicht jede Ansicht ihre eigene Variante baut.
 *
 * Auf schmalen Bildschirmen (Handy) duerfen die Beschriftungen umbrechen:
 * drei Segmente mit ``whitespace-nowrap`` liefen sonst ueber den rechten
 * Rand hinaus und wurden abgeschnitten. Ab ``sm`` bleibt alles einzeilig --
 * dann darf die Gruppe im umgebenden Flex-Layout aber nicht schrumpfen
 * (``sm:shrink-0``), sonst laufen die einzeiligen Beschriftungen ueber die
 * Segmentgrenzen hinaus.
 *
 * Ab ``sm`` haben die Segmente ausserdem ihre Inhaltsbreite als Basis
 * (``sm:flex-auto``, nicht ``flex-1``). Mit Basis 0 misst Chrome die Gruppe
 * zwar als Summe der Inhaltsbreiten, verteilt sie dann aber in gleiche
 * Drittel -- das laengste Segment ("Nur dieses Produkt") lief ueber den
 * rechten Rand in den Hinweistext hinein. Auf dem Handy (volle Breite,
 * Umbruch erlaubt) bleiben gleiche Drittel richtig.
 */

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  /** Erscheint als Titel beim Ueberfahren -- Platz fuer die lange Erklaerung. */
  hint?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Sperrt die ganze Gruppe, z.B. waehrend nachgeladen wird. */
  disabled?: boolean;
  /** Beschriftung fuer Screenreader, wenn keine sichtbare daneben steht. */
  ariaLabel?: string;
  /** Zusaetzliche Klassen fuer die Gruppe, z.B. Breite im umgebenden Layout. */
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  ariaLabel,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`flex items-stretch gap-1 p-1 rounded-xl bg-night-700/50 border border-white/10 ${
        disabled ? 'opacity-60' : ''
      } ${className}`}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            role="radio"
            aria-checked={active}
            title={option.hint}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={`flex-1 sm:flex-auto min-w-0 px-2 sm:px-3 py-2 rounded-lg text-sm font-semibold leading-tight text-center transition-colors sm:whitespace-nowrap ${
              active ? 'bg-acid-400 text-night-950' : 'text-night-300 hover:text-white'
            } ${disabled ? 'cursor-not-allowed' : ''}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
