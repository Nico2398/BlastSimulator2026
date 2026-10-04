// BlastSimulator2026 — Hole delay label for the blast plan overlay.
// Camera-facing text plane showing a hole's detonation delay.

import * as THREE from 'three';
import { t } from '../core/i18n/I18n.js';
import { BLAST_DELAY_LABEL_COLOR_BUCKET_MS, BLAST_DELAY_LABEL_COLORS } from '../core/config/balance.js';

const LABEL_WIDTH = 1.0; // under the ~1-tile hole spacing so neighbours do not overlap
const LABEL_HEIGHT = 0.5;
const LABEL_RENDER_ORDER = 15;
const CANVAS_WIDTH = 128;
const CANVAS_HEIGHT = 64;
const CANVAS_BG = 'rgba(0, 0, 0, 0.65)';
const FONT_HEIGHT_RATIO = 0.6;
const FONT_MIN_PX = 8;
const TEXT_PADDING_PX = 8;


interface HoleDelayLabelSpec {
  /** Localised label text, e.g. "150 ms". */
  text: string;
  /** Bucket colour as 0xRRGGBB (flat-colour fallback without DOM). */
  color: number;
  /** Same colour as a CSS string for canvas text. */
  cssColor: string;
}

/** Pure: label text + colour for a delay; null when the delay is negative (unsequenced). */
export function holeDelayLabelSpec(delayMs: number): HoleDelayLabelSpec | null {
  if (delayMs < 0) return null;
  const bucket = Math.min(
    BLAST_DELAY_LABEL_COLORS.length - 1,
    Math.floor(delayMs / BLAST_DELAY_LABEL_COLOR_BUCKET_MS),
  );
  const color = BLAST_DELAY_LABEL_COLORS[bucket]!;
  return {
    text: t('blast.overlay.delay_ms', { ms: Math.round(delayMs) }),
    color,
    cssColor: `#${color.toString(16).padStart(6, '0')}`,
  };
}

function drawText(ctx: CanvasRenderingContext2D, spec: HoleDelayLabelSpec): void {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  let px = Math.round(CANVAS_HEIGHT * FONT_HEIGHT_RATIO);
  ctx.font = `bold ${px}px sans-serif`;
  const maxWidth = CANVAS_WIDTH - TEXT_PADDING_PX * 2;
  const measured = ctx.measureText(spec.text).width;
  if (measured > maxWidth) {
    px = Math.max(FONT_MIN_PX, Math.floor(px * maxWidth / measured));
    ctx.font = `bold ${px}px sans-serif`;
  }
  ctx.fillStyle = spec.cssColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.text, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
}

/**
 * Canvas-text material; flat colour when no `document` / 2D context exists
 * (Node-only test workers) — same guard as BuildingOccupancyLabels.
 */
function buildMaterial(spec: HoleDelayLabelSpec): THREE.MeshBasicMaterial {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (ctx !== null) {
      drawText(ctx, spec);
      return new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false, depthWrite: false,
      });
    }
  }
  return new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, depthTest: false, depthWrite: false });
}

/** Plane mesh with canvas text (flat colour without DOM); sets `userData.delayLabelText`. */
export function createHoleDelayLabel(spec: HoleDelayLabelSpec): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(LABEL_WIDTH, LABEL_HEIGHT), buildMaterial(spec));
  mesh.renderOrder = LABEL_RENDER_ORDER;
  mesh.userData['delayLabelText'] = spec.text;
  return mesh;
}
