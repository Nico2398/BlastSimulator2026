// @vitest-environment jsdom
// #1423 — LeftColumn shell region: owns bs-left-col and declares its envelope.
import { afterEach, describe, expect, it } from 'vitest';
import { LeftColumn, leftColumnBounds, LEFT_COL_RIGHT_EDGE_PX } from '../../../../src/ui/shell/LeftColumn.js';
import { shellLayoutRegistry } from '../../../../src/ui/shell/LayoutRegistry.js';
import { PANEL_WIDTH_PX } from '../../../../src/ui/dom.js';

describe('LeftColumn (#1423)', () => {
  let col: LeftColumn | null = null;
  afterEach(() => { col?.dispose(); col = null; });

  it('registers as hud region "left-col" and unregisters on dispose', () => {
    const container = document.createElement('div');
    col = new LeftColumn(container);
    const region = shellLayoutRegistry.list().find(r => r.id === 'left-col');
    expect(region).toBeDefined();
    expect(region!.layer).toBe('hud');
    col.dispose();
    col = null;
    expect(shellLayoutRegistry.has('left-col')).toBe(false);
  });

  it('builds #bs-left-col and appends it to the container', () => {
    const container = document.createElement('div');
    col = new LeftColumn(container);
    expect(col.el.id).toBe('bs-left-col');
    expect(col.el.parentElement).toBe(container);
  });

  it('declares {x:8,y:70,width:372,height:640} at 1280x720', () => {
    expect(leftColumnBounds({ width: 1280, height: 720 })).toEqual({ x: 8, y: 70, width: 372, height: 640 });
  });

  it('right edge is left offset plus one panel width', () => {
    expect(LEFT_COL_RIGHT_EDGE_PX).toBe(8 + PANEL_WIDTH_PX);
  });

  it('registered bounds function matches leftColumnBounds', () => {
    const container = document.createElement('div');
    col = new LeftColumn(container);
    const region = shellLayoutRegistry.list().find(r => r.id === 'left-col')!;
    const vp = { width: 1920, height: 1080 };
    expect(region.bounds(vp)).toEqual(leftColumnBounds(vp));
  });
});
