/**
 * Segmentierte Auswahl -- eine Wahl aus wenigen, gleichrangigen Optionen.
 *
 * Die Form stammt aus den Zugriffseinstellungen (RoleAccessSettings), wo sie
 * als lokale TabButton-Komponente entstanden ist. Hier ist sie generisch,
 * damit nicht jede Ansicht ihre eigene Variante baut.
 *
 * Auf schmalen Bildschirmen (Handy) duerfen die Beschriftungen umbrechen:
 * drei Segmente mit ``whitespace-nowrap`` liefen sonst ueber den rechten
 * Rand hinaus und wurden abgeschnitten. Ab ``sm`` bleibt alles einzeilig.
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
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`flex items-stretch gap-1 p-1 rounded-xl bg-night-700/50 border border-white/10 ${
        disabled ? 'opacity-60' : ''
      }`}
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
            className={`flex-1 min-w-0 px-2 sm:px-3 py-2 rounded-lg text-sm font-semibold leading-tight text-center transition-colors sm:whitespace-nowrap ${
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
