// BlastSimulator2026 — Loading screen decorative backdrop (extracted from
// LoadingScreen.ts to keep that file under the 300-line convention, #493).
//
// Pure decoration: computed once from constants, no instance state, no
// gameplay data. `LoadingScreen`'s constructor calls `buildStrataBackdrop()`
// once and appends the result behind the rest of the overlay.

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

export function buildStrataBackdrop(): SVGSVGElement {
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
