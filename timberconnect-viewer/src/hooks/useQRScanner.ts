import { useState, useCallback, useRef, useEffect } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export type CameraPermissionState = 'prompt' | 'granted' | 'denied' | 'unavailable';

export interface ScannerError {
  type: 'permission_denied' | 'camera_unavailable' | 'invalid_qr' | 'unknown';
  message: string;
}

interface UseQRScannerOptions {
  onScanSuccess: (productId: string) => void;
  onScanError?: (error: ScannerError) => void;
}

interface UseQRScannerReturn {
  isScanning: boolean;
  permissionState: CameraPermissionState;
  error: ScannerError | null;
  startScanning: (containerId: string) => Promise<void>;
  stopScanning: () => Promise<void>;
  clearError: () => void;
}

export function useQRScanner({
  onScanSuccess,
  onScanError
}: UseQRScannerOptions): UseQRScannerReturn {
  const [isScanning, setIsScanning] = useState(false);
  const [permissionState, setPermissionState] = useState<CameraPermissionState>('prompt');
  const [error, setError] = useState<ScannerError | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const hasScannedRef = useRef(false);

  // Stop scanning
  const stopScanning = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState();
        // Html5QrcodeScannerState: NOT_STARTED = 1, SCANNING = 2, PAUSED = 3
        if (state === 2) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch (err) {
        console.error('[useQRScanner] Error stopping scanner:', err);
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
  }, []);

  // Start scanning
  const startScanning = useCallback(async (containerId: string) => {
    if (scannerRef.current) {
      await stopScanning();
    }

    hasScannedRef.current = false;
    setError(null);

    try {
      // Check camera availability
      const devices = await Html5Qrcode.getCameras();
      if (devices.length === 0) {
        setPermissionState('unavailable');
        const err: ScannerError = {
          type: 'camera_unavailable',
          message: 'Keine Kamera gefunden',
        };
        setError(err);
        onScanError?.(err);
        return;
      }

      setPermissionState('granted');

      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' }, // Prefer back camera
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => {
          // Prevent multiple rapid scans
          if (hasScannedRef.current) return;

          const trimmed = decodedText.trim();

          if (trimmed) {
            hasScannedRef.current = true;

            // Haptic feedback if available
            if ('vibrate' in navigator) {
              navigator.vibrate(100);
            }

            onScanSuccess(trimmed);
          }
        },
        () => {
          // QR code not found in frame - this is normal, ignore
        }
      );

      setIsScanning(true);
    } catch (err) {
      console.error('[useQRScanner] Error starting scanner:', err);

      // Determine error type
      const errorMessage = err instanceof Error ? err.message : String(err);
      let scannerError: ScannerError;

      if (errorMessage.includes('Permission') || errorMessage.includes('NotAllowed')) {
        setPermissionState('denied');
        scannerError = {
          type: 'permission_denied',
          message: 'Kamerazugriff verweigert. Bitte erlauben Sie den Zugriff in den Einstellungen.',
        };
      } else if (errorMessage.includes('NotFound') || errorMessage.includes('device')) {
        setPermissionState('unavailable');
        scannerError = {
          type: 'camera_unavailable',
          message: 'Keine Kamera verfuegbar.',
        };
      } else {
        scannerError = {
          type: 'unknown',
          message: `Fehler beim Starten der Kamera: ${errorMessage}`,
        };
      }

      setError(scannerError);
      onScanError?.(scannerError);
    }
  }, [stopScanning, onScanSuccess, onScanError]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScanning();
    };
  }, [stopScanning]);

  return {
    isScanning,
    permissionState,
    error,
    startScanning,
    stopScanning,
    clearError,
  };
}
