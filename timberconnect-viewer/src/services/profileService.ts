/**
 * Profile Service — WebID-Profil lesen und schreiben
 *
 * Das WebID-Dokument ({pod}profile/card) ist die Visitenkarte des Nutzers im
 * Dataspace: alles, was andere Teilnehmer von ihm sehen, steht dort. Bisher
 * konnte es nur über die generische Solid-Server-Oberfläche bearbeitet werden;
 * dieser Service kapselt das Lesen/Schreiben der wenigen Felder, die für
 * TimberConnect relevant sind, damit die App ein eigenes Formular anbieten kann.
 *
 * Geschrieben wird ausschliesslich in das Thing mit der WebID als Subjekt —
 * andere Aussagen im Dokument (oidcIssuer, storage, inbox, ...) bleiben durch
 * setThing() unangetastet.
 *
 * Rolle und Company Prefix liegen bewusst NICHT hier, sondern in
 * profile/role.ttl (accessControlService): beide sind write-once und Teil der
 * Registrierung, nicht des frei editierbaren Profils.
 */

import {
  getSolidDataset,
  getThing,
  setThing,
  buildThing,
  createThing,
  saveSolidDatasetAt,
  getStringNoLocale,
  getUrl,
} from '@inrupt/solid-client';
import { RDF, FOAF, VCARD } from '@inrupt/vocab-common-rdf';
import { getAuthFetch } from './authFetch';

const VCARD_ORGANIZATION_NAME = 'http://www.w3.org/2006/vcard/ns#organization-name';
const VCARD_NOTE = 'http://www.w3.org/2006/vcard/ns#note';

/** Die von der App bearbeitbaren Profilfelder. */
export interface UserProfile {
  /** Anzeigename (vcard:fn + foaf:name). */
  name: string;
  /** Unternehmen/Betrieb (vcard:organization-name). */
  organization: string;
  /** Kontakt-E-Mail als reiner String (vcard:hasEmail als mailto:-URL). */
  email: string;
  /** Telefon als reiner String (vcard:hasTelephone als tel:-URL). */
  phone: string;
  /** Freitext-Kurzbeschreibung (vcard:note). */
  note: string;
  /** URL eines Profilbilds (vcard:hasPhoto). */
  photo: string;
}

export const EMPTY_PROFILE: UserProfile = {
  name: '',
  organization: '',
  email: '',
  phone: '',
  note: '',
  photo: '',
};

/** Das WebID-Dokument ohne Fragment — dorthin wird gespeichert. */
export function profileDocFromWebId(webId: string): string {
  return webId.split('#')[0];
}

/** mailto:foo@bar -> foo@bar (und umgekehrt tolerant gegenüber blankem Wert). */
function stripScheme(value: string | null, scheme: string): string {
  if (!value) return '';
  return value.toLowerCase().startsWith(scheme) ? value.slice(scheme.length) : value;
}

/**
 * Profil aus dem WebID-Dokument lesen.
 *
 * E-Mail/Telefon werden in Solid üblicherweise als eigenes vcard-Objekt
 * (`vcard:hasEmail -> [ vcard:value <mailto:...> ]`) modelliert. Wir lesen
 * beide Varianten: den direkten URL-Wert und die verschachtelte Form.
 */
export async function getProfile(webId: string): Promise<UserProfile> {
  const ds = await getSolidDataset(profileDocFromWebId(webId), { fetch: getAuthFetch() });
  const card = getThing(ds, webId);
  if (!card) return { ...EMPTY_PROFILE };

  const readContact = (predicate: string, scheme: string): string => {
    const direct = getUrl(card, predicate);
    if (direct) {
      // Verschachtelte Form: der Wert zeigt auf ein vcard-Objekt im selben Dokument.
      const nested = getThing(ds, direct);
      if (nested) {
        const value = getUrl(nested, VCARD.value) || getStringNoLocale(nested, VCARD.value);
        if (value) return stripScheme(value, scheme);
      }
      return stripScheme(direct, scheme);
    }
    return stripScheme(getStringNoLocale(card, predicate), scheme);
  };

  return {
    name:
      getStringNoLocale(card, VCARD.fn) ||
      getStringNoLocale(card, FOAF.name) ||
      `${getStringNoLocale(card, VCARD.given_name) || ''} ${getStringNoLocale(card, VCARD.family_name) || ''}`.trim(),
    organization: getStringNoLocale(card, VCARD_ORGANIZATION_NAME) || '',
    email: readContact(VCARD.hasEmail, 'mailto:'),
    phone: readContact(VCARD.hasTelephone, 'tel:'),
    note: getStringNoLocale(card, VCARD_NOTE) || '',
    photo: getUrl(card, VCARD.hasPhoto) || getUrl(card, FOAF.img) || '',
  };
}

/**
 * Profil in das WebID-Dokument schreiben.
 *
 * Vorgehen: das vorhandene WebID-Thing wird geklont, die von uns verwalteten
 * Prädikate werden entfernt und neu gesetzt — alles andere am Subjekt (z.B.
 * solid:oidcIssuer, pim:storage) bleibt erhalten. Leere Felder werden gelöscht
 * statt als Leerstring geschrieben.
 *
 * E-Mail/Telefon schreiben wir in der einfachen Form direkt als mailto:/tel:-URL
 * am WebID-Subjekt. Das ist gültiges vcard und für die Anzeige in dieser App
 * ausreichend; verschachtelte Objekte fremder Editoren werden beim Lesen
 * weiterhin verstanden (siehe getProfile).
 */
export async function saveProfile(webId: string, profile: UserProfile): Promise<void> {
  const docUrl = profileDocFromWebId(webId);
  const ds = await getSolidDataset(docUrl, { fetch: getAuthFetch() });
  const existing = getThing(ds, webId) ?? createThing({ url: webId });

  const name = profile.name.trim();
  const organization = profile.organization.trim();
  const email = profile.email.trim();
  const phone = profile.phone.trim();
  const note = profile.note.trim();
  const photo = profile.photo.trim();

  let builder = buildThing(existing)
    .removeAll(VCARD.fn)
    .removeAll(FOAF.name)
    .removeAll(VCARD_ORGANIZATION_NAME)
    .removeAll(VCARD.hasEmail)
    .removeAll(VCARD.hasTelephone)
    .removeAll(VCARD_NOTE)
    .removeAll(VCARD.hasPhoto);

  // Ein WebID-Dokument sollte sein Subjekt typisieren; bei Pods, die das noch
  // nicht tun, ergaenzen wir es hier beilaeufig.
  if (!getUrl(existing, RDF.type)) {
    builder = builder.addUrl(RDF.type, VCARD.Individual);
  }

  if (name) {
    builder = builder.addStringNoLocale(VCARD.fn, name).addStringNoLocale(FOAF.name, name);
  }
  if (organization) {
    builder = builder.addStringNoLocale(VCARD_ORGANIZATION_NAME, organization);
  }
  if (email) {
    builder = builder.addUrl(VCARD.hasEmail, `mailto:${email}`);
  }
  if (phone) {
    builder = builder.addUrl(VCARD.hasTelephone, `tel:${phone.replace(/\s/g, '')}`);
  }
  if (note) {
    builder = builder.addStringNoLocale(VCARD_NOTE, note);
  }
  if (photo) {
    builder = builder.addUrl(VCARD.hasPhoto, photo);
  }

  await saveSolidDatasetAt(docUrl, setThing(ds, builder.build()), { fetch: getAuthFetch() });
}

/** Sehr einfache Plausibilitätsprüfung — der Pod validiert nichts. */
export function isValidEmail(value: string): boolean {
  return value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** http(s)-URL oder leer. Verhindert, dass kaputte Werte ins Profil wandern. */
export function isValidPhotoUrl(value: string): boolean {
  if (value === '') return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
