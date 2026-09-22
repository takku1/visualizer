#version 300 es

// A fullscreen triangle, generated from gl_VertexID. No vertex buffer, no VAO
// attributes to bind. Three vertices covering the screen beat two triangles:
// there is no diagonal seam for the rasterizer to shade twice.
out vec2 vUv;

void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
