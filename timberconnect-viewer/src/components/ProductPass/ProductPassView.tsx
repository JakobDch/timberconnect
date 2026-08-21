import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  FileCheck2,
  FlaskConical,
  Fingerprint,
  Leaf,
  Recycle,
  Route,
  ShieldAlert,
  Thermometer,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Product, SupplyChainStep } from '../../types';
import type { ProductDataResult } from '../../services/sparqlService';
import {
  mapToDbpp,
  type DbppField,
  type DbppCarbonInput,
} from '../../services/dbppMapper';
import { computeLca, extractLcaInputs } from '../../services/lcaService';
import { productImageFor } from '../../services/productImageService';
import { isEpc } from '../../services/sparqlQueries';
import { useLcaDistances } from '../../hooks/useLcaDistances';
import { useOwnProductPhoto } from '../../hooks/useOwnProductPhoto';
import { DocumentDownloadSection } from '../Documents';
import { PlantingAreaCard } from '../Map';
import { SupplyChainTimeline } from './SupplyChainTimeline';
import { DppDisclosureSection } from './DppDisclosureSection';

/**
 * Anwendungsfall "Digitaler Bauproduktpass" (DBPP).
 *
 * Zeigt die Daten des gescannten Bauteils in der Gliederung, die die EU fuer
 * einen digitalen Produktpass vorsieht -- gegliedert nach der
 * Bauprodukteverordnung (EU) 2024/3110 und der Oekodesign-Verordnung (ESPR).
 *
 * Der Pass ist ausdruecklich KEIN konformer DPP; das Banner unter dem Titel
 * und der Abschnitt "Verhaeltnis zum EU-Produktpass" am Seitenende sagen das
 * unmissverstaendlich. Er zeigt, was mit den heute vorhandenen Daten moeglich
 * waere -- und wo die Kette reisst.
 *
 * Die Merkmale setzt services/dbppMapper.ts zusammen; hier wird nur
 * dargestellt. Wie in der Rueckbaubarkeit werden fehlende Merkmale NICHT
 * versteckt: sie erscheinen mit einer Begruendung. Die CO2-Zahl kommt aus
 * demselben Rechenweg wie der Anwendungsfall "CO2 Bilanzierung" (lcaService +
 * useLcaDistances) -- eine zweite Rechnung haette bedeutet, dass dasselbe
 * Bauteil je nach Ansicht eine andere Bilanz hat.
 *
 * Vorgeschichte: bis 08/2026 zeigte diese Ansicht Gewicht, Feuchtegehalt,
 * Norm und eine dreiteilige CO2-Bilanz als fest verdrahtete Zahlen. In einem
 * Datenraum-Demonstrator sieht ein erfundener Wert aus wie ein Pod-Wert --
 * deshalb steht hier jetzt ausschliesslich, was tatsaechlich abgefragt wurde.
 */

interface ProductPassViewProps {
  productId: string;
  product: Product | null;
  /** Rohe Abfrageergebnisse -- Panel, Leistungserklaerungen, IFC, Zertifikat. */
  productData: ProductDataResult | null;
  supplyChain: SupplyChainStep[];
  onBack: () => void;
  /** Fuehrt zum Scan -- Ausweg aus dem Leerzustand. */
  onScanClick?: () => void;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  identification: Fingerprint,
  performance: FileCheck2,
  material: FlaskConical,
  safety: ShieldAlert,
  physics: Thermometer,
  environment: Leaf,
  lifecycle: Recycle,
};

/** Kennzeichnung fehlender Merkmale -- Wortlaut wie in den anderen Awf. */
const NO_DATA = 'Keine Daten verfügbar';

/**
 * Eine Merkmalszeile.
 *
 * Fehlende Merkmale tragen ihre Begruendung darunter, damit der Unterschied
 * zwischen "nicht erhoben" und "nicht vorgesehen" sichtbar bleibt.
 */
function FieldRow({ field }: { field: DbppField }) {
  const missing = field.value === null;

  return (
    <div className="flex flex-col sm:flex-row gap-1 sm:gap-3 text-sm py-2 border-b border-white/5 last:border-0">
      <dt className="w-40 sm:w-56 flex-shrink-0 text-night-300 text-xs pt-0.5">
        {field.label}:
      </dt>
      <dd className="flex-1 min-w-0">
        <span
          className={`block text-sm ${missing ? 'text-night-300 italic' : 'text-night-100'}`}
        >
          {field.value ?? NO_DATA}
        </span>
        {field.note && (
          /* Begruendung, warum ein Wert fehlt bzw. woher er stammt.
             night-300 statt night-400 wegen des Kontrastverhaeltnisses auf
             night-800 -- siehe DeconstructionView. */
          <span className="block text-xs leading-relaxed mt-1 text-night-300">
            {field.note}
          </span>
        )}
      </dd>
    </div>
  );
}

export function ProductPassView({
  productId,
  product,
  productData,
  supplyChain,
  onBack,
  onScanClick,
}: ProductPassViewProps) {
  // Wie in der Rueckbaubarkeit: eine Kategorie zur Zeit offen.
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [chainOpen, setChainOpen] = useState(false);

  // --- CO2 aus dem Oekobilanz-Anwendungsfall ------------------------------
  // Derselbe Rechenweg, dieselben Strecken, dieselbe Zahl.
  const lcaInputs = useMemo(() => extractLcaInputs(productData), [productData]);
  const distances = useLcaDistances(lcaInputs);
  const carbon = useMemo<DbppCarbonInput>(() => {
    const lca = computeLca(lcaInputs, distances);
    return {
      total: lca.total,
      isPartial: lca.totalIsPartial,
      missingModules: lca.missingModules,
    };
  }, [lcaInputs, distances]);

  const dbpp = useMemo(
    () => mapToDbpp(productData, product, carbon),
    [productData, product, carbon],
  );

  // Produktfoto der erkannten Stufe. Nennen die Stammdaten keinen Typ, wird
  // die Produktart nicht geraten -- dann bleibt der neutrale Platzhalter.
  const productImage = useMemo(
    () =>
      productImageFor(product, productData) ?? {
        stage: 'clt-panel' as const,
        src: '',
        fallbackSrc: `${import.meta.env.BASE_URL}images/bsp-plate-placeholder.svg`,
        label: '',
        alt: 'Produktart aus den Stammdaten nicht bestimmbar',
      },
    [product, productData],
  );
  const ownPhoto = useOwnProductPhoto(product, productData);
  const [useImageFallback, setUseImageFallback] = useState(false);
  useEffect(() => {
    setUseImageFallback(false);
  }, [productImage.src, ownPhoto]);

  // --- Leerzustand --------------------------------------------------------
  if (!product) {
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
            Digitaler <span className="text-acid-400">Bauproduktpass</span>
          </h1>
          <div className="bg-night-700/50 border border-white/5 rounded-2xl p-6 mt-6">
            <p className="text-sm text-night-300">
              Für den Produktpass wird ein Bauteil benötigt. Scannen Sie eine
              Platte oder geben Sie die Produkt-ID ein.
            </p>
            <button
              onClick={onScanClick ?? onBack}
              className="mt-4 px-4 py-2 rounded-xl bg-acid-400 text-night-950 text-sm font-semibold hover:bg-acid-300 transition-colors"
            >
              Bauteil erfassen
            </button>
          </div>
        </div>
      </div>
    );
  }

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

        {/* Titel + Beschreibung */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5"
        >
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Digitaler <span className="text-acid-400">Bauproduktpass</span>
          </h1>
          <p className="text-sm text-night-300 mt-2 leading-relaxed">
            Alle Angaben zu diesem Bauteil, gegliedert nach den Datenkategorien,
            die die EU für einen digitalen Produktpass vorsieht.
          </p>
        </motion.div>

        {/* Abgrenzung -- amber statt acid, damit das Banner nicht wie ein
            Guetesiegel wirkt. Der ausklappbare Abschnitt am Seitenende
            erlaeutert die Rechtslage im Einzelnen. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.03 }}
          className="mb-6 flex gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4"
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-300 mt-0.5" />
          <p className="text-xs leading-relaxed text-amber-100/90">
            <strong className="font-semibold text-amber-200">
              Demonstrator, kein amtlicher Produktpass.
            </strong>{' '}
            Diese Ansicht ist kein Digitaler Produktpass nach der
            EU-Bauprodukteverordnung (EU) 2024/3110. Sie zeigt, welche der dort
            vorgesehenen Angaben sich aus den Daten dieses Datenraums heute
            bereits erzeugen ließen — und an welchen Stellen die Kette noch
            reißt.
          </p>
        </motion.div>

        <div className="space-y-4">
          {/* Bauteil-Kopf mit der eindeutigen Produktkennung */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-night-800 border border-white/5 rounded-2xl p-4"
          >
            <div className="flex items-center gap-4">
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
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold tracking-widest text-night-400 uppercase">
                  Bauteil
                </span>
                <span className="block text-xl font-extrabold text-white truncate">
                  {dbpp.productName ?? 'BSP-Platte'}
                </span>
                {dbpp.productType && (
                  <span className="block text-xs text-night-300 truncate">
                    {dbpp.productType}
                  </span>
                )}
              </span>
            </div>

            <div className="mt-4 pt-4 border-t border-white/5">
              <span className="block text-[11px] font-semibold tracking-widest text-night-400 uppercase mb-1">
                Eindeutige Produktkennung
              </span>
              <code className="block text-xs font-mono text-night-100 break-all">
                {dbpp.uniqueProductId ?? productId}
              </code>
            </div>
          </motion.section>

          {/* Die sieben Kategorien zum Aufklappen */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-2"
          >
            {dbpp.categories.map((category) => {
              const Icon = CATEGORY_ICONS[category.id] ?? FileCheck2;
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
                    <Icon
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
                          <p className="text-xs text-night-300 leading-relaxed mb-2">
                            {category.description}
                          </p>
                          {/* Rechtsgrundlage der Kategorie -- macht
                              nachvollziehbar, warum sie hier steht. */}
                          <p className="text-[11px] text-night-400 mb-3">
                            Bezug: {category.legalBasis}
                          </p>
                          <dl>
                            {category.fields.map((field) => (
                              <FieldRow key={field.id} field={field} />
                            ))}
                          </dl>

                          {/* Pflanzflaeche gehoert zur Herkunft -- die Karte
                              rendert sich selbst weg, wenn keine hinterlegt
                              ist. */}
                          {category.id === 'environment' && (
                            <PlantingAreaCard
                              epc={isEpc(productId) ? productId : null}
                              position={product.origin?.coordinates ?? null}
                            />
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {/* Lieferkette -- als achte, gleichrangige Sektion */}
            {supplyChain.length > 0 && (
              <div
                className={`bg-night-800 border rounded-2xl overflow-hidden transition-colors ${
                  chainOpen ? 'border-acid-400/40' : 'border-white/5'
                }`}
              >
                <button
                  onClick={() => setChainOpen(!chainOpen)}
                  aria-expanded={chainOpen}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                >
                  <Route
                    className={`w-4 h-4 flex-shrink-0 ${chainOpen ? 'text-acid-400' : 'text-night-300'}`}
                  />
                  <span className="flex-1 min-w-0 text-sm font-semibold text-white truncate">
                    Lieferkette
                  </span>
                  <span className="text-[11px] tabular-nums text-night-400 flex-shrink-0">
                    {supplyChain.length}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-night-300 flex-shrink-0 transition-transform ${
                      chainOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {chainOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4">
                        <p className="text-xs text-night-300 leading-relaxed mb-3">
                          Die belegten Stationen vom Wald bis zum Bauteil. Jede
                          Station stammt aus einem eigenen Vorgang im
                          Datenraum.
                        </p>
                        <SupplyChainTimeline steps={supplyChain} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.section>

          {/* Abdeckungshinweis -- die Luecken gehoeren zur Aussage. */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="text-xs text-night-300 leading-relaxed px-1"
          >
            {dbpp.coverage.filled} von {dbpp.coverage.total} Angaben des
            Produktpasses sind belegt. Fehlende Angaben sind mit einer
            Begründung ausgewiesen.
          </motion.p>

          {/* Dokumente (geteilt, einklappbar) */}
          <DocumentDownloadSection
            productId={productId}
            productData={productData}
            delay={0.2}
          />

          {/* Rechtliche Einordnung */}
          <DppDisclosureSection delay={0.25} />
        </div>
      </div>
    </div>
  );
}
