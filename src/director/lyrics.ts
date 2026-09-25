import type { SongMeaning } from './semantic';
import { groundMotifs, groundedAction } from './grounding';

export interface LyricLine {
  startSec: number;
  endSec?: number;
  text: string;
}

export interface LyricsLookup {
  trackId: string;
  isrc?: string;
  title?: string;
  artist?: string;
  album?: string;
  durationSec?: number;
}

export interface LyricsResult {
  provider: string;
  providerTrackId?: string;
  providerUrl?: string;
  retrievedAt?: string;
  match: 'isrc' | 'provider-id' | 'metadata' | 'import';
  language?: string;
  timing: 'line' | 'word' | 'none';
  rights: 'verified' | 'unknown' | 'rejected';
  confidence: number;
  lines: LyricLine[];
}

export interface LyricsLookupTrace {
  outcome: 'cache-hit' | 'provider-hit' | 'miss';
  provider: string;
}

export interface LyricsProvider {
  readonly id?: string;
  /** Best-effort trace for the most recent lookup; never part of evidence. */
  readonly lastLookup?: LyricsLookupTrace | null;
  lookup(query: LyricsLookup): Promise<LyricsResult | null>;
}

/** Ordered acquisition cascade; providers are tried only until one has evidence. */
export class LyricsProviderChain implements LyricsProvider {
  readonly id = 'lyrics-chain';
  #lastLookup: LyricsLookupTrace | null = null;
  #providers: readonly LyricsProvider[];

  get lastLookup(): LyricsLookupTrace | null {
    return this.#lastLookup;
  }

  constructor(providers: readonly LyricsProvider[]) {
    this.#providers = [...providers];
  }

  async lookup(query: LyricsLookup): Promise<LyricsResult | null> {
    this.#lastLookup = null;
    for (const provider of this.#providers) {
      try {
        const result = await provider.lookup(query);
        if (result) {
          this.#lastLookup = provider.lastLookup ?? { outcome: 'provider-hit', provider: provider.id ?? 'unknown' };
          return result;
        }
      } catch {
        // A failed source is a miss; the next source may still be available.
      }
    }
    this.#lastLookup = { outcome: 'miss', provider: this.id };
    return null;
  }
}

export interface LyricsCache {
  get(key: string): LyricsResult | null;
  set(key: string, value: LyricsResult): void;
}

export class MemoryLyricsCache implements LyricsCache {
  #values = new Map<string, LyricsResult>();

  get(key: string): LyricsResult | null {
    return this.#values.get(key) ?? null;
  }

  set(key: string, value: LyricsResult): void {
    this.#values.set(key, value);
  }
}

export interface LyricsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Small persistent cache adapter for browser/Electron hosts; failures are misses. */
export class StorageLyricsCache implements LyricsCache {
  #storage: LyricsStorage;
  #prefix: string;
  #maxAgeMs: number;

  constructor(storage: LyricsStorage, prefix = 's1:lyrics:', maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
    this.#storage = storage;
    this.#prefix = prefix;
    this.#maxAgeMs = maxAgeMs;
  }

  get(key: string): LyricsResult | null {
    try {
      const raw = this.#storage.getItem(this.#prefix + encodeURIComponent(key));
      if (!raw) return null;
      const entry = JSON.parse(raw) as { cachedAt?: number; value?: LyricsResult };
      if (!entry.value || !Number.isFinite(entry.cachedAt) || Date.now() - entry.cachedAt! > this.#maxAgeMs) return null;
      return entry.value;
    } catch {
      return null;
    }
  }

  set(key: string, value: LyricsResult): void {
    try {
      this.#storage.setItem(this.#prefix + encodeURIComponent(key), JSON.stringify({ cachedAt: Date.now(), value }));
    } catch {
      // Quota/private-mode failures must never affect playback.
    }
  }
}

interface LyricsHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type LyricsFetcher = (url: string, init?: RequestInit) => Promise<LyricsHttpResponse>;

export interface LocalLyricsText {
  text: string;
  source: string;
  language?: string;
}

export type LocalLyricsResolver = (query: LyricsLookup) => LocalLyricsText | null | Promise<LocalLyricsText | null>;

/** Host-neutral adapter for a local .lrc file or embedded synced-lyrics tag. */
export class LocalTimedLyricsProvider implements LyricsProvider {
  readonly id = 'local-timed';
  #lastLookup: LyricsLookupTrace | null = null;
  #resolve: LocalLyricsResolver;

  get lastLookup(): LyricsLookupTrace | null {
    return this.#lastLookup;
  }

  constructor(resolve: LocalLyricsResolver) {
    this.#resolve = resolve;
  }

  async lookup(query: LyricsLookup): Promise<LyricsResult | null> {
    this.#lastLookup = null;
    let local: LocalLyricsText | null;
    try { local = await this.#resolve(query); } catch { this.#lastLookup = { outcome: 'miss', provider: this.id }; return null; }
    if (!local?.text.trim()) { this.#lastLookup = { outcome: 'miss', provider: this.id }; return null; }
    const lines = parseLrc(local.text);
    if (!lines.length) { this.#lastLookup = { outcome: 'miss', provider: this.id }; return null; }
    this.#lastLookup = { outcome: 'provider-hit', provider: this.id };
    return {
      provider: this.id,
      providerUrl: local.source,
      retrievedAt: new Date().toISOString(),
      match: 'import',
      language: languageFromEvidence(local.language, local.text),
      timing: 'line',
      // Local ownership/source does not prove redistribution rights.
      rights: 'unknown',
      confidence: 1,
      lines,
    };
  }
}

/** Development/community provider. It never claims licensed rights. */
export class LrclibLyricsProvider implements LyricsProvider {
  readonly id = 'lrclib';
  #lastLookup: LyricsLookupTrace | null = null;
  #fetcher: LyricsFetcher;
  #baseUrl: string;
  #clientId: string;

  constructor(
    fetcher: LyricsFetcher = (url, init) => fetch(url, init),
    baseUrl = 'https://lrclib.net/api',
    clientId = 'system1-visualizer/0.1.0 (https://github.com/takku1/visualizer)',
  ) {
    this.#fetcher = fetcher;
    this.#baseUrl = baseUrl.replace(/\/$/u, '');
    this.#clientId = clientId;
  }

  get lastLookup(): LyricsLookupTrace | null {
    return this.#lastLookup;
  }

  async lookup(query: LyricsLookup): Promise<LyricsResult | null> {
    this.#lastLookup = null;
    if (!query.title?.trim() || !query.artist?.trim()) { this.#lastLookup = { outcome: 'miss', provider: this.id }; return null; }
    const params = new URLSearchParams({ track_name: query.title.trim(), artist_name: query.artist.trim() });
    if (query.album?.trim()) params.set('album_name', query.album.trim());
    if (Number.isFinite(query.durationSec) && (query.durationSec ?? 0) > 0) params.set('duration', String(Math.round(query.durationSec!)));
    let response: LyricsHttpResponse;
    try {
      response = await this.#fetcher(`${this.#baseUrl}/get?${params.toString()}`, {
        headers: { accept: 'application/json', 'X-User-Agent': this.#clientId },
      });
    } catch {
      this.#lastLookup = { outcome: 'miss', provider: this.id };
      return null;
    }
    if (!response.ok || response.status < 200 || response.status >= 300) { this.#lastLookup = { outcome: 'miss', provider: this.id }; return null; }
    let raw: unknown;
    try { raw = await response.json(); } catch { this.#lastLookup = { outcome: 'miss', provider: this.id }; return null; }
    if (!isRecord(raw)) { this.#lastLookup = { outcome: 'miss', provider: this.id }; return null; }
    const duration = numberValue(raw.duration);
    if (Number.isFinite(query.durationSec) && duration !== null && Math.abs(duration - query.durationSec!) > 2) { this.#lastLookup = { outcome: 'miss', provider: this.id }; return null; }
    const synced = typeof raw.syncedLyrics === 'string' ? raw.syncedLyrics : '';
    const lines = synced ? parseLrc(synced) : [];
    const plain = typeof raw.plainLyrics === 'string' && raw.plainLyrics.trim().length > 0;
    this.#lastLookup = { outcome: 'provider-hit', provider: this.id };
    return {
      provider: this.id,
      providerTrackId: stringValue(raw.id) ?? undefined,
      providerUrl: 'https://lrclib.net',
      retrievedAt: new Date().toISOString(),
      match: 'metadata',
      language: languageFromEvidence(stringValue(raw.language) ?? undefined, lines.map((line) => line.text).join('\n') || (plain ? raw.plainLyrics as string : '')),
      timing: lines.length ? 'line' : 'none',
      // LRCLIB is community data. Callers must explicitly opt into unknown
      // rights before using it as committed semantic evidence.
      rights: 'unknown',
      confidence: matchConfidence(query, raw, duration),
      lines: lines.length ? lines : (plain ? [{ startSec: 0, text: raw.plainLyrics as string }] : []),
    };
  }
}

export class CachedLyricsProvider implements LyricsProvider {
  #lastLookup: LyricsLookupTrace | null = null;
  #provider: LyricsProvider;
  #cache: LyricsCache;

  constructor(provider: LyricsProvider, cache: LyricsCache) {
    this.#provider = provider;
    this.#cache = cache;
  }

  get lastLookup(): LyricsLookupTrace | null {
    return this.#lastLookup;
  }

  async lookup(query: LyricsLookup): Promise<LyricsResult | null> {
    this.#lastLookup = null;
    const key = lyricsCacheKey(this.#provider.id ?? 'provider', query);
    const cached = this.#cache.get(key);
    if (cached) {
      this.#lastLookup = { outcome: 'cache-hit', provider: cached.provider || this.#provider.id || 'unknown' };
      return cached;
    }
    const result = await this.#provider.lookup(query);
    this.#lastLookup = result
      ? { outcome: 'provider-hit', provider: result.provider || this.#provider.id || 'unknown' }
      : (this.#provider.lastLookup ?? { outcome: 'miss', provider: this.#provider.id ?? 'unknown' });
    if (result) this.#cache.set(key, result);
    return result;
  }
}

export function lyricsCacheKey(provider: string, query: LyricsLookup): string {
  return [provider, query.trackId, query.isrc ?? '', query.artist ?? '', query.title ?? '', query.album ?? '',
    Number.isFinite(query.durationSec) ? Math.round(query.durationSec!) : ''].join('\u0000').toLocaleLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Recover only high-confidence script evidence; never guess a spoken language from Latin text. */
function languageFromEvidence(hint: string | undefined, text: string): string | undefined {
  const normalized = hint?.trim().toLowerCase().split(/[-_]/u, 1)[0];
  if (normalized && normalized !== 'und' && normalized !== 'unknown') return normalized;
  if (/[぀-ヿ]/u.test(text)) return 'ja';
  if (/[가-힯]/u.test(text)) return 'ko';
  return normalized === 'und' ? 'und' : undefined;
}

function matchConfidence(query: LyricsLookup, raw: Record<string, unknown>, duration: number | null): number {
  let score = 0.55;
  if (query.album && stringValue(raw.albumName)?.toLocaleLowerCase() === query.album.toLocaleLowerCase()) score += 0.12;
  if (duration !== null && Number.isFinite(query.durationSec) && Math.abs(duration - query.durationSec!) <= 2) score += 0.18;
  return Math.min(0.9, score);
}

/** Parse common LRC timestamps while ignoring metadata tags. */
export function parseLrc(input: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of input.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d{2}(?:\.\d+)?)\]/g)];
    const text = raw.replace(/\[[^\]]+\]/g, '').trim();
    if (!text || !stamps.length) continue;
    for (const stamp of stamps) {
      const startSec = Number(stamp[1]) * 60 + Number(stamp[2]);
      if (Number.isFinite(startSec)) lines.push({ startSec, text });
    }
  }
  return lines.sort((a, b) => a.startSec - b.startSec).map((line, index, all) => ({
    ...line,
    endSec: all[index + 1]?.startSec,
  }));
}

/** Convert imported/licensed timed lyrics into the existing evidence contract. */
export interface LyricsMeaningOptions {
  /** Community/provider data must be explicitly enabled before it can become committed meaning. */
  allowUnknownRights?: boolean;
  /** Permit grounded plain lyrics as track-level evidence; never treat them as time-aligned. */
  allowUntimed?: boolean;
}

export function meaningFromLyrics(result: LyricsResult, revision = 1, options: LyricsMeaningOptions = {}): SongMeaning | null {
  if (result.rights === 'rejected' || (result.rights === 'unknown' && !options.allowUnknownRights) || (result.timing === 'none' && !options.allowUntimed) || result.lines.length === 0) return null;
  const lines = result.lines.filter((line) => line.text.trim());
  const groundedLines = lines.map((line, index) => ({
    ...line,
    index,
    motifs: groundMotifs(line.text, result.language ?? 'und', result.confidence, `lyric-line-${index}`, 'lyrics'),
    action: groundedAction(line.text, result.language ?? 'und'),
  }));
  const motifs = groundedLines.slice(0, 8).flatMap((line) => line.motifs);
  if (!motifs.length) return null;
  const grounded = motifs.some((motif) => motif.kind !== 'symbol');
  return {
    revision,
    thesis: 'meaning imported from timed lyric evidence',
    language: result.language,
    motifs,
    relations: [],
    sections: groundedLines.map((line) => ({
      index: line.index,
      startSec: line.startSec,
      endSec: line.endSec,
      action: line.action ?? 'lyric evidence unfolds through the frame',
      activeMotifs: line.motifs.map((motif) => motif.id),
      affect: [],
      confidence: result.confidence,
    })),
    evidence: lines.map((line) => ({
      source: 'lyrics' as const,
      text: line.text,
      confidence: result.confidence,
      startSec: line.startSec,
      endSec: line.endSec,
    })),
    abstained: !grounded,
  };
}
