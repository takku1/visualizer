#version 300 es
precision highp float;

/**
 * Output pass: HDR accumulation buffer to something a display can show.
 *
 * Kept separate from the scene pass so tone mapping never feeds back into the
 * simulation. If the curve ran inside the loop, the buffer would be tone
 * mapped once per frame, compounding until the image crushed itself flat.
 */

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uBlueNoise;
uniform vec2 uResolution;
uniform vec2 uBlueNoiseSize;
uniform float uTime;
uniform float uExposure;
uniform float uGrain;
uniform float uVignette;
uniform float uBloomStrength;

// ACES filmic curve, Narkowicz's fit. Rolls highlights off instead of
// clipping them, which matters when a beat spikes the accumulation buffer.
vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Static blue-noise threshold, tiled across the frame and rotated a little
// per frame so the tiling never sits still long enough to read as a pattern.
// A precomputed void-and-cluster texture (see scripts/gen-blue-noise.mjs)
// spreads its error across every local neighborhood; a plain per-pixel hash
// clumps by chance, which is exactly what reads as "gritty" instead of clean.
float blueNoise(vec2 fragCoord) {
  vec2 rot = vec2(fract(uTime * 0.61803399), fract(uTime * 0.41421356)) * uBlueNoiseSize;
  vec2 co = mod(fragCoord + rot, uBlueNoiseSize);
  return texture(uBlueNoise, co / uBlueNoiseSize).r;
}

void main() {
  vec3 c = texture(uScene, vUv).rgb;
  c += texture(uBloom, vUv).rgb * uBloomStrength;

  c = aces(c * uExposure);

  float d = length(vUv - 0.5) * 1.414;
  c *= mix(1.0, smoothstep(1.0, 0.35, d), clamp(uVignette, 0.0, 1.0));

  // Grain applied after tone mapping, so it dithers the final banding rather
  // than banding the HDR values themselves.
  float n = blueNoise(gl_FragCoord.xy) - 0.5;
  c += n * uGrain;

  fragColor = vec4(max(c, 0.0), 1.0);
}
