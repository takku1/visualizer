import type { Look, Rgb } from '../stream/scenes';

export type ColorScheme = 'monochromatic' | 'analogous' | 'complementary' | 'split-complementary' | 'triadic' | 'custom';

/** Persistent visual intent; audio may modulate it but does not replace it. */
export interface ColorState {
  dominantHue: number;
  accentHue: number;
  scheme: ColorScheme;
  saturation: number;
  contrast: number;
  temperature: number;
  luminance: number;
  accentWeight: number;
}

/** Persistent illumination intent, separate from palette identity. */
export interface LightingState {
  keyIntensity: number;
  fillIntensity: number;
  shadowDensity: number;
  warmth: number;
  atmosphere: number;
  direction: 'front' | 'side' | 'back' | 'ambient';
}

/** Compile the legacy three-color Look into persistent world intent. */
export function colorStateFromLook(look: Look): ColorState {
  const dominant = look.palette[1];
  const accent = look.palette[2];
  const shadow = look.palette[0];
  const dominantLum = luminance(dominant);
  const accentLum = luminance(accent);
  return {
    dominantHue: hue(dominant),
    accentHue: hue(accent),
    scheme: 'custom',
    saturation: clamp(saturation(dominant), 0, 1),
    contrast: clamp((accentLum - luminance(shadow)) * 1.5, 0, 1),
    temperature: clamp((dominant[0] - dominant[2] + 1) / 2, 0, 1),
    luminance: clamp(dominantLum, 0, 1),
    accentWeight: clamp(accentLum / Math.max(dominantLum + accentLum, 1e-6), 0, 1),
  };
}

export function lightingStateFromLook(look: Look, intensity = 0.5): LightingState {
  const key = luminance(look.palette[2]);
  const fill = luminance(look.palette[1]);
  return {
    keyIntensity: clamp(key * (0.7 + intensity * 0.3), 0, 1),
    fillIntensity: clamp(fill, 0, 1),
    shadowDensity: clamp(1 - luminance(look.palette[0]), 0, 1),
    warmth: clamp((look.palette[2][0] - look.palette[2][2] + 1) / 2, 0, 1),
    atmosphere: clamp(look.organic * 0.7 + look.warp * 0.3, 0, 1),
    direction: look.fold > 0 ? 'ambient' : look.warp > 0.6 ? 'side' : 'front',
  };
}

function luminance(rgb: Rgb): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function hue(rgb: Rgb): number {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const delta = max - min;
  if (delta < 1e-6) return 0;
  let result: number;
  if (max === rgb[0]) result = ((rgb[1] - rgb[2]) / delta) % 6;
  else if (max === rgb[1]) result = (rgb[2] - rgb[0]) / delta + 2;
  else result = (rgb[0] - rgb[1]) / delta + 4;
  return ((result / 6) + 1) % 1;
}

function saturation(rgb: Rgb): number {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const light = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
