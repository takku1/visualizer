// Procedural scene: the structure and motion of the picture, at display rate.
//
// Shared by the display pass (present.frag.glsl) and the capture pass that
// feeds the diffusion sidecar (capture.frag.glsl), so what is shown and what
// is painted are the same scene. Designed as img2img input: strong luminance
// structure and depth, because that is what a one-step denoiser keeps.
//
// No #version line: the including pass prepends it.

uniform float uTime;
uniform float uAspect;     // width / height of the target
uniform float uFlow;       // accumulated domain-warp phase
uniform float uTravel;     // accumulated forward travel (log2 zoom)
uniform float uSwirl;      // twist around the centre, radians
uniform float uBass;       // 0..1, smoothed
uniform float uTreble;     // 0..1, smoothed
uniform float uPulse;      // 0..1, onset/beat impulse
uniform float uFlux;       // 0..1, timbral change
uniform float uStereo;     // 0..1, stereo width
uniform float uEnergy;     // 0..1
uniform float uHue;        // harmony: hue rotation, radians
uniform float uSeed;
uniform float uWarp;       // domain-warp depth (director motion)
uniform float uOrganic;    // 1 = flowing filaments, 0 = architectural bands
uniform float uFold;       // 0 none, 2 mirror, N = N-fold kaleidoscope
uniform vec3 uColA;        // palette: shadow
uniform vec3 uColB;        // palette: body
uniform vec3 uColC;        // palette: light

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1, 0)), c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = r * p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}

// One zoom level of the field, at a given scale.
float layer(vec2 p, float scale) {
  vec2 q = p * scale + uSeed * 13.7;
  vec2 w = vec2(fbm(q + vec2(uFlow, 0.0)), fbm(q + vec2(5.2, 1.3 - uFlow)));
  q += (w - 0.5) * uWarp * (2.2 + 1.5 * uBass + 0.8 * uFlux);
  q.x += (uStereo - 0.5) * 0.08 * sin(uTime * 0.7 + q.y * 2.0);
  float n = fbm(q + uFlow * 0.3);
  float ridge = 1.0 - abs(2.0 * n - 1.0);             // filaments
  float organic = pow(ridge, 3.0) * 0.8 + n * 0.35;
  float bands = smoothstep(0.35, 0.65, fract(n * 5.0)) * 0.7 + n * 0.3; // strata
  return mix(bands, organic, uOrganic);
}

vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

vec3 proceduralScene(vec2 uv) {
  vec2 p = (uv * 2.0 - 1.0) * vec2(uAspect, 1.0);
  float r = length(p);
  float a = atan(p.y, p.x) + uSwirl / (0.35 + r);
  if (uFold >= 1.5) {
    float s = 6.2831853 / uFold;
    a = abs(mod(a + s * 0.5, s) - s * 0.5);
  }
  vec2 q = vec2(cos(a), sin(a)) * r;

  // Infinite forward travel: three octave-spaced zoom levels of the same
  // field, weighted so that level k at the end of an octave is exactly level
  // k-1 at its start. Seamless, and the speed is just d(uTravel)/dt.
  float f = fract(uTravel);
  float v = 0.0, wsum = 0.0;
  for (int k = 0; k < 3; k++) {
    float x = (float(k) + 1.0 - f) / 3.0;          // 0..1 across the stack
    float w = sin(3.14159265 * x);
    v += w * layer(q, exp2(float(k) - f));
    wsum += w;
  }
  v /= wsum;

  // Depth: brighter toward the vanishing point, so travel reads as motion.
  float depth = exp(-r * 1.1);
  float lum = clamp(v * (0.55 + 0.45 * uEnergy) + depth * (0.35 + 0.15 * uPulse), 0.0, 1.2);

  vec3 col = mix(uColA, uColB, smoothstep(0.1, 0.55, lum));
  col = mix(col, uColC, smoothstep(0.55, 1.0, lum));

  // Treble sparkles: sparse points that flare with the highs.
  vec2 g = q * 18.0 * exp2(-f) + uSeed;
  float star = step(0.985, hash21(floor(g))) * smoothstep(0.5, 0.0, length(fract(g) - 0.5));
  col += uColC * star * (uTreble + 0.35 * uPulse) * 1.5;

  col = hueRotate(col, uHue);
  col *= 1.0 - smoothstep(0.7, 1.9, r) * 0.6;
  return max(col, 0.0);
}
