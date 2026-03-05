import { motion } from 'framer-motion';
import type { ProductType } from '../../types';

// Use Vite's base URL for correct path resolution
const BASE_URL = import.meta.env.BASE_URL;

const PRODUCT_IMAGES: Record<ProductType, string> = {
  finished: `${BASE_URL}images/bsp-plate-placeholder.svg`,
  raw_material: `${BASE_URL}images/tree-stump-placeholder.svg`
};

const PRODUCT_LABELS: Record<ProductType, string> = {
  finished: 'BSP-Platte',
  raw_material: 'Rundholz'
};

interface ProductImageSectionProps {
  productType?: ProductType;
  productName: string;
}

export function ProductImageSection({ productType = 'finished', productName }: ProductImageSectionProps) {
  const imageSrc = PRODUCT_IMAGES[productType];
  const label = PRODUCT_LABELS[productType];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.1, duration: 0.3 }}
      className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-gradient-to-br from-forest-50 to-forest-100 border border-gray-200 shadow-soft"
    >
      {/* Image container */}
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <img
          src={imageSrc}
          alt={productName}
          className="max-h-full max-w-full object-contain drop-shadow-sm"
        />
      </div>

      {/* Product type badge */}
      <div className="absolute top-4 left-4">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/90 backdrop-blur-sm text-forest-700 text-xs font-semibold rounded-full shadow-sm border border-forest-200">
          {label}
        </span>
      </div>

      {/* Decorative gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-forest-900/5 to-transparent pointer-events-none" />
    </motion.div>
  );
}
