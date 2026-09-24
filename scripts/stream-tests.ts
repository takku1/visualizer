import { strict as assert } from 'node:assert';
import { emptyFrame, type FeatureFrame, type VisualPlan, type Weighted } from '../src/types';
import { initialPlan } from '../src/director/director';
import { ControlMapper, CALM } from '../src/stream/control';
import { sceneFromPlan, lookFromPlan } from '../src/stream/scenes';
import { KnobDirector } from '../src/stream/knobs';
import { CouplingController } from '../src/stream/coupling';
import { estimateTempoFromOnsetGaps } from '../src/audio/bus';
import { compileSemanticScene, type SongMeaning } from '../src/director/semantic';
import { CheckpointScheduler, realizationRequestFromCheckpoint, type StreamObservation } from '../src/stream/checkpoint';
import { addShotCandidate, compileShotGraph, nextShots, shotGraphBoundary, ShotGraphRuntime } from '../src/stream/shot-graph';
import { isLiveLyricHypothesis, isLiveLyricUpdate, type LiveLyricHypothesis } from '../src/director/live';
import { LiveLyricAccumulator } from '../src/director/live-accumulator';
import { liveEvidenceSummary, meaningFromLive, perceptualCueFromLive } from '../src/director/live-meaning';
import { emergentWorldFromTelemetry, resonanceFrom, ZERO_FORCES } from '../src/realization/backend';
import { applySceneDiff, diffWorldState } from '../src/world/state';
import { CachedLyricsProvider, LocalTimedLyricsProvider, LrclibLyricsProvider, LyricsProviderChain, MemoryLyricsCache, StorageLyricsCache, lyricsCacheKey, meaningFromLyrics, parseLrc } from '../src/director/lyrics';
import { ProceduralScene } from '../src/render/procedural';
import { applyEmergentObservations, EMPTY_EMERGENT_WORLD } from '../src/world/observation';
import { effectiveLanguage, groundMotifs, groundedAction, registerGroundingAdapter, type GroundingAdapter } from '../src/director/grounding';

let passed = 0;
const pendingTests: Promise<void>[] = [];
function test(name: string, fn: () => void | Promise<void>): void {
  const result = fn();
  if (result && typeof (result as Promise<void>).then === 'function') {
    pendingTests.push(Promise.resolve(result).then(() => {
      passed++;
      console.log(`ok  ${name}`);
    }));
    return;
  }
  passed++;
  console.log(`ok  ${name}`);
}

const frame = (patch: Partial<FeatureFrame> = {}): FeatureFrame => ({ ...emptyFrame(8), dt: 1 / 60, tempo: 120, ...patch });

/** Settle a mapper on a steady input, so envelopes reach equilibrium. */
function settle(patch: Partial<FeatureFrame>, seconds = 2): ReturnType<ControlMapper['map']> {
  const m = new ControlMapper();
  let out = m.map(frame(patch));
  for (let i = 0; i < seconds * 60; i++) out = m.map(frame(patch));
  return out;
}

// ---------- audio -> sampling physics ----------

test('silence yields the calm operating point', () => {
  assert.deepEqual(settle({ level: 0 }), CALM);
});

test('more bass re-imagines more of each frame (strength rises)', () => {
  const lo = settle({ level: 0.5, bass: 0.1 });
  const hi = settle({ level: 0.5, bass: 0.9 });
  assert.ok(hi.strength > lo.strength + 0.05, `${lo.strength} -> ${hi.strength}`);
});

test('more energy makes content flow further and faster', () => {
  const quiet = settle({ level: 0.2, bass: 0.1 });
  const loud = settle({ level: 0.9, bass: 0.9, flux: 0.6 });
  assert.ok(loud.flow > quiet.flow && loud.flowSpeed > quiet.flowSpeed);
});

test('more treble injects more detail', () => {
  assert.ok(settle({ level: 0.5, treble: 0.8 }).detail > settle({ level: 0.5, treble: 0.1 }).detail);
});

test('louder raises temperature (fresh noise share)', () => {
  assert.ok(settle({ level: 0.9 }).noise > settle({ level: 0.2 }).noise);
});

test('transients lower feedback; sustained harmonic material raises it', () => {
  const percussive = settle({ level: 0.5, transientness: 0.9, harmonicity: 0 });
  const sustained = settle({ level: 0.5, transientness: 0, harmonicity: 0.9 });
  assert.ok(sustained.feedback > percussive.feedback + 0.1);
});

test('a beat pushes strength and zoom, then the push decays', () => {
  const m = new ControlMapper();
  for (let i = 0; i < 60; i++) m.map(frame({ level: 0.5 }));
  const before = m.map(frame({ level: 0.5 }));
  const hit = m.map(frame({ level: 0.5, onBeat: true, bassFlux: 0.8 }));
  assert.ok(hit.strength > before.strength && hit.zoom > before.zoom + 1);
  let later = hit;
  for (let i = 0; i < 30; i++) later = m.map(frame({ level: 0.5 }));
  assert.ok(later.zoom < before.zoom + 0.1, 'push should have decayed after 0.5 s');
});

test('rotation direction flips on a section change', () => {
  const m = new ControlMapper();
  const a = m.map(frame({ level: 0.5, mid: 0.5, sectionIndex: 0 }));
  const b = m.map(frame({ level: 0.5, mid: 0.5, sectionIndex: 1 }));
  assert.ok(Math.sign(a.rotate) === -Math.sign(b.rotate));
});

test('controls stay inside the sidecar clamp ranges under extreme input', () => {
  const c = settle({ level: 1, bass: 1, treble: 1, trebleFlux: 1, flux: 1, bassFlux: 1, transientness: 1, levelRelative: 5 });
  assert.ok(c.strength <= 0.6 && c.strength >= 0.3);
  assert.ok(c.feedback >= 0.05 && c.feedback <= 0.25, 'feedback must stay below the collapse threshold');
  assert.ok(c.flow <= 0.04 && c.noise <= 0.12 && c.noiseWalk < 0.3, 'noise must stay near-frozen for smoothness');
  assert.ok(c.detail <= 0.3);
});

test('an untrusted synthesized beat grid does not push; a real bass onset does', () => {
  const m = new ControlMapper();
  for (let i = 0; i < 60; i++) m.map(frame({ level: 0.5 }));
  const base = m.map(frame({ level: 0.5 })).zoom;
  const grid = m.map(frame({ level: 0.5, onBeat: true, hasStructure: false, rhythmConfidence: 0.2 })).zoom;
  assert.ok(grid < base + 0.05, 'wobbly fallback grid should not kick');
  const onset = m.map(frame({ level: 0.5, bassFlux: 0.8 })).zoom;
  assert.ok(onset > base + 1);
});

// ---------- network bending ----------

/** Chroma with energy on the given pitch classes (a chord). */
const chord = (...pcs: number[]): Float32Array => {
  const c = new Float32Array(12);
  for (const pc of pcs) c[pc] = 1;
  return c;
};

test('harmony at home does not rotate; moving away does, and resolving home returns', () => {
  const m = new ControlMapper();
  const C = chord(0, 4, 7);
  let out = m.map(frame({ level: 0.5, chroma: C }));
  for (let i = 0; i < 60 * 30; i++) out = m.map(frame({ level: 0.5, chroma: C })); // home learned
  assert.ok(Math.abs(out.hue) < 0.05, `home hue ${out.hue}`);
  for (let i = 0; i < 90; i++) out = m.map(frame({ level: 0.5, chroma: chord(2, 6, 9) })); // D major, two fifths away
  assert.ok(Math.abs(out.hue) > 0.2, `away hue ${out.hue}`);
  for (let i = 0; i < 180; i++) out = m.map(frame({ level: 0.5, chroma: C }));
  assert.ok(Math.abs(out.hue) < 0.1, `returned hue ${out.hue}`);
});

test('rotation direction follows the direction of travel around the circle of fifths', () => {
  const settleHome = (m: ControlMapper) => { for (let i = 0; i < 60 * 30; i++) m.map(frame({ level: 0.5, chroma: chord(0, 4, 7) })); };
  const up = new ControlMapper(); settleHome(up);
  const down = new ControlMapper(); settleHome(down);
  let a = up.map(frame({ level: 0.5 })), b = down.map(frame({ level: 0.5 }));
  for (let i = 0; i < 90; i++) {
    a = up.map(frame({ level: 0.5, chroma: chord(7, 11, 2) }));   // G: one fifth up
    b = down.map(frame({ level: 0.5, chroma: chord(5, 9, 0) }));  // F: one fifth down
  }
  assert.ok(Math.sign(a.hue) === -Math.sign(b.hue) && a.hue !== 0);
});

test('noise without tonal centre does not steer the hue', () => {
  const m = new ControlMapper();
  let out = m.map(frame({ level: 0.5 }));
  for (let i = 0; i < 300; i++) out = m.map(frame({ level: 0.5, chroma: new Float32Array(12).fill(1) }));
  assert.ok(Math.abs(out.hue) < 0.01);
});

test('bass hits swell with a soft attack; treble onsets glint and fade', () => {
  const m = new ControlMapper();
  for (let i = 0; i < 60; i++) m.map(frame({ level: 0.5 }));
  const first = m.map(frame({ level: 0.5, bassFlux: 0.9 }));
  let peak = first;
  for (let i = 0; i < 4; i++) peak = m.map(frame({ level: 0.5 }));
  assert.ok(first.swell < peak.swell, 'attack is eased, not a snap');
  assert.ok(peak.swell > 0.1 && peak.swell <= 0.4);
  const glint = m.map(frame({ level: 0.5, trebleFlux: 0.6 }));
  let faded = glint;
  for (let i = 0; i < 40; i++) faded = m.map(frame({ level: 0.5 }));
  assert.ok(glint.glass > 0.1 && faded.glass < glint.glass * 0.1);
});

test('a drop lurches once, then respects the cooldown; steady loudness never does', () => {
  const m = new ControlMapper();
  for (let i = 0; i < 60 * 6; i++) m.map(frame({ level: 0.15 }));
  let peak = 0;
  for (let i = 0; i < 30; i++) peak = Math.max(peak, m.map(frame({ level: 0.9 })).lurch);
  assert.ok(peak > 0.1 && peak <= 0.2, `drop lurch ${peak}`);
  // Starting mid-song at full volume is not a drop, and neither is staying loud.
  const steady = new ControlMapper();
  let any = 0;
  for (let i = 0; i < 60 * 20; i++) any = Math.max(any, steady.map(frame({ level: 0.9 })).lurch);
  assert.equal(any, 0);
  // Cooldown: a second jump within 8 s of the first does not lurch again.
  for (let i = 0; i < 60; i++) m.map(frame({ level: 0.1 }));
  let again = 0;
  for (let i = 0; i < 30; i++) again = Math.max(again, m.map(frame({ level: 0.9 })).lurch);
  assert.ok(again < peak * 0.5, `cooldown should suppress a second lurch (${again})`);
});

// ---------- plan -> scene ----------

test('scenes are deterministic per track and index, and vary by index', () => {
  const plan = initialPlan();
  const a = sceneFromPlan(plan, { trackId: 'x' }, 0);
  assert.deepEqual(a, sceneFromPlan(plan, { trackId: 'x' }, 0));
  assert.notEqual(a.seed, sceneFromPlan(plan, { trackId: 'x' }, 1).seed);
  assert.ok(a.prompt.length > 20 && !a.prompt.includes('undefined'));
});

test('a hard-cut plan asks for a fresh scene, otherwise it grows out of the live one', () => {
  assert.equal(sceneFromPlan({ ...initialPlan(), hardCut: 0.9 }, {}, 0).continuity, 0);
  assert.ok(sceneFromPlan({ ...initialPlan(), hardCut: 0.1 }, {}, 0).continuity > 0);
});

// ---------- System 2 scheduling ----------

const live: StreamObservation = { connected: true, fps: 12, phase: 'idle', change: 0.2 };

// ---------- first-listen live meaning contract ----------

const liveHypothesis = {
  id: 'h1', text: 'a dog runs through the field', language: 'en',
  startSec: 4.2, endSec: 6.8, confidence: 0.81, stability: 0.74,
  status: 'provisional', source: 'live-asr',
} as const;

test('live lyric hypotheses require bounded evidence and timestamps', () => {
  assert.equal(isLiveLyricHypothesis(liveHypothesis), true);
  assert.equal(isLiveLyricHypothesis({ ...liveHypothesis, confidence: 1.1 }), false);
  assert.equal(isLiveLyricHypothesis({ ...liveHypothesis, endSec: 4.2 }), false);
  assert.equal(isLiveLyricHypothesis({ ...liveHypothesis, source: 'lyrics' }), false);
});

test('abstaining fallback scenes keep one visual identity across director plan refreshes', () => {
  const first = initialPlan();
  const second = {
    ...first,
    motion: { ...first.motion, top: 'shear' as const },
    palette: { ...first.palette, top: 'chlorophyll' as const },
    texture: { ...first.texture, top: 'neural' as const },
  };
  const a = sceneFromPlan(first, { trackId: 'unknown-song' }, 0);
  const b = sceneFromPlan(second, { trackId: 'unknown-song' }, 1);
  assert.deepEqual(b.fingerprint, a.fingerprint);
  assert.equal(a.look.fold, 0);
  assert.equal(b.look.fold, 0);
});

test('procedural fallback looks can make a strong chapter transition without a checkpoint', () => {
  const scene = new ProceduralScene();
  const calm = { ...CALM, rotate: 0 };
  const before = scene.update(frame({ dt: 1 / 60 }), calm, 0, 0.5);
  scene.setLook({
    palette: [[0.0, 0.07, 0.03], [0.15, 0.6, 0.2], [0.8, 1.0, 0.5]],
    organic: 0.75, warp: 0.7, fold: 6, seed: 0.91,
  }, 0.8);
  const after = scene.update(frame({ dt: 0.8 }), calm, 0, 0.5);
  assert.notDeepEqual(after.colA, before.colA);
  assert.equal(after.fold, 6);
  assert.equal(after.seed, 0.91);
});

test('live lyric updates are versioned and track-scoped', () => {
  const update = {
    type: 'live-lyrics', trackId: 'spotify:track:first-listen', playheadSec: 7,
    revision: 3, model: 'local-asr', hypotheses: [liveHypothesis],
  } as const;
  assert.equal(isLiveLyricUpdate(update), true);
  assert.equal(isLiveLyricUpdate({ ...update, revision: -1 }), false);
  assert.equal(isLiveLyricUpdate({ ...update, trackId: 42 }), false);
});

test('live meaning commits only after repeated stable evidence', () => {
  const accumulator = new LiveLyricAccumulator();
  const make = (revision: number) => accumulator.update('track-a', revision, [{ ...liveHypothesis, confidence: 0.8, stability: 0.7 }]);
  assert.equal(make(1).committed.length, 0);
  assert.equal(make(2).committed.length, 0);
  assert.equal(make(3).committed[0]?.status, 'committed');
});

test('live meaning tolerates bounded Japanese ASR wording revisions', () => {
  const accumulator = new LiveLyricAccumulator();
  const make = (revision: number, text: string): LiveLyricUpdate => ({
    type: 'live-lyrics', trackId: 'ja-overlap', playheadSec: revision * 1.5, revision,
    model: 'whisper-small', hypotheses: [{
      ...liveHypothesis, id: `ja-${revision}`, text, language: 'ja',
      startSec: 2.1, endSec: 6.0, confidence: 0.8,
    }],
  });
  accumulator.update('ja-overlap', 1, make(1, '雨の駅で彼女が歩く').hypotheses);
  accumulator.update('ja-overlap', 2, make(2, '雨の駅で彼女が歩いている').hypotheses);
  const state = accumulator.update('ja-overlap', 3, make(3, '雨の駅で彼女が歩く').hypotheses);
  assert.equal(state.committed.length, 1);
});

test('live meaning stabilizes short Japanese lyric chunks', () => {
  const accumulator = new LiveLyricAccumulator();
  const make = (revision: number, text: string): LiveLyricUpdate => ({
    type: 'live-lyrics', trackId: 'ja-short', playheadSec: revision * 1.5, revision,
    model: 'whisper-small', hypotheses: [{
      ...liveHypothesis, id: `ja-short-${revision}`, text, language: 'ja',
      startSec: 2.1, endSec: 5.4, confidence: 0.8,
    }],
  });
  accumulator.update('ja-short', 1, make(1, '雨が降る').hypotheses);
  accumulator.update('ja-short', 2, make(2, '雨降る').hypotheses);
  const state = accumulator.update('ja-short', 3, make(3, '雨が降る').hypotheses);
  assert.equal(state.committed.length, 1);
});

test('recognized Japanese entity/action cues can commit after two windows', () => {
  const accumulator = new LiveLyricAccumulator();
  const make = (revision: number, text: string): LiveLyricHypothesis => ({
    ...liveHypothesis,
    id: `ja-grounded-${revision}`,
    text,
    language: 'ja',
    confidence: 0.8,
    stability: 0.8,
    startSec: 2.1,
    endSec: 6.0,
  });
  accumulator.update('ja-grounded', 1, [make(1, '雨の駅で歩く')]);
  const state = accumulator.update('ja-grounded', 2, [make(2, '雨の駅で歩いている')]);
  assert.equal(state.committed.length, 1);

  const unknown = new LiveLyricAccumulator();
  unknown.update('ja-unknown', 1, [make(1, 'ララララ')]);
  assert.equal(unknown.update('ja-unknown', 2, [make(2, 'ララララ')]).committed.length, 0);
});

test('live meaning tolerates a bounded missing ASR window before expiry', () => {
  const accumulator = new LiveLyricAccumulator();
  const hypothesis = (revision: number): LiveLyricHypothesis => ({
    ...liveHypothesis,
    id: `ja-gap-${revision}`,
    text: '雨の駅で歩く',
    language: 'ja',
    startSec: 2.1,
    endSec: 6.0,
    confidence: 0.8,
  });
  accumulator.update('ja-gap', 1, [hypothesis(1)]);
  accumulator.update('ja-gap', 2, []);
  accumulator.update('ja-gap', 3, [hypothesis(3)]);
  const committed = accumulator.update('ja-gap', 4, [hypothesis(4)]);
  assert.equal(committed.committed.length, 1);

  const expired = accumulator.update('ja-gap', 5, []);
  accumulator.update('ja-gap', 6, []);
  accumulator.update('ja-gap', 7, []);
  assert.equal(expired.committed.length, 1, 'committed evidence remains stable');
  assert.equal(accumulator.state().provisional.length, 0, 'unseen provisional evidence expires');
});

test('a new track and stale revision cannot inherit committed live meaning', () => {
  const accumulator = new LiveLyricAccumulator();
  accumulator.update('track-a', 1, [{ ...liveHypothesis, confidence: 0.9, stability: 0.9 }]);
  accumulator.update('track-a', 2, [{ ...liveHypothesis, confidence: 0.9, stability: 0.9 }]);
  accumulator.update('track-a', 3, [{ ...liveHypothesis, confidence: 0.9, stability: 0.9 }]);
  assert.equal(accumulator.update('track-a', 2, []).committed.length, 1);
  assert.equal(accumulator.update('track-b', 1, []).committed.length, 0);
});

test('committed live audio promotes to SongMeaning without blocking the renderer', () => {
  const accumulator = new LiveLyricAccumulator();
  let state = accumulator.update('track-a', 1, [{ ...liveHypothesis, confidence: 0.8, stability: 0 }]);
  state = accumulator.update('track-a', 2, [{ ...liveHypothesis, confidence: 0.8, stability: 0 }]);
  state = accumulator.update('track-a', 3, [{ ...liveHypothesis, confidence: 0.8, stability: 0 }]);
  const meaning = meaningFromLive(state, 1, 0);
  assert.equal(meaning?.evidence[0]?.source, 'audio');
  assert.deepEqual(meaning?.motifs.map((motif) => motif.kind).sort(), ['object', 'place']);
  assert.equal(meaning?.abstained, false);
});

test('committed Japanese live audio extracts only evidenced world handles', () => {
  const meaning = meaningFromLive({
    trackId: 'track-ja', provisional: [], committed: [{
      ...liveHypothesis,
      id: 'ja-1', text: '雨の駅で彼女が歩く', language: 'ja', status: 'committed',
    }],
  }, 2, 0);
  assert.deepEqual(meaning?.motifs.map((motif) => motif.kind).sort(), ['force', 'person', 'place']);
  assert.equal(meaning?.sections[0]?.action, 'walks through the environment');
});

test('Japanese live extraction recognizes non-literal form anchors and actions conservatively', () => {
  const meaning = meaningFromLive({
    trackId: 'track-ja-rich', provisional: [], committed: [{
      ...liveHypothesis,
      id: 'ja-rich-1', text: '森で花が揺れて彼女が踊っている', language: 'ja', status: 'committed',
    }],
  }, 2, 0);
  assert.deepEqual(meaning?.motifs.map((motif) => motif.kind).sort(), ['object', 'person', 'place']);
  assert.equal(meaning?.sections[0]?.action, 'moves rhythmically');
});

test('Japanese live extraction grounds bounded lyric motifs beyond the initial travel vocabulary', () => {
  const state = {
    trackId: 'ja-rich-vocabulary',
    provisional: [],
    committed: [
    { ...liveHypothesis, id: 'dream', text: '夢と心', language: 'ja', status: 'committed' },
    { ...liveHypothesis, id: 'motion', text: '進んでいる', language: 'ja', status: 'committed' },
    ],
  };
  const meaning = meaningFromLive(state, 4, 0);
  assert.ok(meaning);
  assert.equal(meaning?.abstained, false);
  assert.ok(meaning?.motifs.some((motif) => motif.label === 'object'));
  assert.equal(meaning?.sections[0]?.action, 'walks through the environment');
});

test('committed English live audio extracts person, place, force, and action', () => {
  const meaning = meaningFromLive({
    trackId: 'track-en', provisional: [], committed: [{
      ...liveHypothesis,
      id: 'en-1', text: 'the woman walks through the rainy station', language: 'en', status: 'committed',
    }],
  }, 3, 0);
  assert.deepEqual(meaning?.motifs.map((motif) => motif.kind).sort(), ['force', 'person', 'place']);
  assert.equal(meaning?.sections[0]?.action, 'walks through the environment');
});

test('live evidence telemetry distinguishes grounded, action-only, and symbol-only commits', () => {
  const summary = liveEvidenceSummary({
    trackId: 'evidence-classes',
    provisional: [],
    committed: [
      { ...liveHypothesis, id: 'grounded', text: '雨の駅', language: 'ja', status: 'committed' },
      { ...liveHypothesis, id: 'action', text: '歩いている', language: 'ja', status: 'committed' },
      { ...liveHypothesis, id: 'symbol', text: 'la la la', language: 'und', status: 'committed' },
    ],
  });
  assert.deepEqual(summary, {
    committed: 3, groundedMotifs: 1, actionOnly: 1, symbolsOnly: 1, abstained: false,
  });
});

test('live action extraction recognizes bounded environmental motion in English and Japanese', () => {
  const english = meaningFromLive({
    trackId: 'track-en-flow', provisional: [], committed: [{
      ...liveHypothesis, id: 'en-flow-1', text: 'the curtains sway and the lights gather', language: 'en', status: 'committed',
    }],
  }, 4, 0);
  const japanese = meaningFromLive({
    trackId: 'track-ja-flow', provisional: [], committed: [{
      ...liveHypothesis, id: 'ja-flow-1', text: '空間が開く', language: 'ja', status: 'committed',
    }],
  }, 5, 0);
  assert.equal(english?.sections[0]?.action, 'moves with a flowing motion');
  assert.equal(japanese?.sections[0]?.action, 'reveals or conceals space');
});

test('Japanese grounding accepts common inflections without widening abstention', () => {
  assert.equal(meaningFromLive({
    trackId: 'ja-inflections',
    provisional: [],
    committed: [{ id: 'ja-1', text: '彼女は夜空を見つめている', language: 'ja', startSec: 1, endSec: 2, confidence: 0.9, stability: 0.9, status: 'committed', source: 'live-asr' }],
  }, 1, 0)?.abstained, false);
  assert.equal(meaningFromLive({
    trackId: 'ja-unknown',
    provisional: [],
    committed: [{ id: 'ja-2', text: 'らららふわふわ', language: 'ja', startSec: 1, endSec: 2, confidence: 0.9, stability: 0.9, status: 'committed', source: 'live-asr' }],
  }, 1, 0)?.abstained, true);
});

test('Japanese pronouns do not create weak person entities when a concrete cue is available', () => {
  const motifs = groundMotifs('とりがわたしを呼んでいる', 'ja', 0.9, 'ja-call', 'audio');
  assert.deepEqual(motifs.map((motif) => motif.kind), ['object']);
  assert.equal(groundedAction('とりがわたしを呼んでいる', 'ja'), 'calls or summons another form');
});

test('mixed-language lyric windows resolve the effective bounded adapter per text', () => {
  assert.equal(effectiveLanguage('ja', 'the woman walks'), 'en');
  assert.equal(effectiveLanguage('ja', '雨の駅を歩く'), 'ja');
  assert.equal(groundMotifs('the woman walks', 'ja', 0.9, 'mixed-en', 'lyrics').some((motif) => motif.kind === 'person'), true);
  assert.equal(groundedAction('the woman walks', 'ja'), 'walks through the environment');
});

test('grounding is language-gated and unsupported languages remain symbols', () => {
  assert.deepEqual(groundMotifs('여자가 걷는다', 'ko', 0.9, 'ko-1', 'audio').map((motif) => motif.kind), ['symbol']);
  assert.equal(groundedAction('여자가 걷는다', 'ko'), null);
});

test('validated language adapters plug into the shared cue contract', () => {
  const adapter: GroundingAdapter = {
    id: 'test-ko-v1',
    supports: (language) => language.toLowerCase() === 'ko',
    ground: (text, language, confidence, idPrefix, source) => ({
      motifs: [{ id: `${idPrefix}-person`, kind: 'person', label: 'person', attributes: [text], confidence, source }],
      action: 'walks through the environment',
      cues: [{ kind: 'person', canonical: 'person', sourceLanguage: language, evidence: text, confidence }],
    }),
  };
  registerGroundingAdapter(adapter);
  assert.deepEqual(groundMotifs('여자가 걷는다', 'ko', 0.9, 'ko-2', 'audio').map((motif) => motif.kind), ['person']);
  assert.equal(groundedAction('여자가 걷는다', 'ko'), 'walks through the environment');
});

test('unknown committed live wording remains a symbol instead of inventing a world', () => {
  const meaning = meaningFromLive({
    trackId: 'track-unknown', provisional: [], committed: [{
      ...liveHypothesis,
      id: 'unknown-1', text: 'la la la', language: 'und', status: 'committed',
    }],
  }, 4, 0);
  assert.deepEqual(meaning?.motifs.map((motif) => motif.kind), ['symbol']);
  assert.equal(meaning?.sections[0]?.action, 'the vocal motif moves through the frame');
  assert.equal(meaning?.abstained, true);
});

test('unknown live symbols never become persistent world entities', () => {
  const meaning = meaningFromLive({
    trackId: 'track-symbol', provisional: [], committed: [{
      ...liveHypothesis, id: 'symbol-1', text: 'Thank you very much for watching!', status: 'committed',
    }], candidateCount: 1, maxCandidateObservations: 3,
  }, 1, 0);
  assert.ok(meaning);
  const scene = sceneFromPlan(initialPlan(), { trackId: 'track-symbol', meaning }, 0);
  assert.deepEqual(scene.world.entities, []);
  assert.equal(scene.source, 'abstract-fallback');
  assert.doesNotMatch(scene.prompt, /Thank you very much/);
});

test('provisional live action becomes a perceptual cue without creating entities', () => {
  const cue = perceptualCueFromLive({
    trackId: 'provisional', provisional: [{ ...liveHypothesis, text: '雨の中を歩いている', language: 'ja', status: 'provisional' }],
    committed: [], candidateCount: 1, maxCandidateObservations: 1,
  });
  assert.ok(cue);
  assert.ok(cue.behavior.includes('traveling'));
  assert.ok(cue.materiality.includes('wet'));
});

test('abstaining fallback compiles perceptual constraints before legacy geometry', () => {
  const scene = sceneFromPlan(initialPlan(), { trackId: 'perceptual-fallback' }, 0);
  assert.equal(scene.source, 'abstract-fallback');
  assert.ok(scene.prompt.includes('perceptual constraints'));
  assert.ok(scene.prompt.includes('Preserve the dominant visual form'));
  assert.equal(scene.prompt.includes('kaleidoscopic symmetry'), false);
});

test('semantic resonance modulates existing handles without inventing content', () => {
  const scene = sceneFromPlan(initialPlan(), {}, 0);
  const world = scene.world;
  const resonance = resonanceFrom({
    ...world,
    environment: ['rainy station'],
    action: 'walks through the environment',
    camera: 'tracking shot',
    entities: [{ id: 'alice', label: 'woman', kind: 'person', attributes: ['red coat'], confidence: 1 }],
  }, { ...ZERO_FORCES, energy: 1, beatImpulse: 1, treble: 0.8, flux: 0.6, motionMagnitude: 0.7 });
  assert.ok((resonance.weatherIntensity ?? 0) > 0);
  assert.ok(resonance.cameraImpulse > 0);
  assert.ok(resonance.entityMotion.alice > 0);
  assert.deepEqual(Object.keys(resonance.entityMotion), ['alice']);
});

test('world diffs preserve stable subjects while changing action', () => {
  const first = sceneFromPlan(initialPlan(), {}, 0);
  const next = sceneFromPlan(initialPlan(), {}, 1);
  const diff = diffWorldState(first.world, { ...next.world, entities: first.world.entities, action: 'enters the field' });
  assert.equal(diff.keep.length, first.world.entities.length);
  assert.equal(diff.add.length, 0);
  assert.equal(diff.remove.length, 0);
  assert.equal(diff.action.to, 'enters the field');
});

test('world state carries perceptual intent without requiring literal entities', () => {
  const scene = sceneFromPlan(initialPlan(), {}, 0);
  assert.ok(scene.world.intent.form.length > 0);
  assert.ok(scene.world.intent.behavior.length > 0);
  assert.ok(scene.world.intent.spatiality.length > 0);
  assert.ok(scene.world.intent.continuityPressure >= 0 && scene.world.intent.continuityPressure <= 1);
  assert.equal(scene.world.entities.length, 0);
});

test('emergent observations preserve anonymous handles through occlusion and fade', () => {
  let state = applyEmergentObservations(EMPTY_EMERGENT_WORLD, [{ handle: 'form-1', descriptors: ['fibrous'], confidence: 0.8, visible: true }], 1);
  assert.equal(state.hypotheses[0]?.lifecycle, 'new');
  state = applyEmergentObservations(state, [{ handle: 'form-1', descriptors: ['fibrous'], confidence: 0.9, visible: true }], 2);
  assert.equal(state.hypotheses[0]?.lifecycle, 'persistent');
  state = applyEmergentObservations(state, [], 3);
  assert.equal(state.hypotheses[0]?.handle, 'form-1');
  assert.equal(state.hypotheses[0]?.lifecycle, 'occluded');
  state = applyEmergentObservations(state, [], 4);
  state = applyEmergentObservations(state, [], 5);
  state = applyEmergentObservations(state, [], 6);
  assert.equal(state.hypotheses.length, 0);
});

test('realization telemetry cannot create emergent memory without correspondence handles', () => {
  const unchanged = emergentWorldFromTelemetry(EMPTY_EMERGENT_WORLD, {
    identityConfidence: 0.99,
    actionConfidence: 0.8,
  });
  assert.deepEqual(unchanged, EMPTY_EMERGENT_WORLD);

  const observed = emergentWorldFromTelemetry(EMPTY_EMERGENT_WORLD, {
    emergentObservations: [{ handle: 'form-1', descriptors: ['upright'], confidence: 0.7, visible: true }],
    observationRevision: 4,
  });
  assert.equal(observed.revision, 4);
  assert.equal(observed.hypotheses[0]?.handle, 'form-1');
});

test('semantic checkpoint changes preserve emergent form memory until a newer observation arrives', () => {
  const first = sceneFromPlan(initialPlan(), {}, 0);
  const observed = applyEmergentObservations(first.world.emergent, [{
    handle: 'form-1', descriptors: ['upright', 'fibrous'], confidence: 0.9, visible: true,
  }], 7);
  const next = sceneFromPlan(initialPlan(), {}, 1);
  const proposed = { ...next.world, emergent: observed };
  const firstDiff = diffWorldState(first.world, proposed);
  const changed = applySceneDiff(first.world, firstDiff);
  const later = sceneFromPlan(initialPlan(), {}, 2);
  const laterDiff = diffWorldState(changed, later.world);
  const preserved = applySceneDiff(changed, laterDiff);
  assert.equal(preserved.emergent.hypotheses[0]?.handle, 'form-1');
  assert.equal(preserved.emergent.revision, 7);
});

test('world diff reducer preserves identity and reconstructs the proposed state', () => {
  const first = sceneFromPlan(initialPlan(), {}, 0);
  const prior = {
    ...first.world,
    entities: [{ id: 'woman', label: 'woman', kind: 'person', attributes: ['red coat'], confidence: 0.9 }],
  };
  const proposed = { ...prior, action: 'walks toward the platform' };
  const diff = diffWorldState(prior, proposed);
  const committed = applySceneDiff(prior, diff);
  assert.deepEqual(committed, proposed);
  assert.equal(committed.entities[0]?.id, prior.entities[0]?.id);
  assert.equal(committed.visualIdentity.color.scheme, 'custom');
  assert.equal(typeof committed.visualIdentity.lighting.keyIntensity, 'number');
  committed.entities[0]?.attributes.push('runtime mutation');
  assert.equal(prior.entities[0]?.attributes.includes('runtime mutation'), false);
});

test('world diff reconciles rolling evidence ids by stable entity kind and label', () => {
  const first = sceneFromPlan(initialPlan(), {}, 0).world;
  const prior = { ...first, entities: [{ id: 'asr-window-a', label: 'person', kind: 'subject', attributes: [], confidence: 0.8 }] };
  const proposed = { ...prior, entities: [{ id: 'asr-window-b', label: 'person', kind: 'subject', attributes: ['revised evidence'], confidence: 0.9 }] };
  const diff = diffWorldState(prior, proposed);
  assert.equal(diff.identityBreak, false);
  assert.equal(diff.add.length, 0);
  assert.equal(diff.remove.length, 0);
  assert.equal(diff.keep[0]?.id, 'asr-window-a');
  assert.equal(applySceneDiff(prior, diff).entities[0]?.attributes[0], 'revised evidence');
});

test('timed lyric import preserves evidence and rejects untimed results', () => {
  const lines = parseLrc('[00:01.00]first line\n[00:03.50]second line');
  assert.equal(lines[0]!.startSec, 1);
  assert.equal(lines[0]!.endSec, 3.5);
  const meaning = meaningFromLyrics({ provider: 'import', match: 'import', timing: 'line', rights: 'verified', confidence: 0.9, lines });
  assert.equal(meaning?.evidence.length, 2);
  assert.equal(meaning?.evidence[0]?.source, 'lyrics');
  assert.equal(meaningFromLyrics({ provider: 'x', match: 'metadata', timing: 'none', rights: 'unknown', confidence: 0.4, lines }), null);
});

test('LRCLIB provider preserves synced evidence and rejects duration mismatches', async () => {
  let calls = 0;
  const provider = new LrclibLyricsProvider(async (url, init) => {
    calls++;
    assert.match(url, /duration=213/u);
    assert.equal((init?.headers as Record<string, string>)['X-User-Agent'], 'system1-visualizer/0.1.0 (https://github.com/takku1/visualizer)');
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: 42, trackName: 'Rain', artistName: 'Band', albumName: 'Night', duration: 213,
          language: 'en', syncedLyrics: '[00:01.00]the woman walks\n[00:04.00]through the rain', plainLyrics: 'the woman walks through the rain',
        };
      },
    };
  });
  const result = await provider.lookup({ trackId: 'track-rain', title: 'Rain', artist: 'Band', album: 'Night', durationSec: 213 });
  assert.equal(calls, 1);
  assert.equal(result?.timing, 'line');
  assert.equal(result?.rights, 'unknown');
  assert.equal(result?.lines[0]?.text, 'the woman walks');
  assert.equal(meaningFromLyrics(result!, 1), null);
  assert.ok(meaningFromLyrics(result!, 1, { allowUnknownRights: true }));

  const mismatch = new LrclibLyricsProvider(async () => ({
    ok: true, status: 200, async json() { return { duration: 100, syncedLyrics: '[00:01.00]wrong version' }; },
  }));
  assert.equal(await mismatch.lookup({ trackId: 'track-rain', title: 'Rain', artist: 'Band', durationSec: 213 }), null);
});

test('cached lyric lookup avoids repeated provider requests', async () => {
  let calls = 0;
  const provider = new CachedLyricsProvider(new LrclibLyricsProvider(async () => {
    calls++;
    return { ok: true, status: 200, async json() { return { duration: 10, syncedLyrics: '[00:01.00]rain' }; } };
  }), new MemoryLyricsCache());
  const query = { trackId: 'cached', title: 'Rain', artist: 'Band', durationSec: 10 };
  assert.ok(await provider.lookup(query));
  assert.ok(await provider.lookup(query));
  assert.equal(calls, 1);
});

test('cached providers keep distinct stable namespaces', async () => {
  const cache = new MemoryLyricsCache();
  const query = { trackId: 'same', title: 'Rain', artist: 'Band' };
  const local = new LocalTimedLyricsProvider(() => ({ source: 'local://same', text: '[00:01.00]rain' }));
  const wrapped = new CachedLyricsProvider(local, cache);
  assert.ok(await wrapped.lookup(query));
  assert.equal(cache.get(lyricsCacheKey('local-timed', query))?.provider, 'local-timed');
  assert.equal(cache.get(lyricsCacheKey('lrclib', query)), null);
});

test('lyrics provider chain falls through failed sources and preserves the winning source', async () => {
  const calls: string[] = [];
  const chain = new LyricsProviderChain([
    { id: 'missing-local', async lookup() { calls.push('missing-local'); return null; } },
    { id: 'verified-source', async lookup() { calls.push('verified-source'); return { provider: 'verified-source', match: 'provider-id', timing: 'line', rights: 'verified', confidence: 0.95, lines: [{ startSec: 1, text: 'rain' }] }; } },
    { id: 'should-not-run', async lookup() { calls.push('should-not-run'); return null; } },
  ]);
  const result = await chain.lookup({ trackId: 'chain', title: 'Rain', artist: 'Band' });
  assert.equal(result?.provider, 'verified-source');
  assert.deepEqual(calls, ['missing-local', 'verified-source']);
});

test('persistent lyric cache survives provider recreation and expires safely', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const query = { trackId: 'persistent', title: 'Rain', artist: 'Band', durationSec: 10 };
  const result = { provider: 'lrclib', match: 'metadata' as const, timing: 'line' as const, rights: 'unknown' as const, confidence: 0.7, lines: [{ startSec: 1, text: 'rain' }] };
  new StorageLyricsCache(storage).set('lrclib\u0000persistent', result);
  assert.deepEqual(new StorageLyricsCache(storage).get('lrclib\u0000persistent'), result);
  assert.equal(new StorageLyricsCache(storage, 's1:short:', 0).get('lrclib\u0000persistent'), null);
  assert.equal(lyricsCacheKey('lrclib', query).includes('persistent'), true);
});

test('local timed lyric adapter preserves source and timing without filesystem work', async () => {
  const provider = new LocalTimedLyricsProvider(async (query) => ({
    source: `tag://${query.trackId}`,
    language: 'ja',
    text: '[00:01.00]雨の駅を歩いて',
  }));
  const result = await provider.lookup({ trackId: 'local-ja', title: 'Rain', artist: 'Band' });
  assert.equal(result?.provider, 'local-timed');
  assert.equal(result?.providerUrl, 'tag://local-ja');
  assert.equal(result?.rights, 'unknown');
  assert.equal(result?.lines[0]?.startSec, 1);
  assert.equal(result?.language, 'ja');
});

test('timed lyric providers recover Japanese script language without guessing Latin languages', async () => {
  const japanese = await new LocalTimedLyricsProvider(() => ({ source: 'file://song.lrc', text: '[00:01.00]雨の駅を歩いて' })).lookup({ trackId: 'ja', title: 'x', artist: 'y' });
  const latin = await new LocalTimedLyricsProvider(() => ({ source: 'file://song.lrc', text: '[00:01.00]la noche canta' })).lookup({ trackId: 'latin', title: 'x', artist: 'y' });
  assert.equal(japanese?.language, 'ja');
  assert.equal(latin?.language, undefined);
});

test('timed lyric meaning shares bounded English/Japanese grounding with live ASR', () => {
  const english = meaningFromLyrics({
    provider: 'import', match: 'import', timing: 'line', rights: 'verified', confidence: 0.9,
    language: 'en', lines: [{ startSec: 1, endSec: 3, text: 'the woman walks through the rain' }],
  });
  assert.equal(english?.abstained, false);
  assert.ok(english?.motifs.some((motif) => motif.kind === 'person'));
  assert.ok(english?.motifs.some((motif) => motif.kind === 'force'));
  assert.equal(english?.sections[0]?.action, 'walks through the environment');

  const japanese = meaningFromLyrics({
    provider: 'import', match: 'import', timing: 'line', rights: 'verified', confidence: 0.9,
    language: 'ja', lines: [{ startSec: 1, endSec: 3, text: '雨の駅を歩いて' }],
  });
  assert.equal(japanese?.abstained, false);
  assert.ok(japanese?.motifs.some((motif) => motif.kind === 'force'));
  assert.ok(japanese?.motifs.some((motif) => motif.kind === 'place'));
  assert.equal(japanese?.sections[0]?.action, 'walks through the environment');

  const unknown = meaningFromLyrics({
    provider: 'import', match: 'import', timing: 'line', rights: 'verified', confidence: 0.9,
    language: 'ja', lines: [{ startSec: 1, endSec: 3, text: 'ほしのうた' }],
  });
  assert.equal(unknown?.abstained, true);
  assert.ok(unknown?.motifs.every((motif) => motif.kind === 'symbol'));
});

test('world identity follows motif ids across semantic section changes', () => {
  const meaning: SongMeaning = {
    revision: 1, thesis: 'a figure crosses a field', abstained: false,
    motifs: [
      { id: 'figure-a', kind: 'person', label: 'the figure', attributes: ['red coat'], confidence: 0.9, source: 'lyrics' },
      { id: 'field-b', kind: 'place', label: 'the field', attributes: [], confidence: 0.9, source: 'lyrics' },
    ],
    relations: [],
    sections: [
      { index: 0, startSec: 0, action: 'waits', activeMotifs: ['figure-a', 'field-b'], affect: [], confidence: 0.9 },
      { index: 1, startSec: 10, action: 'crosses', activeMotifs: ['figure-a', 'field-b'], affect: [], confidence: 0.9 },
    ],
    evidence: [{ source: 'lyrics', text: 'figure crosses field', confidence: 0.9 }],
  };
  const first = sceneFromPlan(initialPlan(), { trackId: 'identity', meaning, sectionIndex: 0 }, 0);
  const next = sceneFromPlan(initialPlan(), { trackId: 'identity', meaning, sectionIndex: 1 }, 1);
  const diff = diffWorldState(first.world, next.world);
  assert.deepEqual(diff.keep.map((entity) => entity.id).sort(), ['figure-a']);
  assert.equal(diff.add.length, 0);
  assert.equal(diff.remove.length, 0);
  assert.deepEqual(diff.environmentAdded, []);
  assert.deepEqual(diff.environmentRemoved, []);
});

/** Drive a scheduler through `seconds` of a 120 bpm 4/4 grid (2 s bars); returns requests with their times. */
function drive(s: CheckpointScheduler, seconds: number, obs: StreamObservation, t0 = 0, structure = true) {
  const out: { t: number; reason: string; spliceFrames: number }[] = [];
  for (let i = 0; i < seconds * 60; i++) {
    const t = t0 + i / 60;
    const barPhase = (t / 2) % 1;
    const onBeat = (t * 2) % 1 < 1 / 60;
    const r = s.update(frame({ t, barPhase, hasStructure: structure, onBeat }), obs);
    if (r) out.push({ t, reason: r.reason, spliceFrames: r.spliceFrames });
  }
  return out;
}

test('no request before a scene or while disconnected', () => {
  const s = new CheckpointScheduler();
  assert.equal(drive(s, 3, live).length, 0);
  s.setScene(sceneFromPlan(initialPlan(), {}, 0));
  assert.equal(drive(s, 3, { ...live, connected: false }).length, 0);
});

test('the first scene is requested immediately with an instant splice', () => {
  const s = new CheckpointScheduler();
  s.setScene(sceneFromPlan(initialPlan(), {}, 0));
  const r = drive(s, 1, live);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.reason, 'initial');
  assert.equal(r[0]!.spliceFrames, 1);
  assert.equal(s.scene?.continuity, 0, 'a new session starts from a fresh keyframe');
});

test('checkpoint receipts record the timing source and commit phase', () => {
  const s = new CheckpointScheduler();
  s.setScene(sceneFromPlan(initialPlan(), {}, 0));
  const r = s.update(frame({ t: 0, hasStructure: true, beatIndex: 3 }), live);
  assert.equal(r?.reason, 'initial');
  assert.equal(r?.timing.source, 'spotify-analysis');
  assert.equal(r?.timing.requestedTargetBeat, 3);
  assert.equal(r?.timing.actualCommitTime, 0);
  const scene = s.scene!;
  assert.equal(scene.continuityContract.evidence, 'abstention');
});

test('checkpoint commits the world diff from the prior committed world', () => {
  const s = new CheckpointScheduler({ minGapSec: 0 });
  const first = sceneFromPlan(initialPlan(), {}, 0);
  s.setScene(first);
  assert.equal(s.update(frame({ t: 0, hasStructure: true, beatIndex: 0 }), live)?.reason, 'initial');
  const changed = {
    ...first,
    fingerprint: { ...first.fingerprint, action: 99 },
    world: { ...first.world, action: 'walks toward the platform' },
  };
  s.setScene(changed);
  s.update(frame({ t: 1.9, barPhase: 0.95, hasStructure: true, beatIndex: 3 }), live);
  const request = s.update(frame({ t: 2, barPhase: 0, hasStructure: true, beatIndex: 4 }), live);
  assert.equal(request?.reason, 'scene');
  assert.equal(request?.worldDiff.action.from, 'abstain');
  assert.equal(request?.worldDiff.action.to, 'walks toward the platform');
  assert.equal(s.world?.action, 'walks toward the platform');
});

test('checkpoint compiles to a backend-neutral realization request', () => {
  const s = new CheckpointScheduler();
  s.setScene(sceneFromPlan(initialPlan(), {}, 0));
  const request = s.update(frame({ t: 0, hasStructure: true }), live)!;
  const realization = realizationRequestFromCheckpoint(request);
  assert.equal(realization.world, request.world);
  assert.equal(realization.shot.id, request.shot.id);
  assert.equal(realization.diff, request.worldDiff);
  assert.equal(realization.legacy.prompt, request.prompt);
  assert.equal(realization.conditioning.version, 'structured-world-v2');
  assert.ok(Number.isFinite(realization.conditioning.hspace.organic));
  assert.equal(realization.conditioning.transition, 'preserve');
});

test('shot graph keeps alternate candidates explicit and ordered', () => {
  const first = sceneFromPlan(initialPlan(), {}, 0);
  const graph = addShotCandidate(compileShotGraph(first), 'next', { ...first, seed: 2 }, 4, 0.8, { section: 2, requiresDownbeat: true });
  const branched = addShotCandidate(graph, 'alternate', { ...first, seed: 3 }, 4, 0.9, { section: 2, requiresDownbeat: true });
  assert.deepEqual(nextShots(branched).map((edge) => edge.to), ['alternate', 'next']);
  assert.deepEqual(nextShots(branched).map((edge) => edge.from), ['current', 'current']);
  const runtime = new ShotGraphRuntime(branched);
  assert.equal(nextShots(graph)[0]!.to, 'next');
  assert.equal(nextShots(branched)[0]!.prefetch, true);
  assert.deepEqual(runtime.prefetchCandidates().map((node) => node.id), ['alternate', 'next']);
  assert.equal(runtime.prefetchCandidates()[1]!.world, branched.nodes[1]!.world);
  assert.equal(runtime.prefetchCandidates()[1]!.shot.id, branched.nodes[1]!.shot.id);
  assert.ok(runtime.prefetchCandidates()[0]!.worldDiff);
  assert.equal(runtime.choose({ section: 2, confidence: 1, downbeat: false }), null);
  assert.equal(runtime.lastSelection?.status, 'waiting');
  assert.deepEqual(runtime.lastSelection?.rejected[0]?.reasons, ['downbeat']);
  assert.equal(runtime.choose({ section: 2, confidence: 1, downbeat: true })?.id, 'alternate');
  assert.equal(runtime.lastSelection?.status, 'selected');
  assert.equal(runtime.lastSelection?.current, 'current');
  assert.equal(runtime.lastSelection?.selectedId, 'alternate');
  assert.equal(runtime.cancel(), 1);
});

test('shot graph waits for a downbeat on trusted structure and falls back to beats otherwise', () => {
  assert.deepEqual(shotGraphBoundary(0.5, 0.6, true, true, 1), { eligible: false, downbeat: false });
  assert.deepEqual(shotGraphBoundary(0.5, 0.6, true, false, 0.2), { eligible: true, downbeat: false });
  assert.deepEqual(shotGraphBoundary(0.1, 0.8, true, true, 1), { eligible: true, downbeat: true });
  assert.deepEqual(shotGraphBoundary(0.5, 0.6, false, false, 0.2), { eligible: false, downbeat: false });
});

test('a new director scene lands on a downbeat, spliced over one bar', () => {
  const s = new CheckpointScheduler({ minGapSec: 0 });
  s.setScene(sceneFromPlan(initialPlan(), {}, 0));
  drive(s, 1, live);
  const changed = sceneFromPlan(initialPlan(), {}, 1);
  s.setScene({ ...changed, prompt: 'wording can change without changing the shot', fingerprint: { ...changed.fingerprint, action: 99 } });
  const r = drive(s, 4, live, 1.3);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.reason, 'scene');
  assert.ok(Math.abs(r[0]!.t - 2) < 0.05, `expected the t=2s downbeat, got ${r[0]!.t}`);
  assert.equal(r[0]!.spliceFrames, 24); // one 2 s bar at 12 fps
});

test('the same scene is re-seeded after N bars (drift bound)', () => {
  const s = new CheckpointScheduler({ barsPerReseed: 4 });
  s.setScene(sceneFromPlan(initialPlan(), {}, 0));
  const r = drive(s, 20, live);
  assert.deepEqual(r.map((x) => x.reason), ['initial', 'reseed', 'reseed']);
});

test('a stalled picture is re-seeded; nothing fires mid-splice', () => {
  const s = new CheckpointScheduler({ barsPerReseed: 999, stagnantSec: 3 });
  s.setScene(sceneFromPlan(initialPlan(), {}, 0));
  drive(s, 1, live);
  assert.equal(drive(s, 10, { ...live, phase: 'splicing', change: 0 }, 1).length, 0);
  const r = drive(s, 10, { ...live, change: 0.001 }, 11);
  assert.equal(r[0]?.reason, 'stagnant');
});

test('keyframes off: only the initial keyframe, no scene changes, reseeds or stagnation splices', () => {
  const s = new CheckpointScheduler({ keyframes: false, barsPerReseed: 2, stagnantSec: 1, minGapSec: 0 });
  s.setScene(sceneFromPlan(initialPlan(), {}, 0));
  const first = drive(s, 1, live);
  assert.deepEqual(first.map((x) => x.reason), ['initial']);
  s.setScene({ ...sceneFromPlan(initialPlan(), {}, 1), prompt: 'a different scene' });
  assert.equal(drive(s, 20, { ...live, change: 0 }, 1).length, 0);
});

test('without a trusted grid it still fires within two seconds', () => {
  const s = new CheckpointScheduler({ barsPerReseed: 1, minGapSec: 0 });
  s.setScene(sceneFromPlan(initialPlan(), {}, 0));
  drive(s, 1, live, 0, false);
  const r = drive(s, 6, live, 1, false);
  assert.ok(r.length >= 1);
});

// ---------- live knob direction ----------

/** A plan whose palette and texture carry real distributions. */
function planWith(palette: Record<string, number>, texture: Record<string, number>, patch: Partial<VisualPlan> = {}): VisualPlan {
  const w = <T extends string>(p: Record<string, number>): Weighted<T> => {
    const top = Object.entries(p).sort((a, b) => b[1] - a[1])[0]![0] as T;
    return { top, p: p as Partial<Record<T, number>>, confidence: p[top]! };
  };
  return { ...initialPlan(), palette: w(palette), texture: w(texture), hardCut: 0, ...patch };
}

test('knobs: a 60/40 palette answer renders as a weighted blend, not an argmax', () => {
  const k = new KnobDirector();
  const t = k.decide(planWith({ ember: 0.6, ice: 0.4 }, { plasma: 1 }), {});
  assert.ok(t.prompts.length >= 2);
  assert.ok(Math.abs(t.weights.reduce((s, x) => s + x, 0) - 1) < 1e-9);
  assert.ok(t.weights[0]! > t.weights[1]! && t.weights[1]! > 0.2, `weights ${t.weights}`);
  // The look's palette is the same mixture: its shadow colour lies between ember's and ice's.
  const ember = lookFromPlan(planWith({ ember: 1 }, { plasma: 1 }), 0).palette[1];
  const ice = lookFromPlan(planWith({ ice: 1 }, { plasma: 1 }), 0).palette[1];
  for (let c = 0; c < 3; c++) {
    const lo = Math.min(ember[c]!, ice[c]!), hi = Math.max(ember[c]!, ice[c]!);
    assert.ok(t.look.palette[1][c]! >= lo - 1e-9 && t.look.palette[1][c]! <= hi + 1e-9);
  }
});

test('knobs: anchors stay put while the answer only wobbles (no prompt churn)', () => {
  const k = new KnobDirector();
  const first = k.decide(planWith({ ember: 0.6, ice: 0.4 }, { plasma: 0.7, strata: 0.3 }), {}).prompts;
  for (let i = 0; i < 12; i++) {
    const e = 0.5 + 0.2 * Math.sin(i);
    k.decide(planWith({ ember: e, ice: 1 - e }, { plasma: 0.6 + 0.1 * Math.cos(i), strata: 0.4 - 0.1 * Math.cos(i) }), {});
  }
  assert.deepEqual(k.anchors.map((a) => a.prompt), first);
});

test('knobs: a sustained new answer replaces a starved anchor and glides in', () => {
  const k = new KnobDirector({ retireAfter: 2 });
  k.decide(planWith({ ember: 0.6, ice: 0.4 }, { plasma: 0.7, strata: 0.3 }), {});
  let t = k.decide(planWith({ ultraviolet: 0.9, ember: 0.1 }, { neural: 0.9, plasma: 0.1 }), {});
  for (let i = 0; i < 3; i++) t = k.decide(planWith({ ultraviolet: 0.9, ember: 0.1 }, { neural: 0.9, plasma: 0.1 }), {});
  assert.ok(t.prompts.some((p) => p.includes('ultraviolet') && p.includes('neural')), t.prompts.join(' | '));
  assert.ok(!t.cut && t.tauSec > 1, 'a musical change glides; it is not a cut');
});

test('knobs: a confident hard cut resets the anchors and asks for a keyframe', () => {
  const k = new KnobDirector();
  k.decide(planWith({ ember: 1 }, { plasma: 1 }), {});
  const t = k.decide(planWith({ ice: 1 }, { strata: 1 }, { hardCut: 0.95 }), {});
  assert.ok(t.cut && t.tauSec < 1);
  assert.ok(t.prompts[0]!.includes('glacial ice') && t.prompts.every((p) => !p.includes('molten ember')));
});

test('knobs: procedural structure holds while anchors trade the top spot; a cut changes it', () => {
  const k = new KnobDirector();
  const plan = (sym: string, pal: Record<string, number>, cut = 0): VisualPlan => ({
    ...planWith(pal, { plasma: 1 }), hardCut: cut,
    symmetry: { top: sym as VisualPlan['symmetry']['top'], p: { [sym]: 1 }, confidence: 1 },
  });
  const first = k.decide(plan('kaleido6', { ember: 0.55, ice: 0.45 }), {}).look.fold;
  for (let i = 0; i < 8; i++) {
    const t = k.decide(plan('kaleido6', i % 2 ? { ember: 0.45, ice: 0.55 } : { ember: 0.55, ice: 0.45 }), {});
    assert.equal(t.look.fold, first);
  }
  assert.equal(k.decide(plan('mirror', { ice: 1 }, 0.95), {}).look.fold, 2);
});

test('knobs: more intensity raises the bend gains', () => {
  const k = new KnobDirector();
  const calm = k.decide({ ...planWith({ ember: 1 }, { plasma: 1 }), intensity: 0.5 }, {}).bendGain;
  const loud = k.decide({ ...planWith({ ember: 1 }, { plasma: 1 }), intensity: 3.8 }, {}).bendGain;
  assert.ok(loud.swell > calm.swell && loud.lurch > calm.lurch && loud.hue > calm.hue);
});

test('resetTrack starts a new continuous realization session', () => {
  const s = new CheckpointScheduler({ reseed: false, minGapSec: 0 });
  const scene = sceneFromPlan(initialPlan(), { trackId: 'track-a' }, 0);
  s.setScene(scene);
  const first = s.update(frame({ t: 0, hasStructure: true, beatIndex: 0 }), live);
  assert.equal(first?.id, 'k1');
  assert.equal(s.world !== null, true);

  s.resetTrack();
  assert.equal(s.scene, null);
  assert.equal(s.world, null);
  s.setScene(sceneFromPlan(initialPlan(), { trackId: 'track-b' }, 0));
  const next = s.update(frame({ t: 1, hasStructure: true, beatIndex: 2 }), live);
  assert.equal(next?.id, 'k1');
  assert.equal(next?.reason, 'initial');
});

test('continuous mode keeps one animation state until the scene meaning changes', () => {
  const s = new CheckpointScheduler({ reseed: false, barsPerReseed: 1, stagnantSec: 1, minGapSec: 0 });
  s.setScene(sceneFromPlan(initialPlan(), {}, 0));
  assert.deepEqual(drive(s, 1, live).map((x) => x.reason), ['initial']);
  assert.equal(drive(s, 12, { ...live, change: 0.001 }, 1).length, 0);

  const changed = sceneFromPlan(initialPlan(), {}, 1);
  s.setScene({ ...changed, fingerprint: { ...changed.fingerprint, action: 99 } });
  const next = drive(s, 4, live, 13);
  assert.equal(next[0]?.reason, 'scene');
});

test('checkpoint change detection ignores prompt wording and follows the scene fingerprint', () => {
  const s = new CheckpointScheduler({ minGapSec: 0 });
  const first = sceneFromPlan(initialPlan(), {}, 0);
  s.setScene(first);
  drive(s, 1, live);
  s.setScene({ ...first, prompt: 'same realization, different prose' });
  assert.equal(drive(s, 3, live, 1.3).length, 0);
});

test('telemetry coupling is bounded and grounds a drifting frame', () => {
  const c = new CouplingController();
  const base = { ...CALM, strength: 0.5, noise: 0.2, feedback: 0.2 };
  const adjusted = c.apply(base, { energy: 0.8, change: 0.03, jitter: 0.5, drift: 1.4 }, 1 / 30);
  assert.ok(adjusted.strength >= 0.2 && adjusted.strength <= 0.6);
  assert.ok(adjusted.noise >= 0 && adjusted.noise <= 0.4);
  assert.ok(adjusted.feedback < base.feedback);
});

test('fallback tempo folds subdivisions into the underlying pulse', () => {
  const estimate = estimateTempoFromOnsetGaps([0.5, 0.25, 0.5, 0.25, 0.5, 0.25]);
  assert.ok(estimate);
  assert.ok(Math.abs(estimate.tempo - 120) < 2, `${estimate.tempo}`);
});

test('semantic scene compiler preserves a subject and turns a relation into an action', () => {
  const meaning: SongMeaning = {
    revision: 1, thesis: 'someone crosses a field toward light', abstained: false,
    motifs: [
      { id: 'girl', kind: 'person', label: 'a girl', attributes: ['red scarf'], confidence: 0.9, source: 'lyrics' },
      { id: 'field', kind: 'place', label: 'an open field', attributes: ['windblown grass'], confidence: 0.9, source: 'lyrics' },
    ], relations: [{ subject: 'girl', verb: 'runs through', object: 'field', confidence: 0.9, source: 'lyrics' }],
    sections: [{ index: 0, startSec: 0, action: 'runs through the field', activeMotifs: ['girl', 'field'], affect: ['urgent'], confidence: 0.9 }],
    evidence: [{ source: 'lyrics', text: 'timestamped lyric span', confidence: 0.9 }],
  };
  const scene = compileSemanticScene(meaning, 0, 'warm dawn light');
  assert.ok(scene);
  assert.equal(scene.shot, 'follow');
  assert.ok(scene.prompt.includes('a girl'));
  assert.ok(scene.prompt.includes('runs through the field'));
});

test('scene generation keeps semantic manifests separate from legacy world prose', () => {
  const meaning: SongMeaning = {
    revision: 1,
    thesis: 'someone crosses a field toward light',
    language: 'ja',
    abstained: false,
    motifs: [
      { id: 'girl', kind: 'person', label: 'a girl', attributes: ['red scarf'], confidence: 0.9, source: 'lyrics' },
      { id: 'field', kind: 'place', label: 'an open field', attributes: ['windblown grass'], confidence: 0.9, source: 'lyrics' },
    ],
    relations: [{ subject: 'girl', verb: 'runs through', object: 'field', confidence: 0.9, source: 'lyrics' }],
    sections: [{ index: 0, startSec: 0, action: 'runs through the field', activeMotifs: ['girl', 'field'], affect: ['urgent'], confidence: 0.9 }],
    evidence: [{ source: 'lyrics', text: 'timestamped lyric span', confidence: 0.9 }],
  };

  const semantic = sceneFromPlan(initialPlan(), { trackId: 'semantic-track', meaning }, 0);
  assert.equal(semantic.source, 'semantic-manifest');
  assert.ok(semantic.prompt.includes('a girl'));
  assert.ok(semantic.prompt.includes('runs through the field'));
  assert.equal(semantic.semantic?.language, 'ja');
  assert.equal(semantic.prompt.includes('within enormous flowers blooming open'), false);
  assert.equal(semantic.prompt.includes('made of'), false);
  assert.equal(semantic.prompt.includes('story abstained'), false);

  const metadataMeaning: SongMeaning = { ...meaning, evidence: [{ source: 'metadata', text: 'title only', confidence: 0.9 }] };
  const metadataOnlyManifest = sceneFromPlan(initialPlan(), { trackId: 'metadata-manifest-track', meaning: metadataMeaning }, 0);
  assert.equal(metadataOnlyManifest.source, 'abstract-fallback');
  assert.ok(metadataOnlyManifest.prompt.includes('no literal subject'));

  const metadata = sceneFromPlan(initialPlan(), { trackId: 'metadata-track', concepts: ['miku'] }, 0);
  assert.equal(metadata.source, 'metadata-fallback');
  assert.ok(metadata.prompt.startsWith('Music-video realization under uncertainty:'));
  assert.ok(metadata.prompt.includes('no literal subject'));
  assert.ok(metadata.prompt.includes('perceptual constraints'));
  assert.equal(metadata.prompt.includes('abstract generative visual field'), false);
  assert.equal(metadata.prompt.includes('miku'), false);
  assert.equal(metadata.prompt.includes('within enormous flowers blooming open'), false);

  const abstract = sceneFromPlan(initialPlan(), { trackId: 'abstract-track' }, 0);
  assert.equal(abstract.source, 'abstract-fallback');
  assert.ok(abstract.prompt.startsWith('Music-video realization under uncertainty:'));
  assert.equal(abstract.prompt.includes('abstract generative visual field'), false);
  assert.equal(abstract.prompt.includes('miku'), false);
  assert.equal(abstract.prompt.includes('within enormous flowers blooming open'), false);
});

test('lyric evidence can drive an actual subject and event', () => {
  const meaning: SongMeaning = {
    revision: 1,
    thesis: 'a dog runs through a field',
    language: 'en',
    abstained: false,
    motifs: [
      { id: 'dog', kind: 'object', label: 'a dog', attributes: ['muddy paws'], confidence: 0.95, source: 'lyrics' },
      { id: 'field', kind: 'place', label: 'a field', attributes: ['tall grass'], confidence: 0.9, source: 'lyrics' },
    ],
    relations: [{ subject: 'dog', verb: 'runs through', object: 'field', confidence: 0.94, source: 'lyrics' }],
    sections: [{ index: 0, startSec: 0, action: 'runs through the field', activeMotifs: ['dog', 'field'], affect: ['joyful'], confidence: 0.92 }],
    evidence: [{ source: 'lyrics', text: 'the timestamped lyric span about the dog', confidence: 0.95, startSec: 4, endSec: 7 }],
  };
  const scene = sceneFromPlan(initialPlan(), { trackId: 'spot', meaning }, 0);
  assert.equal(scene.source, 'semantic-manifest');
  assert.ok(scene.prompt.includes('a dog'));
  assert.ok(scene.prompt.includes('runs through the field'));
  assert.equal(scene.prompt.includes('story abstained'), false);
});

await Promise.all(pendingTests);
console.log(`\n${passed} passed`);
