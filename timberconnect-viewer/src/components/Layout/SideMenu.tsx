import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Layers,
  ScanSearch,
  Handshake,
  FolderSearch,
  ChevronDown,
  RotateCcw,
  Info,
  ExternalLink,
  BookOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BrandWordmark } from '../Brand/TreeRingLogo';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import { UseCaseIcon } from '../UseCases';
import { USE_CASES, isAvailable } from '../../config/useCases';
import { GUIDE_TOPICS, type GuideTopicId } from '../../config/guide';
import { FundingLogos } from '../Brand/FundingLogos';

/**
 * Seitenfenstermenü (PDF-Vorgabe "Stand 1507", S. 2–3):
 * Drawer von links mit Navigation plus Förderlogos unten.
 *
 * Aufbau seit 17.09.2026 (Rueckmeldung Praxispartner, "Feedback
 * App_Allgemein", Folie 3):
 *
 *   NAVIGATION   Anwendungsfälle (aufklappbar)
 *                Holzbauteil identifizieren
 *                Anleitung (aufklappbar: Registrierung, Rechtemanagement,
 *                           Daten teilen, Daten abrufen)
 *                Mehr erfahren  -> DEUTSCHE Projektseite (vorher englisch)
 *                Praxispartner
 *   VERWALTUNG   Dateien durchsuchen  (von der Navigation hierher verschoben)
 *                Vorgänge löschen     (nur mit Anmeldung)
 *
 * "Verwaltung" ist damit immer sichtbar -- vorher erschien der Abschnitt
 * nur angemeldet, weil er allein das Loeschen enthielt. Das Durchsuchen der
 * Dateien hat sein eigenes Berechtigungs-Gate und braucht hier keins.
 */

interface SideMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onScanClick: () => void;
  onPartnersClick: () => void;
  onFilesClick: () => void;
  /** Oeffnet das Zuruecksetzen der eigenen Uploads. Nur bei Anmeldung sichtbar. */
  onResetClick: () => void;
  /** Steuert die Sichtbarkeit des Zuruecksetzens: ohne Session gibt es keinen
      eigenen Pod, auf den es sich beziehen koennte. */
  isLoggedIn: boolean;
  /** Waehlt einen Anwendungsfall. Fehlt noch ein Produkt, fuehrt App.tsx
      zuerst zum Scan und springt danach automatisch hierhin. */
  onUseCaseClick: (useCaseId: string) => void;
  /** Oeffnet ein Thema der Anleitung. */
  onGuideClick: (topicId: GuideTopicId) => void;
}

/** Ein Hauptpunkt: Icon-Kachel, Titel, Untertitel, optional Zubehoer rechts. */
function MenuEntry({
  icon: Icon,
  title,
  subtitle,
  trailing,
  tone = 'default',
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  trailing?: ReactNode;
  tone?: 'default' | 'danger';
}) {
  return (
    <>
      <span
        className={`w-11 h-11 rounded-xl border flex items-center justify-center flex-shrink-0 ${
          tone === 'danger'
            ? 'bg-red-500/10 border-red-500/25'
            : 'bg-white/5 border-white/10'
        }`}
      >
        <Icon
          className={`w-5 h-5 ${tone === 'danger' ? 'text-red-400' : 'text-night-200'}`}
        />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-white text-sm">{title}</span>
        <span className="block text-xs text-night-400">{subtitle}</span>
      </span>
      {trailing}
    </>
  );
}

const ENTRY_CLASS =
  'w-full flex items-center gap-3.5 px-2 py-2.5 mt-1 rounded-xl hover:bg-white/5 transition-colors text-left';

export function SideMenu({
  isOpen,
  onClose,
  onScanClick,
  onPartnersClick,
  onFilesClick,
  onResetClick,
  isLoggedIn,
  onUseCaseClick,
  onGuideClick,
}: SideMenuProps) {
  const [useCasesOpen, setUseCasesOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  useBodyScrollLock(isOpen);

  const navigate = (action: () => void) => {
    onClose();
    action();
  };

  // Liste kommt aus der zentralen Registry -- kein eigener Bestand mehr, der
  // gegenueber Startseite und Raster veralten koennte.
  //
  // Jeder fertige Anwendungsfall ist waehlbar, auch ohne gescanntes Produkt:
  // App.tsx merkt sich die Auswahl und fuehrt bei Bedarf erst zum Scan.
  const subItems = USE_CASES.map((useCase) => ({
    ...useCase,
    openable: isAvailable(useCase),
  }));

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-night-950/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="h-full w-[85%] max-w-sm bg-night-950 border-r border-white/10 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Kopf: Logo + Schließen */}
            <div className="flex items-center justify-between px-5 h-16 border-b border-white/5 flex-shrink-0">
              <BrandWordmark />
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                aria-label="Menü schließen"
              >
                <X className="w-4 h-4 text-night-300" />
              </button>
            </div>

            {/* Navigation (scrollbar) */}
            <nav className="flex-1 overflow-y-auto scroll-touch px-4 py-5">
              <div className="px-2 mb-3 text-[11px] font-semibold uppercase tracking-[0.25em] text-night-400">
                Navigation
              </div>

              {/* Anwendungsfälle (aufklappbar) */}
              <button
                onClick={() => setUseCasesOpen((v) => !v)}
                className={`${ENTRY_CLASS} mt-0`}
                aria-expanded={useCasesOpen}
              >
                <MenuEntry
                  icon={Layers}
                  title="Anwendungsfälle"
                  subtitle="Module & Funktionen"
                  trailing={
                    <ChevronDown
                      className={`w-4 h-4 text-night-400 transition-transform ${
                        useCasesOpen ? 'rotate-180' : ''
                      }`}
                    />
                  }
                />
              </button>

              <AnimatePresence initial={false}>
                {useCasesOpen && (
                  <motion.ul
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden pl-6 pr-1"
                  >
                    {subItems.map((item) => (
                      <li key={item.id}>
                        <button
                          onClick={
                            item.openable
                              ? () => navigate(() => onUseCaseClick(item.id))
                              : undefined
                          }
                          disabled={!item.openable}
                          className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors ${
                            item.openable
                              ? 'hover:bg-white/5 text-night-100'
                              : 'text-night-400 cursor-default'
                          }`}
                        >
                          <UseCaseIcon
                            useCase={item}
                            size="sm"
                            muted={!item.openable}
                          />
                          <span className="flex-1 text-sm leading-snug">
                            {item.title}
                          </span>
                          {!item.openable && (
                            <span className="px-2 py-0.5 rounded-full bg-white/5 text-night-400 text-[10px] font-medium flex-shrink-0">
                              Demnächst
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>

              {/* Holzbauteil identifizieren */}
              <button onClick={() => navigate(onScanClick)} className={ENTRY_CLASS}>
                <MenuEntry
                  icon={ScanSearch}
                  title="Holzbauteil identifizieren"
                  subtitle="Produkt scannen und zuordnen"
                />
              </button>

              {/* Anleitung (aufklappbar) -- Vorgabe Praxispartner, Folie 3 */}
              <button
                onClick={() => setGuideOpen((v) => !v)}
                className={ENTRY_CLASS}
                aria-expanded={guideOpen}
              >
                <MenuEntry
                  icon={BookOpen}
                  title="Anleitung"
                  subtitle="Schritt für Schritt durch die Anwendung"
                  trailing={
                    <ChevronDown
                      className={`w-4 h-4 text-night-400 transition-transform ${
                        guideOpen ? 'rotate-180' : ''
                      }`}
                    />
                  }
                />
              </button>

              <AnimatePresence initial={false}>
                {guideOpen && (
                  <motion.ul
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden pl-6 pr-1"
                  >
                    {GUIDE_TOPICS.map((topic) => (
                      <li key={topic.id}>
                        <button
                          onClick={() => navigate(() => onGuideClick(topic.id))}
                          className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors hover:bg-white/5 text-night-100"
                        >
                          <span className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                            <topic.icon className="w-4 h-4 text-night-200" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm leading-snug">{topic.title}</span>
                            <span className="block text-[11px] text-night-400 leading-snug">
                              {topic.summary}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>

              {/* Mehr erfahren — von der Startseite hierher verlagert
                  (Vorgabe Anni, 26.08.2026). Fuehrt auf die DEUTSCHE
                  Projektseite des Lehrstuhls DPBB (Uni Wuppertal) -- die
                  englische stand hier bis 17.09.2026 (Rueckmeldung
                  Praxispartner, Folie 3). Als <a> statt <button>, damit
                  Aufziehen in neuem Tab moeglich bleibt. */}
              <a
                href="https://dpbb.uni-wuppertal.de/de/forschung/aktuelle-forschungsprojekte/timberconnect/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className={ENTRY_CLASS}
              >
                <MenuEntry
                  icon={Info}
                  title="Mehr erfahren"
                  subtitle="Informationen zum Forschungsprojekt"
                  trailing={<ExternalLink className="w-4 h-4 text-night-400 flex-shrink-0" />}
                />
              </a>

              {/* Praxispartner — letzter Navigationspunkt (Vorgabe Anni) */}
              <button onClick={() => navigate(onPartnersClick)} className={ENTRY_CLASS}>
                <MenuEntry
                  icon={Handshake}
                  title="Praxispartner"
                  subtitle="Netzwerk & Kooperationen"
                />
              </button>

              {/* Verwaltung: Dateien durchsuchen (immer), Vorgaenge loeschen
                  (nur mit Session, denn zurueckgesetzt wird ausschliesslich
                  der eigene Pod). Das Loeschen ist abgesetzt und in
                  Warnfarbe, damit es sich nicht wie Navigation anfuehlt. */}
              <div className="mt-5 mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-night-400">
                Verwaltung
              </div>
              <button
                onClick={() => navigate(onFilesClick)}
                className={`${ENTRY_CLASS} mt-0`}
              >
                <MenuEntry
                  icon={FolderSearch}
                  title="Dateien durchsuchen"
                  subtitle="Originaldateien & Berechtigungen"
                />
              </button>
              {isLoggedIn && (
                <button
                  onClick={() => navigate(onResetClick)}
                  className="w-full flex items-center gap-3.5 px-2 py-2.5 mt-1 rounded-xl hover:bg-red-500/10 transition-colors text-left group"
                >
                  <MenuEntry
                    icon={RotateCcw}
                    title="Vorgänge löschen"
                    subtitle="Einzeln wählbar oder alle"
                    tone="danger"
                  />
                </button>
              )}
            </nav>

            {/* Förderhinweis — Vorgaben siehe FundingLogos */}
            <div className="px-5 py-4 border-t border-white/5 flex-shrink-0 flex justify-center">
              <FundingLogos variant="menu" />
            </div>
          </motion.aside>
        </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
