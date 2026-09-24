import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const value = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const input = value('--lrc');
const output = value('--out');
const trackId = value('--track');
if (!input || !output || !trackId) {
  console.error('Usage: npm run meaning:import -- --lrc song.lrc --track <track-id> --out meaning/<track-id>.json');
  process.exit(1);
}

const text = fs.readFileSync(input, 'utf8');
const lines = [...text.split(/\r?\n/).flatMap((raw) => {
  const stamps = [...raw.matchAll(/\[(\d+):(\d{2}(?:\.\d+)?)\]/g)];
  const lyric = raw.replace(/\[[^\]]+\]/g, '').trim();
  return lyric && stamps.length ? stamps.map((stamp) => ({ startSec: Number(stamp[1]) * 60 + Number(stamp[2]), text: lyric })) : [];
})].sort((a, b) => a.startSec - b.startSec).map((line, index, all) => ({ ...line, endSec: all[index + 1]?.startSec }));
if (!lines.length) throw new Error('No timed lyric lines found');
const confidence = 0.9;

// This is deliberately a small evidence-grounding vocabulary, not a
// translation or narrative model. Exact lyric text remains the evidence;
// recognized labels only expose safe renderer handles. Unknown text remains a
// symbol so an importer cannot silently invent a world.
const VOCAB = [
  ['person', /\b(woman|girl|man|boy|person|child|mother|father|lover)\b/iu, /彼女|彼|女性|少女|男性|少年|子供|子ども|母|父|恋人|人|ひと|僕|ぼく|私|わたし|君|きみ|あなた|誰/u],
  ['place', /\b(station|platform|city|street|road|room|home|house|forest|garden|river|sea|mountain|bridge|school|field|night)\b/iu, /駅|駅前|ホーム|街|町|通り|道|路地|部屋|家|森|庭|川|海|海辺|山|橋|学校|野原|夜|夜空|世界|場所/u],
  ['object', /\b(train|car|door|window|coat|scarf|suitcase|umbrella|flower|phone|mirror|ring|shoe|bird|dog|cat|dream|heart|voice|song|letter)\b/iu, /電車|列車|車|扉|ドア|窓|コート|マフラー|鞄|かばん|傘|花|電話|鏡|指輪|靴|鳥|犬|猫|夢|心|声|歌|手紙|身体|体/u],
  ['force', /\b(rain|snow|wind|fire|light|rainy|thunder|wave|sun|moon|star|darkness|dawn|love|tears|time)\b/iu, /雨|雪|風|火|光|雷|波|太陽|月|星|闇|夜明け|朝焼け|愛|恋|涙|時間|時/u],
  ['texture', /\b(fog|smoke|mist|water|ice|dust|glass|stone|shadow|sky|world)\b/iu, /霧|煙|水|氷|埃|ほこり|ガラス|石|影|空|世界|赤|青|白|色/u],
];
const symbolsOnly = args.includes('--symbols-only');
const groundedLines = lines.map((line, index) => ({ ...line, index, motifs: symbolsOnly ? [] : boundedMotifs(line.text, index), action: symbolsOnly ? null : boundedAction(line.text) }));
const motifs = groundedLines.flatMap((line) => line.motifs);
const fallbackMotifs = groundedLines.filter((line) => line.index < 8)
  .filter((line) => line.motifs.length === 0)
  .map((line) => ({ id: `lyric-line-${line.index}-symbol`, kind: 'symbol', label: line.text, attributes: [], confidence, source: 'lyrics' }));
const allMotifs = [...motifs, ...fallbackMotifs];
const grounded = allMotifs.some((motif) => motif.kind !== 'symbol');
const sections = groundedLines.map((line) => ({
  index: line.index,
  startSec: line.startSec,
  endSec: line.endSec,
  action: line.action ?? 'lyric evidence unfolds through the frame',
  activeMotifs: [...line.motifs.map((motif) => motif.id), ...(!line.motifs.length && line.index < 8 ? [`lyric-line-${line.index}-symbol`] : [])],
  affect: [],
  confidence,
}));
const manifest = {
  revision: 1, thesis: 'meaning imported from timed lyric evidence', abstained: !grounded,
  motifs: allMotifs, relations: [], language: value('--language', 'und'),
  sections,
  evidence: lines.map((line) => ({ source: 'lyrics', text: line.text, confidence, startSec: line.startSec, endSec: line.endSec })),
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Imported ${lines.length} timed lyric lines -> ${output} (${grounded ? 'bounded motifs/actions' : 'symbol-only abstention'})`);

function boundedMotifs(value, index) {
  return VOCAB.flatMap(([kind, english, japanese]) => {
    if (!english.test(value) && !japanese.test(value)) return [];
    return [{ id: `lyric-line-${index}-${kind}`, kind, label: kind, attributes: [value], confidence, source: 'lyrics' }];
  });
}

function boundedAction(value) {
  if (/\b(walk|walking|walks)\b/iu.test(value) || /歩く|歩いて|歩き|歩み|歩いてる|歩き出す|進む|進んで|進んでいく/u.test(value)) return 'walks through the environment';
  if (/\b(run|running|runs)\b/iu.test(value) || /走る|走って|走り|走ってる|走り出す|駆ける|駆けて/u.test(value)) return 'runs through the environment';
  if (/\b(stand|standing|stands|wait|waiting)\b/iu.test(value) || /待つ|待って|待ってる|立つ|立って|佇む|佇んで|待ち続ける/u.test(value)) return 'waits in place';
  if (/\b(come|approach|arrive|enter)\b/iu.test(value) || /近づく|近づいて|近づいてくる|来る|来て|入る|入って|向かう|辿り着く/u.test(value)) return 'approaches a nearby place';
  if (/\b(leave|depart|return)\b/iu.test(value) || /去る|去って|去っていく|帰る|帰って|戻る|戻って|離れる|消える/u.test(value)) return 'leaves or returns';
  if (/\b(dance|dancing|dances)\b/iu.test(value) || /踊る|踊って|踊ってる|踊り|舞う|舞って/u.test(value)) return 'moves rhythmically';
  if (/\b(look|see|watch|gaze)\b/iu.test(value) || /見る|見て|見ている|見える|眺める|見つめる|見つめている|見上げる/u.test(value)) return 'looks toward the scene';
  if (/\b(cry|crying|laugh|laughing)\b/iu.test(value) || /泣く|泣いて|笑う|笑って|叫ぶ|叫んで/u.test(value)) return 'expresses an emotional change';
  if (/\b(fall|falling|rise|rising)\b/iu.test(value) || /落ちる|落ちて|昇る|上がる/u.test(value)) return 'changes vertical position';
  if (/\b(gather|gathering|gathers|meet|meeting|meets|converge|converging|cross|crossing|crosses)\b/iu.test(value)
    || /集まる|集まって|出会う|出会って|交差する|交差して|重なる|重なって|寄り添う/u.test(value)) return 'converges with another form';
  if (/\b(sway|swaying|sways|flow|flowing|flows|drift|drifting|drifts|float|floating)\b/iu.test(value) || /揺れる|揺れて|揺らぐ|揺らいで|流れる|流れて|漂う|漂って|浮かぶ|浮かんで/u.test(value)) return 'moves with a flowing motion';
  if (/\b(open|opening|opens|close|closing|closes|unfold|unfolding)\b/iu.test(value) || /開く|開いて|閉じる|閉じて|ほどける|ほどけて|ひらく|ひらいて|解ける|解けて/u.test(value)) return 'reveals or conceals space';
  return null;
}
