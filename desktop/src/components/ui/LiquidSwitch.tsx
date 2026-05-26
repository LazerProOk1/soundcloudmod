import React from 'react';

interface LiquidSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * Organic Gooey Switch — liquid glass toggle with mercury-drop thumb.
 *
 * Design anatomy:
 *  1. Container: filter: url(#liquid-gooey-switch) so thumb merges organically
 *     with the track edge when sliding (feGaussianBlur + feColorMatrix threshold).
 *  2. Track: recessed groove with inset shadow (looks carved into glass).
 *     Indigo gradient when on, dark neutral when off.
 *  3. Thumb: frosted metal drop with differential inset border (top-bright /
 *     bottom-dark) — identical physics to the PlayPause button.
 *     Bouncy spring transition via --ease-bounce.
 */
export const LiquidSwitch = React.memo(function LiquidSwitch({
  checked,
  onChange,
  disabled,
}: LiquidSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="relative shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
      style={{
        width: 44,
        height: 24,
        /* No SVG filter — gooey filter causes aliased "ladder" edges at pixel level */
      }}
    >
      {/* ── Track ── */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 9999,
          transition: 'background 0.28s var(--ease-apple), box-shadow 0.28s var(--ease-apple)',
          background: checked ? 'var(--color-accent)' : 'rgba(255,255,255,0.07)',
          boxShadow: checked
            ? '0 1px 0 0 rgba(255,255,255,0.22) inset, 0 -1px 0 0 rgba(0,0,0,0.35) inset, 0 0 0 0.5px var(--color-accent-glow), 0 2px 10px var(--color-accent-glow)'
            : '0 1px 3px rgba(0,0,0,0.55) inset, 0 0.5px 0 rgba(255,255,255,0.10) inset, 0 0 0 0.5px rgba(255,255,255,0.05)',
        }}
      />

      {/* ── Thumb (mercury drop) ── */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 2,
          /* Spring-slide from 2px (off) to 22px (on) */
          left: checked ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: 9999,
          transition:
            'left 0.28s var(--ease-bounce), box-shadow 0.28s var(--ease-apple), background 0.28s var(--ease-apple)',
          background: checked
            ? 'linear-gradient(165deg, rgba(255,255,255,0.98) 0%, rgba(210,213,255,0.95) 100%)'
            : 'linear-gradient(165deg, rgba(255,255,255,0.97) 0%, rgba(235,235,240,0.92) 100%)',
          boxShadow: `
            /* Differential border: bright top, dark bottom — frosted metal */
            0 1px 0 0 rgba(255,255,255,1.0) inset,
            0 -1px 0 0 rgba(0,0,0,0.20) inset,
            1px 0 0 0 rgba(255,255,255,0.72) inset,
            -1px 0 0 0 rgba(0,0,0,0.08) inset,
            /* Depth drop shadow */
            0 2px 6px rgba(0,0,0,0.38),
            0 1px 2px rgba(0,0,0,0.22),
            /* Frosted halo */
            0 0 0 0.5px rgba(255,255,255,0.55)
          `,
        }}
      />
    </button>
  );
});
