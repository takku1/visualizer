#version 300 es
precision highp float;

/**
 * Draws the particle state texture as GL_POINTS with no vertex buffer, same
 * approach as the fullscreen triangle: gl_VertexID indexes a texel via
 * texelFetch instead of reading a bound attribute.
 */

uniform sampler2D uState;
uniform ivec2 uStateSize;
uniform float uPointSize;
uniform float uBeatBump;

out float vAge;
out float vSeed;

void main() {
  int i = gl_VertexID;
  ivec2 texel = ivec2(i % uStateSize.x, i / uStateSize.x);
  vec4 s = texelFetch(uState, texel, 0);
  vec2 pos = s.rg;
  vAge = s.b;
  vSeed = s.a;

  // Plain 0..1 texture space maps straight to NDC, same as the fullscreen
  // triangle - the framebuffer itself carries no aspect correction; that only
  // happens inside the noise math in scene.frag.glsl.
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);

  // Fade in/out over the particle's life so respawns don't pop into view.
  float lifeFade = smoothstep(0.0, 0.08, vAge) * smoothstep(1.0, 0.85, vAge);
  gl_PointSize = uPointSize * (0.5 + 0.5 * vSeed) * lifeFade * (1.0 + uBeatBump * 0.8);
}
