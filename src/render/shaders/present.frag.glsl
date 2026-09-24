// Display pass at 60 Hz: the procedural scene, painted over by the diffusion
// stream in proportion to uPaint. Prepended with #version and procedural.glsl
// by the renderer.
//
// The stream arrives at 10-20 fps; between frames the last two are
// crossfaded, and a display-side kick lands beats on the exact frame.

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPrev;
uniform sampler2D uCurr;
uniform float uBlend;        // 0 = prev, 1 = curr
uniform float uHasStream;
uniform float uPaint;        // 0 = pure procedural, 1 = fully painted
uniform float uSourceAspect;
uniform vec2 uTexel;         // 1 / stream size
uniform float uKick;         // beat-push envelope, 0..1

vec3 sharpSample(sampler2D tex, vec2 uv) {
  // Light unsharp mask: the stream is upscaled ~3x, and bilinear alone reads soft.
  vec3 c = texture(tex, uv).rgb;
  vec3 n = texture(tex, uv + vec2(uTexel.x, 0.0)).rgb + texture(tex, uv - vec2(uTexel.x, 0.0)).rgb
         + texture(tex, uv + vec2(0.0, uTexel.y)).rgb + texture(tex, uv - vec2(0.0, uTexel.y)).rgb;
  return clamp(c + (c - n * 0.25) * 0.35, 0.0, 1.0);
}

void main() {
  vec2 uv = (vUv - 0.5) * (1.0 - 0.035 * uKick) + 0.5;
  vec3 procedural = proceduralScene(uv);

  vec3 color = procedural;
  if (uHasStream > 0.5 && uPaint > 0.0) {
    // Cover-fit the stream: fill the canvas, crop the longer axis.
    vec2 s = uv;
    float r = uAspect / uSourceAspect;
    if (r > 1.0) s.y = (s.y - 0.5) / r + 0.5;
    else s.x = (s.x - 0.5) * r + 0.5;
    s.y = 1.0 - s.y; // image rows are top-down
    vec3 painted = mix(sharpSample(uPrev, s), sharpSample(uCurr, s), uBlend);
    color = mix(procedural, painted, uPaint);
  }

  vec2 v = vUv - 0.5;
  color *= 1.0 - dot(v, v) * 0.6;
  fragColor = vec4(color, 1.0);
}
