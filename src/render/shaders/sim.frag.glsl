#version 300 es
precision highp float;

/**
 * A second, independent simulation, ping-ponged separately from the color
 * accumulation buffer in renderer.ts. Where the scene pass generates its
 * field from a stateless fbm evaluated fresh every frame, this buffer has
 * real memory: a velocity field that advects itself, and a Gray-Scott
 * reaction-diffusion pair growing on top of it. The scene pass reads the
 * result rather than reimplementing it, so the two never fall out of sync.
 *
 * Packed into one RGBA16F texture: R,G = velocity.xy, B = U, A = V (the two
 * Gray-Scott concentrations). One texture, one pass, one ping-pong pair.
 */

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPrev;
uniform vec2 uResolution;
uniform float uTime;
uniform float uDt;

// Reuses the same blended motion parameters the scene pass is using, so the
// flow field reads as part of the same "motion" rather than a second,
// unrelated layer of movement.
uniform float uCurlAmp;
uniform float uCurlFreq;
uniform float uWarpSpeed;

// Raw audio drives what the color feedback buffer cannot: continuous
// reseeding and the reaction-diffusion regime itself.
uniform float uBass;
uniform float uTreble;
uniform float uFlux;

vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}

float gnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dot(hash3(i + vec3(0, 0, 0)), f - vec3(0, 0, 0)),
            dot(hash3(i + vec3(1, 0, 0)), f - vec3(1, 0, 0)), u.x),
        mix(dot(hash3(i + vec3(0, 1, 0)), f - vec3(0, 1, 0)),
            dot(hash3(i + vec3(1, 1, 0)), f - vec3(1, 1, 0)), u.x), u.y),
    mix(mix(dot(hash3(i + vec3(0, 0, 1)), f - vec3(0, 0, 1)),
            dot(hash3(i + vec3(1, 0, 1)), f - vec3(1, 0, 1)), u.x),
        mix(dot(hash3(i + vec3(0, 1, 1)), f - vec3(0, 1, 1)),
            dot(hash3(i + vec3(1, 1, 1)), f - vec3(1, 1, 1)), u.x), u.y),
    u.z);
}

vec2 curl(vec2 p, float t) {
  const float e = 0.06;
  float n1 = gnoise(vec3(p + vec2(0.0, e), t));
  float n2 = gnoise(vec3(p - vec2(0.0, e), t));
  float n3 = gnoise(vec3(p + vec2(e, 0.0), t));
  float n4 = gnoise(vec3(p - vec2(e, 0.0), t));
  return vec2(n1 - n2, n4 - n3) / (2.0 * e);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 texel = 1.0 / uResolution;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 uv = vUv;

  vec4 self = texture(uPrev, uv);
  vec2 vel = self.rg;

  // Semi-Lagrangian advection: sample where this parcel came from, not where
  // it is. Sampling forward from the current cell is unconditionally
  // unstable at any real velocity; backward sampling is what makes a
  // feedback-fed simulation survive more than a few dozen frames.
  vec2 back = uv - vel * texel * uDt * 90.0;

  vec4 prev = texture(uPrev, back);
  float U = prev.b;
  float V = prev.a;

  // Velocity itself relaxes toward a curl-noise force field sharing the
  // scene's own motion parameters, with damping so energy cannot accumulate
  // without bound in a loop that feeds on its own output every frame.
  vec2 p = (uv * 2.0 - 1.0) * vec2(aspect, 1.0);
  vec2 force = curl(p * uCurlFreq, uTime * uWarpSpeed) * uCurlAmp;
  vec2 newVel = (prev.rg * 0.98 + force * uDt * 2.0);

  // Gray-Scott reaction-diffusion. feed/kill drift with the spectrum rather
  // than sitting at one fixed pair, so the pattern regime itself - spots,
  // coral, mitosis-style splitting - shifts with the music instead of only
  // the color painted over a fixed pattern.
  float feed = mix(0.030, 0.058, clamp(uBass, 0.0, 1.0));
  float kill = mix(0.058, 0.0645, clamp(uTreble, 0.0, 1.0));

  float lapU = texture(uPrev, back + vec2(texel.x, 0.0)).b
             + texture(uPrev, back - vec2(texel.x, 0.0)).b
             + texture(uPrev, back + vec2(0.0, texel.y)).b
             + texture(uPrev, back - vec2(0.0, texel.y)).b
             - 4.0 * U;
  float lapV = texture(uPrev, back + vec2(texel.x, 0.0)).a
             + texture(uPrev, back - vec2(texel.x, 0.0)).a
             + texture(uPrev, back + vec2(0.0, texel.y)).a
             + texture(uPrev, back - vec2(0.0, texel.y)).a
             - 4.0 * V;

  float reaction = U * V * V;
  float newU = U + (1.0 * lapU - reaction + feed * (1.0 - U)) * uDt * 20.0;
  float newV = V + (0.5 * lapV + reaction - (feed + kill) * V) * uDt * 20.0;

  // Continuous sparse reseeding, gated by onset density: quiet, static
  // passages let the pattern settle; busy ones keep spawning new growth
  // points. Without this the field eventually reaches a fixed point and
  // stops responding to anything.
  float seedRoll = hash12(gl_FragCoord.xy + floor(uTime * 6.0) * 17.0);
  float inject = step(0.9975 - clamp(uFlux, 0.0, 1.0) * 0.01, seedRoll);
  newV = clamp(newV + inject, 0.0, 1.0);
  newU = clamp(newU - inject * 0.5, 0.0, 1.0);

  fragColor = vec4(newVel, clamp(newU, 0.0, 1.0), clamp(newV, 0.0, 1.0));
}
