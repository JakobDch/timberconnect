import { Building2, Factory, TreePine } from 'lucide-react';
import type { ActorKind, ProvenanceActor } from '../../services/provenanceMapper';
import { ACTOR_COLORS, ACTOR_LABELS } from '../Map';

/**
 * Die Stationen der Lieferkette als Liste: Wald, Saegewerk,
 * Holzwerkstoffproduzent -- je Station Name, Anschrift, Belegnummer und
 * Transportdatum. Mehr nicht.
 *
 * Geteilt zwischen Herkunftsnachweis und Bauproduktpass (Anmerkung des
 * Projektpartners, 17.09.2026): der Pass zeigte die Lieferkette bis dahin als
 * eigene Zeitachse mit Produktdaten je Station -- Polter-Nr., Volumen,
 * Auftragsnummer, Konstruktionsnummer -- und die standen ohnehin schon in
 * den Kategorien darueber. Verlangt war "nur die Stationen, wie im
 * Herkunftsnachweis". Eine gemeinsame Komponente stellt sicher, dass beide
 * Ansichten dieselben Akteure mit denselben Rollen zeigen; vorher trug
 * dieselbe Firma im Pass das Etikett "Verarbeitung", im Herkunftsnachweis
 * "Holzwerkstoffproduzent".
 *
 * Die Auswahl (selectedId/onSelect) ist optional: der Herkunftsnachweis
 * koppelt sie an die Karte, der Pass hat keine Karte und laesst sie weg.
 */

const ACTOR_ICONS: Record<ActorKind, typeof TreePine> = {
  forest: TreePine,
  sawmill: Factory,
  manufacturer: Building2,
};

interface ActorStationListProps {
  actors: ProvenanceActor[];
  /** Hervorgehobene Station; undefined = keine Auswahl moeglich. */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Text, wenn keine Station belegt ist. */
  emptyText?: string;
}

export function ActorStationList({
  actors,
  selectedId = null,
  onSelect,
  emptyText = 'Keine Akteursdaten in den verfügbaren Quellen gefunden.',
}: ActorStationListProps) {
  if (actors.length === 0) {
    return (
      <div className="bg-night-800 border border-white/5 rounded-2xl p-5">
        <p className="text-sm text-night-400 italic">{emptyText}</p>
      </div>
    );
  }

  const selectable = typeof onSelect === 'function';

  return (
    <ul className="space-y-2">
      {actors.map((actor) => {
        const Icon = ACTOR_ICONS[actor.kind];
        const color = ACTOR_COLORS[actor.kind];
        const selected = selectable && selectedId === actor.id;
        // Ohne Auswahl ein <div> statt eines Buttons: ein Knopf, der nichts
        // tut, verspricht dem Nutzer eine Reaktion, die nie kommt.
        const Tag = selectable ? 'button' : 'div';

        return (
          <li key={actor.id}>
            <Tag
              onClick={selectable ? () => onSelect(actor.id) : undefined}
              className={`w-full text-left flex items-center gap-3 bg-night-800 border rounded-2xl p-4 transition-colors ${
                selected
                  ? 'border-transparent ring-1'
                  : selectable
                    ? 'border-white/5 hover:border-white/15'
                    : 'border-white/5'
              }`}
              style={selected ? { boxShadow: `0 0 0 1px ${color}` } : undefined}
            >
              <span
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${color}26`, border: `1px solid ${color}59` }}
              >
                <Icon className="w-5 h-5" style={{ color }} />
              </span>

              {/* Awf-Vorgabe Herkunftsnachweis: Name UND Anschrift jedes
                  Akteurs (I-16..I-28). Die Rolle steht immer dabei -- sie ist
                  die Antwort auf "wer ist das in der Kette?", und fehlt die
                  Anschrift, waere die Zeile sonst leer. */}
              <span className="flex-1 min-w-0">
                <span className="block text-[11px] font-semibold tracking-wide uppercase text-night-300 truncate">
                  {ACTOR_LABELS[actor.kind]}
                </span>
                {/* Name und Anschrift duerfen umbrechen: auf dem Handy wurde
                    "EGGER Sägewerk Brilon GmbH" neben dem Datum sonst zu
                    "EGGER Sägewerk Brilon G…" (Mobile-Vorschau, 18.09.2026). */}
                <span className="block font-semibold text-white text-sm leading-snug break-words">
                  {actor.name}
                </span>
                {actor.address && (
                  <span className="block text-[11px] text-night-300 leading-snug break-words">
                    {actor.address}
                  </span>
                )}
                {actor.reference && (
                  <span className="block text-[11px] font-mono text-night-400 truncate">
                    {actor.reference}
                  </span>
                )}
              </span>

              <span className="text-xs text-night-300 flex-shrink-0 tabular-nums">
                {actor.transportDate ?? '–'}
              </span>
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}
