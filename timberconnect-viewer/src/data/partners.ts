/**
 * Praxispartner des TimberConnect-Projekts.
 *
 * Die Reihenfolge ist inhaltlich vorgegeben (Rueckmeldung Anni, 24.08.2026)
 * und folgt grob der Lieferkette -- NICHT dem Alphabet. Sie wird hier
 * bewusst als Array-Reihenfolge gehalten und nirgends nachsortiert.
 *
 * Logos liegen unter public/partners/ (aus "Logos.zip", auf den Inhalt
 * zugeschnitten). Fehlt eine Datei, faellt das PartnerSheet auf ein
 * Initialen-Monogramm zurueck.
 *
 * Der Pfad MUSS ueber import.meta.env.BASE_URL laufen. Die App wird unter
 * ``/timberconnect/`` ausgeliefert; ein absolutes ``/partners/x.png`` laedt
 * der Browser gegen den Origin-Root, wo Caddy auf die App zurueckleitet und
 * eine leere Antwort liefert. Das Bild dekodiert dann nicht und jeder Partner
 * erschien als Initialen-Monogramm -- genau der Zustand, den die Rueckmeldung
 * ("Logo statt Kuerzel") beanstandet hat. Fiel vorher nicht auf, weil die
 * alten Dateien nur Favicon-Groesse hatten.
 */

export interface Partner {
  id: string;
  name: string;
  /** Rollenbeschreibung entlang der Lieferkette (Platzhalter bis Texte vom Partner kommen). */
  role: string;
  url: string;
  logo: string;
}

export const partners: Partner[] = [
  {
    id: 'eecc',
    name: 'EECC',
    role: 'European EPC Competence Center',
    url: 'https://www.eecc.info/',
    logo: `${import.meta.env.BASE_URL}partners/eecc.png`,
  },
  {
    id: 'baues-wunder',
    name: 'Baues Wunder',
    role: 'Beschreibung der Rolle',
    url: 'https://baueswunder.com/',
    logo: `${import.meta.env.BASE_URL}partners/baues-wunder.png`,
  },
  {
    id: 'prause',
    name: 'Prause Holzbauplanung',
    role: 'Büro für besseres Bauen',
    url: 'https://holzbauplanung.io/',
    logo: `${import.meta.env.BASE_URL}partners/prause.png`,
  },
  {
    id: 'derix',
    name: 'Derix',
    role: 'Holz in neuer Dimension',
    url: 'https://www.derix.de/',
    logo: `${import.meta.env.BASE_URL}partners/derix.png`,
  },
  {
    id: 'egger',
    name: 'Egger',
    role: 'Holzwerkstoffproduzent',
    url: 'https://www.egger.com/',
    logo: `${import.meta.env.BASE_URL}partners/egger.png`,
  },
  {
    id: 'wald-und-holz-nrw',
    name: 'Wald und Holz NRW',
    role: 'Landesbetrieb Wald und Holz Nordrhein-Westfalen',
    url: 'https://www.wald-und-holz.nrw.de/',
    logo: `${import.meta.env.BASE_URL}partners/wald-und-holz-nrw.png`,
  },
  {
    id: 'madaster',
    name: 'Madaster',
    role: 'Beschreibung der Rolle',
    url: 'https://madaster.de/',
    logo: `${import.meta.env.BASE_URL}partners/madaster.png`,
  },
  {
    id: 'art-invest',
    name: 'Art-Invest Real Estate',
    role: 'Beschreibung der Rolle',
    url: 'https://www.art-invest.de/',
    logo: `${import.meta.env.BASE_URL}partners/art-invest.png`,
  },
  {
    id: 'buildingsmart',
    name: 'buildingSMART',
    role: 'Beschreibung der Rolle',
    url: 'https://www.buildingsmart.de/',
    logo: `${import.meta.env.BASE_URL}partners/buildingsmart.png`,
  },
];
