/**
 * Album-art "visual DNA": a handful of numbers summarizing what a cover
 * looks like, cheap enough to compute on every track change.
 *
 * Deliberately not a display of the artwork itself and not a blur of it -
 * the point is to give the renderer and System1 a track-specific color and
 * contrast bias to lean on, alongside System1's own semantic read of the
 * music. Downsampling to a handful of pixels before reading them back is
 * what keeps this cheap: a 2026-era cover is typically 300-640px square, and
 * none of that resolution matters for an average color and a contrast figure.
 */
export interface ArtworkDNA {
  /** Average color across the cover, 0..1 per channel. */
  color: [number, number, number];
  /** Perceptual luminance of that average, 0..1. */
  luminance: number;
  /** Average saturation across the sampled pixels, 0..1. */
  saturation: number;
  /** Standard deviation of per-pixel luminance - a flat cover reads near 0. */
  contrast: number;
}

const SAMPLE = 16;
let canvas: HTMLCanvasElement | null = null;

/**
 * Loads `url`, downsamples to a SAMPLE x SAMPLE grid, and summarizes it.
 * Resolves to `null` rather than throwing on any failure - a missing image,
 * a network error, or a CORS-tainted canvas (some CDNs do not send the
 * access-control header `crossOrigin` needs) - so a flaky artwork fetch
 * degrades to "no visual DNA this track," never to a crash.
 */
export async function analyzeArtwork(url: string | undefined | null): Promise<ArtworkDNA | null> {
  if (!url) return null;

  try {
    const img = await loadImage(url);

    canvas ??= document.createElement('canvas');
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE); // throws if CORS-tainted

    let r = 0, g = 0, b = 0;
    const lumas: number[] = [];
    let satSum = 0;
    const n = SAMPLE * SAMPLE;

    for (let i = 0; i < n; i++) {
      const off = i * 4;
      const pr = (data[off] ?? 0) / 255;
      const pg = (data[off + 1] ?? 0) / 255;
      const pb = (data[off + 2] ?? 0) / 255;
      r += pr; g += pg; b += pb;

      const max = Math.max(pr, pg, pb);
      const min = Math.min(pr, pg, pb);
      const l = (max + min) / 2;
      lumas.push(0.2126 * pr + 0.7152 * pg + 0.0722 * pb);
      satSum += max === min ? 0 : (l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min));
    }

    r /= n; g /= n; b /= n;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const meanLuma = lumas.reduce((a, x) => a + x, 0) / n;
    const variance = lumas.reduce((a, x) => a + (x - meanLuma) ** 2, 0) / n;

    return {
      color: [r, g, b],
      luminance,
      saturation: satSum / n,
      contrast: Math.sqrt(variance),
    };
  } catch {
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load artwork: ${url}`));
    img.src = url;
  });
}
