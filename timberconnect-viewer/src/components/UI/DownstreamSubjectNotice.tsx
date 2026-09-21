import { Info } from 'lucide-react';
import type { Product } from '../../types';
import type { ProductDataResult } from '../../services/sparqlService';
import { detectProductStage, stageLabel } from '../../services/productImageService';

/**
 * "Diese Angaben gelten nicht fuer das, was Sie erfasst haben."
 *
 * CO2-Bilanz und Rueckbaubarkeit sind nur fuer die fertige BSP-Platte
 * definiert. Wer ein Vorprodukt erfasst und den Umfang "Gesamte Kette" waehlt,
 * bekommt sie trotzdem -- denn die Platte, die aus dem Vorprodukt entstanden
 * ist, wurde mitgeladen (siehe CLT_PANEL_ONLY_USE_CASES in config/useCases.ts).
 *
 * Genau dann braucht es diesen Hinweis. Ohne ihn scannt jemand eine Lamelle,
 * sieht eine CO2-Bilanz und liest sie als die Bilanz SEINER Lamelle -- die
 * Zahlen gehoeren aber der ganzen Platte, sind also um ein Vielfaches groesser.
 * Eine stille Fehlzuordnung waere hier schlimmer als eine gesperrte Kachel.
 *
 * Bewusst als eigene Datei und nicht je Ansicht kopiert: beide Ansichten
 * muessen denselben Bezug nennen, sonst erklaert die eine, was die andere
 * verschweigt.
 */
interface DownstreamSubjectNoticeProps {
  /** Wird angezeigt? Entscheidet der Aufrufer ueber useCaseRefersToDownstreamPanel. */
  show: boolean;
  product?: Product | null;
  productData?: ProductDataResult | null;
}

export function DownstreamSubjectNotice({
  show,
  product,
  productData,
}: DownstreamSubjectNoticeProps) {
  if (!show) return null;

  const stage = detectProductStage(product ?? null, productData);
  // Ohne bestimmbare Stufe neutral formulieren statt eine Produktart zu
  // behaupten -- dieselbe Vorsicht wie in detectProductStage.
  const erfasst = stage ? stageLabel(stage) : 'das erfasste Bauteil';

  return (
    <div
      className="mb-6 flex items-start gap-3 rounded-2xl border border-sky-400/30 bg-sky-400/10 px-4 py-3"
      role="note"
    >
      <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-sky-300" aria-hidden="true" />
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-sky-100">
          Diese Angaben beziehen sich auf die BSP-Platte.
        </p>
        <p className="mt-1 text-sky-100/80">
          Erfasst wurde {erfasst}. Weil der Umfang „Gesamte Kette" gewählt ist,
          werden die Angaben der BSP-Platte gezeigt, die daraus entstanden ist —
          für Vorprodukte selbst sind sie nicht definiert.
        </p>
      </div>
    </div>
  );
}
