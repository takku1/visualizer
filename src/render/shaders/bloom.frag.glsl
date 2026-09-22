#version 300 es
precision highp float;

/**
 * Bloom extraction + blur, one pass.
 *
 * Deliberately not a full separable two-pass gaussian: a weighted 3x3 tap
 * spread over a few texels, rendered into a half-resolution target, gets most
 * of the visual benefit (soft glow around anything that clips the threshold)
 * for a fraction of the cost. The downsample itself does real work here - a
 * 3x3 kernel on a half-res target already covers roughly a 6x6 neighborhood
 * of the source.
 */

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uThreshold;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 texel = 1.0 / uResolution;

  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 off = vec2(float(dx), float(dy)) * texel * 2.2;
      float w = 1.0 / (1.0 + float(dx * dx + dy * dy));
      sum += texture(uScene, vUv + off).rgb * w;
      wsum += w;
    }
  }
  vec3 c = sum / max(wsum, 1e-4);

  // Soft-knee threshold: nothing below uThreshold contributes, a smooth ramp
  // up to 2x threshold so the glow doesn't have a hard edge where it starts.
  float k = smoothstep(uThreshold, uThreshold * 2.0, luma(c));
  fragColor = vec4(c * k, 1.0);
}
