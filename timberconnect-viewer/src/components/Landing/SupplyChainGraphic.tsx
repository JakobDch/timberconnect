import {
  TreePine,
  Factory,
  Package,
  Truck,
  DraftingCompass,
  Building2,
} from 'lucide-react';

/**
 * Lieferketten-Grafik der Startseite:
 * Forstbetrieb -> Saegewerk -> Holzwerkstoffproduzent -> Transportunternehmen
 * -> Fachplaner Holzbau -> Holzbauunternehmen als Zickzack ueber dem
 * Luftbild, verbunden durch gestrichelte Linien.
 *
 * Stand 17.09.2026 (Rueckmeldung Praxispartner, "Feedback App_Allgemein",
 * Folie 1): Die Stationen heissen wie die Rollen im Zugriffsmodell
 * (config/roles.ts) -- "Forst", "Transport" und "Baustelle" waren keine
 * Rollen. "Fachplaner Holzbau" kam hinzu: er registriert die
 * Ausfuehrungsplanung und ist damit die letzte Station, die eigene Daten in
 * den Datenraum gibt. ALLE Stationen sind lime hervorgehoben (vorher nur
 * Forst und Produzent), und das Luftbild ist weniger stark abgedunkelt.
 *
 * Die Rollennamen sind lang ("Holzwerkstoffproduzent" ist rund dreimal so
 * lang wie das alte "Haendler"); deshalb bekommt jede Station eine
 * Breitenbegrenzung und darf am weichen Trennzeichen umbrechen, statt in die
 * Nachbarn zu laufen.
 *
 * Das Luftbild liegt mit object-contain, nicht object-cover: es ist mit rund
 * 2,3:1 hoeher als der flache Container und wuerde formatfuellend oben und
 * unten angeschnitten. Die Grafik zeigt aber die Kette vom Wald bis zur
 * Stadt -- angeschnitten verliert sie ihre Aussage. Lieber Leerraum an den
 * Seiten als ein halber Bogen.
 */

// x-Positionen 10..90 %: der Container schneidet ab (overflow-hidden), und
// die Beschriftung ist auf dem Handy 68 px breit -- bei 8/92 % ragte
// "Holzbauunternehmen" bei 390 px Bildschirmbreite ueber den rechten Rand
// (Mobile-Vorschau, 18.09.2026). 10 % von 358 px sind 36 px bis zur Mitte,
// die halbe Beschriftung braucht 34.
const STEPS = [
  { label: 'Forstbetrieb', icon: TreePine, x: 10, y: 62 },
  { label: 'Sägewerk', icon: Factory, x: 26, y: 26 },
  { label: 'Holzwerkstoff­produzent', icon: Package, x: 42, y: 62 },
  { label: 'Transport­unternehmen', icon: Truck, x: 58, y: 26 },
  { label: 'Fachplaner Holzbau', icon: DraftingCompass, x: 74, y: 62 },
  { label: 'Holzbau­unternehmen', icon: Building2, x: 90, y: 26 },
] as const;

export function SupplyChainGraphic() {
  return (
    <div className="relative w-full h-52 sm:h-60 lg:h-72 rounded-2xl overflow-hidden">
      {/* Luftbild-Hintergrund -- gedaempft, aber erkennbar (vorher 25 %) */}
      <img
        src={`${import.meta.env.BASE_URL}images/VR-Demonstrator.png`}
        alt=""
        className="absolute inset-0 w-full h-full object-contain opacity-55"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-night-900/80 via-night-900/20 to-night-900/50" />

      {/* Gestrichelte Verbindungslinien */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline
          points={STEPS.map((s) => `${s.x},${s.y}`).join(' ')}
          fill="none"
          stroke="rgba(223, 233, 75, 0.55)"
          strokeWidth="0.5"
          strokeDasharray="1.6 1.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* Stationen -- alle in der Akzentfarbe (Vorgabe Praxispartner) */}
      {STEPS.map((step) => (
        <div
          key={step.label}
          className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1"
          style={{ left: `${step.x}%`, top: `${step.y}%` }}
        >
          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center border bg-acid-400 border-acid-300 text-night-950 shadow-lg shadow-acid-400/30">
            <step.icon className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <span
            className="text-[10px] sm:text-xs font-semibold text-center leading-tight w-[4.25rem] sm:w-[5.5rem] text-acid-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
            lang="de"
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}
