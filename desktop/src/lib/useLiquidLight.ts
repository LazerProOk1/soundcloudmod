import { useCallback, useEffect, useRef } from 'react';

/**
 * useLiquidLight — cursor-following dynamic highlight for liquid glass panels.
 *
 * Attach the returned ref to a `.liquid-panel` or `.glass-featured` element.
 * On mousemove the hook writes `--light-x` / `--light-y` (0–100%) onto the
 * element via style.setProperty — zero React re-renders, runs entirely in DOM.
 *
 * The CSS `::after` pseudo-element of `.liquid-panel` reads these vars to draw
 * a soft radial spotlight that follows the cursor, creating the illusion that
 * light is reflecting off a curved glass surface.
 *
 * On mouseleave the vars reset to center (50% 50%) so the spotlight fades to
 * the neutral position gracefully.
 *
 * Usage:
 *   const panelRef = useLiquidLight<HTMLDivElement>();
 *   return <div ref={panelRef} className="liquid-panel" />;
 */
export function useLiquidLight<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  const onMove = useCallback((e: MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty('--light-x', `${x.toFixed(1)}%`);
    el.style.setProperty('--light-y', `${y.toFixed(1)}%`);
  }, []);

  const onLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    /* Fade back to neutral center — the CSS transition on opacity handles the
       visual fade-out; we just reset the position for the next hover. */
    el.style.setProperty('--light-x', '50%');
    el.style.setProperty('--light-y', '50%');
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [onMove, onLeave]);

  return ref;
}
