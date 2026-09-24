import type { MeaningSource, Motif, MotifKind } from './semantic';
import contract from './grounding-contract.json';

type GroundableKind = Exclude<MotifKind, 'symbol'>;

/** Language adapters normalize surface forms into this shared cue contract. */
export interface GroundedCue {
  kind: GroundableKind | 'action';
  canonical: string;
  sourceLanguage: string;
  evidence: string;
  confidence: number;
}

export interface GroundingAdapter {
  id: string;
  supports(language: string): boolean;
  ground(text: string, language: string, confidence: number, idPrefix: string, source: Extract<MeaningSource, 'audio' | 'lyrics'>): GroundingResult;
}

export interface GroundingResult {
    motifs: Motif[];
    action: string | null;
    cues: GroundedCue[];
}

const VOCAB: Record<GroundableKind, readonly [RegExp, string][]> = Object.fromEntries(
  contract.motifs.map((entry) => [entry.kind, [
    [new RegExp(entry.english, 'iu'), entry.kind],
    [new RegExp(entry.japanese, 'u'), entry.kind],
  ]]),
) as unknown as Record<GroundableKind, readonly [RegExp, string][]>;

const ACTIONS: readonly [RegExp, string][] = contract.actions.map((entry) => [new RegExp(entry.english, 'iu'), entry.canonical]);
const JAPANESE_ACTIONS: readonly [RegExp, string][] = contract.actions.map((entry) => [new RegExp(entry.japanese, 'u'), entry.canonical]);
const boundedLanguages = new Set<string>(contract.languages);

function normalizedLanguage(language: string): string {
  return language.trim().toLowerCase().split(/[-_]/, 1)[0] || 'und';
}

function isScriptCompatible(language: string, text: string): boolean {
  const base = normalizedLanguage(language);
  if (base === 'ja') return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (base === 'en') return /[a-z]/iu.test(text);
  return /[a-z]|[\u3040-\u30ff\u3400-\u9fff]/iu.test(text);
}

function lexicalResult(text: string, language: string, confidence: number, idPrefix: string, source: Extract<MeaningSource, 'audio' | 'lyrics'>): GroundingResult {
  const motifs: Motif[] = [];
  const cues: GroundedCue[] = [];
  for (const [kind, entries] of Object.entries(VOCAB) as [GroundableKind, readonly [RegExp, string][]][]) {
    for (const [pattern, label] of entries) {
      if (pattern.test(text)) {
        motifs.push({ id: `${idPrefix}-${kind}`, kind, label, attributes: [text], confidence, source });
        cues.push({ kind, canonical: label, sourceLanguage: normalizedLanguage(language), evidence: text, confidence });
        break;
      }
    }
  }
  const action = actionFromText(text);
  if (action) cues.push({ kind: 'action', canonical: action, sourceLanguage: normalizedLanguage(language), evidence: text, confidence });
  if (!motifs.length) motifs.push({ id: `${idPrefix}-symbol`, kind: 'symbol', label: text, attributes: [], confidence, source });
  return { motifs, action, cues };
}

function actionFromText(text: string): string | null {
  for (const [pattern, action] of ACTIONS) if (pattern.test(text)) return action;
  for (const [pattern, action] of JAPANESE_ACTIONS) if (pattern.test(text)) return action;
  return null;
}

const lexicalAdapter: GroundingAdapter = {
  id: 'bounded-lexical-en-ja-v1',
  supports: (language) => boundedLanguages.has(normalizedLanguage(language)),
  ground: (text, language, confidence, idPrefix, source) => isScriptCompatible(language, text)
    ? lexicalResult(text, language, confidence, idPrefix, source)
    : symbolResult(text, language, confidence, idPrefix, source),
};

const adapters: GroundingAdapter[] = [lexicalAdapter];

/** Register a validated language adapter without coupling the director to its implementation. */
export function registerGroundingAdapter(adapter: GroundingAdapter): void {
  const existing = adapters.findIndex((candidate) => candidate.id === adapter.id);
  if (existing >= 0) adapters[existing] = adapter;
  else adapters.push(adapter);
}

function symbolResult(text: string, language: string, confidence: number, idPrefix: string, source: Extract<MeaningSource, 'audio' | 'lyrics'>): GroundingResult {
  return {
    motifs: [{ id: `${idPrefix}-symbol`, kind: 'symbol', label: text, attributes: [], confidence, source }],
    action: null,
    cues: [],
  };
}

function groundWithAdapter(text: string, language: string, confidence: number, idPrefix: string, source: Extract<MeaningSource, 'audio' | 'lyrics'>): GroundingResult {
  const adapter = adapters.find((candidate) => candidate.supports(language));
  if (!adapter) return symbolResult(text, language, confidence, idPrefix, source);
  return adapter.ground(text, language, confidence, idPrefix, source);
}

/** Ground only bounded, directly recognizable cues; unknown text remains a symbol. */
export function groundMotifs(
  text: string,
  language: string,
  confidence: number,
  idPrefix: string,
  source: Extract<MeaningSource, 'audio' | 'lyrics'>,
): Motif[] {
  return groundWithAdapter(text, language, confidence, idPrefix, source).motifs;
}

export function groundedAction(text: string, language = 'und'): string | null {
  return groundWithAdapter(text, language, 1, 'action-probe', 'audio').action;
}

export function hasGroundedCue(text: string, language = 'und'): boolean {
  const result = groundWithAdapter(text, language, 1, 'cue-probe', 'audio');
  return result.motifs.some((motif) => motif.kind !== 'symbol') || result.action !== null;
}
