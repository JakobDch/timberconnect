import { motion } from 'framer-motion';
import { TreePine, Truck, Factory, Cog, Building2, MapPin, CheckCircle2, Calendar, ExternalLink } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SupplyChainStep } from '../../types';

const stageIcons: Record<string, LucideIcon> = {
  forest: TreePine,
  transport: Truck,
  sawmill: Factory,
  manufacturer: Cog,
  construction: Building2,
};

const stageLabels: Record<string, string> = {
  forest: 'Forstwirtschaft',
  transport: 'Logistik',
  sawmill: 'Sägewerk',
  manufacturer: 'Verarbeitung',
  construction: 'Verbau',
};

interface SupplyChainTimelineProps {
  steps: SupplyChainStep[];
}

export function SupplyChainTimeline({ steps }: SupplyChainTimelineProps) {
  return (
    <div className="relative space-y-6">
      {steps.map((step, index) => {
        const Icon = stageIcons[step.stage] || Factory;
        const isLast = index === steps.length - 1;
        const stageLabel = stageLabels[step.stage] || step.stage;

        return (
          <motion.div
            key={step.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="relative flex gap-5"
          >
            {/* Timeline connector */}
            {!isLast && (
              <div
                className="absolute left-7 top-[72px] w-0.5 h-[calc(100%-40px)] bg-gradient-to-b from-forest-300 to-forest-200"
                style={{ zIndex: 0 }}
              />
            )}

            {/* Step indicator */}
            <div className="flex flex-col items-center gap-3 flex-shrink-0 relative z-10">
              {/* Icon node */}
              <div className="relative w-14 h-14 rounded-2xl bg-forest-500 flex items-center justify-center shadow-lg shadow-forest-500/20">
                <Icon className="w-7 h-7 text-white" />
                {/* Check badge */}
                <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-md border border-gray-100">
                  <CheckCircle2 className="w-4 h-4 text-forest-500" />
                </div>
              </div>
              {/* Step number */}
              <span className="text-xs font-bold text-timber-gray bg-gray-100 px-2 py-0.5 rounded-full">
                {index + 1}/{steps.length}
              </span>
            </div>

            {/* Content card */}
            <div className="flex-1 bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 shadow-soft hover:shadow-soft-lg transition-shadow">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                <div className="flex-1">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-forest-100 text-forest-700 mb-2">
                    {stageLabel}
                  </span>
                  <h4 className="font-bold text-timber-dark text-lg">
                    {step.company}
                  </h4>
                </div>
                <div className="flex items-center gap-2 text-sm text-timber-gray bg-gray-100 px-3 py-1.5 rounded-lg">
                  <Calendar className="w-4 h-4" />
                  <span className="font-medium">{step.date}</span>
                </div>
              </div>

              {/* Description */}
              <p className="text-timber-gray mb-4 leading-relaxed">{step.description}</p>

              {/* Location */}
              <div className="flex items-center justify-between gap-4 pb-5 mb-5 border-b border-gray-100">
                <div className="flex items-center gap-2 text-timber-gray">
                  <MapPin className="w-4 h-4" />
                  <span className="text-sm">{step.location}</span>
                </div>
                <button className="btn btn-ghost btn-sm gap-1.5 text-xs text-timber-gray hover:text-timber-dark">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Details
                </button>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {step.details.map((detail, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-3.5">
                    <p className="text-[10px] text-timber-gray uppercase tracking-wider font-semibold mb-1">
                      {detail.label}
                    </p>
                    <p className="text-sm font-bold text-timber-dark">
                      {detail.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        );
      })}

      {/* End marker */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: steps.length * 0.1 }}
        className="flex items-center gap-5 pt-2"
      >
        <div className="w-14 flex justify-center">
          <div className="w-5 h-5 rounded-full bg-forest-500 shadow-lg shadow-forest-500/30 flex items-center justify-center">
            <CheckCircle2 className="w-3 h-3 text-white" />
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-2 bg-forest-50 border border-forest-200 rounded-xl">
          <CheckCircle2 className="w-5 h-5 text-forest-600" />
          <span className="text-sm font-semibold text-forest-700">
            Lieferkette vollständig dokumentiert
          </span>
        </div>
      </motion.div>
    </div>
  );
}
