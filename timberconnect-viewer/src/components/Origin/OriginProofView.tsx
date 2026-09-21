import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ChevronDown, Package } from 'lucide-react';
import type { Product, SupplyChainStep } from '../../types';
import type { ProductDataResult } from '../../services/sparqlService';
import {
  mapToProvenance,
  type ActorKind,
  type ProvenanceActor,
} from '../../services/provenanceMapper';
import { geocodeActorLocation } from '../../services/geocodingService';
import { ActorLocationMap, ACTOR_COLORS, ACTOR_LABELS, type ActorMarker } from '../Map';
import { DocumentDownloadSection } from '../Documents';
import { ActorStationList } from './ActorStationList';

/**
 * Anwendungsfall "Herkunftsnachweis" (Awf-Vorgabe, Visualisierung S. 1).
 *
 * Zeigt die durchgaengige Rueckverfolgbarkeit einer BSP-Platte: allgemeine
 * Merkmale, die Standorte der drei Akteure auf einer Karte, die Akteure als
 * anklickbare Liste mit Transportdatum, den Downloadbereich der zugehoerigen
 * Dokumente und die Zertifizierungen.
 *
 * Die 28 Informationsanforderungen (I-1..I-28) werden in
 * services/provenanceMapper.ts aus den Rohdaten zusammengesetzt; hier wird nur
 * dargestellt. Fehlende Angaben erscheinen als "Keine Daten verfuegbar" --
 * nichts wird mit Beispielwerten aufgefuellt.
 */

interface OriginProofViewProps {
  productId: string;
  product: Product | null;
  supplyChain: SupplyChainStep[];
  /** Rohe Abfrageergebnisse -- enthalten Felder, die Product/SupplyChain
      nicht transportieren (Transportauftraege, Zertifikate, EPCIS-Events). */
  productData: ProductDataResult | null;
  onBack: () => void;
  /** Fuehrt zum Scan -- Ausweg aus dem Leerzustand. */
  onScanClick?: () => void;
}

const NO_DATA = 'Keine Daten verfügbar';

/** Beschriftete Zeile; leere Werte werden einheitlich gekennzeichnet. */
function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-3 text-sm py-1.5 border-b border-white/5 last:border-0">
      <dt className="w-40 sm:w-48 flex-shrink-0 text-night-400 text-xs pt-0.5">{label}:</dt>
      <dd className={`flex-1 min-w-0 text-xs sm:text-sm ${value ? 'text-night-100' : 'text-night-400 italic'}`}>
        {value ?? NO_DATA}
      </dd>
    </div>
  );
}

export function OriginProofView({
  productId,
  product,
  supplyChain,
  productData,
  onBack,
  onScanClick,
}: OriginProofViewProps) {
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Geocodierte Standorte je Akteur-Id (der Wald bringt echte Koordinaten mit).
  const [geocoded, setGeocoded] = useState<Record<string, ActorMarker['position'] | null>>({});

  const provenance = useMemo(
    () => mapToProvenance(productData, product, supplyChain),
    [productData, product, supplyChain],
  );

  // --- Standorte aufloesen ------------------------------------------------
  // Nur Akteure ohne Messkoordinate gehen an den Geocoder, und der laeuft
  // sequentiell mit Cache (siehe geocodingService).
  useEffect(() => {
    let cancelled = false;

    // Auch Akteure ohne Anschrift kommen mit: ueber den Firmennamen allein ist
    // ein Standort oft noch auffindbar (siehe geocodeActorLocation).
    const pending = provenance.actors.filter((a) => !a.coordinates && (a.address || a.name));
    if (pending.length === 0) return;

    (async () => {
      for (const actor of pending) {
        const position = await geocodeActorLocation(actor.name, actor.address);
        if (cancelled) return;
        setGeocoded((prev) => ({ ...prev, [actor.id]: position }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provenance.actors]);

  /** Akteur + aufgeloeste Koordinate zusammenfuehren. */
  const resolvedActors = useMemo(
    () =>
      provenance.actors.map((actor): ProvenanceActor => {
        if (actor.coordinates) return actor;
        const position = geocoded[actor.id];
        return position
          ? { ...actor, coordinates: position, coordinateSource: 'geocoded' }
          : actor;
      }),
    [provenance.actors, geocoded],
  );

  const markers = useMemo<ActorMarker[]>(
    () =>
      resolvedActors
        .filter((a) => a.coordinates)
        .map((a) => ({
          id: a.id,
          kind: a.kind,
          label: a.name,
          position: a.coordinates!,
          approximate: a.coordinateSource === 'geocoded',
        })),
    [resolvedActors],
  );

  const hasApproximate = markers.some((m) => m.approximate);

  const hasCert = (name: string) =>
    provenance.certifications.some((c) => c.toUpperCase().includes(name));

  // --- Leerzustand --------------------------------------------------------
  if (!product) {
    return (
      <div className="flex-1 bg-night-900">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-semibold text-night-300 hover:text-white transition-colors mb-5"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Zurück</span>
          </button>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mb-2">
            Herkunfts<span className="text-acid-400">nachweis</span>
          </h1>
          <div className="bg-night-700/50 border border-white/5 rounded-2xl p-6 mt-6">
            <p className="text-sm text-night-300">
              Für den Herkunftsnachweis wird ein Produkt benötigt. Scannen Sie ein
              Bauteil oder geben Sie die Produkt-ID ein.
            </p>
            <button
              onClick={onScanClick ?? onBack}
              className="mt-4 px-4 py-2 rounded-xl bg-acid-400 text-night-950 text-sm font-semibold hover:bg-acid-300 transition-colors"
            >
              Bauteil erfassen
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 bg-night-900">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-semibold text-night-300 hover:text-white transition-colors mb-5"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Zurück</span>
          </button>

          {/* Titel + Einleitung */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Herkunfts<span className="text-acid-400">nachweis</span>
            </h1>
            <p className="text-sm text-night-300 mt-2 leading-relaxed">
              Durchgängige, digitale Rückverfolgbarkeit von Holzprodukten zu deren
              jeweiliger Herkunft: Vom Rundholz aus dem Wald, dem Schnittholz aus dem
              Sägewerk, bis hin zum fertigen Produkt des Holzwerkstoffproduzenten.
            </p>
          </motion.div>

          <div className="space-y-4">
            {/* Allgemeine Informationen (I-1..I-9) */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="bg-night-800 border border-white/5 rounded-2xl p-5"
            >
              <dl>
                <InfoRow label="Handelsname" value={provenance.tradeName} />
                <InfoRow label="Beschreibung" value={provenance.description} />
                <InfoRow label="Holzart (deutsch)" value={provenance.speciesGerman} />
                <InfoRow label="Holzart (botanisch)" value={provenance.speciesBotanical} />
              </dl>

              <button
                onClick={() => setDetailsOpen((v) => !v)}
                className="flex items-center gap-2 text-xs font-semibold text-night-300 hover:text-white transition-colors mt-3"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
                />
                Weitere Angaben
              </button>

              <AnimatePresence initial={false}>
                {detailsOpen && (
                  <motion.dl
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden mt-2"
                  >
                    <InfoRow label="Erzeugnisart" value={provenance.productKind} />
                    <InfoRow label="HS-Code (Zolltarif)" value={provenance.hsCode} />
                    <InfoRow
                      label="Menge"
                      value={
                        provenance.volumeM3
                          ? `${provenance.volumeM3} m³`
                          : provenance.pieces
                            ? `${provenance.pieces} Stück`
                            : null
                      }
                    />
                    <InfoRow label="Reifejahr Vermehrungsgut" value={provenance.maturityYear} />
                    <InfoRow label="Fälldatum" value={provenance.fellingDate} />
                    <InfoRow
                      label="Fällkoordinate"
                      value={
                        provenance.fellingCoordinates
                          ? `${provenance.fellingCoordinates.lat.toFixed(5)}° N, ${provenance.fellingCoordinates.lng.toFixed(5)}° E`
                          : null
                      }
                    />
                    <InfoRow label="Land" value={provenance.fellingCountry} />
                    <InfoRow label="Bundesland" value={provenance.fellingState} />
                    <InfoRow label="Käufer" value={provenance.buyerName} />
                    <InfoRow label="Käufer (Anschrift)" value={provenance.buyerAddress} />
                  </motion.dl>
                )}
              </AnimatePresence>
            </motion.section>

            {/* Legende + Karte */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-night-800 border border-white/5 rounded-2xl p-5"
            >
              <div className="flex flex-wrap gap-x-5 gap-y-2 mb-4">
                {(Object.keys(ACTOR_COLORS) as ActorKind[]).map((kind) => (
                  <span key={kind} className="inline-flex items-center gap-2 text-xs text-night-200">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: ACTOR_COLORS[kind] }}
                    />
                    {ACTOR_LABELS[kind]}
                  </span>
                ))}
              </div>

              <ActorLocationMap
                markers={markers}
                selectedId={selectedActorId}
                onSelect={(id) => setSelectedActorId((prev) => (prev === id ? null : id))}
                className="h-[300px]"
              />

              {hasApproximate && (
                <p className="text-[11px] text-night-400 mt-2 leading-relaxed">
                  Standorte ohne hinterlegte Koordinate werden anhand der Adresse
                  angenähert und blasser dargestellt.
                </p>
              )}
            </motion.section>

            {/* Akteure (I-16..I-26) -- dieselbe Liste wie im Bauproduktpass */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <ActorStationList
                actors={resolvedActors}
                selectedId={selectedActorId}
                onSelect={(id) => setSelectedActorId((prev) => (prev === id ? null : id))}
              />
            </motion.section>

            {/* Downloadbereich (geteilt, einklappbar) */}
            <DocumentDownloadSection
              productId={productId}
              productData={productData}
              delay={0.2}
              emptyText="Keine Dokumente zu diesem Produkt verfügbar."
            />

            {/* Zertifizierung (I-15) */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="grid grid-cols-2 gap-3"
            >
              {['FSC', 'PEFC'].map((cert) => {
                const active = hasCert(cert);
                return (
                  <div
                    key={cert}
                    className={`rounded-2xl px-4 py-3 text-center text-sm font-semibold border ${
                      active
                        ? 'bg-acid-400/15 border-acid-400/40 text-acid-300'
                        : 'bg-night-700/50 border-white/5 text-night-400'
                    }`}
                  >
                    <Package className="w-4 h-4 inline-block mr-2 -mt-0.5" />
                    {cert} {active ? '✓' : '–'}
                  </div>
                );
              })}
            </motion.section>
          </div>
        </div>
      </div>
    </>
  );
}
