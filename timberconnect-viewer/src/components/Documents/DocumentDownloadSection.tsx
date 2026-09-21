import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Download, FileText, Loader2, Braces } from 'lucide-react';
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
import {
  groupDocuments,
  fileExtension,
  type DocumentGroup,
} from '../../services/documentLabels';
import {
  containerOf,
  containerProcessId,
  resolveProcesses,
  type ProcessInfo,
} from '../../services/processLookupService';
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
 * ANZEIGE (Umbau 18.09.2026): Bis dahin stand hier die rohe Dateiliste des
 * Pods -- "15db340fdd300779_pdf_transportauftrag.json". Der Hash ist die
 * Dokument-ID; niemand, auch kein Eingeweihter, erkannte darin ein Dokument,
 * und jedes Dokument stand zweimal da (Original + Strukturdaten). Jetzt:
 *
 *   1. gruppiert nach VORGANG ("Fällvorgang · 12.08.2026"), aufgeloest aus
 *      der process.ttl des Containers -- auch in fremden Pods
 *   2. je Dokument EINE Zeile mit dem Dokumenttypnamen, unter dem es
 *      hochgeladen wurde ("Transportauftrag Rundholz")
 *   3. daran die Wahl "Original" / "Strukturdaten" statt zweier Zeilen
 *
 * Die Uebersetzung leistet documentLabels, die Vorgangsaufloesung
 * processLookupService. Der Hash-Name bleibt als title-Attribut erreichbar --
 * wer die Datei im Pod sucht, findet sie so wieder.
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

/** Ein Vorgang mit den Dokumenten, die in seinem Container liegen. */
interface ProcessGroup {
  containerUrl: string;
  /** Ueberschrift der Gruppe, z.B. "Fällvorgang". */
  title: string;
  /** Zusatzzeile: Zeitpunkt, Titel, Vorgangs-ID. */
  subtitle: string | null;
  /** Fuer die Sortierung: je frueher der Vorgang, desto weiter oben. */
  timestamp: number;
  /** True: Container ohne jede Vorgangszuordnung -- wird zusammengefasst. */
  unassigned: boolean;
  documents: DocumentGroup[];
}

/** Zeitpunkt deutsch, ohne Sekunden. */
function formatStamp(date: Date | null): string | null {
  if (!date) return null;
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Die Dateien nach Vorgang und Dokument ordnen.
 *
 * Reihenfolge der Gruppen: neueste zuerst, wie die Dateiliste selbst. Dass
 * der Aufsaegevorgang vor dem Faellvorgang steht, ist gewollt -- gesucht wird
 * in aller Regel das zuletzt Hinzugekommene.
 */
function buildProcessGroups(
  files: PodFileEntry[],
  processes: Map<string, ProcessInfo>,
  sortRank?: (file: PodFileEntry) => number,
): ProcessGroup[] {
  const byContainer = new Map<string, PodFileEntry[]>();
  for (const file of files) {
    const container = containerOf(file.url);
    const list = byContainer.get(container) ?? [];
    list.push(file);
    byContainer.set(container, list);
  }

  // Schluessel ist die VORGANGS-ID, nicht der Container: beim Bestand vom
  // 21.-31.08.2026 liegen die Dateien eines Vorgangs in mehreren
  // Hash-Containern (siehe processLookupService, Weg 3). Nach Container
  // gruppiert stand derselbe Herstellungsvorgang zweimal untereinander.
  const byProcess = new Map<string, ProcessGroup>();
  for (const [containerUrl, containerFiles] of byContainer) {
    const info: ProcessInfo = processes.get(containerUrl) ?? {
      label: null,
      title: null,
      registeredAt: null,
      processId: null,
      source: 'none',
    };

    const stamp = formatStamp(info.registeredAt);
    // Der Titel ergaenzt den Typ nur, wenn er wirklich etwas Neues sagt --
    // dieselbe Regel wie in describeContainer (podResetService).
    const extra = info.title && info.title !== info.label ? info.title : null;

    const documents = groupDocuments(containerFiles);
    if (documents.length === 0) continue;

    if (sortRank) {
      documents.sort((a, b) => {
        const fileOf = (g: DocumentGroup) => g.original ?? g.structured;
        const fa = fileOf(a);
        const fb = fileOf(b);
        return (fa ? sortRank(fa) : 99) - (fb ? sortRank(fb) : 99);
      });
    }

    // Ein Container, dessen Name eine Vorgangs-ID traegt, IST ein
    // registrierter Vorgang -- auch wenn seine process.ttl gerade nicht
    // lesbar ist (403, Netz). Ihn dann unter "Weitere Dokumente" zu fuehren,
    // behauptet eine fehlende Registrierung, die es gar nicht gibt.
    const knownProcessId = info.processId ?? containerProcessId(containerUrl);
    const unresolved = !info.label && knownProcessId !== null;

    const key = knownProcessId ?? containerUrl;
    const existing = byProcess.get(key);
    if (existing) {
      existing.documents.push(...documents);
      continue;
    }
    byProcess.set(key, {
      containerUrl,
      title: info.label ?? (unresolved ? 'Vorgang' : 'Ohne Vorgangszuordnung'),
      subtitle:
        [stamp, extra, knownProcessId].filter(Boolean).join(' · ') ||
        (unresolved ? 'Vorgangsdaten nicht abrufbar' : null),
      timestamp: info.registeredAt?.getTime() ?? 0,
      // Dokumente ohne Vorgang sammeln sich in EINER Gruppe statt in vielen
      // gleichnamigen -- siehe mergeUnassigned.
      unassigned: !info.label && !unresolved,
      documents,
    });
  }

  // Neueste zuerst; Gruppen ohne Datum ans Ende.
  const groups = Array.from(byProcess.values());
  groups.sort((a, b) => b.timestamp - a.timestamp);
  return mergeUnassigned(groups);
}

/**
 * Alle Container ohne Vorgangszuordnung zu EINER Gruppe verschmelzen.
 *
 * Sonst steht "Ohne Vorgangszuordnung" mehrfach untereinander -- einmal je
 * Container. Das liest sich wie eine Wiederholung derselben Gruppe und war
 * im ersten Wurf genau der Eindruck, den die Anzeige erweckte.
 *
 * Die Sammelgruppe wandert ans Ende: sie ist das Sammelbecken, nicht der
 * Einstieg.
 */
function mergeUnassigned(groups: ProcessGroup[]): ProcessGroup[] {
  const assigned = groups.filter((g) => !g.unassigned);
  const loose = groups.filter((g) => g.unassigned);
  if (loose.length === 0) return assigned;

  const documents = loose.flatMap((g) => g.documents);
  return [
    ...assigned,
    {
      containerUrl: 'unassigned',
      title: 'Ohne Vorgangszuordnung',
      subtitle:
        documents.length === 1
          ? 'Dieses Dokument gehoert zu keinem registrierten Vorgang.'
          : 'Diese Dokumente gehoeren zu keinem registrierten Vorgang.',
      timestamp: 0,
      unassigned: true,
      documents,
    },
  ];
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
  const [processes, setProcesses] = useState<Map<string, ProcessInfo>>(new Map());
  const [docsLoading, setDocsLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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
      const all = await listAccessibleFiles(access.accessible, role?.iri ?? null);

      // Gescannte Produkte tragen eine EPC-URN als Id -- die trifft nie einen
      // Containernamen. Dann ueber die geladenen Quell-URLs eingrenzen.
      const containerPrefixes = isEpc(productId)
        ? (productData?.sourceStatus ?? [])
            .filter((s) => s.available)
            .map((s) => s.url.slice(0, s.url.lastIndexOf('/') + 1))
        : [];

      const relevant = all.filter((file) => {
        // Das Produktfoto ist Bebilderung, kein Beleg -- siehe
        // isProductPhotoFile.
        if (isProductPhotoFile(file.url)) return false;
        if (containerPrefixes.length > 0) {
          return containerPrefixes.some((prefix) => file.url.startsWith(prefix));
        }
        return file.traceId === productId;
      });

      // Die Vorgaenge der betroffenen Container aufloesen -- erst danach
      // steht fest, unter welcher Ueberschrift ein Dokument erscheint. Ueber
      // die Datei-URLs, nicht nur die Container: der Rueckweg vom
      // Hash-Container zum Vorgang braucht sie (processLookupService, Weg 3).
      const infos = await resolveProcesses(relevant.map((f) => f.url));

      setDocuments(relevant);
      setProcesses(infos);
    } catch (e) {
      setDocError(e instanceof Error ? e.message : 'Dokumente konnten nicht geladen werden');
    } finally {
      setDocsLoading(false);
    }
  }, [isLoggedIn, webId, role, productId, productData]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const groups = useMemo(
    () => buildProcessGroups(documents, processes, sortRank),
    [documents, processes, sortRank],
  );

  /** Anzahl der DOKUMENTE (nicht der Dateien) -- das ist, was der Nutzer zaehlt. */
  const documentCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.documents.length, 0),
    [groups],
  );

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
      // Auch der Gratis-Fall ist ein Erwerb -- siehe FileBrowserSheet.
      await commitPurchase(webId, estimate);
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

  const toggleGroup = (containerUrl: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(containerUrl)) next.delete(containerUrl);
      else next.add(containerUrl);
      return next;
    });
  };

  /** Zusatzinfo im Kopf: Anzahl bzw. Zustand, ohne aufklappen zu muessen. */
  const headerHint = !isLoggedIn
    ? 'Anmeldung erforderlich'
    : docsLoading
      ? null
      : `${documentCount} ${documentCount === 1 ? 'Dokument' : 'Dokumente'}`;

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
                ) : groups.length === 0 ? (
                  <p className="text-sm text-night-400 italic">{emptyText}</p>
                ) : (
                  <div className="space-y-3">
                    {groups.map((group) => {
                      const isCollapsed = collapsed.has(group.containerUrl);
                      return (
                        <section key={group.containerUrl}>
                          {/* Vorgangs-Ueberschrift: sie beantwortet "wo kommt
                              das her?", bevor der Nutzer die Namen liest. */}
                          <button
                            onClick={() => toggleGroup(group.containerUrl)}
                            aria-expanded={!isCollapsed}
                            className="w-full flex items-center gap-2 px-1 py-2 text-left hover:opacity-80 transition-opacity"
                          >
                            <ChevronDown
                              className={`w-3.5 h-3.5 text-night-400 flex-shrink-0 transition-transform ${
                                isCollapsed ? '-rotate-90' : ''
                              }`}
                            />
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-semibold text-acid-300 truncate">
                                {group.title}
                              </span>
                              {group.subtitle && (
                                <span className="block text-[11px] text-night-400 truncate">
                                  {group.subtitle}
                                </span>
                              )}
                            </span>
                            <span className="text-[11px] tabular-nums text-night-400 flex-shrink-0">
                              {group.documents.length}
                            </span>
                          </button>

                          {!isCollapsed && (
                            <ul className="space-y-2">
                              {group.documents.map((doc) => (
                                <li
                                  key={doc.docKey}
                                  className="bg-night-700/50 border border-white/5 rounded-xl px-4 py-3"
                                >
                                  <div className="flex items-center gap-3">
                                    <FileText className="w-4 h-4 text-night-300 flex-shrink-0" />
                                    <span className="flex-1 min-w-0 text-sm text-night-100 truncate">
                                      {doc.title}
                                    </span>
                                  </div>

                                  {/* Original und Strukturdaten desselben
                                      Dokuments -- getrennte Knoepfe statt
                                      zweier Zeilen mit Hash-Namen. */}
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {doc.original && (
                                      <VariantButton
                                        file={doc.original}
                                        icon="original"
                                        label={`Original (${fileExtension(doc.original.name).toUpperCase()})`}
                                        busy={downloading.has(doc.original.url)}
                                        onClick={() => handleDownload(doc.original!)}
                                      />
                                    )}
                                    {doc.structured && (
                                      <VariantButton
                                        file={doc.structured}
                                        icon="structured"
                                        label="Strukturdaten"
                                        busy={downloading.has(doc.structured.url)}
                                        onClick={() => handleDownload(doc.structured!)}
                                      />
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      );
                    })}
                  </div>
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

/**
 * Ein Downloadknopf fuer eine Ausfuehrung des Dokuments.
 *
 * Der rohe Dateiname steht im title-Attribut: er ist fuer die Anzeige
 * wertlos, aber wer die Datei spaeter im Pod wiederfinden will, braucht ihn.
 */
function VariantButton({
  file,
  icon,
  label,
  busy,
  onClick,
}: {
  file: PodFileEntry;
  icon: 'original' | 'structured';
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  const Icon = icon === 'original' ? FileText : Braces;
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={file.name}
      aria-label={`${label} herunterladen`}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
        icon === 'original'
          ? 'bg-acid-400/10 text-acid-300 hover:bg-acid-400/20'
          : 'bg-white/5 text-night-200 hover:bg-white/10'
      }`}
    >
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Icon className="w-3.5 h-3.5" />
      )}
      {label}
      {!busy && <Download className="w-3.5 h-3.5 opacity-60" />}
    </button>
  );
}
