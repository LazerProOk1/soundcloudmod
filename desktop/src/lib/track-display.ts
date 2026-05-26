import { useMemo } from 'react';
import type { EnrichmentArtist, Track, TrackAvailability } from '../stores/player';

/** Artist name from SoundCloud's own publisher_metadata, if present and non-empty. */
function publisherArtist(track: Pick<Track, 'publisher_metadata'>): string | null {
  const name = track.publisher_metadata?.artist;
  return name && name.trim() ? name.trim() : null;
}

export interface ArtistDisplay {
  primary: string;
  uploader: string | null;
  isEnriched: boolean;
  verified: boolean;
  confidence: number | null;
  pending: boolean;
  uploadKind: string | null;
  availability: TrackAvailability;
}

export type UploadKind = 'original' | 'demo' | 'alt' | 'reupload' | 'unknown';

const TITLE_SEPARATORS = [' - ', ' — ', ' – ', ' -- '] as const;

export function getArtistDisplay(
  track: Pick<Track, 'user' | 'enrichment' | 'publisher_metadata'>,
): ArtistDisplay {
  const enrichment = track.enrichment;
  const real = enrichment?.primary_artist;
  const uploader = track.user?.username ?? '';
  const availability = (enrichment?.availability ?? 'indexed') as TrackAvailability;
  const pending = enrichment?.state === 'pending' || (!enrichment && availability === 'indexed');
  const uploadKind =
    enrichment && enrichment.upload_kind && enrichment.upload_kind !== 'unknown'
      ? enrichment.upload_kind
      : null;

  // Priority: enrichment.primary_artist → publisher_metadata.artist → uploader
  const realName = real?.name?.trim() || null;
  if (realName) {
    const sameAsUploader = realName.toLowerCase() === uploader.trim().toLowerCase();
    return {
      primary: realName,
      uploader: sameAsUploader || availability !== 'indexed' ? null : uploader || null,
      isEnriched: true,
      verified: real!.verified === true,
      confidence: real!.confidence ?? null,
      pending: false,
      uploadKind,
      availability,
    };
  }

  const pubArtist = publisherArtist(track);
  if (pubArtist) {
    const sameAsUploader = pubArtist.toLowerCase() === uploader.trim().toLowerCase();
    return {
      primary: pubArtist,
      uploader: sameAsUploader ? null : uploader || null,
      isEnriched: true,
      verified: false,
      confidence: null,
      pending: false,
      uploadKind,
      availability,
    };
  }

  return {
    primary: uploader,
    uploader: null,
    isEnriched: false,
    verified: false,
    confidence: null,
    pending,
    uploadKind,
    availability,
  };
}

export function getDisplayTitle(
  track: Pick<Track, 'title' | 'enrichment' | 'publisher_metadata'>,
): string {
  const real = track.enrichment?.primary_artist;
  // Use enrichment name (verified preferred) or publisher_metadata as fallback for title stripping
  const artistName =
    real?.verified && real.name ? real.name.trim() : (publisherArtist(track) ?? '');

  if (!artistName) return track.title;

  const albumTitle = track.enrichment?.album?.title;
  const artistLower = artistName.toLowerCase();
  for (const sep of TITLE_SEPARATORS) {
    const idx = track.title.indexOf(sep);
    if (idx > 0) {
      const left = track.title.slice(0, idx).trim();
      if (left.toLowerCase() === artistLower) {
        const right = track.title.slice(idx + sep.length).trim();
        if (albumTitle && right.toLowerCase() === albumTitle.trim().toLowerCase()) {
          return right;
        }
        return right;
      }
    }
  }
  return track.title;
}

export function useArtistDisplay(
  track: Pick<Track, 'user' | 'enrichment' | 'publisher_metadata'>,
): ArtistDisplay {
  return useMemo(
    () => getArtistDisplay(track),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      track.user?.username,
      track.publisher_metadata?.artist,
      track.enrichment?.primary_artist?.name,
      track.enrichment?.primary_artist?.verified,
      track.enrichment?.upload_kind,
      track.enrichment?.availability,
      track.enrichment?.state,
    ],
  );
}

export function getArtistTarget(
  track: Pick<Track, 'user' | 'enrichment' | 'publisher_metadata'>,
): string | null {
  const real = track.enrichment?.primary_artist;
  // Prefer verified enrichment artist; fall back to unverified if it has an id
  if (real?.id) {
    return `/artist/${encodeURIComponent(real.id)}`;
  }
  // If publisher_metadata has an artist name different from the uploader,
  // the track belongs to a real artist — link to the uploader profile as best we can
  if (track.user?.urn) {
    return `/user/${encodeURIComponent(track.user.urn)}`;
  }
  return null;
}

export function useDisplayTitle(
  track: Pick<Track, 'title' | 'enrichment' | 'publisher_metadata'>,
): string {
  return useMemo(
    () => getDisplayTitle(track),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      track.title,
      track.publisher_metadata?.artist,
      track.enrichment?.primary_artist?.name,
      track.enrichment?.primary_artist?.verified,
      track.enrichment?.album?.title,
    ],
  );
}

export interface ParticipantsBreakdown {
  featured: EnrichmentArtist[];
  remixers: EnrichmentArtist[];
}

export function getParticipants(
  track: Pick<Track, 'enrichment'>,
  roles: ReadonlyArray<string> = ['featured', 'remixer'],
): ParticipantsBreakdown | null {
  const items = track.enrichment?.participants?.filter((p) => roles.includes(p.role)) ?? [];
  if (items.length === 0) return null;
  const featured = items.filter((p) => p.role === 'featured').map((p) => p.artist);
  const remixers = items.filter((p) => p.role === 'remixer').map((p) => p.artist);
  if (featured.length === 0 && remixers.length === 0) return null;
  return { featured, remixers };
}
