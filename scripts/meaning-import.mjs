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
const motifs = lines.slice(0, 8).map((line, index) => ({ id: `lyric-line-${index}`, kind: 'symbol', label: line.text, attributes: [], confidence, source: 'lyrics' }));
const manifest = {
  revision: 1, thesis: 'meaning imported from timed lyric evidence', abstained: false,
  motifs, relations: [], language: value('--language', 'und'),
  sections: [{ index: 0, startSec: lines[0].startSec, endSec: lines.at(-1).endSec, action: 'lyric evidence unfolds through the frame', activeMotifs: motifs.map((motif) => motif.id), affect: [], confidence }],
  evidence: lines.map((line) => ({ source: 'lyrics', text: line.text, confidence, startSec: line.startSec, endSec: line.endSec })),
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Imported ${lines.length} timed lyric lines -> ${output}`);
