import logoMark from '/timberconnect-logo.png';

/**
 * TimberConnect Markenzeichen: Baumring-Icon + TIMBERCONNECT-Wortmarke.
 *
 * Gezeigt wird die Bilddatei der offiziellen Vorlage ("Logo gelb.png",
 * Rueckmeldung Anni 24.08.2026), auf den Inhalt zugeschnitten und quadratisch
 * gefasst. Bewusst KEIN SVG-Nachbau: das Zeichen besteht aus zehn Boegen um
 * zwei leicht versetzte Mittelpunkte, und jeder Nachbau weicht im Detail ab --
 * beim Logo ist genau das der Fehler, den die Rueckmeldung beanstandet hat.
 * Die Datei ist die Wahrheit; wird sie ersetzt, zieht die App automatisch mit.
 *
 * Die Vorlage traegt ihr Gelb bereits selbst (#DFE94B -- exakt acid-400), sie
 * wird deshalb nicht eingefaerbt.
 */

interface TreeRingLogoProps {
  className?: string;
}

export function TreeRingIcon({ className = 'w-8 h-8' }: TreeRingLogoProps) {
  return (
    <img
      src={logoMark}
      alt=""
      aria-hidden="true"
      className={`${className} object-contain select-none`}
      draggable={false}
    />
  );
}

export function BrandWordmark({ className = '' }: TreeRingLogoProps) {
  return (
    <div className={`flex items-center gap-2.5 min-w-0 ${className}`}>
      {/* Etwas groesser als die Wortmarke hoch ist: die feinen Ringe der
          Vorlage brauchen Flaeche, sonst laufen sie ineinander. */}
      <TreeRingIcon className="w-9 h-9 sm:w-10 sm:h-10 flex-shrink-0" />
      {/* Das enge tracking macht den Schriftzug ~116px breit -- zusammen mit
          Wallet und Benutzermenue passt er auf schmalen Telefonen nicht mehr
          in die Zeile. Unter 380px traegt das Ringsymbol die Marke allein;
          darueber steht der Schriftzug wieder, dann kuerzbar statt schiebend. */}
      <span className="hidden min-[380px]:block text-white font-extrabold tracking-[0.14em] text-sm sm:text-base select-none truncate">
        TIMBERCONNECT
      </span>
    </div>
  );
}
