#version 300 es
precision highp float;

/**
 * Advances the particle state buffer: position, age, and a per-particle
 * random seed packed into one RGBA texture (R,G = position in plain 0..1
 * texture space, B = age 0..1, A = seed). Particles are advected by the same
 * flow simulation the color feedback reads (sim.frag.glsl's velocity
 * channel), so they visibly ride the same current rather than moving to
 * their own independent logic.
 */

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPrevState;
uniform sampler2D uSim;
uniform float uDt;
uniform float uTime;
uniform float uFlux;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 s = texture(uPrevState, vUv);
  vec2 pos = s.rg;
  float age = s.b;
  float seed = s.a;

  // The texture starts zeroed; without this every particle would spend its
  // first life stacked at the origin and only scatter once it first respawns.
  bool uninitialized = pos.x == 0.0 && pos.y == 0.0 && age == 0.0 && seed == 0.0;
  if (uninitialized) {
    pos = vec2(hash12(vUv + 0.11), hash12(vUv + 0.37));
    seed = hash12(vUv + 0.73);
    age = hash12(vUv + 0.91);
  } else {
    vec2 vel = texture(uSim, clamp(pos, 0.0, 1.0)).rg;
    pos += vel * uDt * 0.12;
    age += uDt * (0.12 + seed * 0.08);
  }

  bool dead = age >= 1.0 || pos.x < -0.05 || pos.x > 1.05 || pos.y < -0.05 || pos.y > 1.05;

  // Respawn bursts get denser with onset density, so particle activity tracks
  // percussive material without a dedicated System1 decision for it.
  float spawnRoll = hash12(vUv * 173.17 + floor(uTime * 11.0));
  bool forceRespawn = spawnRoll < clamp(uFlux, 0.0, 1.0) * 0.02;

  if (!uninitialized && (dead || forceRespawn)) {
    pos = vec2(hash12(vUv + uTime * 0.013 + 0.11), hash12(vUv + uTime * 0.017 + 0.37));
    age = 0.0;
    seed = hash12(vUv + uTime * 0.019 + 0.73);
  }

  fragColor = vec4(pos, age, seed);
}
