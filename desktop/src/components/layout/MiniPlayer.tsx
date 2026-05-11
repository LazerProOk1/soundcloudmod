import React from 'react';
import { handlePrev } from '../../lib/audio';
import { art } from '../../lib/formatters';
import { usePlayerStore } from '../../stores/player';
import { useMiniPlayerStore } from '../../stores/mini-player';

/* ── Error boundary so a crash here doesn't black-screen ─────── */
class MiniPlayerBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(e: unknown) {
    return { error: String(e) };
  }
  render() {
    if (this.state.error) {
      return (
        <div
          data-tauri-drag-region
          style={{
            width: '100vw', height: '100vh',
            background: '#1a1a1c',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.5)', fontSize: 11,
            fontFamily: 'system-ui', userSelect: 'none',
          }}
        >
          ошибка — перезапусти
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Main component ──────────────────────────────────────────── */
function MiniPlayerInner() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying    = usePlayerStore((s) => s.isPlaying);
  const togglePlay   = usePlayerStore((s) => s.togglePlay);
  const next         = usePlayerStore((s) => s.next);
  const exit         = useMiniPlayerStore((s) => s.exit);

  const cover = currentTrack ? art(currentTrack.artwork_url, 't200x200') : null;

  // Stops mousedown from bubbling to the drag region → buttons work
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      data-tauri-drag-region
      style={{
        width: '100vw',
        height: '100vh',
        background: '#18181b',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* ── Top strip ── */}
      <div style={{
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 10px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', pointerEvents: 'none' }}>
          Mini Player
        </span>
        {/* Exit button */}
        <button
          onMouseDown={stop}
          onClick={() => void exit()}
          style={{
            width: 22, height: 22, border: 'none', borderRadius: 5,
            background: 'transparent', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.4)',
          }}
          title="Развернуть"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
      </div>

      {/* ── Player row ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 10px',
        minWidth: 0,
      }}>
        {/* Cover */}
        <div style={{
          width: 42, height: 42, borderRadius: 8,
          background: 'rgba(255,255,255,0.07)',
          flexShrink: 0, overflow: 'hidden',
          boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
        }}>
          {cover && <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        </div>

        {/* Track info */}
        <div style={{ flex: 1, minWidth: 0, pointerEvents: 'none' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.92)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>
            {currentTrack?.title ?? 'Не играет'}
          </div>
          {currentTrack && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2, lineHeight: 1.3 }}>
              {currentTrack.user.username}
            </div>
          )}
        </div>

        {/* Controls */}
        <div onMouseDown={stop} style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {/* Prev */}
          <button onClick={handlePrev} style={btnStyle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          {/* Play/Pause */}
          <button onClick={togglePlay} style={playBtnStyle}>
            {isPlaying
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            }
          </button>
          {/* Next */}
          <button onClick={next} style={btnStyle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  width: 30, height: 30, border: 'none', borderRadius: '50%',
  background: 'transparent', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'rgba(255,255,255,0.5)',
};

const playBtnStyle: React.CSSProperties = {
  width: 36, height: 36, border: 'none', borderRadius: '50%',
  background: 'rgba(255,255,255,0.92)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#000', margin: '0 2px',
};

export const MiniPlayer = () => (
  <MiniPlayerBoundary>
    <MiniPlayerInner />
  </MiniPlayerBoundary>
);
