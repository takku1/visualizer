import type { TrackContext } from '../director/director';

export interface LyricWord { text: string; start: number; end: number; }
export interface LyricCue {
  id: string;
  start: number;
  end: number;
  text: string;
  words?: LyricWord[];
  source: string;
  confidence: number;
}

export interface LyricSource {
  readonly name: string;
  readonly configured: boolean;
  load(track: TrackContext): Promise<LyricCue[]>;
}

export type LyricsMode = 'off' | 'overlay' | 'world' | 'hybrid';

export interface LyricsConfig {
  enabled: boolean;
  mode: LyricsMode;
  opacity: number;
  readable: boolean;
  retainMemory: boolean;
}

export interface LyricsFrame {
  mode: LyricsMode;
  cue: LyricCue | null;
  progress: number;
  opacity: number;
}

export type LyricEvent =
  | { kind: 'cue-enter'; cueId: string; strength: number }
  | { kind: 'word-enter'; cueId: string; wordIndex: number; strength: number }
  | { kind: 'cue-hold'; cueId: string; progress: number }
  | { kind: 'cue-exit'; cueId: string; strength: number }
  | { kind: 'lyric-memory'; cueId: string; strength: number };

export const DEFAULT_LYRICS_CONFIG: LyricsConfig = {
  enabled: false,
  mode: 'off',
  opacity: 0.9,
  readable: true,
  retainMemory: false,
};
