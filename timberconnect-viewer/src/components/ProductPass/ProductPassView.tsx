import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Route,
  Package,
  TreePine,
  Shield,
  Download,
  Share2,
  Verified,
  Clock,
  CheckCircle2,
  ExternalLink,
  QrCode,
  Printer,
} from 'lucide-react';
import { SupplyChainTimeline } from './SupplyChainTimeline';
import { ProductDetails } from './ProductDetails';
import type { Product, SupplyChainStep } from '../../types';

interface ProductPassViewProps {
  productId: string;
  product: Product;
  supplyChain: SupplyChainStep[];
  onBack: () => void;
}

export function ProductPassView({ productId, product, supplyChain, onBack }: ProductPassViewProps) {
  const [activeTab, setActiveTab] = useState<'timeline' | 'details'>('timeline');

  // Helper to safely get certifications
  const certifications = product.certifications || [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 flex flex-col bg-gray-50 min-h-0"
    >
      {/* Header */}
      <header className="bg-white/95 backdrop-blur-md border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <button onClick={onBack} className="btn btn-ghost gap-2 -ml-3 text-timber-gray hover:text-timber-dark">
              <ArrowLeft className="w-5 h-5" />
              <span className="hidden sm:inline">Zurück zur Auswahl</span>
            </button>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost btn-sm gap-2 text-timber-gray hover:text-timber-dark">
                <QrCode className="w-4 h-4" />
                <span className="hidden sm:inline">QR-Code</span>
              </button>
              <button className="btn btn-ghost btn-sm gap-2 text-timber-gray hover:text-timber-dark">
                <Printer className="w-4 h-4" />
                <span className="hidden sm:inline">Drucken</span>
              </button>
              <button className="btn btn-ghost btn-sm gap-2 text-timber-gray hover:text-timber-dark">
                <Share2 className="w-4 h-4" />
                <span className="hidden sm:inline">Teilen</span>
              </button>
              <button className="btn btn-primary btn-sm gap-2">
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Exportieren</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Product Pass Header Card */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-forest-900 via-forest-950 to-forest-950 text-white p-6 sm:p-8 lg:p-10 mb-8"
          >
            {/* Background effects */}
            <div className="absolute inset-0">
              <div className="absolute top-0 right-0 w-96 h-96 bg-forest-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-forest-600/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2" />
            </div>

            <div className="relative flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10">
              {/* Icon */}
              <div className="w-20 h-20 lg:w-24 lg:h-24 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                <Shield className="w-10 h-10 lg:w-12 lg:h-12 text-forest-300" />
              </div>

              {/* Content */}
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-forest-500/20 border border-forest-500/30 rounded-full text-forest-300 text-sm font-medium">
                    <Verified className="w-4 h-4" />
                    Verifiziert
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/10 rounded-full text-white/70 text-sm">
                    <Clock className="w-4 h-4" />
                    Aktualisiert: Heute
                  </span>
                </div>

                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2">
                  Digitaler Bau Produktpass (DBPP)
                </h1>
                <h2 className="text-lg sm:text-xl text-forest-200/80 mb-6">
                  {product.name}
                </h2>

                {/* Quick stats */}
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-xl">
                    <TreePine className="w-5 h-5 text-forest-400" />
                    <span className="font-medium">{product.woodType}</span>
                  </div>
                  {product.quality && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-xl">
                      <Package className="w-5 h-5 text-forest-400" />
                      <span className="font-medium">Qualität {product.quality}</span>
                    </div>
                  )}
                  {certifications.map((cert) => (
                    <div
                      key={cert}
                      className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-xl"
                    >
                      <Shield className="w-5 h-5 text-copper-400" />
                      <span className="font-medium">{cert}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Product ID */}
            <div className="relative mt-8 pt-6 border-t border-white/10">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="text-xs text-forest-300/60 uppercase tracking-wider mb-1">
                    Produkt-Identifikator
                  </div>
                  <code className="text-sm font-mono text-forest-200/80 break-all">
                    {productId}
                  </code>
                </div>
                <button className="btn btn-ghost btn-sm gap-2 text-forest-300/70 hover:text-white">
                  <ExternalLink className="w-4 h-4" />
                  Im Solid Pod öffnen
                </button>
              </div>
            </div>
          </motion.div>

          {/* Tab navigation */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="flex gap-2 mb-8"
          >
            <button
              onClick={() => setActiveTab('timeline')}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl font-semibold transition-all ${
                activeTab === 'timeline'
                  ? 'bg-forest-500 text-white shadow-lg shadow-forest-500/25'
                  : 'bg-white text-timber-gray hover:bg-gray-50 border border-gray-200'
              }`}
            >
              <Route className="w-5 h-5" />
              Lieferkette
            </button>
            <button
              onClick={() => setActiveTab('details')}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl font-semibold transition-all ${
                activeTab === 'details'
                  ? 'bg-forest-500 text-white shadow-lg shadow-forest-500/25'
                  : 'bg-white text-timber-gray hover:bg-gray-50 border border-gray-200'
              }`}
            >
              <Package className="w-5 h-5" />
              Produktdetails
            </button>
          </motion.div>

          {/* Content */}
          <AnimatePresence mode="wait">
            {activeTab === 'timeline' ? (
              <motion.div
                key="timeline"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-timber-dark">
                      Vom Wald bis zum Gebäude
                    </h3>
                    <p className="text-timber-gray">
                      Vollständige Rückverfolgung in {supplyChain.length} Stationen
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-forest-100 text-forest-700 text-sm font-medium rounded-full">
                    <CheckCircle2 className="w-4 h-4" />
                    Vollständig verifiziert
                  </span>
                </div>
                <SupplyChainTimeline steps={supplyChain} />
              </motion.div>
            ) : (
              <motion.div
                key="details"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-timber-dark">
                    Produktinformationen
                  </h3>
                  <p className="text-timber-gray">
                    Detaillierte technische Angaben zum Holzprodukt
                  </p>
                </div>
                <ProductDetails product={product} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
