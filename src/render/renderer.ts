import type { FeatureFrame, VisualPlan } from '../types';
import {
  MOTION, PALETTE, TEXTURE, GEOMETRY, SYMMETRY, FEEDBACK, blend,
  type MotionParams, type PaletteParams, type TextureParams, type GeometryParams,
  type SymmetryParams, type FeedbackParams,
} from '../director/vocab';
import { createProgram, Uniforms, PingPong, RenderTarget, StaticTexture, SpectrumTexture } from './gl';
import { BINS } from '../audio/source';
import { BLUE_NOISE_SIZE, BLUE_NOISE_B64 } from './blueNoise.data';

import quadVert from './shaders/quad.vert.glsl';
import sceneFrag from './shaders/scene.frag.glsl';
import presentFrag from './shaders/present.frag.glsl';
import simFrag from './shaders/sim.frag.glsl';
import bloomFrag from './shaders/bloom.frag.glsl';
import particleSimFrag from './shaders/particleSim.frag.glsl';
import particleRenderVert from './shaders/particleRender.vert.glsl';
import particleRenderFrag from './shaders/particleRender.frag.glsl';

/** Every blended parameter the shader needs, in one flat bag. */
interface RenderParams {
  motion: MotionParams;
  palette: PaletteParams;
  texture: TextureParams;
  geometry: GeometryParams;
  symmetry: SymmetryParams;
  feedback: FeedbackParams;
  intensity: number;
}

export interface RendererOptions {
  /**
   * Render scale. Feedback shaders are fill-rate bound, so 0.75 on a 4K
   * display costs almost nothing visually and roughly halves the work.
   */
  scale?: number;
  /** Seconds to crossfade between plans when the cut is not hard. */
  transitionSec?: number;
}

/** Particle state texture side length. 64x64 = 4096 GPU-resident particles. */
const PARTICLE_GRID = 64;
const PARTICLE_COUNT = PARTICLE_GRID * PARTICLE_GRID;

export class Renderer {
  #gl: WebGL2RenderingContext;

  #scene: WebGLProgram;
  #present: WebGLProgram;
  #sim: WebGLProgram;
  #bloom: WebGLProgram;
  #particleSim: WebGLProgram;
  #particleRender: WebGLProgram;

  #sceneU: Uniforms;
  #presentU: Uniforms;
  #simU: Uniforms;
  #bloomU: Uniforms;
  #particleSimU: Uniforms;
  #particleRenderU: Uniforms;

  #buffers: PingPong;
  #simBuf: PingPong;
  #particleBuf: PingPong;
  #bloomTarget: RenderTarget;
  #spectrum: SpectrumTexture;
  #blueNoise: StaticTexture;

  #vao: WebGLVertexArrayObject;
  #particleVao: WebGLVertexArrayObject;

  #current: RenderParams;
  #target: RenderParams;
  #scale: number;
  #transition: number;
  #disposed = false;

  // Artwork tint. Held separately from RenderParams since it comes from a
  // different source (track metadata, not the director's plan) and does not
  // participate in the plan-to-plan crossfade - it just fades to a target
  // strength each frame like everything else driven directly off track state.
  #artTint: [number, number, number] = [1, 1, 1];
  #artStrength = 0;
  #artStrengthTarget = 0;

  // Perf-isolation toggles for the validation pass - measure frame time with
  // each subsystem on vs off to attribute cost, not a user-facing feature.
  // See dev/harness.ts's number-key bindings.
  #debug = { sim: true, particles: true, bloom: true };

  constructor(readonly canvas: HTMLCanvasElement, plan: VisualPlan, opts: RendererOptions = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      // The feedback buffer is the real history; the default backbuffer is
      // just the last presented frame, so preserving it buys nothing.
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is unavailable');

    this.#gl = gl;
    this.#scale = opts.scale ?? 1;
    this.#transition = opts.transitionSec ?? 2.5;

    this.#scene = createProgram(gl, quadVert, sceneFrag);
    this.#present = createProgram(gl, quadVert, presentFrag);
    this.#sim = createProgram(gl, quadVert, simFrag);
    this.#bloom = createProgram(gl, quadVert, bloomFrag);
    this.#particleSim = createProgram(gl, quadVert, particleSimFrag);
    this.#particleRender = createProgram(gl, particleRenderVert, particleRenderFrag);

    this.#sceneU = new Uniforms(gl, this.#scene);
    this.#presentU = new Uniforms(gl, this.#present);
    this.#simU = new Uniforms(gl, this.#sim);
    this.#bloomU = new Uniforms(gl, this.#bloom);
    this.#particleSimU = new Uniforms(gl, this.#particleSim);
    this.#particleRenderU = new Uniforms(gl, this.#particleRender);

    const vao = gl.createVertexArray();
    const particleVao = gl.createVertexArray();
    if (!vao || !particleVao) throw new Error('failed to allocate VAO');
    this.#vao = vao;
    this.#particleVao = particleVao;

    const { w, h } = this.#targetSize();
    this.#buffers = new PingPong(gl, w, h);
    // The sim (flow + reaction-diffusion) runs at a quarter of the main
    // resolution: RD patterns and a flow field carry no benefit from full
    // pixel density, and the Laplacian taps in sim.frag.glsl are the single
    // most expensive per-pixel cost in the whole pipeline.
    this.#simBuf = new PingPong(gl, Math.max(2, w >> 2), Math.max(2, h >> 2));
    this.#particleBuf = new PingPong(gl, PARTICLE_GRID, PARTICLE_GRID);
    this.#bloomTarget = new RenderTarget(gl, Math.max(2, w >> 1), Math.max(2, h >> 1), this.#buffers.float);
    this.#spectrum = new SpectrumTexture(gl, BINS);
    this.#blueNoise = new StaticTexture(gl, BLUE_NOISE_SIZE, base64ToBytes(BLUE_NOISE_B64));

    this.#current = paramsFor(plan);
    this.#target = this.#current;
  }

  /** True when the driver gave us half-float targets; false means shorter trails. */
  get hdr(): boolean {
    return this.#buffers.float;
  }

  /**
   * Reads back a small patch of the sim buffer to check the reaction-diffusion
   * pair hasn't gone degenerate over a long session - NaN (a numerical
   * blow-up) or a flatlined V near 0 (the pattern died and stopped
   * responding to reseeding) are both real failure modes for Gray-Scott left
   * running for many minutes. A readback stalls the GPU pipeline, so this is
   * for periodic diagnostic sampling (core.ts calls it every ~20s), never
   * every frame.
   */
  sampleSimStats(): { meanU: number; meanV: number; hasNaN: boolean } | null {
    const gl = this.#gl;
    const { w, h } = this.#simBuf.size;
    const px = Math.max(0, (w >> 1) - 2);
    const py = Math.max(0, (h >> 1) - 2);
    const buf = new Float32Array(4 * 4 * 4);
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.#simBuf.writeFbo);
      // .writeFbo happens to hold last frame's freshly-written state right
      // after swap(); either attachment is valid to sample for a diagnostic.
      gl.readPixels(px, py, 4, 4, gl.RGBA, gl.FLOAT, buf);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } catch {
      return null;
    }
    let sumU = 0, sumV = 0, hasNaN = false;
    for (let i = 0; i < 16; i++) {
      const u = buf[i * 4 + 2] ?? 0;
      const v = buf[i * 4 + 3] ?? 0;
      if (Number.isNaN(u) || Number.isNaN(v)) hasNaN = true;
      sumU += u;
      sumV += v;
    }
    return { meanU: sumU / 16, meanV: sumV / 16, hasNaN };
  }

  /**
   * Point the renderer at a new plan.
   *
   * The parameters are interpolated toward it rather than snapped, so the
   * blend the director computed arrives as a move rather than a jump. A high
   * `hardCut` skips the interpolation and wipes the feedback history, which is
   * the only way a cut actually reads as a cut.
   */
  setPlan(plan: VisualPlan): void {
    this.#target = paramsFor(plan);
    if (plan.hardCut > 0.6) {
      this.#current = this.#target;
      this.#buffers.clear();
    }
  }

  /** Fades toward (or away from) the album art's color bias. `null` fades it out. */
  setArtwork(dna: { color: [number, number, number] } | null): void {
    if (dna) this.#artTint = dna.color;
    this.#artStrengthTarget = dna ? 0.3 : 0;
  }

  /** Toggle one subsystem for cost isolation. Logs so a terminal-only session can confirm the change. */
  toggleDebug(key: 'sim' | 'particles' | 'bloom'): boolean {
    this.#debug[key] = !this.#debug[key];
    console.log(`[perf] ${key} ${this.#debug[key] ? 'ON' : 'OFF'}`);
    return this.#debug[key];
  }

  render(f: FeatureFrame): void {
    if (this.#disposed) return;
    const gl = this.#gl;

    this.#resizeIfNeeded();
    const { w, h } = this.#buffers.size;
    const dt = Math.min(f.dt, 0.05);

    // Exponential approach, framed as a half-life so the rate is independent
    // of frame rate.
    const k = 1 - Math.exp((-f.dt / Math.max(this.#transition, 0.01)) * 2.2);
    this.#current = lerpParams(this.#current, this.#target, k);
    const p = this.#current;
    this.#artStrength += (this.#artStrengthTarget - this.#artStrength) * k;

    this.#spectrum.upload(f.spectrum);

    // ---- sim pass: flow + reaction-diffusion, its own ping-pong ----
    // Skipping the draw (rather than zeroing its contribution) freezes the
    // buffer at its last state instead of corrupting it, so toggling this
    // back on mid-session picks up cleanly.
    if (this.#debug.sim) {
      const sw = this.#simBuf.size.w;
      const sh = this.#simBuf.size.h;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.#simBuf.writeFbo);
      gl.viewport(0, 0, sw, sh);
      gl.useProgram(this.#sim);
      gl.bindVertexArray(this.#vao);

      const su = this.#simU;
      su.v2('uResolution', sw, sh);
      su.f('uTime', f.t);
      su.f('uDt', dt);
      su.f('uCurlAmp', p.motion.curlAmp);
      su.f('uCurlFreq', p.motion.curlFreq);
      su.f('uWarpSpeed', p.motion.warpSpeed);
      su.f('uBass', f.bass);
      su.f('uTreble', f.treble);
      su.f('uFlux', f.flux);
      su.tex('uPrev', 0, this.#simBuf.read);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.#simBuf.swap();
    }

    // ---- particle update pass, reading the sim's fresh velocity ----
    if (this.#debug.particles) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.#particleBuf.writeFbo);
      gl.viewport(0, 0, PARTICLE_GRID, PARTICLE_GRID);
      gl.useProgram(this.#particleSim);
      gl.bindVertexArray(this.#vao);

      const pu = this.#particleSimU;
      pu.f('uDt', dt);
      pu.f('uTime', f.t);
      pu.f('uFlux', f.flux);
      pu.tex('uPrevState', 0, this.#particleBuf.read);
      pu.tex('uSim', 1, this.#simBuf.read);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.#particleBuf.swap();
    }

    // ---- scene pass, into the write buffer ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#buffers.writeFbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.#scene);
    gl.bindVertexArray(this.#vao);

    const u = this.#sceneU;

    u.v2('uResolution', w, h);
    u.f('uTime', f.t);
    u.f('uDt', dt);

    u.f('uCurlAmp', p.motion.curlAmp);
    u.f('uCurlFreq', p.motion.curlFreq);
    u.f('uRotate', p.motion.rotate);
    u.f('uRadial', p.motion.radial);
    u.f('uShear', p.motion.shear);
    u.f('uWarpSpeed', p.motion.warpSpeed);
    u.f('uDetail', p.motion.detail);
    u.f('uQuantize', p.motion.quantize);

    u.f('uTexFilament', p.texture.filament);
    u.f('uTexPlasma', p.texture.plasma);
    u.f('uTexGrain', p.texture.grain);
    u.f('uTexCellular', p.texture.cellular);
    u.f('uTexStrata', p.texture.strata);
    u.f('uTexShards', p.texture.shards);
    u.f('uSharpness', p.texture.sharpness);

    u.v3('uArtTint', this.#artTint);
    u.f('uArtStrength', this.#artStrength);

    u.f('uGeoCircle', p.geometry.circles);
    u.f('uGeoHex', p.geometry.hexagons);
    u.f('uGeoStar', p.geometry.stars);

    u.f('uFold', p.symmetry.fold);
    u.f('uMirror', p.symmetry.mirror);
    u.f('uPolar', p.symmetry.polar);

    u.f('uDecay', p.feedback.decay);
    u.f('uZoom', p.feedback.zoom);
    u.f('uFbRotate', p.feedback.rotate);
    u.f('uChroma', p.feedback.chroma);
    u.f('uSmear', p.feedback.smear);

    u.v3('uPalA', p.palette.a);
    u.v3('uPalB', p.palette.b);
    u.v3('uPalC', p.palette.c);
    u.v3('uPalD', p.palette.d);

    u.f('uBass', f.bass);
    u.f('uMid', f.mid);
    u.f('uTreble', f.treble);
    u.f('uLevel', f.level);
    u.f('uFlux', f.flux);
    u.f('uBeatPhase', f.beatPhase);
    u.f('uBarPhase', f.barPhase);
    u.f('uIntensity', p.intensity);

    u.tex('uPrev', 0, this.#buffers.read);
    u.tex('uSpectrum', 1, this.#spectrum.texture);
    u.tex('uSim', 2, this.#simBuf.read);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- particles, additively on top of the scene pass's own output ----
    // Drawn into the same write buffer before it swaps, so their
    // contribution is subject to the identical decay/feedback dynamics as
    // everything else in the buffer starting next frame - not a separate
    // always-on overlay layer.
    if (this.#debug.particles) {
      gl.useProgram(this.#particleRender);
      gl.bindVertexArray(this.#particleVao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      const beatBump = Math.pow(0.5 + 0.5 * Math.sin(f.beatPhase * Math.PI * 2), 6);
      const ru = this.#particleRenderU;
      ru.tex('uState', 0, this.#particleBuf.read);
      gl.uniform2i(gl.getUniformLocation(this.#particleRender, 'uStateSize'), PARTICLE_GRID, PARTICLE_GRID);

      // Brightness and size used to floor at "always visible" regardless of
      // intensity or geometry - a constant dusting over every look, which
      // read as the same picture no matter what System1 decided. Both now
      // have a real near-zero floor, and both lean into the 'circles'
      // geometry choice specifically: particles are thematically small
      // orbiting points, so they read as System1's own choice showing
      // through rather than a fixed backdrop.
      const circlesAffinity = 0.35 + p.geometry.circles * 1.4;
      const intensityGate = Math.max(0, p.intensity / 4);
      ru.f('uPointSize', Math.max(1, Math.min(w, h)) * 0.005 * (0.4 + intensityGate * 1.2) * circlesAffinity);
      ru.f('uBeatBump', beatBump);
      ru.v3('uPalA', p.palette.a);
      ru.v3('uPalB', p.palette.b);
      ru.v3('uPalC', p.palette.c);
      ru.v3('uPalD', p.palette.d);
      ru.f('uBrightness', (0.12 + intensityGate * 0.55) * circlesAffinity * (0.6 + f.level * 0.6));

      gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
      gl.disable(gl.BLEND);
    }

    this.#buffers.swap();

    // ---- bloom: extract + soft-blur the frame just written, at half res ----
    if (this.#debug.bloom) {
      const bw = this.#bloomTarget.size.w;
      const bh = this.#bloomTarget.size.h;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.#bloomTarget.fbo);
      gl.viewport(0, 0, bw, bh);
      gl.useProgram(this.#bloom);
      gl.bindVertexArray(this.#vao);

      const bu = this.#bloomU;
      bu.v2('uResolution', bw, bh);
      bu.f('uThreshold', 1.1);
      bu.tex('uScene', 0, this.#buffers.read);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ---- present pass, to the screen ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.#present);
    gl.bindVertexArray(this.#vao);

    const pu2 = this.#presentU;
    pu2.v2('uResolution', this.canvas.width, this.canvas.height);
    pu2.v2('uBlueNoiseSize', BLUE_NOISE_SIZE, BLUE_NOISE_SIZE);
    pu2.f('uTime', f.t);
    pu2.f('uExposure', 1.0 + p.intensity * 0.12);
    pu2.f('uGrain', 0.022);
    pu2.f('uVignette', 0.55);
    // Zeroed independently of whether the extraction pass ran this frame, so
    // toggling bloom off mid-session cannot leave a stale texture visible.
    pu2.f('uBloomStrength', this.#debug.bloom ? 0.55 : 0);
    pu2.tex('uScene', 0, this.#buffers.read);
    pu2.tex('uBloom', 1, this.#bloomTarget.texture);
    pu2.tex('uBlueNoise', 2, this.#blueNoise.texture);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  #targetSize(): { w: number; h: number } {
    const dpr = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width || this.canvas.clientWidth || 1280;
    const cssH = rect.height || this.canvas.clientHeight || 720;
    return {
      w: Math.max(2, Math.floor(cssW * dpr * this.#scale)),
      h: Math.max(2, Math.floor(cssH * dpr * this.#scale)),
    };
  }

  #resizeIfNeeded(): void {
    const dpr = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width || this.canvas.clientWidth || 1280));
    const cssH = Math.max(1, Math.floor(rect.height || this.canvas.clientHeight || 720));

    const backW = Math.floor(cssW * dpr);
    const backH = Math.floor(cssH * dpr);
    if (this.canvas.width !== backW || this.canvas.height !== backH) {
      this.canvas.width = backW;
      this.canvas.height = backH;
    }

    const { w, h } = this.#targetSize();
    this.#buffers.resize(w, h);
    this.#simBuf.resize(Math.max(2, w >> 2), Math.max(2, h >> 2));
    this.#bloomTarget.resize(Math.max(2, w >> 1), Math.max(2, h >> 1));
    // Particle state is a fixed logical grid, not screen-resolution-linked.
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const gl = this.#gl;
    this.#buffers.dispose();
    this.#simBuf.dispose();
    this.#particleBuf.dispose();
    this.#bloomTarget.dispose();
    this.#spectrum.dispose();
    gl.deleteProgram(this.#scene);
    gl.deleteProgram(this.#present);
    gl.deleteProgram(this.#sim);
    gl.deleteProgram(this.#bloom);
    gl.deleteProgram(this.#particleSim);
    gl.deleteProgram(this.#particleRender);
    gl.deleteVertexArray(this.#vao);
    gl.deleteVertexArray(this.#particleVao);
  }
}

/** Collapse a plan's distributions into one set of numeric parameters. */
function paramsFor(plan: VisualPlan): RenderParams {
  return {
    motion: blend(MOTION, plan.motion),
    palette: blend(PALETTE, plan.palette),
    texture: blend(TEXTURE, plan.texture),
    geometry: blend(GEOMETRY, plan.geometry),
    symmetry: blend(SYMMETRY, plan.symmetry),
    feedback: blend(FEEDBACK, plan.feedback),
    intensity: plan.intensity,
  };
}

function lerpParams(a: RenderParams, b: RenderParams, k: number): RenderParams {
  return {
    motion: lerpObj(a.motion, b.motion, k),
    palette: lerpPalette(a.palette, b.palette, k),
    texture: lerpObj(a.texture, b.texture, k),
    geometry: lerpObj(a.geometry, b.geometry, k),
    symmetry: lerpObj(a.symmetry, b.symmetry, k),
    feedback: lerpObj(a.feedback, b.feedback, k),
    intensity: a.intensity + (b.intensity - a.intensity) * k,
  };
}

/** Component-wise lerp over a flat object of numbers. */
function lerpObj<T>(a: T, b: T, k: number): T {
  const from = a as Record<string, number>;
  const to = b as Record<string, number>;
  const out: Record<string, number> = {};
  for (const key of Object.keys(from)) out[key] = (from[key] ?? 0) + ((to[key] ?? 0) - (from[key] ?? 0)) * k;
  return out as T;
}

function lerpPalette(a: PaletteParams, b: PaletteParams, k: number): PaletteParams {
  const v = (x: [number, number, number], y: [number, number, number]): [number, number, number] => [
    x[0] + (y[0] - x[0]) * k,
    x[1] + (y[1] - x[1]) * k,
    x[2] + (y[2] - x[2]) * k,
  ];
  return { a: v(a.a, b.a), b: v(a.b, b.b), c: v(a.c, b.c), d: v(a.d, b.d) };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
