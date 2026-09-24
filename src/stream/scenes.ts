import type { VisualPlan, MotionId, PaletteId, TextureId, GeometryId, SymmetryId } from '../types';
import type { TrackContext } from '../director/director';
import { compileSemanticScene, type MotifLedger, type SemanticScene } from '../director/semantic';
import { worldStateFromScene, type WorldState } from '../world/state';
import type { Shot } from '../world/shot';
import type { ProvisionalPerceptualCue } from '../director/live-meaning';

export type Rgb = [number, number, number];

/** The procedural scene's parameters for one director scene (src/render/procedural.ts). */
export interface Look {
  /** Shadow, body, light. */
  palette: [Rgb, Rgb, Rgb];
  /** 1 = flowing filaments, 0 = architectural strata. */
  organic: number;
  /** Domain-warp depth. */
  warp: number;
  /** 0 none, 2 mirror, N = N-fold kaleidoscope. */
  fold: number;
  seed: number;
}

/** What the slow loop asks for: a keyframe prompt, and the procedural look it paints over. */
export interface Scene {
  prompt: string;
  /** Why this prompt exists; useful for telemetry and preventing silent fallback drift. */
  source: SceneSource;
  seed: number;
  /** 0 = hard cut to a fresh scene; >0 = grow the new keyframe out of the live frame. */
  continuity: number;
  /** Typed continuity policy; the scalar above remains the sidecar wire contract. */
  continuityContract: ContinuityContract;
  /** Presentation intent compiled separately from authoritative world state. */
  shot: Shot;
  look: Look;
  /** Compiled semantic realization, when evidence-backed meaning is present. */
  semantic?: SemanticScene;
  /** Stable change classes used by the scheduler; prompt wording is not a contract. */
  fingerprint: SceneFingerprint;
  /** Renderer-independent persistent world representation. */
  world: WorldState;
  /** Provisional cue may shape perceptual intent, never literal identity. */
  provisionalCue?: ProvisionalPerceptualCue;
}

export interface SceneCompilationOptions {
  /** Knob mode deliberately owns procedural structure and may retain folds. */
  preserveProceduralStructure?: boolean;
}

export type SceneSource = 'semantic-manifest' | 'metadata-fallback' | 'abstract-fallback';

export interface SceneFingerprint {
  identity: number;
  action: number;
  environment: number;
  look: number;
  camera: number;
}

export interface ContinuityContract {
  identity: 'preserve' | 'replace' | 'abstain';
  action: 'preserve' | 'evolve' | 'replace' | 'abstain';
  environment: 'preserve' | 'evolve' | 'replace' | 'abstain';
  camera: 'preserve' | 'evolve' | 'replace' | 'abstain';
  transition: 'glide' | 'cut';
  evidence: 'semantic' | 'metadata' | 'abstention';
  confidence: number;
}

/**
 * The director's plan and optional SongMeaning compiled into a realization scene.
 *
 * Semantic compilation runs at decision cadence (sections, or every 30 s),
 * never per frame. The vocabulary is the director's own, so a Jev answer and
 * the local engine's answer render through the same table.
 */
const PALETTE: Record<PaletteId, string> = {
  ember: 'molten ember orange and deep crimson glow',
  ice: 'glacial ice blue and white light',
  ultraviolet: 'ultraviolet violet and magenta neon',
  chlorophyll: 'lush chlorophyll greens',
  sodium: 'sodium-vapor amber light',
  oxide: 'rusted copper oxide and teal patina',
  monochrome: 'monochrome black and white, stark contrast',
  spectral: 'iridescent spectral rainbow colors',
};

const TEXTURE: Record<TextureId, string> = {
  filament: 'glowing filaments and fibers',
  plasma: 'swirling plasma clouds',
  grain: 'fine drifting grain and dust',
  cellular: 'organic cellular membranes',
  strata: 'layered rock strata',
  shards: 'crystalline shards',
  neural: 'branching neural dendrites',
};

const GEOMETRY: Record<GeometryId, string> = {
  none: '',
  circles: 'soft orbiting spheres',
  hexagons: 'hexagonal honeycomb structures',
  stars: 'starburst forms',
};

const SYMMETRY: Record<SymmetryId, string> = {
  none: '',
  mirror: 'mirror symmetric composition',
  kaleido3: 'kaleidoscopic symmetry',
  kaleido6: 'kaleidoscopic symmetry',
  kaleido12: 'intricate kaleidoscopic mandala',
  polar: 'radial symmetry',
};

const PALETTE_RGB: Record<PaletteId, [Rgb, Rgb, Rgb]> = {
  ember: [[0.12, 0.02, 0.02], [0.85, 0.25, 0.05], [1.0, 0.8, 0.4]],
  ice: [[0.02, 0.05, 0.12], [0.3, 0.6, 0.9], [0.9, 0.97, 1.0]],
  ultraviolet: [[0.05, 0.0, 0.12], [0.55, 0.1, 0.85], [1.0, 0.4, 0.9]],
  chlorophyll: [[0.0, 0.07, 0.03], [0.15, 0.6, 0.2], [0.8, 1.0, 0.5]],
  sodium: [[0.08, 0.04, 0.0], [0.95, 0.55, 0.1], [1.0, 0.9, 0.6]],
  oxide: [[0.07, 0.03, 0.02], [0.6, 0.25, 0.12], [0.3, 0.75, 0.7]],
  monochrome: [[0.02, 0.02, 0.02], [0.45, 0.45, 0.45], [0.95, 0.95, 0.95]],
  spectral: [[0.05, 0.0, 0.1], [0.1, 0.7, 0.8], [1.0, 0.5, 0.2]],
};

const ORGANIC: Record<TextureId, number> = {
  filament: 0.9, plasma: 0.85, neural: 0.9, cellular: 0.75, grain: 0.4, strata: 0.1, shards: 0.2,
};

const WARP: Record<MotionId, number> = {
  drift: 0.35, orbit: 0.45, pulse: 0.5, shear: 0.7, turbulent: 0.9, collapse: 0.8, bloom: 0.6, lattice: 0.25,
};

const FOLD: Record<SymmetryId, number> = { none: 0, mirror: 2, kaleido3: 3, kaleido6: 6, kaleido12: 12, polar: 0 };

export function lookFromPlan(plan: VisualPlan, seed: number): Look {
  return {
    palette: PALETTE_RGB[plan.palette.top],
    organic: ORGANIC[plan.texture.top],
    warp: WARP[plan.motion.top],
    fold: FOLD[plan.symmetry.top],
    seed: (seed % 1000) / 1000,
  };
}

/**
 * In abstaining/emergent mode the procedural layer supplies motion and
 * material pressure, not the visual ontology. Repeating folds are a legacy
 * content generator, so do not let them contradict the perceptual contract's
 * persistent asymmetric form. Semantic scenes may still request symmetry.
 */
function emergentLookFromPlan(plan: VisualPlan, seed: number): Look {
  const look = lookFromPlan(plan, seed);
  return { ...look, fold: 0 };
}

function mood(intensity: number): string {
  if (intensity < 1) return 'serene, minimal, soft light';
  if (intensity < 2) return 'atmospheric, cinematic';
  if (intensity < 3) return 'dramatic, high-energy lighting';
  return 'explosive, ecstatic, overwhelming energy';
}

function visualTreatment(plan: VisualPlan, includeProceduralVocabulary = true): string {
  const geometry = includeProceduralVocabulary ? (GEOMETRY[plan.geometry.top] || 'clean spatial composition') : 'spatially coherent, non-repetitive composition';
  const symmetry = includeProceduralVocabulary ? (SYMMETRY[plan.symmetry.top] || 'asymmetric framing') : 'asymmetric framing with a persistent dominant form';
  return `Visual treatment: ${PALETTE[plan.palette.top]}; ${TEXTURE[plan.texture.top]}; ${geometry}; ${symmetry}; ${mood(plan.intensity)}. Cinematic music-video frame, rich texture, detailed lighting.`;
}

/**
 * No-meaning direction is still a realization request, not permission to
 * invent a literal story. Put the perceptual affordances first so the current
 * diffusion adapter can discover a stable visual ontology while the procedural
 * renderer remains the continuous motion substrate.
 */
function perceptualFallback(plan: VisualPlan, cue?: ProvisionalPerceptualCue): string {
  const organic = ORGANIC[plan.texture.top] >= 0.55;
  const form = organic ? 'organic, soft-bodied, asymmetric' : 'structured, layered, articulated';
  const behavior = ({
    drift: 'drifting and revealing', orbit: 'circling and gathering', pulse: 'appearing and receding rhythmically',
    shear: 'crossing laterally', turbulent: 'colliding and accelerating', collapse: 'folding toward a shared center',
    bloom: 'opening and releasing', lattice: 'traveling through repeating depth',
  } satisfies Record<MotionId, string>)[plan.motion.top];
  const space = plan.motion.top === 'collapse' ? 'deep, compressed, vanishing-point space' : 'open, sparse, directional space';
  const material = organic ? 'fibrous, translucent material' : 'mineral, laminated material';
  const motion = plan.intensity >= 3 ? 'accelerating and volatile' : plan.intensity >= 1.5 ? 'flowing with rising pressure' : 'slow, suspended, and continuous';
  const tension = plan.hardCut > 0.5 ? 'restrained becoming expansive' : 'continuous and evolving';
  const cueText = cue
    ? ` A provisional low-risk cue suggests behavior ${cue.behavior.join(', ')}${cue.materiality.length ? ` and material ${cue.materiality.join(', ')}` : ''}; treat it as pressure, not as a literal subject or event.`
    : '';
  return `Music-video realization under uncertainty: no literal subject, event, or location is asserted. Discover an emergent world from these perceptual constraints: form ${form}; behavior ${behavior}; space ${space}; material ${material}; motion ${motion}; tension ${tension}.${cueText} Preserve the dominant visual form and its identity across frames; let music modulate existing motion, light, and atmosphere without inventing a new story, text, logo, or object. ${visualTreatment(plan, false)}`;
}

export function sceneFromPlan(
  plan: VisualPlan,
  ctx: TrackContext,
  index: number,
  ledger?: MotifLedger,
  options: SceneCompilationOptions = {},
): Scene {
  const semantic = ctx.meaning ? compileSemanticScene(ctx.meaning, ctx.sectionIndex ?? 0, PALETTE[plan.palette.top], ledger) : null;
  const subject = ctx.concepts?.length ? ctx.concepts.join(' and ') : '';
  const source: SceneSource = semantic ? 'semantic-manifest' : subject ? 'metadata-fallback' : 'abstract-fallback';
  const narrative = semantic?.prompt ?? perceptualFallback(plan, ctx.provisionalCue);
  const parts = semantic ? [narrative, visualTreatment(plan)] : [narrative];
  const seed = hash(`${ctx.trackId ?? ctx.title ?? 'session'}#${index}`);
  const semanticParts = semantic ? {
    identity: semantic.subjects.join('|'),
    action: `${semantic.relation ?? ''}|${semantic.action}`,
    environment: semantic.environment.join('|'),
    camera: semantic.camera,
  } : {
    // Abstention preserves identity, but it does not mean the realization is
    // frozen. The local director still has evidence-backed perceptual choices
    // for motion/material/space; compile those into change classes so a
    // meaningful fallback chapter can reach the ShotGraph without inventing a
    // literal story.
    identity: `${ctx.trackId ?? ctx.title ?? 'session'}|abstaining`,
    action: `${plan.motion.top}|${plan.feedback.top}|${Math.round(plan.intensity * 2)}`,
    environment: `${plan.texture.top}|${plan.palette.top}`,
    camera: `${plan.motion.top}|${plan.feedback.top}`,
  };
  const hardCut = plan.hardCut > 0.5;
  const continuityContract: ContinuityContract = semantic
    ? {
        identity: 'preserve', action: 'evolve', environment: 'evolve', camera: 'evolve',
        transition: hardCut ? 'cut' : 'glide', evidence: 'semantic',
        confidence: Math.max(0, Math.min(1, semantic.source === 'none' ? 0.5
          : (ctx.meaning?.sections.find((section) => section.index === (ctx.sectionIndex ?? 0))?.confidence
            ?? ctx.meaning?.evidence[0]?.confidence ?? 0.5))),
      }
    : {
        identity: 'abstain', action: 'abstain', environment: 'abstain', camera: 'evolve',
        transition: hardCut ? 'cut' : 'glide', evidence: subject ? 'metadata' : 'abstention',
        confidence: subject ? 0.35 : 0,
      };
  const scene = {
    prompt: parts.join(', '),
    source,
    seed,
    continuity: hardCut ? 0 : 0.5,
    continuityContract,
    shot: {
      id: `shot-${index}`,
      worldRevision: semantic?.meaningRevision ?? null,
      grammar: semantic?.shot ?? 'establish',
      framing: semantic?.camera ?? continuityContract.camera,
      camera: semantic?.camera ?? continuityContract.camera,
      transition: semantic?.transition ?? continuityContract.transition,
      durationSec: 8,
      continuity: {
        identity: continuityContract.identity,
        action: continuityContract.action,
        environment: continuityContract.environment,
        camera: continuityContract.camera,
        confidence: continuityContract.confidence,
      },
    },
    look: semantic || options.preserveProceduralStructure
      ? lookFromPlan(plan, seed)
      : emergentLookFromPlan(plan, seed),
    provisionalCue: ctx.provisionalCue,
    semantic: semantic ?? undefined,
    fingerprint: {
      identity: hash(semanticParts.identity),
      action: hash(semanticParts.action),
      environment: hash(semanticParts.environment),
      look: hash(`${plan.palette.top}|${plan.texture.top}|${plan.motion.top}|${plan.symmetry.top}`),
      camera: hash(semanticParts.camera),
    },
  } as Scene;
  scene.world = worldStateFromScene(scene, ctx.sectionIndex ?? 0, ctx.position ?? 0);
  return scene;
}

/** FNV-1a, so the same track and checkpoint index always get the same seed. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
