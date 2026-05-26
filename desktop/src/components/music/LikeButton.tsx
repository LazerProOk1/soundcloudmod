import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect } from 'react';
import { api } from '../../lib/api';
import { invalidateAllLikesCache } from '../../lib/hooks';
import { Heart } from '../../lib/icons';
import { optimisticToggleLike, setLikedUrn, useLiked } from '../../lib/likes';
import type { Track } from '../../stores/player';
import { useSettingsStore } from '../../stores/settings';

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export const LikeButton = React.memo(function LikeButton({
  track,
  variant = 'inline',
}: {
  track: Track;
  variant?: 'overlay' | 'inline';
}) {
  const liked = useLiked(track.urn);
  const accentColor = useSettingsStore((s) => s.accentColor);

  // Seed from API data when available
  useEffect(() => {
    if (track.user_favorite) setLikedUrn(track.urn, true);
  }, [track.urn, track.user_favorite]);
  const qc = useQueryClient();

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !liked;
    optimisticToggleLike(qc, track, next);
    invalidateAllLikesCache();
    try {
      await api(`/likes/tracks/${encodeURIComponent(track.urn)}`, {
        method: next ? 'POST' : 'DELETE',
        body: next ? JSON.stringify(track) : undefined,
      });
    } catch {
      optimisticToggleLike(qc, track, !next);
    }
  };

  if (variant === 'overlay') {
    return (
      <button
        type="button"
        onClick={toggle}
        className="cursor-pointer absolute top-2 left-2 w-8 h-8 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110 active:scale-95 translate-y-1 group-hover:translate-y-0"
        style={{
          /* Glass pill — matches top-right buttons in TrackCard */
          background: liked ? hexToRgba(accentColor, 0.9) : hexToRgba(accentColor, 0.55),
          backdropFilter: 'blur(16px) saturate(1.8)',
          boxShadow: liked
            ? `0 1px 0 0 rgba(255,255,255,0.35) inset, 0 -1px 0 0 rgba(0,0,0,0.25) inset, 0 4px 14px ${hexToRgba(accentColor, 0.5)}`
            : `0 1px 0 0 rgba(255,255,255,0.28) inset, 0 -1px 0 0 rgba(0,0,0,0.20) inset, 0 2px 10px ${hexToRgba(accentColor, 0.3)}`,
          color: 'white',
        }}
      >
        <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`cursor-pointer w-8 h-8 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 shrink-0 ${
        liked ? 'text-accent' : 'text-white/20 hover:text-white/50'
      }`}
    >
      <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
    </button>
  );
});
