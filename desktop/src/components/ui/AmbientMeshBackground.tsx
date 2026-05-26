/**
 * AmbientMeshBackground — full-screen living mesh gradient.
 *
 * Four enormous colour blobs sit at z-index -50, beneath every UI surface.
 * They breathe slowly — transform-only animations so the GPU compositor handles
 * every frame without touching the pixel pipeline. The static `filter: blur(160px)`
 * is computed once and cached; only the cheap translate/scale changes per-tick.
 *
 * Without this layer, Liquid Glass panels have nothing to refract and just look
 * like flat dark rectangles. With it, each glass surface becomes a coloured
 * lens — exactly the Yandex Music / Apple Music "vibe" effect.
 *
 * Usage: mount once in App.tsx or AppShell.tsx at the very bottom of the render tree.
 */
import React from 'react';

export const AmbientMeshBackground = React.memo(function AmbientMeshBackground() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -50,
        overflow: 'hidden',
        pointerEvents: 'none',
        /* Isolate the blobs into their own stacking context — no bleed into z-siblings */
        isolation: 'isolate',
        /* contain: layout paint keeps repaints inside this element */
        contain: 'layout paint',
      }}
    >
      {/*
       * Blob 1 — Warm Orange/Amber (top-left)
       * SoundCloud brand anchor. Largest blob, sets the warm tone.
       */}
      <div
        style={{
          position: 'absolute',
          top: '-20%',
          left: '-15%',
          width: '70%',
          height: '70%',
          borderRadius: '50%',
          background:
            'radial-gradient(ellipse at center, rgba(255,100,20,0.55) 0%, rgba(255,60,0,0.28) 45%, transparent 70%)',
          filter: 'blur(120px)',
          animation: 'mesh-drift-a 28s ease-in-out infinite',
          willChange: 'transform',
        }}
      />

      {/*
       * Blob 2 — Deep Violet/Indigo (top-right)
       * Noble, premium counterpoint to the orange. Matches --color-ui-accent.
       */}
      <div
        style={{
          position: 'absolute',
          top: '-10%',
          right: '-20%',
          width: '65%',
          height: '65%',
          borderRadius: '50%',
          background:
            'radial-gradient(ellipse at center, rgba(99,102,241,0.45) 0%, rgba(79,70,229,0.22) 50%, transparent 70%)',
          filter: 'blur(140px)',
          animation: 'mesh-drift-b 38s ease-in-out infinite',
          willChange: 'transform',
        }}
      />

      {/*
       * Blob 3 — Teal/Cyan (bottom-left)
       * Cool, fresh bottom counterweight. Matches waveform accent gradient.
       */}
      <div
        style={{
          position: 'absolute',
          bottom: '-15%',
          left: '-10%',
          width: '60%',
          height: '60%',
          borderRadius: '50%',
          background:
            'radial-gradient(ellipse at center, rgba(34,211,238,0.32) 0%, rgba(6,182,212,0.16) 50%, transparent 70%)',
          filter: 'blur(160px)',
          animation: 'mesh-drift-c 46s ease-in-out infinite',
          willChange: 'transform',
        }}
      />

      {/*
       * Blob 4 — Deep Magenta/Rose (bottom-right)
       * Warmth anchor for bottom-right. Makes the vignette feel alive.
       */}
      <div
        style={{
          position: 'absolute',
          bottom: '-25%',
          right: '-15%',
          width: '58%',
          height: '58%',
          borderRadius: '50%',
          background:
            'radial-gradient(ellipse at center, rgba(236,72,153,0.28) 0%, rgba(168,85,247,0.14) 50%, transparent 70%)',
          filter: 'blur(150px)',
          animation: 'mesh-drift-d 34s ease-in-out infinite',
          willChange: 'transform',
        }}
      />

      {/*
       * Blob 5 — Mid-screen left anchor
       * Fills the centre gap so the sidebar glass effect is visible top-to-bottom.
       */}
      <div
        style={{
          position: 'absolute',
          top: '30%',
          left: '-10%',
          width: '45%',
          height: '55%',
          borderRadius: '50%',
          background:
            'radial-gradient(ellipse at center, rgba(120,80,220,0.30) 0%, rgba(80,60,180,0.14) 50%, transparent 70%)',
          filter: 'blur(140px)',
          animation: 'mesh-drift-b 52s ease-in-out infinite reverse',
          willChange: 'transform',
        }}
      />

      {/* Dark overlay — opacity 0.60 (was 0.70): lets enough ambient colour bleed
          through so Liquid Glass panels refract visibly across the full height. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(6, 6, 9, 0.60)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
});
