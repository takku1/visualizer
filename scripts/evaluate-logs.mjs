#!/usr/bin/env node
import fs from 'node:fs';

const file = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
if (!file || process.argv.includes('--help')) {
  console.log('Usage: node scripts/evaluate-logs.mjs <session.jsonl> [--json]');
  process.exit(file ? 0 : 1);
}

const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line, index) => {
  try { return [JSON.parse(line)]; } catch { console.warn(`Skipping malformed JSONL line ${index + 1}`); return []; }
});
const checkpoints = rows.filter((row) => row._checkpoint);
const decisions = rows.filter((row) => row.scene && row.system1);
const receipts = checkpoints.map((row) => row.timing).filter(Boolean);
const diffs = checkpoints.map((row) => row.worldDiff).filter(Boolean);
const changes = { identity: 0, action: 0, environment: 0, look: 0, camera: 0 };
let previous = null;
for (const row of checkpoints) {
  const current = row.fingerprint;
  if (!current) continue;
  if (previous) for (const key of Object.keys(changes)) if (previous[key] !== current[key]) changes[key]++;
  previous = current;
}
const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const summary = {
  file,
  checkpoints: checkpoints.length,
  decisions: decisions.length,
  sceneSources: Object.fromEntries([...new Set(decisions.map((row) => row.scene.source))].map((source) => [source, decisions.filter((row) => row.scene.source === source).length])),
  fingerprintChanges: changes,
  timing: {
    receipts: receipts.length,
    fallbackCount: receipts.filter((receipt) => receipt.fallbackUsed).length,
    fallbackRate: receipts.length ? receipts.filter((receipt) => receipt.fallbackUsed).length / receipts.length : null,
    averagePhaseError: avg(receipts.map((receipt) => receipt.phaseError).filter((value) => typeof value === 'number')),
    sources: Object.fromEntries([...new Set(receipts.map((receipt) => receipt.source))].map((source) => [source, receipts.filter((receipt) => receipt.source === source).length])),
  },
  worldTransitions: {
    receipts: diffs.length,
    identityBreaks: diffs.filter((diff) => diff.identityBreak).length,
    keyframeRequired: diffs.filter((diff) => diff.requiresKeyframe).length,
    averageKeptEntities: avg(diffs.map((diff) => diff.keep).filter((value) => typeof value === 'number')),
    averageAddedEntities: avg(diffs.map((diff) => diff.add).filter((value) => typeof value === 'number')),
    averageRemovedEntities: avg(diffs.map((diff) => diff.remove).filter((value) => typeof value === 'number')),
  },
  evidence: {
    semanticDecisions: decisions.filter((row) => row.scene.source === 'semantic-manifest').length,
    identityVerified: false,
    actionVerified: false,
    note: 'Fingerprint and timing telemetry are evaluated here; visual identity/action still require a human or model-backed evaluator.',
  },
};
console.log(process.argv.includes('--json') ? JSON.stringify(summary, null, 2) : [
  `Session: ${file}`,
  `Checkpoints: ${summary.checkpoints}; decisions: ${summary.decisions}`,
  `Scene sources: ${JSON.stringify(summary.sceneSources)}`,
  `Fingerprint changes: ${JSON.stringify(summary.fingerprintChanges)}`,
  `Timing receipts: ${summary.timing.receipts}; fallback rate: ${summary.timing.fallbackRate == null ? 'n/a' : `${(summary.timing.fallbackRate * 100).toFixed(1)}%`}`,
  `World transitions: ${summary.worldTransitions.receipts}; identity breaks: ${summary.worldTransitions.identityBreaks}; keyframes required: ${summary.worldTransitions.keyframeRequired}`,
  `Evidence-backed decisions: ${summary.evidence.semanticDecisions}; visual verification: deferred`,
].join('\n'));
