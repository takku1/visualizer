import type { SongMeaning } from './semantic';

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
}

export interface LyricsResult {
  provider: string;
  match: 'isrc' | 'provider-id' | 'metadata' | 'import';
  language?: string;
  timing: 'line' | 'word' | 'none';
  rights: 'verified' | 'unknown' | 'rejected';
  confidence: number;
  lines: LyricLine[];
}

export interface LyricsProvider {
  lookup(query: LyricsLookup): Promise<LyricsResult | null>;
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
export function meaningFromLyrics(result: LyricsResult, revision = 1): SongMeaning | null {
  if (result.rights === 'rejected' || result.timing === 'none' || result.lines.length === 0) return null;
  const lines = result.lines.filter((line) => line.text.trim());
  const motifs = lines.slice(0, 8).map((line, index) => ({
    id: `lyric-line-${index}-${stable(line.text)}`,
    kind: 'symbol' as const,
    label: line.text,
    attributes: [],
    confidence: result.confidence,
    source: 'lyrics' as const,
  }));
  if (!motifs.length) return null;
  return {
    revision,
    thesis: 'meaning imported from timed lyric evidence',
    language: result.language,
    motifs,
    relations: [],
    sections: [{
      index: 0,
      startSec: lines[0]!.startSec,
      endSec: lines.at(-1)?.endSec,
      action: 'lyric evidence unfolds through the frame',
      activeMotifs: motifs.map((motif) => motif.id),
      affect: [],
      confidence: result.confidence,
    }],
    evidence: lines.map((line) => ({
      source: 'lyrics' as const,
      text: line.text,
      confidence: result.confidence,
      startSec: line.startSec,
      endSec: line.endSec,
    })),
    abstained: false,
  };
}

function stable(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
