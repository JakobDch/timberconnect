/**
 * Topologie des Datenraums — wer gehoert dazu.
 *
 * Fuer die Visualisierung reicht, WELCHE Pods es gibt und wofuer sie stehen.
 * Beides steht schon im Foederationsregister bzw. in der role.ttl jedes
 * Mitglieds; hier wird nur zusammengefuehrt, was registryService ohnehin
 * liest, und auf das Noetige eingedampft: Kennung, Rolle, Station.
 *
 * Bewusst KEINE eigenen Netzabfragen ueber das hinaus, was der Registerdienst
 * schon cached (MEMBER_TTL) — der Graph ist Beiwerk und darf den Scan nicht
 * ausbremsen. Faellt das Register aus, liefert diese Stelle eine leere Liste;
 * der Graph zeigt dann nur die Kette ohne Pods, statt Knoten zu erfinden.
 */

import { discoverMemberWebIds, resolveMemberRoles } from './registryService';
import { podBaseFromWebId } from './accessControlService';
import { getRoleByIri } from '../config/roles';
import { endpointOf } from './dataspaceActivity';
import { stageForRole, type StageId } from './dataspaceStages';

export interface DataspaceNode {
  /** Gleiche Kennung wie in den Aktivitaetsmeldungen — daran haengt die Animation. */
  id: string;
  /** Rollenname, gekuerzt auf Graph-Laenge. Nie die rohe WebID. */
  label: string;
  /** Eigener Pod des angemeldeten Nutzers? */
  isSelf: boolean;
  /** Station der Lieferkette, an der dieser Pod steht. */
  stage: StageId;
}

/** Laenge, ab der eine Beschriftung den Graphen sprengt. */
const MAX_LABEL = 16;

/**
 * Kurzformen fuer den Graphen.
 *
 * Mehrere Rollennamen sind laenger als der Platz erlaubt. Stumpfes
 * Abschneiden erzeugt Wortruinen ("Holzwerkstoffpr…"), die unsauber aussehen
 * und nichts mehr aussagen. Diese Kurzformen sind im Fach gebraeuchlich und
 * bleiben verstaendlich; die vollen Namen stehen unveraendert in der
 * Rollenauswahl, wo Genauigkeit zaehlt — hier zaehlt Lesbarkeit auf engem
 * Raum.
 */
const SHORT_LABELS: Record<string, string> = {
  Holzwerkstoffproduzent: 'Holzwerkstoffe',
  'Fachplaner Holzbau': 'Fachplanung',
  Materialkatasterdienstleister: 'Materialkataster',
  Verbindungsmittelhersteller: 'Verbindungsmittel',
  'Wissenschaft und Forschung': 'Wissenschaft',
  Rückbauunternehmen: 'Rückbau',
  Transportunternehmen: 'Transport',
  Holzbauunternehmen: 'Holzbau',
  Generalunternehmer: 'Generalunt.',
  Unternehmensberatung: 'Beratung',
  'Facility Management': 'Facility Mgmt.',
  Projektentwickler: 'Projektentw.',
  Forstunternehmen: 'Forstunt.',
};

/**
 * Rollenname in der Form, die in den Graphen passt.
 *
 * Erst die gebraeuchliche Kurzform, und nur wenn es dafuer keine gibt, als
 * letzte Rettung abschneiden — damit eine neu hinzugefuegte Rolle die
 * Darstellung nicht sprengt, bevor jemand eine Kurzform ergaenzt hat.
 */
export function fit(label: string): string {
  const short = SHORT_LABELS[label] ?? label;
  return short.length > MAX_LABEL ? `${short.slice(0, MAX_LABEL - 1)}…` : short;
}

/**
 * Alle Mitglieder des Datenraums als Graph-Knoten.
 *
 * `ownWebId` markiert den eigenen Pod. Ist niemand angemeldet, gibt es keinen
 * eigenen Knoten — der Graph zeigt dann die Kette von aussen.
 *
 * OHNE LESBARE ROLLE, OHNE KNOTEN: Wer im Register steht, aber keine Rolle
 * deklariert (bzw. dessen role.ttl nicht lesbar ist), erscheint nicht. Solche
 * Pods als "Teilnehmer" zu zeigen war Rauschen: vier graue Kreise, ueber die
 * sich nichts sagen liess, und die Frage "was soll mir das sagen?" liess sich
 * nicht beantworten (Rueckmeldung 21.09.2026). Wer keine Rolle in der Kette
 * hat, hat auch keine Station, an der er stehen koennte.
 */
export async function loadDataspaceNodes(
  ownWebId: string | null,
): Promise<DataspaceNode[]> {
  let webIds: string[] = [];
  try {
    webIds = await discoverMemberWebIds();
  } catch {
    return [];
  }

  // Ohne Rollen gibt es nichts zu zeigen: die Rolle bestimmt die Station.
  let roles = new Map<string, string | null>();
  try {
    roles = await resolveMemberRoles();
  } catch {
    return [];
  }

  const ownEndpoint = ownWebId ? endpointOf(podBaseFromWebId(ownWebId)) : null;
  const seen = new Map<string, DataspaceNode>();

  for (const webId of webIds) {
    const endpoint = endpointOf(podBaseFromWebId(webId));
    // Mehrere WebIDs koennen auf denselben Pod zeigen; der Graph zeigt Pods,
    // nicht Personen.
    if (seen.has(endpoint)) continue;

    const role = getRoleByIri(roles.get(webId) ?? null);
    if (!role) continue; // siehe Kopfkommentar: keine Rolle, kein Knoten

    seen.set(endpoint, {
      id: endpoint,
      label: fit(role.label),
      isSelf: endpoint === ownEndpoint,
      stage: stageForRole(role.id),
    });
  }

  // Eigener Pod zuerst, danach alphabetisch: innerhalb einer Station steht
  // der eigene Pod so immer an derselben, vorhersehbaren Stelle.
  return Array.from(seen.values()).sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    return a.label.localeCompare(b.label, 'de');
  });
}
