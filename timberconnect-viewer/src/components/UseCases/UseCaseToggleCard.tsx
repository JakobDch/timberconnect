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
  MapPin,
  Award,
  BadgeCheck,
  MessageCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ToggleSwitch } from '../UI/ToggleSwitch';
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
  'map-pin': MapPin,
  award: Award,
  'badge-check': BadgeCheck,
  'message-circle': MessageCircle,
};

interface UseCaseToggleCardProps {
  useCase: UseCase;
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  onClick: () => void;
}

export function UseCaseToggleCard({
  useCase,
  isEnabled,
  onToggle,
  onClick
}: UseCaseToggleCardProps) {
  const Icon = iconMap[useCase.icon] || FileText;
  const isInteractive = useCase.active && isEnabled;

  return (
    <motion.div
      className={`
        relative h-full p-5 rounded-2xl border transition-all
        ${isInteractive
          ? 'bg-white border-gray-200 shadow-soft hover:border-forest-300 hover:shadow-forest'
          : 'bg-gray-50 border-gray-200'
        }
      `}
      whileHover={isInteractive ? { y: -2 } : {}}
      transition={{ duration: 0.2 }}
    >
      {/* Toggle in top right */}
      <div className="absolute top-4 right-4">
        <ToggleSwitch
          checked={isEnabled}
          onChange={onToggle}
          disabled={!useCase.active}
          size="sm"
        />
      </div>

      {/* Icon */}
      <div
        className={`
          w-12 h-12 rounded-xl flex items-center justify-center mb-4
          ${isEnabled && useCase.active
            ? 'bg-forest-500 shadow-lg shadow-forest-500/20'
            : 'bg-gray-200'
          }
        `}
      >
        <Icon
          className={`w-6 h-6 ${isEnabled && useCase.active ? 'text-white' : 'text-gray-400'}`}
        />
      </div>

      {/* Title */}
      <h3
        className={`font-bold mb-1.5 text-base pr-12 ${
          isEnabled ? 'text-timber-dark' : 'text-gray-400'
        }`}
      >
        {useCase.title}
      </h3>

      {/* Description */}
      <p
        className={`text-sm leading-relaxed mb-5 line-clamp-2 ${
          isEnabled ? 'text-timber-gray' : 'text-gray-400'
        }`}
      >
        {useCase.description}
      </p>

      {/* CTA */}
      {isInteractive ? (
        <button
          onClick={onClick}
          className="flex items-center text-forest-600 text-sm font-semibold hover:text-forest-700 transition-colors group"
        >
          <span>Offnen</span>
          <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
        </button>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-gray-200 text-gray-500 rounded-full">
          {useCase.active ? 'Deaktiviert' : 'Demnachst verfugbar'}
        </span>
      )}
    </motion.div>
  );
}
