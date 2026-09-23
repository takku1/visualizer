import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const logDir = 'logs';
const requested = process.argv.slice(2);
const paths = requested.length
  ? requested
  : (await readdir(logDir)).filter((name) => name.endsWith('.jsonl')).map((name) => join(logDir, name));

const dimensions = ['motion', 'palette', 'texture', 'geometry', 'symmetry', 'feedback'];
const report = [];

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
  const tracks = new Set(decisions.map((row) => `${row.track?.title ?? ''}\u0000${row.track?.artist ?? ''}`));
  const learned = decisions.map((row) => row.perception?.learned).filter(Boolean);
  const learnedModels = [...new Set(learned.map((value) => `${value.model}@${value.version}`))].sort();

  report.push({
    file: path,
    decisions: decisions.length,
    captured: decisions.filter((row) => row.source?.capturing).length,
    structured: decisions.filter((row) => row.source?.hasStructure).length,
    metadata: decisions.filter((row) => row.track?.title || row.track?.artist).length,
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
  out.learned += row.learned;
  out.telemetrySamples += row.telemetrySamples;
  out.simNaN += row.simNaN;
  for (const dimension of dimensions) out.divergence[dimension] += row.divergence[dimension];
  return out;
}, {
  decisions: 0, captured: 0, structured: 0, metadata: 0, learned: 0, telemetrySamples: 0, simNaN: 0,
  divergence: Object.fromEntries(dimensions.map((dimension) => [dimension, 0])),
});

console.log(JSON.stringify({ files: report.length, totals, sessions: report }, null, 2));

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
