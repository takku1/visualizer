// Capture pass: the procedural scene alone, rendered small and sent to the
// diffusion sidecar as its camera input. Prepended with #version and
// procedural.glsl by the renderer.

in vec2 vUv;
out vec4 fragColor;

void main() {
  // Rows top-down, as the sidecar reads the JPEG.
  fragColor = vec4(proceduralScene(vec2(vUv.x, 1.0 - vUv.y)), 1.0);
}
