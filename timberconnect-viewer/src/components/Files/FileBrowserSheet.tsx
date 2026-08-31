import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Search,
  Download,
  FileText,
  FileCode2,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  LogIn,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { LoginModal } from '../Auth/LoginModal';
import { ROLES } from '../../config/roles';
import {
  checkFileAccess,
  listAccessibleFiles,
  downloadOriginalFile,
  type FileAccessResult,
  type PodFileEntry,
} from '../../services/fileBrowserService';
import { useWallet } from '../../wallet/WalletContext';
import {
  estimateFileCost,
  commitPurchase,
  type CostEstimate,
} from '../../services/pricingService';
import { CostConfirmSheet } from '../Wallet/CostConfirmSheet';
import { WalletSheet } from '../Wallet/WalletSheet';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';

/**
 * "Dateien durchsuchen" Bottom-Sheet.
 *
 * Beim Öffnen wird ZUERST geprüft, welche Pods des Datenraums die Rolle des
 * Nutzers zulassen (role-policy.ttl je Pod); erst danach werden die Dateien
 * der zugänglichen Pods gelistet. Filter: Rolle des Eigentümers, Zeitraum,
 * Dateiname. Pro Datei kann das Original per WAC-geschütztem Download
 * extrahiert werden.
 */

interface FileBrowserSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

type Phase = 'checking' | 'loading' | 'ready' | 'error';

export function FileBrowserSheet({ isOpen, onClose }: FileBrowserSheetProps) {
  const { isLoggedIn, webId, role } = useAuth();
  const { balance, pay } = useWallet();
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  // Kostenpflichtige Extraktion: wartet auf Bestätigung + Token-Transfer.
  const [pendingDownload, setPendingDownload] = useState<{
    file: PodFileEntry;
    estimate: CostEstimate;
  } | null>(null);
  const [isPayingDownload, setIsPayingDownload] = useState(false);

  useBodyScrollLock(isOpen);

  const [phase, setPhase] = useState<Phase>('checking');
  const [access, setAccess] = useState<FileAccessResult | null>(null);
  const [files, setFiles] = useState<PodFileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filter
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showRdf, setShowRdf] = useState(false);

  // Download-Status pro Datei-URL
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    setPhase('checking');
    setError(null);
    setDownloadError(null);
    try {
      // Schritt 1: Berechtigungen klären, BEVOR etwas angezeigt wird.
      const result = await checkFileAccess(webId, role?.iri ?? null);
      setAccess(result);

      // Schritt 2: Nur die zugänglichen Pods listen.
      setPhase('loading');
      const entries = await listAccessibleFiles(result.accessible, role?.iri ?? null);
      setFiles(entries);
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      setPhase('error');
    }
  }, [webId, role]);

  useEffect(() => {
    if (isOpen && isLoggedIn && role) {
      loadFiles();
    }
  }, [isOpen, isLoggedIn, role, loadFiles]);

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null;

    return files.filter((file) => {
      if (!showRdf && file.isRdf) return false;
      if (q && !file.name.toLowerCase().includes(q) && !(file.traceId ?? '').toLowerCase().includes(q)) {
        return false;
      }
      if (roleFilter && file.ownerRoleIri !== roleFilter) return false;
      if (from || to) {
        if (!file.modified) return false;
        if (from && file.modified < from) return false;
        if (to && file.modified > to) return false;
      }
      return true;
    });
  }, [files, query, roleFilter, dateFrom, dateTo, showRdf]);

  const handleDownload = async (file: PodFileEntry) => {
    setDownloadError(null);
    setDownloading((prev) => new Set(prev).add(file.url));
    try {
      // Preis der Datei ermitteln (Datenpunkte der zugehörigen RDF-Datei).
      // Fremde Daten kosten Token -> erst bestätigen lassen, dann extrahieren.
      const estimate = await estimateFileCost(file.url, webId);
      if (estimate.totalTokens > 0) {
        setPendingDownload({ file, estimate });
        return;
      }
      await downloadOriginalFile(file);
      // Auch der Gratis-Fall ist ein Erwerb: ohne diesen Eintrag bleiben die
      // Schluessel dauerhaft "neu" und ein spaeterer, bepreisbarer Abruf
      // derselben Datei kassiert erneut.
      await commitPurchase(webId, estimate);
    } catch (e) {
      setDownloadError(
        `${file.name}: ${e instanceof Error ? e.message : 'Download fehlgeschlagen'}`,
      );
    } finally {
      setDownloading((prev) => {
        const next = new Set(prev);
        next.delete(file.url);
        return next;
      });
    }
  };

  // Bestätigt: Token an den Daten-Eigentümer zahlen, dann extrahieren.
  const handleConfirmDownload = async () => {
    if (!pendingDownload) return;
    setIsPayingDownload(true);
    try {
      await pay(
        pendingDownload.estimate.byRecipient.map((r) => ({
          recipientWebId: r.recipientWebId,
          amount: r.tokens,
          reason: `Datei-Extraktion ${pendingDownload.file.name}`,
        })),
      );
      // Bewusst VOR dem Download: schlägt der Download fehl (Netz), wurde
      // trotzdem kassiert — die Berechtigung muss bestehen bleiben, sonst zahlt
      // der Nutzer für den erneuten Versuch doppelt.
      await commitPurchase(webId, pendingDownload.estimate);
      await downloadOriginalFile(pendingDownload.file);
      setPendingDownload(null);
    } catch (e) {
      setDownloadError(
        `${pendingDownload.file.name}: ${e instanceof Error ? e.message : 'Zahlung/Download fehlgeschlagen'}`,
      );
      setPendingDownload(null);
    } finally {
      setIsPayingDownload(false);
    }
  };

  const formatDate = (date: Date | null) =>
    date
      ? date.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' })
      : '–';

  const inputClass =
    'bg-night-700 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-night-400 focus:outline-none focus:border-acid-400/60';

  return (
    <>
      <SheetPortal>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-night-950/70 backdrop-blur-sm"
            onClick={onClose}
          >
            <motion.div
              initial={{ y: '100%', opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-full sm:max-w-3xl bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/50 max-h-[92%] sm:max-h-[85%] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Griff (mobil) */}
              <div className="sm:hidden flex justify-center pt-3">
                <div className="w-10 h-1 rounded-full bg-white/15" />
              </div>

              {/* Kopf */}
              <div className="flex items-center justify-between px-5 sm:px-6 pt-4 pb-3">
                <h2 className="text-xl font-bold text-white">Dateien durchsuchen</h2>
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                  aria-label="Schließen"
                >
                  <X className="w-4 h-4 text-night-300" />
                </button>
              </div>

              {/* Inhalt */}
              <div className="px-5 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto scroll-touch flex-1">
                {!isLoggedIn ? (
                  <div className="py-10 text-center space-y-4">
                    <ShieldAlert className="w-10 h-10 text-acid-300 mx-auto" />
                    <p className="text-night-200">
                      Bitte melden Sie sich mit Ihrem Solid-Account an, um die Dateien des
                      Datenraums zu durchsuchen.
                    </p>
                    <button onClick={() => setLoginModalOpen(true)} className="btn btn-acid">
                      <LogIn className="w-4 h-4" />
                      <span>Anmelden</span>
                    </button>
                  </div>
                ) : !role ? (
                  <div className="py-10 text-center space-y-3">
                    <ShieldAlert className="w-10 h-10 text-acid-300 mx-auto" />
                    <p className="text-night-200">
                      Ihrem Account ist noch keine Rolle zugeordnet. Bitte legen Sie zuerst Ihre
                      Rolle fest – sie bestimmt, welche Dateien Sie sehen dürfen.
                    </p>
                  </div>
                ) : phase === 'checking' ? (
                  <div className="py-12 text-center space-y-3">
                    <Loader2 className="w-8 h-8 text-acid-300 mx-auto animate-spin" />
                    <p className="text-night-200">Berechtigungen werden geprüft …</p>
                    <p className="text-xs text-night-400">
                      Rolle: {role.label} – es wird ermittelt, welche Pods des Datenraums Ihnen
                      Zugriff gewähren.
                    </p>
                  </div>
                ) : phase === 'loading' ? (
                  <div className="py-12 text-center space-y-3">
                    <Loader2 className="w-8 h-8 text-acid-300 mx-auto animate-spin" />
                    <p className="text-night-200">Zugängliche Dateien werden geladen …</p>
                  </div>
                ) : phase === 'error' ? (
                  <div className="py-10 text-center space-y-4">
                    <ShieldAlert className="w-10 h-10 text-red-400 mx-auto" />
                    <p className="text-night-200">Fehler bei der Berechtigungsprüfung: {error}</p>
                    <button onClick={loadFiles} className="btn btn-night">
                      Erneut versuchen
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Zugriffs-Zusammenfassung */}
                    {access && (
                      <div className="flex items-start gap-2 bg-night-700/60 border border-white/5 rounded-xl px-3 py-2.5 text-xs text-night-300">
                        <ShieldCheck className="w-4 h-4 text-acid-300 shrink-0 mt-0.5" />
                        <span>
                          Als <span className="text-white font-medium">{role.label}</span> haben Sie
                          Zugriff auf {access.accessible.length} von {access.pods.length} Pods
                          {access.denied.length > 0 && (
                            <> – {access.denied.length} Pod(s) lassen Ihre Rolle nicht zu und werden ausgeblendet</>
                          )}
                          .
                        </span>
                      </div>
                    )}

                    {/* Filterzeile */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="relative col-span-2 sm:col-span-1">
                        <Search className="w-4 h-4 text-night-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Dateiname / Trace-ID"
                          className={`${inputClass} w-full pl-9`}
                        />
                      </div>
                      <select
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        className={`${inputClass} w-full`}
                      >
                        <option value="">Alle Rollen</option>
                        {ROLES.map((r) => (
                          <option key={r.iri} value={r.iri}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        aria-label="Zeitraum von"
                        className={`${inputClass} w-full`}
                      />
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        aria-label="Zeitraum bis"
                        className={`${inputClass} w-full`}
                      />
                    </div>

                    <label className="flex items-center gap-2 text-xs text-night-300 select-none">
                      <input
                        type="checkbox"
                        checked={showRdf}
                        onChange={(e) => setShowRdf(e.target.checked)}
                        className="accent-acid-400"
                      />
                      Auch RDF-Serialisierungen (.ttl) anzeigen
                    </label>

                    {downloadError && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 text-xs text-red-300">
                        {downloadError}
                      </div>
                    )}

                    {/* Dateiliste */}
                    {filteredFiles.length === 0 ? (
                      <p className="py-8 text-center text-sm text-night-400">
                        Keine Dateien gefunden, die den Filtern entsprechen.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {filteredFiles.map((file) => (
                          <li
                            key={file.url}
                            className="flex items-center gap-3 bg-night-700/50 border border-white/5 rounded-2xl px-3.5 py-3"
                          >
                            <div className="w-9 h-9 rounded-xl bg-night-700 border border-white/5 flex items-center justify-center shrink-0">
                              {file.isRdf ? (
                                <FileCode2 className="w-4.5 h-4.5 text-night-300" />
                              ) : (
                                <FileText className="w-4.5 h-4.5 text-acid-300" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-white truncate" title={file.name}>
                                {file.name}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-night-400">
                                {file.ownerRoleLabel && (
                                  <span className="px-1.5 py-0.5 rounded-full bg-night-700 text-night-300">
                                    {file.ownerRoleLabel}
                                  </span>
                                )}
                                {file.traceId && <span>{file.traceId}</span>}
                                {file.legacy && <span className="text-night-300">öffentlich (Altbestand)</span>}
                                <span>{formatDate(file.modified)}</span>
                              </div>
                            </div>
                            <button
                              onClick={() => handleDownload(file)}
                              disabled={downloading.has(file.url)}
                              className="btn btn-acid !px-3 !py-2 text-xs shrink-0"
                              title="Datei in Originalform extrahieren"
                            >
                              {downloading.has(file.url) ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Download className="w-4 h-4" />
                              )}
                              <span className="hidden sm:inline">Extrahieren</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <p className="text-[11px] text-night-300">
                      {filteredFiles.length} von {files.length} Dateien angezeigt. Die
                      Zugriffskontrolle wird zusätzlich serverseitig per WAC durchgesetzt.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </SheetPortal>

      <LoginModal isOpen={loginModalOpen} onClose={() => setLoginModalOpen(false)} />

      {/* Kosten-Bestätigung für die Datei-Extraktion */}
      <CostConfirmSheet
        isOpen={pendingDownload !== null}
        estimate={pendingDownload?.estimate ?? null}
        balance={balance}
        isLoggedIn={isLoggedIn}
        isPaying={isPayingDownload}
        onConfirm={handleConfirmDownload}
        onCancel={() => setPendingDownload(null)}
        onBuyTokens={() => setWalletOpen(true)}
        onLogin={() => setLoginModalOpen(true)}
      />

      <WalletSheet isOpen={walletOpen} onClose={() => setWalletOpen(false)} />
    </>
  );
}
