export type MotifKind = 'person' | 'place' | 'object' | 'force' | 'texture' | 'symbol';
export type MeaningSource = 'lyrics' | 'audio' | 'metadata' | 'inference';

export interface Evidence {
  source: MeaningSource;
  text: string;
  confidence: number;
  startSec?: number;
  endSec?: number;
}

export interface Motif {
  id: string;
  kind: MotifKind;
  label: string;
  attributes: string[];
  confidence: number;
  source: MeaningSource;
  aliases?: string[];
}

export interface Relation {
  subject: string;
  verb: string;
  object: string;
  confidence: number;
  source: MeaningSource;
}

export interface MeaningSection {
  index: number;
  startSec: number;
  endSec?: number;
  action: string;
  activeMotifs: string[];
  activeRelations?: string[];
  affect: string[];
  confidence: number;
}

export interface SongMeaning {
  revision: number;
  thesis: string | null;
  /** BCP 47 language tag of the evidence/labels, e.g. ja, ko, or es-MX. */
  language?: string;
  motifs: Motif[];
  relations: Relation[];
  sections: MeaningSection[];
  evidence: Evidence[];
  abstained: boolean;
}

export interface MotifLedgerEntry {
  motifId: string;
  anchor: string;
  relations: string[];
  continuity: number;
  reveal: number;
  lastSection: number;
}

export type SemanticShot = 'establish' | 'follow' | 'approach' | 'encounter' | 'fracture' | 'release';

export interface SemanticScene {
  shot: SemanticShot;
  subjects: string[];
  subjectIds: string[];
  relation: string | null;
  environment: string[];
  environmentIds: string[];
  action: string;
  camera: string;
  transition: 'hold' | 'reveal' | 'cut' | 'dissolve';
  prompt: string;
  meaningRevision: number;
  /** Language carried through from the manifest; rendering does not translate in the hot loop. */
  language: string;
  source: MeaningSource | 'none';
}

/** Stable world memory; only explicit meaning revisions may replace anchors. */
export class MotifLedger {
  #entries = new Map<string, MotifLedgerEntry>();

  update(meaning: SongMeaning, sectionIndex: number): void {
    const active = new Set(meaning.sections.find((s) => s.index === sectionIndex)?.activeMotifs ?? []);
    for (const motif of meaning.motifs) {
      const prior = this.#entries.get(motif.id);
      const anchor = prior?.anchor ?? [motif.label, ...motif.attributes].filter(Boolean).join(', ');
      this.#entries.set(motif.id, {
        motifId: motif.id,
        anchor,
        relations: prior?.relations ?? [],
        continuity: active.has(motif.id) ? Math.max(prior?.continuity ?? 0, motif.confidence) : (prior?.continuity ?? 0) * 0.9,
        reveal: active.has(motif.id) ? 1 : (prior?.reveal ?? 0),
        lastSection: active.has(motif.id) ? sectionIndex : (prior?.lastSection ?? sectionIndex),
      });
    }
  }

  entries(): MotifLedgerEntry[] {
    return [...this.#entries.values()];
  }
}

export function compileSemanticScene(meaning: SongMeaning, sectionIndex: number, look: string, ledger?: MotifLedger): SemanticScene | null {
  // Metadata can steer visual treatment, but it cannot establish what happens
  // in a song. Narrative realization requires timestampable lyric/transcript or
  // validated audio-language evidence in addition to the motif graph.
  const hasNarrativeEvidence = meaning.evidence.some((item) => item.source === 'lyrics' || item.source === 'audio');
  if (meaning.abstained || !meaning.motifs.length || !hasNarrativeEvidence) return null;
  ledger?.update(meaning, sectionIndex);
  const anchors = new Map(ledger?.entries().map((entry) => [entry.motifId, entry.anchor]));
  const section = meaning.sections.find((candidate) => candidate.index === sectionIndex) ?? meaning.sections[0];
  if (!section) return null;
  const active = new Set(section.activeMotifs);
  const motifs = meaning.motifs.filter((motif) => active.size === 0 || active.has(motif.id));
  // A symbol is retained as evidence, but it is not an observed entity.
  // Otherwise an ASR hallucination can become a persistent world object.
  const subjects = motifs.filter((motif) => motif.kind === 'person' || motif.kind === 'object').slice(0, 3);
  const environment = motifs.filter((motif) => motif.kind === 'place' || motif.kind === 'texture' || motif.kind === 'force').slice(0, 3);
  const relation = (meaning.relations.find((candidate) => subjects.some((subject) => subject.id === candidate.subject)) ?? null);
  const relationText = relation ? `${relation.subject} ${relation.verb} ${relation.object}` : null;
  const action = section.action || 'holds in place';
  const shot = shotFor(action);
  const source = motifs[0]?.source ?? 'inference';
  const renderMotif = (motif: Motif): string => anchors.get(motif.id) ?? [motif.label, ...motif.attributes].filter(Boolean).join(', ');
  const subjectText = subjects.map(renderMotif).join(' and ') || 'the central motif';
  const environmentText = environment.map(renderMotif).join(' and ');
  const prompt = [
    `Music-video shot: ${subjectText}${relationText ? ` as ${relationText}` : ''}.`,
    `Action: ${action}.`,
    environmentText ? `Setting: ${environmentText}.` : '',
    `Camera: ${cameraFor(shot)}.`,
    `Color and light: ${look}.`,
    'Cinematic frame with coherent subject identity and detailed lighting.',
  ].filter(Boolean).join(' ');
  return {
    shot, subjects: subjects.map((motif) => motif.label), subjectIds: subjects.map((motif) => motif.id), relation: relationText,
    environment: environment.map((motif) => motif.label), environmentIds: environment.map((motif) => motif.id), action,
    camera: cameraFor(shot), transition: shot === 'establish' ? 'reveal' : 'dissolve',
    prompt, meaningRevision: meaning.revision, language: meaning.language ?? 'und', source,
  };
}

function shotFor(action: string): SemanticShot {
  const text = action.toLowerCase();
  if (/run|follow|cross|chase|travel/.test(text)) return 'follow';
  if (/approach|near|toward|enter/.test(text)) return 'approach';
  if (/meet|encounter|find|confront/.test(text)) return 'encounter';
  if (/break|fracture|fall|separate|collapse/.test(text)) return 'fracture';
  if (/dissolve|release|leave|fade|return/.test(text)) return 'release';
  return 'establish';
}

function cameraFor(shot: SemanticShot): string {
  return ({ establish: 'wide establishing view', follow: 'distant tracking view', approach: 'slow forward approach', encounter: 'orbiting reveal', fracture: 'unstable close tracking', release: 'wide retreat' } satisfies Record<SemanticShot, string>)[shot];
}
