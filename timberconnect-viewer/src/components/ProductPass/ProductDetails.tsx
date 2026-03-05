import { motion } from 'framer-motion';
import {
  Ruler,
  Scale,
  Droplets,
  TreePine,
  MapPin,
  Shield,
  Award,
  Building2,
  Thermometer,
  FileText,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import type { Product } from '../../types';

interface ProductDetailsProps {
  product: Product;
}

export function ProductDetails({ product }: ProductDetailsProps) {
  // Helper for dimensions with fallback
  const dims = product.dimensions || { length: 0, width: 0, thickness: 0, unit: 'mm' };
  const origin = product.origin || { region: 'Keine Daten verfügbar', country: 'Deutschland', coordinates: { lat: 0, lng: 0 } };
  const certifications = product.certifications || [];

  const dimensionCards = [
    { icon: Ruler, label: 'Länge', value: dims.length ? `${dims.length} ${dims.unit}` : '-' },
    { icon: Ruler, label: 'Breite', value: dims.width ? `${dims.width} ${dims.unit}` : '-' },
    { icon: Ruler, label: 'Dicke', value: dims.thickness ? `${dims.thickness} ${dims.unit}` : '-' },
    { icon: Scale, label: 'Gewicht', value: '~15 kg' },
  ];

  const technicalSpecs = [
    { icon: TreePine, label: 'Holzart', value: product.woodType || '-' },
    { icon: Shield, label: 'Qualitätsklasse', value: product.quality || '-' },
    { icon: Droplets, label: 'Feuchtegehalt', value: '12%' },
    { icon: Thermometer, label: 'Temperaturbeständig', value: '-30°C bis +60°C' },
    { icon: Building2, label: 'Verwendungszweck', value: 'Konstruktionsholz' },
    { icon: FileText, label: 'Norm', value: 'DIN EN 14080' },
  ];

  return (
    <div className="space-y-8">
      {/* Dimensions Section */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-forest-100 flex items-center justify-center">
            <Ruler className="w-5 h-5 text-forest-600" />
          </div>
          <div>
            <h3 className="font-bold text-timber-dark">Abmessungen & Gewicht</h3>
            <p className="text-sm text-timber-gray">Physische Produkteigenschaften</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {dimensionCards.map((card, index) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-white rounded-2xl border border-gray-200 p-5 shadow-soft hover:shadow-soft-lg transition-shadow"
            >
              <div className="w-12 h-12 rounded-xl bg-forest-500 flex items-center justify-center mb-4 shadow-lg shadow-forest-500/20">
                <card.icon className="w-6 h-6 text-white" />
              </div>
              <p className="text-xs text-timber-gray uppercase tracking-wider font-semibold mb-1">
                {card.label}
              </p>
              <p className="text-2xl font-bold text-timber-dark">{card.value}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Technical Specifications */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-forest-100 flex items-center justify-center">
            <FileText className="w-5 h-5 text-forest-600" />
          </div>
          <div>
            <h3 className="font-bold text-timber-dark">Technische Spezifikationen</h3>
            <p className="text-sm text-timber-gray">Detaillierte Produktmerkmale</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-soft overflow-hidden">
          <div className="divide-y divide-gray-100">
            {technicalSpecs.map((spec, index) => (
              <motion.div
                key={spec.label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <spec.icon className="w-5 h-5 text-forest-500" />
                  <span className="text-timber-gray">{spec.label}</span>
                </div>
                <span className="font-semibold text-timber-dark">{spec.value}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Origin Section */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-forest-100 flex items-center justify-center">
            <MapPin className="w-5 h-5 text-forest-600" />
          </div>
          <div>
            <h3 className="font-bold text-timber-dark">Herkunft & Nachhaltigkeit</h3>
            <p className="text-sm text-timber-gray">Wald- und Forstinformationen</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-soft p-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-timber-dark mb-4 flex items-center gap-2">
                <TreePine className="w-5 h-5 text-forest-500" />
                Waldgebiet
              </h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <span className="text-timber-gray">Region</span>
                  <span className="font-medium text-timber-dark">{origin.region}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <span className="text-timber-gray">Koordinaten</span>
                  <span className="font-medium text-timber-dark">
                    {origin.coordinates.lat && origin.coordinates.lng
                      ? `${origin.coordinates.lat}° N, ${origin.coordinates.lng}° E`
                      : 'Keine Daten verfügbar'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <span className="text-timber-gray">Einschlagdatum</span>
                  <span className="font-medium text-timber-dark">{product.harvestDate || '-'}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-timber-gray">Land</span>
                  <span className="font-medium text-timber-dark">{origin.country}</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-timber-dark mb-4 flex items-center gap-2">
                <Shield className="w-5 h-5 text-forest-500" />
                Zertifizierungen
              </h4>
              <div className="space-y-3">
                {certifications.length > 0 ? (
                  certifications.map((cert) => (
                    <motion.div
                      key={cert}
                      whileHover={{ scale: 1.01 }}
                      className="flex items-center justify-between p-4 bg-forest-50 border border-forest-200 rounded-xl cursor-pointer group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
                          <Award className="w-5 h-5 text-forest-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-timber-dark">{cert}</p>
                          <p className="text-xs text-timber-gray">Zertifikat gültig</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-forest-600" />
                        <ExternalLink className="w-4 h-4 text-timber-gray group-hover:text-forest-600 transition-colors" />
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="text-timber-gray text-sm p-4 bg-gray-50 rounded-xl">
                    Keine Zertifizierungen verfügbar
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CO2 Section */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-forest-100 flex items-center justify-center">
            <TreePine className="w-5 h-5 text-forest-600" />
          </div>
          <div>
            <h3 className="font-bold text-timber-dark">CO₂-Bilanz</h3>
            <p className="text-sm text-timber-gray">Klimawirkung des Produkts</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-forest-50 to-forest-100/50 rounded-2xl border border-forest-200 p-6">
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="text-center p-4">
              <div className="text-3xl font-bold text-forest-700 mb-1">-45 kg</div>
              <p className="text-sm text-timber-gray">CO₂ gespeichert</p>
            </div>
            <div className="text-center p-4 border-l border-r border-forest-200">
              <div className="text-3xl font-bold text-forest-700 mb-1">12 kg</div>
              <p className="text-sm text-timber-gray">CO₂ Transport</p>
            </div>
            <div className="text-center p-4">
              <div className="text-3xl font-bold text-forest-700 mb-1">-33 kg</div>
              <p className="text-sm text-timber-gray">Netto CO₂-Bilanz</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-forest-200 flex items-center justify-center gap-2 text-forest-700">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-medium">Dieses Produkt ist klimapositiv</span>
          </div>
        </div>
      </section>
    </div>
  );
}
