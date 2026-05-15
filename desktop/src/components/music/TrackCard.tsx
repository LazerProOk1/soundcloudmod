import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { preloadTrack } from '../../lib/audio';
import { art, dur, fc } from '../../lib/formatters';
import { ListMusic, ListPlus, pauseBlack20, playBlack20, playIcon32 } from '../../lib/icons';
import { recordClusterFeedback, setUrnCluster, useClusterFeedback } from '../../lib/recsFeedback';
import { useArtistDisplay, useDisplayTitle } from '../../lib/track-display';
import { useTrackPlay } from '../../lib/useTrackPlay';
import type { Track } from '../../stores/player';
import { usePlayerStore } from '../../stores/player';
import { AddToPlaylistDialog } from './AddToPlaylistDialog';
import { LikeButton } from './LikeButton';
import { UploadKindDot } from './UploadKindDot';

interface TrackCardProps {
  track: Track;
  queue?: Track[];
}

export const TrackCard = React.memo(
  function TrackCard({ track, queue }: TrackCardProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { isThisPlaying, togglePlay: togglePlayRaw } = useTrackPlay(track, queue);
    const clusterId = useClusterFeedback();
    const togglePlay = React.useCallback(() => {
      if (clusterId) {
        setUrnCluster(track.urn, clusterId);
        recordClusterFeedback(clusterId, 'click');
      }
      togglePlayRaw();
    }, [clusterId, track.urn, togglePlayRaw]);
    const addToQueueNext = usePlayerStore((s) => s.addToQueueNext);
    const cardRef = useRef<HTMLDivElement>(null);
    const artwork = art(track.artwork_url, 't300x300');
    const artistDisplay = useArtistDisplay(track);
    const displayTitle = useDisplayTitle(track);
    const isWanted = artistDisplay.availability !== 'indexed';

    const artistTarget =
      track.enrichment?.primary_artist?.id && artistDisplay.verified
        ? `/artist/${encodeURIComponent(track.enrichment.primary_artist.id)}`
        : track.user?.urn
          ? `/user/${encodeURIComponent(track.user.urn)}`
          : null;

    const handleAddToQueue = (e: React.MouseEvent) => {
      e.stopPropagation();
      addToQueueNext([track]);
    };

    /* Spring 3-D tilt on mouse move — full card tilts toward cursor */
    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cardRef.current;
      if (!el) return;
      const { left, top, width, height } = el.getBoundingClientRect();
      const x = ((e.clientX - left) / width - 0.5) * 14;   // ±7°
      const y = ((e.clientY - top) / height - 0.5) * -14;
      el.style.transform = `perspective(600px) rotateY(${x}deg) rotateX(${y}deg) translateY(-4px) scale(1.02)`;
    };

    const handleMouseLeave = () => {
      const el = cardRef.current;
      if (el) {
        el.style.transform =
          'perspective(600px) rotateY(0deg) rotateX(0deg) translateY(0) scale(1)';
      }
    };

    return (
      <div
        ref={cardRef}
        className="group relative select-none"
        style={{
          transition: 'transform 0.45s cubic-bezier(0.16,1,0.3,1)',
          contentVisibility: 'auto',
          contain: 'layout paint style',
          containIntrinsicSize: '180px 260px',
          willChange: 'transform',
        }}
        onMouseEnter={() => preloadTrack(track.urn)}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* ── Artwork ──────────────────────────────────────────── */}
        <div
          className="relative aspect-square rounded-[22px] overflow-hidden cursor-pointer"
          style={{
            /* Liquid Glass border: top/left bright → bottom/right dark */
            boxShadow: `
              0 1px 0 0 rgba(255,255,255,0.18) inset,
              1px 0 0 0 rgba(255,255,255,0.10) inset,
              0 -1px 0 0 rgba(0,0,0,0.58) inset,
              -1px 0 0 0 rgba(0,0,0,0.20) inset,
              0 8px 32px rgba(0,0,0,0.45),
              0 2px 8px rgba(0,0,0,0.25)
            `,
            background: 'rgba(255,255,255,0.035)',
            backdropFilter: 'blur(2px)',
          }}
          onClick={togglePlay}
        >
          {artwork ? (
            <img
              src={artwork}
              alt={track.title}
              className="w-full h-full object-cover transition-transform duration-500 ease-[var(--ease-spring)] group-hover:scale-[1.06]"
              decoding="async"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/20">
              {playIcon32}
            </div>
          )}

          {/* Liquid overlay — liquid glass gradient on hover/playing */}
          <div
            className={`absolute inset-0 flex items-center justify-center transition-all duration-350 ease-[var(--ease-spring)] ${
              isThisPlaying
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100'
            }`}
            style={{
              background: isThisPlaying
                ? 'linear-gradient(160deg, rgba(255,255,255,0.12) 0%, rgba(0,0,0,0.48) 100%)'
                : 'linear-gradient(160deg, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0.38) 100%)',
              backdropFilter: 'blur(4px) saturate(1.6)',
            }}
          >
            {/* Play/pause button — frosted pearl glass (NOT a flat white circle) */}
            <div
              className={`flex items-center justify-center transition-all duration-400 ease-[var(--ease-spring)] ${
                isThisPlaying ? 'scale-100' : 'scale-[0.7] group-hover:scale-100'
              }`}
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                /* Warm white pearl gradient — same physics as NowPlayingBar PlayPause */
                background:
                  'linear-gradient(165deg, rgba(255,255,255,0.97) 0%, rgba(218,218,235,0.92) 100%)',
                boxShadow: `
                  /* Differential frosted border */
                  0 1px 0 0 rgba(255,255,255,1.0) inset,
                  0 -1px 0 0 rgba(0,0,0,0.22) inset,
                  1px 0 0 0 rgba(255,255,255,0.82) inset,
                  -1px 0 0 0 rgba(0,0,0,0.10) inset,
                  /* Frosted halo ring */
                  0 0 0 1.5px rgba(255,255,255,0.28),
                  /* Ambient glow ring */
                  0 0 0 7px rgba(255,255,255,0.07),
                  /* Depth shadows */
                  0 6px 22px rgba(0,0,0,0.48),
                  0 2px 8px rgba(0,0,0,0.28)
                `,
                backdropFilter: 'blur(8px)',
              }}
            >
              {isThisPlaying ? pauseBlack20 : playBlack20}
            </div>
          </div>

          {/* Go+ badge for blocked tracks */}
          {track.access === 'blocked' && (
            <div
              className="absolute top-2 left-2 flex items-center gap-1 rounded-full px-2 py-0.5"
              style={{
                background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(12px) saturate(1.8)',
                boxShadow: '0 1px 0 0 rgba(255,255,255,0.12) inset',
              }}
            >
              <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wide">
                Go+
              </span>
            </div>
          )}

          {/* Duration pill — bottom right */}
          <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div
              className="text-[10px] font-medium text-white/85 px-2 py-0.5 rounded-full"
              style={{
                background: 'rgba(0,0,0,0.45)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 1px 0 0 rgba(255,255,255,0.10) inset',
              }}
            >
              {dur(track.duration)}
            </div>
          </div>

          {/* Like — top left (existing component) */}
          <LikeButton track={track} variant="overlay" />

          {/* Playlist + queue — top right (liquid glass pills, not dark blobs) */}
          <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0">
            <AddToPlaylistDialog trackUrns={[track.urn]}>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="cursor-pointer w-8 h-8 rounded-full flex items-center justify-center text-white transition-all duration-200 hover:scale-110 active:scale-95"
                title={t('playlist.addToPlaylist')}
                style={{
                  background: 'rgba(255,255,255,0.16)',
                  backdropFilter: 'blur(16px) saturate(1.8)',
                  boxShadow:
                    '0 1px 0 0 rgba(255,255,255,0.35) inset, 0 -1px 0 0 rgba(0,0,0,0.22) inset, 0 2px 10px rgba(0,0,0,0.32)',
                }}
              >
                <ListPlus size={14} />
              </button>
            </AddToPlaylistDialog>
            <button
              type="button"
              onClick={handleAddToQueue}
              className="cursor-pointer w-8 h-8 rounded-full flex items-center justify-center text-white transition-all duration-200 hover:scale-110 active:scale-95"
              title={t('player.addToQueue')}
              style={{
                background: 'rgba(255,255,255,0.16)',
                backdropFilter: 'blur(16px) saturate(1.8)',
                boxShadow:
                  '0 1px 0 0 rgba(255,255,255,0.35) inset, 0 -1px 0 0 rgba(0,0,0,0.22) inset, 0 2px 10px rgba(0,0,0,0.32)',
              }}
            >
              <ListMusic size={14} />
            </button>
          </div>
        </div>

        {/* ── Ambient glow from artwork ─────────────────────────── */}
        {artwork && (
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 rounded-[22px] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
            style={{
              background: `url(${artwork}) center/cover`,
              filter: 'blur(28px) saturate(1.4)',
              transform: 'scale(0.9) translateY(8px)',
            }}
          />
        )}

        {/* ── Track info ─────────────────────────────────────────── */}
        <div className="mt-3 min-w-0">
          <p
            className={`text-[13px] font-medium truncate leading-snug transition-colors duration-150 ${
              isWanted
                ? 'text-white/45'
                : 'text-white/90 cursor-pointer hover:text-white'
            }`}
            onClick={
              isWanted
                ? undefined
                : () => navigate(`/track/${encodeURIComponent(track.urn)}`)
            }
          >
            {displayTitle}
          </p>
          <p
            className={`text-[11px] truncate mt-0.5 flex items-center gap-1 transition-colors duration-150 ${
              isWanted
                ? 'text-white/25'
                : 'text-white/40 cursor-pointer hover:text-white/60'
            }`}
            onClick={artistTarget && !isWanted ? () => navigate(artistTarget) : undefined}
          >
            <UploadKindDot kind={artistDisplay.uploadKind} />
            <span className="truncate">{artistDisplay.primary}</span>
          </p>
          {isWanted ? (
            <p className="text-[10px] text-white/20 mt-1">
              {t('track.notFoundOnSc', 'not found on SoundCloud')}
            </p>
          ) : (
            track.playback_count != null && (
              <p className="text-[10px] text-white/15 mt-1 tabular-nums">
                {fc(track.playback_count)} plays
              </p>
            )
          )}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.track.urn === next.track.urn &&
    prev.track.user_favorite === next.track.user_favorite &&
    prev.track.enrichment?.primary_artist?.name ===
      next.track.enrichment?.primary_artist?.name &&
    prev.track.enrichment?.upload_kind === next.track.enrichment?.upload_kind &&
    prev.track.enrichment?.availability === next.track.enrichment?.availability,
);
