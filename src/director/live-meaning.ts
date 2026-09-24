import type { LiveMeaningState } from './live-accumulator';
import type { SongMeaning } from './semantic';

/** Low-risk cue from current ASR; it cannot create or replace world entities. */
export interface ProvisionalPerceptualCue {
  behavior: string[];
  materiality: string[];
  motion: string[];
  lighting: string[];
  confidence: number;
}

export interface LiveEvidenceSummary {
  committed: number;
  groundedMotifs: number;
  actionOnly: number;
  symbolsOnly: number;
  abstained: boolean;
}

/**
 * Classify committed ASR without exposing transcript text. This is telemetry,
 * not a second promotion path: only the existing bounded vocabulary can make
 * a phrase grounded.
 */
export function liveEvidenceSummary(state: LiveMeaningState): LiveEvidenceSummary {
  const committed = state.committed.filter((item) => item.status === 'committed');
  let groundedMotifs = 0;
  let actionOnly = 0;
  let symbolsOnly = 0;
  for (const item of committed) {
    const grounded = extractMotifs(item.text, item.language, item.confidence, 0, item.id)
      .some((motif) => motif.kind !== 'symbol');
    if (grounded) groundedMotifs++;
    else if (actionFor(item.text, item.language)) actionOnly++;
    else symbolsOnly++;
  }
  return {
    committed: committed.length,
    groundedMotifs,
    actionOnly,
    symbolsOnly,
    abstained: committed.length > 0 && groundedMotifs === 0,
  };
}

export function perceptualCueFromLive(state: LiveMeaningState): ProvisionalPerceptualCue | null {
  const candidates = state.provisional
    .filter((item) => item.status === 'provisional' && item.confidence >= 0.6)
    .slice(-4);
  if (!candidates.length) return null;
  const text = candidates.map((item) => item.text).join(' ');
  const action = actionFor(text, candidates[0]!.language);
  const weather = /\b(rain|rainy|snow|wind|fog|mist|fire|wave|water)\b/iu.test(text)
    || /雨|雪|風|霧|煙|火|波|水/u.test(text);
  if (!action && !weather) return null;
  const behavior = action === 'walks through the environment' || action === 'runs through the environment'
    ? ['traveling', 'rhythmic', 'forward-pulling']
    : action === 'moves rhythmically' ? ['gathering', 'pulsing', 'expressive']
      : action === 'waits in place' ? ['suspended', 'gathered', 'restrained']
        : action === 'converges with another form' ? ['gathering', 'reaching', 'converging']
          : ['drifting', 'revealing', 'becoming'];
  return {
    behavior,
    materiality: weather ? ['wet', 'atmospheric'] : [],
    motion: action === 'runs through the environment' ? ['accelerating', 'urgent'] : ['flowing', 'responsive'],
    lighting: weather ? ['diffuse', 'reflective'] : [],
    confidence: Math.max(...candidates.map((item) => item.confidence)),
  };
}

/** Promote only accumulator-approved ASR phrases into the normal meaning contract. */
export function meaningFromLive(state: LiveMeaningState, revision: number, sectionIndex: number): SongMeaning | null {
  const committed = state.committed.filter((item) => item.status === 'committed');
  if (!committed.length) return null;
  const motifs = committed.slice(-4).flatMap((item, index) => extractMotifs(item.text, item.language, item.confidence, index, item.id));
  const confidence = committed.reduce((sum, item) => sum + item.confidence, 0) / committed.length;
  const extractedAction = committed.map((item) => actionFor(item.text, item.language)).find(Boolean);
  const action = extractedAction ?? 'the vocal motif moves through the frame';
  const hasGroundedMotif = motifs.some((motif) => motif.kind !== 'symbol');
  return {
    revision,
    thesis: 'meaning discovered from committed live audio evidence',
    language: committed[0]!.language,
    // A committed ASR phrase is evidence that sound was heard, not proof that
    // its content was grounded. Keep action/perceptual information available,
    // but require at least one recognized motif before compiling a literal
    // semantic scene or persistent world entity.
    abstained: !hasGroundedMotif,
    motifs,
    relations: [],
    sections: [{
      index: sectionIndex,
      startSec: Math.min(...committed.map((item) => item.startSec)),
      action,
      activeMotifs: motifs.map((motif) => motif.id),
      affect: [],
      confidence,
    }],
    evidence: committed.map((item) => ({
      source: 'audio' as const,
      text: item.text,
      confidence: item.confidence,
      startSec: item.startSec,
      endSec: item.endSec,
    })),
  };
}

type ExtractedKind = 'person' | 'place' | 'object' | 'force' | 'texture';

const VOCAB: Record<ExtractedKind, readonly [RegExp, string][]> = {
  person: [[/\b(woman|girl|man|boy|person|child|mother|father|lover)\b/iu, 'person'], [/彼女|彼|女性|少女|男性|少年|子供|子ども|母|父|恋人/u, 'person']],
  place: [[/\b(station|platform|city|street|road|room|home|house|forest|garden|river|sea|mountain|bridge|school|field|night)\b/iu, 'place'], [/駅|ホーム|街|町|通り|道|部屋|家|森|庭|川|海|山|橋|学校|野原|夜/u, 'place']],
  object: [[/\b(train|car|door|window|coat|scarf|suitcase|umbrella|flower|phone|mirror|ring|shoe|bird|dog|cat)\b/iu, 'object'], [/電車|列車|車|扉|ドア|窓|コート|マフラー|鞄|かばん|傘|花|電話|鏡|指輪|靴|鳥|犬|猫/u, 'object']],
  force: [[/\b(rain|snow|wind|fire|light|rainy|thunder|wave|sun|moon|star|darkness|dawn)\b/iu, 'force'], [/雨|雪|風|火|光|雷|波|太陽|月|星|闇|夜明け|朝焼け/u, 'force']],
  texture: [[/\b(fog|smoke|mist|water|ice|dust|glass|stone)\b/iu, 'texture'], [/霧|煙|水|氷|埃|ほこり|ガラス|石/u, 'texture']],
};

function extractMotifs(text: string, language: string, confidence: number, index: number, sourceId: string): SongMeaning['motifs'] {
  const motifs: SongMeaning['motifs'] = [];
  for (const [kind, entries] of Object.entries(VOCAB) as [ExtractedKind, readonly [RegExp, string][]][]) {
    for (const [pattern, label] of entries) {
      if (pattern.test(text)) {
        motifs.push({
          id: `live-${index}-${sourceId}-${kind}`,
          kind,
          label,
          attributes: [text],
          confidence,
          source: 'audio',
        });
        break;
      }
    }
  }
  if (motifs.length) return motifs;
  return [{
    id: `live-${index}-${sourceId}-symbol`,
    kind: 'symbol',
    label: text,
    attributes: [],
    confidence,
    source: 'audio',
  }];
}

function actionFor(text: string, _language: string): string | null {
  if (/\b(walk|walking|walks)\b/iu.test(text) || /歩く|歩いて|歩き/u.test(text)) return 'walks through the environment';
  if (/\b(run|running|runs)\b/iu.test(text) || /走る|走って|走り/u.test(text)) return 'runs through the environment';
  if (/\b(stand|standing|stands|wait|waiting)\b/iu.test(text) || /待つ|立つ|立って/u.test(text)) return 'waits in place';
  if (/\b(come|approach|arrive|enter)\b/iu.test(text) || /近づく|来る|入る/u.test(text)) return 'approaches a nearby place';
  if (/\b(leave|depart|return)\b/iu.test(text) || /去る|帰る|戻る/u.test(text)) return 'leaves or returns';
  if (/\b(dance|dancing|dances)\b/iu.test(text) || /踊る|踊って|踊り/u.test(text)) return 'moves rhythmically';
  if (/\b(look|see|watch|gaze)\b/iu.test(text) || /見る|見て|見える|眺める/u.test(text)) return 'looks toward the scene';
  if (/\b(cry|crying|laugh|laughing)\b/iu.test(text) || /泣く|泣いて|笑う|笑って/u.test(text)) return 'expresses an emotional change';
  if (/\b(fall|falling|rise|rising)\b/iu.test(text) || /落ちる|落ちて|昇る|上がる/u.test(text)) return 'changes vertical position';
  if (/\b(sway|swaying|sways|flow|flowing|flows|drift|drifting|drifts|float|floating)\b/iu.test(text)
    || /揺れる|揺れて|揺らぐ|流れる|流れて|漂う|漂って/u.test(text)) return 'moves with a flowing motion';
  if (/\b(gather|gathering|gathers|meet|meeting|meets|converge|converging|cross|crossing|crosses)\b/iu.test(text)
    || /集まる|集まって|出会う|出会って|交差する|交差して/u.test(text)) return 'converges with another form';
  if (/\b(open|opening|opens|close|closing|closes|unfold|unfolding)\b/iu.test(text)
    || /開く|開いて|閉じる|閉じて|ほどける|ほどけて/u.test(text)) return 'reveals or conceals space';
  return null;
}

/**
 * Evidence gate helper shared with the rolling ASR accumulator. A Japanese
 * phrase may only use the shorter two-window confirmation path when it
 * contains a vocabulary/action cue that this compiler can ground; unknown
 * lyrics still require the normal three observations.
 */
export function hasRecognizedLiveCue(text: string): boolean {
  return Object.values(VOCAB).some((entries) => entries.some(([pattern]) => pattern.test(text)))
    || actionFor(text, 'ja') !== null;
}
