import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  Crosshair,
  Loader2,
  MapPin,
  Search,
  Sprout,
  X,
} from 'lucide-react';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import { LocationPickMap, type AreaOutline } from '../Map/LocationPickMap';
import {
  findPlantingsAt,
  getCurrentPosition,
  isGeolocationAvailable,
  loadVisiblePlantingAreas,
  plantingLabel,
  type PlantingHit,
} from '../../services/plantingLookupService';
import type { PlantingAreaResult } from '../../services/sparqlService';
import {
  isPointInRing,
  ringAreaHectares,
  type GeoPoint,
} from '../../services/geoService';

/**
 * Pflanzung ueber den Standort finden.
 *
 * Der zweite Identifikationsweg neben dem Scannen. Ein Pflanzvorgang traegt
 * kein Etikett — er ist ueber seine Flaeche bestimmt. Wer darauf steht, hat
 * ihn damit identifiziert.
 *
 * Zwei Wege zur Position, weil keiner allein traegt:
 *   * GPS — der direkte Weg im Wald, braucht aber HTTPS. Auf dem Zebra-Geraet
 *     im LAN ueber http:// gibt der Browser die Schnittstelle nicht frei
 *     (dieselbe Huerde, an der der Kamera-Scanner scheiterte).
 *   * Karte — funktioniert immer, auch am Schreibtisch und zum Nachsehen.
 *
 * Gesucht wird nur nach echten Treffern: Liegt der Punkt in keiner Flaeche,
 * wird keine "naechstgelegene" angeboten. Eine Herkunft aus Naehe statt
 * Zugehoerigkeit waere im Datenraum nicht belegbar.
 */

interface LocationScanSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Ein Treffer wurde gewaehlt — weiter wie bei einem Scan. */
  onSelect: (epc: string) => void;
  /** Laeuft bereits ein Datenabruf im Hintergrund? */
  isLoading?: boolean;
}

export function LocationScanSheet({
  isOpen,
  onClose,
  onSelect,
  isLoading = false,
}: LocationScanSheetProps) {
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [hits, setHits] = useState<PlantingHit[] | null>(null);
  const [withoutEpc, setWithoutEpc] = useState(0);
  const [isLocating, setIsLocating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Welcher Treffer wurde angetippt?
   *
   * Nach dem Tippen laeuft der Datenabruf zum Bauteil — er dauert, weil dahinter
   * EPCIS-Abfrage und Pod-SPARQL stecken. Ohne sichtbare Rueckmeldung steht das
   * Sheet unveraendert da und wirkt wie ein toter Knopf. Gemerkt wird die
   * konkrete Karte, nicht nur "es laedt": Bei mehreren Treffern muss der Spinner
   * an der Zeile stehen, die der Nutzer gewaehlt hat.
   */
  const [selectedIri, setSelectedIri] = useState<string | null>(null);

  /** Alle sichtbaren Flaechen als Kartenhintergrund. */
  const [allAreas, setAllAreas] = useState<PlantingAreaResult[]>([]);
  const [isLoadingAreas, setIsLoadingAreas] = useState(false);

  const geoAvailable = useMemo(() => isGeolocationAvailable(), []);

  useBodyScrollLock(isOpen);

  // Beim Oeffnen zuruecksetzen. Ein alter Treffer aus dem letzten Aufruf waere
  // beim naechsten Oeffnen eine falsche Aussage ueber den jetzigen Standort.
  useEffect(() => {
    if (!isOpen) return;
    setPoint(null);
    setAccuracy(null);
    setHits(null);
    setWithoutEpc(0);
    setError(null);
    setSelectedIri(null);
  }, [isOpen]);

  // Der Abruf ist zu Ende (erfolgreich oder nicht) — dann darf keine Karte mehr
  // laden. Bei Erfolg schliesst das Sheet ohnehin; bleibt es offen, war es ein
  // Fehlschlag, und ein weiterlaufender Spinner wuerde Fortschritt behaupten,
  // den es nicht gibt.
  useEffect(() => {
    if (!isLoading) setSelectedIri(null);
  }, [isLoading]);

  // Alle sichtbaren Flaechen laden, sobald das Sheet aufgeht.
  //
  // Das ist der Punkt, an dem das Raten aufhoert: Der Nutzer sieht die
  // vorhandenen Flaechen, BEVOR er einen Punkt setzt. Geladen wird ueber alle
  // Pods, die seine Rolle zulaesst — nicht ueber den Produktkatalog, der
  // Zertifikate ohne Bauteilbezug verschluckt.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoadingAreas(true);
    (async () => {
      const areas = await loadVisiblePlantingAreas();
      if (!cancelled) {
        setAllAreas(areas);
        setIsLoadingAreas(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  /** Die Suche an einer Position ausführen. */
  const search = useCallback(async (at: GeoPoint) => {
    setIsSearching(true);
    setError(null);
    setHits(null);
    try {
      const result = await findPlantingsAt(at);
      setHits(result.hits);
      setWithoutEpc(result.withoutEpc);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Die Pflanzflächen konnten nicht abgefragt werden.',
      );
    } finally {
      setIsSearching(false);
    }
  }, []);

  /** GPS abfragen und direkt suchen. */
  const handleLocate = async () => {
    setIsLocating(true);
    setError(null);
    try {
      const { point: at, accuracy: acc } = await getCurrentPosition();
      setPoint(at);
      setAccuracy(acc);
      await search(at);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Standort nicht ermittelbar.',
      );
    } finally {
      setIsLocating(false);
    }
  };

  /** Punkt auf der Karte gesetzt. */
  const handleMapPick = useCallback((at: { lat: number; lon: number }) => {
    setPoint(at);
    // Der Kartenklick ist exakt — ein Genauigkeitsradius aus der vorherigen
    // GPS-Ortung wuerde hier eine Unschaerfe behaupten, die es nicht gibt.
    setAccuracy(null);
    setHits(null);
    setError(null);
  }, []);

  const busy = isLocating || isSearching || isLoading;

  /** Flaechen fuer die Karte; Treffer hervorgehoben. */
  const outlines: AreaOutline[] = useMemo(() => {
    return allAreas.map((area) => ({
      ring: area.ring,
      highlighted: point ? isPointInRing(point, area.ring) : false,
    }));
  }, [allAreas, point]);

  const showNoHit = hits !== null && hits.length === 0;

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
              className="w-full h-full sm:h-[90%] sm:my-auto sm:max-w-3xl bg-night-800 sm:border border-white/10 sm:rounded-3xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 sm:px-6 pt-4 pb-3 border-b border-white/10">
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-bold text-white truncate">
                    Pflanzung über den Standort finden
                  </h2>
                  <p className="text-xs text-night-400 mt-0.5">
                    Eine Pflanzung ist über ihre Fläche identifiziert — kein
                    Code nötig.
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

              <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
                {/* GPS zuerst: im Wald der eigentliche Weg. */}
                <div>
                  <button
                    onClick={handleLocate}
                    disabled={busy || !geoAvailable}
                    className="btn btn-acid w-full justify-center"
                  >
                    {isLocating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Standort wird bestimmt...</span>
                      </>
                    ) : (
                      <>
                        <Crosshair className="w-4 h-4" />
                        <span>Meinen Standort verwenden</span>
                      </>
                    )}
                  </button>
                  {!geoAvailable && (
                    // Kein stiller toter Knopf: Der Grund gehoert daneben,
                    // sonst wirkt die App kaputt statt eingeschraenkt.
                    <p className="text-xs text-night-400 mt-2 leading-relaxed">
                      Die Standortbestimmung braucht eine gesicherte Verbindung
                      (HTTPS) und steht hier nicht zur Verfügung. Wählen Sie den
                      Ort auf der Karte.
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-[11px] font-bold tracking-[0.16em] text-night-400 uppercase">
                    oder auf der Karte
                  </span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>

                <LocationPickMap
                  value={point}
                  onChange={handleMapPick}
                  areas={outlines}
                  accuracy={accuracy}
                />

                {/* Was auf der Karte liegt, auch als Liste. Eine Flaeche kann
                    wenige Hektar gross und bei Deutschland-Zoom unsichtbar
                    sein — ohne diesen Weg muesste man sie suchen, obwohl die
                    App sie laengst kennt. */}
                {isLoadingAreas && (
                  <div className="flex items-center gap-2.5 text-xs text-night-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-acid-300" />
                    Vorhandene Pflanzflächen werden geladen...
                  </div>
                )}

                {!isLoadingAreas && allAreas.length === 0 && (
                  <p className="text-xs text-night-400 leading-relaxed">
                    Es sind keine Pflanzflächen sichtbar. Entweder ist noch
                    keine registriert, oder Ihre Rolle gibt die betreffenden
                    Pods nicht frei.
                  </p>
                )}

                {!isLoadingAreas && allAreas.length > 0 && (
                  <details className="group">
                    <summary className="text-xs text-night-300 cursor-pointer hover:text-white transition-colors list-none flex items-center gap-1.5">
                      <span className="text-acid-300 font-semibold">
                        {allAreas.length}
                      </span>
                      {allAreas.length === 1
                        ? 'Pflanzfläche vorhanden'
                        : 'Pflanzflächen vorhanden'}
                      <span className="text-night-500 group-open:hidden">
                        — anzeigen
                      </span>
                      <span className="text-night-500 hidden group-open:inline">
                        — zuklappen
                      </span>
                    </summary>
                    <div className="mt-2.5 space-y-1.5">
                      {allAreas.map((area) => {
                        // Zum Zentroid springen. Er kommt aus dem Graph; fehlt
                        // er, tut es der erste Eckpunkt des Rings.
                        const target = area.centroid ?? {
                          lat: area.ring[0][1],
                          lon: area.ring[0][0],
                        };
                        return (
                          <button
                            key={area.certificateIri}
                            onClick={() => handleMapPick(target)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 bg-night-900/60 hover:bg-night-700 border border-white/5 rounded-xl transition-colors text-left"
                          >
                            <MapPin className="w-3.5 h-3.5 text-night-400 flex-shrink-0" />
                            <span className="flex-1 min-w-0">
                              <span className="block text-xs font-medium text-white truncate">
                                {plantingLabel(area)}
                              </span>
                              <span className="block text-[11px] text-night-400 truncate">
                                {[
                                  area.species,
                                  `${ringAreaHectares(area.ring).toLocaleString(
                                    'de-DE',
                                    { maximumFractionDigits: 2 },
                                  )} ha`,
                                  area.epc ? null : 'ohne Materialbezug',
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </details>
                )}

                {point && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-night-300">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-acid-300" />
                      <span className="font-mono">
                        {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
                      </span>
                    </span>
                    {accuracy !== null && (
                      <span className="text-night-400">
                        Genauigkeit ±{Math.round(accuracy)} m
                      </span>
                    )}
                  </div>
                )}

                {/* Nach einem Kartenklick muss die Suche ausgeloest werden;
                    nach der GPS-Ortung lief sie schon. */}
                {point && hits === null && !isSearching && !error && (
                  <button
                    onClick={() => void search(point)}
                    disabled={busy}
                    className="btn btn-acid w-full justify-center"
                  >
                    <Search className="w-4 h-4" />
                    <span>Pflanzung an diesem Ort suchen</span>
                  </button>
                )}

                {isSearching && (
                  <div className="flex items-center gap-3 px-4 py-3 text-sm text-night-300">
                    <Loader2 className="w-4 h-4 animate-spin text-acid-300" />
                    Pflanzflächen werden durchsucht...
                  </div>
                )}

                {error && (
                  <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-xl">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300 leading-relaxed">{error}</p>
                  </div>
                )}

                {/* Kein Treffer: klar sagen, dass nichts gefunden wurde, statt
                    eine nahe Flaeche als Ergebnis auszugeben. */}
                {showNoHit && (
                  <div className="px-4 py-4 bg-night-900/60 border border-white/10 rounded-2xl">
                    <p className="text-sm font-semibold text-white">
                      An diesem Ort ist keine Pflanzung verzeichnet
                    </p>
                    <p className="text-xs text-night-400 mt-1.5 leading-relaxed">
                      {withoutEpc > 0 ? (
                        <>
                          Hier {withoutEpc === 1 ? 'liegt eine Fläche' : `liegen ${withoutEpc} Flächen`},
                          aber ohne Bezug zu einem Vermehrungsgut — das
                          Stammzertifikat nennt keinen Ident, mit dem sich
                          weitersuchen ließe.
                        </>
                      ) : (
                        <>
                          Der Punkt liegt in keiner registrierten Pflanzfläche.
                          Bei einer GPS-Ortung am Flächenrand kann das an der
                          Messgenauigkeit liegen — setzen Sie den Punkt in
                          diesem Fall auf der Karte.
                        </>
                      )}
                    </p>
                  </div>
                )}

                {/* Treffer. Mehrere sind moeglich, wenn Flaechen ineinander
                    liegen; die kleinere steht oben (genauere Aussage). */}
                {hits && hits.length > 0 && (
                  <section>
                    <h3 className="text-[11px] font-bold tracking-[0.16em] text-night-300 uppercase mb-2.5">
                      {hits.length === 1
                        ? 'Gefundene Pflanzung'
                        : `${hits.length} Pflanzungen gefunden`}
                    </h3>
                    <div className="space-y-2.5">
                      {hits.map((hit) => {
                        const isSelected =
                          selectedIri === hit.area.certificateIri;
                        return (
                        <button
                          key={hit.area.certificateIri}
                          onClick={() => {
                            setSelectedIri(hit.area.certificateIri);
                            onSelect(hit.epc);
                          }}
                          disabled={busy}
                          aria-busy={isSelected}
                          className={`w-full flex items-center gap-3 px-4 py-3.5 bg-night-900 hover:bg-night-700 border rounded-2xl transition-colors text-left ${
                            isSelected
                              ? 'border-acid-400 opacity-100'
                              : 'border-acid-400/30 disabled:opacity-60'
                          }`}
                        >
                          <div className="w-10 h-10 rounded-xl bg-night-700 border border-white/5 flex items-center justify-center flex-shrink-0">
                            <Sprout className="w-5 h-5 text-acid-300" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white truncate">
                              {hit.label}
                            </p>
                            {isSelected && (
                              <p className="text-xs text-acid-300 mt-0.5 truncate">
                                Daten werden geladen...
                              </p>
                            )}
                            <p className="text-xs font-mono text-night-400 mt-0.5 truncate">
                              {hit.epc}
                            </p>
                            <p className="text-xs text-night-400 mt-0.5 truncate">
                              {[
                                hit.area.species,
                                hit.area.maturityYear
                                  ? `Reife ${hit.area.maturityYear}`
                                  : null,
                                `${hit.hectares.toLocaleString('de-DE', {
                                  maximumFractionDigits: 2,
                                })} ha`,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          </div>
                          {isSelected ? (
                            <Loader2 className="w-4 h-4 text-acid-300 flex-shrink-0 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4 text-acid-300 flex-shrink-0" />
                          )}
                        </button>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
