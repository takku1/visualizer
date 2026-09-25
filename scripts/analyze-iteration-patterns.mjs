import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd(), 'logs');
const files = readdirSync(root)
  .filter((name) => name.startsWith('session-') && name.endsWith('.jsonl'))
  .map((name) => join(root, name))
  .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
  .slice(-10);

function rows(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

const reports = files.map((file) => {
  const all = rows(file);
  const telemetry = all.filter((row) => row._telemetry);
  const connected = telemetry.filter((row) => row.stream?.connected);
  const decisions = all.filter((row) => row.kind === 'decision' || row.system1);
  // Track identity is emitted on state/decision rows and inside realization
  // telemetry; scene is deliberately not the authority for it.
  const tracks = new Set(all.flatMap((row) => [
    row.track?.id,
    row.realization?.trackId,
    row.meaning?.lyrics?.trackId,
  ]).filter(Boolean));
  const sources = {};
  for (const row of decisions) {
    const source = row.source?.kind ?? row.scene?.source;
    if (source) sources[source] = (sources[source] ?? 0) + 1;
  }
  const lyric = connected.map((row) => row.meaning?.lyrics).filter(Boolean);
  return {
    file: file.split(/[\\/]/).pop(),
    build: [...new Set(connected.map((row) => row.stream.buildHash).filter(Boolean))],
    tracks: tracks.size,
    connectedSamples: connected.length,
    maxDropped: Math.max(0, ...connected.map((row) => row.stream.dropped ?? 0)),
    maxCaptureMs: Math.max(0, ...connected.map((row) => row.stream.captureMaxMs ?? 0)),
    maxEncodeMs: Math.max(0, ...connected.map((row) => row.stream.captureEncodeMs ?? 0)),
    maxGenerationMs: Math.max(0, ...connected.map((row) => row.stream.meta?.genMs ?? 0)),
    continuousMode: connected.every((row) => row.realization?.mode === 'continuous-song'),
    sources,
    lyricCommittedTracks: new Set(lyric.filter((item) => item.status === 'committed').map((item) => item.trackId)).size,
    lyricAbstainedTracks: new Set(lyric.filter((item) => item.status === 'grounding-abstained').map((item) => item.trackId)).size,
  };
});

const result = {
  sessions: reports.length,
  reports,
  patterns: {
    continuousModePassRate: reports.length ? reports.filter((report) => report.continuousMode).length / reports.length : 0,
    sessionsWithDroppedFrames: reports.filter((report) => report.maxDropped > 0).length,
    sessionsWithCaptureSpikes: reports.filter((report) => report.maxCaptureMs > 250).length,
    sessionsWithGroundingAbstention: reports.filter((report) => report.lyricAbstainedTracks > 0).length,
    note: 'This is operational evidence, not proof of visual identity or semantic truth.',
  },
};

if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Iteration report: ${result.sessions} recent sessions`);
  console.log(`continuous-song pass rate: ${(result.patterns.continuousModePassRate * 100).toFixed(1)}%`);
  console.log(`sessions with dropped frames: ${result.patterns.sessionsWithDroppedFrames}`);
  console.log(`sessions with >250ms capture spikes: ${result.patterns.sessionsWithCaptureSpikes}`);
  console.log(`sessions with lyric grounding abstention: ${result.patterns.sessionsWithGroundingAbstention}`);
  for (const report of reports) console.log(`${report.file}: tracks=${report.tracks} drop=${report.maxDropped} capture=${report.maxCaptureMs.toFixed(1)}ms gen=${report.maxGenerationMs.toFixed(1)}ms committedLyrics=${report.lyricCommittedTracks} abstainedLyrics=${report.lyricAbstainedTracks}`);
}
