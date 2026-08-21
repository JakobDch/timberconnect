/**
 * Farben und Beschriftungen der Akteurstypen im Herkunftsnachweis.
 *
 * Bewusst als eigenes Modul neben ActorLocationMap.tsx: Karte UND Legende
 * greifen darauf zu, und so koennen die beiden nicht auseinanderlaufen.
 * (Nebenbei erfuellt es die Fast-Refresh-Regel, die in Komponentendateien nur
 * Komponenten-Exporte erlaubt.)
 *
 * Die Farbwahl folgt der Awf-Visualisierung: Wald rot, Saegewerk violett,
 * Holzwerkstoffproduzent cyan.
 */

import type { ActorKind } from '../../services/provenanceMapper';

export const ACTOR_COLORS: Record<ActorKind, string> = {
  forest: '#EF4444',
  sawmill: '#8B5CF6',
  manufacturer: '#22D3EE',
};

export const ACTOR_LABELS: Record<ActorKind, string> = {
  forest: 'Wald',
  sawmill: 'Sägewerk',
  manufacturer: 'Holzwerkstoffproduzent',
};
