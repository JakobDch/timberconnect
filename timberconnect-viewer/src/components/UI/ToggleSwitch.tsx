import { motion } from 'framer-motion';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  size = 'md'
}: ToggleSwitchProps) {
  const sizes = {
    sm: { track: 'w-9 h-5', thumb: 'w-4 h-4', translate: 16 },
    md: { track: 'w-11 h-6', thumb: 'w-5 h-5', translate: 20 }
  };

  const s = sizes[size];

  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`
        relative inline-flex items-center rounded-full transition-colors duration-200
        ${s.track}
        ${checked ? 'bg-forest-500' : 'bg-gray-300'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-90'}
        focus:outline-none focus:ring-2 focus:ring-forest-500 focus:ring-offset-2
      `}
    >
      <motion.span
        animate={{ x: checked ? s.translate : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className={`
          inline-block rounded-full bg-white shadow-md
          ${s.thumb}
        `}
      />
    </button>
  );
}
