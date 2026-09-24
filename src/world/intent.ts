import type { Scene } from '../stream/scenes';
import { colorStateFromLook, lightingStateFromLook } from './visual';

/**
 * Renderer-independent perceptual direction. These are affordances and
 * pressures, not a literal storyboard; a realization backend may discover
 * whether they become bodies, cloth, plants, clouds, or architecture.
 */
export interface PerceptualIntent {
  form: string[];
  behavior: string[];
  spatiality: string[];
  materiality: string[];
  motion: string[];
  lighting: string[];
  color: string[];
  tension: string[];
  affect: string[];
  continuityPressure: number;
  evidence: Scene['continuityContract']['evidence'];
  confidence: number;
}

export function perceptualIntentFromScene(scene: Scene): PerceptualIntent {
  const semantic = scene.semantic;
  const action = (semantic?.action ?? '').toLowerCase();
  const shot = (semantic?.shot ?? scene.shot.grammar).toLowerCase();
  const organic = scene.look.organic >= 0.55;
  const color = colorStateFromLook(scene.look);
  const lighting = lightingStateFromLook(scene.look);
  return {
    form: organic ? ['organic', 'soft-bodied', 'asymmetric'] : ['structured', 'layered', 'articulated'],
    behavior: scene.provisionalCue?.behavior ?? actionWords(action),
    spatiality: shotWords(shot),
    materiality: scene.provisionalCue?.materiality?.length ? scene.provisionalCue.materiality : organic ? ['fibrous', 'translucent'] : ['mineral', 'laminated'],
    motion: scene.provisionalCue?.motion?.length ? scene.provisionalCue.motion : motionWords(action, scene.look.warp),
    lighting: scene.provisionalCue?.lighting?.length ? scene.provisionalCue.lighting : [lighting.direction, lighting.atmosphere > 0.55 ? 'diffuse' : 'defined'],
    color: [color.scheme, color.temperature >= 0.55 ? 'warm pressure' : 'cool pressure'],
    tension: scene.continuityContract.transition === 'cut' ? ['restrained', 'expanding'] : ['continuous', 'evolving'],
    affect: semantic ? (semantic.action ? [semantic.action] : []) : [],
    continuityPressure: clamp(scene.continuityContract.confidence),
    evidence: scene.continuityContract.evidence,
    confidence: clamp(scene.continuityContract.confidence),
  };
}

function actionWords(action: string): string[] {
  if (/walk|run|travel|cross|follow/.test(action)) return ['traveling', 'rhythmic', 'forward-pulling'];
  if (/approach|reach|enter/.test(action)) return ['gathering', 'reaching', 'converging'];
  if (/break|fracture|collapse/.test(action)) return ['folding', 'fracturing', 'releasing'];
  if (/wait|stand|hold/.test(action)) return ['suspended', 'gathered', 'restrained'];
  return ['drifting', 'revealing', 'becoming'];
}

function shotWords(shot: string): string[] {
  if (/follow|approach/.test(shot)) return ['deep', 'directional', 'expanding'];
  if (/encounter|establish/.test(shot)) return ['open', 'sparse', 'oriented'];
  if (/fracture/.test(shot)) return ['compressed', 'unstable', 'fragmented'];
  return ['open', 'deep', 'sparse'];
}

function motionWords(action: string, warp: number): string[] {
  const speed = warp >= 0.65 ? 'accelerating' : 'flowing';
  if (/break|fracture|collapse/.test(action)) return ['collapsing', speed];
  if (/walk|run|travel|cross/.test(action)) return ['pulsing', speed];
  return ['drifting', speed];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
