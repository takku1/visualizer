import type { FeatureFrame } from '../types';
import type { SamplerControl } from '../stream/control';
import type { Look, Rgb } from '../stream/scenes';
import { smooth } from '../audio/source';
import type { Uniforms } from './gl';

/** Uniform values for src/render/shaders/procedural.glsl. */
export interface ProceduralUniforms {
  time: number;
  flow: number;
  travel: number;
  swirl: number;
  bass: number;
  treble: number;
  pulse: number;
  flux: number;
  stereo: number;
  energy: number;
  hue: number;
  seed: number;
  warp: number;
  organic: number;
  fold: number;
  colA: Rgb;
  colB: Rgb;
  colC: Rgb;
}

export const DEFAULT_LOOK: Look = {
  palette: [[0.02, 0.03, 0.08], [0.15, 0.4, 0.6], [0.9, 0.8, 0.6]],
  organic: 0.8, warp: 0.5, fold: 0, seed: 0.37,
};

const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * The procedural scene's state: phases integrated from the music every
 * display frame, so motion is continuous and exactly in sync.
 *
 * Accumulated phases (flow, travel) rather than audio-mapped positions: the
 * music sets *speeds*, so a loud passage moves faster without ever jumping.
 */
export class ProceduralScene {
  #from: Look = DEFAULT_LOOK;
  #to: Look = DEFAULT_LOOK;
  #fade = 1;
  #fadeSec: number;
  #fadeRate: number;
  #flow = 0;
  #travel = 0;
  #swirl = 0;
  #bass = 0;
  #treble = 0;
  #energy = 0;
  #pulse = 0;
  #flux = 0;
  #stereo = 0;

  constructor(fadeSec = 2) {
    this.#fadeSec = fadeSec;
    this.#fadeRate = 1 / fadeSec;
  }

  get look(): Look {
    return this.#to;
  }

  /**
   * A new director scene. Continuous parameters crossfade; the discrete ones
 * (fold) remains discrete, while the noise seed glides with the rest of the
 * look so a scene transition cannot jump to a wholly unrelated field.
   */
  setLook(look: Look, fadeSec = this.#fadeSec): void {
    this.#from = this.#blend();
    this.#to = look;
    this.#fade = 0;
    this.#fadeRate = 1 / Math.max(fadeSec, 0.05);
  }

  update(f: FeatureFrame, c: SamplerControl, push: number, energy: number): ProceduralUniforms {
    const dt = f.dt > 0 ? f.dt : 1 / 60;
    this.#fade = Math.min(1, this.#fade + dt * this.#fadeRate);
    this.#bass = smooth(this.#bass, f.bass, dt, 0.08);
    this.#treble = smooth(this.#treble, Math.max(f.treble, f.trebleFlux), dt, 0.05);
    this.#energy = smooth(this.#energy, energy, dt, 0.5);
    this.#pulse = smooth(this.#pulse, push, dt, 0.08);
    this.#flux = smooth(this.#flux, f.flux, dt, 0.12);
    this.#stereo = smooth(this.#stereo, f.stereoWidth, dt, 0.3);

    this.#flow += dt * (0.04 + 0.2 * this.#energy + 0.25 * f.flux);
    // Forward travel in octaves per second; a beat push surges forward.
    this.#travel += dt * (0.05 + 0.18 * this.#energy + 0.9 * push);
    this.#swirl = smooth(this.#swirl, c.rotate * 4, dt, 1);

    const look = this.#blend();
    return {
      time: f.t,
      flow: this.#flow,
      travel: this.#travel,
      swirl: this.#swirl,
      bass: this.#bass,
      treble: this.#treble,
      pulse: this.#pulse,
      flux: this.#flux,
      stereo: this.#stereo,
      energy: this.#energy,
      hue: c.hue,
      seed: look.seed,
      warp: look.warp,
      organic: look.organic,
      fold: look.fold,
      colA: look.palette[0],
      colB: look.palette[1],
      colC: look.palette[2],
    };
  }

  #blend(): Look {
    const t = this.#fade * this.#fade * (3 - 2 * this.#fade);
    const a = this.#from, b = this.#to;
    return {
      palette: [mix3(a.palette[0], b.palette[0], t), mix3(a.palette[1], b.palette[1], t), mix3(a.palette[2], b.palette[2], t)],
      organic: a.organic + (b.organic - a.organic) * t,
      warp: a.warp + (b.warp - a.warp) * t,
      fold: b.fold,
      seed: a.seed + (b.seed - a.seed) * t,
    };
  }
}

/** Set every procedural uniform on a program that includes procedural.glsl. */
export function applyProcedural(u: Uniforms, s: ProceduralUniforms, aspect: number): void {
  u.f('uTime', s.time);
  u.f('uAspect', aspect);
  u.f('uFlow', s.flow);
  u.f('uTravel', s.travel);
  u.f('uSwirl', s.swirl);
  u.f('uBass', s.bass);
  u.f('uTreble', s.treble);
  u.f('uPulse', s.pulse);
  u.f('uFlux', s.flux);
  u.f('uStereo', s.stereo);
  u.f('uEnergy', s.energy);
  u.f('uHue', s.hue);
  u.f('uSeed', s.seed);
  u.f('uWarp', s.warp);
  u.f('uOrganic', s.organic);
  u.f('uFold', s.fold);
  u.v3('uColA', ...s.colA);
  u.v3('uColB', ...s.colB);
  u.v3('uColC', ...s.colC);
}
