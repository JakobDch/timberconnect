import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ChevronDown,
  Factory,
  Home,
  Info,
  Leaf,
  Truck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Product } from '../../types';
import type { ProductDataResult } from '../../services/sparqlService';
import {
  computeLca,
  extractLcaInputs,
  mapToLcaInfo,
  type LcaChartBar,
  type LcaInfoField,
  type LcaModule,
} from '../../services/lcaService';
import {
  detectProductStage,
  productImageFor,
  productImageForStage,
} from '../../services/productImageService';
import { useLcaDistances } from '../../hooks/useLcaDistances';
import { useOwnProductPhoto } from '../../hooks/useOwnProductPhoto';
import { DownstreamSubjectNotice } from '../UI/DownstreamSubjectNotice';
import { useCaseRefersToDownstreamPanel } from '../../config/useCases';
import { DocumentDownloadSection } from '../Documents';
import type { PodFileEntry } from '../../services/fileBrowserService';

/**
 * Anwendungsfall "CO2-Bilanz" (Awf-Vorgabe 08/2026, Visualisierung S. 1-2).
 *
 * Quantifiziert die Treibhausgasemissionen (GWP) der BSP-Platte ueber die
 * Lebenszyklusmodule A1-A5, in Anlehnung an EN 15804+A2 -- KEINE Konformitaet,
 * keine Verifizierung. Gerechnet wird LIVE aus den Pod-Daten des gescannten
 * Bauteils (services/lcaService.ts); fehlende Merkmale werden wie in der
 * Rueckbaubarkeit nicht versteckt, sondern als Luecke mit Begruendung
 * ausgewiesen, und die Summe wird dann als Teilsumme gekennzeichnet.
 *
 * Die Transportstrecken A2/A4 stehen nicht als Zahl im Datenraum: sie werden
 * hier aus den geocodierten Adressen (Nominatim, sequentiell + gecacht)
 * geschaetzt -- Luftlinie mal Umwegfaktor -- und als "abgeleitet" markiert.
 * Ohne Produkt zeigt die Ansicht klar beschriftete Demo-Werte durch dieselbe
 * Rechenstrecke.
 */

interface CO2BalanceViewProps {
  productId?: string;
  product?: Product | null;
  /** Rohe Abfrageergebnisse -- ERP-Panel, Transportauftraege, DoP, Klebstoff. */
  productData?: ProductDataResult | null;
  onBack: () => void;
  /** "Produkt hinzufügen" → Scanner öffnen, um ein Bauteil zuzuordnen. */
  onAddProduct: () => void;
}

const MODULE_ICONS: Record<string, LucideIcon> = {
  A1: Leaf,
  A2: Truck,
  A3: Factory,
  A4: Truck,
  A5: Home,
};

const MODULE_DESCRIPTIONS: Record<string, string> = {
  A1: 'Rohstoffbereitstellung: biogene Speicherung, Holzernte, Transport zum Sägewerk und Produktion des Schnittholzes.',
  A2: 'Transport der Schnittholzlamellen vom Sägewerk zum BSP-Werk, anteilig nach Lademenge.',
  A3: 'Herstellung der BSP-Platte im Holzwerkstoffwerk, inklusive Verklebung.',
  A4: 'Transport der fertigen Platte vom Werk zur Baustelle, anteilig nach Lademenge.',
  A5: 'Einbau der Platte auf der Baustelle.',
};

const NO_DATA = 'Keine Daten verfügbar';
const NOT_COMPUTABLE = 'nicht berechenbar';

/** Die fuer den Awf zentralen Belege zuerst (Visualisierung S. 2):
    Leistungserklaerung und Klebstoff-Datenblatt vor allem Uebrigen.
    Modulweite Konstante, damit der Downloadbereich nicht bei jedem Render
    neu laedt (die Funktion ist Teil seiner Lade-Abhaengigkeiten). */
const DOCUMENT_RANK = (file: PodFileEntry): number => {
  if (/leistungserkl/i.test(file.name)) return 0;
  if (/klebstoff|datenblatt/i.test(file.name)) return 1;
  return 2;
};

/** kg-CO2e-Wert deutsch formatiert; grosse Betraege ohne Nachkommastelle. */
function formatKg(value: number): string {
  return value.toLocaleString('de-DE', {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
  });
}

/** Kompaktes Balken-Label: ab 1000 kg in Tonnen, sonst in kg. */
function formatCompact(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} t`;
  }
  return formatKg(value);
}

// ---------------------------------------------------------------------------
// Balkendiagramm
// ---------------------------------------------------------------------------

/** "Schoene" Schrittweite (1/2/5 x 10^n) fuer die Y-Achse. */
function niceStep(rough: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const base = rough / power;
  if (base <= 1) return power;
  if (base <= 2) return 2 * power;
  if (base <= 5) return 5 * power;
  return 10 * power;
}

/**
 * Ein Balken je Diagrammposition, dynamische Y-Skala mit Nulllinie.
 *
 * Bewusst eine EHRLICHE lineare Skala: die biogene Speicherung ist ein
 * eigener Balken (Entscheidung 17.08.), damit A1-A5 ablesbar bleiben --
 * ein Log-Trick wuerde die Groessenverhaeltnisse verfaelschen. Werte stehen
 * zusaetzlich als Label am Balken.
 */
function LcaChart({ bars }: { bars: LcaChartBar[] }) {
  const width = 560;
  const height = 260;
  const margin = { top: 24, right: 12, bottom: 36, left: 48 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const values = bars.map((b) => b.value).filter((v): v is number => v !== null);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const step = niceStep(Math.max(rawMax - rawMin, 1) / 4);
  const yMin = Math.floor(rawMin / step) * step;
  const yMax = Math.max(Math.ceil(rawMax / step) * step, step);
  const ticks: number[] = [];
  for (let t = yMin; t <= yMax + step / 2; t += step) ticks.push(t);

  const y = (v: number) => margin.top + ((yMax - v) / (yMax - yMin)) * plotH;
  const groupW = plotW / bars.length;
  const barW = Math.min(28, groupW * 0.5);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      role="img"
      aria-label="CO₂-Bilanz nach Lebenszyklusmodulen in Kilogramm CO₂-Äquivalent, biogene Speicherung als eigener Balken"
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke={tick === 0 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)'}
            strokeWidth={1}
          />
          <text
            x={margin.left - 8}
            y={y(tick) + 3.5}
            textAnchor="end"
            fontSize={10}
            fill="#64809A"
          >
            {formatCompact(tick)}
          </text>
        </g>
      ))}

      {bars.map((bar, i) => {
        const cx = margin.left + groupW * i + groupW / 2;
        return (
          <g key={bar.id}>
            {bar.value !== null ? (
              <>
                <rect
                  x={cx - barW / 2}
                  y={bar.value > 0 ? y(bar.value) : y(0)}
                  width={barW}
                  height={Math.max(Math.abs(y(bar.value) - y(0)), 1)}
                  rx={2}
                  fill="#DFE94B"
                />
                <text
                  x={cx}
                  y={bar.value >= 0 ? y(bar.value) - 5 : y(bar.value) + 12}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={600}
                  fill="#DEE7EF"
                >
                  {formatCompact(bar.value)}
                </text>
              </>
            ) : (
              <text
                x={cx}
                y={y(0) - 5}
                textAnchor="middle"
                fontSize={9}
                fontStyle="italic"
                fill="#8FA6BA"
              >
                n. b.
              </text>
            )}
            <text
              x={cx}
              y={height - 12}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              fill="#B9C8D6"
            >
              {bar.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Zeilen-Bausteine
// ---------------------------------------------------------------------------

/** Merkmalszeile der Zusatzinformationen (Muster: Rueckbaubarkeit). */
function InfoFieldRow({ field }: { field: LcaInfoField }) {
  const missing = field.value === null;
  return (
    <div className="flex flex-col sm:flex-row gap-1 sm:gap-3 text-sm py-2 border-b border-white/5 last:border-0">
      <dt className="w-40 sm:w-48 flex-shrink-0 text-night-300 text-xs pt-0.5">
        {field.label}:
      </dt>
      <dd className="flex-1 min-w-0">
        <span
          className={`block text-sm ${missing ? 'text-night-300 italic' : 'text-night-100'}`}
        >
          {field.value ?? NO_DATA}
        </span>
        {field.note && (
          /* night-300 statt night-400: Kontrast auf night-800 (WCAG). */
          <span className="block text-xs leading-relaxed mt-1 text-night-300">
            {field.note}
          </span>
        )}
      </dd>
    </div>
  );
}

/** Teilmodul-Zeile (A1.0-A1.3) im aufgeklappten Modul. */
function SubModuleRow({ module }: { module: LcaModule }) {
  const missing = module.value === null;
  return (
    <div className="py-2 border-b border-white/5 last:border-0">
      <div className="flex items-baseline gap-3 text-sm">
        <span className="w-10 flex-shrink-0 text-[11px] font-semibold text-night-300">
          {module.code}
        </span>
        <span className="flex-1 min-w-0 text-night-100">{module.label}</span>
        <span
          className={`flex-shrink-0 tabular-nums text-sm ${
            missing
              ? 'text-night-300 italic'
              : (module.value ?? 0) < 0
                ? 'text-sky-300'
                : 'text-night-100'
          }`}
        >
          {missing ? NOT_COMPUTABLE : `${formatKg(module.value!)} kg CO₂e`}
        </span>
      </div>
      <p className="text-xs leading-relaxed mt-1 sm:ml-[3.25rem] text-night-300">
        {module.formula}
        {module.note && <span className="block mt-0.5">{module.note}</span>}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ansicht
// ---------------------------------------------------------------------------

export function CO2BalanceView({
  productId,
  product,
  productData,
  onBack,
  onAddProduct,
}: CO2BalanceViewProps) {
  const [openModule, setOpenModule] = useState<string | null>(null);
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  // --- Eingangsgroessen + Zusatzinfos -------------------------------------
  const inputs = useMemo(
    () => extractLcaInputs(productData ?? null),
    [productData],
  );
  const info = useMemo(
    () => mapToLcaInfo(productData ?? null, product ?? null),
    [productData, product],
  );

  // --- Transportstrecken A2/A4 aufloesen ----------------------------------
  // Geocoding laeuft ausserhalb der reinen Rechnung, im gemeinsamen Hook:
  // der Bauproduktpass braucht dieselbe Zahl, und zwei Kopien der
  // Aufloesung waeren auseinandergelaufen.
  const distances = useLcaDistances(inputs);

  const lca = useMemo(() => computeLca(inputs, distances), [inputs, distances]);

  // --- Kopfdaten (Bauteil / Masse) ----------------------------------------
  const header = {
    name: info.componentName ?? product?.name ?? 'BSP-Platte',
    manufacturer: info.manufacturer,
    declaration: info.declarationTitle,
    reference: info.referenceSize,
    mass: info.mass,
    dimensions: info.dimensions,
  };

  const productImage = useMemo(
    () =>
      productImageFor(product ?? null, productData ?? null) ?? {
        stage: 'clt-panel' as const,
        src: '',
        fallbackSrc: `${import.meta.env.BASE_URL}images/bsp-plate-placeholder.svg`,
        label: '',
        alt: 'Produktart aus den Stammdaten nicht bestimmbar',
      },
    [product, productData],
  );
  const ownPhoto = useOwnProductPhoto(product ?? null, productData ?? null);
  const [useImageFallback, setUseImageFallback] = useState(false);
  useEffect(() => {
    setUseImageFallback(false);
  }, [productImage.src, ownPhoto]);

  // --- Nur fuer BSP-Platten (Awf-Vorgabe, Rueckmeldung Anni 18.08.2026) ---
  // Die Kachel im Raster ist fuer Vorprodukte bereits gesperrt
  // (useCaseAvailability); dieser Guard faengt die uebrigen Wege ab --
  // Seitenmenue und Startseite pruefen nur die statische Verfuegbarkeit.
  // Ohne ihn wuerde die Ansicht die Bilanz der im Quellensatz gefundenen
  // Platte anzeigen, obwohl ein Stamm gescannt wurde.
  const scannedStage = detectProductStage(product ?? null, productData ?? null);
  // Liegt die Platte downstream in der geladenen Kette, gilt die Bilanz IHR --
  // dann ist die Ansicht zulaessig und nennt den Bezug im Kopf.
  //
  // Dieselbe Entscheidung wie im Raster, und bewusst ueber dieselbe Funktion:
  // zwei getrennt gepflegte Regeln waeren wieder die Doppel-Wahrheit, die
  // useCases.ts vermeiden soll -- die Kachel liesse sich oeffnen und die
  // Ansicht sperrte trotzdem.
  const bezugIstPlatteDownstream = useCaseRefersToDownstreamPanel(
    'co2',
    scannedStage,
    productData?.downstreamStages,
  );

  if (scannedStage !== 'clt-panel' && !bezugIstPlatteDownstream) {
    return (
      <div className="flex-1 bg-night-900">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-semibold text-night-300 hover:text-white transition-colors mb-5"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Zurück</span>
          </button>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mb-2">
            CO₂ <span className="text-acid-400">Bilanz</span>
          </h1>
          <div className="bg-night-700/50 border border-white/5 rounded-2xl p-6 mt-6">
            <p className="text-sm text-night-100 font-semibold mb-2">
              Für dieses Produkt nicht verfügbar
            </p>
            <p className="text-sm text-night-300 leading-relaxed">
              {scannedStage === null
                ? 'Die CO₂-Bilanz ist nur für BSP-Platten definiert; die Produktart dieses Objekts ist aus den Stammdaten nicht bestimmbar.'
                : `Die CO₂-Bilanz ist nur für die fertige BSP-Platte definiert — für Vorprodukte würden sich die Lebenszyklusmodule verschieben. Erfasst wurde: ${productImageForStage(scannedStage).label}.`}
            </p>
            <button
              onClick={onAddProduct}
              className="mt-4 px-4 py-2 rounded-xl bg-acid-400 text-night-950 text-sm font-semibold hover:bg-acid-300 transition-colors"
            >
              Anderes Bauteil erfassen
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 bg-night-900">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-semibold text-night-300 hover:text-white transition-colors mb-5"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Zurück</span>
          </button>

          {/* Titel + Beschreibung */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              CO₂ <span className="text-acid-400">Bilanz</span>
            </h1>
            <p className="text-sm text-night-300 mt-2 leading-relaxed">
              Quantifizierung der Treibhausgasemissionen (GWP) in kg CO₂e entlang
              der Herstellung der BSP-Platte, von der Rohstoffbereitstellung bis
              zum Einbau (in Anlehnung an EN 15804+A2).
            </p>
          </motion.div>

          {/*
            Wenn ein Vorprodukt erfasst wurde und die Bilanz ueber die Platte
            der Kette kommt: dranschreiben, wem die Zahlen gehoeren.
          */}
          <DownstreamSubjectNotice
            show={bezugIstPlatteDownstream}
            product={product}
            productData={productData}
          />

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs text-night-300 leading-relaxed mb-4 px-1"
          >
            Berechnet aus den Live-Daten dieses Bauteils. Fehlende oder
            abgeleitete Eingangsgrößen sind ausgewiesen.
          </motion.p>

          <div className="space-y-4">
            {/* Bauteil-Karte */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="bg-night-800 border border-white/5 rounded-2xl p-4"
            >
              <div className="flex items-start gap-4">
                <span className="w-20 h-20 rounded-xl overflow-hidden bg-night-700 border border-white/5 flex items-center justify-center flex-shrink-0">
                  <img
                    src={
                      useImageFallback
                        ? productImage.fallbackSrc
                        : (ownPhoto ?? productImage.src)
                    }
                    alt={productImage.alt}
                    onError={() => setUseImageFallback(true)}
                    className={
                      useImageFallback
                        ? 'max-h-full max-w-full object-contain p-3'
                        : 'w-full h-full object-cover'
                    }
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold tracking-widest text-night-400 uppercase">
                    Bauteil
                  </span>
                  <span className="block text-xl font-extrabold text-white truncate">
                    {header.name}
                  </span>
                  <dl className="mt-2 space-y-0.5 text-xs">
                    {[
                      { label: 'Hersteller', value: header.manufacturer },
                      { label: 'Deklaration', value: header.declaration },
                      { label: 'Bezugsgröße', value: header.reference },
                    ].map((row) => (
                      <div key={row.label} className="flex gap-2">
                        <dt className="w-24 flex-shrink-0 text-night-300">{row.label}:</dt>
                        <dd
                          className={`min-w-0 truncate ${row.value ? 'text-night-100' : 'text-night-300 italic'}`}
                        >
                          {row.value ?? NO_DATA}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </motion.section>

            {/* Masse / Abmessungen */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-night-800 border border-white/5 rounded-2xl p-5 grid grid-cols-2 divide-x divide-white/10"
            >
              <div className="pr-4">
                <div className="text-xs text-night-300 mb-1">Masse</div>
                <div className={`font-mono text-lg ${header.mass ? 'text-white' : 'text-night-300 italic text-sm'}`}>
                  {header.mass ?? NO_DATA}
                </div>
              </div>
              <div className="pl-4">
                <div className="text-xs text-night-300 mb-1">Abmessungen</div>
                <div className={`font-mono ${header.dimensions ? 'text-white text-sm sm:text-base' : 'text-night-300 italic text-sm'}`}>
                  {header.dimensions ?? NO_DATA}
                </div>
                {header.dimensions && (
                  <div className="text-[10px] text-night-400 mt-0.5">
                    Stärke × Breite × Länge
                  </div>
                )}
              </div>
            </motion.section>

            {/* Gesamtergebnis */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="bg-acid-400/15 border border-acid-400/40 rounded-2xl p-5"
            >
              <div className="text-xs font-semibold tracking-widest text-night-200 uppercase mb-1">
                CO₂-Emissionen gesamt (A1 – A5)
              </div>
              {lca.total !== null ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold tabular-nums text-acid-300">
                    {formatKg(lca.total)}
                  </span>
                  <span className="text-sm text-night-200">kg CO₂e</span>
                </div>
              ) : (
                <div className="text-lg italic text-night-200">{NOT_COMPUTABLE}</div>
              )}
              {lca.total !== null && lca.total < 0 && (
                <p className="text-xs text-night-200 mt-2 leading-relaxed">
                  Negativ: Das Bauteil speichert mehr CO₂, als seine Herstellung
                  freisetzt.
                </p>
              )}
              {lca.totalIsPartial && (
                <p className="text-xs text-night-200 mt-2 leading-relaxed">
                  Teilsumme — nicht berechenbar: {lca.missingModules.join(', ')}.
                  Begründungen stehen am jeweiligen Modul.
                </p>
              )}
            </motion.section>

            {/* Module A1-A5 zum Aufklappen */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-2"
            >
              {lca.modules.map((module) => {
                const IconComp = MODULE_ICONS[module.code] ?? Info;
                const open = openModule === module.id;
                const missing = module.value === null;

                return (
                  <div
                    key={module.id}
                    className={`bg-night-800 border rounded-2xl overflow-hidden transition-colors ${
                      open ? 'border-acid-400/40' : 'border-white/5'
                    }`}
                  >
                    <button
                      onClick={() => setOpenModule(open ? null : module.id)}
                      aria-expanded={open}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                    >
                      <IconComp
                        className={`w-4 h-4 flex-shrink-0 ${open ? 'text-acid-400' : 'text-night-300'}`}
                      />
                      <span className="flex-1 min-w-0 text-sm font-semibold text-white truncate">
                        CO₂-Emissionen {module.code}
                        <span className="font-normal text-night-300"> · {module.label}</span>
                      </span>
                      <span
                        className={`text-xs tabular-nums flex-shrink-0 ${
                          missing
                            ? 'text-night-300 italic'
                            : (module.value ?? 0) < 0
                              ? 'text-sky-300'
                              : 'text-night-100'
                        }`}
                      >
                        {missing ? NOT_COMPUTABLE : `${formatKg(module.value!)} kg CO₂e`}
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 text-night-300 flex-shrink-0 transition-transform ${
                          open ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4">
                            <p className="text-xs text-night-300 leading-relaxed mb-2">
                              {MODULE_DESCRIPTIONS[module.code]}
                            </p>
                            {module.sub ? (
                              <div>
                                {module.sub.map((sub) => (
                                  <SubModuleRow key={sub.id} module={sub} />
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-night-300 leading-relaxed">
                                {module.formula}
                                {module.note && (
                                  <span className="block mt-1">{module.note}</span>
                                )}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </motion.section>

            {/* Balkendiagramm */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="bg-night-800 border border-white/5 rounded-2xl p-5"
            >
              <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-acid-300 mb-4">
                CO₂-Bilanz [kg CO₂e]
              </h2>
              <LcaChart bars={lca.chart} />
              <div className="mt-3 pt-3 border-t border-white/5 text-[11px] text-night-300 leading-relaxed">
                A1* = Rohstoffbereitstellung ohne biogene Speicherung (eigener
                Balken links). Berechnung in Anlehnung an EN 15804+A2 — keine
                Konformität, keine Verifizierung.
              </div>
            </motion.section>

            {/* Hinweise der Awf-Vorgabe */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-night-700/50 border border-white/5 rounded-2xl p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <Info className="w-4 h-4 text-acid-300" />
                <h2 className="text-sm font-bold text-white">Hinweise zur Berechnung</h2>
              </div>
              <ul className="space-y-2 text-xs text-night-200 leading-relaxed list-disc pl-4">
                <li>
                  <span className="font-semibold text-night-100">Modul B (Betrieb)</span>{' '}
                  wird nicht betrachtet: Brettsperrholz wird eine Lebensdauer von
                  80 bis 100 Jahren zugeschrieben, ist dauerhaft in die
                  Konstruktion eingebaut und benötigt unter normalen
                  Nutzungsbedingungen keine Instandhaltung, Reparatur oder
                  Sanierung.
                </li>
                <li>
                  <span className="font-semibold text-night-100">Module C und D</span>{' '}
                  (Entsorgung, Gutschriften) liegen außerhalb des
                  Betrachtungsrahmens dieses Anwendungsfalls.
                </li>
                <li>
                  <span className="font-semibold text-night-100">Berechnungsstandard:</span>{' '}
                  in Anlehnung an EN 15804+A2 — keine vollständige Konformität
                  und keine Verifizierung.
                </li>
              </ul>
            </motion.section>

            {/* Zusatzinformationen der Informationsbedarfstiefe */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="space-y-2"
            >
              {info.categories.map((category) => {
                const open = openCategory === category.id;
                const filled = category.fields.filter((f) => f.value !== null).length;
                return (
                  <div
                    key={category.id}
                    className={`bg-night-800 border rounded-2xl overflow-hidden transition-colors ${
                      open ? 'border-acid-400/40' : 'border-white/5'
                    }`}
                  >
                    <button
                      onClick={() => setOpenCategory(open ? null : category.id)}
                      aria-expanded={open}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                    >
                      <Info
                        className={`w-4 h-4 flex-shrink-0 ${open ? 'text-acid-400' : 'text-night-300'}`}
                      />
                      <span className="flex-1 min-w-0 text-sm font-semibold text-white truncate">
                        {category.title}
                      </span>
                      <span className="text-[11px] tabular-nums text-night-400 flex-shrink-0">
                        {filled}/{category.fields.length}
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 text-night-300 flex-shrink-0 transition-transform ${
                          open ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4">
                            <p className="text-xs text-night-300 leading-relaxed mb-3">
                              {category.description}
                            </p>
                            <dl>
                              {category.fields.map((field) => (
                                <InfoFieldRow key={field.id} field={field} />
                              ))}
                            </dl>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
              <p className="text-xs text-night-300 leading-relaxed px-1">
                {info.coverage.filled} von {info.coverage.total} Angaben zu
                diesem Bauteil sind belegt. Fehlende Angaben sind mit einer
                Begründung ausgewiesen.
              </p>
            </motion.section>

            {/* Downloadbereich (geteilt, einklappbar) */}
            <DocumentDownloadSection
              productId={productId}
              productData={productData}
              delay={0.4}
              sortRank={DOCUMENT_RANK}
            />
          </div>
        </div>
      </div>
    </>
  );
}
