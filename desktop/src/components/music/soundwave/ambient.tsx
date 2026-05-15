import React, { useMemo } from 'react';

interface Props {
  /** Number of drifting accent particles. Fewer on smaller blocks. */
  particleCount?: number;
  /** Max blur radius for aurora orbs. Lower = cheaper GPU paint. */
  blur?: number;
  /** Primary aurora opacity. */
  intensity?: number;
}

/**
 * Decorative aurora + particle layer for SoundWave blocks.
 *
 * Enhanced for Liquid Glass: three aurora orbs (accent + white + secondary),
 * gooey SVG filter for blob-merge, chromatically offset secondary orb.
 * Pure CSS animations, `contain: strict` isolates repaints, no React updates
 * during animation.
 */
export const AmbientLayer = React.memo(function AmbientLayer({
  particleCount = 12,
  blur = 48,
  intensity = 0.6,
}: Props) {
  const particles = useMemo(
    () => Array.from({ length: particleCount }, (_, i) => i),
    [particleCount],
  );

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      aria-hidden
      style={{ contain: 'strict', transform: 'translateZ(0)' }}
    >
      {/* Gooey blob group — #liquid-gooey from LiquidGlassDefs.tsx */}
      <div
        className="absolute inset-0"
        style={{ filter: 'url(#liquid-gooey)', willChange: 'transform' }}
      >
        {/* Primary accent orb — top-left */}
        <div
          className="absolute -top-1/3 -left-1/4 w-[55%] h-[170%] rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, var(--color-accent-glow), transparent 70%)',
            filter: `blur(${blur}px)`,
            opacity: intensity,
            animation: 'sw-aurora 32s linear infinite',
            willChange: 'transform',
          }}
        />
        {/* White shimmer orb — bottom-right */}
        <div
          className="absolute -bottom-1/2 right-[-12%] w-[50%] h-[160%] rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, rgba(255,255,255,0.08), transparent 70%)',
            filter: `blur(${blur + 6}px)`,
            opacity: intensity * 0.88,
            animation: 'sw-aurora 44s linear reverse infinite',
            willChange: 'transform',
          }}
        />
        {/* Secondary chromatic orb — center-right, slower drift */}
        <div
          className="absolute top-[10%] right-[-8%] w-[40%] h-[130%] rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, rgba(255,120,40,0.12), transparent 70%)',
            filter: `blur(${blur + 12}px)`,
            opacity: intensity * 0.55,
            animation: 'sw-aurora 58s linear infinite',
            animationDelay: '-18s',
            willChange: 'transform',
          }}
        />
      </div>

      {/* Accent particles — drift upward and fade */}
      {particles.map((i) => {
        const size = 2 + (i % 3);
        const left = (i * 41) % 100;
        const top = 12 + ((i * 53) % 70);
        const duration = 5200 + ((i * 313) % 3200);
        const delay = (i * 277) % 3800;
        return (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${size}px`,
              height: `${size}px`,
              left: `${left}%`,
              top: `${top}%`,
              background: 'var(--color-accent)',
              boxShadow: '0 0 8px var(--color-accent-glow)',
              animation: `sw-drift ${duration}ms ease-in-out ${delay}ms infinite`,
            }}
          />
        );
      })}
    </div>
  );
});
