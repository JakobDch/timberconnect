import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { PlaceSearchBar } from './PlaceSearchBar';
import type { PlaceResult } from '../../services/geocodingService';

/**
 * Karte zum Setzen EINES Punktes — das Gegenstueck zu PlantingAreaMap.
 *
 * Dort wird eine Flaeche gezeichnet (Upload), hier wird ein Standort gewaehlt
 * (Suche). Bewusst eine eigene Komponente: PlantingAreaMap fuehrt Eckpunkt-
 * listen, Ziehmarker, Rueckgaengig und Flaechenberechnung — davon braucht die
 * Standortwahl nichts, und ein readOnly-Sonderweg mehr in jener Komponente
 * haette ihre Zeichenlogik mit einem zweiten Zweck vermischt.
 *
 * Die bekannten Pflanzflaechen liegen als Hintergrund darunter. Das ist keine
 * Zierde: Ohne sie klickt der Nutzer in eine graue Karte und erfaehrt erst
 * danach, dass dort nichts liegt. Mit ihnen sieht er, wohin er zielen muss.
 */

/** Eine anzeigbare Flaeche im Hintergrund. */
export interface AreaOutline {
  /** Ring als [lon, lat] (CRS84). */
  ring: number[][];
  /** Hervorgehoben darstellen (= der Punkt liegt darin). */
  highlighted?: boolean;
}

interface LocationPickMapProps {
  /** Gewaehlter Punkt in WGS84, oder null. */
  value: { lat: number; lon: number } | null;
  onChange: (value: { lat: number; lon: number }) => void;
  /** Bekannte Pflanzflaechen als Orientierung. */
  areas?: AreaOutline[];
  /** Genauigkeitsradius der GPS-Ortung in Metern. */
  accuracy?: number | null;
  className?: string;
}

const GERMANY_CENTER: L.LatLngTuple = [51.16, 10.45];
const GERMANY_ZOOM = 6;
const MAX_PLACE_ZOOM = 16;
const PLACE_FALLBACK_ZOOM = 14;

/** Zoomstufe, auf die ein gesetzter Punkt herangeholt wird. */
const POINT_ZOOM = 15;

const ACID = '#DFE94B';

/** Standortnadel in der Akzentfarbe. */
function pinIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:16px;height:16px;border-radius:9999px;background:${ACID};border:3px solid #0F1A24;box-shadow:0 0 0 2px ${ACID},0 0 12px rgba(223,233,75,0.6)"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export function LocationPickMap({
  value,
  onChange,
  areas,
  accuracy = null,
  className = '',
}: LocationPickMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const areaLayersRef = useRef<L.Polygon[]>([]);

  // Wie in PlantingAreaMap: onChange kommt als Inline-Funktion herein und
  // wechselt bei jedem Render die Identitaet. Ueber die Ref bleibt der
  // Karten-Effekt stabil, sonst baute sich die Karte bei jedem Klick neu auf.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  /**
   * Springt zum Treffer der Ortssuche.
   *
   * Der gewaehlte Punkt bleibt unberuehrt: Wer nach dem Setzen noch einmal
   * sucht, will sich orientieren, nicht seine Auswahl verlieren.
   */
  const handlePlace = useCallback((place: PlaceResult) => {
    const map = mapRef.current;
    if (!map) return;

    if (place.bbox) {
      const [south, north, west, east] = place.bbox;
      map.fitBounds(
        L.latLngBounds(L.latLng(south, west), L.latLng(north, east)),
        { maxZoom: MAX_PLACE_ZOOM },
      );
      return;
    }
    map.setView(L.latLng(place.center.lat, place.center.lng), PLACE_FALLBACK_ZOOM);
  }, []);

  // Karte einmalig aufbauen
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: GERMANY_CENTER,
      zoom: GERMANY_ZOOM,
      attributionControl: true,
      scrollWheelZoom: true,
      dragging: true,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    mapRef.current = map;

    map.on('click', (e: L.LeafletMouseEvent) => {
      onChangeRef.current({ lat: e.latlng.lat, lon: e.latlng.lng });
    });

    // Die Karte steckt in einem Sheet, das erst eingeblendet wird — ohne das
    // Nachziehen bliebe sie auf die Groesse zum Zeitpunkt des Aufbaus fixiert
    // und zeigte graue Kacheln.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      accuracyRef.current = null;
      areaLayersRef.current = [];
    };
  }, []);

  // Bekannte Flaechen zeichnen. Treffer heben sich ab.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    areaLayersRef.current.forEach((layer) => map.removeLayer(layer));
    areaLayersRef.current = [];

    for (const area of areas ?? []) {
      const latLngs = area.ring.map((c) => L.latLng(c[1], c[0]));
      if (latLngs.length < 3) continue;
      const layer = L.polygon(
        latLngs,
        area.highlighted
          ? { color: ACID, weight: 2, fillColor: ACID, fillOpacity: 0.28 }
          : {
              color: '#94A3B8',
              weight: 1,
              dashArray: '4 3',
              fillColor: '#94A3B8',
              fillOpacity: 0.12,
            },
      ).addTo(map);
      layer.on('click', (e: L.LeafletMouseEvent) => {
        // Ein Klick auf die Flaeche soll den Punkt setzen wie ein Klick
        // daneben — sonst waere ausgerechnet das Ziel der Suche der einzige
        // Fleck der Karte, der nicht reagiert.
        onChangeRef.current({ lat: e.latlng.lat, lon: e.latlng.lng });
      });
      areaLayersRef.current.push(layer);
      if (area.highlighted) layer.bringToFront();
    }
  }, [areas]);

  // Gewaehlten Punkt anzeigen und heranholen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!value) {
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
      if (accuracyRef.current) {
        map.removeLayer(accuracyRef.current);
        accuracyRef.current = null;
      }
      return;
    }

    const latLng = L.latLng(value.lat, value.lon);
    if (markerRef.current) {
      markerRef.current.setLatLng(latLng);
    } else {
      markerRef.current = L.marker(latLng, {
        icon: pinIcon(),
        interactive: false,
      }).addTo(map);
    }

    // Genauigkeitskreis der GPS-Ortung. Er macht sichtbar, wenn die Ortung zu
    // grob fuer eine Zuordnung ist — ein Radius, der halb ueber die Flaeche
    // hinausragt, erklaert ein "nicht gefunden" von selbst.
    if (accuracyRef.current) {
      map.removeLayer(accuracyRef.current);
      accuracyRef.current = null;
    }
    if (accuracy && accuracy > 0) {
      accuracyRef.current = L.circle(latLng, {
        radius: accuracy,
        color: ACID,
        weight: 1,
        fillColor: ACID,
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(map);
    }

    // Nur heranholen, wenn der Punkt ausserhalb des Sichtfelds liegt oder die
    // Karte noch auf Deutschland steht. Bei jedem Klick zu zoomen waere
    // gegen den Nutzer, der gerade seine Auswahl korrigiert.
    if (map.getZoom() < 10 || !map.getBounds().contains(latLng)) {
      map.setView(latLng, Math.max(map.getZoom(), POINT_ZOOM));
    }
  }, [value, accuracy]);

  return (
    <div className={className}>
      <PlaceSearchBar onSelect={handlePlace} />
      <div
        ref={containerRef}
        className="w-full h-64 sm:h-80 rounded-2xl overflow-hidden border border-white/10 mt-3"
      />
      <p className="text-xs text-night-400 mt-2">
        In die Karte tippen, um den Standort zu setzen. Bekannte Pflanzflächen
        sind grau umrandet.
      </p>
    </div>
  );
}
