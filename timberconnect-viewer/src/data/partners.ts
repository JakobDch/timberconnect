/**
 * Praxispartner des TimberConnect-Projekts.
 *
 * Die Reihenfolge ist inhaltlich vorgegeben (Rueckmeldung Anni, 24.08.2026)
 * und folgt grob der Lieferkette -- NICHT dem Alphabet. Sie wird hier
 * bewusst als Array-Reihenfolge gehalten und nirgends nachsortiert.
 *
 * Namen und Rollen sind der Wortlaut der Praxispartner ("Feedback
 * App_Allgemein", 17.09.2026, Folie 2): vollstaendige Firmierung als Name,
 * die Funktion im Projekt als Rolle. Vorher standen dort Kurznamen und bei
 * vier Partnern noch "Beschreibung der Rolle" als Platzhalter.
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
  /** Vollstaendige Firmierung, wie vom Partner vorgegeben. */
  name: string;
  /** Kurzname fuer das Initialen-Monogramm, falls das Logo fehlt. */
  shortName: string;
  /** Funktion im Projekt (Wortlaut der Partner). */
  role: string;
  url: string;
  logo: string;
}

export const partners: Partner[] = [
  {
    id: 'eecc',
    name: 'European EPC Competence Center GmbH (EECC)',
    shortName: 'EECC',
    role: 'Dienstleister für Informationssysteme',
    url: 'https://www.eecc.info/',
    logo: `${import.meta.env.BASE_URL}partners/eecc.png`,
  },
  {
    id: 'baues-wunder',
    name: '„BAUES WUNDER“ Lambertz & Friesdorf Beratende Ingenieure PartGmbB',
    shortName: 'Baues Wunder',
    role: 'Beratungs- und Zertifizierungsbüro',
    url: 'https://baueswunder.com/',
    logo: `${import.meta.env.BASE_URL}partners/baues-wunder.png`,
  },
  {
    id: 'prause',
    name: 'Prause Holzbauplanung GmbH & Co. KG',
    shortName: 'Prause',
    role: 'Fachplaner Holzbau',
    url: 'https://holzbauplanung.io/',
    logo: `${import.meta.env.BASE_URL}partners/prause.png`,
  },
  {
    id: 'derix',
    name: 'W. u. J. Derix GmbH & Co.',
    shortName: 'Derix',
    role: 'Holzwerkstoffproduzent',
    url: 'https://www.derix.de/',
    logo: `${import.meta.env.BASE_URL}partners/derix.png`,
  },
  {
    id: 'egger',
    name: 'FRITZ EGGER GmbH & Co. OG',
    shortName: 'Egger',
    role: 'Sägewerk',
    url: 'https://www.egger.com/',
    logo: `${import.meta.env.BASE_URL}partners/egger.png`,
  },
  {
    id: 'wald-und-holz-nrw',
    name: 'Wald und Holz NRW',
    shortName: 'Wald und Holz NRW',
    role: 'Landesforstbetrieb',
    url: 'https://www.wald-und-holz.nrw.de/',
    logo: `${import.meta.env.BASE_URL}partners/wald-und-holz-nrw.png`,
  },
  {
    id: 'madaster',
    name: 'Madaster Germany GmbH',
    shortName: 'Madaster',
    role: 'Softwareanbieter Zirkularität',
    url: 'https://madaster.de/',
    logo: `${import.meta.env.BASE_URL}partners/madaster.png`,
  },
  {
    id: 'art-invest',
    name: 'Art-Invest Real Estate Management GmbH & Co. KG',
    shortName: 'Art-Invest',
    role: 'Projektentwickler',
    url: 'https://www.art-invest.de/',
    logo: `${import.meta.env.BASE_URL}partners/art-invest.png`,
  },
  {
    id: 'buildingsmart',
    name: 'buildingSMART Deutschland e. V.',
    shortName: 'buildingSMART',
    role: 'Kompetenznetzwerk Digitalisierung',
    url: 'https://www.buildingsmart.de/',
    logo: `${import.meta.env.BASE_URL}partners/buildingsmart.png`,
  },
];
