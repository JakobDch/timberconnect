import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TreePine,
  Factory,
  Package,
  Truck,
  DraftingCompass,
  Building2,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useDataspaceActivity } from '../../hooks/useDataspaceActivity';
import { LEG_DURATION, RETURN_DURATION } from '../../services/dataspaceSequencer';
import {
  loadDataspaceNodes,
  type DataspaceNode,
} from '../../services/dataspaceTopology';
import { STAGES, type StageId } from '../../services/dataspaceStages';

/**
 * Der Datenraum als Bild — was beim Scannen im Hintergrund passiert.
 *
 * Anlass (18.09.2026): waehrend eines Scans drehte sich nur ein Kreis. Die
 * Anwendung wirkte simpler als sie ist, und eine langsame Abfrage sah nach
 * Fehler aus statt nach Arbeit.
 *
 * AUFBAU — zwei Zustaende, dieselbe Kette:
 *
 *   RUHE     Die Lieferkette als Zickzack mit Icons, genau wie auf der
 *            Startseite (Landing/SupplyChainGraphic): Forstbetrieb, Saegewerk,
 *            Holzwerkstoffe, Transport, Fachplanung, Holzbau. Ein vertrautes
 *            Bild, das keine neue Erklaerung braucht.
 *
 *   ABFRAGE  Die Icons treten zurueck und geben den Blick auf die Pods
 *            dahinter frei: je Station so viele Punkte, wie Pods dieser Rolle
 *            im Register stehen. Erst jetzt ist zu sehen, WELCHER davon der
 *            eigene ist — er leuchtet.
 *
 * Der Datenstrom fliesst ENTLANG DER KETTE, nicht sternfoermig. Will ein
 * Holzwerkstoffproduzent Daten vom Fachplaner, laeuft der Strom ueber die
 * Kettenlinie durch die Station Transport HINDURCH, ohne dort etwas
 * aufleuchten zu lassen, und bringt erst am Ziel den betroffenen Pod zum
 * Leuchten.
 *
 * Das ist die Vereinfachung, die diese Darstellung bewusst eingeht: technisch
 * fragt der eigene Pod jeden Beteiligten direkt. Ein Stern aus zwanzig
 * Speichen war als Bild aber unbrauchbar, und zwei uebereinanderliegende
 * Kantensysteme (ruhendes Netz + Abfrage-Speichen) widersprachen sich
 * sichtbar: beim Scannen erschienen Linien, die es im Ruhezustand nicht gab
 * (Rueckmeldung 21.09.2026).
 *
 * Pods OHNE lesbare Rolle erscheinen gar nicht — siehe loadDataspaceNodes.
 *
 * Die Bewegung ist NICHT dekorativ: eine Station leuchtet nur, wenn dort
 * wirklich eine Anfrage laeuft (siehe services/dataspaceActivity.ts).
 */

interface DataspaceGraphProps {
  className?: string;
}

const WIDTH = 460;
const HEIGHT = 190;

/** Waagerechter Rand — die Stationsnamen brauchen ihn. */
const PAD_X = 44;
/** Die beiden Hoehen des Zickzacks, wie auf der Startseite. */
const ROW_TOP = 66;
const ROW_BOTTOM = 122;

/**
 * Die sechs Stationen der Kette mit ihren Icons.
 *
 * Reihenfolge, Icons und Zickzack stammen aus der Startseiten-Grafik — beide
 * Ansichten sollen als dasselbe Bild erkennbar sein. 'begleitend' kommt hier
 * NICHT vor: es ist keine Station der Materialkette.
 */
const CHAIN: { id: StageId; label: string; icon: LucideIcon }[] = STAGES.filter(
  (s) => s.id !== 'begleitend',
).map((stage, i) => ({
  id: stage.id,
  label: stage.label,
  icon: [TreePine, Factory, Package, Truck, DraftingCompass, Building2][i] ?? Package,
}));

/** Waagerechte Position einer Station. */
function stationX(i: number): number {
  const step = (WIDTH - PAD_X * 2) / Math.max(CHAIN.length - 1, 1);
  return PAD_X + i * step;
}

/** Senkrechte Position — gerade Stationen unten, ungerade oben (Zickzack). */
function stationY(i: number): number {
  return i % 2 === 0 ? ROW_BOTTOM : ROW_TOP;
}

/** Waagerechter Abstand der Pod-Punkte innerhalb einer Station. */
const POD_GAP = 11;

export function DataspaceGraph({ className = '' }: DataspaceGraphProps) {
  const { webId } = useAuth();
  const [nodes, setNodes] = useState<DataspaceNode[]>([]);
  const seq = useDataspaceActivity();

  // Schriftgroessen im SVG skalieren mit der Anzeigebreite: am Handy waere der
  // Text sonst nur halb so gross wie am Schreibtisch.
  const [schmal, setSchmal] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const lies = () => setSchmal(mq.matches);
    lies();
    mq.addEventListener('change', lies);
    return () => mq.removeEventListener('change', lies);
  }, []);
  const FS_LABEL = schmal ? 9 : 7.5;

  useEffect(() => {
    let cancelled = false;
    void loadDataspaceNodes(webId ?? null).then((found) => {
      if (!cancelled) setNodes(found);
    });
    return () => {
      cancelled = true;
    };
  }, [webId]);

  /** Pods je Station, in stabiler Reihenfolge (eigener zuerst). */
  const byStage = useMemo(() => {
    const map = new Map<StageId, DataspaceNode[]>();
    for (const node of nodes) {
      const list = map.get(node.stage) ?? [];
      list.push(node);
      map.set(node.stage, list);
    }
    return map;
  }, [nodes]);

  /**
   * Der eine Pod, der gerade dran ist, und sein Zustand.
   *
   * Der Sequenzer gibt immer hoechstens EINEN frei — die Kette ist eine
   * Straße, auf der nur ein Strom zugleich laufen kann.
   */
  const aktiv = seq.playing && seq.endpoint !== null;
  const aktiverPod = aktiv
    ? (nodes.find((n) => n.id === seq.endpoint) ?? null)
    : null;

  /** Station des eigenen Pods — Ausgangspunkt jedes Datenstroms. */
  const ownStage = nodes.find((n) => n.isSelf)?.stage ?? null;

  /**
   * Der laufende Datenstrom: von der eigenen Station zur Station des gerade
   * befragten Pods — ENTLANG der Kette, also ueber alle dazwischen liegenden
   * Stationen hinweg.
   */
  const strom = useMemo(() => {
    if (!aktiverPod) return null;
    const ownIndex = ownStage ? CHAIN.findIndex((c) => c.id === ownStage) : -1;
    // Ohne Anmeldung gibt es keine eigene Station; der Strom beginnt dann am
    // Anfang der Kette. Es ist derselbe Datenraum, nur ohne eigenen Platz.
    const from = ownIndex >= 0 ? ownIndex : 0;
    const to = CHAIN.findIndex((c) => c.id === aktiverPod.stage);
    if (to < 0 || to === from) return null;
    return { from, to };
  }, [aktiverPod, ownStage]);

  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox={`0 0 ${WIDTH} ${schmal ? HEIGHT + 16 : HEIGHT}`}
        className="w-full h-auto overflow-visible"
        role="img"
        aria-label={
          aktiv
            ? 'Der Datenraum wird abgefragt: der Datenstrom läuft entlang der Lieferkette.'
            : 'Die Lieferkette des Datenraums: Forstbetrieb bis Holzbau.'
        }
      >
        <defs>
          <filter id="ds-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Die Kette: EINE durchgehende Linie ueber alle Stationen. Sie ist
            die einzige Verbindung im Bild — es gibt kein zweites Liniensystem,
            das beim Scannen dazukaeme. */}
        <polyline
          points={CHAIN.map((_, i) => `${stationX(i)},${stationY(i)}`).join(' ')}
          fill="none"
          stroke="rgba(223,233,75,0.3)"
          strokeWidth="1"
          strokeDasharray="2.5 3"
          strokeLinejoin="round"
        />

        {/* Der Datenstrom — gerichtet und in zwei Etappen:
            HINWEG  die Linie zeichnet sich vom eigenen Pod zum Ziel auf,
                    ein Punkt laeuft voran.
            RUECKWEG bei einem Treffer laeuft der Punkt zurueck und die Linie
                    zieht sich hinter ihm wieder ein.
            Nur so ist zu SEHEN, was in welche Richtung fliesst; vorher
            leuchtete die ganze Verbindung auf einmal auf (Rueckmeldung
            21.09.2026). */}
        {strom && (() => {
          const { from, to } = strom;
          const von = Math.min(from, to);
          const bis = Math.max(from, to);
          const stuecke = CHAIN.slice(von, bis + 1).map(
            (_, k) => `${stationX(von + k)} ${stationY(von + k)}`,
          );
          // Der Pfad laeuft IMMER vom eigenen Pod weg, auch wenn das Ziel
          // links liegt: sonst zeichnete sich die Linie verkehrt herum auf.
          const gerichtet = from < to ? stuecke : [...stuecke].reverse();
          const pfad = `M ${gerichtet.join(' L ')}`;
          const hinweg = seq.state === 'querying';
          const treffer = seq.state === 'hit';

          return (
            <g key={seq.pulse}>
              {/* Die Linie selbst: pathLength normiert sie auf 1, dann
                  zeichnet ein Strich-Offset sie vorwaerts bzw. rueckwaerts. */}
              <motion.polyline
                points={gerichtet.map((p) => p.replace(' ', ',')).join(' ')}
                fill="none"
                stroke={treffer ? 'rgba(223,233,75,0.75)' : 'rgba(223,233,75,0.4)'}
                strokeWidth="1.3"
                strokeLinejoin="round"
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={1}
                initial={{ strokeDashoffset: 1 }}
                animate={{ strokeDashoffset: hinweg ? 0 : 1 }}
                transition={{
                  duration: (hinweg ? LEG_DURATION : RETURN_DURATION) / 1000,
                  ease: hinweg ? 'easeOut' : 'easeIn',
                }}
              />

              {/* Der Punkt laeuft auf genau dieser Linie — hin, und bei einem
                  Treffer wieder zurueck.
                  ZWEI getrennte Elemente mit eigenem key statt eines, das
                  seine Richtung umschaltet: animateMotion ist deklaratives
                  SMIL und startet nicht neu, wenn sich nur seine Attribute
                  aendern. Der Rueckweg braucht deshalb ein frisches Element.
                  keyPoints/keyTimes ueber ALLE Segmente: ohne sie verteilt
                  animateMotion die Zeit je Segment gleich und der Punkt
                  springt an den Knicken (jedes Segment ist verschieden lang). */}
              {hinweg && (
                <circle key="hin" r="3" fill="#F0F68F">
                  <animateMotion
                    dur={`${LEG_DURATION / 1000}s`}
                    repeatCount="1"
                    fill="freeze"
                    path={pfad}
                    keyPoints="0;1"
                    keyTimes="0;1"
                    calcMode="linear"
                  />
                </circle>
              )}

              {/* Ein Fehlschlag schickt nichts zurueck — und das soll man
                  sehen. Nur ein Treffer bekommt den Rueckweg. */}
              {treffer && (
                <circle key="zurueck" r="3" fill="#DFE94B">
                  <animateMotion
                    dur={`${RETURN_DURATION / 1000}s`}
                    repeatCount="1"
                    fill="freeze"
                    path={pfad}
                    keyPoints="1;0"
                    keyTimes="0;1"
                    calcMode="linear"
                  />
                </circle>
              )}
            </g>
          );
        })()}

        {/* Stationen */}
        {CHAIN.map((station, i) => {
          const x = stationX(i);
          const y = stationY(i);
          const pods = byStage.get(station.id) ?? [];
          // Eine Station gilt als betroffen, wenn der gerade befragte Pod
          // auf ihr steht — nicht, wenn irgendwo etwas laeuft.
          const state = aktiverPod?.stage === station.id ? seq.state : 'idle';
          const Icon = station.icon;
          const istEigene = station.id === ownStage;
          // Beschriftung nach aussen: obere Reihe oben, untere unten.
          const labelY = y === ROW_TOP ? y - 21 : y + 28;

          return (
            <g key={station.id}>
              {/* RUHE: das Icon der Startseite. Es tritt zurueck, sobald eine
                  Abfrage laeuft, und gibt die Pods dahinter frei. */}
              <AnimatePresence>
                {!aktiv && (
                  <motion.g
                    key="icon"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.28 }}
                    style={{ transformOrigin: `${x}px ${y}px` }}
                  >
                    <rect
                      x={x - 11}
                      y={y - 11}
                      width="22"
                      height="22"
                      rx="6.5"
                      fill={pods.length > 0 ? '#DFE94B' : 'rgba(223,233,75,0.15)'}
                      filter={istEigene ? 'url(#ds-glow)' : undefined}
                    />
                    <Icon
                      x={x - 7}
                      y={y - 7}
                      width={14}
                      height={14}
                      color={pods.length > 0 ? '#0B141E' : 'rgba(223,233,75,0.5)'}
                      strokeWidth={2.2}
                    />
                  </motion.g>
                )}
              </AnimatePresence>

              {/* ABFRAGE: die Pods dieser Station, waagerecht um die
                  Stationsmitte verteilt. Jetzt ist zu sehen, wie viele
                  Akteure hinter der Rolle stehen — und welcher der eigene
                  ist. */}
              <AnimatePresence>
                {aktiv &&
                  pods.map((pod, k) => {
                    const px = x + (k - (pods.length - 1) / 2) * POD_GAP;
                    const podState = pod.id === seq.endpoint ? seq.state : 'idle';
                    const hell = podState === 'hit' || podState === 'querying';
                    return (
                      <motion.circle
                        key={pod.id}
                        cx={px}
                        cy={y}
                        initial={{ opacity: 0, r: 1 }}
                        animate={{ opacity: 1, r: pod.isSelf ? 5 : 4 }}
                        exit={{ opacity: 0, r: 1 }}
                        transition={{ duration: 0.28, delay: k * 0.04 }}
                        fill={pod.isSelf || podState === 'hit' ? '#DFE94B' : '#24374B'}
                        stroke={
                          pod.isSelf
                            ? '#F0F68F'
                            : hell
                              ? 'rgba(223,233,75,0.8)'
                              : 'rgba(143,166,186,0.45)'
                        }
                        strokeWidth="1.2"
                        filter={pod.isSelf ? 'url(#ds-glow)' : undefined}
                      />
                    );
                  })}
              </AnimatePresence>

              {/* Eine Station ohne Pods bekommt waehrend der Abfrage einen
                  offenen Ring — sonst klafft dort ein Loch in der Kette. */}
              {aktiv && pods.length === 0 && (
                <circle
                  cx={x}
                  cy={y}
                  r={4}
                  fill="none"
                  stroke="rgba(143,166,186,0.3)"
                  strokeWidth="1"
                  strokeDasharray="1.5 2"
                />
              )}

              <text
                x={x}
                y={labelY}
                textAnchor="middle"
                className={
                  istEigene
                    ? 'fill-acid-300'
                    : state !== 'idle'
                      ? 'fill-acid-200'
                      : 'fill-night-300'
                }
                style={{
                  fontSize: `${FS_LABEL}px`,
                  fontWeight: istEigene ? 700 : 600,
                  letterSpacing: '0.02em',
                }}
              >
                {station.label}
              </text>

              {/* Waehrend der Abfrage steht unter der eigenen Station, dass es
                  die eigene ist. Im Ruhezustand genuegt das leuchtende Icon. */}
              {aktiv && istEigene && (
                <text
                  x={x}
                  y={labelY + (y === ROW_TOP ? -8 : 9)}
                  textAnchor="middle"
                  className="fill-white"
                  style={{ fontSize: `${FS_LABEL - 0.5}px`, fontWeight: 700 }}
                >
                  Ihr Pod
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
