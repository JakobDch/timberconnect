import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinates } from '../../types';
import type { ActorKind } from '../../services/provenanceMapper';
import { ACTOR_COLORS } from './actorStyles';

/**
 * Karte mit den Standorten der Lieferkette (Herkunftsnachweis).
 *
 * Bewusst eine eigene Komponente neben PlantingAreaMap: jene ist ein
 * Polygon-Editor, dessen gesamte Komplexitaet (Punktlisten, Redraw, Emit) dem
 * Zeichnen dient. Eine reine Marker-Anzeige teilt davon nichts -- ein zweiter
 * Modus dort haette Produktpass und PDF-Transfer ohne Gegenwert gefaehrdet.
 * Geteilt sind nur Tile-Layer und ResizeObserver, rund 15 Zeilen.
 *
 * Auswahl laeuft in beide Richtungen: Klick auf einen Marker meldet nach oben,
 * ein Wechsel von selectedId zentriert und hebt den Marker hervor.
 */

export interface ActorMarker {
  id: string;
  kind: ActorKind;
  label: string;
  position: Coordinates;
  /** Genaeherte Standorte (aus der Adresse geocodiert) werden blasser
      gezeichnet -- die Ungenauigkeit soll sichtbar sein, nicht kaschiert. */
  approximate?: boolean;
}

interface ActorLocationMapProps {
  markers: ActorMarker[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
}

// Deutschland-Mitte; Zoom zeigt das ganze Land (wie in PlantingAreaMap).
const GERMANY_CENTER: L.LatLngTuple = [51.16, 10.45];
const GERMANY_ZOOM = 6;
/** Zoomstufe fuer einen einzelnen gewaehlten Akteur -- Ort mit Umfeld. */
const ACTOR_ZOOM = 12;

/** Gesamtsicht: alle Marker im Bild. Geteilt von Marker-Aufbau und Abwahl. */
function fitToMarkers(map: L.Map, markers: ActorMarker[]): void {
  if (markers.length === 0) {
    map.setView(GERMANY_CENTER, GERMANY_ZOOM);
  } else if (markers.length === 1) {
    map.setView([markers[0].position.lat, markers[0].position.lng], 11);
  } else {
    const bounds = L.latLngBounds(
      markers.map((m) => [m.position.lat, m.position.lng] as L.LatLngTuple),
    );
    map.fitBounds(bounds.pad(0.3));
  }
}

/** Tropfen-Marker in der Akteursfarbe. */
function pinIcon(color: string, selected: boolean, approximate: boolean): L.DivIcon {
  const size = selected ? 38 : 30;
  const opacity = approximate ? 0.65 : 1;
  const ring = selected ? '<circle cx="12" cy="9" r="3.4" fill="#FFFFFF"/>' : '';

  return L.divIcon({
    className: '',
    html: `<span style="display:block;opacity:${opacity};filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))">
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
        <path d="M12 23s8-7.2 8-13a8 8 0 1 0-16 0c0 5.8 8 13 8 13z"
              fill="${color}" stroke="${selected ? '#FFFFFF' : 'rgba(0,0,0,.35)'}" stroke-width="${selected ? 1.6 : 1}"/>
        ${ring || '<circle cx="12" cy="9" r="2.8" fill="rgba(0,0,0,.35)"/>'}
      </svg></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
  });
}

export function ActorLocationMap({
  markers,
  selectedId,
  onSelect,
  className = '',
}: ActorLocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<Map<string, L.Marker>>(new Map());

  // onSelect wechselt als Inline-Funktion bei jedem Render die Identitaet.
  // Ueber die Ref bleibt der Karten-Effekt stabil, sonst baute sich die Karte
  // bei jeder Auswahl komplett neu auf.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Die aktuelle Auswahl auch als Ref: der Marker-Effekt muss sie lesen, darf
  // aber nicht auf sie reagieren -- sonst baute jede Auswahl alle Marker neu
  // auf und die Tooltips flackerten.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // Karte einmalig aufbauen.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: GERMANY_CENTER,
      zoom: GERMANY_ZOOM,
      zoomControl: true,
      attributionControl: true,
      // Auf Mobil sonst schwer zu scrollen: Zoom per Pinch/Buttons genuegt.
      scrollWheelZoom: false,
      dragging: true,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    mapRef.current = map;

    // Groesse nachziehen, wenn der Container erst spaeter sichtbar wird.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);

    // Ref-Inhalt hier festhalten: beim Aufraeumen kann layersRef.current
    // laengst auf eine andere Map zeigen.
    const layers = layersRef.current;

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layers.clear();
    };
  }, []);

  // Marker setzen und Ausschnitt anpassen, wenn sich die Standorte aendern.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    layersRef.current.forEach((marker) => map.removeLayer(marker));
    layersRef.current.clear();

    for (const entry of markers) {
      const marker = L.marker([entry.position.lat, entry.position.lng], {
        icon: pinIcon(ACTOR_COLORS[entry.kind], false, !!entry.approximate),
        title: entry.label,
      }).addTo(map);
      marker.bindTooltip(entry.label, { direction: 'top', offset: [0, -28] });
      marker.on('click', () => onSelectRef.current(entry.id));
      layersRef.current.set(entry.id, marker);
    }

    // Nur ohne Auswahl auf die Gesamtsicht springen. Die Marker treffen
    // nacheinander ein (jede Geocodierung braucht ihre Sekunde) -- ein
    // Neuzeichnen waehrend einer aktiven Auswahl wuerde den Ausschnitt sonst
    // vom gewaehlten Akteur wegziehen. Das Zentrieren uebernimmt in dem Fall
    // der Auswahl-Effekt unten.
    if (!selectedIdRef.current) {
      fitToMarkers(map, markers);
    }
  }, [markers]);

  // Hervorhebung + Zentrierung bei Auswahl (Liste -> Karte).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const entry of markers) {
      const marker = layersRef.current.get(entry.id);
      if (!marker) continue;
      const selected = entry.id === selectedId;
      marker.setIcon(pinIcon(ACTOR_COLORS[entry.kind], selected, !!entry.approximate));
      marker.setZIndexOffset(selected ? 1000 : 0);
    }

    const active = markers.find((m) => m.id === selectedId);
    if (active) {
      // Heranzoomen, nicht nur schwenken: der Ausschnitt zeigt vorher alle
      // Akteure, in dieser Weite liegen zwei Standorte oft nur Pixel
      // auseinander. Ein reines panTo sieht dann aus, als reagiere die Karte
      // nicht auf den Klick. Nur hineinzoomen, nie hinaus -- wer selbst naeher
      // herangegangen ist, soll nicht zurueckgeworfen werden.
      map.flyTo([active.position.lat, active.position.lng], Math.max(map.getZoom(), ACTOR_ZOOM), {
        duration: 0.6,
      });
      layersRef.current.get(active.id)?.openTooltip();
    } else {
      // Abwahl: zurueck auf die Gesamtsicht, sonst bliebe die Karte im
      // Detailausschnitt des zuletzt gewaehlten Akteurs stehen.
      fitToMarkers(map, markers);
    }
  }, [selectedId, markers]);

  return (
    <div className={`relative ${className}`}>
      {/* isolate: haelt die Leaflet-Panes aus dem z-index-Stapel der Sheets */}
      <div
        ref={containerRef}
        className="w-full h-full rounded-xl overflow-hidden border border-white/10"
        style={{ isolation: 'isolate' }}
      />
      {markers.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-night-900/70 pointer-events-none">
          <p className="text-sm text-night-300 px-4 text-center">
            Keine Standorte verfügbar
          </p>
        </div>
      )}
    </div>
  );
}
