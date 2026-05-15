import React, { useMemo } from 'react';
import { ClusterFeedbackProvider } from '../../../lib/recsFeedback';
import type { Track } from '../../../stores/player';
import { HorizontalScroll } from '../../ui/HorizontalScroll';
import { TrackCard } from '../TrackCard';
import { ClusterHeader } from './ClusterHeader';
import type { ClusterId } from './types';

interface Props {
  title: string;
  description: string;
  icon: React.ReactNode;
  index: number;
  tracks: Track[];
  queue: Track[];
  clusterId: ClusterId | string;
  cardWidth?: number;
}

export const ClusterRow = React.memo(function ClusterRow({
  title,
  description,
  icon,
  index,
  tracks,
  queue,
  clusterId,
  cardWidth = 168,
}: Props) {
  const ctx = useMemo(() => ({ clusterId: String(clusterId) }), [clusterId]);
  return (
    <ClusterFeedbackProvider value={ctx}>
      <div className="flex flex-col gap-3.5">
        <ClusterHeader icon={icon} title={title} description={description} index={index} />
        <HorizontalScroll>
          {tracks.map((track, i) => (
            <div
              key={track.urn}
              className="shrink-0 animate-liquid-reveal"
              style={{
                width: cardWidth,
                /* Stagger each card by 45ms; cap at 540ms so the last items aren't
                   too slow. New renders (scroll refetch) start at 0 delay naturally. */
                animationDelay: `${Math.min(i * 45, 540)}ms`,
              }}
            >
              <TrackCard track={track} queue={queue} />
            </div>
          ))}
        </HorizontalScroll>
      </div>
    </ClusterFeedbackProvider>
  );
});
