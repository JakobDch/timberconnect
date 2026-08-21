import { useEffect, useState } from 'react';
import { Download, Loader2, MapPin, Sprout } from 'lucide-react';
import { PlantingAreaMap } from './PlantingAreaMap';
import {
  areaToTracesFeatureCollection,
  ringAreaHectares,
  ringToGeoJson,
} from '../../services/geoService';
import {
  findPlantingAreasForPosition,
  queryPlantingAreaByEpc,
  type PlantingAreaResult,
} from '../../services/sparqlService';
import { getAllProductsAsync } from '../../config/solidPods';
import type { Coordinates } from '../../types';

/**
 * Zeigt den Pflanzvorgang eines Produkts als Flaeche auf der Karte.
 *
 * Zwei Wege, je nachdem was das Produkt hergibt:
 *   * ``epc``      — direkter Bezug: das Stammzertifikat nennt dieses
 *                    Vermehrungsgut (Vorwaertsrichtung).
 *   * ``position`` — GPS-Position aus den Maschinendaten; es wird die
 *                    Pflanzflaeche gesucht, die diesen Punkt einschliesst
 *                    (Rueckwaertsrichtung, der eigentliche Zweck der Flaeche).
 *
 * Findet sich nichts, rendert die Karte gar nicht — ein leerer Kartenrahmen
 * ohne Aussage waere schlechter als kein Abschnitt.
 */

/**
 * Alle bekannten Pod-Quellen aus dem Katalog. Stammzertifikate koennen in
 * einem anderen Pod liegen als das Produkt (Baumschule vs. Saegewerk), daher
 * wird breit gesucht und nicht nur in den Quellen des Produkts.
 */
async function resolveSources(): Promise<string[]> {
  const products = await getAllProductsAsync();
  return Array.from(new Set(products.flatMap((p) => p.sources)));
}

interface PlantingAreaCardProps {
  /** EPC des Materials, falls bekannt. */
  epc?: string | null;
  /** GPS-Position des Produkts (Stamm-/Polterkoordinate). */
  position?: Coordinates | null;
  sources?: string[];
}

export function PlantingAreaCard({ epc, position, sources }: PlantingAreaCardProps) {
  const [areas, setAreas] = useState<PlantingAreaResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const hasPosition =
      position && Number.isFinite(position.lat) && Number.isFinite(position.lng) &&
      (position.lat !== 0 || position.lng !== 0);

    if (!epc && !hasPosition) {
      setAreas([]);
      return;
    }

    setIsLoading(true);
    (async () => {
      try {
        // Ohne explizite Quellen die aus dem Katalog bekannten nehmen. Ein
        // leeres DEFAULT_SOURCES wuerde sonst still nichts finden.
        const effectiveSources =
          sources && sources.length > 0 ? sources : await resolveSources();
        if (effectiveSources.length === 0) {
          if (!cancelled) setAreas([]);
          return;
        }

        // Der EPC-Bezug ist die belastbarere Aussage; die GPS-Suche greift
        // nur, wenn kein Zertifikat direkt auf das Material zeigt.
        let found: PlantingAreaResult[] = [];
        if (epc) {
          found = await queryPlantingAreaByEpc(epc, effectiveSources);
        }
        if (found.length === 0 && hasPosition) {
          found = await findPlantingAreasForPosition(
            { lat: position!.lat, lon: position!.lng },
            effectiveSources,
          );
        }
        if (!cancelled) setAreas(found);
      } catch (err) {
        console.warn('[planting-area] Abfrage fehlgeschlagen:', err);
        if (!cancelled) setAreas([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [epc, position, sources]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-night-300 py-4">
        <Loader2 className="w-4 h-4 animate-spin text-acid-300" />
        Pflanzfläche wird gesucht...
      </div>
    );
  }

  if (areas.length === 0) return null;

  const area = areas[0];
  const hectares = ringAreaHectares(area.ring);

  /**
   * Flaeche als GeoJSON (EPSG:4326) herunterladen -- das Format, das TRACES
   * beim Anlegen einer EUDR-Sorgfaltserklaerung importiert.
   */
  const handleGeoJsonExport = () => {
    const featureCollection = areaToTracesFeatureCollection(area, {
      ...(area.certificateNumber
        ? { ProductionPlace: `Stammzertifikat ${area.certificateNumber}` }
        : {}),
      ...(area.species ? { Baumart: area.species } : {}),
      ...(area.maturityYear ? { Reifejahr: area.maturityYear } : {}),
      ...(area.epc ? { epc: area.epc } : {}),
    });
    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], {
      type: 'application/geo+json',
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `pflanzflaeche-${
      area.certificateNumber?.replace(/[^A-Za-z0-9_-]+/g, '-') ?? 'timberconnect'
    }.geojson`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  };

  return (
    <div className="mt-6">
      <h4 className="font-semibold text-white mb-4 flex items-center gap-2">
        <Sprout className="w-5 h-5 text-acid-300" />
        Pflanzfläche
      </h4>

      <PlantingAreaMap
        value={ringToGeoJson(area.ring)}
        onChange={() => undefined}
        readOnly
        className="h-[260px]"
      />

      <div className="mt-3 space-y-2 text-sm">
        <div className="flex justify-between items-center py-2 border-b border-white/5">
          <span className="text-night-300">Größe</span>
          <span className="font-medium text-white">
            ca. {hectares.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ha
          </span>
        </div>
        {area.certificateNumber && (
          <div className="flex justify-between items-center py-2 border-b border-white/5">
            <span className="text-night-300">Stammzertifikat</span>
            <span className="font-medium text-white">{area.certificateNumber}</span>
          </div>
        )}
        {area.species && (
          <div className="flex justify-between items-center py-2 border-b border-white/5">
            <span className="text-night-300">Baumart</span>
            <span className="font-medium text-white">{area.species}</span>
          </div>
        )}
        {area.centroid && (
          <div className="flex justify-between items-center py-2">
            <span className="text-night-300 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              Mittelpunkt
            </span>
            <span className="font-medium text-white">
              {area.centroid.lat.toFixed(4)}° N, {area.centroid.lon.toFixed(4)}° E
            </span>
          </div>
        )}
        {areas.length > 1 && (
          <p className="text-xs text-night-400 pt-1">
            {areas.length} Pflanzflächen enthalten diese Position — angezeigt wird die erste.
          </p>
        )}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleGeoJsonExport}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-night-700/60 hover:bg-night-700 text-night-200 text-xs font-semibold transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-acid-300" />
            Als GeoJSON exportieren (EUDR/TRACES)
          </button>
          <p className="text-[11px] text-night-400 mt-1.5 text-center">
            EPSG:4326 — direkt in TRACES als Geolokalisierung importierbar
          </p>
        </div>
      </div>
    </div>
  );
}
