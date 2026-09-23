import { emptyFrame, certain, type FeatureFrame, type VisualPlan } from '../src/types';
import { initialPlan } from '../src/director/director';
import { WorldModel, type SemanticAxis } from '../src/world/model';

const frame: FeatureFrame = { ...emptyFrame(1024), dt: 1 / 60, t: 1, onBeat: false };

const plan = initialPlan();
const baseline = settle(plan, undefined);
const organic = settle(plan, ['form', { organic: 1 }]);
const architectural = settle(plan, ['form', { architectural: 1 }]);
const stable = settle(plan, ['persistence', { stable: 1 }]);
const ephemeral = settle(plan, ['persistence', { ephemeral: 1 }]);
const roughPlan = { ...plan, texture: { ...plan.texture, top: 'grain' as const, p: { grain: 1 }, confidence: 1 } };
const smoothPlan = { ...plan, texture: { ...plan.texture, top: 'plasma' as const, p: { plasma: 1 }, confidence: 1 } };
const rough = settle(roughPlan);
const smooth = settle(smoothPlan);
const quietAudio = settleWithAudio(plan, {
  flux: 0.05, bassFlux: 0.03, trebleFlux: 0.02, spectralCentroid: 0.2,
  spectralFlatness: 0.05, spectralRolloff: 0.25, harmonicity: 0.9,
  transientness: 0.03, stereoWidth: 0.05, level: 0.15, levelRelative: -1,
  bass: 0.2, treble: 0.15, tempo: 75,
});
const audioReactive = settleWithAudio(plan, {
  flux: 0.9, bassFlux: 0.85, trebleFlux: 0.75, spectralCentroid: 0.8,
  spectralFlatness: 0.8, spectralRolloff: 0.9, harmonicity: 0.2,
  transientness: 0.95, stereoWidth: 0.7, level: 0.9, levelRelative: 2,
  bass: 0.85, treble: 0.8, tempo: 165,
});
const controlDeltas = leafDeltas(quietAudio.controls, audioReactive.controls);

const checks = {
  formChangesGeometry: architectural.architectural > organic.architectural + 0.35,
  formChangesOrganic: organic.organic > architectural.organic + 0.35,
  persistenceChangesProjection: stable.persistent > ephemeral.persistent + 0.35,
  interventionPreservesSeed: baseline.seed === organic.seed && organic.seed === architectural.seed,
  materialChangesControls: rough.controls.material.grain > smooth.controls.material.grain + 0.35,
  controlsRespondToAudio: audioReactive.controls.timbre.percussiveness > quietAudio.controls.timbre.percussiveness,
  everyControlSurfaceResponds: Object.values(controlDeltas).every((delta) => delta > 0.02),
};

const result = {
  probe: 'semantic-causality',
  checks,
  pass: Object.values(checks).every(Boolean),
  projections: { baseline, organic, architectural, stable, ephemeral, rough, smooth, audioReactive },
};

console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;

function settle(planInput: VisualPlan, intervention?: [SemanticAxis, Record<string, number>]) {
  const world = new WorldModel();
  world.setPlan(planInput);
  for (let i = 0; i < 240; i++) world.update(frame);
  if (intervention) world.intervene(intervention[0], intervention[1]);
  for (let i = 0; i < 240; i++) world.update(frame);
  return world.projection();
}

function settleWithAudio(planInput: VisualPlan, audio: Partial<FeatureFrame>) {
  const world = new WorldModel();
  world.setPlan(planInput);
  for (let i = 0; i < 240; i++) world.update({ ...frame, ...audio });
  return world.projection();
}

function leafDeltas(a: unknown, b: unknown, prefix = ''): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof a === 'number' && typeof b === 'number') {
    out[prefix] = Math.abs(a - b);
    return out;
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return out;
  for (const key of Object.keys(a as Record<string, unknown>)) {
    Object.assign(out, leafDeltas(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      prefix ? `${prefix}.${key}` : key,
    ));
  }
  return out;
}
