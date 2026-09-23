import { motionFromWorld } from '../src/world/motion';
import { WorldModel } from '../src/world/model';
import { emptyFrame } from '../src/types';
import { identityFromContext } from '../src/world/identity';
import { deltaFromDecision } from '../src/world/delta';
import type { VisualPlan } from '../src/types';

const world = new WorldModel();
const baseline = motionFromWorld(world.state);
world.intervene('form', { organic: 0.9, architectural: 0.05, atmospheric: 0.05 });
world.update({ ...emptyFrame(1), dt: 0.05 });
const organic = motionFromWorld(world.state);
world.intervene('form', { organic: 0.05, architectural: 0.9, atmospheric: 0.05 });
world.update({ ...emptyFrame(1), dt: 0.05 });
const architectural = motionFromWorld(world.state);
const identity = identityFromContext({ title: 'Track', artist: 'Artist' }, world.state);
const missingIdentity = identityFromContext({});
const plan = {
  origin: 'offline', intensity: 0.5,
  motion: { top: 'drift' }, palette: { top: 'warm' }, texture: { top: 'grain' },
  geometry: { top: 'circles' }, symmetry: { top: 'polar' }, feedback: { top: 'trail' },
} as VisualPlan;
const delta = deltaFromDecision(plan, { ...emptyFrame(1), sectionIndex: 2, onSection: true, dynamicRange: 0.2 } as never, { sectionLabel: 'chorus' }, world.state, architectural);
const checks = {
  bounded: [organic.rotation, architectural.rotation, organic.localWarp, architectural.localWarp]
    .every((value) => Number.isFinite(value) && Math.abs(value) <= 1),
  interventionChangesPolicy: organic.localWarp !== architectural.localWarp || organic.fieldMode !== architectural.fieldMode,
  seedStable: world.projection().seed === 0.37,
  identityIsExplicit: identity.trackKey === 'Track\u0000Artist' && identity.confidence === 1 && missingIdentity.trackKey === null,
  deltaIsSectionScoped: delta.sectionIndex === 2 && delta.boundary && delta.sectionLabel === 'chorus' && delta.schema === 1,
};
const result = { probe: 'motion-causality', checks, pass: Object.values(checks).every(Boolean) };
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
