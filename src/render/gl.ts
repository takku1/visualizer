/** Minimal WebGL helpers for the stream presentation pass. */

export function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
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
    throw new Error(`${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} compile failed: ${log}`);
  }
  return shader;
}

/** Caches uniform locations for the one presentation pass. */
export class Uniforms {
  #locs = new Map<string, WebGLUniformLocation | null>();
  constructor(private readonly gl: WebGL2RenderingContext, private readonly program: WebGLProgram) {}
  #loc(name: string): WebGLUniformLocation | null {
    let location = this.#locs.get(name);
    if (location === undefined) {
      location = this.gl.getUniformLocation(this.program, name);
      this.#locs.set(name, location);
    }
    return location;
  }
  f(name: string, value: number): void {
    const location = this.#loc(name);
    if (location) this.gl.uniform1f(location, value);
  }
  v2(name: string, x: number, y: number): void {
    const location = this.#loc(name);
    if (location) this.gl.uniform2f(location, x, y);
  }
  v3(name: string, x: number, y: number, z: number): void {
    const location = this.#loc(name);
    if (location) this.gl.uniform3f(location, x, y, z);
  }
  tex(name: string, unit: number, texture: WebGLTexture): void {
    const location = this.#loc(name);
    if (!location) return;
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.uniform1i(location, unit);
  }
}
