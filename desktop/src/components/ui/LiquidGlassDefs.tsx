/**
 * LiquidGlassDefs — глобальные SVG-фильтры для Liquid Glass эффектов.
 *
 * Монтируется один раз в корне приложения (App.tsx → <ThemeProvider>).
 * ID фильтров доступны по всему DOM через CSS: filter: url(#liquid-refract)
 *
 * Фильтры:
 *  #liquid-refract        — мягкая рефракция (карточки, кнопки)
 *  #liquid-refract-heavy  — выраженная рефракция (панели, плеер)
 *  #liquid-gooey          — gooey blob-merge (ambient orbs)
 */
export function LiquidGlassDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: -1,
      }}
    >
      <defs>
        {/* ── Subtle refraction: cards, buttons, overlays ──────── */}
        <filter
          id="liquid-refract"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.018 0.022"
            numOctaves="3"
            seed="2"
            result="noise"
          />
          <feColorMatrix
            in="noise"
            type="saturate"
            values="0"
            result="grayNoise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="grayNoise"
            scale="5"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* ── Heavy refraction: sidebar, player bar ────────────── */}
        <filter
          id="liquid-refract-heavy"
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.016"
            numOctaves="4"
            seed="5"
            result="noise"
          />
          <feColorMatrix
            in="noise"
            type="saturate"
            values="0"
            result="grayNoise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="grayNoise"
            scale="9"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* ── Gooey merge: ambient aurora blobs ────────────────── */}
        <filter id="liquid-gooey" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="14" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -8"
            result="gooey"
          />
          <feBlend in="SourceGraphic" in2="gooey" />
        </filter>
      </defs>
    </svg>
  );
}
