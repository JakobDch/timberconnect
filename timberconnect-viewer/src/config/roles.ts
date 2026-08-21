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
}

function role(id: string, label: string, vcard: string, description: string): RoleDef {
  return { id, iri: `${NAMESPACES.tc}${id}`, label, vcard, description };
}

/**
 * Die Rollen der Lieferkette. Die ersten vier decken die fuenf Vorgaenge ab
 * (siehe `typicalRoles` in processService.ts):
 *   Forst          -> Pflanz- und Faellvorgang
 *   Saegewerk      -> Aufsaegevorgang
 *   BSP-Werk       -> Herstellungsvorgang
 *   Holzbauplanung -> Ausfuehrungsplanung
 * Haendler und Behoerde registrieren keine eigenen Vorgaenge, brauchen aber
 * eine Rolle, um im Zugriffsmodell adressierbar zu sein.
 *
 * Die Holzbauplanung ist die einzige Rolle, die KEIN Material erzeugt: sie
 * beschreibt, wohin ein bereits gefertigtes Bauteil eingebaut wird. Ihre
 * Idente stammen deshalb aus der Fertigung, nicht aus einem eigenen
 * GS1-Praefix -- siehe services/ifc_service.py.
 */
export const ROLES: RoleDef[] = [
  role(
    'Forst',
    'Forst',
    'Forst',
    'Forstbetrieb: Pflanzung, Bestandspflege und Holzernte. Registriert Pflanz- und Fällvorgänge.',
  ),
  role(
    'Saegewerk',
    'Sägewerk',
    'Saegewerk',
    'Einschnitt der Stämme zu Schnittholz. Registriert Aufsägevorgänge.',
  ),
  role(
    'BspWerk',
    'BSP-Werk',
    'BSP-Werk',
    'Weiterverarbeitung zu Bauteilen, z.B. Brettsperrholz. Registriert Herstellungsvorgänge.',
  ),
  role(
    'Holzbauplanung',
    'Holzbauplanung',
    'Holzbauplanung',
    'Tragwerksplanung und Ausführungsplanung im Holzbau. Registriert Ausführungsplanungen und verortet Bauteile im Gebäude.',
  ),
  role(
    'Haendler',
    'Händler',
    'Haendler',
    'Handel und Transport. Fragt Produktdaten ab, ohne eigene Vorgänge zu registrieren.',
  ),
  role(
    'Behoerde',
    'Behörde',
    'Behoerde',
    'Kontrolle und Nachweisprüfung, z.B. EUDR-Sorgfaltspflicht. Nur lesender Zugriff.',
  ),
];

const ROLE_BY_IRI = new Map(ROLES.map((r) => [r.iri, r]));
const ROLE_BY_ID = new Map(ROLES.map((r) => [r.id, r]));

export function getRoleByIri(iri: string | null | undefined): RoleDef | null {
  return iri ? ROLE_BY_IRI.get(iri) ?? null : null;
}

export function getRoleById(id: string | null | undefined): RoleDef | null {
  return id ? ROLE_BY_ID.get(id) ?? null : null;
}

/** Local name of the group document for a role, e.g. "Saegewerk" -> "saegewerk.ttl". */
export function groupDocName(roleId: string): string {
  return `${roleId.toLowerCase()}.ttl`;
}
