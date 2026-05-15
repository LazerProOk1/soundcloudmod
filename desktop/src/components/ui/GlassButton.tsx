import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

type Variant = 'ghost' | 'primary' | 'icon';

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Variant;
  active?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium cursor-pointer select-none disabled:opacity-40 disabled:pointer-events-none transition-all duration-300 ease-[var(--ease-spring)]';

/* Liquid Glass differential border via inset box-shadow */
const ghostStyle: CSSProperties = {
  backdropFilter: 'blur(20px) saturate(1.8)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.8)',
};

const ghostActiveStyle: CSSProperties = {
  ...ghostStyle,
  boxShadow: `
    0 1px 0 0 rgba(255,255,255,0.16) inset,
    1px 0 0 0 rgba(255,255,255,0.08) inset,
    0 -1px 0 0 rgba(0,0,0,0.5) inset,
    0 4px 12px rgba(0,0,0,0.2)
  `,
  background: 'rgba(255,255,255,0.07)',
};

const primaryStyle: CSSProperties = {
  boxShadow: `
    0 1px 0 0 rgba(255,255,255,0.28) inset,
    1px 0 0 0 rgba(255,255,255,0.14) inset,
    0 -1px 0 0 rgba(0,0,0,0.45) inset,
    0 0 24px var(--color-accent-glow),
    0 4px 16px rgba(0,0,0,0.35)
  `,
};

const variants: Record<Variant, string> = {
  ghost:
    'px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-white/[0.06] active:bg-white/[0.04] active:scale-[0.97]',
  primary:
    'px-5 py-2.5 text-sm bg-accent text-accent-contrast hover:bg-accent-hover active:scale-[0.96]',
  icon: 'w-9 h-9 text-text-secondary hover:text-text-primary hover:bg-white/[0.06] active:bg-white/[0.04] active:scale-[0.95] rounded-lg',
};

export function GlassButton({
  children,
  variant = 'ghost',
  active = false,
  className = '',
  style,
  ...props
}: GlassButtonProps) {
  const variantStyle: CSSProperties =
    variant === 'primary' ? primaryStyle : active ? ghostActiveStyle : ghostStyle;

  return (
    <button
      className={`${base} ${variants[variant]} ${
        active && variant !== 'primary' ? 'text-text-primary bg-white/[0.07]' : ''
      } ${className}`}
      style={{ ...variantStyle, ...style }}
      {...props}
    >
      {children}
    </button>
  );
}
