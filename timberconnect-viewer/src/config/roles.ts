/**
 * TimberConnect Role Vocabulary
 *
 * Single source of truth for the supply-chain roles used in access control.
 * Role IRIs live under the tc: ontology namespace and are referenced by:
 *  - profile/role.ttl        (the pod owner's own role, via tc:hasRole + vcard:role)
 *  - access/role-policy.ttl  (which roles may read this pod, via tc:allowsRole)
 *  - access/groups/<role>.ttl (vcard:Group membership, used as acl:agentGroup)
 *  - access/epcis-consent.ttl (per-product role consent for EPCIS events)
 *
 * Keep these IRIs in sync with the rml-converter ident_injector and the
 * timberconnect ontology extension.
 *
 * Am 26.08.2026 ersetzte die offizielle 25er-Rollenliste die sechs
 * Platzhalter-Rollen (tc:Forst, tc:Saegewerk, tc:BspWerk, tc:Holzbauplanung,
 * tc:Haendler, tc:Behoerde). Bewusst ohne Alias-Mapping: die alten IRIs sind
 * ungueltig. Pods, die noch eine davon in profile/role.ttl tragen, gelten als
 * rollenlos und durchlaufen die Registrierung erneut — `getRoleByIri` liefert
 * fuer sie null. Alte Gruppendokumente unter access/groups/ bleiben liegen,
 * werden aber nicht mehr fortgeschrieben.
 */

import { NAMESPACES } from './solidPods';

// Predicates
export const TC_HAS_ROLE = `${NAMESPACES.tc}hasRole`;
export const TC_ALLOWS_ROLE = `${NAMESPACES.tc}allowsRole`;
export const VCARD_ROLE = 'http://www.w3.org/2006/vcard/ns#role';
/** GS1 Company Prefix des Teilnehmers — Write-once bei der Registrierung. */
export const TC_COMPANY_PREFIX = `${NAMESPACES.tc}companyPrefix`;

/** GS1 Company Prefixes sind 4-12 Ziffern (z. B. 4047111124). */
export function isValidCompanyPrefix(value: string): boolean {
  return /^\d{4,12}$/.test(value);
}

/**
 * Thematische Buendelung der Rollen — reine Ordnungshilfe fuer die Auswahl.
 *
 * 25 Rollen als flache Liste sind nicht mehr ueberblickbar; die Gruppe steht
 * NICHT im Pod und hat keine Bedeutung fuer die Zugriffssteuerung. Wer eine
 * Rolle anders einsortieren will, aendert hier die Zuordnung, ohne dass sich
 * an den Daten etwas aendert.
 */
export type RoleGroupId =
  | 'wertschoepfung'
  | 'planungBau'
  | 'betriebNutzung'
  | 'finanzenRecht'
  | 'oeffentlichkeitWissenschaft';

export const ROLE_GROUPS: { id: RoleGroupId; label: string }[] = [
  { id: 'wertschoepfung', label: 'Wertschöpfungskette Holz' },
  { id: 'planungBau', label: 'Planung & Bau' },
  { id: 'betriebNutzung', label: 'Betrieb & Nutzung' },
  { id: 'finanzenRecht', label: 'Finanzen, Recht & Prüfung' },
  { id: 'oeffentlichkeitWissenschaft', label: 'Öffentlichkeit & Wissenschaft' },
];

/** A supply-chain role. `id` is the local name appended to the tc: namespace. */
export interface RoleDef {
  id: string;
  iri: string;
  /** German label for the UI. */
  label: string;
  /** Plain-text value also written to vcard:role for interop with the dataspace app. */
  vcard: string;
  /**
   * Kurzbeschreibung fuer die Rollenwahl. Die Rolle ist nach der Registrierung
   * nicht mehr aenderbar — wer waehlt, muss vorher wissen, was er waehlt.
   */
  description: string;
  /** Thematische Gruppe fuer die Darstellung in der Rollenauswahl. */
  group: RoleGroupId;
}

function role(
  id: string,
  label: string,
  vcard: string,
  group: RoleGroupId,
  description: string,
): RoleDef {
  return { id, iri: `${NAMESPACES.tc}${id}`, label, vcard, description, group };
}

/**
 * Die offizielle Rollenliste des Projekts (Stand 26.08.2026).
 *
 * Reihenfolge und Benennung folgen der abgestimmten Liste und sind bewusst
 * NICHT nach technischer Bequemlichkeit sortiert — sie bilden den Lebenszyklus
 * ab, vom stehenden Bestand bis zur Nachnutzung und Auswertung.
 *
 * Fuenf dieser Rollen registrieren eigene Vorgaenge (siehe `typicalRoles` in
 * processService.ts):
 *   Forstbetrieb            -> Pflanz- und Faellvorgang
 *   Saegewerk               -> Aufsaegevorgang
 *   Holzwerkstoffproduzent  -> Herstellungsvorgang
 *   FachplanerHolzbau       -> Ausfuehrungsplanung
 * Alle uebrigen registrieren keine eigenen Vorgaenge, brauchen aber eine
 * Rolle, um im Zugriffsmodell adressierbar zu sein.
 *
 * Der Fachplaner Holzbau ist die einzige Rolle, die KEIN Material erzeugt: er
 * beschreibt, wohin ein bereits gefertigtes Bauteil eingebaut wird. Seine
 * Idente stammen deshalb aus der Fertigung, nicht aus einem eigenen
 * GS1-Praefix -- siehe services/ifc_service.py.
 *
 * Die `id` wird zum IRI-Lokalnamen und (kleingeschrieben) zum Dateinamen der
 * Gruppendokumente. Deshalb ASCII, ohne Umlaute und Leerzeichen, und
 * kleingeschrieben eindeutig — siehe `groupDocName`.
 */
export const ROLES: RoleDef[] = [
  role(
    'Forstbetrieb',
    'Forstbetrieb',
    'Forstbetrieb',
    'wertschoepfung',
    'Bewirtschaftung der Waldfläche: Pflanzung, Bestandspflege und Holzernte. Registriert Pflanz- und Fällvorgänge.',
  ),
  role(
    'Forstunternehmen',
    'Forstunternehmen',
    'Forstunternehmen',
    'wertschoepfung',
    'Dienstleister für Holzernte und Waldarbeit im Auftrag des Forstbetriebs, mit eigener Erntetechnik.',
  ),
  role(
    'Saegewerk',
    'Sägewerk',
    'Saegewerk',
    'wertschoepfung',
    'Einschnitt der Stämme zu Schnittholz. Registriert Aufsägevorgänge.',
  ),
  role(
    'Transportunternehmen',
    'Transportunternehmen',
    'Transportunternehmen',
    'wertschoepfung',
    'Transport von Rundholz, Schnittholz und Bauteilen zwischen den Stufen der Lieferkette.',
  ),
  role(
    'Verbindungsmittelhersteller',
    'Verbindungsmittelhersteller',
    'Verbindungsmittelhersteller',
    'wertschoepfung',
    'Herstellung von Verbindungsmitteln und Beschlägen, z.B. Schrauben, Winkel und Stahlteile.',
  ),
  role(
    'Holzwerkstoffproduzent',
    'Holzwerkstoffproduzent',
    'Holzwerkstoffproduzent',
    'wertschoepfung',
    'Weiterverarbeitung zu Bauteilen und Holzwerkstoffen, z.B. Brettsperrholz. Registriert Herstellungsvorgänge.',
  ),
  role(
    'Holzbauunternehmen',
    'Holzbauunternehmen',
    'Holzbauunternehmen',
    'planungBau',
    'Vorfertigung und Montage der Holzkonstruktion auf der Baustelle.',
  ),
  role(
    'Generalunternehmer',
    'Generalunternehmer',
    'Generalunternehmer',
    'planungBau',
    'Gesamtverantwortung für die Bauausführung und Koordination der beteiligten Gewerke.',
  ),
  role(
    'Rueckbauunternehmen',
    'Rückbauunternehmen',
    'Rueckbauunternehmen',
    'planungBau',
    'Rückbau und Demontage am Ende der Nutzungsphase, Grundlage für Wiederverwendung und Verwertung.',
  ),
  role(
    'Projektentwickler',
    'Projektentwickler',
    'Projektentwickler',
    'planungBau',
    'Entwicklung und Steuerung des Bauvorhabens von der Konzeption bis zur Übergabe.',
  ),
  role(
    'FachplanerHolzbau',
    'Fachplaner Holzbau',
    'Fachplaner Holzbau',
    'planungBau',
    'Tragwerks- und Ausführungsplanung im Holzbau. Registriert Ausführungsplanungen und verortet Bauteile im Gebäude.',
  ),
  role(
    'Finanzierer',
    'Finanzierer',
    'Finanzierer',
    'finanzenRecht',
    'Finanzierung des Bauvorhabens, u.a. Nachweis von Nachhaltigkeitskriterien für die Kreditvergabe.',
  ),
  role(
    'Versicherer',
    'Versicherer',
    'Versicherer',
    'finanzenRecht',
    'Versicherung von Bauvorhaben und Bestand, Bewertung von Risiken und Schadensfällen.',
  ),
  role(
    'Zertifizierer',
    'Zertifizierer',
    'Zertifizierer',
    'finanzenRecht',
    'Vergabe und Prüfung von Zertifikaten und Gebäudelabels, z.B. DGNB oder QNG.',
  ),
  role(
    'Sachverstaendige',
    'Sachverständige',
    'Sachverstaendige',
    'finanzenRecht',
    'Begutachtung und Bewertung von Bauteilen, Schäden und Bauzuständen.',
  ),
  role(
    'Juristen',
    'Juristen',
    'Juristen',
    'finanzenRecht',
    'Rechtliche Begleitung, u.a. Vertragsgestaltung, Gewährleistung und Haftungsfragen.',
  ),
  role(
    'Finanzamt',
    'Finanzamt',
    'Finanzamt',
    'finanzenRecht',
    'Steuerliche Bewertung, u.a. Abschreibung und Bewertung von Gebäudesubstanz.',
  ),
  role(
    'Materialkatasterdienstleister',
    'Materialkatasterdienstleister',
    'Materialkatasterdienstleister',
    'betriebNutzung',
    'Führung des Materialkatasters: Erfassung verbauter Materialien für die spätere Wiederverwendung.',
  ),
  role(
    'FacilityManagement',
    'Facility Management',
    'Facility Management',
    'betriebNutzung',
    'Betrieb, Wartung und Instandhaltung des Gebäudes über die Nutzungsphase.',
  ),
  role(
    'Nutzer',
    'Nutzer',
    'Nutzer',
    'betriebNutzung',
    'Nutzung des Gebäudes, z.B. Mieter oder Betreiber der Flächen.',
  ),
  role(
    'Bestandshalter',
    'Bestandshalter',
    'Bestandshalter',
    'betriebNutzung',
    'Halten und Bewirtschaften des Bestands — einschließlich Anleger, Fondsmanager und Portfolio-Eigentümer.',
  ),
  role(
    'Unternehmensberatung',
    'Unternehmensberatung',
    'Unternehmensberatung',
    'betriebNutzung',
    'Beratung zu Prozessen, Nachhaltigkeit und Wirtschaftlichkeit entlang der Wertschöpfungskette.',
  ),
  role(
    'Verbaende',
    'Verbände',
    'Verbaende',
    'oeffentlichkeitWissenschaft',
    'Interessenvertretung der Branche, Normung und Verbreitung guter Praxis.',
  ),
  role(
    'Politik',
    'Politik',
    'Politik',
    'oeffentlichkeitWissenschaft',
    'Politik und Behörden, z.B. Europäische Umweltagentur. Kontrolle und Nachweisprüfung, etwa der EUDR-Sorgfaltspflicht.',
  ),
  role(
    'Befragung',
    'Befragung',
    'Befragung',
    'oeffentlichkeitWissenschaft',
    'Erhebungen und Umfragen zur Datenlage in der Holzbau-Wertschöpfungskette.',
  ),
  role(
    'WissenschaftForschung',
    'Wissenschaft und Forschung',
    'Wissenschaft und Forschung',
    'oeffentlichkeitWissenschaft',
    'Forschung und Lehre, Auswertung anonymisierter Daten für wissenschaftliche Zwecke.',
  ),
];

/**
 * Rollen-IDs frueherer Listenstaende und ihre heutige Entsprechung.
 *
 * In bereits registrierten Pods steht die Rolle als IRI in
 * ``profile/role.ttl``. Wird eine Rolle umbenannt, zeigt dieser Eintrag ins
 * Leere: die Oberflaeche fand die Rolle nicht mehr und liess sie stillschweigend
 * verschwinden -- in der Dokumentfreigabe stand dann "6 von 6 Rollen", waehrend
 * nur eine Karte erschien. Auch das Zugriffsmodell greift nicht mehr: eine
 * role-policy.ttl, die tc:Forstbetrieb erlaubt, laesst tc:Forst nicht durch.
 *
 * Diese Tabelle uebersetzt beim LESEN. Geschrieben wird ausschliesslich die
 * aktuelle Form -- ein Pod, der sich neu registriert, verliert damit den
 * Altbestand. Eintraege duerfen erst entfallen, wenn kein Pod die alte
 * Schreibweise mehr traegt.
 */
const LEGACY_ROLE_IDS: Record<string, string> = {
  Forst: 'Forstbetrieb',
  BspWerk: 'Holzwerkstoffproduzent',
  Holzbauplanung: 'FachplanerHolzbau',
};

const ROLE_BY_IRI = new Map(ROLES.map((r) => [r.iri, r]));
const ROLE_BY_ID = new Map(ROLES.map((r) => [r.id, r]));

// Alt-IRIs zeigen auf dieselbe Rolle wie ihre heutige Entsprechung.
for (const [legacyId, currentId] of Object.entries(LEGACY_ROLE_IDS)) {
  const current = ROLE_BY_ID.get(currentId);
  if (!current) continue;
  ROLE_BY_IRI.set(`${NAMESPACES.tc}${legacyId}`, current);
  ROLE_BY_ID.set(legacyId, current);
}

export function getRoleByIri(iri: string | null | undefined): RoleDef | null {
  return iri ? ROLE_BY_IRI.get(iri) ?? null : null;
}

export function getRoleById(id: string | null | undefined): RoleDef | null {
  return id ? ROLE_BY_ID.get(id) ?? null : null;
}

/**
 * Eine Liste von Rollen-IRIs auf die heutige Schreibweise bringen.
 *
 * Fuer alles, was IRIs als Menge verarbeitet (Pod-Freigabe, Dokumentpolicy):
 * unbekannte Eintraege fallen weg, veraltete werden uebersetzt, Dubletten
 * entfallen.
 */
export function normalizeRoleIris(iris: readonly string[]): string[] {
  const out = new Set<string>();
  for (const iri of iris) {
    const role = getRoleByIri(iri);
    if (role) out.add(role.iri);
  }
  return [...out];
}

/** Local name of the group document for a role, e.g. "Saegewerk" -> "saegewerk.ttl". */
export function groupDocName(roleId: string): string {
  return `${roleId.toLowerCase()}.ttl`;
}

/** Die Rollen einer Gruppe, in der Reihenfolge der offiziellen Liste. */
export function rolesByGroup(group: RoleGroupId): RoleDef[] {
  return ROLES.filter((r) => r.group === group);
}

// Entwicklungs-Sicherung: `groupDocName` schreibt alle IDs klein, und der IRI
// haengt die ID roh an den Namensraum. Zwei IDs, die sich nur in der
// Gross-/Kleinschreibung unterscheiden, wuerden sich dasselbe Gruppendokument
// teilen und Zugriffsrechte stillschweigend vermischen; Umlaute oder
// Leerzeichen erzeugen kaputte Pod-URLs. Beides faellt sonst erst zur Laufzeit
// auf einem echten Pod auf.
if (import.meta.env.DEV) {
  const seen = new Set<string>();
  for (const r of ROLES) {
    const key = r.id.toLowerCase();
    if (seen.has(key)) {
      console.error(`[roles] Doppelte Rollen-ID (Gross-/Kleinschreibung): ${r.id}`);
    }
    seen.add(key);
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(r.id)) {
      console.error(`[roles] Rollen-ID ist nicht IRI-/dateinamentauglich: ${r.id}`);
    }
  }
}
