#version 300 es
precision highp float;

/**
 * The procedural pass.
 *
 * Every frame: build a velocity field from the motion parameters, walk
 * backwards along it to sample the previous frame, fade that, and add newly
 * generated structure on top. The image is therefore never drawn from
 * scratch - it is the accumulated history of the field, which is what gives
 * feedback visuals their depth.
 *
 * Every uniform here is a blended value. Nothing switches discretely, so the
 * look can sit between two vocabulary entries indefinitely.
 */

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform float uTime;
uniform float uDt;

// Motion, blended from MOTION in vocab.ts.
uniform float uCurlAmp;
uniform float uCurlFreq;
uniform float uRotate;
uniform float uRadial;
uniform float uShear;
uniform float uWarpSpeed;
uniform float uDetail;
uniform float uQuantize;

// Texture mix weights, blended from TEXTURE. These sum to 1 and are the
// director's distribution passed through unchanged.
uniform float uTexFilament;
uniform float uTexPlasma;
uniform float uTexGrain;
uniform float uTexCellular;
uniform float uTexStrata;
uniform float uTexShards;
uniform float uSharpness;

// Symmetry, blended from SYMMETRY.
uniform float uFold;
uniform float uMirror;
uniform float uPolar;

// Feedback, blended from FEEDBACK.
uniform float uDecay;
uniform float uZoom;
uniform float uFbRotate;
uniform float uChroma;
uniform float uSmear;

// Palette, blended from PALETTE as cosine coefficients.
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;
uniform vec3 uPalD;

// Live audio.
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;
uniform float uFlux;
uniform float uBeatPhase;
uniform float uBarPhase;
uniform float uIntensity;

// Album-art visual DNA: a gentle multiplicative bias toward the cover's own
// average color, alongside whatever palette System1 chose semantically -
// see renderer.ts's setArtwork(). uArtStrength is 0 whenever no artwork is
// available (standalone/Electron builds, or before the first track loads),
// which makes this uniform pair a complete no-op in that case.
uniform vec3 uArtTint;
uniform float uArtStrength;

// Geometry accent weights - a fourth System1 question (see vocab.ts GEOMETRY),
// same one-hot-blends-to-mix pattern as the texture weights above.
uniform float uGeoCircle;
uniform float uGeoHex;
uniform float uGeoStar;

uniform sampler2D uPrev;
uniform sampler2D uSpectrum;
// The independent flow/reaction-diffusion simulation from sim.frag.glsl:
// R,G = velocity, B = U, A = V. Read-only here; sim.frag.glsl owns writing it.
uniform sampler2D uSim;

const float TAU = 6.28318530718;

// ---------------------------------------------------------------- noise ----

vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}

// Gradient noise. Smoothstep interpolation keeps the derivative continuous,
// which matters because we differentiate this to get the curl field.
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

float fbm(vec3 p, float detail) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 4; i++) {
    // Higher octaves fade in with uDetail, so "detail" is a continuous knob
    // rather than an octave count that would pop as it crosses an integer.
    float gate = clamp(detail * 4.0 - float(i) + 1.0, 0.0, 1.0);
    sum += gnoise(p) * amp * gate;
    norm += amp * gate;
    p *= 2.02;
    amp *= 0.5;
  }
  return norm > 0.0 ? sum / norm : 0.0;
}

/**
 * Curl of a scalar potential, in 2D.
 *
 * Taking the perpendicular gradient gives a field with zero divergence, so the
 * flow swirls instead of piling up in sinks. That divergence-free property is
 * the whole reason this reads as fluid rather than as noise.
 */
vec2 curl(vec2 p, float t, float detail) {
  const float e = 0.035;
  float n1 = fbm(vec3(p + vec2(0.0, e), t), detail);
  float n2 = fbm(vec3(p - vec2(0.0, e), t), detail);
  float n3 = fbm(vec3(p + vec2(e, 0.0), t), detail);
  float n4 = fbm(vec3(p - vec2(e, 0.0), t), detail);
  return vec2(n1 - n2, n4 - n3) / (2.0 * e);
}

// ------------------------------------------------------------- symmetry ----

vec2 applySymmetry(vec2 p) {
  // Mirror and fold are blended in rather than branched on, so a distribution
  // sitting between 'mirror' and 'kaleido6' renders as a partial fold.
  vec2 mirrored = vec2(abs(p.x), p.y);
  p = mix(p, mirrored, clamp(uMirror, 0.0, 1.0));

  if (uFold > 0.5) {
    float a = atan(p.y, p.x);
    float r = length(p);
    float seg = TAU / uFold;
    a = abs(mod(a + seg * 0.5, seg) - seg * 0.5);
    p = vec2(cos(a), sin(a)) * r;
  }

  if (uPolar > 0.01) {
    float r = length(p);
    float a = atan(p.y, p.x);
    vec2 polar = vec2(a / 3.14159, r * 1.6 - 0.8);
    p = mix(p, polar, clamp(uPolar, 0.0, 1.0));
  }

  return p;
}

// -------------------------------------------------------------- texture ----

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/**
 * Six ways to turn the same scalar field into visible material.
 *
 * They all read the identical `field`, so the motion underneath is unchanged
 * and only the substance differs - which is what makes mixing two of them
 * coherent rather than a double exposure.
 */
float texFilament(float f, float w) {
  return pow(w / (abs(f) + w), 2.2);
}

float texPlasma(float f) {
  return smoothstep(-0.55, 0.75, f);
}

float texGrain(float f, vec2 co, float t) {
  float mask = smoothstep(-0.15, 0.55, f);
  return mask * (0.25 + 0.75 * hash12(floor(co * 220.0) + floor(t * 24.0)));
}

float texCellular(float f) {
  // Distance to the nearest half-integer contour reads as rounded cells.
  float c = abs(fract(f * 3.0) - 0.5) * 2.0;
  return pow(1.0 - c, 3.0);
}

float texStrata(float f, float sharp) {
  float b = abs(fract(f * 6.0) - 0.5) * 2.0;
  return smoothstep(0.75, mix(0.5, 0.05, sharp), b);
}

float texShards(float f, float sharp) {
  float q = fract(f * 4.0);
  float edge = mix(0.22, 0.02, sharp);
  return smoothstep(0.5 - edge, 0.5 + edge, q) * smoothstep(1.0, 0.72, q);
}

// -------------------------------------------------------------- geometry ---

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

float sdHex(vec2 p, float r) {
  vec2 q = abs(p);
  return max(q.x * 0.8660254 + q.y * 0.5, q.y) - r;
}

float sdStar5(vec2 p, float r) {
  float a = atan(p.y, p.x);
  float rad = r * (0.62 + 0.38 * cos(a * 5.0));
  return length(p) - rad;
}

/**
 * A handful of SDF instances arranged in a slow orbit, blended by the
 * geometry weights and summed as thin rings. This is the one structurally
 * distinct, crisp-edged layer in an otherwise all-noise-derived image - the
 * contrast is the point, not an accident to smooth away.
 */
float geometryField(vec2 p, float t, float beatBump) {
  float wSum = uGeoCircle + uGeoHex + uGeoStar;
  if (wSum < 0.02) return 0.0;

  float acc = 0.0;
  const int N = 5;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float ang = fi * (TAU / float(N)) + t * 0.15 + uBarPhase * TAU * 0.25;
    float rad = 0.35 + 0.22 * sin(t * 0.6 + fi * 1.7) + uBass * 0.15;
    vec2 c = vec2(cos(ang), sin(ang)) * rad;
    vec2 q = p - c;
    float size = 0.09 + 0.05 * beatBump;

    float d = (uGeoCircle * sdCircle(q, size)
             + uGeoHex * sdHex(q, size)
             + uGeoStar * sdStar5(q, size)) / wSum;

    acc += smoothstep(0.02, 0.0, abs(d));
  }
  return acc * wSum;
}

// ---------------------------------------------------------------- color ----

vec3 palette(float t) {
  return uPalA + uPalB * cos(TAU * (uPalC * t + uPalD));
}

float spectrumAt(float x) {
  return texture(uSpectrum, vec2(clamp(x, 0.0, 1.0), 0.5)).r;
}

// ----------------------------------------------------------------- main ----

void main() {
  vec2 res = uResolution;
  float aspect = res.x / max(res.y, 1.0);

  // Centered, aspect-corrected, roughly -1..1 on the short axis.
  vec2 uv = (vUv * 2.0 - 1.0) * vec2(aspect, 1.0);

  float t = uTime * uWarpSpeed;
  float dt = clamp(uDt, 0.0, 0.05);

  // ---- velocity field ----
  vec2 p = applySymmetry(uv);

  if (uQuantize > 0.01) {
    float cells = mix(64.0, 14.0, clamp(uQuantize, 0.0, 1.0));
    p = mix(p, floor(p * cells) / cells, clamp(uQuantize, 0.0, 1.0));
  }

  vec2 vel = curl(p * uCurlFreq, t, uDetail) * uCurlAmp;

  // The independent flow simulation contributes its own velocity on top of
  // the stateless curl field above. Curl alone reinvents itself every frame;
  // this term is where the image actually remembers which way it was moving.
  vec4 sim = texture(uSim, vUv);
  vel += sim.rg * 0.7;

  float r = length(uv) + 1e-4;
  vec2 radialDir = uv / r;
  vec2 tangent = vec2(-radialDir.y, radialDir.x);

  vel += tangent * uRotate;
  // Beat-synced breathing rides on top of the steady radial term, so 'pulse'
  // actually pulses instead of just expanding.
  vel += radialDir * uRadial * (0.55 + 0.45 * sin(uBeatPhase * TAU)) * (0.4 + uBass);
  vel += vec2(1.0, 0.0) * uShear * (0.5 + 0.5 * sin(uv.y * 2.2 + uTime * 0.4));

  // ---- feedback tap ----
  float zoom = 1.0 - uZoom * (1.0 + uLevel * 0.6);
  float ang = uFbRotate * (1.0 + uMid * 0.5);
  float ca = cos(ang);
  float sa = sin(ang);
  mat2 rot = mat2(ca, -sa, sa, ca);

  vec2 back = uv - vel * dt * 2.4;
  back = rot * back * zoom;

  // Back to texture space.
  vec2 tap = back / vec2(aspect, 1.0) * 0.5 + 0.5;

  // Per-channel offset along the flow direction reads as chromatic aberration
  // that follows the motion, rather than a static lens artifact.
  vec2 chromaDir = normalize(vel + 1e-5) * uChroma * 0.004;
  vec3 prev;
  prev.r = texture(uPrev, tap + chromaDir).r;
  prev.g = texture(uPrev, tap).g;
  prev.b = texture(uPrev, tap - chromaDir).b;

  if (uSmear > 0.01) {
    vec2 step = normalize(vel + 1e-5) / res * (2.0 + uSmear * 10.0);
    vec3 blur = vec3(0.0);
    for (int i = 1; i <= 4; i++) {
      blur += texture(uPrev, tap + step * float(i)).rgb;
      blur += texture(uPrev, tap - step * float(i)).rgb;
    }
    prev = mix(prev, blur / 8.0, clamp(uSmear, 0.0, 1.0) * 0.8);
  }

  // ---- newly generated structure ----
  float field = fbm(vec3(p * uCurlFreq * 1.3 + vel * 0.3, t * 1.7), uDetail);

  // Fold the reaction-diffusion pattern into the same field the texture
  // forms read from, rather than compositing it as a separate visible layer.
  // Structural variety this way survives the texture blend instead of being
  // one more thing sitting on top of it.
  // How much the reaction-diffusion pattern shows through was a fixed 0.35
  // regardless of what System1 chose - a constant layer sitting on top of
  // every look, which is exactly what made different decisions read as the
  // same image. Tied to uDetail (calm motions barely show it, busy ones
  // lean into it hard) and to the rougher textures, which is what an
  // organic branching pattern actually belongs under.
  float rdWeight = mix(0.06, 0.6, uDetail);
  rdWeight *= mix(0.7, 1.4, clamp(uTexGrain + uTexCellular + uTexShards, 0.0, 1.0));
  field = mix(field, sim.a * 2.0 - 1.0, clamp(rdWeight, 0.0, 0.8));

  // Filaments: the zero-crossings of the field, thinned to bright lines. The
  // spectrum modulates their width by radius, so bass widens the core and
  // treble picks out the edges.
  float spec = spectrumAt(pow(clamp(r / 1.6, 0.0, 1.0), 0.6));
  float width = mix(0.045, 0.012, clamp(uTreble, 0.0, 1.0)) * (1.0 + spec * 2.0);

  // Composite the texture forms by the director's weights. Normalizing by the
  // weight sum keeps brightness constant across a transition - otherwise the
  // image dims mid-crossfade as weight moves between two forms.
  float wSum = uTexFilament + uTexPlasma + uTexGrain + uTexCellular + uTexStrata + uTexShards;
  float ink = 0.0;
  ink += uTexFilament * texFilament(field, width);
  ink += uTexPlasma   * texPlasma(field);
  ink += uTexGrain    * texGrain(field, vUv, uTime);
  ink += uTexCellular * texCellular(field);
  ink += uTexStrata   * texStrata(field, uSharpness);
  ink += uTexShards   * texShards(field, uSharpness);
  ink /= max(wSum, 1e-3);

  // Spectrum still modulates amplitude regardless of which form won.
  ink *= 0.75 + spec * 0.75;

  // Ring locked to the bar, so there is a slow structural pulse under the
  // faster beat-level motion.
  float ring = smoothstep(0.06, 0.0, abs(r - uBarPhase * 1.5)) * uBass * 0.55;
  ink += ring;

  // Crisp SDF accents, distinct in kind (hard edges) from everything else in
  // this pass (noise-derived, always soft). Beat-synced pulse on their size.
  float beatBump = pow(0.5 + 0.5 * sin(uBeatPhase * TAU), 6.0);
  ink += geometryField(p, uTime, beatBump) * 0.6;

  float energy = clamp(uIntensity / 4.0, 0.0, 1.0);
  ink *= 0.35 + energy * 1.15;
  ink *= 0.6 + uLevel * 0.8;

  // Color the ink by where it sits in the field and how far out it is, so the
  // palette sweeps across the image instead of flat-filling it.
  float hue = field * 0.5 + r * 0.25 + uTime * 0.02 + uFlux * 0.15;
  vec3 color = palette(hue) * ink;

  // Artwork bias: uArtTint is the cover's average color; *2.0 centers a
  // mid-grey cover at 1.0 (no-op), while a saturated cover pulls the whole
  // image's color balance toward it without overriding which palette family
  // System1 chose - the two visual-DNA sources compose, neither replaces
  // the other.
  color *= mix(vec3(1.0), uArtTint * 2.0, uArtStrength);

  // Onsets flash the whole frame slightly. Subtle on purpose: at full strength
  // this is a strobe, and a strobe stops being a visualizer.
  color += palette(hue + 0.5) * uFlux * 0.12 * energy;

  // Energy-conserving accumulation.
  //
  // The obvious `prev * decay + color` is wrong: it settles at
  // color / (1 - decay), so decay 0.82 multiplies the image by ~5.5 and the
  // screen saturates to white no matter what the audio does. Weighting the
  // new contribution by (1 - decay) makes the steady state equal `color`, and
  // turns decay into an actual time constant rather than a gain.
  float decay = clamp(uDecay, 0.0, 0.985);
  vec3 outColor = prev * decay + color * (1.0 - decay);

  // Clamp before the buffer, not after. Feedback multiplies its own output
  // every frame, so an unbounded value turns the screen white within a second.
  outColor = min(outColor, vec3(4.0));

  fragColor = vec4(outColor, 1.0);
}
