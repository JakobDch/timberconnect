import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Trash2, Undo2 } from 'lucide-react';

/**
 * Karte zum Einzeichnen der Pflanzflaeche.
 *
 * Bedienung bewusst minimal: in die Karte klicken setzt einen Eckpunkt, die
 * Punkte lassen sich ziehen, "Letzten Punkt zurueck" und "Neu zeichnen"
 * korrigieren. Ab drei Punkten entsteht eine Flaeche.
 *
 * Ausgabe ist GeoJSON in CRS84-Achsenreihenfolge ([lon, lat]) -- genau das,
 * was der Extraktor im Converter erwartet (pdf_template_service._polygon_ring),
 * der daraus GeoSPARQL-WKT und den Zentroid ableitet.
 */

/** GeoJSON-Polygon, wie es der Converter entgegennimmt. */
export interface PolygonGeoJson {
  type: 'Polygon';
  /** Ringe als [lon, lat]; Ring 0 ist der aeussere, geschlossen. */
  coordinates: number[][][];
}

interface PlantingAreaMapProps {
  value: PolygonGeoJson | null;
  onChange: (value: PolygonGeoJson | null, areaHectares: number) => void;
  /** Nur anzeigen, nicht bearbeiten (z.B. im Produktpass). */
  readOnly?: boolean;
  className?: string;
}

// Deutschland-Mitte; Zoom zeigt das ganze Land.
const GERMANY_CENTER: L.LatLngTuple = [51.16, 10.45];
const GERMANY_ZOOM = 6;

const ACID = '#DFE94B';

/**
 * Flaeche eines Polygons in Hektar (sphaerischer Exzess auf der Erdkugel).
 * Genau genug fuer eine Plausibilitaetsanzeige beim Zeichnen.
 */
export function polygonAreaHectares(latLngs: L.LatLng[]): number {
  if (latLngs.length < 3) return 0;
  const R = 6378137; // Erdradius in Metern
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < latLngs.length; i++) {
    const p1 = latLngs[i];
    const p2 = latLngs[(i + 1) % latLngs.length];
    total +=
      (p2.lng - p1.lng) * rad *
      (2 + Math.sin(p1.lat * rad) + Math.sin(p2.lat * rad));
  }
  const areaM2 = Math.abs((total * R * R) / 2);
  return areaM2 / 10_000;
}

/** Eckpunkt-Marker: kleiner Kreis in der Akzentfarbe. */
function vertexIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:12px;height:12px;border-radius:9999px;background:${ACID};border:2px solid #0F1A24;box-shadow:0 0 0 1px ${ACID}"></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

export function PlantingAreaMap({
  value,
  onChange,
  readOnly = false,
  className = '',
}: PlantingAreaMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polygonRef = useRef<L.Polygon | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const pointsRef = useRef<L.LatLng[]>([]);
  const [pointCount, setPointCount] = useState(0);
  const [areaHa, setAreaHa] = useState(0);

  // onChange kommt als Inline-Funktion herein und wechselt bei jedem Render
  // die Identitaet. Ueber die Ref bleibt emit/redraw stabil -- sonst wuerde
  // der Karten-Effekt bei jedem Klick aufraeumen und die Karte samt Polygon
  // neu aufbauen.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  /** Punkte -> GeoJSON nach oben melden. */
  const emit = useCallback(() => {
    const points = pointsRef.current;
    const area = polygonAreaHectares(points);
    setPointCount(points.length);
    setAreaHa(area);
    if (points.length < 3) {
      onChangeRef.current(null, 0);
      return;
    }
    const ring = points.map((p) => [
      Number(p.lng.toFixed(6)),
      Number(p.lat.toFixed(6)),
    ]);
    ring.push([...ring[0]]); // GeoJSON-Ringe sind geschlossen
    onChangeRef.current({ type: 'Polygon', coordinates: [ring] }, area);
  }, []);

  /** Polygon + Marker aus pointsRef neu zeichnen. */
  const redraw = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const points = pointsRef.current;

    if (polygonRef.current) {
      map.removeLayer(polygonRef.current);
      polygonRef.current = null;
    }
    if (points.length >= 2) {
      polygonRef.current = L.polygon(points, {
        color: ACID,
        weight: 2,
        fillColor: ACID,
        fillOpacity: 0.2,
      }).addTo(map);
    }

    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];
    if (readOnly) return;

    points.forEach((point, index) => {
      const marker = L.marker(point, {
        icon: vertexIcon(),
        draggable: true,
        keyboard: false,
      }).addTo(map);
      marker.on('drag', () => {
        pointsRef.current[index] = marker.getLatLng();
        if (polygonRef.current) polygonRef.current.setLatLngs(pointsRef.current);
      });
      marker.on('dragend', () => {
        pointsRef.current[index] = marker.getLatLng();
        redraw();
        emit();
      });
      markersRef.current.push(marker);
    });
  }, [emit, readOnly]);

  // Auch redraw/emit ueber Refs, damit der Karten-Effekt unten NUR von
  // readOnly abhaengt und die Karte nicht bei jedem Klick neu entsteht.
  const emitRef = useRef(emit);
  const redrawRef = useRef(redraw);
  useEffect(() => {
    emitRef.current = emit;
    redrawRef.current = redraw;
  }, [emit, redraw]);

  // Karte einmalig aufbauen
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: GERMANY_CENTER,
      zoom: GERMANY_ZOOM,
      zoomControl: !readOnly,
      attributionControl: true,
      // Auf Mobil sonst schwer zu scrollen: Zoom per Pinch/Buttons genuegt.
      scrollWheelZoom: !readOnly,
      dragging: true,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    mapRef.current = map;

    if (!readOnly) {
      map.on('click', (e: L.LeafletMouseEvent) => {
        pointsRef.current = [...pointsRef.current, e.latlng];
        redrawRef.current();
        emitRef.current();
      });
    }

    // Groesse nachziehen, wenn der Container erst spaeter sichtbar wird
    // (die Karte steckt in einem Sheet, das eingeblendet wird).
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      polygonRef.current = null;
      markersRef.current = [];
      pointsRef.current = [];
    };
  }, [readOnly]);

  // Von aussen gesetzten Wert uebernehmen (Anzeige im Produktpass, oder
  // Wiedereintritt in den Schritt mit bereits gezeichneter Flaeche).
  //
  // WICHTIG: nur echte Fremdaenderungen uebernehmen. Waehrend des Zeichnens
  // meldet emit() den Wert selbst nach oben und bekommt ihn als Prop zurueck;
  // wuerde dieser Effekt darauf reagieren, loeschte er unfertige Zeichnungen
  // (bei 1-2 Punkten ist value bewusst null) und zoomte bei jedem Klick neu.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const ring = value?.coordinates?.[0] ?? [];
    const incoming = ring.map((c) => L.latLng(c[1], c[0]));
    if (
      incoming.length > 1 &&
      incoming[0].equals(incoming[incoming.length - 1])
    ) {
      incoming.pop(); // geschlossenen Ring nicht doppelt fuehren
    }

    // Nichts von aussen: waehrend des Zeichnens normal -- nicht anfassen.
    if (incoming.length === 0) return;

    const same =
      incoming.length === pointsRef.current.length &&
      incoming.every((p, i) => p.equals(pointsRef.current[i]));
    if (same) return;

    pointsRef.current = incoming;
    setPointCount(incoming.length);
    setAreaHa(polygonAreaHectares(incoming));
    redrawRef.current();
    map.fitBounds(L.latLngBounds(incoming).pad(0.25));
  }, [value]);

  const handleUndo = () => {
    pointsRef.current = pointsRef.current.slice(0, -1);
    redraw();
    emit();
  };

  const handleClear = () => {
    pointsRef.current = [];
    redraw();
    emit();
    mapRef.current?.setView(GERMANY_CENTER, GERMANY_ZOOM);
  };

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      <div
        ref={containerRef}
        className="flex-1 min-h-[260px] rounded-xl overflow-hidden border border-white/10 z-0"
        // Leaflet-Panes liegen sonst ueber dem Sheet-Rand
        style={{ isolation: 'isolate' }}
      />

      {!readOnly && (
        <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-night-300">
            <MapPin className="w-4 h-4 text-acid-300 flex-shrink-0" />
            {pointCount < 3 ? (
              <span>
                In die Karte klicken, um die Fläche einzuzeichnen
                {pointCount > 0 && ` — noch ${3 - pointCount} Punkt${
                  3 - pointCount === 1 ? '' : 'e'
                } nötig`}
              </span>
            ) : (
              <span>
                <span className="font-semibold text-white">{pointCount} Punkte</span>
                {' — ca. '}
                <span className="font-semibold text-acid-300">
                  {areaHa.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ha
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUndo}
              disabled={pointCount === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-night-700/60 hover:bg-night-700 disabled:opacity-40 disabled:hover:bg-night-700/60 text-night-200 text-xs font-semibold transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
              Punkt zurück
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={pointCount === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-night-700/60 hover:bg-night-700 disabled:opacity-40 disabled:hover:bg-night-700/60 text-night-200 text-xs font-semibold transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Neu zeichnen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
