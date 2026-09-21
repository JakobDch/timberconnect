/**
 * Die Stufen des Datenraums — die Ebenen, auf denen der Graph die Akteure
 * anordnet.
 *
 * Der Datenraum ist EINER, mit vielen Akteuren. Sie stehen aber nicht
 * beziehungslos nebeneinander, sondern auf Stationen einer Kette: das Holz
 * laeuft vom Forstbetrieb bis zum Holzbauunternehmen. Genau diese Abfolge
 * zeigt schon die Startseite (components/Landing/SupplyChainGraphic.tsx), und
 * der Graph uebernimmt sie, damit beide Ansichten dieselbe Welt beschreiben.
 *
 * Die Reihenfolge ist die der Kette, NICHT die von config/roles.ts (die folgt
 * dem Lebenszyklus inklusive Nachnutzung) und nicht das Alphabet.
 *
 * Rollen ohne eigene Stufe — Zertifizierer, Versicherer, Juristen,
 * Wissenschaft — erzeugen kein Material, begleiten die Kette aber ueber ihre
 * ganze Laenge. Sie landen in der Stufe `begleitend`, die im Graphen unter
 * der Kette liegt statt in ihr.
 */

/** Kennung einer Stufe — zugleich Reihenfolge im Graphen. */
export type StageId =
  | 'forst'
  | 'saege'
  | 'werkstoff'
  | 'transport'
  | 'planung'
  | 'bau'
  | 'begleitend';

export interface StageDef {
  id: StageId;
  /** Kurzer Name fuer die Stationsbeschriftung. */
  label: string;
  /** Rollen-IDs aus config/roles.ts, die auf dieser Stufe stehen. */
  roleIds: readonly string[];
}

/**
 * Die Kette. `begleitend` steht bewusst am Ende und traegt keine eigenen
 * roleIds: dort landet, was in keiner anderen Stufe vorkommt (siehe
 * `stageForRole`). So muss diese Liste nicht jedes Mal nachgefuehrt werden,
 * wenn config/roles.ts um eine Rolle waechst.
 */
export const STAGES: readonly StageDef[] = [
  { id: 'forst', label: 'Forstbetrieb', roleIds: ['Forstbetrieb', 'Forstunternehmen'] },
  { id: 'saege', label: 'Sägewerk', roleIds: ['Saegewerk'] },
  {
    id: 'werkstoff',
    label: 'Holzwerkstoffe',
    roleIds: ['Holzwerkstoffproduzent', 'Verbindungsmittelhersteller'],
  },
  { id: 'transport', label: 'Transport', roleIds: ['Transportunternehmen'] },
  { id: 'planung', label: 'Fachplanung', roleIds: ['FachplanerHolzbau', 'Projektentwickler'] },
  {
    id: 'bau',
    label: 'Holzbau',
    roleIds: [
      'Holzbauunternehmen',
      'Generalunternehmer',
      'Rueckbauunternehmen',
      'FacilityManagement',
      'Nutzer',
      'Bestandshalter',
    ],
  },
  {
    id: 'begleitend',
    label: 'Begleitend',
    roleIds: [],
  },
] as const;

/** Schneller Zugriff Rolle -> Stufe. */
const STAGE_BY_ROLE = new Map<string, StageId>();
for (const stage of STAGES) {
  for (const roleId of stage.roleIds) STAGE_BY_ROLE.set(roleId, stage.id);
}

/**
 * Stufe einer Rolle.
 *
 * Alles, was keiner Kettenstufe zugeordnet ist, gilt als begleitend — auch
 * eine Rolle, die es zum Zeitpunkt dieser Datei noch gar nicht gab. Der Graph
 * verliert dadurch nie einen Akteur, nur weil jemand die Rollenliste
 * erweitert hat.
 */
export function stageForRole(roleId: string | null | undefined): StageId {
  if (!roleId) return 'begleitend';
  return STAGE_BY_ROLE.get(roleId) ?? 'begleitend';
}
