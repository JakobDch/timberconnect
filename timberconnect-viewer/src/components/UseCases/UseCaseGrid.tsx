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
import { useCases } from '../../data/mockData';
import { UseCaseToggleCard } from './UseCaseToggleCard';
import { ProductImageSection } from '../Dashboard';
import { ChatContainer } from '../Chat';
import type { Product, SupplyChainStep } from '../../types';

interface UseCaseGridProps {
  productId: string;
  product: Product | null;
  supplyChain?: SupplyChainStep[];
  dataSources?: string[];
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
  supplyChain = [],
  dataSources = [],
  onSelectUseCase,
  onBack,
  isLoading = false,
  error = null,
  warnings = [],
  sourcePods = [],
}: UseCaseGridProps) {
  // State for enabled use cases (session-only)
  const [enabledUseCases, setEnabledUseCases] = useState<Set<string>>(() => {
    return new Set(useCases.filter((uc) => uc.active).map((uc) => uc.id));
  });

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
  const enabledCount = useCases.filter(
    (uc) => uc.active && enabledUseCases.has(uc.id)
  ).length;

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-h-0">
      {/* Header */}
      <header className="bg-white/95 backdrop-blur-md border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button
            onClick={onBack}
            className="btn btn-ghost gap-2 -ml-3 text-timber-gray hover:text-timber-dark"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Zuruck zum Scanner</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Status Banner */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl mb-8 ${
              error
                ? 'bg-red-50 border border-red-200'
                : isLoading
                ? 'bg-blue-50 border border-blue-200'
                : 'bg-forest-50 border border-forest-200'
            }`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                error ? 'bg-red-100' : isLoading ? 'bg-blue-100' : 'bg-forest-100'
              }`}
            >
              {error ? (
                <AlertCircle className="w-5 h-5 text-red-600" />
              ) : isLoading ? (
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-forest-600" />
              )}
            </div>
            <div className="flex-1">
              {error ? (
                <>
                  <span className="text-sm font-medium text-red-800">Fehler beim Laden</span>
                  <span className="text-sm text-red-600 ml-2">{error}</span>
                </>
              ) : isLoading ? (
                <>
                  <span className="text-sm font-medium text-blue-800">Daten werden geladen...</span>
                  <span className="text-sm text-blue-600 ml-2">Verbinde mit Solid Pod</span>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium text-forest-800">
                    Produkt erfolgreich identifiziert
                  </span>
                  <span className="text-sm text-forest-600 ml-2">
                    {sourcePods.length > 0
                      ? `Daten aus ${sourcePods.length} Pod${sourcePods.length > 1 ? 's' : ''} geladen`
                      : 'Daten aus Solid Pod geladen'}
                  </span>
                </>
              )}
            </div>
            {!error && !isLoading && <Verified className="w-5 h-5 text-forest-600" />}
          </motion.div>

          {/* Warnings Banner */}
          {warnings.length > 0 && !error && !isLoading && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-3 px-4 py-3 rounded-xl mb-4 bg-amber-50 border border-amber-200"
            >
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="text-sm font-medium text-amber-800">Hinweis</span>
                <ul className="text-sm text-amber-700 mt-1">
                  {warnings.map((warning, idx) => (
                    <li key={idx}>{warning}</li>
                  ))}
                </ul>
              </div>
            </motion.div>
          )}

          {/* Dashboard Grid: Product Info + Chat */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-10">
            {/* Product Section - spans 3 columns on desktop */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="lg:col-span-3 bg-white rounded-2xl border border-gray-200 shadow-soft-lg overflow-hidden"
            >
              {/* Header with dark forest background */}
              <div className="relative bg-gradient-to-br from-forest-900 via-forest-950 to-forest-950 px-6 py-5">
                <div className="absolute inset-0">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-forest-600/10 rounded-full blur-[80px]" />
                </div>
                <div className="relative flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center">
                    <TreePine className="w-7 h-7 text-forest-300" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/20 text-forest-300 text-xs font-medium rounded-full">
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
                    productType={product?.productType}
                    productName={displayProduct.name}
                  />

                  {/* Product Facts */}
                  <div className="flex flex-col">
                    {displayProduct.description && (
                      <p className="text-timber-gray mb-4 text-sm">{displayProduct.description}</p>
                    )}

                    {/* Product Details */}
                    <div className="grid grid-cols-2 gap-3 flex-1">
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <Package className="w-5 h-5 text-forest-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs text-timber-gray uppercase tracking-wide">
                            Holzart
                          </div>
                          <div className="font-semibold text-timber-dark truncate">
                            {displayProduct.woodType}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <Shield className="w-5 h-5 text-forest-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs text-timber-gray uppercase tracking-wide">
                            Qualitat
                          </div>
                          <div className="font-semibold text-timber-dark truncate">
                            {displayProduct.quality || '-'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <MapPin className="w-5 h-5 text-forest-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs text-timber-gray uppercase tracking-wide">
                            Herkunft
                          </div>
                          <div className="font-semibold text-timber-dark truncate">{origin}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <Calendar className="w-5 h-5 text-forest-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs text-timber-gray uppercase tracking-wide">
                            Einschlag
                          </div>
                          <div className="font-semibold text-timber-dark truncate">
                            {harvestDate}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Product ID Section */}
                    <div className="pt-4 mt-4 border-t border-gray-100">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Hash className="w-4 h-4 text-timber-gray" />
                          <div>
                            <div className="text-xs text-timber-gray uppercase tracking-wide mb-0.5">
                              Produkt-ID
                            </div>
                            <code className="text-xs font-mono text-timber-dark bg-gray-100 px-2 py-1 rounded">
                              {productId}
                            </code>
                          </div>
                        </div>
                        <button className="btn btn-ghost btn-sm gap-1.5 text-timber-gray hover:text-timber-dark text-xs">
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Solid Pod</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Chat Container - spans 2 columns on desktop */}
            <div className="lg:col-span-2">
              {product && (
                <ChatContainer
                  productId={productId}
                  product={product}
                  supplyChain={supplyChain}
                  dataSources={dataSources}
                />
              )}
            </div>
          </div>

          {/* Use Cases Section */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-timber-dark">Anwendungsfalle</h2>
                <p className="text-sm text-timber-gray mt-1">
                  Aktivieren oder deaktivieren Sie die gewunschten Module
                </p>
              </div>
              <span className="px-3 py-1 bg-forest-100 text-forest-700 text-sm font-medium rounded-full">
                {enabledCount} aktiv
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {useCases.map((useCase, index) => (
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
