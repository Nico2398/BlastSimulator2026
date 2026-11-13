// BlastSimulator2026 — Portrait tiles (#2241)
// The picture of an employee, vehicle or building: its pre-rendered
// thumbnail (src/renderer/models/Thumbnails.ts) on a soft backdrop in the
// entity's accent colour, with small badges for what the picture alone cannot
// say — the tier, an injury, a collapse, a wreck. One builder serves the
// inspector header and every grid card, so a card and the window it opens
// show the same face.

import type { EmployeeRole } from '../core/entities/Employee.js';
import type { VehicleRole, VehicleTier } from '../core/entities/Vehicle.js';
import { isSingleTierType, type BuildingTier, type BuildingType } from '../core/entities/Building.js';
import { buildingModelId, vehicleModelId, workerModelId } from '../renderer/models/ModelIds.js';
import { thumbnailUrl } from '../renderer/models/Thumbnails.js';
import { ROLE_COLORS } from '../renderer/CharacterMesh.js';
import { el } from './dom.js';

/** Edge of a portrait tile, in px. */
export type PortraitSize = 40 | 56 | 72 | 96 | 120;

/** State a badge reports on top of the picture; `none` draws the picture alone. */
type PortraitState = 'none' | 'injured' | 'collapsed' | 'wrecked' | 'damaged' | 'destroyed';

export interface PortraitSpec {
  /** Thumbnail model id (`worker_driller`, `vehicle_drill_rig_t2`, `building_geology_lab_t1`). */
  readonly id: string;
  /** Accent hex behind the picture. */
  readonly accent: string;
  /** Short caption in the bottom-right badge (a tier, `T2`), or none. */
  readonly badge?: string;
  /** Short caption in the bottom-left badge (initials), or none. */
  readonly monogram?: string;
  readonly state?: PortraitState;
  /** Spoken name for assistive tech. */
  readonly alt: string;
}

/** Vehicles and buildings share one accent per family: the Fleet info blue and the Build amber. */
const VEHICLE_ACCENT = '#55a8ff';
const BUILDING_ACCENT = '#ffb02e';

function hex(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

export function employeePortraitSpec(e: { role: EmployeeRole; name: string; injured?: boolean; collapsing?: boolean }): PortraitSpec {
  const state: PortraitState = e.collapsing ? 'collapsed' : e.injured ? 'injured' : 'none';
  return {
    id: workerModelId(e.role), accent: hex(ROLE_COLORS[e.role]), state, alt: e.name,
    monogram: e.name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2),
  };
}

/** A hiring candidate or a role in general: the role's face, no per-person state. */
export function rolePortraitSpec(role: EmployeeRole, alt: string): PortraitSpec {
  return { id: workerModelId(role), accent: hex(ROLE_COLORS[role]), alt };
}

/** `hpFraction` below one shows wear: under a third reads as wrecked. */
export function vehiclePortraitSpec(role: VehicleRole, tier: VehicleTier, alt: string, hpFraction = 1): PortraitSpec {
  const state: PortraitState = hpFraction <= 0 ? 'destroyed' : hpFraction < 1 / 3 ? 'wrecked' : 'none';
  return { id: vehicleModelId(role, tier), accent: VEHICLE_ACCENT, badge: `T${tier}`, state, alt };
}

export function buildingPortraitSpec(type: BuildingType, tier: BuildingTier, alt: string, hpFraction = 1): PortraitSpec {
  const single = isSingleTierType(type);
  const state: PortraitState = hpFraction <= 0 ? 'destroyed' : hpFraction < 1 / 3 ? 'damaged' : 'none';
  return {
    id: buildingModelId(type, single ? 1 : tier), accent: BUILDING_ACCENT, state, alt,
    ...(single ? {} : { badge: `T${tier}` }),
  };
}

/** Glyph and tone of each state badge. */
const STATE_BADGE: Record<Exclude<PortraitState, 'none'>, { glyph: string; tone: string }> = {
  injured: { glyph: '+', tone: 'var(--bsx-critical)' },
  collapsed: { glyph: 'z', tone: 'var(--bsx-amber)' },
  wrecked: { glyph: '!', tone: 'var(--bsx-critical)' },
  damaged: { glyph: '!', tone: 'var(--bsx-amber)' },
  destroyed: { glyph: '×', tone: 'var(--bsx-critical)' },
};

/**
 * The tile: picture over a radial wash of the accent, badges in the corners.
 * Class hooks: `.bsx-portrait` on the tile, `data-portrait` = the thumbnail id,
 * `data-state` = the state, so tests and scenarios can read what is shown.
 */
export function portraitEl(spec: PortraitSpec, size: PortraitSize): HTMLElement {
  const state = spec.state ?? 'none';
  const tile = el('div', {
    className: `bsx-portrait bsx-portrait-${size}`,
    attrs: { 'data-portrait': spec.id, 'data-state': state, role: 'img', 'aria-label': spec.alt },
  });
  tile.style.setProperty('--bsx-portrait-accent', spec.accent);
  const img = el('img', { attrs: { src: thumbnailUrl(spec.id), alt: '', draggable: 'false', loading: 'lazy', decoding: 'async' } });
  tile.appendChild(img);
  if (spec.monogram) tile.appendChild(el('span', { className: 'bsx-portrait-monogram', text: spec.monogram }));
  if (spec.badge) tile.appendChild(el('span', { className: 'bsx-portrait-badge', text: spec.badge }));
  if (state !== 'none') {
    const badge = STATE_BADGE[state];
    const mark = el('span', { className: 'bsx-portrait-state', text: badge.glyph });
    mark.style.background = badge.tone;
    tile.appendChild(mark);
  }
  return tile;
}

/** CSS for the tile, injected once with the design tokens (tokens.ts). */
export const PORTRAIT_CSS = `
.bsx-portrait {
  position: relative; flex: 0 0 auto; border-radius: 8px; overflow: hidden;
  background:
    radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--bsx-portrait-accent) 34%, transparent) 0%, transparent 68%),
    linear-gradient(180deg, #1f2631 0%, #151a21 100%);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.07);
}
.bsx-portrait img {
  position: absolute; inset: 4%; width: 92%; height: 92%; object-fit: contain;
  filter: drop-shadow(0 3px 4px rgba(0,0,0,.45)); pointer-events: none; user-select: none;
}
.bsx-portrait-40 { width: 40px; height: 40px; border-radius: 6px; }
.bsx-portrait-56 { width: 56px; height: 56px; }
.bsx-portrait-72 { width: 72px; height: 72px; }
.bsx-portrait-96 { width: 96px; height: 96px; border-radius: 10px; }
.bsx-portrait-120 { width: 120px; height: 120px; border-radius: 10px; }
.bsx-portrait[data-state="collapsed"] img, .bsx-portrait[data-state="destroyed"] img { filter: grayscale(.85) brightness(.75); }
.bsx-portrait[data-state="injured"] img { filter: drop-shadow(0 3px 4px rgba(0,0,0,.45)) sepia(.35) saturate(1.4) hue-rotate(-20deg); }
.bsx-portrait-badge, .bsx-portrait-monogram {
  position: absolute; bottom: 3px; padding: 1px 4px; border-radius: 3px;
  font: 700 9px/1.2 var(--bsx-font-mono); letter-spacing: .04em;
  background: rgba(11,14,18,.78); color: var(--bsx-text-secondary);
}
.bsx-portrait-badge { right: 3px; }
.bsx-portrait-monogram { left: 3px; color: var(--bsx-portrait-accent); }
.bsx-portrait-40 .bsx-portrait-badge, .bsx-portrait-40 .bsx-portrait-monogram { display: none; }
.bsx-portrait-state {
  position: absolute; top: 3px; right: 3px; width: 15px; height: 15px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font: 800 10px/1 var(--bsx-font-ui); color: #12161c; box-shadow: 0 0 0 2px rgba(11,14,18,.8);
}
`;
