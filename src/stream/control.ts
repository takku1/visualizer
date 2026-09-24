import type { FeatureFrame } from '../types';
import { smooth } from '../audio/source';

/**
 * Sampling physics for one fast-loop frame. Mirrors `Control` in
 * tools/stream-server.py; every field is model-agnostic in meaning even though
 * the sidecar realizes it with a diffusion sampler.
 *
 * Nothing here describes content. Audio perturbs *how* the image evolves -
 * how much of it is re-imagined, how noisy, how detailed, how the camera
 * moves - and the slow loop alone decides *what* is on screen.
 */
export interface SamplerControl {
  /** Fraction of the diffusion trajectory re-run each frame. 0 freezes, 1 re-imagines. */
  strength: number;
  /** Fresh (incoherent) share of the injected noise: the loop's temperature. */
  noise: number;
  /** High-frequency noise amplitude: fine detail that shimmers with the highs. */
  detail: number;
  /** Camera zoom rate, per second. The sidecar springs the camera back home. */
  zoom: number;
  /** Camera rotation rate, radians per second. */
  rotate: number;
  /** Camera translation rates, fraction of the frame per second. */
  driftX: number;
  driftY: number;
  /** How fast the coherent noise field rotates, radians per second: texture evolution speed. */
  noiseWalk: number;
  /**
   * Share of the previous frame in the next input; the rest is the keyframe.
   * Kept low (<= 0.35 at the sidecar): above ~0.5 the loop abandons the scene
   * for its own attractor. Continuity comes from the flow field instead.
   */
  feedback: number;
  /** Flow-field displacement amplitude, fraction of the frame: how far content drifts. */
  flow: number;
  /** How fast the flow field itself evolves, radians per second. */
  flowSpeed: number;

  // ---- network bending: transforms inside the UNet (tools/stream-server.py Bender) ----
  /** Mid-layer channel rotation, radians. Harmony: chords away from the home key rotate the color world. */
  hue: number;
  /** Early-layer dilation blend, <= 0.4. Bass swells the structure. */
  swell: number;
  /** Late-layer soft-threshold blend, <= 0.9. Treble onsets glint as luminous filaments. */
  glass: number;
  /** Early-layer inversion blend, <= 0.2. Drops shift the scene itself. */
  lurch: number;

  // ---- h-space directions: signed strengths at the UNet bottleneck (knob mode) ----
  /** + explosive/chaotic, - calm/still. */
  hsEnergy?: number;
  /** + luminous, - shadowy. */
  hsLight?: number;
  /** + organic flowing, - geometric hard-edged. */
  hsOrganic?: number;
}

export const CALM: SamplerControl = {
  strength: 0.35, noise: 0.01, detail: 0, zoom: 0.02, rotate: 0,
  driftX: 0, driftY: 0, noiseWalk: 0.03, feedback: 0.2, flow: 0.01, flowSpeed: 0.15,
  hue: 0, swell: 0, glass: 0, lurch: 0,
};

/** Pitch class -> position on the circle of fifths (C=0, G=1, D=2, ...). */
const FIFTHS = Array.from({ length: 12 }, (_, pc) => (pc * 7) % 12);

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Low-level features in, sampler physics out. Stateful only for envelopes:
 * smoothing, the beat push, and the rotation direction.
 */
export class ControlMapper {
  #bass = 0;
  #level = 0;
  #push = 0;
  #spin = 1;
  #section = -1;
  #homeX = 0;
  #homeY = 0;
  #hue = 0;
  #swell = 0;
  #glass = 0;
  #fast = 0;
  #slow = 0;
  #lurch = 0;
  #lurchCooldown = 0;
  #listened = 0;
  #energy = 0;

  /** The current beat-push envelope, 0..1. The renderer reuses it for a display-side kick. */
  get push(): number {
    return this.#push;
  }

  /** Blended loudness/intensity, 0..1, from the last `map` call. */
  get energy(): number {
    return this.#energy;
  }

  /**
   * @param intensity Slow-loop energy judgement, 0..1 (the director's Score / 4).
   *   It sets the operating range; the live features move within it.
   */
  map(f: FeatureFrame, intensity = 0.5): SamplerControl {
    const dt = f.dt > 0 ? f.dt : 1 / 60;
    this.#bass = smooth(this.#bass, f.bass, dt, 0.12);
    this.#level = smooth(this.#level, f.level, dt, 0.25);

    // Beat pushes: a quantized kick on the beat grid, scaled by how hard the
    // bass actually hit, plus any off-grid bass onset strong enough to matter.
    // A synthesized grid (loopback only, no analysis) wanders by tens of BPM,
    // and pushes on a wrong grid read as stutter: trust the grid only when
    // it is measured or confident, and real bass onsets always.
    this.#push *= Math.exp(-dt / 0.15);
    const gridTrusted = f.hasStructure || f.rhythmConfidence > 0.5
      || (f.beatSource === 'tracker' && f.confidence > 0.5);
    if (f.onBeat && gridTrusted) this.#push = Math.max(this.#push, 0.5 + 0.5 * f.bassFlux);
    if (f.bassFlux > 0.45) this.#push = Math.max(this.#push, f.bassFlux);

    if (f.sectionIndex !== this.#section) {
      if (this.#section >= 0) this.#spin = -this.#spin;
      this.#section = f.sectionIndex;
    }

    const bend = this.#bend(f, dt);
    if (this.#level < 0.02) {
      this.#energy = 0;
      return { ...CALM };
    }

    const relative = clamp((f.levelRelative + 2) / 4, 0, 1);
    const energy = clamp(0.5 * this.#level + 0.25 * relative + 0.25 * intensity, 0, 1);
    this.#energy = energy;
    const push = this.#push;

    // Smoothness comes from keeping the noise nearly fixed, as StreamDiffusion
    // does: the model then makes the same decisions each frame. Measured on
    // the A3000 (jitter = latent second difference): 0.63 with fresh,
    // fast-rotating noise at strength 0.4, 0.27 with near-frozen noise even
    // at strength 0.5. So strength stays high (it is what re-details the
    // frame) and noise turnover is slow and onset-driven.
    return {
      strength: clamp(0.38 + 0.1 * this.#bass + 0.05 * energy + 0.1 * push, 0.3, 0.6),
      noise: clamp(0.01 + 0.04 * this.#level ** 1.5 + 0.05 * f.transientness, 0, 0.12),
      detail: clamp(0.12 * f.treble + 0.25 * f.trebleFlux, 0, 0.3),
      zoom: 0.04 + 0.08 * energy + 1.6 * push,
      rotate: this.#spin * (0.03 + 0.12 * f.mid),
      driftX: 0.05 * (f.spectralCentroid - 0.5),
      driftY: 0.03 * Math.sin(f.barPhase * Math.PI * 2) * energy,
      noiseWalk: 0.03 + 0.15 * f.flux + 0.05 * energy,
      // Sustained, harmonic material keeps a little more memory (trails);
      // transients re-ground the frame in the keyframe.
      feedback: clamp(0.18 + 0.07 * f.harmonicity - 0.12 * f.transientness - 0.1 * push, 0.05, 0.25),
      // The animation itself: content flows further with energy and bass,
      // and the flow pattern turns over faster with onsets.
      flow: clamp(0.012 + 0.02 * energy + 0.01 * this.#bass, 0, 0.04),
      flowSpeed: 0.2 + 0.4 * f.flux + 0.2 * energy,
      ...bend,
    };
  }

  /**
   * Network-bending envelopes. Each has a soft attack: bends that snap on and
   * off every beat measured as boiling (live jitter +22% before smoothing).
   */
  #bend(f: FeatureFrame, dt: number): Pick<SamplerControl, 'hue' | 'swell' | 'glass' | 'lurch'> {
    // Harmony: the chroma's centre of mass on the circle of fifths, against a
    // slowly adapting home key. Moving away from home rotates the colour
    // world; resolving home un-rotates it. Tonal clarity scales the depth, so
    // noise and drums do not steer it.
    let x = 0, y = 0, total = 0;
    for (let pc = 0; pc < 12; pc++) {
      const w = f.chroma[pc] ?? 0;
      const a = (FIFTHS[pc]! / 12) * Math.PI * 2;
      x += w * Math.cos(a);
      y += w * Math.sin(a);
      total += w;
    }
    const clarity = total > 1e-6 ? Math.hypot(x, y) / total : 0;
    if (clarity > 0.05) {
      const k = 1 - Math.exp(-dt / 20);
      this.#homeX += (x / total - this.#homeX) * k;
      this.#homeY += (y / total - this.#homeY) * k;
    }
    const away = clarity > 0.05 ? Math.atan2(this.#homeX * y - this.#homeY * x, this.#homeX * x + this.#homeY * y) : 0;
    this.#hue = smooth(this.#hue, clamp(away * 0.45 * Math.min(clarity * 2, 1), -1.4, 1.4), dt, 0.5);

    // Bass swell follows the beat push, eased in over ~60 ms.
    this.#swell = smooth(this.#swell, 0.3 * this.#push, dt, this.#push > this.#swell / 0.3 ? 0.06 : 0.25);
    // Treble onsets glint; the glint fades over ~200 ms.
    this.#glass = smooth(this.#glass, clamp(1.2 * f.trebleFlux, 0, 0.7), dt, f.trebleFlux * 1.2 > this.#glass ? 0.04 : 0.2);

    // Drops: fast energy jumping well above its slow average, loud enough to
    // matter, at most once per 8 s. The lurch shifts the scene, then decays.
    if (this.#listened === 0) this.#fast = this.#slow = f.level; // start from where the music is
    this.#fast = smooth(this.#fast, f.level, dt, 0.1);
    this.#slow = smooth(this.#slow, f.level, dt, 4);
    this.#lurchCooldown = Math.max(0, this.#lurchCooldown - dt);
    this.#lurch *= Math.exp(-dt / 0.4);
    // The slow average needs a few seconds before a jump above it means
    // anything; otherwise starting mid-song at full volume reads as a drop.
    this.#listened += dt;
    if (this.#listened > 4 && this.#lurchCooldown === 0 && this.#fast > 0.4 && this.#fast - this.#slow > 0.3) {
      this.#lurch = 1;
      this.#lurchCooldown = 8;
    }

    return { hue: this.#hue, swell: this.#swell, glass: this.#glass, lurch: 0.18 * this.#lurch };
  }
}
