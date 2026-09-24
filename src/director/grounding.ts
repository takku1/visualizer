import type { MeaningSource, Motif, MotifKind } from './semantic';

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

const VOCAB: Record<GroundableKind, readonly [RegExp, string][]> = {
  person: [[/\b(woman|girl|man|boy|person|child|mother|father|lover)\b/iu, 'person'], [/彼女|彼|女性|少女|男性|少年|子供|子ども|母|父|恋人|人|ひと|僕|ぼく|私|わたし|君|きみ|あなた|誰/u, 'person']],
  place: [[/\b(station|platform|city|street|road|room|home|house|forest|garden|river|sea|mountain|bridge|school|field|night)\b/iu, 'place'], [/駅|駅前|ホーム|街|町|通り|道|路地|部屋|家|森|庭|川|海|海辺|山|橋|学校|野原|夜|夜空|世界|場所/u, 'place']],
  object: [[/\b(train|car|door|window|coat|scarf|suitcase|umbrella|flower|phone|mirror|ring|shoe|bird|dog|cat|dream|heart|voice|song|letter)\b/iu, 'object'], [/電車|列車|車|扉|ドア|窓|コート|マフラー|鞄|かばん|傘|花|電話|鏡|指輪|靴|鳥|犬|猫|夢|心|声|歌|手紙|身体|体/u, 'object']],
  force: [[/\b(rain|snow|wind|fire|light|rainy|thunder|wave|sun|moon|star|darkness|dawn|love|tears|time)\b/iu, 'force'], [/雨|雪|風|火|光|雷|波|太陽|月|星|闇|夜明け|朝焼け|愛|恋|涙|時間|時/u, 'force']],
  texture: [[/\b(fog|smoke|mist|water|ice|dust|glass|stone|shadow|sky|world)\b/iu, 'texture'], [/霧|煙|水|氷|埃|ほこり|ガラス|石|影|空|世界|赤|青|白|色/u, 'texture']],
};

const ACTIONS: readonly [RegExp, string][] = [
  [/\b(walk|walking|walks)\b/iu, 'walks through the environment'],
  [/\b(run|running|runs)\b/iu, 'runs through the environment'],
  [/\b(stand|standing|stands|wait|waiting)\b/iu, 'waits in place'],
  [/\b(come|approach|arrive|enter)\b/iu, 'approaches a nearby place'],
  [/\b(leave|depart|return)\b/iu, 'leaves or returns'],
  [/\b(dance|dancing|dances)\b/iu, 'moves rhythmically'],
  [/\b(look|see|watch|gaze)\b/iu, 'looks toward the scene'],
  [/\b(cry|crying|laugh|laughing)\b/iu, 'expresses an emotional change'],
  [/\b(fall|falling|rise|rising)\b/iu, 'changes vertical position'],
  [/\b(sway|swaying|sways|flow|flowing|flows|drift|drifting|drifts|float|floating)\b/iu, 'moves with a flowing motion'],
  [/\b(gather|gathering|gathers|meet|meeting|meets|converge|converging|cross|crossing|crosses)\b/iu, 'converges with another form'],
  [/\b(open|opening|opens|close|closing|closes|unfold|unfolding)\b/iu, 'reveals or conceals space'],
];

const JAPANESE_ACTIONS: readonly [RegExp, string][] = [
  [/歩く|歩いて|歩き|歩み|歩いてる|歩き出す|進む|進んで|進んでいく/u, 'walks through the environment'],
  [/走る|走って|走り|走ってる|走り出す|駆ける|駆けて/u, 'runs through the environment'],
  [/待つ|待って|待ってる|立つ|立って|佇む|佇んで|待ち続ける/u, 'waits in place'],
  [/近づく|近づいて|近づいてくる|来る|来て|入る|入って|向かう|辿り着く/u, 'approaches a nearby place'],
  [/去る|去って|去っていく|帰る|帰って|戻る|戻って|離れる|消える/u, 'leaves or returns'],
  [/踊る|踊って|踊ってる|踊り|舞う|舞って/u, 'moves rhythmically'],
  [/見る|見て|見ている|見える|眺める|見つめる|見つめている|見上げる/u, 'looks toward the scene'],
  [/泣く|泣いて|泣いている|笑う|笑って|微笑む|叫ぶ|叫んで/u, 'expresses an emotional change'],
  [/落ちる|落ちて|沈む|昇る|上がる|舞い上がる/u, 'changes vertical position'],
  [/揺れる|揺れて|揺らぐ|揺らいで|揺らめく|流れる|流れて|流れていく|漂う|漂って|浮かぶ|浮かんで|たゆたう/u, 'moves with a flowing motion'],
  [/集まる|集まって|集う|出会う|出会って|交差する|交差して|重なる|重なって|寄り添う|繋がる|つながる/u, 'converges with another form'],
  [/開く|開いて|閉じる|閉じて|ほどける|ほどけて|ひらく|ひらいて|解ける|解けて/u, 'reveals or conceals space'],
];

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
  supports: (language) => ['en', 'ja', 'und', 'auto'].includes(normalizedLanguage(language)),
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
