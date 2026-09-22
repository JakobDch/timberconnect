import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ScanLine,
  Layers,
  Loader2,
  RefreshCw,
  AlertCircle,
  Target,
  MapPin,
} from 'lucide-react';
import {
  getAllProductsAsync,
  getCatalogError,
  type ProductConfig,
} from '../../config/solidPods';
import {
  getRecentScans,
  formatShortDate,
  type RecentScan,
} from '../../services/recentActivity';
import { ScanInputModal } from './ScanInputModal';
import { LocationScanSheet } from './LocationScanSheet';
import { DataspacePanel } from '../Dataspace';
import type { ScanSource } from '../../services/identifiers';
import type { Product } from '../../types';

/**
 * Scan-Screen "Holzbauteil identifizieren".
 *
 * Zwei Wege zur ID, weil es zwei Arten von Gegenstaenden gibt:
 *
 *   * Code — ein Bauteil traegt seinen Ident als DotCode, Barcode oder
 *     RFID-Tag. Erfasst wird er im ScanInputModal; die Zebra-Geraete geben
 *     ihn als Tastatureingabe aus, getippt werden kann er ebenso.
 *   * Standort — eine PFLANZUNG traegt kein Etikett. Sie ist ueber ihre auf
 *     der Karte gezeichnete Flaeche bestimmt: Wer darauf steht, hat sie
 *     identifiziert. Das uebernimmt das LocationScanSheet, das aus der
 *     Position den EPC des Vermehrungsguts ermittelt.
 *
 * Beide muenden in denselben onProductScanned-Aufruf — was danach passiert,
 * unterscheidet sich nicht.
 *
 * Der frueher vorhandene Kamera-/QR-Scanner ist entfallen: im Projekt werden
 * keine QR-Codes verwendet, das Scannen uebernehmen die Zebra-Geraete, und
 * die Kamera braucht ausserdem HTTPS.
 */

interface ScanViewProps {
  onProductScanned: (productId: string, source: ScanSource) => void;
  isLoading?: boolean;
  error?: string | null;
  scannedProduct?: Product | null;
  /** Vorgewaehlter Anwendungsfall (Auswahl vor dem Scan). */
  targetUseCaseTitle?: string | null;
  /** Die Erfassung direkt oeffnen, statt nur den Scan-Screen zu zeigen. */
  autoOpenInput?: boolean;
  /** Woher die zuletzt verwendete ID kam. */
  scanSource?: ScanSource | null;
  /** Fehler verwerfen, sobald die Erfassung geschlossen wird. */
  onDismissError?: () => void;
  /** Meldet, ob die Erfassung offen ist — der globale Scan-Hook pausiert dann. */
  onInputOpenChange?: (open: boolean) => void;
}

export function ScanView({
  onProductScanned,
  isLoading = false,
  error = null,
  scannedProduct = null,
  targetUseCaseTitle = null,
  autoOpenInput = false,
  onDismissError,
  onInputOpenChange,
}: ScanViewProps) {
  const [isInputOpen, setIsInputOpen] = useState(false);
  const [isLocationOpen, setIsLocationOpen] = useState(false);
  /** Der Datenraum-Graph — wird beim Abfragestart ins Bild geholt. */
  const dataspaceRef = useRef<HTMLDivElement>(null);

  // Der globale Hardware-Scan pausiert, solange EINER der beiden Dialoge offen
  // ist. Im Standort-Sheet steckt die Ortssuche mit einem Textfeld — ein
  // Tastendruck dort darf nicht als Geraete-Scan gedeutet werden.
  useEffect(() => {
    onInputOpenChange?.(isInputOpen || isLocationOpen);
  }, [isInputOpen, isLocationOpen, onInputOpenChange]);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);

  const [products, setProducts] = useState<ProductConfig[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    setRecentScans(getRecentScans());
    loadProducts();
  }, []);

  // Verlauf aktualisieren, sobald ein Treffer da ist — gleich ueber welchen
  // der beiden Wege er kam. Geschlossen sind die Dialoge zu diesem Zeitpunkt
  // laengst (siehe den Effekt darunter).
  useEffect(() => {
    if (scannedProduct) setRecentScans(getRecentScans());
  }, [scannedProduct]);

  /**
   * Die Dialoge schliessen, SOBALD die Abfrage laeuft — nicht erst mit dem
   * Ergebnis.
   *
   * Beide sind Vollbild-Overlays. Blieben sie waehrend der Abfrage offen,
   * verdeckten sie genau das, was der Datenraum-Graph in dieser Zeit zeigt,
   * und der Nutzer sah statt der Kette nur einen Kreisel — ueber "Produkt
   * erfassen" war die Animation deshalb nie zu sehen, ueber "Zuletzt
   * gescannt" (kein Overlay) dagegen schon (Rueckmeldung 22.09.2026).
   *
   * Der Ladezustand geht damit nicht verloren: der Scan-Knopf zeigt ihn
   * weiter, und die Statuszeile des Graphen sagt genauer, woran es gerade
   * liegt. Fehler stehen nach dem Schliessen im Scan-Screen selbst.
   */
  useEffect(() => {
    if (!isLoading) return;
    setIsInputOpen(false);
    setIsLocationOpen(false);

    // Auf dem Handy stehen Graph und Verlauf UNTER dem Scan-Knopf; nach dem
    // Schliessen des Dialogs laege der Graph sonst ausserhalb des Bildes und
    // die Animation liefe ungesehen ab. Am Desktop (zweispaltig) ist er
    // ohnehin sichtbar — `scrollIntoView` bleibt dort folgenlos.
    dataspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [isLoading]);

  async function loadProducts() {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      setProducts(await getAllProductsAsync());
    } catch (err) {
      setCatalogError(getCatalogError() || 'Fehler beim Laden des Katalogs');
      console.error('[ScanView] Failed to load products:', err);
    } finally {
      setCatalogLoading(false);
    }
  }

  // Kommt der Nutzer mit gewaehltem Anwendungsfall, geht die Erfassung sofort
  // auf — das Erfassen ist dann der einzige Grund fuer den Besuch.
  useEffect(() => {
    if (autoOpenInput && !scannedProduct) setIsInputOpen(true);
  }, [autoOpenInput, scannedProduct]);

  const openInput = () => {
    if (isLoading) return;
    onDismissError?.();
    setIsInputOpen(true);
  };

  const closeInput = () => {
    setIsInputOpen(false);
    onDismissError?.();
  };

  const openLocation = () => {
    if (isLoading) return;
    onDismissError?.();
    setIsLocationOpen(true);
  };

  /**
   * Eine ueber den Standort gefundene Pflanzung uebernehmen.
   *
   * Ab hier ist kein Unterschied mehr zum Scan: Der EPC ist eine kanonische
   * URN und laeuft durch denselben Weg. Als Quelle gilt 'manual' — die ID
   * wurde nicht von einem Geraet gelesen.
   */
  const handleLocationSelect = (epc: string) => {
    onProductScanned(epc, 'manual');
  };

  return (
    <div className="flex-1 bg-night-900">
      <div className="max-w-md lg:max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="lg:grid lg:grid-cols-2 lg:gap-16 lg:items-start">
          {/* Linke Spalte */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <h1 className="text-4xl sm:text-5xl font-extrabold leading-[1.08] tracking-tight text-white">
                Holzbauteil
                <span className="block text-acid-400">identifizieren</span>
              </h1>
              {/* Wortlaut der Praxispartner ("Feedback App_Allgemein",
                  17.09.2026, Folie 4): "Baum" statt "Pflanzung", weil das
                  fuer Anwender das greifbare Ding ist -- technisch bleibt
                  es die ueber ihre Flaeche identifizierte Pflanzung. */}
              <p className="text-night-300 mt-3 max-w-sm leading-relaxed">
                Dotcode, Barcode oder RFID-Tag scannen oder die ID händisch
                eingeben. Ein Baum hat keinen physischen Kennzeichnungsträger
                — er lässt sich mittels Geokoordinate bzw. dem Standort finden.
              </p>

              {targetUseCaseTitle && (
                <div className="mt-4 inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-acid-400/10 border border-acid-400/30 max-w-full">
                  <Target className="w-4 h-4 text-acid-300 flex-shrink-0" />
                  <span className="text-sm text-acid-200 truncate">
                    Weiter zu <span className="font-semibold">{targetUseCaseTitle}</span>
                  </span>
                </div>
              )}
            </motion.div>

            {/* Erfassung starten */}
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15, duration: 0.4 }}
              className="flex justify-center my-8 sm:my-10"
            >
              <div className="relative w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="absolute rounded-full border border-acid-400"
                    style={{ inset: `${i * 34}px`, opacity: 0.35 - i * 0.1 }}
                    animate={
                      isLoading
                        ? { scale: [1, 1.04, 1], opacity: [0.35, 0.15, 0.35] }
                        : {}
                    }
                    transition={{
                      duration: 1.4,
                      repeat: isLoading ? Infinity : 0,
                      delay: i * 0.15,
                      ease: 'easeInOut',
                    }}
                  />
                ))}

                <motion.button
                  onClick={openInput}
                  disabled={isLoading}
                  className="relative w-32 h-32 sm:w-36 sm:h-36 rounded-full bg-acid-400 text-night-950 flex flex-col items-center justify-center gap-1.5 px-3 text-center shadow-[0_0_60px_rgba(223,233,75,0.35)] disabled:cursor-wait"
                  whileHover={{ scale: isLoading ? 1 : 1.04 }}
                  whileTap={{ scale: isLoading ? 1 : 0.97 }}
                  aria-label="Produkt erfassen"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-8 h-8 animate-spin" />
                      <span className="text-xs font-bold">Lade Daten...</span>
                    </>
                  ) : (
                    <>
                      <ScanLine className="w-8 h-8" />
                      <span className="text-xs font-bold leading-tight">
                        Produkt erfassen
                      </span>
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>

            {/* Der zweite Weg: Standort statt Code. Bewusst unter dem
                Scan-Knopf und flacher gestaltet — der Scan bleibt der
                Regelfall, die Standortsuche gilt der Pflanzung, die als
                einzige Station der Kette kein Etikett tragen kann. */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22, duration: 0.4 }}
              className="flex justify-center -mt-2 mb-8"
            >
              <button
                onClick={openLocation}
                disabled={isLoading}
                className="inline-flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-night-800 hover:bg-night-700 border border-white/10 transition-colors disabled:opacity-60 text-left"
              >
                <span className="w-9 h-9 rounded-xl bg-night-700 border border-white/5 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-4.5 h-4.5 text-acid-300" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">
                    Baum finden
                  </span>
                  <span className="block text-xs text-night-400 mt-0.5">
                    GPS-Koordinaten oder Fläche auf Karte
                  </span>
                </span>
              </button>
            </motion.div>

            {/* Fehler, wenn die Erfassung geschlossen ist (sonst steht er dort) */}
            {error && !isInputOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-3 px-4 py-3 mb-6 bg-red-500/10 border border-red-500/30 rounded-xl"
              >
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm text-red-300">{error}</p>
                  <button
                    onClick={openInput}
                    className="text-xs font-semibold text-acid-300 hover:text-acid-200 mt-2"
                  >
                    Erneut versuchen
                  </button>
                </div>
              </motion.div>
            )}
          </div>

          {/* Rechte Spalte: Verlauf + Katalog */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="mt-10 lg:mt-0 space-y-8"
          >
            {/* Der Datenraum als Bild. Steht VOR dem Verlauf, weil er
                waehrend einer laufenden Abfrage die eigentliche Auskunft
                ist -- der Verlauf ist dann gerade uninteressant. */}
            <div ref={dataspaceRef}>
              <DataspacePanel isLoading={isLoading} />
            </div>

            {recentScans.length > 0 && (
              <section>
                <h2 className="text-[11px] font-bold tracking-[0.16em] text-night-300 uppercase mb-3">
                  Zuletzt gescannt
                </h2>
                <div className="space-y-2.5">
                  {recentScans.map((scan) => (
                    <button
                      key={scan.id}
                      onClick={() => onProductScanned(scan.id, 'manual')}
                      disabled={isLoading}
                      className="w-full flex items-center gap-3 px-4 py-3.5 bg-night-800 hover:bg-night-700 border border-white/5 rounded-2xl transition-colors text-left disabled:opacity-60"
                    >
                      <div className="w-10 h-10 rounded-xl bg-night-700 border border-white/5 flex items-center justify-center flex-shrink-0">
                        <Layers className="w-5 h-5 text-acid-300" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">
                          {scan.name}
                        </p>
                        <p className="text-xs font-mono text-night-400 mt-0.5 truncate">
                          {scan.id}
                        </p>
                      </div>
                      <span className="text-xs text-night-400 flex-shrink-0">
                        {formatShortDate(scan.date)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[11px] font-bold tracking-[0.16em] text-night-300 uppercase">
                  Verfügbare Produkte
                </h2>
                <button
                  onClick={loadProducts}
                  disabled={catalogLoading}
                  className="p-1.5 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50"
                  title="Katalog aktualisieren"
                >
                  <RefreshCw
                    className={`w-4 h-4 text-night-300 ${catalogLoading ? 'animate-spin' : ''}`}
                  />
                </button>
              </div>

              {catalogLoading && (
                <div className="flex items-center gap-3 px-4 py-6 text-night-300 text-sm">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Lade Produkte aus Katalog...
                </div>
              )}

              {catalogError && !catalogLoading && (
                <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                  <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-red-300">
                      Katalog nicht erreichbar
                    </p>
                    <p className="text-xs text-red-400/80 mt-0.5">{catalogError}</p>
                  </div>
                  <button
                    onClick={loadProducts}
                    className="px-3 py-1.5 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-medium rounded-lg transition-colors flex-shrink-0"
                  >
                    Erneut
                  </button>
                </div>
              )}

              {!catalogLoading && !catalogError && products.length === 0 && (
                <p className="px-4 py-4 text-sm text-night-400">
                  Keine Produkte im Katalog gefunden.
                </p>
              )}

              {!catalogLoading && products.length > 0 && (
                <div className="space-y-2.5">
                  {products.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => onProductScanned(product.id, 'manual')}
                      disabled={isLoading}
                      className="w-full flex items-center gap-3 px-4 py-3.5 bg-night-800 hover:bg-night-700 border border-white/5 rounded-2xl transition-colors text-left disabled:opacity-60"
                    >
                      <div className="w-10 h-10 rounded-xl bg-night-700 border border-white/5 flex items-center justify-center flex-shrink-0">
                        <Layers className="w-5 h-5 text-acid-300" />
                      </div>
                      {/* Name oben, ID darunter -- nicht umgekehrt. Die Liste
                          zeigt Bauteile; die Material-ID ist ihr Merkmal,
                          nicht ihr Name. Vorher stand die rohe ID als Titel
                          und darunter die Beschreibung der Datei, aus der sie
                          stammte (Rueckmeldung Anni, 26.08.2026). */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">
                          {product.name}
                        </p>
                        <p className="text-xs font-mono text-night-400 mt-0.5 truncate">
                          {product.id}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </motion.div>
        </div>
      </div>

      {/* Erfassung: Eingabe, Ladezustand und Fehler an einer Stelle */}
      <ScanInputModal
        isOpen={isInputOpen}
        isLoading={isLoading}
        error={error}
        onClose={closeInput}
        onSubmit={onProductScanned}
      />

      {/* Der Weg ohne Code: Standort -> Flaeche -> EPC der Pflanzung */}
      <LocationScanSheet
        isOpen={isLocationOpen}
        isLoading={isLoading}
        onClose={() => setIsLocationOpen(false)}
        onSelect={handleLocationSelect}
      />
    </div>
  );
}
