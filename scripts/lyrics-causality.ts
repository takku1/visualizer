import { FixtureLyricSource } from '../src/lyrics/fixture';
import { LyricsRuntime } from '../src/lyrics/runtime';
import { SidecarLyricSource } from '../src/lyrics/sidecar';
import { WorldModel } from '../src/world/model';

const track = { title: 'fixture', artist: 'fixture' };
const off = new LyricsRuntime({}, new FixtureLyricSource());
await off.sync(track);
const overlay = new LyricsRuntime({ enabled: true, mode: 'overlay' }, new FixtureLyricSource());
await overlay.sync(track);
const toggle = new LyricsRuntime({}, new FixtureLyricSource());
await toggle.sync(track);
toggle.setConfig({ enabled: true, mode: 'overlay', opacity: 0.9, readable: true, retainMemory: false });
await toggle.sync(track);

const originalFetch = globalThis.fetch;
let request: { url: string; body: { title: string | null; artist: string | null } } | null = null;
globalThis.fetch = (async (inputUrl, init) => {
  request = { url: String(inputUrl), body: JSON.parse(String(init?.body)) };
  return { ok: true, status: 200, json: async () => ({ cues: [{ id: 'sidecar-1', start: 0, end: 2, text: 'Sidecar' }] }) } as Response;
}) as typeof fetch;
const sidecarCues = await new SidecarLyricSource('http://probe.invalid/lyrics').load(track);
globalThis.fetch = originalFetch;

const world = new WorldModel();
const seedBefore = world.projection().seed;
world.applyLyricEvent({ kind: 'cue-enter', cueId: 'fixture-1', strength: 1 });
world.applyLyricEvent({ kind: 'lyric-memory', cueId: 'fixture-1', strength: 1 });

const checks = {
  offDoesNotLoad: off.cues.length === 0 && off.frame(1).cue === null,
  overlayLoads: overlay.cues.length === 2,
  firstCueAtStart: overlay.frame(1).cue?.id === 'fixture-1',
  secondCueAtBoundary: overlay.frame(4).cue?.id === 'fixture-2',
  gapIsHidden: overlay.frame(9).cue === null,
  offToOverlayReloads: toggle.cues.length === 2,
  cueEventsAreTyped: overlay.events(1).some((event) => event.kind === 'cue-enter')
    && overlay.events(2.5).some((event) => event.kind === 'cue-hold')
    && overlay.events(9).some((event) => event.kind === 'cue-exit'),
  sidecarPayloadAndNormalization: request?.url === 'http://probe.invalid/lyrics'
    && request.body.title === 'fixture' && request.body.artist === 'fixture'
    && sidecarCues[0]?.text === 'Sidecar',
  worldEventsPreserveSeed: world.projection().seed === seedBefore && world.projection().impulse > 0
    && world.state.dynamics.memory > 0.3,
};
const result = { probe: 'lyrics-causality', checks, pass: Object.values(checks).every(Boolean) };
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
