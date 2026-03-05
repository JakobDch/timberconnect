import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, CameraOff, Keyboard } from 'lucide-react';
import { useQRScanner } from '../../hooks/useQRScanner';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (productId: string) => void;
  onManualInputClick: () => void;
}

const SCANNER_CONTAINER_ID = 'qr-scanner-container';

export function QRScannerModal({
  isOpen,
  onClose,
  onScanSuccess,
  onManualInputClick,
}: QRScannerModalProps) {
  const handleScanSuccess = useCallback(
    (productId: string) => {
      onScanSuccess(productId);
      onClose();
    },
    [onScanSuccess, onClose]
  );

  const { isScanning, permissionState, startScanning, stopScanning } =
    useQRScanner({
      onScanSuccess: handleScanSuccess,
    });

  // Start/stop scanner based on modal state
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        startScanning(SCANNER_CONTAINER_ID);
      }, 100);
      return () => clearTimeout(timer);
    } else {
      stopScanning();
    }
  }, [isOpen, startScanning, stopScanning]);

  const handleManualInput = () => {
    onClose();
    onManualInputClick();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/95"
      >
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10 bg-black/50 backdrop-blur-sm">
          <div className="flex items-center justify-between px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
              aria-label="Schliessen"
            >
              <X className="w-5 h-5 text-white" />
            </button>
            <div className="flex items-center gap-2 text-white">
              <Camera className="w-5 h-5" />
              <span className="font-medium">QR-Code scannen</span>
            </div>
            <div className="w-10" />
          </div>
        </div>

        {/* Scanner Container */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-full max-w-md px-4">
            {/* Camera Feed */}
            <div
              id={SCANNER_CONTAINER_ID}
              className="w-full aspect-square rounded-2xl overflow-hidden bg-gray-900"
            />

            {/* Scanning Frame Overlay */}
            {isScanning && (
              <div className="absolute inset-4 pointer-events-none">
                <div className="relative w-full h-full">
                  {/* Corner markers */}
                  <div className="absolute w-8 h-8 border-forest-400 border-t-4 border-l-4 top-0 left-0 rounded-tl-lg" />
                  <div className="absolute w-8 h-8 border-forest-400 border-t-4 border-r-4 top-0 right-0 rounded-tr-lg" />
                  <div className="absolute w-8 h-8 border-forest-400 border-b-4 border-l-4 bottom-0 left-0 rounded-bl-lg" />
                  <div className="absolute w-8 h-8 border-forest-400 border-b-4 border-r-4 bottom-0 right-0 rounded-br-lg" />

                  {/* Animated scan line */}
                  <motion.div
                    className="absolute left-4 right-4 h-0.5 bg-gradient-to-r from-transparent via-forest-400 to-transparent"
                    style={{ boxShadow: '0 0 10px rgba(80, 179, 127, 0.8)' }}
                    initial={{ top: '10%' }}
                    animate={{ top: '90%' }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      repeatType: 'reverse',
                      ease: 'easeInOut',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Permission Denied State */}
            {permissionState === 'denied' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 rounded-2xl p-6 text-center">
                <CameraOff className="w-16 h-16 text-gray-500 mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">
                  Kamerazugriff verweigert
                </h3>
                <p className="text-sm text-gray-400 mb-6">
                  Bitte erlauben Sie den Kamerazugriff in Ihren Browser-Einstellungen,
                  um QR-Codes zu scannen.
                </p>
                <button onClick={handleManualInput} className="btn btn-primary">
                  <Keyboard className="w-5 h-5" />
                  <span>Manuell eingeben</span>
                </button>
              </div>
            )}

            {/* Camera Unavailable State */}
            {permissionState === 'unavailable' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 rounded-2xl p-6 text-center">
                <CameraOff className="w-16 h-16 text-gray-500 mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">
                  Keine Kamera verfuegbar
                </h3>
                <p className="text-sm text-gray-400 mb-6">
                  Auf diesem Geraet wurde keine Kamera gefunden.
                </p>
                <button onClick={handleManualInput} className="btn btn-primary">
                  <Keyboard className="w-5 h-5" />
                  <span>Manuell eingeben</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Instructions */}
        <div className="absolute bottom-0 left-0 right-0 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center">
          <p className="text-white/80 mb-4">
            Richten Sie die Kamera auf den QR-Code des Holzprodukts
          </p>
          <button
            onClick={handleManualInput}
            className="text-forest-400 hover:text-forest-300 font-medium transition-colors"
          >
            <span className="flex items-center justify-center gap-2">
              <Keyboard className="w-4 h-4" />
              Produkt-ID manuell eingeben
            </span>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
