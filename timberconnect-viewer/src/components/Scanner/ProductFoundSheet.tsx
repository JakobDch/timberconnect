import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import type { Product } from '../../types';
import { SheetPortal, useBodyScrollLock } from '../UI/SheetPortal';

/**
 * "Bauteil erkannt" Bottom-Sheet (neue UI-Vorgabe, Scan-Screen).
 * Zeigt die wichtigsten Produktdaten und fuehrt weiter zum Produktpass.
 */

interface ProductFoundSheetProps {
  product: Product | null;
  onOpenPass: () => void;
  onClose: () => void;
  /** Titel des vorgewaehlten Anwendungsfalls -- steht er fest, fuehrt der
      Button dorthin statt in die Auswahl. */
  targetUseCaseTitle?: string | null;
}

export function ProductFoundSheet({
  product,
  onOpenPass,
  onClose,
  targetUseCaseTitle = null,
}: ProductFoundSheetProps) {
  useBodyScrollLock(product !== null);

  const rows: { label: string; value: string }[] = [];

  if (product) {
    rows.push({ label: 'Produkt-ID', value: product.id });
    if (product.woodType) {
      rows.push({
        label: 'Holzart',
        value: product.woodTypeScientific
          ? `${product.woodType} / ${product.woodTypeScientific}`
          : product.woodType,
      });
    }
    if (product.origin) {
      const parts = [product.origin.region, product.origin.country].filter(
        Boolean
      );
      if (parts.length > 0) {
        rows.push({ label: 'Herkunft', value: parts.join(', ') });
      }
    }
    if (product.certifications && product.certifications.length > 0) {
      rows.push({
        label: 'Zertifizierung',
        value: product.certifications.join(', '),
      });
    }
    if (product.harvestDate) {
      rows.push({ label: 'Produktionsdatum', value: product.harvestDate });
    }
    if (product.quality) {
      rows.push({ label: 'Qualität', value: product.quality });
    }
  }

  return (
    <SheetPortal>
      <AnimatePresence>
        {product && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-night-950/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="w-full sm:max-w-md bg-night-800 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Kopf */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-xl bg-acid-400/15 border border-acid-400/30 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-5 h-5 text-acid-300" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold tracking-[0.14em] text-acid-300 uppercase">
                  Bauteil erkannt
                </p>
                <h2 className="text-lg font-bold text-white truncate">
                  {product.name}
                </h2>
              </div>
            </div>

            {/* Detailzeilen */}
            <div className="bg-night-900/70 border border-white/5 rounded-2xl divide-y divide-white/5 mb-5">
              {rows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-4 px-4 py-3"
                >
                  <span className="text-sm text-night-300 flex-shrink-0">
                    {row.label}
                  </span>
                  <span className="text-sm font-semibold text-white text-right break-words min-w-0">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Aktionen */}
            <div className="space-y-2.5">
              <button onClick={onOpenPass} className="btn btn-acid w-full">
                <span>
                  {targetUseCaseTitle
                    ? `Weiter zu „${targetUseCaseTitle}“`
                    : 'Produktpass öffnen'}
                </span>
                <ArrowRight className="w-5 h-5" />
              </button>
              <button onClick={onClose} className="btn btn-night w-full">
                Schließen
              </button>
            </div>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
    </SheetPortal>
  );
}
