import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  CheckCircle2,
  Verified,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import {
  USE_CASES,
  isAvailable,
  useCaseAvailability,
  type ProductDataFacts,
  type UseCaseDefinition,
} from '../../config/useCases';
import { UseCaseToggleCard } from './UseCaseToggleCard';
import { SegmentedControl, type SegmentedOption } from '../UI/SegmentedControl';
import { detectProductStage, productImageFor } from '../../services/productImageService';
import { ProductImageSection } from '../Dashboard';
import type { Product, SupplyChainStep } from '../../types';
import type { ProductDataResult } from '../../services/sparqlService';
import type { ChainScope } from '../../services/supplyChainWalk';

/**
 * Die drei Stufen des Ketten-Umfangs.
 *
 * "Ganze Kette" steht bewusst zuerst und ist die Voreinstellung: erst wer
 * sieht, was alles vorhanden ist, kann sinnvoll einschraenken.
 */
const SCOPE_OPTIONS: SegmentedOption<ChainScope>[] = [
  {
    id: 'full',
    label: 'Ganze Kette',
    hint: 'Alles, was mit diesem Bauteil verknüpft ist — auch was daraus entstanden ist.',
  },
  {
    id: 'upstream',
    label: 'Herkunft',
    hint: 'Das Bauteil und seine Vorstufen — nichts, was zeitlich danach kommt.',
  },
  {
    id: 'self',
    label: 'Nur dieses Produkt',
    hint: 'Ausschließlich das erfasste Bauteil. Am schnellsten und günstigsten.',
  },
];

interface UseCaseGridProps {
  productId: string;
  product: Product | null;
  /** Rohdaten der Abfrage -- schaerfen die Produktart-Erkennung fuers Bild. */
  productData?: ProductDataResult | null;
  supplyChain?: SupplyChainStep[];
  onSelectUseCase: (useCaseId: string) => void;
  onBack: () => void;
  /** Welcher Fall wird gerade geoeffnet? Zeigt den Spinner an SEINER Kachel. */
  openingUseCaseId?: string | null;
  isLoading?: boolean;
  error?: string | null;
  warnings?: string[];
  sourcePods?: string[];
  /** Geladener Ketten-Umfang -- bestimmt Datenmenge, Preis und Verfuegbarkeit. */
  scope?: ChainScope;
  /** Loest einen Neu-Abruf mit dem gewaehlten Umfang aus. */
  onScopeChange?: (scope: ChainScope) => void;
}

export function UseCaseGrid({
  productId,
  product,
  productData = null,
  supplyChain = [],
  onSelectUseCase,
  onBack,
  openingUseCaseId = null,
  isLoading = false,
  error = null,
  warnings = [],
  sourcePods = [],
  scope = 'full',
  onScopeChange,
}: UseCaseGridProps) {
  // State for enabled use cases (session-only)
  const [enabledUseCases, setEnabledUseCases] = useState<Set<string>>(() => {
    return new Set(USE_CASES.filter(isAvailable).map((uc) => uc.id));
  });

  /**
   * Welche Daten zu diesem Bauteil vorliegen — daraus ergibt sich, welche
   * Anwendungsfaelle sich ueberhaupt sinnvoll oeffnen lassen.
   */
  // Nach dem Scan liegt nur die Kurzinfo vor -- die Sparten-Felder sind dann
  // leer, WEIL sie nicht abgefragt wurden, nicht weil nichts da waere. Sie
  // hier als "keine Daten" zu lesen, wuerde jede Kachel sperren. Geprueft
  // wird deshalb nur, was aus der Kurzinfo hervorgeht; die genaue Datenlage
  // entscheidet sich beim Oeffnen, wo ohnehin nachgeladen wird.
  const nurKurzinfo = !!productData && !productData.loadedFully;

  const facts: ProductDataFacts | null = product
    ? {
        hasProduct: (productData?.product?.length ?? 0) > 0 || !!product.name,
        // Auch der Stamm zaehlt: die Waldangaben (Forstamt, Revier,
        // Einschlagdatum) stehen in v6 an den Maschinendaten des
        // Faellvorgangs. Nur auf ``forest`` zu pruefen, sperrte den
        // Herkunftsnachweis fuer Bauteile, deren Walddaten vollstaendig
        // vorliegen.
        hasForest:
          nurKurzinfo ||
          (productData?.forest?.length ?? 0) > 0 ||
          (productData?.stem?.length ?? 0) > 0,
        hasSupplyChain:
          nurKurzinfo ||
          (productData?.supplyChain?.length ?? 0) > 0 ||
          supplyChain.length > 0,
        hasDeconstruction:
          nurKurzinfo || (productData?.deconstruction?.length ?? 0) > 0,
        hasCertificates: nurKurzinfo || (productData?.certificates?.length ?? 0) > 0,
        hasCertifications: (product.certifications?.length ?? 0) > 0,
        // Stufe des gescannten Objekts -- sperrt z.B. die CO2-Bilanz fuer
        // Vorprodukte (nur fuer die fertige BSP-Platte definiert).
        productStage: detectProductStage(product, productData),
        scope,
      }
    : null;

  const availability = (useCase: UseCaseDefinition) =>
    useCaseAvailability(useCase, facts);

  const toggleUseCase = (useCaseId: string) => {
    setEnabledUseCases((prev) => {
      const next = new Set(prev);
      if (next.has(useCaseId)) {
        next.delete(useCaseId);
      } else {
        next.add(useCaseId);
      }
      return next;
    });
  };

  // Use product data or fallback values
  const displayProduct = product || {
    id: productId,
    name: 'Produkt wird geladen...',
    woodType: '-',
    certifications: [],
  };

  /**
   * Produktart als Text -- die einzige Sachangabe, die vor dem Kauf sichtbar
   * ist. Sie stammt aus derselben Erkennung wie das Bild und wird bewusst
   * NICHT geraten: ohne belegten RDF-Typ bleibt die Kachel ohne Beschriftung
   * (siehe productImageService), statt eine Produktart zu behaupten.
   */
  const productTypeLabel = product
    ? (productImageFor(product, productData)?.label ?? null)
    : null;

  // Count enabled active use cases
  const enabledCount = USE_CASES.filter(
    (uc) => isAvailable(uc) && enabledUseCases.has(uc.id)
  ).length;

  return (
    <div className="flex-1 flex flex-col bg-night-900 min-h-0">
      {/* Header */}
      <header className="bg-night-900/90 backdrop-blur-md border-b border-white/5 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-semibold text-night-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Zurück zum Scanner</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Status Banner */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl mb-8 border ${
              error
                ? 'bg-red-500/10 border-red-500/30'
                : isLoading
                ? 'bg-sky-500/10 border-sky-500/30'
                : 'bg-acid-400/10 border-acid-400/30'
            }`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                error ? 'bg-red-500/15' : isLoading ? 'bg-sky-500/15' : 'bg-acid-400/15'
              }`}
            >
              {error ? (
                <AlertCircle className="w-5 h-5 text-red-400" />
              ) : isLoading ? (
                <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-acid-300" />
              )}
            </div>
            <div className="flex-1">
              {error ? (
                <>
                  <span className="text-sm font-medium text-red-300">Fehler beim Laden</span>
                  <span className="text-sm text-red-400/90 ml-2">{error}</span>
                </>
              ) : isLoading ? (
                <>
                  <span className="text-sm font-medium text-sky-300">Daten werden geladen...</span>
                  <span className="text-sm text-sky-400/90 ml-2">Verbinde mit Solid Pod</span>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium text-acid-300">
                    Produkt erfolgreich identifiziert
                  </span>
                  <span className="text-sm text-night-300 ml-2">
                    {sourcePods.length > 0
                      ? `Daten aus ${sourcePods.length} Pod${sourcePods.length > 1 ? 's' : ''} geladen`
                      : 'Daten aus Solid Pod geladen'}
                  </span>
                </>
              )}
            </div>
            {!error && !isLoading && <Verified className="w-5 h-5 text-acid-300" />}
          </motion.div>

          {/* Warnings Banner */}
          {warnings.length > 0 && !error && !isLoading && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-3 px-4 py-3 rounded-xl mb-4 bg-amber-500/10 border border-amber-500/30"
            >
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="text-sm font-medium text-amber-300">Hinweis</span>
                <ul className="text-sm text-amber-400/90 mt-1">
                  {warnings.map((warning, idx) => (
                    <li key={idx}>{warning}</li>
                  ))}
                </ul>
              </div>
            </motion.div>
          )}

          {/* Kurzinfo zum erfassten Bauteil.
              BEWUSST MINIMAL: Der Scan ist kostenlos, also darf hier auch
              nichts stehen, wofuer man zahlen muesste. Gezeigt wird nur, was
              der Nutzer ohnehin selbst mitgebracht hat -- die gescannte ID --
              und die Produktart mit Bild, damit er sieht, dass das richtige
              Bauteil erkannt wurde. Holzart, Qualitaet, Herkunft und Einschlag
              standen hier frueher frei sichtbar; das waren genau jene
              Datenpunkte, die die Anwendungsfaelle verkaufen. */}
          <div className="mb-10">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-night-800 rounded-2xl border border-white/5 overflow-hidden"
            >
              <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-5">
                {/* Bild bleibt bewusst klein: es ist ein Wiedererkennungs-
                    zeichen, nicht der Inhalt der Seite. Feste, moderate
                    Kachelgroesse statt einer halben Rasterspalte. */}
                <div className="w-28 h-28 sm:w-32 sm:h-32 flex-shrink-0 mx-auto sm:mx-0">
                  <ProductImageSection
                    product={product}
                    productData={productData}
                    productType={product?.productType}
                    productName={displayProduct.name}
                    variant="compact"
                  />
                </div>

                <div className="min-w-0 flex-1 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-acid-400/15 text-acid-300 text-xs font-medium rounded-full border border-acid-400/30">
                      <Verified className="w-3 h-3" />
                      Erfasst
                    </span>
                    {productTypeLabel && (
                      <span className="px-2 py-0.5 bg-white/10 text-white/80 text-xs font-medium rounded-full truncate max-w-[55vw] sm:max-w-none">
                        {productTypeLabel}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-night-300 uppercase tracking-wide mb-1">
                    Erfasste ID
                  </div>
                  <code className="block text-sm font-mono text-night-100 bg-night-900 px-3 py-2 rounded-lg break-all">
                    {productId}
                  </code>

                  <p className="text-xs text-night-400 mt-3">
                    Details werden im jeweiligen Anwendungsfall angezeigt.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Use Cases Section */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-white">Anwendungsfälle</h2>
                <p className="text-sm text-night-300 mt-1">
                  Aktivieren oder deaktivieren Sie die gewünschten Module
                </p>
              </div>
              <span className="px-3 py-1 bg-acid-400/15 border border-acid-400/30 text-acid-300 text-sm font-medium rounded-full">
                {enabledCount} aktiv
              </span>
            </div>

            {/*
              Umfang der Kette. Steht VOR der Auswahl eines Anwendungsfalls,
              weil er bestimmt, wie viele Datenpunkte in die Abrechnung gehen --
              erst im Kaufdialog waere die Entscheidung schon gefallen.
            */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
              <div className="flex items-center gap-2 text-sm text-night-300">
                <span className="font-semibold text-white">Umfang</span>
                {isLoading && <Loader2 className="w-4 h-4 animate-spin text-sky-400" />}
              </div>
              <SegmentedControl
                ariaLabel="Umfang der Lieferkette"
                options={SCOPE_OPTIONS}
                value={scope}
                onChange={(next) => onScopeChange?.(next)}
                disabled={isLoading || !onScopeChange}
              />
              <p className="text-xs text-night-400 sm:max-w-xs">
                {SCOPE_OPTIONS.find((o) => o.id === scope)?.hint}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {USE_CASES.map((useCase, index) => (
                <motion.div
                  key={useCase.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + index * 0.05 }}
                >
                  <UseCaseToggleCard
                    useCase={useCase}
                    isEnabled={enabledUseCases.has(useCase.id)}
                    onToggle={() => toggleUseCase(useCase.id)}
                    onClick={() => onSelectUseCase(useCase.id)}
                    isOpening={openingUseCaseId === useCase.id}
                    // Waehrend ein Fall laedt, sind die anderen gesperrt: ein
                    // zweiter Abruf wuerde dieselben Daten parallel holen und
                    // am Ende die Ansicht des zuerst geklickten ueberschreiben.
                    isBlocked={openingUseCaseId !== null}
                    available={availability(useCase).available}
                    unavailableReason={availability(useCase).reason}
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
