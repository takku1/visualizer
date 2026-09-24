import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 's1-meaning-import-'));
try {
  const lrc = path.join(root, 'song.lrc');
  const output = path.join(root, 'meaning', 'song.json');
  fs.writeFileSync(lrc, '[00:01.00]雨の駅で彼女が歩いている\n[00:04.00]the woman walks across the street\n[00:07.00]la la la\n');
  execFileSync(process.execPath, ['scripts/meaning-import.mjs', '--lrc', lrc, '--track', 'fixture-track', '--out', output, '--language', 'ja'], { stdio: 'pipe' });
  const manifest = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(manifest.abstained, false);
  assert.ok(manifest.motifs.some((motif) => motif.kind === 'person'));
  assert.ok(manifest.motifs.some((motif) => motif.kind === 'place'));
  assert.ok(manifest.motifs.some((motif) => motif.kind === 'force'));
  assert.equal(manifest.sections[0].action, 'walks through the environment');
  assert.equal(manifest.sections[1].action, 'walks through the environment');
  assert.ok(manifest.motifs.some((motif) => motif.kind === 'symbol' && motif.label === 'la la la'));
  assert.ok(manifest.sections[2].activeMotifs.includes('lyric-line-2-symbol'));

  const symbolsOutput = path.join(root, 'symbols.json');
  execFileSync(process.execPath, ['scripts/meaning-import.mjs', '--lrc', lrc, '--track', 'fixture-track', '--out', symbolsOutput, '--symbols-only'], { stdio: 'pipe' });
  const symbols = JSON.parse(fs.readFileSync(symbolsOutput, 'utf8'));
  assert.equal(symbols.abstained, true);
  assert.ok(symbols.motifs.every((motif) => motif.kind === 'symbol'));
  console.log('timed meaning import grounding contract ok');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
