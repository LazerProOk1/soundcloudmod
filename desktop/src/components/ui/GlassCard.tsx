import type { HTMLAttributes, ReactNode } from 'react';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Adds .liquid-interactive hover behaviour */
  hover?: boolean;
  padding?: boolean;
}

export function GlassCard({
  children,
  hover = false,
  padding = true,
  className = '',
  ...props
}: GlassCardProps) {
  return (
    <div
      className={`liquid-panel rounded-2xl ${
        hover ? 'liquid-interactive' : ''
      } ${padding ? 'p-4' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
