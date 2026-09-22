/**
 * The slice of the Spicetify global this extension actually touches.
 *
 * Hand-written rather than pulled from `@types/spicetify` so the extension has
 * no install-time dependencies and so the shape we rely on is visible in-repo
 * when Spicetify changes under us.
 */

export interface TimeInterval {
  start: number;
  duration: number;
  confidence: number;
}

export interface AnalysisSection extends TimeInterval {
  loudness: number;
  tempo: number;
  tempo_confidence: number;
  key: number;
  key_confidence: number;
  mode: number;
  mode_confidence: number;
}

export interface AnalysisSegment extends TimeInterval {
  loudness_start: number;
  loudness_max: number;
  loudness_max_time: number;
  /** 12 MFCC-like coefficients describing timbre. */
  timbre: number[];
  /** 12 chroma values, 0..1. */
  pitches: number[];
}

export interface AudioAnalysis {
  track?: {
    tempo: number;
    key: number;
    mode: number;
    loudness: number;
    duration: number;
    time_signature: number;
  };
  bars?: TimeInterval[];
  beats?: TimeInterval[];
  tatums?: TimeInterval[];
  sections?: AnalysisSection[];
  segments?: AnalysisSegment[];
}

export interface PlayerTrackMetadata {
  title?: string;
  artist_name?: string;
  album_title?: string;
  image_url?: string;
  duration?: string;
}

export interface SpicetifyGlobal {
  /**
   * Reads Spotify's own audio analysis for the current track.
   *
   * Backed by the internal `wg://audio-attributes/v1/audio-analysis/` cosmos
   * endpoint, which needs no auth and is therefore not governed by the Web API
   * deprecation. It can still return nothing: not every track has analysis,
   * and the service's continued availability is not guaranteed.
   */
  getAudioData?: (uri?: string) => Promise<AudioAnalysis>;
  Player?: {
    getProgress: () => number;
    isPlaying: () => boolean;
    data?: { item?: { uri?: string; metadata?: PlayerTrackMetadata } };
    addEventListener: (event: string, cb: (e?: unknown) => void) => void;
    removeEventListener: (event: string, cb: (e?: unknown) => void) => void;
  };
  Platform?: Record<string, unknown>;
  LocalStorage?: {
    get: (key: string) => string | null;
    set: (key: string, value: string) => void;
  };
  showNotification?: (text: string, isError?: boolean, ms?: number) => void;
  Menu?: {
    Item: new (name: string, isEnabled: boolean, onClick: (self: unknown) => void, icon?: string) => { register: () => void };
  };
  Keyboard?: {
    registerShortcut: (
      opts: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean },
      cb: () => void,
    ) => void;
  };
}

declare global {
  // eslint-disable-next-line no-var
  var Spicetify: SpicetifyGlobal | undefined;
}

export {};
