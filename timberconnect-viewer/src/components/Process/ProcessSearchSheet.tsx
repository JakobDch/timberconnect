import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Clock, Info, Search, X } from 'lucide-react';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import {
  PROCESS_TYPES,
  formatRegisteredAt,
  getProcessType,
  searchProcesses,
  type ProcessRecord,
  type ProcessTypeId,
} from '../../services/processService';

/**
 * Vorgangssuche zum Nachreichen einzelner Dateien.
 *
 * Gesucht wird HEUTE ueber den Zeitstempel der Registrierung (plus Bezeichnung
 * und Vorgangstyp). Die Suche ueber Event-IDs und Material-IDs ist im
 * Datenmodell bereits angelegt (searchProcesses beruecksichtigt beide Felder),
 * liefert aber noch keine Treffer, solange keine Events existieren — deshalb
 * der Hinweis unter dem Suchfeld.
 */

interface ProcessSearchSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (record: ProcessRecord) => void;
}

export function ProcessSearchSheet({ isOpen, onClose, onSelect }: ProcessSearchSheetProps) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<ProcessTypeId | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [version, setVersion] = useState(0);

  useBodyScrollLock(isOpen);

  // Beim Oeffnen Filter zuruecksetzen und Liste neu lesen (localStorage).
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setType('');
      setFrom('');
      setTo('');
      setVersion((v) => v + 1);
    }
  }, [isOpen]);

  const results = useMemo(
    () =>
      isOpen
        ? searchProcesses({
            query,
            type: type || null,
            from: from || null,
            to: to || null,
          })
        : [],
    [isOpen, query, type, from, to, version],
  );

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-night-950/70 backdrop-blur-sm"
            onClick={onClose}
          >
            <motion.div
              initial={{ y: '100%', opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-full sm:max-w-xl bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl shadow-black/50 max-h-[92%] sm:max-h-[85%] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sm:hidden flex justify-center pt-3">
                <div className="w-10 h-1 rounded-full bg-white/15" />
              </div>

              <div className="flex items-center justify-between px-5 sm:px-6 pt-4 pb-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-white">Vorgang suchen</h2>
                  <p className="text-xs text-night-400 mt-0.5">
                    Auf welchen Vorgang beziehen sich die Dateien?
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                  aria-label="Schließen"
                >
                  <X className="w-4 h-4 text-night-300" />
                </button>
              </div>

              <div className="px-5 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] overflow-y-auto scroll-touch space-y-4">
                {/* Freitext */}
                <div>
                  <div className="relative">
                    <Search className="w-4 h-4 text-night-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Bezeichnung, Vorgangs-ID oder Dateiname"
                      className="w-full pl-11 pr-4 py-3 bg-night-900 border border-white/10 rounded-xl text-white text-sm placeholder:text-night-300 focus:outline-none focus:border-acid-400/60 focus:ring-4 focus:ring-acid-400/10"
                    />
                  </div>
                  <div className="flex items-start gap-2 mt-2 px-1">
                    <Info className="w-3.5 h-3.5 text-night-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-night-400">
                      Die Suche über Event-IDs und Material-IDs ist vorbereitet,
                      liefert aber noch keine Treffer — bis dahin läuft das
                      Wiederfinden über den Registrierungszeitpunkt.
                    </p>
                  </div>
                </div>

                {/* Zeitraum + Typ */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-night-300 mb-1.5">
                      Registriert ab
                    </label>
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      className="w-full px-3 py-2.5 bg-night-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-acid-400/60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-night-300 mb-1.5">
                      Registriert bis
                    </label>
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      className="w-full px-3 py-2.5 bg-night-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-acid-400/60"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-night-300 mb-1.5">
                    Vorgangstyp
                  </label>
                  <select
                    value={type}
                    onChange={(e) => setType((e.target.value as ProcessTypeId) || '')}
                    className="w-full px-4 py-2.5 bg-night-900 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-acid-400/60"
                  >
                    <option value="">Alle Vorgänge</option>
                    {PROCESS_TYPES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Trefferliste */}
                <div className="space-y-2.5 pt-1">
                  <h3 className="text-[11px] font-bold tracking-[0.16em] text-night-300 uppercase">
                    {results.length} {results.length === 1 ? 'Vorgang' : 'Vorgänge'}
                  </h3>

                  {results.length === 0 && (
                    <div className="px-4 py-6 text-center bg-night-700/40 border border-white/10 rounded-2xl">
                      <p className="text-sm text-night-300">Kein Vorgang gefunden.</p>
                      <p className="text-xs text-night-400 mt-1">
                        Vorgänge erscheinen hier, sobald sie registriert wurden.
                      </p>
                    </div>
                  )}

                  {results.map((record) => {
                    const type = getProcessType(record.type);
                    const leadDoc = record.files.find((f) => f.isLeadDoc);
                    return (
                      <button
                        key={record.id}
                        onClick={() => onSelect(record)}
                        className="w-full flex items-center gap-3 px-4 py-3.5 bg-night-700/50 hover:bg-night-700/80 border border-white/5 hover:border-acid-400/40 rounded-2xl text-left transition-all group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-white truncate">
                              {record.title}
                            </span>
                            <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full bg-white/5 text-night-300 border border-white/10 flex-shrink-0">
                              {type.label}
                            </span>
                          </div>
                          <p className="inline-flex items-center gap-1.5 text-xs text-night-400 mt-1">
                            <Clock className="w-3 h-3" />
                            {formatRegisteredAt(record.registeredAt)}
                          </p>
                          <p className="text-xs text-night-300 mt-1">
                            {record.files.length}{' '}
                            {record.files.length === 1 ? 'Datei' : 'Dateien'}
                            {leadDoc && ` · Pflichtdatei: ${leadDoc.name}`}
                          </p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-night-400 group-hover:text-acid-300 transition-colors flex-shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
