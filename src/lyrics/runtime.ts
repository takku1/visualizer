import type { TrackContext } from '../director/director';
import {
  DEFAULT_LYRICS_CONFIG, type LyricCue, type LyricSource, type LyricsConfig, type LyricsFrame, type LyricEvent,
} from './types';

/** Owns the lyrics policy. No source is touched while mode is off. */
export class LyricsRuntime {
  #config: LyricsConfig;
  #source?: LyricSource;
  #cues: LyricCue[] = [];
  #trackKey = '';
  #loading = false;
  #lastEventPosition: number | null = null;
  #lastEventCue: LyricCue | null = null;

  constructor(config: Partial<LyricsConfig> = {}, source?: LyricSource) {
    this.#config = { ...DEFAULT_LYRICS_CONFIG, ...config };
    this.#source = source;
  }

  get config(): LyricsConfig { return { ...this.#config }; }
  get cues(): readonly LyricCue[] { return this.#cues; }

  setConfig(config: LyricsConfig): void {
    const wasActive = this.#config.enabled && this.#config.mode !== 'off';
    this.#config = { ...config };
    const active = this.#config.enabled && this.#config.mode !== 'off';
    if (!active) {
      this.#cues = [];
      this.#trackKey = '';
    } else if (!wasActive) {
      // Allow off -> overlay/world on the same track to load its source.
      this.#trackKey = '';
    }
    this.#lastEventPosition = null;
    this.#lastEventCue = null;
  }

  async sync(track: TrackContext): Promise<void> {
    const key = `${track.title ?? ''}\u0000${track.artist ?? ''}`;
    if (key === this.#trackKey || this.#loading) return;
    this.#trackKey = key;
    this.#cues = [];
    this.#lastEventPosition = null;
    this.#lastEventCue = null;
    if (!this.#config.enabled || this.#config.mode === 'off' || !this.#source?.configured) return;
    this.#loading = true;
    try {
      this.#cues = (await this.#source.load(track)).map((cue) => normalizeCue(cue, this.#source?.name ?? 'lyrics'))
        .filter((cue): cue is LyricCue => cue !== null);
    } catch {
      // A provider outage must be observationally equivalent to no lyrics.
      this.#cues = [];
    } finally {
      this.#loading = false;
    }
  }

  frame(position: number): LyricsFrame {
    const active = this.#config.enabled && this.#config.mode !== 'off'
      ? this.#cues.find((cue) => position >= cue.start && position < cue.end) ?? null
      : null;
    if (!active) return { mode: this.#config.mode, cue: null, progress: 0, opacity: 0 };
    const progress = clamp((position - active.start) / Math.max(active.end - active.start, 1e-3), 0, 1);
    const edge = Math.min(progress / 0.12, (1 - progress) / 0.12, 1);
    return { mode: this.#config.mode, cue: active, progress, opacity: this.#config.opacity * edge };
  }

  /** The active lyric text for semantic consumers, without exposing provider state. */
  currentText(position: number): string | undefined {
    const frame = this.frame(position);
    const text = frame.cue?.text?.trim();
    return text || undefined;
  }

  /** Consume semantic lyric transitions without making the renderer own policy. */
  events(position: number): LyricEvent[] {
    const frame = this.frame(position);
    const events: LyricEvent[] = [];
    const previous = this.#lastEventCue;
    if (previous && (!frame.cue || frame.cue.id !== previous.id)) {
      events.push({ kind: 'cue-exit', cueId: previous.id, strength: 1 });
      if (this.#config.retainMemory) events.push({ kind: 'lyric-memory', cueId: previous.id, strength: 1 });
    }
    if (frame.cue && (!previous || frame.cue.id !== previous.id)) {
      events.push({ kind: 'cue-enter', cueId: frame.cue.id, strength: frame.opacity / Math.max(this.#config.opacity, 1e-3) });
      const wordIndex = frame.cue.words?.findIndex((word) => position >= word.start && position < word.end) ?? -1;
      if (wordIndex >= 0) events.push({ kind: 'word-enter', cueId: frame.cue.id, wordIndex, strength: 1 });
    } else if (frame.cue && this.#lastEventPosition != null) {
      events.push({ kind: 'cue-hold', cueId: frame.cue.id, progress: frame.progress });
      const previousWord = previous?.words?.findIndex((word) => this.#lastEventPosition! >= word.start && this.#lastEventPosition! < word.end) ?? -1;
      const wordIndex = frame.cue.words?.findIndex((word) => position >= word.start && position < word.end) ?? -1;
      if (wordIndex >= 0 && wordIndex !== previousWord) events.push({ kind: 'word-enter', cueId: frame.cue.id, wordIndex, strength: 1 });
    }
    this.#lastEventPosition = position;
    this.#lastEventCue = frame.cue;
    return events;
  }
}

function clamp(value: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, value)); }

function normalizeCue(cue: LyricCue, fallbackSource: string): LyricCue | null {
  if (!cue || typeof cue.id !== 'string' || typeof cue.text !== 'string'
    || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)
    || cue.end <= cue.start || cue.text.trim().length === 0) return null;
  const words = cue.words?.filter((word) => (
    typeof word.text === 'string' && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start
  ));
  return {
    ...cue,
    text: cue.text.trim(),
    source: typeof cue.source === 'string' && cue.source ? cue.source : fallbackSource,
    confidence: Number.isFinite(cue.confidence) ? clamp(cue.confidence, 0, 1) : 0,
    ...(words?.length ? { words } : {}),
  };
}
