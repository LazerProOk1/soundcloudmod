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
 * Performance-safe design:
 *  - NO `filter: url(#liquid-gooey)` wrapper — SVG filters on animated subtrees
 *    force full CPU rasterization every frame and kill FPS.
 *  - Blur is applied per-orb as a STATIC CSS `filter: blur()` — GPU caches the
 *    result and only re-applies cheap translate/scale compositing each frame.
 *  - `contain: strict` isolates repaints to this subtree.
 *  - `will-change: transform` promotes orbs to their own GPU layer.
 */
export const AmbientLayer = React.memo(function AmbientLayer({
  particleCount = 8,
  blur = 40,
  intensity = 0.55,
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
      {/* Orbs: each blurred independently — no SVG filter wrapper (perf-critical) */}

      {/* Primary accent orb — top-left */}
      <div
        className="absolute -top-1/3 -left-1/4 w-[55%] h-[170%] rounded-full"
        style={{
          background: 'radial-gradient(closest-side, var(--color-accent-glow), transparent 70%)',
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
          background: 'radial-gradient(closest-side, rgba(255,255,255,0.07), transparent 70%)',
          filter: `blur(${blur + 8}px)`,
          opacity: intensity * 0.8,
          animation: 'sw-aurora 44s linear reverse infinite',
          willChange: 'transform',
        }}
      />
      {/* Secondary indigo orb — center-right */}
      <div
        className="absolute top-[10%] right-[-8%] w-[40%] h-[130%] rounded-full"
        style={{
          background: 'radial-gradient(closest-side, rgba(99,102,241,0.14), transparent 70%)',
          filter: `blur(${blur + 14}px)`,
          opacity: intensity * 0.6,
          animation: 'sw-aurora 58s linear infinite',
          animationDelay: '-18s',
          willChange: 'transform',
        }}
      />

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
              boxShadow: '0 0 6px var(--color-accent-glow)',
              animation: `sw-drift ${duration}ms ease-in-out ${delay}ms infinite`,
              willChange: 'transform, opacity',
            }}
          />
        );
      })}
    </div>
  );
});
