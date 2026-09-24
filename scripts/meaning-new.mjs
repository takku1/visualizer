import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function value(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const trackId = value('track-id');
const title = value('title');
const artist = value('artist');
const language = value('language', 'und');
const dir = value('out', 'meaning');

if (!trackId && (!title || !artist)) {
  console.error('Usage: npm run meaning:new -- --track-id <id> [--title <title> --artist <artist>] [--language <BCP47>]');
  process.exit(2);
}

const identity = trackId || `${title}\0${artist}`;
const key = createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 32);
const manifest = {
  revision: 1,
  language,
  thesis: null,
  abstained: true,
  motifs: [],
  relations: [],
  sections: [],
  evidence: [],
};

mkdirSync(dir, { recursive: true });
const output = join(dir, `${key}.json`);
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Created ${output}`);
console.log('Add verified lyric/transcript evidence, motifs, relations, and sections; then set abstained to false.');
