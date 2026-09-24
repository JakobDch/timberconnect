import logoNrwMunv from '/logo-nrw-munv.png';
import logoEuKofinanziert from '/logo-eu-kofinanziert.png';

/**
 * Gebundene Logo-Kombination EU | Ministerium (Foerderhinweis EFRE/JTF NRW).
 *
 * Vorgaben (Leitfaden Kommunikation EFRE/JTF NRW, Dez. 2024, S. 6-7, 24;
 * VO (EU) 2021/1060 Anh. IX; EU-Emblem-Leitlinien 2021-2027):
 * - EINE gemeinsame weisse Identitaetsflaeche, keine zwei Kaesten; eckig,
 *   weil die Kombination nicht veraendert werden darf.
 * - Das EU-Emblem muss mindestens so hoch bzw. breit sein wie das groesste
 *   andere Logo. Die Flagge fuellt ihr Bild nicht ganz aus, deshalb ist das
 *   EU-Bild in jeder Variante eine Stufe hoeher als das NRW-Bild; durch das
 *   breitere Seitenverhaeltnis (4,6 zu 4,2) ist es damit auch breiter.
 * - Untereinander nur, wo der Platz fehlt -- das ist die einzige erlaubte
 *   Umstellung der Leiste.
 *
 * Die Bilddateien sind auf ihren Inhalt zugeschnitten (das NRW-Logo bestand
 * zu ~64% aus Weissraum), damit die Ministeriumszeile lesbar bleibt
 * (Rueckmeldung Anni, 24.08.2026).
 */
const VARIANTS = {
  // Footer: am Handy untereinander, ab sm nebeneinander.
  footer: {
    box: 'px-5 py-4 flex-col sm:flex-row gap-4 sm:gap-8',
    eu: 'h-14 sm:h-18',
    nrw: 'h-12 sm:h-16',
  },
  // Praxispartner-Sheet: Partnerlogos sind 96x64 px, die EU-Flagge muss
  // mindestens so gross sein -- nebeneinander passt das am Handy nicht.
  sheet: {
    box: 'px-5 py-4 flex-col sm:flex-row gap-4 sm:gap-6',
    eu: 'h-14',
    nrw: 'h-12',
  },
  // Seitenmenue: hoechstens ~290 px breit, daher immer untereinander.
  menu: {
    box: 'px-5 py-4 flex-col gap-4',
    eu: 'h-12',
    nrw: 'h-11',
  },
} as const;

export function FundingLogos({ variant }: { variant: keyof typeof VARIANTS }) {
  const v = VARIANTS[variant];
  return (
    <div className={`bg-white max-w-full flex items-center ${v.box}`}>
      <img
        src={logoEuKofinanziert}
        alt="Kofinanziert von der Europäischen Union"
        className={`${v.eu} w-auto max-w-full object-contain`}
      />
      <img
        src={logoNrwMunv}
        alt="Ministerium für Umwelt, Naturschutz und Verkehr des Landes Nordrhein-Westfalen"
        className={`${v.nrw} w-auto max-w-full object-contain`}
      />
    </div>
  );
}
