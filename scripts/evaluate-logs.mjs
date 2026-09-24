#!/usr/bin/env node
import fs from 'node:fs';

const file = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const requiredLanguages = (process.argv.find((arg) => arg.startsWith('--require-languages='))?.split('=', 2)[1] ?? '')
  .split(',').map((value) => value.trim().toLowerCase().split(/[-_]/u, 1)[0]).filter(Boolean);
if (!file || process.argv.includes('--help')) {
  console.log('Usage: node scripts/evaluate-logs.mjs <session.jsonl> [--json] [--require-languages=en,ja]');
  process.exit(file ? 0 : 1);
}

const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line, index) => {
  try { return [JSON.parse(line)]; } catch { console.warn(`Skipping malformed JSONL line ${index + 1}`); return []; }
});
const checkpoints = rows.filter((row) => row._checkpoint);
const decisions = rows.filter((row) => row.scene && row.system1);
const receipts = checkpoints.map((row) => row.timing).filter(Boolean);
const diffs = checkpoints.map((row) => row.worldDiff).filter(Boolean);
const telemetry = rows.filter((row) => row._telemetry);
const stateRows = rows.filter((row) => row._state);
const structureSamples = stateRows.map((row) => row.structure).filter(Boolean);
const structureEvents = structureSamples.flatMap((sample) => sample.events ?? []);
const latestStructure = structureSamples.at(-1) ?? null;
const decisionsWithTrack = decisions.filter((row) => row.track?.id);
const trackIds = [...new Set(decisionsWithTrack.map((row) => row.track.id))];
const trackTransitions = decisionsWithTrack.reduce((count, row, index) => {
  return index > 0 && row.track.id !== decisionsWithTrack[index - 1].track.id ? count + 1 : count;
}, 0);
const trackAt = (time) => {
  let trackId = null;
  for (const row of decisionsWithTrack) {
    if (typeof row.t !== 'number' || row.t > time) break;
    trackId = row.track.id;
  }
  return trackId;
};
const isGroundedSemanticDecision = (row) => row.scene?.source === 'semantic-manifest'
  && ((row.scene.semantic?.subjects?.length ?? 0) > 0
    || (row.scene.semantic?.environment?.length ?? 0) > 0
    || (row.scene.world?.entities?.length ?? 0) > 0);
const isUngroundedSemanticDecision = (row) => row.scene?.source === 'semantic-manifest'
  && !isGroundedSemanticDecision(row);
const checkpointsByTrack = Object.fromEntries(trackIds.map((trackId) => [
  trackId,
  checkpoints.filter((row) => trackAt(row.t) === trackId).length,
]));
const initialCheckpointsByTrack = Object.fromEntries(trackIds.map((trackId) => [
  trackId,
  checkpoints.filter((row) => trackAt(row.t) === trackId && row.reason === 'initial').length,
]));
const nonInitialCheckpointsByTrack = Object.fromEntries(trackIds.map((trackId) => [
  trackId,
  checkpoints.filter((row) => trackAt(row.t) === trackId && row.reason !== 'initial').length,
]));
const trackSessionTelemetry = Object.fromEntries(trackIds.map((trackId) => {
  const sessions = stateRows
    .map((row) => row.realization)
    .filter((realization) => realization?.trackId === trackId);
  return [trackId, {
    samples: sessions.length,
    modes: [...new Set(sessions.map((session) => session.mode).filter(Boolean))],
    reseedEnabled: [...new Set(sessions.map((session) => session.reseedEnabled).filter((value) => typeof value === 'boolean'))],
    keyframesEnabled: [...new Set(sessions.map((session) => session.keyframesEnabled).filter((value) => typeof value === 'boolean'))],
  }];
}));
const continuousPerTrack = trackIds.length > 0 && trackIds.every((trackId) => (
  initialCheckpointsByTrack[trackId] === 1
  && (trackSessionTelemetry[trackId]?.modes ?? []).includes('continuous-song')
));
const continuityStatusByTrack = Object.fromEntries(trackIds.map((trackId) => {
  const initial = initialCheckpointsByTrack[trackId] ?? 0;
  const checkpointsForTrack = checkpointsByTrack[trackId] ?? 0;
  const hasContinuousMode = (trackSessionTelemetry[trackId]?.modes ?? []).includes('continuous-song');
  const status = initial === 1 && hasContinuousMode
    ? 'pass'
    : checkpointsForTrack === 0
      ? 'unverified-too-short'
      : 'violation';
  return [trackId, { status, checkpoints: checkpointsForTrack, initialCheckpoints: initial, continuousMode: hasContinuousMode }];
}));
const continuityStatus = trackIds.length === 0
  ? 'unverified-no-track'
  : Object.values(continuityStatusByTrack).some((value) => value.status === 'violation')
    ? 'violation'
    : Object.values(continuityStatusByTrack).some((value) => value.status === 'unverified-too-short')
      ? 'unverified-too-short'
      : 'pass';
const liveMeaningByTrack = Object.fromEntries(trackIds.map((trackId) => {
  const samples = stateRows
    .filter((row) => row.track?.id === trackId)
    .map((row) => row.meaning)
    .filter(Boolean);
  return [trackId, {
    samples: samples.length,
    languages: [...new Set(samples.map((sample) => sample.language).filter(Boolean))],
    maxUpdates: samples.length ? Math.max(...samples.map((sample) => sample.updates ?? 0)) : 0,
    maxHypotheses: samples.length ? Math.max(...samples.map((sample) => sample.hypotheses ?? 0)) : 0,
    maxProvisional: samples.length ? Math.max(...samples.map((sample) => sample.provisional ?? 0)) : 0,
    maxCommitted: samples.length ? Math.max(...samples.map((sample) => sample.committed ?? 0)) : 0,
    maxCandidateObservations: samples.length ? Math.max(...samples.map((sample) => sample.maxCandidateObservations ?? 0)) : 0,
    semanticDecisions: decisions.filter((row) => row.track?.id === trackId && row.scene?.source === 'semantic-manifest').length,
    groundedSemanticDecisions: decisions.filter((row) => row.track?.id === trackId && isGroundedSemanticDecision(row)).length,
    ungroundedSemanticDecisions: decisions.filter((row) => row.track?.id === trackId && isUngroundedSemanticDecision(row)).length,
  }];
}));
const changes = { identity: 0, action: 0, environment: 0, look: 0, camera: 0 };
let previous = null;
for (const row of checkpoints) {
  const current = row.fingerprint;
  if (!current) continue;
  if (previous) for (const key of Object.keys(changes)) if (previous[key] !== current[key]) changes[key]++;
  previous = current;
}
const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const resonanceSamples = telemetry.map((row) => row.stream?.meta?.resonance).filter((value) => value && typeof value === 'object');
const maxFinite = (values) => {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? Math.max(...finite) : null;
};
const summary = {
  file,
  checkpoints: checkpoints.length,
  decisions: decisions.length,
  realizationSessions: {
    trackIds,
    trackTransitions,
    checkpointsByTrack,
    initialCheckpointsByTrack,
    nonInitialCheckpointsByTrack,
    trackSessionTelemetry,
    continuousPerTrack,
    continuityStatus,
    continuityStatusByTrack,
    invariant: trackIds.length > 0
      ? 'Each observed track should have one initial realization checkpoint; later director decisions are control-plane updates.'
      : 'No track identity was observed; continuous-per-song behavior is not verifiable from this log.',
  },
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
  structureMemory: {
    samples: structureSamples.length,
    sources: [...new Set(structureSamples.map((sample) => sample.source).filter(Boolean))],
    segmentIds: [...new Set(structureSamples.map((sample) => sample.segmentId).filter(Boolean))],
    boundaryEvents: latestStructure?.eventCounts?.boundaries ?? structureEvents.filter((event) => event.kind === 'boundary').length,
    repeatStarts: latestStructure?.eventCounts?.repeatStarts ?? structureEvents.filter((event) => event.kind === 'repeat-start').length,
    repeatEnds: latestStructure?.eventCounts?.repeatEnds ?? structureEvents.filter((event) => event.kind === 'repeat-end').length,
    maxNovelty: maxFinite(structureSamples.map((sample) => sample.novelty)),
    maxRepeatSimilarity: maxFinite(structureSamples.map((sample) => sample.repeatSimilarity)),
    note: 'Shadow-only evidence; it does not replace the authoritative section clock.',
  },
  liveMeaning: (() => {
    const samples = telemetry.map((row) => row.meaning).filter(Boolean);
    const latest = samples.at(-1) ?? null;
    const languageEvidence = Object.fromEntries(requiredLanguages.map((language) => {
      const matching = samples.filter((sample) => {
        const observed = String(sample.language ?? '').toLowerCase().split(/[-_]/u, 1)[0];
        const configured = String(sample.configuredLanguage ?? '').toLowerCase().split(/[-_]/u, 1)[0];
        return observed === language || (observed === 'und' && configured === language);
      });
      return [language, {
        samples: matching.length,
        groundedSamples: matching.filter((sample) => (sample.evidence?.groundedMotifs ?? 0) > 0).length,
        committedSamples: matching.filter((sample) => (sample.committed ?? 0) > 0).length,
        status: matching.some((sample) => (sample.evidence?.groundedMotifs ?? 0) > 0) ? 'pass' : 'unverified',
      }];
    }));
    const languageValidation = requiredLanguages.length
      ? (Object.values(languageEvidence).every((value) => value.status === 'pass') ? 'pass' : 'unverified')
      : 'not-requested';
    return {
      samples: samples.length,
      latest,
      languages: [...new Set(samples.map((sample) => sample.language).filter(Boolean))],
      configuredLanguages: [...new Set(samples.map((sample) => sample.configuredLanguage).filter(Boolean))],
      maxUpdates: samples.length ? Math.max(...samples.map((sample) => sample.updates ?? 0)) : 0,
      maxHypotheses: samples.length ? Math.max(...samples.map((sample) => sample.hypotheses ?? 0)) : 0,
      maxProvisional: samples.length ? Math.max(...samples.map((sample) => sample.provisional ?? 0)) : 0,
      maxCommitted: samples.length ? Math.max(...samples.map((sample) => sample.committed ?? 0)) : 0,
      maxCandidateCount: samples.length ? Math.max(...samples.map((sample) => sample.candidateCount ?? 0)) : 0,
      maxCandidateObservations: samples.length ? Math.max(...samples.map((sample) => sample.maxCandidateObservations ?? 0)) : 0,
      maxGroundedMotifs: samples.length ? Math.max(...samples.map((sample) => sample.evidence?.groundedMotifs ?? 0)) : 0,
      maxActionOnlyEvidence: samples.length ? Math.max(...samples.map((sample) => sample.evidence?.actionOnly ?? 0)) : 0,
      maxSymbolOnlyEvidence: samples.length ? Math.max(...samples.map((sample) => sample.evidence?.symbolsOnly ?? 0)) : 0,
      abstainedEvidenceSamples: samples.filter((sample) => sample.evidence?.abstained === true).length,
      provisionalCueSamples: samples.filter((sample) => sample.provisionalCue?.active === true).length,
      maxProvisionalCueConfidence: samples.length ? Math.max(...samples.map((sample) => sample.provisionalCue?.confidence ?? 0)) : 0,
      requiredLanguages,
      languageEvidence,
      languageValidation,
    };
  })(),
  liveMeaningByTrack,
  realization: {
    latestControlPlane: telemetry.map((row) => row.realization).filter(Boolean).at(-1) ?? null,
    structuredTelemetrySamples: telemetry.filter((row) => row.stream?.meta?.realization?.structured === true).length,
    conditioningVersions: [...new Set(telemetry.map((row) => row.stream?.meta?.realization?.conditioning).filter(Boolean))],
    streamBuildHashes: [...new Set(telemetry.map((row) => row.stream?.buildHash).filter(Boolean))],
    meaningWorkerBuildHashes: [...new Set(telemetry.map((row) => row.meaning?.workerBuildHash).filter(Boolean))],
    resonance: {
      samples: resonanceSamples.length,
      maxMotion: maxFinite(resonanceSamples.map((value) => value.motion)),
      maxCameraImpulse: maxFinite(resonanceSamples.map((value) => value.cameraImpulse)),
      maxLightPulse: maxFinite(resonanceSamples.map((value) => value.lightPulse)),
      weatherSamples: resonanceSamples.filter((value) => value.weatherIntensity != null).length,
      note: 'Resonance telemetry proves transport/application of bounded channels, not visual identity or action correctness.',
    },
  },
  streamHealth: {
    samples: telemetry.length,
    zeroFpsSamples: telemetry.filter((row) => typeof row.streamFps === 'number' && row.streamFps <= 0).length,
    zeroFpsWhileConnected: telemetry.filter((row) => typeof row.streamFps === 'number' && row.streamFps <= 0 && row.stream?.connected === true).length,
    disconnectedSamples: telemetry.filter((row) => row.stream?.connected === false).length,
    maxDropped: telemetry.length ? Math.max(...telemetry.map((row) => row.stream?.dropped ?? 0)) : 0,
  },
  shotGraph: {
    latest: telemetry.map((row) => row.shotGraph).filter(Boolean).at(-1) ?? null,
    samples: telemetry.filter((row) => row.shotGraph).length,
  },
  evidence: {
    semanticDecisions: decisions.filter((row) => row.scene.source === 'semantic-manifest').length,
    groundedSemanticDecisions: decisions.filter(isGroundedSemanticDecision).length,
    ungroundedSemanticDecisions: decisions.filter(isUngroundedSemanticDecision).length,
    identityVerified: false,
    actionVerified: false,
    note: 'Fingerprint and timing telemetry are evaluated here; visual identity/action still require a human or model-backed evaluator.',
  },
};
console.log(process.argv.includes('--json') ? JSON.stringify(summary, null, 2) : [
  `Session: ${file}`,
  `Checkpoints: ${summary.checkpoints}; decisions: ${summary.decisions}`,
  `Realization sessions: ${summary.realizationSessions.trackIds.length}; track transitions: ${summary.realizationSessions.trackTransitions}; checkpoints by track: ${JSON.stringify(summary.realizationSessions.checkpointsByTrack)}; initial per track: ${JSON.stringify(summary.realizationSessions.initialCheckpointsByTrack)}; continuity status: ${summary.realizationSessions.continuityStatus}; per-track status: ${JSON.stringify(summary.realizationSessions.continuityStatusByTrack)}`,
  `Scene sources: ${JSON.stringify(summary.sceneSources)}`,
  `Fingerprint changes: ${JSON.stringify(summary.fingerprintChanges)}`,
  `Timing receipts: ${summary.timing.receipts}; fallback rate: ${summary.timing.fallbackRate == null ? 'n/a' : `${(summary.timing.fallbackRate * 100).toFixed(1)}%`}`,
  `World transitions: ${summary.worldTransitions.receipts}; identity breaks: ${summary.worldTransitions.identityBreaks}; keyframes required: ${summary.worldTransitions.keyframeRequired}`,
  `System 0 shadow: samples=${summary.structureMemory.samples}; segments=${JSON.stringify(summary.structureMemory.segmentIds)}; boundaries=${summary.structureMemory.boundaryEvents}; repeats=${summary.structureMemory.repeatStarts}/${summary.structureMemory.repeatEnds}`,
  `Live meaning: languages=${JSON.stringify(summary.liveMeaning.languages)} configured=${JSON.stringify(summary.liveMeaning.configuredLanguages)} updates<=${summary.liveMeaning.maxUpdates} hypotheses<=${summary.liveMeaning.maxHypotheses} provisional<=${summary.liveMeaning.maxProvisional} committed<=${summary.liveMeaning.maxCommitted} grounded<=${summary.liveMeaning.maxGroundedMotifs} actionOnly<=${summary.liveMeaning.maxActionOnlyEvidence} symbolsOnly<=${summary.liveMeaning.maxSymbolOnlyEvidence} abstainedSamples=${summary.liveMeaning.abstainedEvidenceSamples} cueSamples=${summary.liveMeaning.provisionalCueSamples}`,
  `Live meaning by track: ${JSON.stringify(summary.liveMeaningByTrack)}`,
  `Live language gate: ${summary.liveMeaning.languageValidation}; required=${JSON.stringify(summary.liveMeaning.requiredLanguages)} evidence=${JSON.stringify(summary.liveMeaning.languageEvidence)}`,
  `Realization: structuredTelemetry=${summary.realization.structuredTelemetrySamples}; conditioning=${JSON.stringify(summary.realization.conditioningVersions)}; resonanceSamples=${summary.realization.resonance.samples}; streamBuilds=${JSON.stringify(summary.realization.streamBuildHashes)}; meaningBuilds=${JSON.stringify(summary.realization.meaningWorkerBuildHashes)}`,
  `Continuity: ${summary.realization.latestControlPlane ? `${summary.realization.latestControlPlane.mode}; direction refreshes=${summary.realization.latestControlPlane.directionDecisions}; committed checkpoints=${summary.realization.latestControlPlane.checkpoints}; last=${summary.realization.latestControlPlane.lastCheckpointReason ?? 'none'}` : 'no control-plane telemetry'}`,
  `Stream health: telemetry=${summary.streamHealth.samples}; zeroFps=${summary.streamHealth.zeroFpsSamples} (connected=${summary.streamHealth.zeroFpsWhileConnected}); disconnected=${summary.streamHealth.disconnectedSamples}; maxDropped=${summary.streamHealth.maxDropped}`,
  `ShotGraph: ${summary.shotGraph.latest ? `staged=${summary.shotGraph.latest.staged} prefetched=${summary.shotGraph.latest.prefetched} selected=${summary.shotGraph.latest.selected} pending=${summary.shotGraph.latest.pending}` : 'no runtime telemetry'}`,
  `Evidence-backed decisions: ${summary.evidence.semanticDecisions} (grounded=${summary.evidence.groundedSemanticDecisions}, ungrounded=${summary.evidence.ungroundedSemanticDecisions}); visual verification: deferred`,
].join('\n'));
if (requiredLanguages.length && summary.liveMeaning.languageValidation !== 'pass') process.exitCode = 2;
