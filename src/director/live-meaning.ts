import type { LiveMeaningState } from './live-accumulator';
import type { SongMeaning } from './semantic';

/** Promote only accumulator-approved ASR phrases into the normal meaning contract. */
export function meaningFromLive(state: LiveMeaningState, revision: number, sectionIndex: number): SongMeaning | null {
  const committed = state.committed.filter((item) => item.status === 'committed');
  if (!committed.length) return null;
  const motifs = committed.slice(-4).flatMap((item, index) => extractMotifs(item.text, item.language, item.confidence, index, item.id));
  const confidence = committed.reduce((sum, item) => sum + item.confidence, 0) / committed.length;
  const action = committed.map((item) => actionFor(item.text, item.language)).find(Boolean) ?? 'the vocal motif moves through the frame';
  return {
    revision,
    thesis: 'meaning discovered from committed live audio evidence',
    language: committed[0]!.language,
    abstained: false,
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
  person: [[/\b(woman|girl|man|boy|person)\b/iu, 'person'], [/彼女|女性|少女|男性|少年/u, 'person']],
  place: [[/\b(station|platform|city|street|room|home)\b/iu, 'place'], [/駅|ホーム|街|通り|部屋/u, 'place']],
  object: [[/\b(train|car|door|window|coat|scarf|suitcase)\b/iu, 'object'], [/電車|列車|車|扉|窓|コート|マフラー|鞄/u, 'object']],
  force: [[/\b(rain|snow|wind|fire|light|rainy)\b/iu, 'force'], [/雨|雪|風|火|光/u, 'force']],
  texture: [[/\b(fog|smoke)\b/iu, 'texture'], [/霧|煙/u, 'texture']],
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
  return null;
}
