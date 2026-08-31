import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  MapPin,
  X,
} from 'lucide-react';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';
import { PlantingAreaMap, type PolygonGeoJson } from '../Map/PlantingAreaMap';
import type { PdfTemplate } from '../../services/pdfDocumentService';
import {
  checkAreaConflicts,
  conflictLabel,
  loadOccupiedAreas,
  type OccupiedArea,
} from '../../services/plantingAreaConflictService';

/**
 * Karten-Schritt fuer die Pflanzflaeche.
 *
 * Der einzige Wert, der NICHT aus dem hochgeladenen PDF stammen kann: eine
 * Flaeche tippt man nicht ab, man zeichnet sie — es gibt dafuer bewusst kein
 * AcroForm-Feld (siehe `_planting_area_section` in pdf_template_service.py).
 * Deshalb bleibt dieser eine Schritt vor dem Registrieren bestehen, und zwar
 * ausschliesslich fuer Vorlagen, die eine Flaeche verlangen (heute das
 * Stammzertifikat).
 *
 * Ueber die Flaeche werden Produkte spaeter anhand ihrer GPS-Position dem
 * Pflanzvorgang zugeordnet; fehlt sie, faellt dieser Bezug ersatzlos weg.
 */

interface PlantingAreaSheetProps {
  isOpen: boolean;
  /** Vorlage, die die Flaeche verlangt — liefert Titel und Hilfetext. */
  template: PdfTemplate | null;
  /** Name der Datei, zu der die Flaeche gehoert. */
  fileName: string | null;
  /**
   * Die Flaechengroesse wird mitgegeben, weil der naechste Schritt (die
   * ausgebrachte Saatgutmenge) sie als Bezugsgroesse braucht.
   */
  onConfirm: (area: PolygonGeoJson, hectares: number) => void;
  /**
   * Zurueck ins Formular. Es wird NICHTS hochgeladen — der Upload beginnt
   * erst, nachdem alle Angaben vollstaendig sind und der Nutzer die
   * ausgelesenen Daten bestaetigt hat.
   */
  onCancel: () => void;
}

/**
 * Der Zeichen-Zustand haengt am Dateinamen: pro Datei eine eigene Flaeche.
 * Der Wechsel erfolgt ueber `key` (Remount) statt ueber einen Reset-Effekt --
 * so gibt es keinen Renderdurchlauf, in dem noch die Flaeche der vorigen Datei
 * steht.
 */
export function PlantingAreaSheet({ fileName, ...props }: PlantingAreaSheetProps) {
  return <PlantingAreaSheetContent key={fileName ?? ''} fileName={fileName} {...props} />;
}

function PlantingAreaSheetContent({
  isOpen,
  template,
  fileName,
  onConfirm,
  onCancel,
}: PlantingAreaSheetProps) {
  const [area, setArea] = useState<PolygonGeoJson | null>(null);
  const [hectares, setHectares] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /**
   * Bereits vergebene Flächen. Werden geladen, sobald das Sheet aufgeht —
   * nicht erst beim Klick auf „Übernehmen": Die Abfrage geht über mehrere
   * fremde Pods und dauert. Erst beim Absenden zu laden hieße, den Nutzer
   * genau dann warten zu lassen, wenn er fertig ist.
   */
  const [occupied, setOccupied] = useState<OccupiedArea[]>([]);
  const [isLoadingOccupied, setIsLoadingOccupied] = useState(false);

  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoadingOccupied(true);
    void loadOccupiedAreas()
      .then((areas) => {
        if (!cancelled) setOccupied(areas);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingOccupied(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const section = template?.sections.find((s) => s.plantingArea) ?? null;

  /**
   * Laufende Konfliktprüfung: Sie hängt am gezeichneten Polygon, nicht am
   * Absende-Klick. So färbt sich die Überschneidung schon beim Setzen des
   * dritten Punktes rot, statt erst als Fehlermeldung am Ende zu erscheinen.
   */
  const conflict = useMemo(() => {
    const ring = area?.coordinates?.[0];
    if (!ring || ring.length < 3 || occupied.length === 0) {
      return { hits: [], totalHectares: 0 };
    }
    return checkAreaConflicts(ring, occupied);
  }, [area, occupied]);

  const hasConflict = conflict.hits.length > 0;

  /** Die roten Ringe für die Karte. */
  const conflictRings = useMemo(
    () => conflict.hits.flatMap((hit) => hit.rings),
    [conflict],
  );

  /**
   * Fremde Flächen für die Karte. Die eigene, gerade gezeichnete ist nicht
   * dabei — sie hat ihre eigene Darstellung.
   */
  const occupiedRings = useMemo(() => occupied.map((a) => a.ring), [occupied]);

  const handleConfirm = () => {
    if (!area) {
      setError('Bitte zeichnen Sie die Fläche auf der Karte ein.');
      return;
    }
    if (hasConflict) {
      // Sollte über den deaktivierten Button nicht erreichbar sein; als
      // zweite Absicherung steht die Prüfung trotzdem hier.
      setError(
        'Die Fläche überschneidet sich mit einem bestehenden Pflanzvorgang.',
      );
      return;
    }
    onConfirm(area, hectares);
  };

  return (
    <SheetPortal>
      <AnimatePresence>
        {isOpen && template && (
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
              className="w-full h-full sm:h-[90%] sm:my-auto sm:max-w-4xl bg-night-800 sm:border border-white/10 sm:rounded-3xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 sm:px-6 pt-4 pb-3 border-b border-white/10">
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-bold text-white truncate">
                    Pflanzfläche einzeichnen
                  </h2>
                  {fileName && (
                    <p className="text-xs text-night-400 truncate mt-0.5">
                      {template.label} · {fileName}
                    </p>
                  )}
                </div>
                <button
                  onClick={onCancel}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
                  aria-label="Schließen"
                >
                  <X className="w-4 h-4 text-night-300" />
                </button>
              </div>

              <div className="flex-1 min-h-0 flex flex-col p-4 sm:p-5">
                {section?.description && (
                  <p className="text-sm text-night-300 mb-3">{section.description}</p>
                )}
                <PlantingAreaMap
                  value={area}
                  onChange={(polygon, ha) => {
                    setArea(polygon);
                    setHectares(ha);
                    if (polygon) setError(null);
                  }}
                  occupiedRings={occupiedRings}
                  conflictRings={conflictRings}
                  className="flex-1 min-h-0"
                />
              </div>

              <div className="border-t border-white/10 px-5 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {/* Konflikt: der Grund, warum es nicht weitergeht. Steht ueber
                    dem Button, damit die Sperre erklaert ist und nicht raetselhaft
                    bleibt. */}
                {hasConflict && (
                  <div className="flex items-start gap-2.5 px-3 py-2.5 mb-2.5 bg-red-500/10 border border-red-500/30 rounded-xl">
                    <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-red-300">
                        Diese Fläche ist bereits vergeben
                      </p>
                      <p className="text-xs text-red-300/80 mt-0.5 leading-relaxed">
                        {conflict.totalHectares.toLocaleString('de-DE', {
                          maximumFractionDigits: 2,
                        })}{' '}
                        ha überschneiden sich mit{' '}
                        {conflict.hits
                          .map((hit) => conflictLabel(hit, occupied))
                          .join(', ')}
                        . Der rot markierte Bereich muss aus Ihrer Fläche
                        herausgenommen werden — sonst ließe sich ein dort
                        geernteter Stamm zwei Herkünften zuordnen.
                      </p>
                    </div>
                  </div>
                )}

                {error && !hasConflict && (
                  <div className="flex items-center gap-2 px-3 py-2 mb-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="text-xs">{error}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-night-300">
                    {isLoadingOccupied ? (
                      <>
                        <Loader2 className="w-4 h-4 text-acid-300 animate-spin flex-shrink-0" />
                        <span>Vergebene Flächen werden geladen...</span>
                      </>
                    ) : (
                      <>
                        <MapPin className="w-4 h-4 text-acid-300 flex-shrink-0" />
                        <span>
                          {area ? (
                            <>
                              Fläche eingezeichnet —{' '}
                              <span className="font-semibold text-acid-300">
                                {hectares.toLocaleString('de-DE', {
                                  maximumFractionDigits: 2,
                                })}{' '}
                                ha
                              </span>
                            </>
                          ) : (
                            'Noch keine Fläche eingezeichnet'
                          )}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Frueher "Ohne Flaeche fortfahren": Das umging eine
                        Pflichtangabe der Vorlage und liess den Upload erst
                        anlaufen und dann am fehlenden Polygon scheitern. Der
                        Weg zurueck ins Formular ist ehrlicher — und laesst
                        nichts Halbfertiges im Pod zurueck. */}
                    <button
                      onClick={onCancel}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-night-700/60 hover:bg-night-700 text-night-200 text-sm font-semibold transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Zurück
                    </button>
                    {/* First come, first serve: Solange sich die Flaeche mit
                        einer bestehenden ueberschneidet, geht es nicht weiter. */}
                    <button
                      onClick={handleConfirm}
                      disabled={!area || hasConflict || isLoadingOccupied}
                      className="btn btn-acid"
                      title={
                        hasConflict
                          ? 'Die Fläche überschneidet sich mit einem bestehenden Pflanzvorgang'
                          : undefined
                      }
                    >
                      <Check className="w-4 h-4" />
                      <span>Übernehmen</span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
