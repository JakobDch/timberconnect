import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { Product, ProductType } from '../../types';
import type { ProductDataResult } from '../../services/sparqlService';
import {
  productImageFor,
  productImageForStage,
  stageFromProductType,
  type ProductImage,
} from '../../services/productImageService';
import { useOwnProductPhoto } from '../../hooks/useOwnProductPhoto';

/**
 * Produktbild mit Beschriftung.
 *
 * Welche Stufe der Wertschoepfungskette vorliegt -- Saatgut, Rundholz,
 * Lamelle, BSP-Platte oder verbautes Bauteil -- entscheidet
 * services/productImageService.ts; hier wird nur dargestellt.
 *
 * Bis ein reales Foto unter ``public/images/`` liegt, zeigt die Kachel die
 * bisherige SVG-Illustration. Das passiert ueber ``onError``: der Browser
 * meldet das fehlende Bild, und die Kachel schaltet auf den Fallback um --
 * statt ein kaputtes Bildsymbol zu zeigen. Beim Nachliefern eines Fotos
 * genuegt es, die Datei abzulegen; am Code aendert sich nichts.
 */

interface ProductImageSectionProps {
  /** Bevorzugt: das ganze Produkt -- erlaubt die feine Erkennung. */
  product?: Product | null;
  /** Rohdaten der Abfrage; schaerfen die Erkennung zusaetzlich. */
  productData?: ProductDataResult | null;
  /** Rueckfallebene fuer Aufrufer, die nur den groben Typ kennen. */
  productType?: ProductType;
  productName: string;
  /**
   * ``compact`` fuellt den vom Aufrufer vorgegebenen Rahmen quadratisch und
   * laesst das Produktart-Band weg -- fuer die Kurzinfo nach dem Scan, wo das
   * Bild nur der Wiedererkennung dient und die Produktart bereits daneben
   * steht. ``default`` bleibt die grosse 4:3-Kachel der Detailansichten.
   */
  variant?: 'default' | 'compact';
}

export function ProductImageSection({
  product,
  productData,
  productType,
  productName,
  variant = 'default',
}: ProductImageSectionProps) {
  const compact = variant === 'compact';
  // Ohne belegten RDF-Typ in den Stammdaten wird die Produktart bewusst NICHT
  // geraten. Dann steht hier ein neutrales Bild ohne Beschriftung, statt eine
  // falsche Produktart zu behaupten (frueher landete so jedes Rundholz als
  // "BSP-Platte" in der Ansicht).
  const detected: ProductImage | null = product
    ? productImageFor(product, productData)
    : productImageForStage(stageFromProductType(productType));

  const image: ProductImage = detected ?? {
    stage: 'stem',
    src: '',
    fallbackSrc: `${import.meta.env.BASE_URL}images/tree-stump-placeholder.svg`,
    label: '',
    alt: 'Produktart aus den Stammdaten nicht bestimmbar',
  };

  // Eigenes Foto des Uploaders, falls beim Vorgang eines hinterlegt wurde.
  const ownPhoto = useOwnProductPhoto(product, productData);

  // Wechselt auf die Illustration, sobald das Foto nicht geladen werden kann.
  const [useFallback, setUseFallback] = useState(false);

  // Bei einem anderen Produkt wieder das Foto versuchen -- sonst bliebe die
  // Kachel nach einem einzigen fehlenden Bild dauerhaft beim Platzhalter.
  useEffect(() => {
    setUseFallback(false);
  }, [image.src, ownPhoto]);

  // Reihenfolge: eigenes Foto -> Standardbild der Produktart -> Illustration.
  const source = useFallback ? image.fallbackSrc : (ownPhoto ?? image.src);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.1, duration: 0.3 }}
      className={`relative rounded-2xl overflow-hidden bg-night-700/40 border border-white/10 ${
        compact ? 'w-full h-full' : 'aspect-[4/3]'
      }`}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <img
          src={source}
          alt={image.alt || productName}
          onError={() => setUseFallback(true)}
          /* Fotos fuellen die Kachel, Illustrationen behalten ihre Proportion
             und brauchen Luft -- sonst wirken sie beschnitten. In der kleinen
             Kachel faellt die Luft knapper aus, sonst bleibt vom Motiv nichts. */
          className={
            useFallback
              ? `max-h-full max-w-full object-contain drop-shadow-sm ${compact ? 'p-3' : 'p-6'}`
              : 'w-full h-full object-cover'
          }
        />
      </div>

      {/* Produktart-Badge — entfaellt, wenn die Stammdaten keinen Typ nennen.
          In der kompakten Kachel ebenfalls: dort steht die Produktart bereits
          als eigener Chip daneben, zweimal waere es Redundanz auf engstem Raum. */}
      {image.label && !compact && (
        <div className="absolute top-4 left-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-night-900/80 backdrop-blur-sm text-acid-300 text-xs font-semibold rounded-full border border-acid-400/30">
            {image.label}
          </span>
        </div>
      )}

      {/* Verlauf nach unten -- haelt die Beschriftung auf Fotos lesbar. */}
      <div className="absolute inset-0 bg-gradient-to-t from-night-950/40 to-transparent pointer-events-none" />
    </motion.div>
  );
}
