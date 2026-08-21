import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Package,
  CheckCircle2,
  TreePine,
  Shield,
  ExternalLink,
  Verified,
  MapPin,
  Calendar,
  Hash,
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
import { detectProductStage } from '../../services/productImageService';
import { ProductImageSection } from '../Dashboard';
import type { Product, SupplyChainStep } from '../../types';
import type { ProductDataResult } from '../../services/sparqlService';

interface UseCaseGridProps {
  productId: string;
  product: Product | null;
  /** Rohdaten der Abfrage -- schaerfen die Produktart-Erkennung fuers Bild. */
  productData?: ProductDataResult | null;
  supplyChain?: SupplyChainStep[];
  onSelectUseCase: (useCaseId: string) => void;
  onBack: () => void;
  isLoading?: boolean;
  error?: string | null;
  warnings?: string[];
  sourcePods?: string[];
}

export function UseCaseGrid({
  productId,
  product,
  productData = null,
  supplyChain = [],
  onSelectUseCase,
  onBack,
  isLoading = false,
  error = null,
  warnings = [],
  sourcePods = [],
}: UseCaseGridProps) {
  // State for enabled use cases (session-only)
  const [enabledUseCases, setEnabledUseCases] = useState<Set<string>>(() => {
    return new Set(USE_CASES.filter(isAvailable).map((uc) => uc.id));
  });

  /**
   * Welche Daten zu diesem Bauteil vorliegen — daraus ergibt sich, welche
   * Anwendungsfaelle sich ueberhaupt sinnvoll oeffnen lassen.
   */
  const facts: ProductDataFacts | null = product
    ? {
        hasProduct: (productData?.product?.length ?? 0) > 0 || !!product.name,
        hasForest: (productData?.forest?.length ?? 0) > 0,
        hasSupplyChain:
          (productData?.supplyChain?.length ?? 0) > 0 || supplyChain.length > 0,
        hasDeconstruction: (productData?.deconstruction?.length ?? 0) > 0,
        hasCertificates: (productData?.certificates?.length ?? 0) > 0,
        hasCertifications: (product.certifications?.length ?? 0) > 0,
        // Stufe des gescannten Objekts -- sperrt z.B. die CO2-Bilanz fuer
        // Vorprodukte (nur fuer die fertige BSP-Platte definiert).
        productStage: detectProductStage(product, productData),
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

  const certifications = displayProduct.certifications || [];
  const origin = displayProduct.origin?.region || 'Unbekannt';
  const harvestDate = displayProduct.harvestDate || '-';

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

          {/* Bauteil-Steckbrief. Frueher stand rechts daneben der Chat; er ist
              inzwischen ein eigener Anwendungsfall ("Sprich mit deinem Bauteil")
              und gehoert nicht auf den Bildschirm, auf dem man den Fall erst
              auswaehlt. Deshalb hier volle Breite statt 3 von 5 Spalten. */}
          <div className="mb-10">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-night-800 rounded-2xl border border-white/5 overflow-hidden"
            >
              {/* Header */}
              <div className="relative bg-night-950 px-6 py-5">
                <div className="absolute inset-0">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-acid-400/5 rounded-full blur-[80px]" />
                </div>
                <div className="relative flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center">
                    <TreePine className="w-7 h-7 text-acid-300" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-acid-400/15 text-acid-300 text-xs font-medium rounded-full border border-acid-400/30">
                        <Verified className="w-3 h-3" />
                        Verifiziert
                      </span>
                      {certifications.map((cert) => (
                        <span
                          key={cert}
                          className="px-2 py-0.5 bg-white/10 text-white/80 text-xs font-medium rounded-full"
                        >
                          {cert}
                        </span>
                      ))}
                    </div>
                    <h1 className="text-xl font-bold text-white">{displayProduct.name}</h1>
                  </div>
                </div>
              </div>

              {/* Content with Image and Facts */}
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Product Image */}
                  <ProductImageSection
                    product={product}
                    productData={productData}
                    productType={product?.productType}
                    productName={displayProduct.name}
                  />

                  {/* Product Facts */}
                  <div className="flex flex-col">
                    {displayProduct.description && (
                      <p className="text-night-300 mb-4 text-sm">{displayProduct.description}</p>
                    )}

                    {/* Product Details */}
                    <div className="grid grid-cols-2 gap-3 flex-1">
                      <div className="flex items-center gap-3 p-3 bg-night-700/50 border border-white/5 rounded-xl">
                        <Package className="w-5 h-5 text-acid-300 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs text-night-300 uppercase tracking-wide">
                            Holzart
                          </div>
                          <div className="font-semibold text-white truncate">
                            {displayProduct.woodType}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-night-700/50 border border-white/5 rounded-xl">
                        <Shield className="w-5 h-5 text-acid-300 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs text-night-300 uppercase tracking-wide">
                            Qualität
                          </div>
                          <div className="font-semibold text-white truncate">
                            {displayProduct.quality || '-'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-night-700/50 border border-white/5 rounded-xl">
                        <MapPin className="w-5 h-5 text-acid-300 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs text-night-300 uppercase tracking-wide">
                            Herkunft
                          </div>
                          <div className="font-semibold text-white truncate">{origin}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-night-700/50 border border-white/5 rounded-xl">
                        <Calendar className="w-5 h-5 text-acid-300 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs text-night-300 uppercase tracking-wide">
                            Einschlag
                          </div>
                          <div className="font-semibold text-white truncate">
                            {harvestDate}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Product ID Section */}
                    <div className="pt-4 mt-4 border-t border-white/5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <Hash className="w-4 h-4 text-night-300 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs text-night-300 uppercase tracking-wide mb-0.5">
                              Produkt-ID
                            </div>
                            <code className="block text-xs font-mono text-night-100 bg-night-900 px-2 py-1 rounded truncate">
                              {productId}
                            </code>
                          </div>
                        </div>
                        <button className="inline-flex items-center gap-1.5 text-xs font-medium text-night-300 hover:text-white transition-colors flex-shrink-0">
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Solid Pod</span>
                        </button>
                      </div>
                    </div>
                  </div>
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
