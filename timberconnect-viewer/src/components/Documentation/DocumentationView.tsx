import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Box,
  ChevronDown,
  Home,
  Info,
  Link2,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Product } from '../../types';
import type { ProductDataResult } from '../../services/sparqlService';
import {
  mapToDocumentation,
  type DocumentationField,
} from '../../services/documentationMapper';
import { productImageFor } from '../../services/productImageService';
import { useOwnProductPhoto } from '../../hooks/useOwnProductPhoto';
import { DocumentDownloadSection } from '../Documents';

/**
 * Anwendungsfall "Dokumentation" (Awf-Vorgabe, Visualisierung S. 1).
 *
 * Die produktbegleitende Dokumentation des Bauteils bis zum Einbau im
 * Gebaeude: allgemeine Angaben zur Brettsperrholzplatte, darunter VIER
 * aufklappbare Kategorien (Verortung im Gebaeude, Gewicht und Abmessungen,
 * Einbau, Hersteller) und der Downloadbereich der zugehoerigen Dokumente.
 *
 * Die Informationsanforderungen werden in services/documentationMapper.ts
 * zusammengesetzt; hier wird nur dargestellt. Merkmale, die die Beispieldaten
 * nicht hergeben, werden bewusst NICHT versteckt: sie erscheinen mit einer
 * Begruendung, warum sie fehlen. Genau diese Luecken sichtbar zu machen, ist
 * laut Awf-Vorgabe Teil des Anwendungsfalls ("auch wichtig zu zeigen!").
 *
 * Die Kategorie "Einbau" ist laut Vorgabe aktuell nicht befuellbar und traegt
 * deshalb einen eigenen Hinweis im Kopf -- sonst laese sich der leere Inhalt
 * als Fehler statt als Aussage.
 */

interface DocumentationViewProps {
  productId: string;
  product: Product | null;
  /** Rohe Abfrageergebnisse -- ERP-Panel, Leistungserklaerung, Planung. */
  productData: ProductDataResult | null;
  onBack: () => void;
  /** Fuehrt zum Scan -- Ausweg aus dem Leerzustand. */
  onScanClick?: () => void;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  location: Home,
  dimensions: Box,
  installation: Link2,
  manufacturer: UserRound,
};

/** Kennzeichnung fehlender Merkmale -- Wortlaut wie in den anderen Awf. */
const NO_DATA = 'Keine Daten verfügbar';

/**
 * Eine Merkmalszeile.
 *
 * Fehlende Merkmale tragen ihre Begruendung darunter, damit der Unterschied
 * zwischen "nicht erhoben" und "nicht vorgesehen" sichtbar wird, ohne die
 * Liste zu ueberladen. Identisch zur Rueckbaubarkeit -- beide Ansichten
 * sollen sich gleich lesen.
 */
function FieldRow({ field }: { field: DocumentationField }) {
  const missing = field.value === null;

  return (
    <div className="flex flex-col sm:flex-row gap-1 sm:gap-3 text-sm py-2 border-b border-white/5 last:border-0">
      <dt className="w-40 sm:w-48 flex-shrink-0 text-night-300 text-xs pt-0.5">
        {field.label}:
      </dt>
      <dd className="flex-1 min-w-0">
        <span
          className={`block text-sm ${missing ? 'text-night-300 italic' : 'text-night-100'}`}
        >
          {field.value ?? NO_DATA}
        </span>
        {field.note && (
          /* night-300 statt night-400: auf night-800 erreicht night-400 nur
             3.5:1 und liegt damit unter der WCAG-Schwelle von 4.5:1 fuer
             kleinen Text. night-300 kommt auf 5.7:1. */
          <span className="block text-xs leading-relaxed mt-1 text-night-300">
            {field.note}
          </span>
        )}
      </dd>
    </div>
  );
}

export function DocumentationView({
  productId,
  product,
  productData,
  onBack,
  onScanClick,
}: DocumentationViewProps) {
  // Wie in der Visualisierung: eine Kategorie zur Zeit offen.
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  const documentation = useMemo(
    () => mapToDocumentation(productData, product),
    [productData, product],
  );

  // Produktfoto der erkannten Stufe. Nennen die Stammdaten keinen Typ, wird
  // die Produktart nicht geraten -- dann bleibt es beim neutralen Platzhalter.
  const productImage = useMemo(
    () =>
      productImageFor(product, productData) ?? {
        stage: 'clt-panel' as const,
        src: '',
        fallbackSrc: `${import.meta.env.BASE_URL}images/bsp-plate-placeholder.svg`,
        label: '',
        alt: 'Produktart aus den Stammdaten nicht bestimmbar',
      },
    [product, productData],
  );
  // Eigenes Foto des Uploaders hat Vorrang vor dem Standardbild.
  const ownPhoto = useOwnProductPhoto(product, productData);
  const [useImageFallback, setUseImageFallback] = useState(false);
  useEffect(() => {
    setUseImageFallback(false);
  }, [productImage.src, ownPhoto]);

  // --- Leerzustand --------------------------------------------------------
  if (!product) {
    return (
      <div className="flex-1 bg-night-900">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-semibold text-night-300 hover:text-white transition-colors mb-5"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Zurück</span>
          </button>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mb-2">
            Doku<span className="text-acid-400">mentation</span>
          </h1>
          <div className="bg-night-700/50 border border-white/5 rounded-2xl p-6 mt-6">
            <p className="text-sm text-night-300">
              Für die produktbegleitende Dokumentation wird ein Bauteil benötigt.
              Scannen Sie eine Platte oder geben Sie die Produkt-ID ein.
            </p>
            <button
              onClick={onScanClick ?? onBack}
              className="mt-4 px-4 py-2 rounded-xl bg-acid-400 text-night-950 text-sm font-semibold hover:bg-acid-300 transition-colors"
            >
              Bauteil erfassen
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-night-900">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-night-300 hover:text-white transition-colors mb-5"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Zurück</span>
        </button>

        {/* Titel + Beschreibung */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Doku<span className="text-acid-400">mentation</span>
          </h1>
          <p className="text-sm text-night-300 mt-2 leading-relaxed">
            Produktbegleitende Dokumentation des Bauteils bis zum Einbau im
            Gebäude.
          </p>
        </motion.div>

        <div className="space-y-4">
          {/* Bauteilkarte */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-night-800 border border-white/5 rounded-2xl p-4 flex items-center gap-4"
          >
            <span className="w-20 h-20 rounded-xl overflow-hidden bg-night-700 border border-white/5 flex items-center justify-center flex-shrink-0">
              <img
                src={
                  useImageFallback
                    ? productImage.fallbackSrc
                    : (ownPhoto ?? productImage.src)
                }
                alt={productImage.alt}
                onError={() => setUseImageFallback(true)}
                className={
                  useImageFallback
                    ? 'max-h-full max-w-full object-contain p-3'
                    : 'w-full h-full object-cover'
                }
              />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold tracking-widest text-night-400 uppercase">
                Bauteil
              </span>
              <span className="block text-xl font-extrabold text-white truncate">
                {documentation.componentName ?? 'BSP-Platte'}
              </span>
              {documentation.componentType && (
                <span className="block text-xs text-night-300 truncate">
                  {documentation.componentType}
                </span>
              )}
            </span>
          </motion.section>

          {/* Allgemeine Informationen -- in der Visualisierung ueber den
              Kategorien, nicht als eigene Klappe. */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="bg-night-800 border border-white/5 rounded-2xl p-4"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white mb-3">
              <Info className="w-4 h-4 text-acid-400 flex-shrink-0" />
              Allgemeine Informationen
            </h2>
            <dl>
              {documentation.general.map((field) => (
                <FieldRow key={field.id} field={field} />
              ))}
            </dl>
          </motion.section>

          {/* Die vier Kategorien zum Aufklappen */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-2"
          >
            {documentation.categories.map((category) => {
              const Icon = CATEGORY_ICONS[category.id] ?? Box;
              const open = openCategory === category.id;
              const filled = category.fields.filter((f) => f.value !== null).length;

              return (
                <div
                  key={category.id}
                  className={`bg-night-800 border rounded-2xl overflow-hidden transition-colors ${
                    open ? 'border-acid-400/40' : 'border-white/5'
                  }`}
                >
                  <button
                    onClick={() => setOpenCategory(open ? null : category.id)}
                    aria-expanded={open}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                  >
                    <Icon
                      className={`w-4 h-4 flex-shrink-0 ${open ? 'text-acid-400' : 'text-night-300'}`}
                    />
                    <span className="flex-1 min-w-0 text-sm font-semibold text-white truncate">
                      {category.title}
                    </span>
                    <span className="text-[11px] tabular-nums text-night-400 flex-shrink-0">
                      {filled}/{category.fields.length}
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
                        <div className="px-4 pb-4">
                          <p className="text-xs text-night-300 leading-relaxed mb-3">
                            {category.description}
                          </p>
                          <dl>
                            {category.fields.map((field) => (
                              <FieldRow key={field.id} field={field} />
                            ))}
                          </dl>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </motion.section>

          {/* Abdeckungshinweis -- die Luecken gehoeren zur Aussage des Awf. */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="text-xs text-night-300 leading-relaxed px-1"
          >
            {documentation.coverage.filled} von {documentation.coverage.total} Angaben
            zu diesem Bauteil sind belegt. Fehlende Angaben sind mit einer
            Begründung ausgewiesen.
          </motion.p>

          {/* Downloadbereich (geteilt, einklappbar) */}
          <DocumentDownloadSection
            productId={productId}
            productData={productData}
            delay={0.2}
          />
        </div>
      </div>
    </div>
  );
}
