import { SidecarAudioPerception } from '../src/perception/adapter';
import type { PerceptualState } from '../src/perception/state';
import type { AudioWindow } from '../src/audio/source';

const input = {
  audio: { level: 0.5, bass: 0.4, lowMid: 0.3, mid: 0.2, highMid: 0.1, treble: 0.2, flux: 0.1, bassFlux: 0.2, trebleFlux: 0.1, stereoWidth: 0.5, tempo: 120, spectralCentroid: 0.4, dynamicRange: 0.6, estimatedKey: 0, estimatedMode: 'major' as const, keyConfidence: 0.8, rhythmConfidence: 0.7, swing: 0, syncopation: 0.2, microtiming: 0, subdivision: 4, polyrhythm: 0 },
  track: { title: 'Probe', artist: 'Probe', genres: [], tempo: 120, key: 0, mode: 1, loudness: -8, sectionLabel: 'verse' },
  learned: null,
} satisfies PerceptualState;

const originalFetch = globalThis.fetch;
let request: { url: string; body: { input: PerceptualState } } | null = null;
let calls = 0;
globalThis.fetch = (async (inputUrl, init) => {
  calls++;
  request = { url: String(inputUrl), body: JSON.parse(String(init?.body)) };
  const learned = calls === 1
    ? { kind: 'audio-embedding', model: 'probe-model', version: '1', vector: [0.1, 0.2, 0.3] }
    : { kind: 'not-audio', model: 'probe-model', version: '1', vector: [0.1] };
  return { ok: true, status: 200, json: async () => ({ learned }) } as Response;
}) as typeof fetch;

try {
  const provider = new SidecarAudioPerception('http://probe.invalid/audio');
  const audio: AudioWindow = { sampleRate: 16000, channels: 1, samples: new Float32Array([0.1, -0.1, 0.2]) };
  const learned = await provider.embed(input, audio);
  const invalid = await provider.embed(input, audio);
  const captured = request;
  const checks = {
    endpointAndPayload: captured?.url === 'http://probe.invalid/audio' && captured.body.input.track.title === 'Probe'
      && (captured as typeof captured & { body: { audio?: { sampleRate: number; samples: number[] } } }).body.audio?.sampleRate === 16000,
    learnedAccepted: learned?.model === 'probe-model' && learned.vector.length === 3,
    providerIdentity: provider.name === 'audio-perception-sidecar' && provider.version === 'http-v1',
    invalidCheckRan: invalid === null,
  };
  const result = { probe: 'perception-causality', checks, pass: Object.values(checks).every(Boolean) };
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
}
