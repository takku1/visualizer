import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 's1-evaluate-logs-'));
const file = path.join(root, 'session.jsonl');
const sample = (language, groundedMotifs, envelope = {}) => JSON.stringify({
  ...envelope,
  _telemetry: true,
  meaning: {
    language,
    configuredLanguage: language,
    updates: 2,
    committed: 1,
    evidence: { groundedMotifs, actionOnly: 0, symbolsOnly: 0, abstained: groundedMotifs === 0 },
  },
});

try {
  fs.writeFileSync(file, `${sample('en', 1)}\n${sample('ja', 1)}\n`);
  const pass = spawnSync(process.execPath, ['scripts/evaluate-logs.mjs', file, '--require-languages=en,ja', '--json'], { encoding: 'utf8' });
  assert.equal(pass.status, 0);
  const passSummary = JSON.parse(pass.stdout);
  assert.equal(passSummary.liveMeaning.languageValidation, 'pass');
  assert.equal(passSummary.liveMeaning.languageEvidence.en.status, 'pass');
  assert.equal(passSummary.liveMeaning.languageEvidence.ja.status, 'pass');

  fs.writeFileSync(file, `${sample('en', 1, { kind: 'telemetry', v: 1 })}\n${sample('ja', 1, { kind: 'telemetry', v: 1 })}\n`);
  const enveloped = spawnSync(process.execPath, ['scripts/evaluate-logs.mjs', file, '--require-languages=en,ja', '--json'], { encoding: 'utf8' });
  assert.equal(enveloped.status, 0);
  assert.equal(JSON.parse(enveloped.stdout).liveMeaning.languageValidation, 'pass');

  fs.writeFileSync(file, `${sample('ja', 1)}\n`);
  const incomplete = spawnSync(process.execPath, ['scripts/evaluate-logs.mjs', file, '--require-languages=en,ja', '--json'], { encoding: 'utf8' });
  assert.equal(incomplete.status, 2);
  const incompleteSummary = JSON.parse(incomplete.stdout);
  assert.equal(incompleteSummary.liveMeaning.languageValidation, 'unverified');
  assert.equal(incompleteSummary.liveMeaning.languageEvidence.en.status, 'unverified');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('live language log gate contract ok');
