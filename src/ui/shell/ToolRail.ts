// BlastSimulator2026 — Tool rail (redesign P1)
// Replaces the old vertical toolbar. Same panel-routing contract
// (#bs-toolbar, [data-panel]) so tutorial highlight targets and the
// scenario/interaction harnesses keep resolving it unchanged.

import { iconEl, type IconName } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import { paintToggleButton } from '../dom.js';
import type { PanelName } from '../UIManager.js';
import type { GameState } from '../../core/state/GameState.js';
import { shellLayoutRegistry, type Viewport, type Rect } from './LayoutRegistry.js';
import { TOPBAR_HEIGHT_PX, MINIMAP_HEIGHT_PX, MINIMAP_EDGE_OFFSET_PX } from '../tokens.js';

interface RailEntry {
  readonly panel: PanelName;
  readonly icon: IconName;
  /** Omitted for the unlabeled shady entry — design: no label, no tooltip, no record of what it is. */
  readonly labelKey?: string;
  /** Starts hidden; ToolRail.update() reveals it once the condition is met and never hides it again. */
  readonly revealWhen?: (state: GameState) => boolean;
}

// Rail label follows the redesign glossary (Crew, not Employees; Fleet, not
// Vehicles) — `data-panel` values are unchanged so selectors keep resolving.
const RAIL_ENTRIES: readonly RailEntry[] = [
  { panel: 'blast', icon: 'blast', labelKey: 'shell.rail.blast' },
  { panel: 'survey', icon: 'survey', labelKey: 'shell.rail.survey' },
  { panel: 'contracts', icon: 'contract', labelKey: 'shell.rail.contracts' },
  { panel: 'ops', icon: 'ops', labelKey: 'shell.rail.ops' },
  { panel: 'build', icon: 'build', labelKey: 'shell.rail.build' },
  { panel: 'vehicles', icon: 'vehicle', labelKey: 'shell.rail.vehicles' },
  { panel: 'employees', icon: 'crew', labelKey: 'shell.rail.employees' },
  // No label, no tooltip: the player notices it only once it's there.
  { panel: 'shady', icon: 'shady', revealWhen: (s) => s.corruption.level > 0 || s.corruption.mafiaUnlocked },
  { panel: 'settings', icon: 'settings', labelKey: 'shell.rail.settings' },
];

/** Right-edge offset of the rail, matching its `right:` inline style below. */
const RAIL_RIGHT_OFFSET_PX = 12;
/**
 * Per-entry button height, matching its inline style below. 46, not the 52 it
 * was: at the smallest supported viewport (1280x720) the band between the top
 * bar and the MiniMap is 488px, and a fully revealed rail — all 9 entries,
 * `shady` included, and a revealed entry never re-hides — was 506px tall, so
 * it painted over the map (#983). The button still holds an 18px icon, a 5px
 * gap and a 9px label with room to spare.
 */
const RAIL_BUTTON_HEIGHT_PX = 46;
/** Per-entry button width, matching its inline style below. */
const RAIL_BUTTON_WIDTH_PX = 58;
/** Rail container padding, matching its inline style below. */
const RAIL_PADDING_PX = 6;
/** Gap between rail buttons, matching its inline style below. */
const RAIL_GAP_PX = 3;
/** Container border, matching its `border:` inline style below — part of the painted box, so the declared bounds carry it. */
const RAIL_BORDER_PX = 1;

/** Clearance between the rail's bottom edge and the MiniMap's reserved strip. */
const RAIL_MINIMAP_GAP_PX = 8;

/**
 * The bottom strip the rail may not enter: the MiniMap plus its edge offset
 * and a gap. Mirrored by the `top:` calc() in the constructor below.
 */
const RAIL_BOTTOM_RESERVED_PX = MINIMAP_EDGE_OFFSET_PX + MINIMAP_HEIGHT_PX + RAIL_MINIMAP_GAP_PX;

/** Height at full reveal — RAIL_ENTRIES.length, since a revealed gated entry ('shady') never re-hides. */
function toolRailHeight(): number {
  const entryCount = RAIL_ENTRIES.length;
  return RAIL_BORDER_PX * 2 + RAIL_PADDING_PX * 2 + entryCount * RAIL_BUTTON_HEIGHT_PX + (entryCount - 1) * RAIL_GAP_PX;
}

/**
 * Right-edge strip, centred in the band between the top bar and the MiniMap's
 * reserved strip rather than in the viewport (#983). Centring on the viewport
 * put the rail's lower half over the map at short viewport heights, where the
 * band is the binding constraint and the viewport's midpoint is not.
 */
function toolRailBounds(viewport: Viewport): Rect {
  const width = RAIL_BORDER_PX * 2 + RAIL_PADDING_PX * 2 + RAIL_BUTTON_WIDTH_PX;
  const height = toolRailHeight();
  const bandTop = TOPBAR_HEIGHT_PX;
  const bandBottom = viewport.height - RAIL_BOTTOM_RESERVED_PX;
  return {
    x: viewport.width - RAIL_RIGHT_OFFSET_PX - width,
    y: bandTop + (bandBottom - bandTop - height) / 2,
    width,
    height,
  };
}

export class ToolRail {
  private readonly el: HTMLElement;
  private readonly locale = new LocaleTextRegistry();
  private activePanel: PanelName | null = null;

  constructor(container: HTMLElement, onSelect: (panel: PanelName) => void) {
    this.el = document.createElement('div');
    this.el.id = 'bs-toolbar';
    this.el.className = 'bsx-root';
    this.el.style.cssText = [
      'position:fixed', `right:${RAIL_RIGHT_OFFSET_PX}px`,
      // Midpoint of [topbar bottom, viewport bottom - reserved strip], which is
      // what toolRailBounds() computes — keep the two in step.
      `top:calc((var(--bsx-topbar-height) + 100vh - ${RAIL_BOTTOM_RESERVED_PX}px) / 2)`, 'transform:translateY(-50%)',
      'z-index:var(--bsx-z-rail)', 'display:flex', 'flex-direction:column', `gap:${RAIL_GAP_PX}px`,
      `padding:${RAIL_PADDING_PX}px`, 'border-radius:8px', 'background:rgba(18,22,28,.92)',
      'border:1px solid var(--bsx-hairline-strong)', 'box-shadow:0 10px 30px rgba(0,0,0,.4)',
      'pointer-events:all',
    ].join(';');

    for (const entry of RAIL_ENTRIES) {
      const btn = document.createElement('button');
      btn.dataset['panel'] = entry.panel;
      btn.style.cssText = [
        `width:${RAIL_BUTTON_WIDTH_PX}px`, `height:${RAIL_BUTTON_HEIGHT_PX}px`, 'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center', 'gap:5px',
        'border:1px solid transparent', 'border-radius:5px', 'background:transparent',
        'color:var(--bsx-text-muted)', 'cursor:pointer', 'position:relative',
      ].join(';');
      if (entry.revealWhen) btn.style.display = 'none';
      btn.appendChild(iconEl(entry.icon, 18));
      if (entry.labelKey) {
        const label = document.createElement('span');
        label.style.cssText = 'font:700 9px/1 var(--bsx-font-ui);letter-spacing:.06em';
        this.locale.bindText(label, entry.labelKey);
        btn.appendChild(label);
      }
      btn.addEventListener('click', () => onSelect(entry.panel));
      btn.addEventListener('mouseenter', () => { if (this.activePanel !== entry.panel) btn.style.background = 'rgba(255,255,255,.07)'; });
      btn.addEventListener('mouseleave', () => { if (this.activePanel !== entry.panel) btn.style.background = 'transparent'; });
      this.el.appendChild(btn);
    }

    container.appendChild(this.el);

    shellLayoutRegistry.register({ id: 'tool-rail', layer: 'hud', bounds: toolRailBounds });
  }

  /** Reveal any gated rail entry (currently just 'shady') once its condition is met. Never re-hides. */
  update(state: GameState): void {
    for (const entry of RAIL_ENTRIES) {
      if (!entry.revealWhen || !entry.revealWhen(state)) continue;
      const btn = this.el.querySelector<HTMLButtonElement>(`button[data-panel="${entry.panel}"]`);
      if (btn && btn.style.display === 'none') btn.style.display = 'flex';
    }
  }

  /** Highlight the active rail entry (or none) and translate its title tooltip. */
  setActive(panel: PanelName | null): void {
    this.activePanel = panel;
    this.el.querySelectorAll<HTMLButtonElement>('button[data-panel]').forEach(btn => {
      paintToggleButton(btn, btn.dataset['panel'] === panel);
    });
  }

  refreshLocale(): void { this.locale.refresh(); }

  /** Hidden pre-game (redesign P8) — this is HUD chrome, nothing to show before a level exists. */
  show(): void { this.el.style.display = 'flex'; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  dispose(): void {
    this.el.remove();
    shellLayoutRegistry.unregister('tool-rail');
  }
}
