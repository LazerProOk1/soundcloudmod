/**
 * LiquidGlassDefs — глобальные SVG-фильтры для Liquid Glass эффектов v2.
 *
 * Монтируется один раз в корне приложения (App.tsx → <ThemeProvider>).
 * ID фильтров доступны по всему DOM через CSS:
 *   filter: url(#liquid-refract)
 *   backdrop-filter: url(#liquid-refract) blur(40px) ...  (WebKit)
 *
 * Фильтры:
 *  #liquid-refract       — мягкая рефракция (карточки, кнопки, оверлеи)
 *  #liquid-refract-heavy — выраженная органическая линза (панели, плеер)
 *  #liquid-lens          — сильная дисторсия для showcase/hero панелей
 *  #liquid-gooey         — gooey blob-merge для aurora ambient-слоёв
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
        {/* ── Subtle refraction: cards, buttons, overlays ──────────────
            baseFrequency 0.018/0.022 → крупные, плавные волны
            scale 8 → заметное, но не разрушительное смещение          */}
        <filter
          id="liquid-refract"
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
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
            type="matrix"
            /* Убираем насыщенность, оставляем только яркостный канал */
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="grayNoise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="grayNoise"
            scale="8"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* ── Heavy organic lens: sidebar, player bar ──────────────────
            baseFrequency 0.012/0.016 → более крупные, «текучие» волны
            numOctaves 4 → сложнее, органичнее
            scale 14 → ощутимая рефракция, как через каплю воды         */}
        <filter
          id="liquid-refract-heavy"
          x="-35%"
          y="-35%"
          width="170%"
          height="170%"
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
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="grayNoise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="grayNoise"
            scale="14"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* ── Showcase lens: hero panels, album art ────────────────────
            Максимальная дисторсия — только для декоративных элементов,
            где искажение контента допустимо (фоновые блюры, арт).      */}
        <filter
          id="liquid-lens"
          x="-40%"
          y="-40%"
          width="180%"
          height="180%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.008 0.012"
            numOctaves="5"
            seed="9"
            result="noise"
          />
          {/* Усиливаем контрастность шума для более острых границ */}
          <feComponentTransfer in="noise" result="sharpNoise">
            <feFuncR type="linear" slope="1.4" intercept="-0.2" />
            <feFuncG type="linear" slope="1.4" intercept="-0.2" />
          </feComponentTransfer>
          <feDisplacementMap
            in="SourceGraphic"
            in2="sharpNoise"
            scale="22"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* ── Gooey blob merge: aurora ambient orbs ────────────────────
            stdDeviation 16 → широкий blur для слияния орбов
            feColorMatrix: alpha-threshold → чёткие края при merge       */}
        <filter id="liquid-gooey" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="16" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -9"
            result="gooey"
          />
          <feBlend in="SourceGraphic" in2="gooey" mode="normal" />
        </filter>

        {/* ── Waveform gooey: bars blending ────────────────────────────
            stdDeviation 1.8 → subtle organic blob at bar tips only
            threshold 12 -4 → softer merge — preserves bar height diff   */}
        <filter id="waveform-gooey" x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 12 -4"
            result="gooey"
          />
          <feBlend in="SourceGraphic" in2="gooey" mode="normal" />
        </filter>

        {/* ── Tight gooey merge: switch thumb ──────────────────────────
            stdDeviation 3 → narrow blur so only thumb+track rim merge
            feColorMatrix high threshold (28 -10) → crisp organic edge
            Used by LiquidSwitch to make the mercury thumb "absorb" into
            the track groove as it slides past the rim.                  */}
        <filter id="liquid-gooey-switch" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 28 -10"
            result="gooey"
          />
          <feBlend in="SourceGraphic" in2="gooey" mode="normal" />
        </filter>
      </defs>
    </svg>
  );
}
