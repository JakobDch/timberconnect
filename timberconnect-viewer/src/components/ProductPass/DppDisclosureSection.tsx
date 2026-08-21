import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Scale } from 'lucide-react';

/**
 * "Verhaeltnis zum EU-Produktpass" -- der ausklappbare Abschnitt am Ende des
 * Bauproduktpasses.
 *
 * Der Pass sieht aus wie ein Produktpass, und genau darin liegt die Gefahr:
 * wer ihn zeigt, koennte den Eindruck erwecken, hier liege bereits ein
 * konformer DPP vor. Das Banner oben sagt kurz, dass dem nicht so ist;
 * dieser Abschnitt sagt praezise, woran es liegt -- welche Rechtsakte
 * gelten, was sie verlangen und welche drei Anforderungen dieser
 * Demonstrator strukturell nicht erfuellen kann.
 *
 * Die Angaben sind Rechtsstand August 2026. Sie werden hier bewusst als
 * Fliesstext gefuehrt und nicht aus Daten erzeugt: es ist eine Aussage ueber
 * das Vorhaben, nicht ueber das Bauteil.
 */

interface DppDisclosureSectionProps {
  /** Verzoegerung der Einblendung, passend zur uebrigen Seite. */
  delay?: number;
}

/** Ein Rechtsakt mit dem, was er fuer diesen Pass bedeutet. */
const REGULATIONS = [
  {
    title: 'Bauprodukteverordnung (EU) 2024/3110',
    body: 'Sie ist seit dem 8. Januar 2026 anwendbar und regelt in Kapitel X (Art. 75–80) den Produktpass speziell für Bauprodukte. Artikel 76 zählt auf, was er enthalten muss: die Leistungs- und Konformitätserklärung nach Artikel 15 samt der Angaben aus REACH Art. 31/33, allgemeine Produktinformationen und Sicherheitshinweise, die technische Dokumentation, die Umweltkennzeichnung, die eindeutigen Kennungen nach Artikel 79 sowie die Datenträger wesentlicher Bauteile. Artikel 80 verweist für das Muster auf Anhang V. Verpflichtend wird der Pass stufenweise ab 2027 — jeweils erst, wenn ein delegierter Rechtsakt die betroffene Produktgruppe erfasst.',
  },
  {
    title: 'Ökodesign-Verordnung (EU) 2024/1781 (ESPR)',
    body: 'Sie schafft den allgemeinen Rahmen für digitale Produktpässe und verlangt vier dauerhafte Kennungen: für das Produkt, den Wirtschaftsakteur, die Betriebsstätte und das Register. Sie müssen nach international anerkannten Normen vergeben werden (etwa GS1 oder ISO 15459) und über einen maschinenlesbaren Datenträger erreichbar sein. Das zentrale EU-Register soll ab dem 19. Juli 2026 in Betrieb gehen; die produktspezifischen delegierten Rechtsakte stehen weiterhin aus.',
  },
] as const;

/** Was dieser Demonstrator strukturell nicht erfuellt. */
const GAPS = [
  'Er ist nicht im EU-Produktpass-Register eingetragen und trägt deshalb keine Registerkennung.',
  'Der Pass selbst ist von keiner notifizierten Stelle geprüft — geprüft sind nur einzelne Nachweise, die er zusammenführt.',
  'Die Daten liegen in den Solid-Pods der beteiligten Unternehmen, nicht in der Systemarchitektur, die die delegierten Rechtsakte künftig vorschreiben werden.',
] as const;

export function DppDisclosureSection({ delay = 0 }: DppDisclosureSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`bg-night-800 border rounded-2xl overflow-hidden transition-colors ${
        open ? 'border-acid-400/40' : 'border-white/5'
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
      >
        <Scale
          className={`w-4 h-4 flex-shrink-0 ${open ? 'text-acid-400' : 'text-night-300'}`}
        />
        <span className="flex-1 min-w-0 text-sm font-semibold text-white truncate">
          Verhältnis zum EU-Produktpass
        </span>
        <ChevronDown
          className={`w-4 h-4 text-night-300 flex-shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              <p className="text-xs text-night-300 leading-relaxed">
                Zwei europäische Rechtsakte regeln digitale Produktpässe. Für
                Bauprodukte gilt die Bauprodukteverordnung; die
                Ökodesign-Verordnung gibt den allgemeinen Rahmen vor. Beide
                warten noch auf die delegierten Rechtsakte, die den konkreten
                Datensatz festlegen — ein „konformer“ Produktpass für
                Brettsperrholz lässt sich deshalb derzeit gar nicht
                herstellen.
              </p>

              {REGULATIONS.map((regulation) => (
                <div key={regulation.title}>
                  <h4 className="text-xs font-semibold text-white mb-1">
                    {regulation.title}
                  </h4>
                  <p className="text-xs text-night-300 leading-relaxed">
                    {regulation.body}
                  </p>
                </div>
              ))}

              <div>
                <h4 className="text-xs font-semibold text-white mb-1">
                  Was diese Ansicht nicht leistet
                </h4>
                <ul className="space-y-1.5">
                  {GAPS.map((gap) => (
                    <li
                      key={gap}
                      className="text-xs text-night-300 leading-relaxed flex gap-2"
                    >
                      <span aria-hidden="true" className="text-night-400">
                        —
                      </span>
                      <span>{gap}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-xs text-night-300 leading-relaxed">
                Was sie stattdessen zeigt: welche der vorgesehenen Angaben sich
                heute schon aus den Daten dieses Datenraums erzeugen ließen —
                und an welchen Stellen die Kette noch reißt. Rechtsstand
                August 2026.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
