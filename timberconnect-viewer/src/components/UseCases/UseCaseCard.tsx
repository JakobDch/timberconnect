import { motion } from 'framer-motion';
import {
  FileText,
  Leaf,
  Recycle,
  GitBranch,
  Building,
  Wrench,
  Hammer,
  RefreshCw,
  ArrowRight,
  Lock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { UseCase } from '../../types';

const iconMap: Record<string, LucideIcon> = {
  'file-text': FileText,
  leaf: Leaf,
  recycle: Recycle,
  'git-branch': GitBranch,
  building: Building,
  wrench: Wrench,
  hammer: Hammer,
  'refresh-cw': RefreshCw,
};

interface UseCaseCardProps {
  useCase: UseCase;
  onClick: () => void;
}

export function UseCaseCard({ useCase, onClick }: UseCaseCardProps) {
  const Icon = iconMap[useCase.icon] || FileText;

  if (!useCase.active) {
    return (
      <div className="relative h-full p-5 rounded-2xl bg-gray-50 border border-gray-200">
        <div className="absolute top-4 right-4">
          <Lock className="w-4 h-4 text-gray-300" />
        </div>

        <div className="w-12 h-12 rounded-xl bg-gray-200 flex items-center justify-center mb-4">
          <Icon className="w-6 h-6 text-gray-400" />
        </div>

        <h3 className="font-semibold text-gray-400 mb-1.5">{useCase.title}</h3>
        <p className="text-sm text-gray-400 leading-relaxed mb-4 line-clamp-2">
          {useCase.description}
        </p>

        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-gray-200 text-gray-500 rounded-full">
          Demnächst verfügbar
        </span>
      </div>
    );
  }

  return (
    <motion.button
      onClick={onClick}
      className="relative h-full w-full p-5 rounded-2xl text-left bg-white border border-gray-200 shadow-soft group hover:border-forest-300 hover:shadow-forest transition-all"
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
    >
      {/* Available Badge */}
      <div className="absolute -top-2.5 -right-2">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-forest-500 text-white text-[10px] font-semibold uppercase tracking-wider rounded-full">
          Aktiv
        </span>
      </div>

      {/* Icon */}
      <div className="w-12 h-12 rounded-xl bg-forest-500 flex items-center justify-center mb-4 shadow-lg shadow-forest-500/20">
        <Icon className="w-6 h-6 text-white" />
      </div>

      {/* Title */}
      <h3 className="font-bold text-timber-dark mb-1.5 text-base">
        {useCase.title}
      </h3>

      {/* Description */}
      <p className="text-sm text-timber-gray leading-relaxed mb-5 line-clamp-2">
        {useCase.description}
      </p>

      {/* CTA */}
      <div className="flex items-center text-forest-600 text-sm font-semibold group-hover:text-forest-700 transition-colors">
        <span>Öffnen</span>
        <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
      </div>
    </motion.button>
  );
}
