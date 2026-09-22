#version 300 es
precision highp float;

in float vAge;
in float vSeed;
out vec4 fragColor;

uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;
uniform vec3 uPalD;
uniform float uBrightness;

const float TAU = 6.28318530718;

vec3 palette(float t) {
  return uPalA + uPalB * cos(TAU * (uPalC * t + uPalD));
}

void main() {
  // gl_PointCoord is only defined inside a POINTS draw - this shader is never
  // used for anything else, so that's a safe assumption rather than a risk.
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = length(uv);
  float soft = smoothstep(1.0, 0.0, d);
  float lifeFade = smoothstep(0.0, 0.08, vAge) * smoothstep(1.0, 0.85, vAge);

  // Drawn additively (see renderer.ts), so this writes energy to add, not a
  // final color - soft^2 keeps the core brighter than the falloff without
  // needing a separate alpha channel.
  vec3 col = palette(vSeed * 0.8 + vAge * 0.3);
  fragColor = vec4(col * soft * soft * lifeFade * uBrightness, 1.0);
}
