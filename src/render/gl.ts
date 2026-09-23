/** Thin WebGL2 helpers. No abstraction beyond removing the boilerplate. */

export function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);

  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  // Shaders can be deleted immediately; the linked program holds its own copy.
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`link failed: ${log}`);
  }

  return program;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');

  gl.shaderSource(shader, src);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    // Drivers report a line number and nothing else useful, so quote the line.
    const line = Number(/(\d+):(\d+)/.exec(log)?.[2] ?? 0);
    const context = src.split('\n').slice(Math.max(0, line - 3), line + 2).join('\n');
    throw new Error(`${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} compile failed: ${log}\n---\n${context}`);
  }

  return shader;
}

/** Caches uniform locations, because `getUniformLocation` is a string lookup. */
export class Uniforms {
  #locs = new Map<string, WebGLUniformLocation | null>();

  constructor(private readonly gl: WebGL2RenderingContext, private readonly program: WebGLProgram) {}

  #loc(name: string): WebGLUniformLocation | null {
    let l = this.#locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.#locs.set(name, l);
    }
    return l;
  }

  f(name: string, v: number): void {
    const l = this.#loc(name);
    if (l) this.gl.uniform1f(l, v);
  }

  v2(name: string, x: number, y: number): void {
    const l = this.#loc(name);
    if (l) this.gl.uniform2f(l, x, y);
  }

  v3(name: string, v: readonly number[]): void {
    const l = this.#loc(name);
    if (l) this.gl.uniform3f(l, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
  }

  i2(name: string, x: number, y: number): void {
    const l = this.#loc(name);
    if (l) this.gl.uniform2i(l, x, y);
  }

  tex(name: string, unit: number, texture: WebGLTexture): void {
    const l = this.#loc(name);
    if (!l) return;
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.uniform1i(l, unit);
  }
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

/**
 * Double-buffered render target for frame feedback.
 *
 * A shader cannot read the texture it is writing, so the previous frame and
 * the next one live in separate attachments that swap each frame.
 *
 * Half-float when the driver allows it. With 8-bit targets, `prev * decay`
 * quantizes to zero after a handful of frames and trails die early instead of
 * fading out - so the format is a visible quality difference, not a detail.
 */
export class PingPong {
  #a: Target;
  #b: Target;
  #w = 0;
  #h = 0;
  readonly float: boolean;

  constructor(private readonly gl: WebGL2RenderingContext, width: number, height: number) {
    this.float = Boolean(gl.getExtension('EXT_color_buffer_float'));
    // Linear filtering of float textures is a separate extension; without it
    // the feedback tap would snap to texels and alias badly.
    if (this.float) gl.getExtension('OES_texture_float_linear');

    this.#a = this.#make(width, height);
    this.#b = this.#make(width, height);
    this.#w = width;
    this.#h = height;
  }

  get read(): WebGLTexture {
    return this.#a.tex;
  }

  get writeFbo(): WebGLFramebuffer {
    return this.#b.fbo;
  }

  get size(): { w: number; h: number } {
    return { w: this.#w, h: this.#h };
  }

  swap(): void {
    const t = this.#a;
    this.#a = this.#b;
    this.#b = t;
  }

  resize(width: number, height: number): void {
    if (width === this.#w && height === this.#h) return;
    this.dispose();
    this.#a = this.#make(width, height);
    this.#b = this.#make(width, height);
    this.#w = width;
    this.#h = height;
  }

  /** Zero both buffers. Used on a hard cut, when history should not survive. */
  clear(): void {
    const { gl } = this;
    for (const t of [this.#a, this.#b]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    const { gl } = this;
    for (const t of [this.#a, this.#b]) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
  }

  #make(w: number, h: number): Target {
    const { gl } = this;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error('failed to allocate render target');

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0,
      this.float ? gl.RGBA16F : gl.RGBA8,
      w, h, 0,
      gl.RGBA,
      this.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Clamping matters: a zoom-in feedback tap reads outside the frame every
    // frame, and REPEAT would wrap the opposite edge into the center.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`incomplete framebuffer: 0x${status.toString(16)}`);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex };
  }
}

/**
 * A single non-ping-ponged render target: something is drawn into it, then
 * later sampled from. Used for passes that don't feed back into themselves -
 * bloom extraction, the flow/reaction-diffusion sim's read side is a
 * `PingPong`, but a one-shot target like this is lighter for everything else.
 */
export class RenderTarget {
  #fbo: WebGLFramebuffer;
  #tex: WebGLTexture;
  #w = 0;
  #h = 0;

  constructor(private readonly gl: WebGL2RenderingContext, width: number, height: number, private readonly float: boolean) {
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error('failed to allocate render target');
    this.#tex = tex;
    this.#fbo = fbo;
    this.resize(width, height);
  }

  get texture(): WebGLTexture {
    return this.#tex;
  }

  get fbo(): WebGLFramebuffer {
    return this.#fbo;
  }

  get size(): { w: number; h: number } {
    return { w: this.#w, h: this.#h };
  }

  resize(w: number, h: number): void {
    w = Math.max(2, w);
    h = Math.max(2, h);
    if (w === this.#w && h === this.#h) return;
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.#tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0,
      this.float ? gl.RGBA16F : gl.RGBA8,
      w, h, 0, gl.RGBA,
      this.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.#tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.#w = w;
    this.#h = h;
  }

  dispose(): void {
    this.gl.deleteFramebuffer(this.#fbo);
    this.gl.deleteTexture(this.#tex);
  }
}

/** A static R8 texture uploaded once from bytes - the blue-noise tile. */
export class StaticTexture {
  readonly texture: WebGLTexture;

  constructor(gl: WebGL2RenderingContext, size: number, bytes: Uint8Array) {
    const tex = gl.createTexture();
    if (!tex) throw new Error('failed to allocate static texture');
    this.texture = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size, size, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }
}

/** A 1 x N single-channel texture holding the current spectrum. */
export class SpectrumTexture {
  readonly texture: WebGLTexture;

  constructor(private readonly gl: WebGL2RenderingContext, private readonly bins: number) {
    const tex = gl.createTexture();
    if (!tex) throw new Error('failed to allocate spectrum texture');
    this.texture = tex;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, bins, 1, 0, gl.RED, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  upload(data: Float32Array): void {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // FLOAT source data into a HALF_FLOAT texture is a legal combination and
    // saves converting on the CPU every frame.
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, Math.min(data.length, this.bins), 1, gl.RED, gl.FLOAT, data);
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture);
  }
}
