#version 300 es
precision highp float;

/** Output pass: HDR accumulation buffer to a displayable image. */

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
uniform float uImagePrimary;

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float blueNoise(vec2 fragCoord) {
  vec2 rot = vec2(fract(uTime * 0.61803399), fract(uTime * 0.41421356)) * uBlueNoiseSize;
  vec2 co = mod(fragCoord + rot, uBlueNoiseSize);
  return texture(uBlueNoise, co / uBlueNoiseSize).r;
}

void main() {
  vec3 c = texture(uScene, vUv).rgb;
  c += texture(uBloom, vUv).rgb * uBloomStrength;
  // Learned material gets a clean display path. The procedural fallback keeps
  // ACES/HDR styling, but image-primary mode should not turn the checkpoint
  // into a bloom-treated demo effect.
  c = uImagePrimary > 0.5 ? clamp(c * uExposure, 0.0, 1.0) : aces(c * uExposure);
  float d = length(vUv - 0.5) * 1.414;
  c *= mix(1.0, smoothstep(1.0, 0.35, d), clamp(uVignette, 0.0, 1.0));
  c += (blueNoise(gl_FragCoord.xy) - 0.5) * uGrain;
  fragColor = vec4(max(c, 0.0), 1.0);
}
