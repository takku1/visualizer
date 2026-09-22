import type { FeatureFrame, VisualPlan } from '../types';

/**
 * Fullscreen canvas plus a diagnostic HUD.
 *
 * The HUD is not decoration. When the picture looks wrong, the question is
 * always the same - is the audio dead, or did the director pick badly? - and
 * the answer is only visible if the live distributions are on screen. It also
 * shows which engine produced the plan, which is the whole point when two
 * engines speak the same protocol.
 */
export class Overlay {
  readonly root: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  #hud: HTMLDivElement;
  #toggle: HTMLDivElement;
  #detail: HTMLDivElement;
  #hudVisible = true;
  /** Collapsed by default: a one-line strip, not a wall of numbers over the art. */
  #expanded = false;
  #mounted = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 's1-visualizer';
    this.root.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483000',
      'background:#000', 'display:none',
    ].join(';');

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block';

    this.#hud = document.createElement('div');
    this.#hud.style.cssText = [
      'position:absolute', 'left:16px', 'bottom:16px',
      'font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'color:rgba(255,255,255,.72)', 'text-shadow:0 1px 3px rgba(0,0,0,.9)',
      // No background anywhere in this element or its children, collapsed or
      // expanded - legibility comes from the text-shadow alone, on purpose.
      'white-space:pre', 'letter-spacing:.02em',
    ].join(';');

    this.#toggle = document.createElement('div');
    this.#toggle.style.cssText = 'cursor:pointer;pointer-events:auto;user-select:none;opacity:.85';
    this.#toggle.addEventListener('click', () => {
      this.#expanded = !this.#expanded;
      this.#detail.style.display = this.#expanded ? 'block' : 'none';
      this.#toggle.textContent = this.#expanded ? '▾ capture info' : '▸ capture info';
    });

    this.#detail = document.createElement('div');
    this.#detail.style.cssText = 'display:none;pointer-events:none;margin-top:4px';

    this.#hud.append(this.#toggle, this.#detail);
    this.root.append(this.canvas, this.#hud);
  }

  mount(): void {
    if (this.#mounted) return;
    document.body.appendChild(this.root);
    this.#mounted = true;
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  show(): void {
    this.mount();
    this.root.style.display = 'block';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  toggleHud(): void {
    this.#hudVisible = !this.#hudVisible;
    this.#hud.style.display = this.#hudVisible ? 'block' : 'none';
  }

  /** Replace the HUD with a centered message. Used for errors and prompts. */
  notice(text: string): void {
    this.#toggle.style.display = 'none';
    this.#detail.style.cssText = 'display:block;pointer-events:none;margin-top:0';
    this.#hud.style.cssText += ';left:50%;bottom:50%;transform:translate(-50%,50%);text-align:center';
    this.#detail.textContent = text;
  }

  update(f: FeatureFrame, plan: VisualPlan, extra: string[] = [], track?: { title?: string; artist?: string }): void {
    if (!this.#hudVisible) return;

    // The collapsed strip: the track when there is one to show (only the
    // Spicetify build has this - standalone/Electron have no track source),
    // otherwise a plain label. Either way it reads as clickable rather than
    // as a fixed label, so the caret always sits at the end.
    const label = track?.title
      ? `${track.artist ? `${track.artist} - ` : ''}${track.title}`
      : 'capture info';
    this.#toggle.textContent = `${label} ${this.#expanded ? '▾' : '▸'}`;

    if (!this.#expanded) return;

    const lines = [
      `engine  ${plan.origin}${plan.latencyMs ? `  ${Math.round(plan.latencyMs)}ms` : ''}`,
      `motion  ${dist(plan.motion.p)}`,
      `color   ${dist(plan.palette.p)}`,
      `texture ${dist(plan.texture.p)}`,
      `geo     ${dist(plan.geometry.p)}`,
      `sym     ${dist(plan.symmetry.p)}`,
      `fb      ${dist(plan.feedback.p)}`,
      `energy  ${bar(plan.intensity / 4)} ${plan.intensity.toFixed(1)}`,
      '',
      `level   ${bar(f.level)}`,
      `bass    ${bar(f.bass)}`,
      `mid     ${bar(f.mid)}`,
      `treble  ${bar(f.treble)}`,
      `onset   ${bar(f.flux)}  bass ${f.bassFlux.toFixed(2)}  treble ${f.trebleFlux.toFixed(2)}`,
      `tempo   ${Math.round(f.tempo)} bpm${f.hasStructure ? '' : ' (estimated)'}`,
      `key     ${NOTE_NAMES[f.estimatedKey] ?? '?'} ${f.estimatedMode}  (${f.keyConfidence.toFixed(2)} conf, local est.)`,
      `width   ${bar(f.stereoWidth)}   rel.level ${f.levelRelative >= 0 ? '+' : ''}${f.levelRelative.toFixed(2)}σ`,
      ...extra,
    ];

    this.#detail.textContent = lines.join('\n');
  }
}

/** Render a distribution as sorted `label .62` pairs, heaviest first. */
function dist(p: Record<string, number | undefined>): string {
  return Object.entries(p)
    .filter((e): e is [string, number] => typeof e[1] === 'number')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join('  ');
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLOCKS = ' ▁▂▃▄▅▆▇█';

function bar(v: number, width = 12): string {
  const clamped = Math.min(Math.max(v, 0), 1);
  const filled = clamped * width;
  let out = '';
  for (let i = 0; i < width; i++) {
    const level = Math.min(Math.max(filled - i, 0), 1);
    out += BLOCKS[Math.round(level * (BLOCKS.length - 1))] ?? ' ';
  }
  return out;
}
