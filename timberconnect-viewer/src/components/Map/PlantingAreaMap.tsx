import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Trash2, Undo2 } from 'lucide-react';
import { PlaceSearchBar } from './PlaceSearchBar';
import type { PlaceResult } from '../../services/geocodingService';

/**
 * Karte zum Einzeichnen der Pflanzflaeche.
 *
 * Bedienung bewusst minimal: in die Karte klicken setzt einen Eckpunkt, die
 * Punkte lassen sich ziehen, "Letzten Punkt zurueck" und "Neu zeichnen"
 * korrigieren. Ab drei Punkten entsteht eine Flaeche.
 *
 * Ueber der Karte steht eine Ortssuche. Ohne sie beginnt jedes Einzeichnen bei
 * ganz Deutschland und kostet ein Dutzend Zoomstufen bis zum Bestand -- eine
 * getippte Adresse fuehrt in einem Schritt dorthin.
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
  /**
   * Bereits von anderen Vorgängen belegte Flächen ([lon, lat]-Ringe). Werden
   * gedämpft dargestellt, damit beim Zeichnen sichtbar ist, was schon vergeben
   * ist — die Überschneidung soll gar nicht erst entstehen.
   */
  occupiedRings?: number[][][];
  /**
   * Überschneidungen mit belegten Flächen ([lon, lat]-Ringe). Werden rot
   * hervorgehoben; genau diese Fläche muss der Nutzer aus seinem Polygon
   * herausnehmen.
   */
  conflictRings?: number[][][];
}

// Deutschland-Mitte; Zoom zeigt das ganze Land.
const GERMANY_CENTER: L.LatLngTuple = [51.16, 10.45];
const GERMANY_ZOOM = 6;

/**
 * Obergrenze beim Sprung zu einem Suchtreffer.
 *
 * Nominatim liefert fuer eine Hausnummer eine wenige Meter grosse Box; ohne
 * Deckel landete man auf Zoom 19 und saehe ein Dach. Zum Einzeichnen eines
 * Waldstuecks braucht es Umgebung, an der man sich orientieren kann.
 */
const MAX_PLACE_ZOOM = 16;

/** Zoom fuer Treffer ohne Bounding-Box -- Ortsgroesse. */
const PLACE_FALLBACK_ZOOM = 14;

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
  occupiedRings,
  conflictRings,
}: PlantingAreaMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polygonRef = useRef<L.Polygon | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const pointsRef = useRef<L.LatLng[]>([]);
  /** Ebenen der fremden und der konfliktbehafteten Flaechen. */
  const occupiedLayersRef = useRef<L.Polygon[]>([]);
  const conflictLayersRef = useRef<L.Polygon[]>([]);
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
      // Die Ebenen gehoerten zur entfernten Karte; die Refs muessen mit, sonst
      // versucht der naechste Durchlauf, tote Layer abzuraeumen.
      occupiedLayersRef.current = [];
      conflictLayersRef.current = [];
    };
  }, [readOnly]);

  // Belegte Flaechen anderer Vorgaenge: gedaempft, im Hintergrund.
  //
  // Sie werden gezeigt, BEVOR der Nutzer zeichnet -- eine Sperre erst beim
  // Absenden waere die schlechtere Reihenfolge: Er haette die Flaeche dann
  // schon fertig eingezeichnet und muesste sie wieder aufloesen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    occupiedLayersRef.current.forEach((layer) => map.removeLayer(layer));
    occupiedLayersRef.current = [];

    for (const ring of occupiedRings ?? []) {
      const latLngs = ring.map((c) => L.latLng(c[1], c[0]));
      if (latLngs.length < 3) continue;
      const layer = L.polygon(latLngs, {
        color: '#94A3B8',
        weight: 1,
        dashArray: '4 3',
        fillColor: '#94A3B8',
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map);
      occupiedLayersRef.current.push(layer);
    }
  }, [occupiedRings]);

  // Konfliktflaechen: rot, deutlich, ueber allem anderen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    conflictLayersRef.current.forEach((layer) => map.removeLayer(layer));
    conflictLayersRef.current = [];

    for (const ring of conflictRings ?? []) {
      const latLngs = ring.map((c) => L.latLng(c[1], c[0]));
      if (latLngs.length < 3) continue;
      const layer = L.polygon(latLngs, {
        color: '#F87171',
        weight: 2,
        fillColor: '#F87171',
        fillOpacity: 0.45,
        interactive: false,
      }).addTo(map);
      layer.bringToFront();
      conflictLayersRef.current.push(layer);
    }
  }, [conflictRings]);

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

  /**
   * Zu einem Suchtreffer springen.
   *
   * Der Zoom kommt aus der Bounding-Box, wird aber gedeckelt: Nominatim
   * liefert fuer eine Hausnummer eine winzige Box, und ein Sprung auf Zoom 19
   * zeigt ein Dach statt einer Landschaft. Zum Einzeichnen eines Bestands
   * braucht es Umgebung -- Waldrand, Weg, Schneise --, sonst weiss man nicht,
   * wo man ist. MAX_PLACE_ZOOM liegt deshalb bei 16.
   *
   * Die gezeichneten Punkte bleiben unberuehrt: Wer nach dem ersten Eckpunkt
   * noch einmal sucht, will sich orientieren, nicht von vorn anfangen.
   */
  const handlePlaceSelect = useCallback((place: PlaceResult) => {
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
    // Ohne Box bleibt nur der Mittelpunkt; ein Ortszoom ist dann die
    // ehrlichste Annaeherung.
    map.setView(L.latLng(place.center.lat, place.center.lng), PLACE_FALLBACK_ZOOM);
  }, []);

  const handleUndo = () => {
    pointsRef.current = pointsRef.current.slice(0, -1);
    redraw();
    emit();
  };

  const handleClear = () => {
    pointsRef.current = [];
    redraw();
    emit();
    // Der Kartenausschnitt bleibt, wo er ist. Frueher sprang die Karte hier
    // auf Deutschland zurueck -- wer sich verzeichnet hatte, verlor damit auch
    // den gesuchten Ort und musste ihn erneut ansteuern. "Neu zeichnen" meint
    // die Punkte, nicht die Ansicht.
  };

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      {/* Ortssuche ueber der Karte -- der Einstieg, bevor gezeichnet wird.
          Steht ausserhalb des Karten-Containers, damit die Trefferliste nicht
          mit den Leaflet-Panes um die Stapelreihenfolge streitet. */}
      {!readOnly && (
        <div className="mb-3">
          <PlaceSearchBar onSelect={handlePlaceSelect} />
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 min-h-[260px] rounded-xl overflow-hidden border border-white/10 z-0"
        // Leaflet-Panes liegen sonst ueber dem Sheet-Rand
        style={{ isolation: 'isolate' }}
      />

      {/* Legende — nur wenn es fremde Flaechen gibt, sonst waere sie Ballast. */}
      {!readOnly && (occupiedRings?.length || conflictRings?.length) ? (
        <div className="flex items-center gap-4 mt-2.5 text-[11px] text-night-300 flex-wrap">
          {occupiedRings && occupiedRings.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span
                className="w-3 h-3 rounded-sm border border-dashed flex-shrink-0"
                style={{ borderColor: '#94A3B8', background: 'rgba(148,163,184,0.15)' }}
              />
              Bereits vergeben
            </span>
          )}
          {conflictRings && conflictRings.length > 0 && (
            <span className="flex items-center gap-1.5 text-red-300">
              <span
                className="w-3 h-3 rounded-sm flex-shrink-0"
                style={{ background: 'rgba(248,113,113,0.5)', border: '1px solid #F87171' }}
              />
              Überschneidung — bitte herausnehmen
            </span>
          )}
        </div>
      ) : null}

      {!readOnly && (
        <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-night-300">
            <MapPin className="w-4 h-4 text-acid-300 flex-shrink-0" />
            {pointCount < 3 ? (
              <span>
                {pointCount === 0
                  ? 'Ort suchen, dann in die Karte klicken'
                  : `Fläche einzeichnen — noch ${3 - pointCount} Punkt${
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
