import { TreePine, Factory, Package, Truck, Building2 } from 'lucide-react';

/**
 * Lieferketten-Grafik der Startseite (neue UI-Vorgabe):
 * Forst -> Saegewerk -> Haendler -> Transport -> Baustelle
 * als Zickzack ueber einem abgedunkelten Luftbild, verbunden
 * durch gestrichelte Linien. Forst + Haendler sind lime hervorgehoben.
 */

const STEPS = [
  { label: 'Forst', icon: TreePine, highlight: true, x: 8, y: 62 },
  { label: 'Sägewerk', icon: Factory, highlight: false, x: 29, y: 28 },
  { label: 'Händler', icon: Package, highlight: true, x: 50, y: 62 },
  { label: 'Transport', icon: Truck, highlight: false, x: 71, y: 28 },
  { label: 'Baustelle', icon: Building2, highlight: false, x: 92, y: 62 },
] as const;

export function SupplyChainGraphic() {
  return (
    <div className="relative w-full h-44 sm:h-52 lg:h-64 rounded-2xl overflow-hidden">
      {/* Luftbild-Hintergrund, stark abgedunkelt */}
      <img
        src="./images/VR-Demonstrator.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover opacity-25"
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
            className={`text-[10px] sm:text-xs font-semibold ${
              step.highlight ? 'text-acid-300' : 'text-night-300'
            }`}
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}
