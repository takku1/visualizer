import type { MeaningSource, Motif, MotifKind } from './semantic';

type GroundableKind = Exclude<MotifKind, 'symbol'>;

const VOCAB: Record<GroundableKind, readonly [RegExp, string][]> = {
  person: [[/\b(woman|girl|man|boy|person|child|mother|father|lover)\b/iu, 'person'], [/彼女|彼|女性|少女|男性|少年|子供|子ども|母|父|恋人/u, 'person']],
  place: [[/\b(station|platform|city|street|road|room|home|house|forest|garden|river|sea|mountain|bridge|school|field|night)\b/iu, 'place'], [/駅|ホーム|街|町|通り|道|部屋|家|森|庭|川|海|山|橋|学校|野原|夜/u, 'place']],
  object: [[/\b(train|car|door|window|coat|scarf|suitcase|umbrella|flower|phone|mirror|ring|shoe|bird|dog|cat|dream|heart|voice|song|letter)\b/iu, 'object'], [/電車|列車|車|扉|ドア|窓|コート|マフラー|鞄|かばん|傘|花|電話|鏡|指輪|靴|鳥|犬|猫|夢|心|声|歌|手紙/u, 'object']],
  force: [[/\b(rain|snow|wind|fire|light|rainy|thunder|wave|sun|moon|star|darkness|dawn|love|tears|time)\b/iu, 'force'], [/雨|雪|風|火|光|雷|波|太陽|月|星|闇|夜明け|朝焼け|愛|恋|涙|時間|時/u, 'force']],
  texture: [[/\b(fog|smoke|mist|water|ice|dust|glass|stone|shadow|sky|world)\b/iu, 'texture'], [/霧|煙|水|氷|埃|ほこり|ガラス|石|影|空|世界/u, 'texture']],
};

/** Ground only bounded, directly recognizable cues; unknown text remains a symbol. */
export function groundMotifs(
  text: string,
  language: string,
  confidence: number,
  idPrefix: string,
  source: Extract<MeaningSource, 'audio' | 'lyrics'>,
): Motif[] {
  const motifs: Motif[] = [];
  for (const [kind, entries] of Object.entries(VOCAB) as [GroundableKind, readonly [RegExp, string][]][]) {
    for (const [pattern, label] of entries) {
      if (pattern.test(text)) {
        motifs.push({ id: `${idPrefix}-${kind}`, kind, label, attributes: [text], confidence, source });
        break;
      }
    }
  }
  if (motifs.length) return motifs;
  return [{ id: `${idPrefix}-symbol`, kind: 'symbol', label: text, attributes: [], confidence, source }];
}

export function groundedAction(text: string): string | null {
  if (/\b(walk|walking|walks)\b/iu.test(text) || /歩く|歩いて|歩き|進む|進んで/u.test(text)) return 'walks through the environment';
  if (/\b(run|running|runs)\b/iu.test(text) || /走る|走って|走り|駆ける|駆けて/u.test(text)) return 'runs through the environment';
  if (/\b(stand|standing|stands|wait|waiting)\b/iu.test(text) || /待つ|待って|立つ|立って|佇む|佇んで/u.test(text)) return 'waits in place';
  if (/\b(come|approach|arrive|enter)\b/iu.test(text) || /近づく|近づいて|来る|来て|入る|入って|向かう/u.test(text)) return 'approaches a nearby place';
  if (/\b(leave|depart|return)\b/iu.test(text) || /去る|去って|帰る|帰って|戻る|戻って|離れる/u.test(text)) return 'leaves or returns';
  if (/\b(dance|dancing|dances)\b/iu.test(text) || /踊る|踊って|踊り/u.test(text)) return 'moves rhythmically';
  if (/\b(look|see|watch|gaze)\b/iu.test(text) || /見る|見て|見える|眺める|見つめる/u.test(text)) return 'looks toward the scene';
  if (/\b(cry|crying|laugh|laughing)\b/iu.test(text) || /泣く|泣いて|笑う|笑って|叫ぶ|叫んで/u.test(text)) return 'expresses an emotional change';
  if (/\b(fall|falling|rise|rising)\b/iu.test(text) || /落ちる|落ちて|昇る|上がる/u.test(text)) return 'changes vertical position';
  if (/\b(sway|swaying|sways|flow|flowing|flows|drift|drifting|drifts|float|floating)\b/iu.test(text)
    || /揺れる|揺れて|揺らぐ|揺らいで|流れる|流れて|漂う|漂って|浮かぶ|浮かんで/u.test(text)) return 'moves with a flowing motion';
  if (/\b(gather|gathering|gathers|meet|meeting|meets|converge|converging|cross|crossing|crosses)\b/iu.test(text)
    || /集まる|集まって|出会う|出会って|交差する|交差して|重なる|重なって|寄り添う/u.test(text)) return 'converges with another form';
  if (/\b(open|opening|opens|close|closing|closes|unfold|unfolding)\b/iu.test(text)
    || /開く|開いて|閉じる|閉じて|ほどける|ほどけて|ひらく|ひらいて|解ける|解けて/u.test(text)) return 'reveals or conceals space';
  return null;
}

export function hasGroundedCue(text: string): boolean {
  return Object.values(VOCAB).some((entries) => entries.some(([pattern]) => pattern.test(text)))
    || groundedAction(text) !== null;
}
