import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { type Aura, DEFAULT_AURA } from '../../lib/aura';
import type { Track } from '../../stores/player';
import type { ArtistAlbum, ArtistDetail, TracksSort } from './types';

const STALE_DETAIL = 60_000;
const STALE_TRACKS = 30_000;
const STALE_ALBUMS = 120_000;

export function useArtistDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['artist', id],
    queryFn: () => api<ArtistDetail>(`/artists/${encodeURIComponent(id!)}`),
    enabled: !!id,
    staleTime: STALE_DETAIL,
  });
}

export function useArtistTracks(
  id: string | undefined,
  role: 'primary' | 'featured',
  sort: TracksSort,
) {
  return useQuery({
    queryKey: ['artist', id, 'tracks', role, sort],
    queryFn: () =>
      api<{ collection: Track[] }>(
        `/artists/${encodeURIComponent(id!)}/tracks?role=${role}&sort=${sort}&limit=80`,
      ),
    enabled: !!id,
    staleTime: STALE_TRACKS,
    select: (d) => d.collection,
  });
}

export function useArtistAlbums(id: string | undefined) {
  return useQuery({
    queryKey: ['artist', id, 'albums'],
    queryFn: () => api<ArtistAlbum[]>(`/artists/${encodeURIComponent(id!)}/albums`),
    enabled: !!id,
    staleTime: STALE_ALBUMS,
  });
}

export interface ArtistStar {
  hasStar: boolean;
  aura: Aura;
}

// Star subscription feature removed — hasStar is always false.
export function useArtistStar(_id: string | undefined): ArtistStar {
  return { hasStar: false, aura: DEFAULT_AURA };
}
