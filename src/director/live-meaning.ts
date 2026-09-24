import type { LiveMeaningState } from './live-accumulator';
import type { SongMeaning } from './semantic';

/** Promote only accumulator-approved ASR phrases into the normal meaning contract. */
export function meaningFromLive(state: LiveMeaningState, revision: number, sectionIndex: number): SongMeaning | null {
  const committed = state.committed.filter((item) => item.status === 'committed');
  if (!committed.length) return null;
  const motifs = committed.slice(-4).map((item, index) => ({
    id: `live-${index}-${item.id}`,
    kind: 'symbol' as const,
    label: item.text,
    attributes: [],
    confidence: item.confidence,
    source: 'audio' as const,
  }));
  const confidence = committed.reduce((sum, item) => sum + item.confidence, 0) / committed.length;
  return {
    revision,
    thesis: 'meaning discovered from committed live audio evidence',
    language: committed[0]!.language,
    abstained: false,
    motifs,
    relations: [],
    sections: [{
      index: sectionIndex,
      startSec: Math.min(...committed.map((item) => item.startSec)),
      action: 'the vocal motif moves through the frame',
      activeMotifs: motifs.map((motif) => motif.id),
      affect: [],
      confidence,
    }],
    evidence: committed.map((item) => ({
      source: 'audio' as const,
      text: item.text,
      confidence: item.confidence,
      startSec: item.startSec,
      endSec: item.endSec,
    })),
  };
}
