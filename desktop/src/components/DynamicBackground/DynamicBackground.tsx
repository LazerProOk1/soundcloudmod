/**
 * DynamicBackground
 *
 * Renders three large animated colour blobs derived from the current track artwork.
 * Sits between the custom wallpaper and the content layer.
 *
 * Behaviour:
 *  - When no track / no artwork: renders nothing (null).
 *  - When a custom wallpaper is active: mix-blend-mode: screen + lower opacity
 *    so the blobs tint the wallpaper rather than replacing it.
 *  - All keyframe animations respect prefers-reduced-motion.
 *  - CSS custom properties drive the blob colours so React only re-renders
 *    when the artwork URL actually changes (colour values go through inline vars).
 */

import React, { useEffect, useRef } from 'react';
import { rgbToCss, useArtworkColor } from '../../hooks/useArtworkColor';
import { art } from '../../lib/formatters';
import { usePlayerStore } from '../../stores/player';
import { useSettingsStore } from '../../stores/settings';

/* ── Helpers ────────────────────────────────────────────────── */

interface BlobProps {
  colorVar: string;
  className: string;
  style?: React.CSSProperties;
}

const Blob = React.memo(({ colorVar, className, style }: BlobProps) => (
  <div
    aria-hidden="true"
    className={`dynamic-bg-blob ${className}`}
    style={{
      background: `radial-gradient(ellipse at center, var(${colorVar}) 0%, transparent 70%)`,
      ...style,
    }}
  />
));

/* ── Component ──────────────────────────────────────────────── */

interface DynamicBackgroundProps {
  /** When true (custom wallpaper active), uses blend mode + lower opacity */
  blendMode?: boolean;
}

export const DynamicBackground = React.memo(({ blendMode = false }: DynamicBackgroundProps) => {
  const artwork = usePlayerStore((s) => art(s.currentTrack?.artwork_url, 't300x300'));
  const colors = useArtworkColor(artwork);
  const containerRef = useRef<HTMLDivElement>(null);

  // Push colour vars onto the container so CSS can read them without React re-renders
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (colors) {
      el.style.setProperty('--db-color-1', rgbToCss(colors.dominant, blendMode ? 0.55 : 0.32));
      el.style.setProperty('--db-color-2', rgbToCss(colors.secondary, blendMode ? 0.45 : 0.26));
      el.style.setProperty('--db-color-3', rgbToCss(colors.tertiary, blendMode ? 0.4 : 0.22));
    } else {
      el.style.removeProperty('--db-color-1');
      el.style.removeProperty('--db-color-2');
      el.style.removeProperty('--db-color-3');
    }
  }, [colors, blendMode]);

  // Don't render anything if there's no track
  if (!artwork) return null;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="dynamic-bg-root"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 0,
        // When over custom wallpaper, screen blend tints without replacing
        mixBlendMode: blendMode ? 'screen' : 'normal',
        opacity: blendMode ? 0.6 : 1,
        contain: 'strict',
        transform: 'translateZ(0)',
        willChange: 'opacity',
        // Smooth colour transitions when track changes
        transition: 'opacity 0.8s ease-out',
      }}
    >
      {/* Blob 1 — dominant colour, upper-left drift */}
      <Blob
        colorVar="--db-color-1"
        className="dynamic-bg-blob-1"
        style={{
          position: 'absolute',
          width: '65vw',
          height: '65vh',
          top: '-10vh',
          left: '-10vw',
          filter: 'blur(80px)',
          willChange: 'transform',
        }}
      />

      {/* Blob 2 — secondary colour, lower-right drift */}
      <Blob
        colorVar="--db-color-2"
        className="dynamic-bg-blob-2"
        style={{
          position: 'absolute',
          width: '55vw',
          height: '55vh',
          bottom: '-8vh',
          right: '-8vw',
          filter: 'blur(90px)',
          willChange: 'transform',
        }}
      />

      {/* Blob 3 — tertiary colour, centre drift */}
      <Blob
        colorVar="--db-color-3"
        className="dynamic-bg-blob-3"
        style={{
          position: 'absolute',
          width: '45vw',
          height: '45vh',
          top: '25vh',
          left: '28vw',
          filter: 'blur(100px)',
          willChange: 'transform',
        }}
      />

      {/* Dark vignette overlay — keeps text legible and glass panels visible */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 110% 110% at 50% 50%, transparent 30%, rgba(6,6,9,0.72) 100%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
});

/* ── Wrapper that reads custom-wallpaper state ──────────────── */

export const DynamicBackgroundConnected = React.memo(() => {
  const hasWallpaper = useSettingsStore((s) => !!s.backgroundImage);
  return <DynamicBackground blendMode={hasWallpaper} />;
});
