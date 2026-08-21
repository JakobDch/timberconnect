import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Download, FileText, Loader2 } from 'lucide-react';
import type { ProductDataResult } from '../../services/sparqlService';
import {
  checkFileAccess,
  listAccessibleFiles,
  downloadOriginalFile,
  type PodFileEntry,
} from '../../services/fileBrowserService';
import {
  estimateFileCost,
  commitPurchase,
  type CostEstimate,
} from '../../services/pricingService';
import { isProductPhotoFile } from '../../services/productPhotoService';
import { isEpc } from '../../services/sparqlQueries';
import { useAuth } from '../../auth/AuthContext';
import { useWallet } from '../../wallet/WalletContext';
import { CostConfirmSheet, WalletSheet } from '../Wallet';
import { LoginModal } from '../Auth/LoginModal';

/**
 * Gemeinsamer Downloadbereich der Anwendungsfaelle ("Download Dokumente").
 *
 * Bis 08/2026 hielten Herkunftsnachweis, Rueckbaubarkeit und CO2-Bilanz je
 * eine identische Kopie dieses Blocks -- inklusive der Token-Schranke, die
 * dreifach gepflegt werden musste. Jetzt liegt alles hier: Berechtigungs-
 * pruefung, Eingrenzung auf die Quell-Container des Produkts, Download mit
 * Kosten-Bestaetigung (CostConfirmSheet) sowie Wallet- und Login-Sheets.
 *
 * Die Liste ist EINKLAPPBAR (zu Beginn zu): bei Vorgaengen mit vielen
 * Belegen wurde der Bereich sonst zur endlosen Liste unter den eigentlichen
 * Inhalten. Der Kopf zeigt die Anzahl, damit klar ist, dass sich das
 * Aufklappen lohnt.
 *
 * Die Token-Schranke ist dieselbe wie im Datei-Browser -- damit hier keine
 * kostenlose Hintertuer am Bezahlmodell vorbei entsteht.
 */

interface DocumentDownloadSectionProps {
  productId?: string;
  /** Quellen-Status zur Eingrenzung bei EPC-Scans. */
  productData?: ProductDataResult | null;
  /** Verzoegerung der Einblendanimation, wie die umgebenden Sections. */
  delay?: number;
  /** Sortierung: kleinere Werte zuerst (z.B. Leistungserklaerung vor Rest). */
  sortRank?: (file: PodFileEntry) => number;
  /** Text des Leerzustands, Standard: "... zu diesem Bauteil ...". */
  emptyText?: string;
}

export function DocumentDownloadSection({
  productId,
  productData,
  delay = 0,
  sortRank,
  emptyText = 'Keine Dokumente zu diesem Bauteil verfügbar.',
}: DocumentDownloadSectionProps) {
  const { isLoggedIn, webId, role } = useAuth();
  const { balance, pay } = useWallet();

  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<PodFileEntry[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [pendingDownload, setPendingDownload] = useState<{
    file: PodFileEntry;
    estimate: CostEstimate;
  } | null>(null);
  const [isPayingDownload, setIsPayingDownload] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  const loadDocuments = useCallback(async () => {
    if (!isLoggedIn || !productId) return;
    setDocsLoading(true);
    setDocError(null);
    try {
      const access = await checkFileAccess(webId, role?.iri ?? null);
      const all = await listAccessibleFiles(access.accessible);

      // Gescannte Produkte tragen eine EPC-URN als Id -- die trifft nie einen
      // Containernamen. Dann ueber die geladenen Quell-URLs eingrenzen.
      const containerPrefixes = isEpc(productId)
        ? (productData?.sourceStatus ?? [])
            .filter((s) => s.available)
            .map((s) => s.url.slice(0, s.url.lastIndexOf('/') + 1))
        : [];

      const relevant = all.filter((file) => {
        if (file.isRdf) return false;
        // Das Produktfoto ist Bebilderung, kein Beleg -- siehe
        // isProductPhotoFile.
        if (isProductPhotoFile(file.url)) return false;
        if (containerPrefixes.length > 0) {
          return containerPrefixes.some((prefix) => file.url.startsWith(prefix));
        }
        return file.traceId === productId;
      });

      setDocuments(sortRank ? [...relevant].sort((a, b) => sortRank(a) - sortRank(b)) : relevant);
    } catch (e) {
      setDocError(e instanceof Error ? e.message : 'Dokumente konnten nicht geladen werden');
    } finally {
      setDocsLoading(false);
    }
  }, [isLoggedIn, webId, role, productId, productData, sortRank]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const handleDownload = async (file: PodFileEntry) => {
    setDocError(null);
    setDownloading((prev) => new Set(prev).add(file.url));
    try {
      const estimate = await estimateFileCost(file.url, webId);
      if (estimate.totalTokens > 0) {
        setPendingDownload({ file, estimate });
        return;
      }
      await downloadOriginalFile(file);
    } catch (e) {
      setDocError(`${file.name}: ${e instanceof Error ? e.message : 'Download fehlgeschlagen'}`);
    } finally {
      setDownloading((prev) => {
        const next = new Set(prev);
        next.delete(file.url);
        return next;
      });
    }
  };

  const handleConfirmDownload = async () => {
    if (!pendingDownload) return;
    setIsPayingDownload(true);
    try {
      await pay(
        pendingDownload.estimate.byRecipient.map((r) => ({
          recipientWebId: r.recipientWebId,
          amount: r.tokens,
          reason: `Dokument ${pendingDownload.file.name}`,
        })),
      );
      // Bewusst VOR dem Download: schlägt der Download fehl (Netz), wurde
      // trotzdem kassiert — die Berechtigung muss bestehen bleiben, sonst zahlt
      // der Nutzer für den erneuten Versuch doppelt.
      await commitPurchase(webId, pendingDownload.estimate);
      await downloadOriginalFile(pendingDownload.file);
      setPendingDownload(null);
    } catch (e) {
      setDocError(
        `${pendingDownload.file.name}: ${e instanceof Error ? e.message : 'Zahlung/Download fehlgeschlagen'}`,
      );
      setPendingDownload(null);
    } finally {
      setIsPayingDownload(false);
    }
  };

  /** Zusatzinfo im Kopf: Anzahl bzw. Zustand, ohne aufklappen zu muessen. */
  const headerHint = !isLoggedIn
    ? 'Anmeldung erforderlich'
    : docsLoading
      ? null
      : `${documents.length} ${documents.length === 1 ? 'Dokument' : 'Dokumente'}`;

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay }}
        className={`bg-night-800 border rounded-2xl overflow-hidden transition-colors ${
          open ? 'border-acid-400/40' : 'border-white/5'
        }`}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
        >
          <Download
            className={`w-4 h-4 flex-shrink-0 ${open ? 'text-acid-400' : 'text-night-300'}`}
          />
          <span className="flex-1 min-w-0 text-sm font-semibold text-white truncate">
            Download Dokumente
          </span>
          {docsLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-night-300 flex-shrink-0" />
          ) : (
            headerHint && (
              <span className="text-[11px] tabular-nums text-night-400 flex-shrink-0">
                {headerHint}
              </span>
            )
          )}
          <ChevronDown
            className={`w-4 h-4 text-night-300 flex-shrink-0 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4">
                {!isLoggedIn ? (
                  <div className="text-sm text-night-300">
                    <p>Melden Sie sich an, um die hinterlegten Dokumente zu sehen.</p>
                    <button
                      onClick={() => setLoginOpen(true)}
                      className="mt-3 px-4 py-2 rounded-xl bg-acid-400 text-night-950 text-sm font-semibold hover:bg-acid-300 transition-colors"
                    >
                      Anmelden
                    </button>
                  </div>
                ) : docsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-night-300">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Dokumente werden gesucht…
                  </div>
                ) : documents.length === 0 ? (
                  <p className="text-sm text-night-400 italic">{emptyText}</p>
                ) : (
                  <ul className="space-y-2">
                    {documents.map((file) => (
                      <li
                        key={file.url}
                        className="flex items-center gap-3 bg-night-700/50 border border-white/5 rounded-xl px-4 py-3"
                      >
                        <FileText className="w-4 h-4 text-night-300 flex-shrink-0" />
                        <span className="flex-1 min-w-0 text-sm text-night-100 truncate">
                          {file.name}
                        </span>
                        <button
                          onClick={() => handleDownload(file)}
                          disabled={downloading.has(file.url)}
                          aria-label={`${file.name} herunterladen`}
                          className="text-night-300 hover:text-acid-300 transition-colors disabled:opacity-50 flex-shrink-0"
                        >
                          {downloading.has(file.url) ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Download className="w-5 h-5" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {docError && <p className="text-sm text-red-400 mt-3">{docError}</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      {/* Kosten-Bestätigung für den Dokument-Download */}
      <CostConfirmSheet
        isOpen={pendingDownload !== null}
        estimate={pendingDownload?.estimate ?? null}
        balance={balance}
        isLoggedIn={isLoggedIn}
        isPaying={isPayingDownload}
        onConfirm={handleConfirmDownload}
        onCancel={() => setPendingDownload(null)}
        onBuyTokens={() => setWalletOpen(true)}
        onLogin={() => setLoginOpen(true)}
      />

      <WalletSheet isOpen={walletOpen} onClose={() => setWalletOpen(false)} />
      <LoginModal isOpen={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}
