import { Renderer } from '../src/render/renderer';
import { WorldModel } from '../src/world/model';
import { initialPlan } from '../src/director/director';
import { emptyFrame, type FeatureFrame } from '../src/types';

const organicCanvas = document.getElementById('organic') as HTMLCanvasElement;
const architecturalCanvas = document.getElementById('architectural') as HTMLCanvasElement;
const status = document.getElementById('status');

const plan = initialPlan();
const organicWorld = new WorldModel();
const architecturalWorld = new WorldModel();
organicWorld.setPlan(plan);
architecturalWorld.setPlan(plan);
organicWorld.intervene('form', { organic: 1 });
architecturalWorld.intervene('form', { architectural: 1 });

const organic = new Renderer(organicCanvas, plan, { scale: 1, transitionSec: 0.01 });
const architectural = new Renderer(architecturalCanvas, plan, { scale: 1, transitionSec: 0.01 });

let frameIndex = 0;
let lastFrame: FeatureFrame = { ...emptyFrame(1024), dt: 1 / 60, t: 0 };

function loop(): void {
  const frame: FeatureFrame = {
    ...lastFrame,
    t: frameIndex / 60,
    dt: 1 / 60,
    // Identical event stream for both worlds. The intervention is the only
    // semantic difference between the two renderers.
    onBeat: frameIndex % 30 === 0,
    flux: 0.42,
    bassFlux: 0.58,
    level: 0.64,
    bass: 0.52,
    mid: 0.45,
    treble: 0.38,
  };
  lastFrame = frame;

  organic.setWorld(organicWorld.update(frame));
  architectural.setWorld(architecturalWorld.update(frame));
  organic.render(frame);
  architectural.render(frame);

  frameIndex++;
  // A short deterministic window is enough to prove that the intervention
  // reaches pixels while keeping the browser probe quick on integrated GPUs.
  if (frameIndex < 60) requestAnimationFrame(loop);
  else finish();
}

function finish(): void {
  const diff = compareWebGL(organicCanvas, architecturalCanvas);
  const pass = diff.meanAbsolute > 0.01 && diff.changedPixels > 0.05;
  const result = { probe: 'visual-causality', pass, ...diff };
  if (status) status.textContent = JSON.stringify(result, null, 2);
  Object.defineProperty(globalThis, '__causality', { value: result, configurable: true });
}

function compareWebGL(a: HTMLCanvasElement, b: HTMLCanvasElement): { meanAbsolute: number; changedPixels: number; maxDifference: number } {
  const ag = a.getContext('webgl2');
  const bg = b.getContext('webgl2');
  if (!ag || !bg) throw new Error('WebGL2 unavailable for causality probe');
  const n = a.width * a.height * 4;
  const ap = new Uint8Array(n);
  const bp = new Uint8Array(n);
  ag.readPixels(0, 0, a.width, a.height, ag.RGBA, ag.UNSIGNED_BYTE, ap);
  bg.readPixels(0, 0, b.width, b.height, bg.RGBA, bg.UNSIGNED_BYTE, bp);
  let total = 0, changed = 0, max = 0;
  for (let i = 0; i < n; i++) {
    const delta = Math.abs((ap[i] ?? 0) - (bp[i] ?? 0)) / 255;
    total += delta;
    max = Math.max(max, delta);
    if (delta > 0.02) changed++;
  }
  return { meanAbsolute: total / n, changedPixels: changed / n, maxDifference: max };
}

requestAnimationFrame(loop);
