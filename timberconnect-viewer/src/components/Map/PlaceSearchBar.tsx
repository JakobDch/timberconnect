import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { searchPlaces, type PlaceResult } from '../../services/geocodingService';

/**
 * Ortssuche ueber der Karte.
 *
 * Der Grund: Die Karte startet auf ganz Deutschland. Bis man von dort per Maus
 * bis auf einen Forstort im Sauerland gezoomt hat, vergehen ein Dutzend
 * Zoomstufen -- und das vor JEDEM Einzeichnen. Eine Adresse zu tippen ist der
 * kuerzere Weg zum selben Ziel.
 *
 * Getippt wird frei: Ort, Adresse, Gemarkung, auch "Arnsberger Wald". Weil die
 * Eingabe mehrdeutig sein kann, zeigt die Suche eine Trefferliste statt
 * ungefragt zum ersten Ergebnis zu springen.
 *
 * Nominatim erlaubt eine Anfrage pro Sekunde. Deshalb wird NICHT bei jedem
 * Tastendruck gesucht, sondern erst nach einer Tipppause (oder auf Enter) --
 * sonst waere die Suche nach wenigen Zeichen gedrosselt und liefe ins Leere.
 */

/** Tipppause, nach der automatisch gesucht wird. */
const DEBOUNCE_MS = 600;

interface PlaceSearchBarProps {
  /** Ein Treffer wurde gewaehlt — die Karte springt dorthin. */
  onSelect: (place: PlaceResult) => void;
  disabled?: boolean;
}

export function PlaceSearchBar({ onSelect, disabled = false }: PlaceSearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);
  /**
   * Laufende Nummer der Anfrage. Antworten koennen sich ueberholen -- ohne
   * diese Pruefung wuerde ein spaeter eintreffendes Ergebnis zu einer aelteren
   * Eingabe die aktuelle Trefferliste ueberschreiben.
   */
  const requestId = useRef(0);

  const run = async (term: string) => {
    const id = ++requestId.current;
    if (term.trim().length < 3) {
      setResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const found = await searchPlaces(term);
    if (id !== requestId.current) return; // ueberholt
    setResults(found);
    setHasSearched(true);
    setIsSearching(false);
    setIsOpen(true);
  };

  // Nach der Tipppause suchen.
  useEffect(() => {
    if (query.trim().length < 3) {
      requestId.current++;
      setResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }
    const timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `run` ist bewusst nicht in den Abhaengigkeiten: die Funktion wird bei
    // jedem Render neu erzeugt und wuerde den Timer sofort neu aufsetzen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Klick ausserhalb schliesst die Trefferliste.
  useEffect(() => {
    if (!isOpen) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [isOpen]);

  const handleSelect = (place: PlaceResult) => {
    onSelect(place);
    // Der gewaehlte Ort bleibt im Feld stehen: er ist die Antwort auf die
    // Frage "wo bin ich gerade?", die sich beim Zeichnen sofort stellt.
    setQuery(place.label);
    setIsOpen(false);
    requestId.current++; // die stehengebliebene Eingabe nicht neu suchen
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-night-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void run(query); // nicht auf die Tipppause warten
            }
            if (e.key === 'Escape') setIsOpen(false);
          }}
          disabled={disabled}
          placeholder="Ort oder Adresse suchen, z. B. Arnsberger Wald"
          className="w-full pl-9 pr-9 py-2.5 bg-night-900 border border-white/10 rounded-xl text-white text-sm placeholder:text-night-400 focus:outline-none focus:border-acid-400/60 focus:ring-4 focus:ring-acid-400/10 disabled:opacity-50"
        />
        {isSearching ? (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-acid-300 animate-spin" />
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setResults([]);
              setHasSearched(false);
              setIsOpen(false);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-night-400 hover:text-white transition-colors"
            aria-label="Suche leeren"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      {/* Trefferliste. z-Index ueber den Leaflet-Panes (die liegen bei 400). */}
      {isOpen && hasSearched && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-[500] rounded-xl border border-white/10 bg-night-800 shadow-2xl shadow-black/50 overflow-hidden">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-xs text-night-300">
              Nichts gefunden. Versuchen Sie einen größeren Ort in der Nähe —
              die Fläche zeichnen Sie danach von Hand.
            </p>
          ) : (
            <ul className="max-h-56 overflow-y-auto">
              {results.map((place, index) => (
                <li key={`${place.label}-${index}`}>
                  <button
                    type="button"
                    onClick={() => handleSelect(place)}
                    className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0"
                  >
                    <MapPin className="w-3.5 h-3.5 text-acid-300 flex-shrink-0 mt-0.5" />
                    <span className="text-xs text-night-100 leading-snug">
                      {place.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
