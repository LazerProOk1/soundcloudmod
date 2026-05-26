/**
 * useArtworkColor
 *
 * Canvas-based k-means colour extraction from artwork images.
 * Returns up to 3 perceptually distinct colours (dominant, secondary, tertiary).
 *
 * Design notes:
 *  - Works entirely in the browser — no Rust image crate needed.
 *  - Uses `crossOrigin = 'anonymous'` so SoundCloud CDN images are readable.
 *  - 50×50 sample canvas → fast enough for 120fps paint budget.
 *  - LRU-style Map cache (max 40 entries) prevents re-extraction on re-renders.
 *  - Returns null while loading / on error so callers can fallback gracefully.
 */

import { useEffect, useState } from 'react';

/* ── Types ──────────────────────────────────────────────────── */

export interface ArtworkColors {
  /** Most prominent colour [r, g, b] 0-255 */
  dominant: [number, number, number];
  /** Second most distinct colour */
  secondary: [number, number, number];
  /** Third most distinct colour */
  tertiary: [number, number, number];
}

/* ── Constants ──────────────────────────────────────────────── */

const SAMPLE_SIZE = 50;
const K = 3; // number of clusters
const MAX_ITERS = 6;
const CACHE_MAX = 40;

/* ── Cache ──────────────────────────────────────────────────── */

const cache = new Map<string, ArtworkColors | null>();

function pruneCache(): void {
  if (cache.size <= CACHE_MAX) return;
  // Delete oldest entry
  const firstKey = cache.keys().next().value;
  if (firstKey !== undefined) cache.delete(firstKey);
}

/* ── Colour math ────────────────────────────────────────────── */

type RGB = [number, number, number];

function distance(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function meanRGB(pixels: RGB[]): RGB {
  if (pixels.length === 0) return [0, 0, 0];
  let r = 0,
    g = 0,
    b = 0;
  for (const p of pixels) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = pixels.length;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/** Simple k-means — returns K centroids sorted by cluster size (largest first). */
function kmeans(pixels: RGB[], k: number, maxIters: number): RGB[] {
  if (pixels.length === 0) return Array.from({ length: k }, () => [20, 20, 24] as RGB);

  // Spread initial centroids evenly across the pixel array
  const step = Math.floor(pixels.length / k);
  let centroids: RGB[] = Array.from({ length: k }, (_, i) => [...pixels[i * step]] as RGB);

  const assignments = new Int32Array(pixels.length);

  for (let iter = 0; iter < maxIters; iter++) {
    let moved = false;

    // Assign each pixel to nearest centroid
    for (let i = 0; i < pixels.length; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = distance(pixels[i], centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        moved = true;
      }
    }

    if (!moved) break;

    // Recompute centroids
    const clusters: RGB[][] = Array.from({ length: k }, () => []);
    for (let i = 0; i < pixels.length; i++) clusters[assignments[i]].push(pixels[i]);
    const newCentroids = clusters.map((cl, ci) => (cl.length > 0 ? meanRGB(cl) : centroids[ci]));

    centroids = newCentroids;
  }

  // Sort by cluster size descending
  const clusterSizes = new Array<number>(k).fill(0);
  for (let i = 0; i < pixels.length; i++) clusterSizes[assignments[i]]++;
  const indexed = centroids.map((c, i) => ({ c, size: clusterSizes[i] }));
  indexed.sort((a, b) => b.size - a.size);

  return indexed.map((x) => x.c);
}

/** Minimum perceived brightness check — skip near-black or near-white clusters */
function perceivedLightness(rgb: RGB): number {
  // Rec.709 luma approximation
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** Clamp a colour to be somewhat visible on a dark background */
function ensureVisible(rgb: RGB): RGB {
  const L = perceivedLightness(rgb);
  if (L < 18) {
    // Too dark — brighten it
    const scale = 40 / Math.max(L, 1);
    return [
      Math.min(255, Math.round(rgb[0] * scale)),
      Math.min(255, Math.round(rgb[1] * scale)),
      Math.min(255, Math.round(rgb[2] * scale)),
    ];
  }
  return rgb;
}

/* ── Extraction ─────────────────────────────────────────────── */

async function extractColors(url: string): Promise<ArtworkColors | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;

        // Collect non-transparent, non-greyscale pixels
        const pixels: RGB[] = [];
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 128) continue; // skip transparent
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Skip near-greyscale pixels (not interesting for colour extraction)
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max - min < 16) continue;
          pixels.push([r, g, b]);
        }

        if (pixels.length < K * 4) {
          // Fallback: use all pixels including grey ones
          const allPixels: RGB[] = [];
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 128) continue;
            allPixels.push([data[i], data[i + 1], data[i + 2]]);
          }
          if (allPixels.length === 0) {
            resolve(null);
            return;
          }
          const [d, s, t] = kmeans(allPixels, K, MAX_ITERS);
          resolve({
            dominant: ensureVisible(d),
            secondary: ensureVisible(s),
            tertiary: ensureVisible(t),
          });
          return;
        }

        const [d, s, t] = kmeans(pixels, K, MAX_ITERS);
        resolve({
          dominant: ensureVisible(d),
          secondary: ensureVisible(s),
          tertiary: ensureVisible(t),
        });
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/* ── Hook ───────────────────────────────────────────────────── */

export function useArtworkColor(artworkUrl: string | null | undefined): ArtworkColors | null {
  const [colors, setColors] = useState<ArtworkColors | null>(null);

  useEffect(() => {
    if (!artworkUrl) {
      setColors(null);
      return;
    }

    // Cache hit
    if (cache.has(artworkUrl)) {
      setColors(cache.get(artworkUrl) ?? null);
      return;
    }

    let cancelled = false;

    extractColors(artworkUrl).then((result) => {
      if (cancelled) return;
      cache.set(artworkUrl, result);
      pruneCache();
      setColors(result);
    });

    return () => {
      cancelled = true;
    };
  }, [artworkUrl]);

  return colors;
}

/** Format an RGB tuple as a CSS colour string */
export function rgbToCss(rgb: [number, number, number], alpha = 1): string {
  if (alpha === 1) return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}
