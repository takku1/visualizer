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
const contract = JSON.parse(fs.readFileSync(new URL('../src/director/grounding-contract.json', import.meta.url), 'utf8'));
const VOCAB = contract.motifs.map(({ kind, english, japanese }) => [
  kind, new RegExp(english, 'iu'), new RegExp(japanese, 'u'),
]);
const ACTIONS = contract.actions.map(({ english, canonical }) => [new RegExp(english, 'iu'), canonical]);
const JAPANESE_ACTIONS = contract.actions.map(({ japanese, canonical }) => [new RegExp(japanese, 'u'), canonical]);
const language = value('--language', 'und').trim().toLowerCase().split(/[-_]/, 1)[0] || 'und';
const boundedLanguage = new Set(contract.languages);
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
  motifs: allMotifs, relations: [], language,
  sections,
  evidence: lines.map((line) => ({ source: 'lyrics', text: line.text, confidence, startSec: line.startSec, endSec: line.endSec })),
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Imported ${lines.length} timed lyric lines -> ${output} (${grounded ? 'bounded motifs/actions' : 'symbol-only abstention'})`);

function boundedMotifs(value, index) {
  if (!boundedLanguage.has(language)) return [];
  return VOCAB.flatMap(([kind, english, japanese]) => {
    if (!english.test(value) && !japanese.test(value)) return [];
    return [{ id: `lyric-line-${index}-${kind}`, kind, label: kind, attributes: [value], confidence, source: 'lyrics' }];
  });
}

function boundedAction(value) {
  if (!boundedLanguage.has(language)) return null;
  for (const [pattern, action] of ACTIONS) if (pattern.test(value)) return action;
  for (const [pattern, action] of JAPANESE_ACTIONS) if (pattern.test(value)) return action;
  return null;
}
