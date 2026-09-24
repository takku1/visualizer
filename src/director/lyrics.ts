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
