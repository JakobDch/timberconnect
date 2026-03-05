import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Scan,
  Smartphone,
  ArrowRight,
  TreePine,
  CheckCircle2,
  MapPin,
  Award,
  BadgeCheck,
  Wrench,
  Hammer,
  FileText,
  MessageCircle,
  Loader2,
  Database,
  Upload,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { getAllProductsAsync, type ProductConfig, getCatalogError } from '../../config/solidPods';
import { UploadTab } from './UploadTab';
import { QRScannerModal } from './QRScannerModal';

type TabType = 'scan' | 'upload';

interface ScannerViewProps {
  onProductScanned: (productId: string) => void;
  isLoading?: boolean;
}

export function ScannerView({ onProductScanned, isLoading = false }: ScannerViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('scan');
  const [manualId, setManualId] = useState('');
  const [products, setProducts] = useState<ProductConfig[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [isScanning] = useState(false);
  const [isScannerModalOpen, setIsScannerModalOpen] = useState(false);
  const manualInputRef = useRef<HTMLInputElement>(null);

  // Load products from catalog on mount
  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const loadedProducts = await getAllProductsAsync();
      setProducts(loadedProducts);
      if (loadedProducts.length > 0 && !selectedProductId) {
        setSelectedProductId(loadedProducts[0].id);
      }
    } catch (error) {
      const errorMsg = getCatalogError() || 'Fehler beim Laden des Katalogs';
      setCatalogError(errorMsg);
      console.error('[ScannerView] Failed to load products:', error);
    } finally {
      setCatalogLoading(false);
    }
  }

  const handleOpenScanner = () => {
    if (isLoading) return;
    setIsScannerModalOpen(true);
  };

  const handleScanSuccess = (productId: string) => {
    setIsScannerModalOpen(false);
    onProductScanned(productId);
  };

  const handleManualInputFocus = () => {
    setIsScannerModalOpen(false);
    setTimeout(() => {
      manualInputRef.current?.focus();
      manualInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualId.trim() && !isLoading) {
      onProductScanned(manualId.trim());
    }
  };

  const handleQuickSelect = (productId: string) => {
    if (!isLoading) {
      onProductScanned(productId);
    }
  };

  // Show loading state when fetching data
  const showLoading = isScanning || isLoading;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Hero Section - Dark Forest */}
      <section className="relative bg-gradient-to-br from-forest-900 via-forest-950 to-forest-950 overflow-hidden">
        {/* VR Demonstrator Background Image */}
        <img
          src="./images/VR-Demonstrator.png"
          alt=""
          className="absolute inset-0 w-full h-full object-contain object-center opacity-30"
        />
        {/* Subtle gradient overlays */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-forest-600/10 rounded-full blur-[120px]" />
          <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-forest-500/8 rounded-full blur-[100px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-16 lg:py-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left Content - Enterprise B2B Style */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="space-y-6 sm:space-y-8"
            >
              {/* Headline */}
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight tracking-tight">
                Lückenlose{' '}
                <span className="block">Lieferketten-Transparenz</span>
              </h1>

              {/* Supporting Text */}
              <p className="text-base sm:text-lg text-forest-200/80 leading-relaxed max-w-xl">
                Verfolgen Sie Holzprodukte entlang der gesamten Wertschöpfungskette.
                Von der Forstwirtschaft über die Verarbeitung bis zur Verbauung –
                verifiziert durch dezentrale Solid Pod Technologie.
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                <button
                  onClick={handleOpenScanner}
                  disabled={showLoading}
                  className="btn btn-primary btn-lg"
                >
                  <Scan className="w-5 h-5" />
                  <span>Produkt scannen</span>
                </button>
                <button
                  onClick={() => setActiveTab('upload')}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all border border-white/20 bg-white/10 text-white hover:bg-white/20"
                >
                  <Upload className="w-5 h-5" />
                  <span>Daten hochladen</span>
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all border border-white/20 bg-white/10 text-white hover:bg-white/20"
                >
                  <ArrowRight className="w-5 h-5" />
                  <span>Mehr erfahren</span>
                </button>
              </div>

              {/* Technology Hint */}
              <p className="text-sm text-forest-300/60">
                Basierend auf Solid Protocol
              </p>
            </motion.div>

            {/* Right - Scanner Widget (Tree Ring Style) */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="flex justify-center lg:justify-end"
            >
              <div className="relative">
                {/* Scanner container - Mobile-Optimized Tree Ring Style */}
                <div className="relative w-56 h-56 sm:w-80 sm:h-80 lg:w-96 lg:h-96">
                  {/* Concentric rings like tree rings */}
                  {[0, 1, 2, 3, 4].map((i) => (
                    <motion.div
                      key={i}
                      className="absolute rounded-full border"
                      style={{
                        inset: `${i * 20}px`,
                        borderColor: isScanning
                          ? `rgba(80, 179, 127, ${0.5 - i * 0.08})`
                          : `rgba(80, 179, 127, ${0.2 - i * 0.03})`,
                        borderWidth: i === 0 ? '2px' : '1px',
                      }}
                      animate={
                        isScanning
                          ? {
                              scale: [1, 1.02, 1],
                              opacity: [0.5 - i * 0.08, 0.3, 0.5 - i * 0.08],
                            }
                          : {}
                      }
                      transition={{
                        duration: 1.5,
                        repeat: isScanning ? Infinity : 0,
                        delay: i * 0.1,
                        ease: 'easeInOut',
                      }}
                    />
                  ))}

                  {/* Center scan button */}
                  <motion.button
                    onClick={handleOpenScanner}
                    disabled={showLoading}
                    className="absolute inset-[40px] sm:inset-[75px] lg:inset-[90px] rounded-full bg-white text-forest-900 flex flex-col items-center justify-center shadow-2xl shadow-forest-950/50 disabled:cursor-wait group hover:bg-forest-50 transition-colors"
                    whileHover={{ scale: showLoading ? 1 : 1.03 }}
                    whileTap={{ scale: showLoading ? 1 : 0.98 }}
                  >
                    {showLoading ? (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex flex-col items-center"
                      >
                        <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 text-forest-600 animate-spin mb-1 sm:mb-2" />
                        <span className="text-xs sm:text-sm font-semibold text-forest-700">
                          {isLoading ? 'Lade Daten...' : 'Scanne...'}
                        </span>
                      </motion.div>
                    ) : (
                      <>
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-forest-500 flex items-center justify-center mb-1 sm:mb-2 shadow-lg shadow-forest-500/30">
                          <Scan className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                        </div>
                        <span className="text-sm sm:text-base font-bold text-forest-900">Scannen</span>
                        <span className="text-[11px] sm:text-xs text-forest-600 mt-0.5">Produkt scannen</span>
                      </>
                    )}
                  </motion.button>

                  {/* QR Scanner Modal */}
                  <QRScannerModal
                    isOpen={isScannerModalOpen}
                    onClose={() => setIsScannerModalOpen(false)}
                    onScanSuccess={handleScanSuccess}
                    onManualInputClick={handleManualInputFocus}
                  />

                  {/* Scanning beam effect */}
                  <AnimatePresence>
                    {isScanning && (
                      <motion.div
                        initial={{ top: '10%', opacity: 0 }}
                        animate={{ top: '90%', opacity: [0, 1, 1, 0] }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                        className="absolute left-[15%] right-[15%] h-0.5 bg-gradient-to-r from-transparent via-forest-400 to-transparent rounded-full"
                        style={{ boxShadow: '0 0 20px rgba(80, 179, 127, 0.6)' }}
                      />
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Bottom Section */}
      <section className="flex-1 bg-gray-50 px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
        <div className="max-w-4xl mx-auto">
          {/* Content */}
          {activeTab === 'upload' ? (
            <UploadTab
              onUploadSuccess={onProductScanned}
              isLoading={isLoading}
            />
          ) : (
          <>
          {/* Available Products Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="bg-white rounded-2xl border border-gray-200 shadow-soft p-6 sm:p-8 mb-6"
          >
            <div className="flex items-start sm:items-center justify-between gap-4 mb-6">
              <div className="flex items-start sm:items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-forest-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-forest-500/20">
                  <Database className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-timber-dark">Verfügbare Produkte</h2>
                  <p className="text-sm text-timber-gray mt-0.5">
                    Produkte aus dem Datenkatalog ({products.length} gefunden)
                  </p>
                </div>
              </div>
              <button
                onClick={loadProducts}
                disabled={catalogLoading}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                title="Katalog aktualisieren"
              >
                <RefreshCw className={`w-5 h-5 text-timber-gray ${catalogLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Loading State */}
            {catalogLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-forest-500 animate-spin" />
                <span className="ml-3 text-timber-gray">Lade Produkte aus Katalog...</span>
              </div>
            )}

            {/* Error State */}
            {catalogError && !catalogLoading && (
              <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl mb-4">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-800">Katalog nicht erreichbar</p>
                  <p className="text-xs text-red-600 mt-0.5">{catalogError}</p>
                </div>
                <button
                  onClick={loadProducts}
                  className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-medium rounded-lg transition-colors"
                >
                  Erneut versuchen
                </button>
              </div>
            )}

            {/* Empty State */}
            {!catalogLoading && !catalogError && products.length === 0 && (
              <div className="text-center py-12">
                <Database className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-timber-gray">Keine Produkte im Katalog gefunden</p>
                <p className="text-sm text-gray-400 mt-1">
                  Laden Sie Daten hoch oder prüfen Sie die Katalog-Verbindung
                </p>
              </div>
            )}

            {/* Products Grid */}
            {!catalogLoading && products.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
                {products.map((product) => (
                  <motion.button
                    key={product.id}
                    onClick={() => handleQuickSelect(product.id)}
                    disabled={isLoading}
                    className={`relative p-3 sm:p-4 rounded-xl border-2 text-left transition-all ${
                      selectedProductId === product.id
                        ? 'border-forest-500 bg-forest-50'
                        : 'border-gray-200 bg-white hover:border-forest-300 hover:bg-forest-50/50'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    whileHover={{ scale: isLoading ? 1 : 1.02 }}
                    whileTap={{ scale: isLoading ? 1 : 0.98 }}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
                      <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center ${
                        selectedProductId === product.id ? 'bg-forest-500' : 'bg-gray-100'
                      }`}>
                        <TreePine className={`w-3 h-3 sm:w-4 sm:h-4 ${
                          selectedProductId === product.id ? 'text-white' : 'text-gray-500'
                        }`} />
                      </div>
                      <code className={`text-xs sm:text-sm font-mono font-semibold truncate ${
                        selectedProductId === product.id ? 'text-forest-700' : 'text-timber-dark'
                      }`}>
                        {product.id}
                      </code>
                    </div>
                    <p className="text-[10px] sm:text-xs text-timber-gray line-clamp-2">{product.description}</p>
                    {selectedProductId === product.id && (
                      <div className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2">
                        <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-forest-500" />
                      </div>
                    )}
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>

          {/* Manual Input Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="bg-white rounded-2xl border border-gray-200 shadow-soft p-6 sm:p-8 mb-12"
          >
            <div className="flex items-start sm:items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-xl bg-timber-gray/20 flex items-center justify-center flex-shrink-0">
                <Smartphone className="w-6 h-6 text-timber-gray" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-timber-dark">Produkt-ID manuell eingeben</h2>
                <p className="text-sm text-timber-gray mt-0.5">
                  Oder geben Sie eine beliebige Produkt-ID ein
                </p>
              </div>
            </div>

            <form onSubmit={handleManualSubmit} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <input
                  ref={manualInputRef}
                  type="text"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  placeholder="z.B. TC-2025-001"
                  className="input input-lg pr-12"
                  disabled={isLoading}
                />
                {manualId && (
                  <CheckCircle2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-forest-500" />
                )}
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-lg whitespace-nowrap"
                disabled={isLoading || !manualId.trim()}
              >
                <span>Produkt laden</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            </form>
          </motion.div>

          {/* Features Section */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
          >
            <div className="text-center mb-4 sm:mb-8">
              <h3 className="text-lg sm:text-xl font-bold text-timber-dark">Verfügbare Anwendungsfälle</h3>
              <p className="text-xs sm:text-sm text-timber-gray mt-1">
                Wählen Sie nach dem Scan den gewünschten Anwendungsfall
              </p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
              {[
                {
                  title: 'DBPP',
                  description: 'Digitaler Bau Produktpass',
                  icon: FileText,
                  active: true,
                },
                {
                  title: 'Herkunftsnachweis',
                  description: 'Flurstück in Karte',
                  icon: MapPin,
                  active: false,
                },
                {
                  title: 'PEFC/FSC',
                  description: 'Zertifizierung',
                  icon: Award,
                  active: false,
                },
                {
                  title: 'DGNB',
                  description: 'Zertifizierung',
                  icon: BadgeCheck,
                  active: false,
                },
                {
                  title: 'Wartung',
                  description: 'Handlungsempfehlungen',
                  icon: Wrench,
                  active: false,
                },
                {
                  title: 'Rückbaubarkeit',
                  description: 'Wiederverwendung',
                  icon: Hammer,
                  active: false,
                },
                {
                  title: 'ChatBot',
                  description: 'Sprich mit deinem Bauteil',
                  icon: MessageCircle,
                  active: false,
                },
              ].map((item) => (
                <motion.div
                  key={item.title}
                  whileHover={item.active ? { y: -2 } : {}}
                  className={`relative p-3 sm:p-5 rounded-xl sm:rounded-2xl border transition-all ${
                    item.active
                      ? 'bg-white border-forest-200 shadow-soft cursor-pointer hover:border-forest-300 hover:shadow-forest'
                      : 'bg-gray-100/50 border-gray-200'
                  }`}
                >
                  {item.active && (
                    <div className="absolute -top-1.5 -right-1.5 sm:-top-2 sm:-right-2">
                      <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 sm:py-1 bg-forest-500 text-white text-[8px] sm:text-[10px] font-semibold rounded-full">
                        Verfügbar
                      </span>
                    </div>
                  )}
                  <div
                    className={`w-8 h-8 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl flex items-center justify-center mb-2 sm:mb-4 ${
                      item.active
                        ? 'bg-forest-500 shadow-lg shadow-forest-500/20'
                        : 'bg-gray-200'
                    }`}
                  >
                    <item.icon
                      className={`w-4 h-4 sm:w-5 sm:h-5 ${item.active ? 'text-white' : 'text-gray-400'}`}
                    />
                  </div>
                  <h4
                    className={`text-xs sm:text-base font-semibold mb-0.5 sm:mb-1 ${
                      item.active ? 'text-timber-dark' : 'text-gray-400'
                    }`}
                  >
                    {item.title}
                  </h4>
                  <p className={`text-[10px] sm:text-sm ${item.active ? 'text-timber-gray' : 'text-gray-400'}`}>
                    {item.description}
                  </p>
                  {!item.active && (
                    <span className="inline-block mt-2 sm:mt-3 text-[9px] sm:text-xs font-medium text-gray-400 bg-gray-200 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded">
                      Demnächst
                    </span>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.div>
          </>
          )}
        </div>
      </section>
    </div>
  );
}
