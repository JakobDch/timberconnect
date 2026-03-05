import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  TreePine,
  Factory,
  Building2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  X,
  HelpCircle,
  LogIn,
  Database,
} from 'lucide-react';
import {
  detectFiles,
  uploadAndConvertAuto,
  convertAndUploadWithSession,
  getCatalogs,
  type DetectedFile,
  type AutoUploadResult,
  type Catalog,
} from '../../services/uploadService';
import { useAuth } from '../../auth/AuthContext';

interface UploadTabProps {
  onUploadSuccess: (traceId: string) => void;
  isLoading?: boolean;
  onLoginClick?: () => void;
}

interface FileWithDetection {
  file: File;
  detection: DetectedFile | null;
  isDetecting: boolean;
}

const DATA_TYPE_ICONS: Record<string, typeof TreePine> = {
  forst: TreePine,
  saegewerk: Factory,
  bspwerk: Building2,
  unknown: HelpCircle,
};

export function UploadTab({ onUploadSuccess, isLoading = false, onLoginClick }: UploadTabProps) {
  const { isLoggedIn, authenticatedFetch, userName } = useAuth();
  const [files, setFiles] = useState<FileWithDetection[]>([]);
  const [detectedTraceId, setDetectedTraceId] = useState<string | null>(null);
  const [traceIdOverride, setTraceIdOverride] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AutoUploadResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Catalog selection state
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState<number | null>(null);
  const [isLoadingCatalogs, setIsLoadingCatalogs] = useState(false);

  // Fetch available catalogs when user is logged in
  useEffect(() => {
    if (isLoggedIn) {
      setIsLoadingCatalogs(true);
      getCatalogs()
        .then((fetchedCatalogs) => {
          setCatalogs(fetchedCatalogs);
          // Auto-select first catalog if available
          if (fetchedCatalogs.length > 0 && !selectedCatalogId) {
            setSelectedCatalogId(fetchedCatalogs[0].id);
          }
        })
        .catch((err) => {
          console.error('Failed to fetch catalogs:', err);
        })
        .finally(() => {
          setIsLoadingCatalogs(false);
        });
    } else {
      setCatalogs([]);
      setSelectedCatalogId(null);
    }
  }, [isLoggedIn]);

  const handleFilesAdded = useCallback(async (newFiles: File[]) => {
    // Add files with detecting state
    const filesWithDetection: FileWithDetection[] = newFiles.map((file) => ({
      file,
      detection: null,
      isDetecting: true,
    }));

    setFiles((prev) => [...prev, ...filesWithDetection]);
    setError(null);
    setResult(null);

    // Detect file types
    try {
      const response = await detectFiles(newFiles);

      // Update files with detection results
      setFiles((prev) =>
        prev.map((f) => {
          const detection = response.files.find(
            (d) => d.filename === f.file.name
          );
          if (detection && f.isDetecting) {
            return { ...f, detection, isDetecting: false };
          }
          return f;
        })
      );

      // Set detected trace ID
      if (response.detected_trace_id) {
        setDetectedTraceId(response.detected_trace_id);
      }
    } catch (err) {
      console.error('Detection error:', err);
      // Mark files as detected but with no result
      setFiles((prev) =>
        prev.map((f) =>
          f.isDetecting ? { ...f, isDetecting: false } : f
        )
      );
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) {
        handleFilesAdded(droppedFiles);
      }
    },
    [handleFilesAdded]
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      handleFilesAdded(selectedFiles);
    }
    // Reset input
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setFiles([]);
    setDetectedTraceId(null);
    setTraceIdOverride('');
    setError(null);
    setResult(null);
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setError('Bitte waehlen Sie mindestens eine Datei aus.');
      return;
    }

    const effectiveTraceId = traceIdOverride || detectedTraceId;
    if (!effectiveTraceId) {
      setError('Keine Trace-ID erkannt. Bitte geben Sie eine Trace-ID ein.');
      return;
    }

    setIsUploading(true);
    setError(null);
    setResult(null);
    setUploadProgress('Dateien werden hochgeladen und konvertiert...');

    try {
      let uploadResult: AutoUploadResult;

      if (isLoggedIn) {
        // Use frontend upload with user's Solid session
        setUploadProgress('Dateien werden konvertiert...');
        uploadResult = await convertAndUploadWithSession(
          files.map((f) => f.file),
          traceIdOverride || undefined,
          authenticatedFetch,
          selectedCatalogId || undefined,
          userName
        );
      } else {
        // Fallback to backend upload (requires backend token)
        uploadResult = await uploadAndConvertAuto(
          files.map((f) => f.file),
          traceIdOverride || undefined,
          undefined
        );
      }

      setResult(uploadResult);
      setUploadProgress(null);

      if (!uploadResult.success && uploadResult.message) {
        setError(uploadResult.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      setUploadProgress(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleViewProduct = () => {
    if (result?.success) {
      onUploadSuccess(result.trace_id);
    }
  };

  const hasUnrecognizedFiles = files.some(
    (f) => f.detection && !f.detection.is_recognized
  );
  const recognizedCount = files.filter(
    (f) => f.detection?.is_recognized
  ).length;
  const effectiveTraceId = traceIdOverride || detectedTraceId;

  return (
    <div className="space-y-6">
      {/* Drag & Drop Zone */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`relative border-2 border-dashed rounded-2xl p-8 transition-all ${
          isDragging
            ? 'border-forest-500 bg-forest-50'
            : 'border-gray-300 bg-white hover:border-forest-400'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <input
          type="file"
          multiple
          accept=".xml,.json"
          onChange={handleFileInputChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={isUploading}
        />
        <div className="flex flex-col items-center text-center">
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
              isDragging ? 'bg-forest-500' : 'bg-gray-100'
            }`}
          >
            <Upload
              className={`w-8 h-8 ${
                isDragging ? 'text-white' : 'text-gray-400'
              }`}
            />
          </div>
          <h3 className="text-lg font-semibold text-timber-dark mb-2">
            Dateien hier ablegen oder klicken
          </h3>
          <p className="text-sm text-timber-gray">
            Unterstuetzte Formate: XML (StanForD), JSON (ELDAT, VLEX)
          </p>
          <p className="text-xs text-timber-gray mt-1">
            Die Dateien werden automatisch erkannt und zugeordnet
          </p>
        </div>
      </motion.div>

      {/* File List */}
      {files.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-timber-dark">
              Ausgewaehlte Dateien ({files.length})
            </h3>
            <button
              onClick={clearAll}
              className="text-sm text-timber-gray hover:text-red-500 transition-colors"
              disabled={isUploading}
            >
              Alle entfernen
            </button>
          </div>

          <div className="space-y-2">
            <AnimatePresence>
              {files.map((fileItem, index) => {
                const Icon =
                  DATA_TYPE_ICONS[fileItem.detection?.data_type || 'unknown'];
                const isRecognized = fileItem.detection?.is_recognized;

                return (
                  <motion.div
                    key={`${fileItem.file.name}-${index}`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${
                      fileItem.isDetecting
                        ? 'border-gray-200 bg-gray-50'
                        : isRecognized
                        ? 'border-forest-200 bg-forest-50/50'
                        : 'border-amber-200 bg-amber-50/50'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        fileItem.isDetecting
                          ? 'bg-gray-200'
                          : isRecognized
                          ? 'bg-forest-500 text-white'
                          : 'bg-amber-500 text-white'
                      }`}
                    >
                      {fileItem.isDetecting ? (
                        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                      ) : (
                        <Icon className="w-5 h-5" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-timber-dark truncate">
                          {fileItem.file.name}
                        </span>
                        {fileItem.detection?.trace_id && (
                          <span className="text-xs bg-forest-100 text-forest-700 px-2 py-0.5 rounded-full">
                            {fileItem.detection.trace_id}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-timber-gray">
                        {fileItem.isDetecting ? (
                          'Wird erkannt...'
                        ) : fileItem.detection ? (
                          isRecognized ? (
                            <span className="text-forest-600">
                              {fileItem.detection.data_type_name}
                            </span>
                          ) : (
                            <span className="text-amber-600">
                              {fileItem.detection.error || 'Nicht erkannt'}
                            </span>
                          )
                        ) : (
                          'Erkennung fehlgeschlagen'
                        )}
                      </div>
                    </div>

                    {!isRecognized && fileItem.detection && (
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                    )}

                    {isRecognized && (
                      <CheckCircle2 className="w-5 h-5 text-forest-500 flex-shrink-0" />
                    )}

                    <button
                      onClick={() => removeFile(index)}
                      className="p-1 hover:bg-gray-200 rounded-lg transition-colors"
                      disabled={isUploading}
                    >
                      <X className="w-5 h-5 text-gray-400" />
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </motion.div>
      )}

      {/* Warning for unrecognized files */}
      {hasUnrecognizedFiles && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl"
        >
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              Einige Dateien wurden nicht erkannt
            </p>
            <p className="text-sm text-amber-700 mt-1">
              Diese Dateien werden trotzdem hochgeladen, aber nicht in RDF konvertiert.
              Stellen Sie sicher, dass die Dateien im korrekten Format vorliegen.
            </p>
          </div>
        </motion.div>
      )}

      {/* Login Warning */}
      {files.length > 0 && !isLoggedIn && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl"
        >
          <LogIn className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-800">
              Anmeldung erforderlich
            </p>
            <p className="text-sm text-blue-700 mt-1">
              Um Dateien im Solid Pod zu speichern, muessen Sie sich anmelden.
            </p>
            {onLoginClick && (
              <button
                onClick={onLoginClick}
                className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-800 underline"
              >
                Jetzt anmelden
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* Catalog Selection (only shown when logged in and catalogs are available) */}
      {files.length > 0 && isLoggedIn && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl border border-gray-200 p-6"
        >
          <label className="block text-sm font-semibold text-timber-dark mb-2">
            <Database className="w-4 h-4 inline-block mr-2" />
            Datenkatalog
          </label>
          {isLoadingCatalogs ? (
            <div className="flex items-center gap-2 text-timber-gray">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Kataloge werden geladen...</span>
            </div>
          ) : catalogs.length === 0 ? (
            <div className="text-sm text-amber-600">
              Keine Datenkataloge verfuegbar. Die Daten werden ohne Katalog-Registrierung hochgeladen.
            </div>
          ) : (
            <>
              <select
                value={selectedCatalogId || ''}
                onChange={(e) => setSelectedCatalogId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-forest-500 focus:border-forest-500 bg-white"
                disabled={isUploading}
              >
                <option value="">Kein Katalog (nur Upload)</option>
                {catalogs.map((catalog) => (
                  <option key={catalog.id} value={catalog.id}>
                    {catalog.title}
                  </option>
                ))}
              </select>
              <p className="text-xs text-timber-gray mt-2">
                Waehlen Sie einen Datenkatalog, in dem die hochgeladenen Daten registriert werden sollen.
              </p>
            </>
          )}
        </motion.div>
      )}

      {/* Detected Trace ID */}
      {files.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl border border-gray-200 p-6"
        >
          <label className="block text-sm font-semibold text-timber-dark mb-2">
            Trace-ID
          </label>
          {detectedTraceId && !traceIdOverride && (
            <div className="flex items-center gap-2 mb-3 text-sm text-forest-600">
              <CheckCircle2 className="w-4 h-4" />
              <span>Automatisch erkannt: <strong>{detectedTraceId}</strong></span>
            </div>
          )}
          <input
            type="text"
            value={traceIdOverride}
            onChange={(e) => setTraceIdOverride(e.target.value)}
            placeholder={detectedTraceId || 'TC-2025-001'}
            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-forest-500 focus:border-forest-500 font-mono"
            disabled={isUploading}
          />
          <p className="text-xs text-timber-gray mt-2">
            {detectedTraceId
              ? 'Leer lassen um erkannte ID zu verwenden, oder eigene ID eingeben'
              : 'Keine Trace-ID in den Dateien gefunden - bitte manuell eingeben'}
          </p>
        </motion.div>
      )}

      {/* Error Message */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700"
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </motion.div>
      )}

      {/* Upload Progress */}
      {uploadProgress && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-3 px-4 py-3 bg-forest-50 border border-forest-200 rounded-xl"
        >
          <Loader2 className="w-5 h-5 text-forest-600 animate-spin" />
          <span className="text-sm text-forest-700">{uploadProgress}</span>
        </motion.div>
      )}

      {/* Success Result */}
      {result?.success && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-forest-50 border border-forest-200 rounded-xl p-6"
        >
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle2 className="w-6 h-6 text-forest-600" />
            <h3 className="font-semibold text-forest-800">
              Upload erfolgreich!
            </h3>
          </div>

          {result.detection_warnings.length > 0 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm font-medium text-amber-800 mb-1">
                Hinweise:
              </p>
              <ul className="text-sm text-amber-700 list-disc list-inside">
                {result.detection_warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-sm text-forest-700 mb-4">
            {recognizedCount} von {files.length} Dateien wurden konvertiert und im Solid Pod gespeichert.
          </p>

          <div className="space-y-2 mb-4">
            {Object.entries(result.files).map(([key, fileResult]) => (
              <div key={key} className="text-xs text-forest-600 font-mono truncate">
                {key}: {fileResult.rdf_url || fileResult.raw_url || 'Fehler'}
              </div>
            ))}
          </div>

          <button
            onClick={handleViewProduct}
            className="w-full px-4 py-3 bg-forest-600 hover:bg-forest-700 text-white font-semibold rounded-lg transition-colors"
          >
            Produkt anzeigen
          </button>
        </motion.div>
      )}

      {/* Upload Button */}
      {!result?.success && files.length > 0 && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={handleUpload}
          disabled={isUploading || isLoading || !effectiveTraceId}
          className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
            effectiveTraceId && !isUploading
              ? 'bg-forest-600 hover:bg-forest-700 text-white shadow-lg shadow-forest-500/30'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {isUploading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Wird verarbeitet...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Upload className="w-5 h-5" />
              Hochladen und Konvertieren
            </span>
          )}
        </motion.button>
      )}

      {/* Info Box */}
      {files.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-gray-50 border border-gray-200 rounded-xl p-6"
        >
          <h4 className="font-semibold text-timber-dark mb-3">
            So funktioniert der Upload:
          </h4>
          <ol className="text-sm text-timber-gray space-y-2 list-decimal list-inside">
            <li>Ziehen Sie eine oder mehrere Dateien in das Upload-Feld</li>
            <li>Die Dateien werden automatisch erkannt und zugeordnet</li>
            <li>Die Trace-ID wird aus den Dateien extrahiert</li>
            <li>Klicken Sie auf "Hochladen" um die Konvertierung zu starten</li>
            <li>Nach dem Upload koennen Sie das Produkt direkt anzeigen</li>
          </ol>
        </motion.div>
      )}
    </div>
  );
}
