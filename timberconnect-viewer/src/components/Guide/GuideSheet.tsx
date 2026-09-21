import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Image as ImageIcon, PenLine, X } from 'lucide-react';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import { GUIDE_TOPICS, type GuideTopic, type GuideTopicId } from '../../config/guide';

/**
 * Anleitung -- ein Thema als Schrittfolge.
 *
 * Neuer Menuepunkt nach Vorgabe der Praxispartner ("Feedback App_Allgemein",
 * 17.09.2026, Folie 3). Die Inhalte kommen aus config/guide.ts; hier steht
 * nur die Darstellung: Kopf mit Thema, Entwurfs-Hinweis, nummerierte
 * Schritte mit Text und Screenshot bzw. Platzhalter, unten Wechsel zum
 * vorigen/naechsten Thema.
 *
 * Der Entwurfs-Hinweis ist Absicht und kein Schoenheitsfehler: Die Partner
 * liefern die endgueltigen Texte und Screenshots nach. Bis dahin soll
 * niemand die Vorschlaege fuer abgestimmt halten.
 */

interface GuideSheetProps {
  /** Das geoeffnete Thema; null schliesst das Sheet. */
  topicId: GuideTopicId | null;
  onClose: () => void;
  /** Zu einem anderen Thema wechseln (Fusszeile). */
  onSelectTopic: (topicId: GuideTopicId) => void;
}

function ScreenshotPlaceholder() {
  return (
    <div
      className="mt-3 rounded-xl border border-dashed border-white/15 bg-night-900/60 px-4 py-5 flex items-center gap-3 text-night-400"
      aria-label="Screenshot folgt"
    >
      <ImageIcon className="w-5 h-5 flex-shrink-0" />
      <span className="text-xs">Screenshot folgt</span>
    </div>
  );
}

function TopicBody({ topic }: { topic: GuideTopic }) {
  return (
    <>
      <p className="text-sm text-night-200 leading-relaxed">{topic.intro}</p>

      <ol className="mt-5 space-y-5">
        {topic.steps.map((step, index) => (
          <li key={step.title} className="flex gap-3.5">
            <span className="w-7 h-7 rounded-full bg-acid-400 text-night-950 text-sm font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-white leading-snug">
                {step.title}
              </h3>
              <p className="text-sm text-night-300 leading-relaxed mt-1">
                {step.text}
              </p>
              {step.screenshot ? (
                <img
                  src={`${import.meta.env.BASE_URL}${step.screenshot}`}
                  alt={`Screenshot: ${step.title}`}
                  className="mt-3 rounded-xl border border-white/10 max-w-full"
                />
              ) : (
                <ScreenshotPlaceholder />
              )}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

export function GuideSheet({ topicId, onClose, onSelectTopic }: GuideSheetProps) {
  useBodyScrollLock(topicId !== null);

  const index = GUIDE_TOPICS.findIndex((t) => t.id === topicId);
  const topic = index >= 0 ? GUIDE_TOPICS[index] : null;
  const previous = index > 0 ? GUIDE_TOPICS[index - 1] : null;
  const next =
    index >= 0 && index < GUIDE_TOPICS.length - 1 ? GUIDE_TOPICS[index + 1] : null;

  return (
    <SheetPortal>
      <AnimatePresence>
        {topic && (
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
              className="w-full sm:max-w-2xl bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/50 max-h-[92%] sm:max-h-[85%] flex flex-col"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="guide-title"
            >
              {/* Griff (mobil) */}
              <div className="sm:hidden flex justify-center pt-3">
                <div className="w-10 h-1 rounded-full bg-white/15" />
              </div>

              {/* Kopf */}
              <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-4 pb-3 border-b border-white/5">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-11 h-11 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center flex-shrink-0">
                    <topic.icon className="w-5 h-5 text-acid-300" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-night-400">
                      Anleitung
                    </div>
                    <h2
                      id="guide-title"
                      className="text-lg sm:text-xl font-bold text-white leading-snug"
                    >
                      {topic.title}
                    </h2>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                  aria-label="Schließen"
                >
                  <X className="w-4 h-4 text-night-300" />
                </button>
              </div>

              {/* Inhalt (scrollbar) */}
              <div className="px-5 sm:px-6 py-4 overflow-y-auto scroll-touch">
                {topic.draft && (
                  <div className="flex items-start gap-2.5 px-3.5 py-2.5 mb-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                    <PenLine className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-200/90 leading-relaxed">
                      Entwurf: Die endgültigen Anleitungstexte und Screenshots
                      liefern die Praxispartner nach. Die Schritte beschreiben
                      den aktuellen Ablauf der Anwendung.
                    </p>
                  </div>
                )}
                <TopicBody topic={topic} />
              </div>

              {/* Fuss: voriges / naechstes Thema */}
              <div className="px-5 sm:px-6 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-white/5 flex items-center justify-between gap-3">
                {previous ? (
                  <button
                    onClick={() => onSelectTopic(previous.id)}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-night-300 hover:text-white transition-colors min-w-0"
                  >
                    <ChevronLeft className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{previous.title}</span>
                  </button>
                ) : (
                  <span />
                )}
                {next ? (
                  <button
                    onClick={() => onSelectTopic(next.id)}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-acid-300 hover:text-acid-200 transition-colors min-w-0"
                  >
                    <span className="truncate">{next.title}</span>
                    <ChevronRight className="w-4 h-4 flex-shrink-0" />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
