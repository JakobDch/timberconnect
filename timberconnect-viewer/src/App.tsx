import { useState, useCallback, useEffect } from 'react';
import { Header, ForestBackground } from './components/Layout';
import { ScannerView } from './components/Scanner';
import { UseCaseGrid } from './components/UseCases';
import { ProductPassView } from './components/ProductPass';
import { fetchProductData, type SourceStatus } from './services/sparqlService';
import { mapToProduct, mapToSupplyChain } from './services/productMapper';
import { initializeCatalog } from './config/solidPods';
import type { AppView, Product, SupplyChainStep } from './types';
import logoNrwMunv from '/logo-nrw-munv.png';
import logoEuKofinanziert from '/logo-eu-kofinanziert.png';

function App() {
  const [currentView, setCurrentView] = useState<AppView>('scanner');
  const [productId, setProductId] = useState<string>('');
  const [product, setProduct] = useState<Product | null>(null);
  const [supplyChain, setSupplyChain] = useState<SupplyChainStep[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Initialize catalog on app startup (pre-fetch for better UX)
  useEffect(() => {
    initializeCatalog().catch((err) => {
      console.warn('[App] Catalog initialization failed:', err);
    });
  }, []);

  const loadProductData = useCallback(async (traceId: string) => {
    setIsLoading(true);
    setError(null);
    setWarnings([]);
    setSourceStatus([]);

    try {
      console.log('[App] Loading product data for traceId:', traceId);

      const data = await fetchProductData(traceId);

      console.log('[App] Received data:', data);

      // Store source status for UI display
      setSourceStatus(data.sourceStatus);

      // Store any warnings (e.g., unavailable sources)
      if (data.errors.length > 0) {
        setWarnings(data.errors);
      }

      // Log source availability
      const availableSources = data.sourceStatus.filter((s) => s.available);
      const unavailableSources = data.sourceStatus.filter((s) => !s.available);
      if (availableSources.length > 0) {
        console.log(
          '[App] Data loaded from pods:',
          availableSources.map((s) => s.pod).join(', ')
        );
      }
      if (unavailableSources.length > 0) {
        console.warn(
          '[App] Unavailable pods:',
          unavailableSources.map((s) => s.pod).join(', ')
        );
      }

      // Map the SPARQL results to our UI types
      const mappedProduct = mapToProduct(
        data.product,
        data.stem,
        data.forest,
        data.bspWerk
      );

      const mappedSupplyChain = mapToSupplyChain(
        data.forest,
        data.sawmill,
        data.bspWerk,
        data.supplyChain,
        data.businessPartners,
        data.stem
      );

      if (mappedProduct) {
        setProduct(mappedProduct);
        setSupplyChain(mappedSupplyChain);
        return true;
      } else {
        // No data found in Solid Pod
        console.log('[App] No product data found in Solid Pod');
        setError('Keine Daten für dieses Produkt gefunden. Prüfen Sie, ob die Produkt-ID korrekt ist.');
        setProduct(null);
        setSupplyChain([]);
        return false;
      }
    } catch (err) {
      console.error('[App] Error loading product data:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Produktdaten');
      setProduct(null);
      setSupplyChain([]);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleProductScanned = async (id: string) => {
    setProductId(id);
    await loadProductData(id);
    setCurrentView('usecases');
  };

  const handleSelectUseCase = (useCaseId: string) => {
    if (useCaseId === 'dbpp') {
      setCurrentView('productpass');
    }
  };

  const handleBackToScanner = () => {
    setCurrentView('scanner');
    setProductId('');
    setProduct(null);
    setSupplyChain([]);
    setError(null);
  };

  const handleBackToUseCases = () => {
    setCurrentView('usecases');
  };

  const handleLogoClick = () => {
    handleBackToScanner();
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <ForestBackground />
      <Header onLogoClick={handleLogoClick} />

      <main className="flex-1 flex flex-col relative">
        {currentView === 'scanner' && (
          <ScannerView
            onProductScanned={handleProductScanned}
            isLoading={isLoading}
          />
        )}

        {currentView === 'usecases' && (
          <UseCaseGrid
            productId={productId}
            product={product}
            supplyChain={supplyChain}
            onSelectUseCase={handleSelectUseCase}
            onBack={handleBackToScanner}
            isLoading={isLoading}
            error={error}
            warnings={warnings}
            sourcePods={sourceStatus.filter((s) => s.available).map((s) => s.pod)}
          />
        )}

        {currentView === 'productpass' && product && (
          <ProductPassView
            productId={productId}
            product={product}
            supplyChain={supplyChain}
            onBack={handleBackToUseCases}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between">
          <p className="text-sm text-timber-gray">TimberConnect - Transparenz in der Holzlieferkette</p>
          <div className="flex items-center gap-4">
            <img
              src={logoNrwMunv}
              alt="Ministerium für Umwelt, Naturschutz und Verkehr des Landes Nordrhein-Westfalen"
              className="h-24 object-contain"
            />
            <img
              src={logoEuKofinanziert}
              alt="Kofinanziert von der Europäischen Union"
              className="h-16 object-contain"
            />
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
