// BlastSimulator2026 — Level loading screen (redesign P8, strata backdrop)
//
// Entering a level runs several seconds of synchronous work — terrain
// generation, then marching-cubes meshing of both the playable grid and the
// landscape. On the largest sites that is over five seconds during which the
// main thread never yields.
//
// The important part is not the overlay itself but WHEN it reaches the
// screen. `show(); generateEverything(); hide();` displays nothing at all: the
// browser has no opportunity to paint between the three statements, so the
// player sees one long freeze and then the finished level. `runPhases` exists
// to solve exactly that — it waits for a frame to be presented before each
// blocking chunk, so the overlay and its current label are actually on screen
// while the work happens.

import { t } from '../core/i18n/I18n.js';
import { QuipBag } from './loadingQuips.js';
import { iconEl } from './icons.js';

/**
 * Resolve once the browser has presented a frame.
 *
 * A single requestAnimationFrame is not enough: the callback runs BEFORE the
 * paint it belongs to, so returning there still blocks the main thread before
 * anything reaches the screen. The nested call resolves on the following
 * frame, by which point the previous one has been presented.
 */
export function nextPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame !== 'function') { resolve(); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * One blocking step of a load.
 *
 * No caption: the screen shows a satirical line instead of naming the work.
 * Reporting "Generating terrain" made the wait feel like somebody else's
 * status meeting, and the phases are not the player's problem anyway.
 */
export interface LoadPhase {
  run: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * Opaque geological cross-section backdrop, matching the design comp's own
 * construction: 7 wavy horizontal strata bands (drawn back-to-front so each
 * later band's tone paints over the previous one's lower portion), seam
 * lines on the boundary between them, scattered ore ellipses, and two dashed
 * borehole guide lines with depth ticks. It reads as the site's own survey
 * diagram rather than a render — computed once, since it is decoration, not
 * gameplay data tied to any particular level.
 */
function waveTrace(yTop: number, amp: number, phase: number): string {
  const pts: string[] = [];
  for (let x = 0; x <= 1600; x += 64) {
    const y = yTop
      + Math.sin((x / 1600) * Math.PI * 3 + phase) * amp
      + Math.sin((x / 1600) * Math.PI * 6.2 + phase * 1.7) * amp * 0.34;
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return pts.join(' L');
}

const STRATA_TONES = ['#161c24', '#1b222b', '#202832', '#1c232c', '#171d25', '#13181f', '#0f1318'];
const DEPTH_TICKS = [214, 300, 386, 472, 558, 644, 730];

function buildStrataBackdrop(): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 1600 900', preserveAspectRatio: 'xMidYMid slice' });
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  svg.appendChild(svgEl('rect', { x: '0', y: '0', width: '1600', height: '900', fill: '#0d1116' }));

  const bandTraces: string[] = [];
  STRATA_TONES.forEach((fill, i) => {
    const trace = waveTrace(212 + i * 96, 20 - i * 1.6, i * 1.9);
    bandTraces.push(trace);
    svg.appendChild(svgEl('path', { d: `M${trace} L1600,900 L0,900 Z`, fill }));
  });
  for (let i = 1; i < bandTraces.length; i++) {
    svg.appendChild(svgEl('path', {
      d: `M${bandTraces[i]}`, fill: 'none', stroke: 'rgba(255,255,255,.05)', 'stroke-width': '1',
    }));
  }

  for (let i = 0; i < 16; i++) {
    const a = i * 2.399;
    svg.appendChild(svgEl('ellipse', {
      cx: (240 + ((i * 337) % 1120)).toFixed(0),
      cy: (430 + Math.sin(a) * 118 + (i % 3) * 26).toFixed(0),
      rx: (7 + (i % 4) * 3.4).toFixed(1),
      ry: (3 + (i % 3) * 1.5).toFixed(1),
      fill: 'rgba(169,140,255,.16)',
    }));
  }

  svg.appendChild(svgEl('line', {
    x1: '1318', y1: '150', x2: '1318', y2: '742',
    stroke: 'rgba(255,176,46,.16)', 'stroke-width': '1.5', 'stroke-dasharray': '7 6',
  }));
  for (const y of DEPTH_TICKS) {
    svg.appendChild(svgEl('line', { x1: '1306', y1: `${y}`, x2: '1330', y2: `${y}`, stroke: 'rgba(255,176,46,.13)', 'stroke-width': '1.5' }));
  }
  svg.appendChild(svgEl('line', {
    x1: '196', y1: '196', x2: '196', y2: '640',
    stroke: 'rgba(255,255,255,.05)', 'stroke-width': '1.5', 'stroke-dasharray': '7 6',
  }));

  return svg;
}

export class LoadingScreen {
  private readonly overlay: HTMLElement;
  private readonly label: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly percentEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly quips = new QuipBag();

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'bs-loading-screen';
    // Above the main menu and the sandbox panel — a load can start from either.
    this.overlay.style.cssText = [
      'position:fixed;inset:0;z-index:10500;display:none',
      'align-items:center;justify-content:center',
      // overflow before background: jsdom's cssstyle parser silently voids
      // the whole cssText when a `background` shorthand is followed by an
      // `overflow` declaration in the same string (reproduced in isolation;
      // `overflow-then-background` and `background-color` both parse fine).
      'overflow:hidden;background:#0d1116',
    ].join(';');

    this.overlay.appendChild(buildStrataBackdrop());

    const vignette = document.createElement('div');
    vignette.style.cssText = 'position:absolute;inset:0;'
      + 'background:radial-gradient(96% 76% at 50% 44%, rgba(26,32,40,.55), rgba(11,14,19,.92) 74%)';
    this.overlay.appendChild(vignette);

    const column = document.createElement('div');
    column.style.cssText = 'position:relative;z-index:1;width:100%;max-width:640px;padding:0 24px;'
      + 'display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center';

    this.titleEl = document.createElement('div');
    this.titleEl.style.cssText = 'font:900 32px/1.15 var(--bsx-font-ui, sans-serif);letter-spacing:-.02em;color:var(--bsx-text-primary, #f2f4f7)';

    const phaseLine = document.createElement('div');
    phaseLine.style.cssText = 'display:flex;align-items:center;gap:9px;color:var(--bsx-text-secondary, #c9d1db)';
    const chev = iconEl('chevR', 10);
    chev.style.color = 'var(--bsx-text-muted, #8a94a2)';
    this.label = document.createElement('span');
    this.label.id = 'bs-loading-label';
    this.label.style.cssText = 'font:400 13px/1.5 var(--bsx-font-ui, sans-serif)';
    phaseLine.append(chev, this.label);

    const progressBlock = document.createElement('div');
    progressBlock.style.cssText = 'width:100%;display:flex;flex-direction:column;gap:8px';

    const track = document.createElement('div');
    track.style.cssText = 'height:6px;border-radius:3px;overflow:hidden;background:#1b212a';
    this.barFill = document.createElement('div');
    this.barFill.id = 'bs-loading-bar';
    this.barFill.style.cssText = 'height:100%;width:0%;background:var(--bsx-amber, #ffb02e);transition:width 120ms linear';
    track.appendChild(this.barFill);

    this.percentEl = document.createElement('div');
    this.percentEl.style.cssText = 'align-self:flex-end;font:600 12px/1 var(--bsx-font-mono, monospace);color:var(--bsx-text-muted, #8a94a2)';

    progressBlock.append(track, this.percentEl);
    column.append(this.titleEl, phaseLine, progressBlock);
    this.overlay.appendChild(column);
    container.appendChild(this.overlay);

    // The scenario harness asserts visibility on the DOM node itself — the
    // element is the only handle a Puppeteer-side assert has — so mirror the
    // getter there.
    Object.defineProperty(this.overlay, 'visible', { get: () => this.visible });
  }

  get visible(): boolean { return this.overlay.style.display !== 'none'; }

  /** Caption currently shown — exposed so tests can assert phase progression. */
  get phaseText(): string { return this.label.textContent ?? ''; }

  /** Progress as a 0-1 fraction, read back off the bar. */
  get progress(): number { return parseFloat(this.barFill.style.width) / 100; }

  show(): void {
    this.titleEl.textContent = t('loading.title');
    this.setPhase(this.quips.next(), 0);
    this.overlay.style.display = 'flex';
  }

  /** `caption` is shown verbatim — the quips are not translated strings. */
  setPhase(caption: string, fraction: number): void {
    const clamped = Math.min(1, Math.max(0, fraction));
    this.label.textContent = caption;
    this.barFill.style.width = `${Math.round(clamped * 100)}%`;
    this.percentEl.textContent = `${Math.round(clamped * 100)}%`;
  }

  /** Next unused quip, so a caller driving its own phases can label them. */
  nextQuip(): string { return this.quips.next(); }

  hide(): void { this.overlay.style.display = 'none'; }

  dispose(): void { this.overlay.remove(); }

  /**
   * Run each phase with the overlay visible and its caption up to date.
   *
   * Every phase gets a presented frame before it starts, which is what keeps
   * the screen from being a decoration painted only after the work is done.
   * The overlay is hidden even if a phase throws, so a failed load can never
   * strand the player behind an opaque panel.
   */
  async runPhases(phases: readonly LoadPhase[]): Promise<void> {
    this.show();
    await nextPaint();
    try {
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i]!;
        // (i+1)/(n+1), not i/n: the bar would otherwise sit at zero through
        // the longest phase, which reads as nothing happening. This starts it
        // moving on the first phase and still leaves the last step for "ready".
        this.setPhase(this.quips.next(), (i + 1) / (phases.length + 1));
        await nextPaint();
        phase.run();
      }
      this.setPhase(t('loading.ready'), 1);
      await nextPaint();
    } finally {
      this.hide();
    }
  }
}
