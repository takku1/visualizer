// End-to-end check against a running sidecar (`npm run stream`):
//   1. the protocol works (ready message, framed JPEGs, checkpoints);
//   2. sampler physics causally reach the pixels - aggressive controls must
//      produce more frame-to-frame change than calm ones (a metamorphic
//      relation: no ground-truth image needed);
//   3. a checkpoint runs its full lifecycle: denoising -> splicing -> idle.
// Usage: node scripts/stream-smoke.mjs [ws://127.0.0.1:8771]

const url = process.argv[2] ?? 'ws://127.0.0.1:8771';
const ws = new WebSocket(url);
ws.binaryType = 'arraybuffer';

const metas = [];
let ready = null;
let badJpeg = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.onmessage = (e) => {
  if (typeof e.data === 'string') {
    const msg = JSON.parse(e.data);
    if (msg.type === 'ready') ready = msg;
    return;
  }
  const view = new DataView(e.data);
  const n = view.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(e.data, 4, n)));
  const jpeg = new Uint8Array(e.data, 4 + n);
  if (jpeg.length && !(jpeg[0] === 0xff && jpeg[1] === 0xd8)) badJpeg++;
  meta.at = performance.now();
  meta.bytes = jpeg.length;
  metas.push(meta);
};

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error(`cannot connect to ${url} - is \`npm run stream\` running?`));
});
while (!ready) await sleep(20);
console.log(`ready: ${ready.model} ${ready.width}x${ready.height} on ${ready.device}, ${ready.vramMB} MB`);

const send = (m) => ws.send(JSON.stringify(m));
const calm = { strength: 0.15, noise: 0.03, detail: 0, zoom: 0.02, rotate: 0, driftX: 0, driftY: 0, noiseWalk: 0.2, feedback: 0.2, flow: 0.01, flowSpeed: 0.1 };
const wild = { strength: 0.6, noise: 0.4, detail: 0.7, zoom: 0.8, rotate: 0.4, driftX: 0.1, driftY: 0.05, noiseWalk: 4, feedback: 0.05, flow: 0.08, flowSpeed: 3 };

async function phase(control, ms) {
  const start = metas.length;
  const end = performance.now() + ms;
  while (performance.now() < end) {
    send({ type: 'control', ...control });
    await sleep(33);
  }
  return metas.slice(start).filter((m) => m.bytes > 0);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };

send({ type: 'checkpoint', id: 'smoke-1', prompt: 'bioluminescent coral cathedral, deep ocean, volumetric light', seed: 3, continuity: 0, spliceFrames: 1 });
const t0 = performance.now();
while (!metas.some((m) => m.bytes > 0)) {
  if (performance.now() - t0 > 60000) { check(false, 'first frame within 60 s'); process.exit(1); }
  await sleep(50);
}
console.log(`first frame after ${Math.round(performance.now() - t0)} ms (includes one-off keyframe)`);

await phase(calm, 1500); // settle
const calmFrames = await phase(calm, 4000);
const wildFrames = await phase(wild, 4000);
const fps = mean([...calmFrames, ...wildFrames].map((m) => m.fps));
const genMs = mean([...calmFrames, ...wildFrames].map((m) => m.genMs));
console.log(`stream ${fps.toFixed(1)} fps, gen ${genMs.toFixed(1)} ms, ~${Math.round(mean(wildFrames.map((m) => m.bytes)) / 1024)} KB/frame`);
const calmChange = mean(calmFrames.map((m) => m.change));
const wildChange = mean(wildFrames.map((m) => m.change));
check(calmFrames.length > 10 && wildFrames.length > 10, `frames flow (${calmFrames.length} calm, ${wildFrames.length} wild)`);
check(badJpeg === 0, 'every payload is a JPEG');
check(wildChange > calmChange * 1.5, `physics reach the pixels: change calm ${calmChange.toFixed(4)} -> wild ${wildChange.toFixed(4)}`);

// Checkpoint lifecycle.
const before = metas.length;
send({ type: 'checkpoint', id: 'smoke-2', prompt: 'molten ember desert canyon at dusk, cinematic', seed: 7, continuity: 0.4, spliceFrames: 12 });
await phase(calm, 5000);
const phases = [...new Set(metas.slice(before).map((m) => m.phase))];
const landed = metas.slice(before).some((m) => m.phase === 'idle' && m.checkpoint === 'smoke-2');
check(phases.includes('denoising') && phases.includes('splicing'), `checkpoint phases seen: ${phases.join(' -> ')}`);
check(landed, 'checkpoint smoke-2 landed and the loop returned to idle');
const keyMs = metas.at(-1)?.keyMs;
console.log(`keyframe took ${keyMs} ms time-sliced into the live loop`);

ws.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
