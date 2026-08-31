import { TreePine, Factory, Package, Truck, Building2 } from 'lucide-react';

/**
 * Lieferketten-Grafik der Startseite:
 * Forst -> Saegewerk -> Holzwerkstoffproduzent -> Transport -> Baustelle
 * als Zickzack ueber einem abgedunkelten Luftbild, verbunden
 * durch gestrichelte Linien. Forst + Produzent sind lime hervorgehoben.
 *
 * "Haendler" hiess die mittlere Station bis 24.08.2026 -- fachlich falsch,
 * es ist der Holzwerkstoffproduzent (Rueckmeldung Anni). Das Wort ist rund
 * dreimal so lang wie das alte und wuerde bei fester Position in die
 * Nachbarn laufen; deshalb bekommt jede Station eine Breitenbegrenzung und
 * darf umbrechen, statt den Text zu beschneiden.
 *
 * Das Luftbild liegt mit object-contain, nicht object-cover: es ist mit rund
 * 2,3:1 hoeher als der flache Container und wuerde formatfuellend oben und
 * unten angeschnitten. Die Grafik zeigt aber die Kette vom Wald bis zur
 * Stadt -- angeschnitten verliert sie ihre Aussage. Lieber Leerraum an den
 * Seiten als ein halber Bogen.
 */

const STEPS = [
  { label: 'Forst', icon: TreePine, highlight: true, x: 12, y: 60 },
  { label: 'Sägewerk', icon: Factory, highlight: false, x: 31, y: 27 },
  {
    label: 'Holzwerkstoff­produzent',
    icon: Package,
    highlight: true,
    x: 50,
    y: 60,
  },
  { label: 'Transport', icon: Truck, highlight: false, x: 69, y: 27 },
  { label: 'Baustelle', icon: Building2, highlight: false, x: 88, y: 60 },
] as const;

export function SupplyChainGraphic() {
  return (
    <div className="relative w-full h-52 sm:h-60 lg:h-72 rounded-2xl overflow-hidden">
      {/* Luftbild-Hintergrund, stark abgedunkelt */}
      <img
        src={`${import.meta.env.BASE_URL}images/VR-Demonstrator.png`}
        alt=""
        className="absolute inset-0 w-full h-full object-contain opacity-25"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-night-900 via-night-900/40 to-night-900/70" />

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
          stroke="rgba(223, 233, 75, 0.45)"
          strokeWidth="0.5"
          strokeDasharray="1.6 1.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* Stationen */}
      {STEPS.map((step) => (
        <div
          key={step.label}
          className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1"
          style={{ left: `${step.x}%`, top: `${step.y}%` }}
        >
          <div
            className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center border ${
              step.highlight
                ? 'bg-acid-400 border-acid-300 text-night-950 shadow-lg shadow-acid-400/30'
                : 'bg-night-700/90 border-white/10 text-night-200'
            }`}
          >
            <step.icon className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <span
            className={`text-[10px] sm:text-xs font-semibold text-center leading-tight w-[4.5rem] sm:w-20 hyphens-auto ${
              step.highlight ? 'text-acid-300' : 'text-night-300'
            }`}
            lang="de"
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}
