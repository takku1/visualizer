/**
 * Meaning discovered from audio that is arriving now.
 *
 * This is deliberately separate from SongMeaning: live ASR is provisional by
 * default and must pass an accumulator/evidence gate before it can become a
 * committed motif. The renderer should never consume raw transcript text.
 */
export type LiveLyricStatus = 'provisional' | 'committed' | 'expired';

export interface LiveLyricHypothesis {
  id: string;
  text: string;
  language: string;
  startSec: number;
  endSec: number;
  confidence: number;
  stability: number;
  status: LiveLyricStatus;
  source: 'live-asr';
}

export interface LiveLyricUpdate {
  type: 'live-lyrics';
  trackId: string;
  /** Playback position when the worker emitted this update. */
  playheadSec: number;
  /** Monotonic worker revision; stale updates must not replace newer ones. */
  revision: number;
  model: string;
  hypotheses: LiveLyricHypothesis[];
}

export function isLiveLyricUpdate(value: unknown): value is LiveLyricUpdate {
  if (!value || typeof value !== 'object') return false;
  const msg = value as Partial<LiveLyricUpdate>;
  return msg.type === 'live-lyrics'
    && typeof msg.trackId === 'string'
    && typeof msg.playheadSec === 'number'
    && Number.isFinite(msg.playheadSec)
    && typeof msg.revision === 'number'
    && Number.isInteger(msg.revision)
    && msg.revision >= 0
    && typeof msg.model === 'string'
    && Array.isArray(msg.hypotheses)
    && msg.hypotheses.every(isLiveLyricHypothesis);
}

export function isLiveLyricHypothesis(value: unknown): value is LiveLyricHypothesis {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LiveLyricHypothesis>;
  return typeof item.id === 'string'
    && item.id.length > 0
    && typeof item.text === 'string'
    && item.text.trim().length > 0
    && typeof item.language === 'string'
    && item.language.length > 0
    && typeof item.startSec === 'number'
    && Number.isFinite(item.startSec)
    && item.startSec >= 0
    && typeof item.endSec === 'number'
    && Number.isFinite(item.endSec)
    && item.endSec > item.startSec
    && typeof item.confidence === 'number'
    && Number.isFinite(item.confidence)
    && item.confidence >= 0
    && item.confidence <= 1
    && typeof item.stability === 'number'
    && Number.isFinite(item.stability)
    && item.stability >= 0
    && item.stability <= 1
    && (item.status === 'provisional' || item.status === 'committed' || item.status === 'expired')
    && item.source === 'live-asr';
}
