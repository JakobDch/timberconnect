/**
 * TimberConnect Markenzeichen der neuen UI-Vorgabe:
 * Baumring-Icon in Acid-Lime + TIMBERCONNECT-Wortmarke.
 */

interface TreeRingLogoProps {
  className?: string;
}

export function TreeRingIcon({ className = 'w-8 h-8' }: TreeRingLogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Baumringe: konzentrische, leicht offene Arcs */}
      <circle
        cx="16"
        cy="16"
        r="13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="66 16"
        strokeDashoffset="8"
      />
      <circle
        cx="16"
        cy="16"
        r="9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="42 14"
        strokeDashoffset="-14"
      />
      <circle
        cx="16"
        cy="16"
        r="5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="24 7"
        strokeDashoffset="4"
      />
      <circle cx="16" cy="16" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function BrandWordmark({ className = '' }: TreeRingLogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <TreeRingIcon className="w-8 h-8 text-acid-400 flex-shrink-0" />
      <span className="text-white font-extrabold tracking-[0.14em] text-sm sm:text-base select-none">
        TIMBERCONNECT
      </span>
    </div>
  );
}
