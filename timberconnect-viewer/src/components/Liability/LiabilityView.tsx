import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  FlaskConical,
  Factory,
  ShieldAlert,
  Layers,
  Trees,
  Truck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Product } from '../../types';
import type { ProductDataResult } from '../../services/sparqlService';
import { mapToLiability, type LiabilityField } from '../../services/liabilityMapper';
import {
  getDamageReports,
  type DamageReportRecord,
} from '../../services/damageReportService';
import { productImageFor } from '../../services/productImageService';
import { useOwnProductPhoto } from '../../hooks/useOwnProductPhoto';
import { DocumentDownloadSection } from '../Documents';
import { DamageReportSheet } from './DamageReportSheet';
import { JsonExportButton } from '../UI/JsonExportButton';
import { buildLiabilityExport } from '../../services/useCaseExportService';

/**
 * Anwendungsfall "Nachweis der Haftung".
 *
 * Aus versicherungstechnischer Sicht: im Schadensfall belegen, ob und in
 * welcher Herstellungsstufe eine Abweichung von den geforderten Eigenschaften
 * vorlag -- und welcher Akteur dafuer verantwortlich war. Die Gliederung folgt
 * deshalb der PROZESSKETTE: Herkunft, Einschnitt, Klebstoff, Herstellung,
 * Versand. Jede Kategorie nennt den Akteur, der fuer diese Stufe haftet.
 *
 * Die Informationsanforderungen werden in services/liabilityMapper.ts
 * zusammengesetzt; hier wird nur dargestellt. Drei Dinge unterscheiden diese
 * Ansicht von den uebrigen Anwendungsfaellen:
 *
 * 1. Der Zustand ``assumed`` bekommt eine EIGENE, deutlich sichtbare
 *    Kennzeichnung. "Dafuer gibt es keine Datenquelle, nur eine Annahme" ist
 *    fuer einen Haftungsnachweis eine andere Aussage als "hier wurde nichts
 *    eingetragen" -- wer die beiden verwechselt, haelt eine Modellannahme fuer
 *    einen Nachweis.
 * 2. Die verbleibenden Informationsluecken stehen als eigene Karte in
 *    der Ansicht. Ein Haftungsnachweis, der seine Grenzen verschweigt, waere
 *    als Nachweis wertlos.
 * 3. Der Schadensfall ist Teil der Ansicht, nicht nur ihr Anlass: die Meldung
 *    erfasst den IST-Zustand, den die Gutachterin gegen die dokumentierten
 *    Sollwerte haelt.
 */

interface LiabilityViewProps {
  productId: string;
  product: Product | null;
  /** Rohe Abfrageergebnisse -- Pruefbericht, Leistungserklaerungen, ERP. */
  productData: ProductDataResult | null;
  onBack: () => void;
  /** Fuehrt zum Scan -- Ausweg aus dem Leerzustand. */
  onScanClick?: () => void;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  origin: Trees,
  sawmill: Layers,
  adhesive: FlaskConical,
  production: Factory,
  logistics: Truck,
};

/** Kennzeichnung fehlender Merkmale -- Wortlaut wie in den anderen Awf. */
const NO_DATA = 'Keine Daten verfügbar';

/**
 * Eine Merkmalszeile.
 *
 * ``assumed`` wird in Bernstein ausgezeichnet und traegt das Wort "Annahme"
 * im Wert selbst -- damit ist der Unterschied zu einer schlichten Luecke auch
 * dann sichtbar, wenn nur die Werte-Spalte ueberflogen wird. Die uebrigen
 * fehlenden Merkmale bleiben kursiv-grau wie in Rueckbaubarkeit und
 * Dokumentation, damit sich die Ansichten weiterhin gleich lesen.
 */
function FieldRow({ field }: { field: LiabilityField }) {
  const assumed = field.availability === 'assumed';
  const missing = field.value === null;

  return (
    <div className="flex flex-col sm:flex-row gap-1 sm:gap-3 text-sm py-2 border-b border-white/5 last:border-0">
      <dt className="w-40 sm:w-48 flex-shrink-0 text-night-300 text-xs pt-0.5">
        {field.label}:
      </dt>
      <dd className="flex-1 min-w-0">
        <span
          className={`block text-sm ${
            assumed
              ? 'text-amber-200 font-medium'
              : missing
                ? 'text-night-300 italic'
                : 'text-night-100'
          }`}
        >
          {field.value ?? (assumed ? 'Nur als Annahme modelliert' : NO_DATA)}
        </span>
        {field.note && (
          /* night-300 statt night-400: auf night-800 erreicht night-400 nur
             3.5:1 und liegt damit unter der WCAG-Schwelle von 4.5:1 fuer
             kleinen Text. night-300 kommt auf 5.7:1. */
          <span
            className={`block text-xs leading-relaxed mt-1 ${
              assumed ? 'text-amber-200/70' : 'text-night-300'
            }`}
          >
            {field.note}
          </span>
        )}
      </dd>
    </div>
  );
}

export function LiabilityView({
  productId,
  product,
  productData,
  onBack,
  onScanClick,
}: LiabilityViewProps) {
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const liability = useMemo(
    () => mapToLiability(productData, product),
    [productData, product],
  );

  /**
   * Meldungen aus dem lokalen Index -- Ergaenzung zu denen, die die Abfrage
   * aus dem Pod liefert. Ohne den Index waere eine gerade gespeicherte
   * Meldung bis zum naechsten vollstaendigen Abruf unsichtbar.
   */
  const epc = product?.id ?? productId;
  const [localReports, setLocalReports] = useState<DamageReportRecord[]>([]);
  useEffect(() => {
    setLocalReports(getDamageReports(epc));
  }, [epc]);

  const damageReports = useMemo(() => {
    const seen = new Set(localReports.map((entry) => entry.id));
    return [
      ...localReports.map((entry) => ({
        id: entry.id,
        date: new Date(entry.date).toLocaleDateString('de-DE'),
        kind: entry.kind,
        description: entry.description,
        reportedBy: entry.reportedBy,
        moisture: entry.moisture ? `${entry.moisture} %` : null,
      })),
      ...liability.damageReports.filter((entry) => !seen.has(entry.id)),
    ];
  }, [localReports, liability.damageReports]);

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
            Haftungs<span className="text-acid-400">nachweis</span>
          </h1>
          <div className="bg-night-700/50 border border-white/5 rounded-2xl p-6 mt-6">
            <p className="text-sm text-night-300">
              Für den Haftungsnachweis wird ein Bauteil benötigt. Scannen Sie eine
              Platte oder geben Sie die Produkt-ID ein.
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
        {/* Kopfzeile: Zurueck links, JSON-Export rechts. */}
        <div className="flex items-center justify-between gap-3 mb-5">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-semibold text-night-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Zurück</span>
          </button>
          <JsonExportButton build={() => buildLiabilityExport({ ...liability, damageReports }, productId ?? null)} />
        </div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Haftungs<span className="text-acid-400">nachweis</span>
          </h1>
          <p className="text-sm text-night-300 mt-2 leading-relaxed">
            Konformität, Materialqualität und Prozessverantwortung entlang der
            Lieferkette — nachvollziehbar je Herstellungsstufe.
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
                  useImageFallback ? productImage.fallbackSrc : (ownPhoto ?? productImage.src)
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
                {liability.componentName ?? 'BSP-Platte'}
              </span>
              {liability.strengthClass && (
                <span className="block text-xs text-night-300 truncate">
                  Festigkeitsklasse {liability.strengthClass}
                </span>
              )}
            </span>
          </motion.section>

          {/* Die fuenf Prozessstufen zum Aufklappen */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="space-y-2"
          >
            {liability.categories.map((category) => {
              const Icon = CATEGORY_ICONS[category.id] ?? Factory;
              const open = openCategory === category.id;
              const filled = category.fields.filter(
                (f) => f.availability === 'available' || f.availability === 'derived',
              ).length;

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
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-white truncate">
                        {category.title}
                      </span>
                      {category.actor && (
                        <span className="block text-[11px] text-night-400 truncate">
                          {category.actor}
                          {/* Der GCP ist die einzige BELEGTE Akteursangabe --
                              er steht in jedem Ident dieser Stufe. Die Rolle
                              davor ist nur die Beschriftung der Kategorie. */}
                          {category.companyPrefix && (
                            <>
                              {' · '}
                              <span className="font-mono text-night-300">
                                GCP {category.companyPrefix}
                              </span>
                            </>
                          )}
                        </span>
                      )}
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

          {/* Abdeckungshinweis */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.12 }}
            className="text-xs text-night-300 leading-relaxed px-1"
          >
            {liability.coverage.filled} von {liability.coverage.total}{' '}
            Informationsanforderungen sind für dieses Bauteil belegt. Fehlende
            Angaben sind mit einer Begründung ausgewiesen; als{' '}
            <span className="text-amber-200">Annahme</span> gekennzeichnete Merkmale
            haben keine reale Datenquelle.
          </motion.p>

          {/* Verbleibende Informationsluecken */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-night-800 border border-white/5 rounded-2xl p-4"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white mb-1">
              <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0" />
              Verbleibende Informationslücken
            </h2>
            <p className="text-xs text-night-300 leading-relaxed mb-3">
              Was dieser Nachweis derzeit nicht leisten kann — und warum.
            </p>
            <ul className="space-y-3">
              {liability.gaps.map((gap) => (
                <li key={gap.title} className="border-l-2 border-amber-400/40 pl-3">
                  <p className="text-xs font-semibold text-night-100">{gap.title}</p>
                  <p className="text-xs text-night-300 leading-relaxed mt-0.5">
                    {gap.detail}
                  </p>
                </li>
              ))}
            </ul>
          </motion.section>

          {/* Schadensfall */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 }}
            className="bg-night-800 border border-white/5 rounded-2xl p-4"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white mb-1">
              <ShieldAlert className="w-4 h-4 text-acid-400 flex-shrink-0" />
              Schadensfall
            </h2>
            <p className="text-xs text-night-300 leading-relaxed">
              Im Schadensfall wird der IST-Zustand vor Ort erfasst und gegen die
              oben dokumentierten Sollwerte gehalten.
            </p>

            {damageReports.length > 0 && (
              <ul className="mt-3 space-y-2">
                {damageReports.map((report) => (
                  <li
                    key={report.id}
                    className="rounded-xl bg-night-900 border border-white/5 px-3 py-2"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-night-100 truncate">
                        {report.kind ?? 'Schaden'}
                      </span>
                      <span className="text-[11px] text-night-400 flex-shrink-0 tabular-nums">
                        {report.date ?? ''}
                      </span>
                    </div>
                    {report.description && (
                      <p className="text-xs text-night-300 leading-relaxed mt-1">
                        {report.description}
                      </p>
                    )}
                    <p className="text-[11px] text-night-400 mt-1">
                      {[report.reportedBy, report.moisture && `Holzfeuchte ${report.moisture}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <button
              onClick={() => setSheetOpen(true)}
              className="mt-3 px-4 py-2 rounded-xl bg-acid-400 text-night-950 text-sm font-semibold hover:bg-acid-300 transition-colors"
            >
              Schaden melden
            </button>
          </motion.section>

          {/* Downloadbereich -- Leistungserklaerungen, Pruefbericht, Datenblatt */}
          <DocumentDownloadSection
            productId={productId}
            productData={productData}
            delay={0.2}
          />
        </div>
      </div>

      {sheetOpen && (
        <DamageReportSheet
          epc={epc}
          componentName={liability.componentName}
          onClose={() => setSheetOpen(false)}
          onSaved={(record) => setLocalReports((prev) => [record, ...prev])}
        />
      )}
    </div>
  );
}
