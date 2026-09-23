import type { TrackContext } from '../director/director';
import type { LyricCue, LyricSource } from './types';

/** Deterministic fixture source for clock/toggle tests and local UI review. */
export class FixtureLyricSource implements LyricSource {
  readonly name = 'fixture';
  readonly configured = true;

  async load(_track: TrackContext): Promise<LyricCue[]> {
    return [
      { id: 'fixture-1', start: 0, end: 4, text: 'A signal becomes a shape', source: this.name, confidence: 1 },
      { id: 'fixture-2', start: 4, end: 8, text: 'A shape becomes a world', source: this.name, confidence: 1 },
    ];
  }
}
