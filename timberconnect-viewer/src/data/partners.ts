/**
 * Praxispartner des TimberConnect-Projekts (PDF-Vorgabe "Stand 1507").
 * Logos liegen unter public/partners/ — fehlt eine Datei, rendert das
 * PartnerSheet automatisch ein Initialen-Monogramm.
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
    id: 'art-invest',
    name: 'Art-Invest Real Estate',
    role: 'Beschreibung der Rolle',
    url: 'https://www.art-invest.de/',
    logo: '/partners/art-invest.png',
  },
  {
    id: 'baues-wunder',
    name: 'Baues Wunder',
    role: 'Beschreibung der Rolle',
    url: 'https://baueswunder.com/',
    logo: '/partners/baues-wunder.png',
  },
  {
    id: 'buildingsmart',
    name: 'buildingSMART',
    role: 'Beschreibung der Rolle',
    url: 'https://www.buildingsmart.de/',
    logo: '/partners/buildingsmart.png',
  },
  {
    id: 'derix',
    name: 'Derix',
    role: 'Beschreibung der Rolle',
    url: 'https://www.derix.de/',
    logo: '/partners/derix.png',
  },
  {
    id: 'eecc',
    name: 'EECC',
    role: 'Beschreibung der Rolle',
    url: 'https://www.eecc.info/',
    logo: '/partners/eecc.png',
  },
  {
    id: 'madaster',
    name: 'Madaster',
    role: 'Beschreibung der Rolle',
    url: 'https://madaster.de/',
    logo: '/partners/madaster.png',
  },
  {
    id: 'prause',
    name: 'Prause Holzbauplanung',
    role: 'Beschreibung der Rolle',
    url: 'https://holzbauplanung.io/',
    logo: '/partners/prause.png',
  },
];
