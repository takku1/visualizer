import { createProgram, Uniforms } from './gl';
import { applyProcedural, type ProceduralUniforms } from './procedural';
import quadVert from './shaders/quad.vert.glsl';
import proceduralLib from './shaders/procedural.glsl';
import presentMain from './shaders/present.frag.glsl';
import { continuityPaint } from './continuity';

/** Prepended to every pass that includes procedural.glsl. */
export const GLSL_HEADER = '#version 300 es\nprecision highp float;\n';

export interface RendererOptions {
  /** Canvas resolution relative to CSS pixels x devicePixelRatio. */
  scale?: number;
}

/**
 * The 60 Hz display: the procedural scene, painted over by the diffusion
 * stream in proportion to `paint`. The stream itself is upscaled, crossfaded
 * between its two newest frames, and kicked on the beat.
 */
export class Renderer {
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram;
  #uniforms: Uniforms;
  #vao: WebGLVertexArrayObject;
  #prev: WebGLTexture;
  #curr: WebGLTexture;
  #scale: number;
  #hasStream = false;
  #sourceW = 16;
  #sourceH = 9;
  #arrivedAt = 0;
  #interval = 100;
  #frames = 0;

  constructor(readonly canvas: HTMLCanvasElement, opts: RendererOptions = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is unavailable');
    this.#gl = gl;
    this.#scale = opts.scale ?? 1;
    this.#program = createProgram(gl, quadVert, GLSL_HEADER + proceduralLib + presentMain);
    this.#uniforms = new Uniforms(gl, this.#program);
    const vao = gl.createVertexArray();
    const prev = gl.createTexture();
    const curr = gl.createTexture();
    if (!vao || !prev || !curr) throw new Error('failed to allocate stream textures');
    this.#vao = vao;
    this.#prev = prev;
    this.#curr = curr;
    for (const t of [prev, curr]) this.#initTexture(t);
  }

  /** Upload a new stream frame. The previous one becomes the crossfade source. */
  pushFrame(bitmap: ImageBitmap, now: number): void {
    const gl = this.#gl;
    const swap = this.#prev;
    this.#prev = this.#curr;
    this.#curr = swap;
    gl.bindTexture(gl.TEXTURE_2D, this.#curr);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    if (!this.#hasStream) {
      gl.bindTexture(gl.TEXTURE_2D, this.#prev);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    }
    this.#sourceW = bitmap.width;
    this.#sourceH = bitmap.height;
    bitmap.close();
    if (this.#arrivedAt > 0) {
      const gap = Math.min(now - this.#arrivedAt, 500);
      this.#interval = this.#interval * 0.8 + gap * 0.2;
    }
    this.#arrivedAt = now;
    this.#hasStream = true;
    this.#frames++;
  }

  /** Show the procedural scene alone again, e.g. after the sidecar disconnects. */
  clearStream(): void {
    this.#hasStream = false;
    this.#arrivedAt = 0;
  }

  render(now: number, kick: number, scene: ProceduralUniforms, paint: number): void {
    const gl = this.#gl;
    this.#resizeIfNeeded();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.#program);
    gl.bindVertexArray(this.#vao);
    const u = this.#uniforms;
    // Blend across the whole expected gap: continuous motion rather than
    // step-and-hold, at the cost of ~one stream frame of added latency (the
    // beat kick is display-side, so beats still land on time).
    u.f('uBlend', Math.min(1, (now - this.#arrivedAt) / Math.max(this.#interval, 1)));
    u.f('uHasStream', this.#hasStream ? 1 : 0);
    const ageMs = this.#hasStream && this.#arrivedAt > 0 ? Math.max(0, now - this.#arrivedAt) : 0;
    u.f('uPaint', this.#hasStream ? continuityPaint(paint, ageMs, this.#interval) : 0);
    u.f('uSourceAspect', this.#sourceW / this.#sourceH);
    u.v2('uTexel', 1 / this.#sourceW, 1 / this.#sourceH);
    u.f('uKick', kick);
    applyProcedural(u, scene, this.canvas.width / Math.max(this.canvas.height, 1));
    u.tex('uPrev', 0, this.#prev);
    u.tex('uCurr', 1, this.#curr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  telemetry(): { width: number; height: number; stream: boolean; sourceW: number; sourceH: number; frames: number; intervalMs: number } {
    return {
      width: this.canvas.width, height: this.canvas.height, stream: this.#hasStream,
      sourceW: this.#sourceW, sourceH: this.#sourceH, frames: this.#frames,
      intervalMs: Math.round(this.#interval),
    };
  }

  dispose(): void {
    const gl = this.#gl;
    gl.deleteProgram(this.#program);
    gl.deleteTexture(this.#prev);
    gl.deleteTexture(this.#curr);
    gl.deleteVertexArray(this.#vao);
  }

  #initTexture(texture: WebGLTexture): void {
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  #resizeIfNeeded(): void {
    const dpr = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor((rect.width || 1280) * dpr * this.#scale));
    const h = Math.max(1, Math.floor((rect.height || 720) * dpr * this.#scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }
}
