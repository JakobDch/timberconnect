import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Link2,
  Loader2,
  MapPin,
  Sprout,
  TreePine,
  X,
} from 'lucide-react';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import type { OriginProposal } from '../../services/stemOriginService';

/**
 * Herkunft des Faellvorgangs bestaetigen — VOR dem Upload.
 *
 * Die Stammkoordinaten aus dem Harvesterprotokoll liegen in einer
 * gezeichneten Pflanzflaeche; damit ist ableitbar, aus welchem Pflanzvorgang
 * das Rundholz stammt. Diese Ansicht zeigt die Zuordnung und laesst sie
 * bestaetigen.
 *
 * Warum ueberhaupt gefragt wird: Die Verknuepfung ist geometrisch erschlossen,
 * nicht aus einem Dokument gelesen. Sie geht ins LIVE-EECC-Repository, und eine
 * dort falsch abgelegte Herkunft wieder loszuwerden ist erheblich muehsamer,
 * als sie einmal vorab zu bestaetigen. Der Nutzer sieht deshalb Flaeche,
 * Stammzahl und Beleggrad, bevor irgendetwas geschrieben wird.
 *
 * Abwaehlbar je Flaeche: Laeuft ein Einschlag ueber zwei Flaechen und ist nur
 * eine davon plausibel, soll die andere nicht mitgeschrieben werden muessen.
 */

interface OriginLinkSheetProps {
  isOpen: boolean;
  /** null = der Vorschlag wird noch erstellt. */
  proposal: OriginProposal | null;
  /** Bestaetigt — mit den IRIs der ausgewaehlten Flaechen. */
  onConfirm: (selectedIris: string[]) => void;
  /** Ohne Verknuepfung fortfahren. Der Upload laeuft trotzdem. */
  onSkip: () => void;
  isBusy?: boolean;
}

export function OriginLinkSheet({
  isOpen,
  proposal,
  onConfirm,
  onSkip,
  isBusy = false,
}: OriginLinkSheetProps) {
  useBodyScrollLock(isOpen);

  const [selected, setSelected] = useState<string[]>([]);

  // Alle Gruppen sind zunaechst gewaehlt: die Zuordnung ist das Ergebnis der
  // Pruefung, nicht ein Angebot, das erst noch angenommen werden muss. Wer
  // widerspricht, waehlt ab.
  useEffect(() => {
    if (!proposal) {
      setSelected([]);
      return;
    }
    setSelected(proposal.groups.map((g) => g.area.certificateIri));
  }, [proposal]);

  const toggle = (iri: string) =>
    setSelected((prev) =>
      prev.includes(iri) ? prev.filter((i) => i !== iri) : [...prev, iri],
    );

  const linkedStems =
    proposal?.groups
      .filter((g) => selected.includes(g.area.certificateIri))
      .reduce((sum, g) => sum + g.stems.length, 0) ?? 0;

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
              <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-white/10">
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-bold text-white">
                    Herkunft des Rundholzes
                  </h2>
                  <p className="text-xs text-night-300 mt-1 leading-relaxed">
                    Die Fällpositionen aus Ihrem Harvesterprotokoll liegen in
                    einer registrierten Pflanzfläche. Bestätigen Sie die
                    Zuordnung, wird die Herkunftskette geschlossen.
                  </p>
                </div>
                <button
                  onClick={onSkip}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                  aria-label="Ohne Verknüpfung fortfahren"
                >
                  <X className="w-4 h-4 text-night-300" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
                {!proposal && (
                  <div className="flex items-center gap-3 py-6 text-sm text-night-300">
                    <Loader2 className="w-4 h-4 animate-spin text-acid-300" />
                    Pflanzflächen werden geprüft...
                  </div>
                )}

                {proposal?.groups.map((group) => {
                  const isOn = selected.includes(group.area.certificateIri);
                  return (
                    <button
                      key={group.area.certificateIri}
                      onClick={() => toggle(group.area.certificateIri)}
                      disabled={isBusy}
                      className={`w-full text-left rounded-2xl border transition-colors p-4 disabled:opacity-60 ${
                        isOn
                          ? 'bg-night-900 border-acid-400/40'
                          : 'bg-night-900/40 border-white/5'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${
                            isOn ? 'bg-acid-400' : 'border border-white/20'
                          }`}
                        >
                          {isOn && <Check className="w-3.5 h-3.5 text-night-950" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-white">
                            {group.label}
                          </p>

                          {/* Die Kante selbst, in der Richtung, in der sie gilt. */}
                          <div className="flex items-center gap-2 mt-2.5 text-xs">
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-night-700 text-night-200">
                              <Sprout className="w-3.5 h-3.5 text-acid-300" />
                              Saatgut
                            </span>
                            <ArrowRight className="w-3.5 h-3.5 text-night-400 flex-shrink-0" />
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-night-700 text-night-200">
                              <TreePine className="w-3.5 h-3.5 text-acid-300" />
                              {group.stems.length}{' '}
                              {group.stems.length === 1 ? 'Stamm' : 'Stämme'}
                            </span>
                          </div>

                          <p className="text-[11px] font-mono text-night-400 mt-2 truncate">
                            {group.seedEpc}
                          </p>

                          {[group.area.species, group.area.maturityYear ? `Reife ${group.area.maturityYear}` : null]
                            .filter(Boolean).length > 0 && (
                            <p className="text-xs text-night-400 mt-1">
                              {[
                                group.area.species,
                                group.area.maturityYear
                                  ? `Reife ${group.area.maturityYear}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* Was NICHT zugeordnet wurde. Gehoert sichtbar hierher: sonst
                    liest sich "24 Staemme verknuepft" als Aussage ueber den
                    ganzen Vorgang, obwohl 30 drin waren. */}
                {proposal && (proposal.unmatched.length > 0 ||
                  proposal.withoutPosition.length > 0 ||
                  proposal.ambiguous.length > 0) && (
                  <div className="rounded-2xl bg-night-900/60 border border-white/10 p-4 space-y-2">
                    <p className="text-[11px] font-bold tracking-[0.16em] text-night-300 uppercase">
                      Ohne Zuordnung
                    </p>
                    {proposal.unmatched.length > 0 && (
                      <p className="text-xs text-night-400 leading-relaxed">
                        <span className="text-night-200 font-semibold">
                          {proposal.unmatched.length}
                        </span>{' '}
                        {proposal.unmatched.length === 1 ? 'Stamm liegt' : 'Stämme liegen'}{' '}
                        in keiner registrierten Pflanzfläche. Bei Altbestand ist
                        das der Normalfall — sie werden wie bisher ohne
                        Herkunftskante erfasst.
                      </p>
                    )}
                    {proposal.withoutPosition.length > 0 && (
                      <p className="text-xs text-night-400 leading-relaxed">
                        <span className="text-night-200 font-semibold">
                          {proposal.withoutPosition.length}
                        </span>{' '}
                        ohne Koordinate im Protokoll — hier lässt sich nichts
                        prüfen.
                      </p>
                    )}
                    {proposal.ambiguous.length > 0 && (
                      <p className="text-xs text-amber-300/90 leading-relaxed flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>
                          <span className="font-semibold">
                            {proposal.ambiguous.length}
                          </span>{' '}
                          {proposal.ambiguous.length === 1 ? 'Stamm fällt' : 'Stämme fallen'}{' '}
                          in mehrere sich überschneidende Flächen. Welche
                          Herkunft gilt, ist nicht entscheidbar — sie bleiben
                          unverknüpft.
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {/* Beleggrad. Der Nutzer soll wissen, worauf die Kante beruht. */}
                {proposal && proposal.groups.length > 0 && (
                  <div className="flex items-start gap-2.5 px-3 py-2.5 bg-night-900/60 border border-white/10 rounded-xl">
                    <MapPin className="w-3.5 h-3.5 text-night-400 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-night-400 leading-relaxed">
                      Diese Zuordnung beruht auf den GPS-Positionen der Fällung,
                      nicht auf einem Dokument. Sie wird als solche im Event
                      vermerkt (<span className="font-mono">linkBasis: geometric</span>).
                    </p>
                  </div>
                )}

                {proposal && proposal.groups.length === 0 && (
                  <div className="px-4 py-4 bg-night-900/60 border border-white/10 rounded-2xl">
                    <p className="text-sm font-semibold text-white">
                      Keine Pflanzfläche getroffen
                    </p>
                    <p className="text-xs text-night-400 mt-1.5 leading-relaxed">
                      Die Fällpositionen liegen in keiner registrierten
                      Pflanzfläche. Der Fällvorgang wird ohne Herkunftskante
                      hochgeladen — wie bisher.
                    </p>
                  </div>
                )}
              </div>

              <div className="px-5 sm:px-6 py-4 border-t border-white/10 flex flex-col sm:flex-row gap-2.5">
                <button
                  onClick={onSkip}
                  disabled={isBusy}
                  className="btn btn-ghost sm:flex-1 justify-center disabled:opacity-60"
                >
                  Ohne Verknüpfung fortfahren
                </button>
                <button
                  onClick={() => onConfirm(selected)}
                  disabled={isBusy || selected.length === 0}
                  className="btn btn-acid sm:flex-1 justify-center disabled:opacity-60"
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Wird verknüpft...</span>
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4" />
                      <span>
                        {linkedStems > 0
                          ? `${linkedStems} ${linkedStems === 1 ? 'Stamm' : 'Stämme'} verknüpfen`
                          : 'Verknüpfen'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
