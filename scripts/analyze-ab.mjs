import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const logDir = 'logs';
const requested = process.argv.slice(2);
const requireReal = requested.includes('--require-real');
const inputPaths = requested.filter((value) => value !== '--require-real');
const paths = inputPaths.length
  ? inputPaths
  : (await readdir(logDir)).filter((name) => name.endsWith('.jsonl')).map((name) => join(logDir, name));

const dimensions = ['motion', 'palette', 'texture', 'geometry', 'symmetry', 'feedback'];
const report = [];
const allTracks = new Set();

for (const path of paths.sort()) {
  let lines;
  try {
    lines = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean);
  } catch {
    continue;
  }

  const rows = lines.map(parseLine).filter(Boolean);
  const decisions = rows.filter((row) => !row._telemetry && row.system1 && row.baseline);
  const telemetry = rows.filter((row) => row._telemetry && typeof row.fps === 'number');
  if (!decisions.length) continue;

  const divergence = Object.fromEntries(dimensions.map((dimension) => [
    dimension,
    decisions.filter((row) => row.system1[dimension]?.top !== row.baseline[dimension]?.top).length,
  ]));
  const latencies = decisions.map((row) => row.system1.latencyMs).filter(Number.isFinite);
  const fps = telemetry.map((row) => row.fps).filter(Number.isFinite);
  const tracks = new Set(decisions.map((row) => row.track?.id ?? `${row.track?.title ?? ''}\u0000${row.track?.artist ?? ''}`));
  for (const track of tracks) if (track !== '\u0000') allTracks.add(track);
  const learned = decisions.map((row) => row.perception?.learned).filter(Boolean);
  const learnedModels = [...new Set(learned.map((value) => `${value.model}@${value.version}`))].sort();

  report.push({
    file: path,
    decisions: decisions.length,
    captured: decisions.filter((row) => row.source?.capturing).length,
    structured: decisions.filter((row) => row.source?.hasStructure).length,
    metadata: decisions.filter((row) => row.track?.title || row.track?.artist).length,
    identity: decisions.filter((row) => row.identity?.trackKey).length,
    worldRevisioned: decisions.filter((row) => Number.isInteger(row.worldState?.revision)).length,
    learned: learned.length,
    learnedModels,
    tracks: tracks.size,
    divergence,
    latencyMs: summary(latencies),
    fps: summary(fps),
    telemetrySamples: telemetry.length,
    simNaN: telemetry.filter((row) => row.sim?.hasNaN).length,
  });
}

const totals = report.reduce((out, row) => {
  out.decisions += row.decisions;
  out.captured += row.captured;
  out.structured += row.structured;
  out.metadata += row.metadata;
  out.identity += row.identity;
  out.worldRevisioned += row.worldRevisioned;
  out.learned += row.learned;
  out.telemetrySamples += row.telemetrySamples;
  out.simNaN += row.simNaN;
  for (const dimension of dimensions) out.divergence[dimension] += row.divergence[dimension];
  return out;
}, {
  decisions: 0, captured: 0, structured: 0, metadata: 0, identity: 0, worldRevisioned: 0, learned: 0, telemetrySamples: 0, simNaN: 0,
  divergence: Object.fromEntries(dimensions.map((dimension) => [dimension, 0])),
});

const evidence = {
  capturedAudio: totals.captured > 0,
  multipleTracks: allTracks.size >= 2,
  metadata: totals.metadata > 0,
  structure: totals.structured > 0,
  learnedPerception: totals.learned > 0,
  identity: totals.identity > 0,
  worldRevision: totals.worldRevisioned > 0,
  baselineDivergence: Object.values(totals.divergence).some((count) => count > 0),
  stableSimulation: totals.simNaN === 0,
};
const output = { files: report.length, totals, evidence, realMusicPass: Object.values(evidence).every(Boolean), sessions: report };
console.log(JSON.stringify(output, null, 2));
if (requireReal && !output.realMusicPass) process.exitCode = 2;

function parseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function summary(values) {
  if (!values.length) return null;
  return {
    min: Math.min(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    max: Math.max(...values),
  };
}
