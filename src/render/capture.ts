import { createProgram, Uniforms } from './gl';
import { applyProcedural, type ProceduralUniforms } from './procedural';
import { GLSL_HEADER } from './renderer';
import quadVert from './shaders/quad.vert.glsl';
import proceduralLib from './shaders/procedural.glsl';
import captureMain from './shaders/capture.frag.glsl';

/** Back off source capture after a GPU/JPEG spike, without blocking display. */
export function captureBackoffMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 100) return 0;
  return Math.min(5000, Math.max(500, elapsedMs * 2));
}

/**
 * Renders the procedural scene at the stream's resolution in its own small
 * WebGL context and encodes it as JPEG: the diffusion sidecar's camera input.
 *
 * A separate OffscreenCanvas keeps this off the display context (no readback
 * stall on the 60 Hz pass), and `convertToBlob` encodes asynchronously.
 */
export class ProceduralCapture {
  #canvas: OffscreenCanvas;
  #gl: WebGL2RenderingContext;
  #program: WebGLProgram;
  #uniforms: Uniforms;
  #vao: WebGLVertexArrayObject;
  lastDrawMs = 0;
  lastEncodeMs = 0;

  constructor(readonly width: number, readonly height: number) {
    this.#canvas = new OffscreenCanvas(width, height);
    // The frame is exported through OffscreenCanvas.convertToBlob(); keeping
    // the drawing buffer alive adds a second GPU copy and can block the
    // display context while the diffusion sidecar is using the same adapter.
    const gl = this.#canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 unavailable for procedural capture');
    this.#gl = gl as WebGL2RenderingContext;
    this.#program = createProgram(this.#gl, quadVert, GLSL_HEADER + proceduralLib + captureMain);
    this.#uniforms = new Uniforms(this.#gl, this.#program);
    const vao = this.#gl.createVertexArray();
    if (!vao) throw new Error('failed to allocate capture VAO');
    this.#vao = vao;
  }

  async capture(scene: ProceduralUniforms, quality = 0.85): Promise<ArrayBuffer> {
    const gl = this.#gl;
    const drawStarted = performance.now();
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.#program);
    gl.bindVertexArray(this.#vao);
    applyProcedural(this.#uniforms, scene, this.width / this.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    this.lastDrawMs = performance.now() - drawStarted;
    const encodeStarted = performance.now();
    const blob = await this.#canvas.convertToBlob({ type: 'image/jpeg', quality });
    this.lastEncodeMs = performance.now() - encodeStarted;
    return blob.arrayBuffer();
  }
}
