import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  FileText,
  Fingerprint,
  Loader2,
  X,
} from 'lucide-react';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import type { PdfReview } from '../../services/pdfReviewService';

/**
 * Pruefansicht der ausgelesenen Dokumentdaten — der letzte Schritt VOR dem
 * Upload.
 *
 * Bis hierher hat der Nutzer eine Datei ausgewaehlt, ohne je zu sehen, was
 * darin steht. Diese Ansicht zeigt es ihm: Abschnitt fuer Abschnitt, in der
 * Reihenfolge des Papierdokuments, mit den Beschriftungen der Vorlage. Was er
 * hier sieht, ist genau das, was gleich materialisiert und im Datenraum
 * sichtbar wird.
 *
 * Die Entscheidung ist bindend: „Abbrechen" laedt nichts hoch. Das ist der
 * eigentliche Zweck des Schritts — ein Dokument mit falschen Werten laesst sich
 * nachtraeglich nicht mehr aus dem Datenraum nehmen, ohne Spuren zu
 * hinterlassen.
 */

export interface PdfReviewItem {
  fileName: string;
  /** Beschriftung der zugeordneten Vorlage. */
  templateLabel: string;
  review: PdfReview;
  /** Idente des Dokuments, bereits aufbereitet. */
  identities: { label: string; epcs: string[] }[];
}

interface PdfReviewSheetProps {
  isOpen: boolean;
  /** null = die Dokumente werden noch gelesen. */
  items: PdfReviewItem[] | null;
  onConfirm: () => void;
  /** Vorgang abbrechen — nichts wird hochgeladen. */
  onCancel: () => void;
}

export function PdfReviewSheet({
  isOpen,
  items,
  onConfirm,
  onCancel,
}: PdfReviewSheetProps) {
  useBodyScrollLock(isOpen);

  const totalValues = items?.reduce((sum, i) => sum + i.review.valueCount, 0) ?? 0;
  const totalUnmapped = items?.reduce((sum, i) => sum + i.review.unmappedCount, 0) ?? 0;
  const isEmpty = items !== null && totalValues === 0;

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-night-950/70 backdrop-blur-sm flex items-stretch justify-center"
          >
            <motion.div
              initial={{ y: '100%', opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-full h-full sm:h-[90%] sm:my-auto sm:max-w-2xl bg-night-800 sm:border border-white/10 sm:rounded-3xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden"
            >
              {/* Kopf */}
              <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-white/10">
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-bold text-white">
                    Bitte prüfen Sie die ausgelesenen Daten
                  </h2>
                  <p className="text-xs text-night-300 mt-1 leading-relaxed">
                    Diese Werte wurden aus Ihren Dokumenten gelesen und werden
                    nach Ihrer Bestätigung im Datenraum veröffentlicht.
                  </p>
                </div>
                <button
                  onClick={onCancel}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                  aria-label="Abbrechen"
                >
                  <X className="w-4 h-4 text-night-300" />
                </button>
              </div>

              {/* Inhalt */}
              <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-4 space-y-5">
                {items === null ? (
                  <div className="flex items-center gap-3 text-night-300 py-8 justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-acid-300" />
                    <span className="text-sm">Dokumente werden gelesen...</span>
                  </div>
                ) : isEmpty ? (
                  <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-amber-300">
                        Keine Werte gefunden
                      </p>
                      <p className="text-xs text-amber-300/80 mt-1 leading-relaxed">
                        In den gewählten Dokumenten konnten keine ausgefüllten
                        Formularfelder gelesen werden. Wird trotzdem
                        fortgefahren, landet nur das Original im Pod — ohne
                        auswertbare Daten.
                      </p>
                    </div>
                  </div>
                ) : (
                  items.map((item) => (
                    <div
                      key={item.fileName}
                      className="rounded-2xl border border-white/10 bg-night-700/30 overflow-hidden"
                    >
                      {/* Dateikopf */}
                      <div className="flex items-center gap-3 px-4 py-3 bg-night-700/50 border-b border-white/10">
                        <div className="w-9 h-9 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-4 h-4 text-acid-300" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white truncate">
                            {item.templateLabel}
                          </p>
                          <p className="text-xs text-night-400 truncate">
                            {item.fileName} · {item.review.valueCount}{' '}
                            {item.review.valueCount === 1 ? 'Wert' : 'Werte'}
                          </p>
                        </div>
                      </div>

                      {/* Idente */}
                      {item.identities.length > 0 && (
                        <div className="px-4 py-3 border-b border-white/10 space-y-2">
                          {item.identities.map((line) => (
                            <div key={line.label}>
                              <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] text-night-300 uppercase">
                                <Fingerprint className="w-3 h-3" />
                                {line.label}
                              </div>
                              <div className="mt-1 space-y-0.5">
                                {line.epcs.map((epc) => (
                                  <code
                                    key={epc}
                                    className="block text-[11px] text-acid-300/90 font-mono break-all"
                                  >
                                    {epc}
                                  </code>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Abschnitte der Vorlage */}
                      <div className="divide-y divide-white/5">
                        {item.review.sections.map((section) => (
                          <div key={section.id} className="px-4 py-3">
                            <h4 className="text-[11px] font-bold tracking-[0.14em] text-night-300 uppercase mb-2">
                              {section.title}
                            </h4>

                            {section.values.length > 0 && (
                              <dl className="space-y-1.5">
                                {section.values.map((value) => (
                                  <div
                                    key={value.key}
                                    className="flex items-baseline gap-3 text-xs"
                                  >
                                    <dt className="text-night-400 flex-1 min-w-0">
                                      {value.label}
                                    </dt>
                                    <dd className="text-white font-medium text-right break-words max-w-[55%]">
                                      {value.display}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            )}

                            {/* Wiederholbare Sektionen: eine Zeile je Eintrag.
                                Bei vielen Zeilen (Biegepruefung: 30+) waere die
                                Vollausgabe unlesbar -- die ersten stehen
                                stellvertretend, der Rest wird gezaehlt. */}
                            {section.rows.length > 0 && (
                              <div className="mt-2 space-y-1.5">
                                {section.rows.slice(0, 5).map((row) => (
                                  <div
                                    key={row.index}
                                    className="px-3 py-2 rounded-lg bg-night-800/60 border border-white/5"
                                  >
                                    <p className="text-[10px] font-bold text-night-400 uppercase tracking-wide mb-1">
                                      Zeile {row.index}
                                    </p>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                                      {row.values.map((value) => (
                                        <span key={value.key} className="text-xs">
                                          <span className="text-night-400">
                                            {value.label}:{' '}
                                          </span>
                                          <span className="text-white font-medium">
                                            {value.display}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                                {section.rows.length > 5 && (
                                  <p className="text-xs text-night-400 px-1">
                                    … und {section.rows.length - 5} weitere Zeilen
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}

                {/* Nicht zugeordnete Felder: ein ehrlicher Hinweis auf die
                    falsche Vorlage -- keine Sperre, denn Vorlagen enthalten
                    auch reine Anzeigefelder ohne Registry-Eintrag. */}
                {totalUnmapped > 0 && (
                  <div className="flex items-start gap-3 px-4 py-3 bg-night-700/50 border border-white/10 rounded-xl">
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-night-300 leading-relaxed">
                      {totalUnmapped}{' '}
                      {totalUnmapped === 1
                        ? 'ausgefülltes Feld gehört'
                        : 'ausgefüllte Felder gehören'}{' '}
                      nicht zur erwarteten Vorlage und {totalUnmapped === 1 ? 'wird' : 'werden'}{' '}
                      nicht übernommen. Falls wesentliche Angaben fehlen, brechen
                      Sie bitte ab und prüfen Sie das Dokument.
                    </p>
                  </div>
                )}
              </div>

              {/* Entscheidung */}
              <div className="border-t border-white/10 px-5 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <div className="flex items-center gap-2">
                  <button
                    onClick={onCancel}
                    className="px-4 py-2.5 rounded-xl bg-night-700/60 hover:bg-night-700 text-night-200 text-sm font-semibold transition-colors"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={onConfirm}
                    disabled={items === null}
                    className="btn btn-acid flex-1"
                  >
                    <Check className="w-4 h-4" />
                    <span>Stimmt — jetzt hochladen</span>
                  </button>
                </div>
                <p className="text-[11px] text-night-400 mt-2 text-center">
                  Beim Abbrechen wird nichts hochgeladen und der Vorgang beginnt
                  von vorn.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
