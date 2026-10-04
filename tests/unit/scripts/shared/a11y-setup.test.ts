// BlastSimulator2026 — a11y game bootstrap + panel driving (#1419)
//
// The fake page runs evaluate() callbacks (functions or strings) in Node against
// stubbed `window`/`document` globals, so tests assert on observable effects
// (console commands issued, selectors awaited, clicks, style writes), not on how
// the implementation queries the DOM.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  A11Y_PANELS,
  A11Y_START_COMMAND,
  startGame,
  openPanelViaRail,
  closePanelViaRail,
  assertRegionsPopulated,
  type A11yPage,
} from '../../../../scripts/shared/a11y-setup.js';
import { PANEL_ELEMENT_ID } from '../../../../scripts/shared/interaction-executor.js';

interface FakeOpts {
  /** Panel ids visible before the test acts. */
  visible?: string[];
  /** false: clicking a rail button does nothing (panel never opens). */
  clickToggles?: boolean;
  /** Result __gameConsole returns; 'missing' leaves it undefined. */
  consoleResult?: { success: boolean; output: string } | 'missing';
}

function makeFake(opts: FakeOpts = {}) {
  const visible = new Set(opts.visible ?? []);
  const clickToggles = opts.clickToggles ?? true;
  const consoleCalls: string[] = [];
  const awaited: string[] = [];
  const clicks: string[] = [];
  const styleWrites: { id: string; prop: string; value: unknown }[] = [];
  let evaluateCalls = 0;

  const panelIds = new Set(A11Y_PANELS.map((p) => p.panelId));
  const railToPanel = new Map(A11Y_PANELS.map((p) => [p.rail, p.panelId]));
  const elements = new Map<string, Record<string, unknown>>();

  const isVisible = (id: string) => !panelIds.has(id) || visible.has(id);

  function element(id: string): Record<string, unknown> {
    let el = elements.get(id);
    if (el) return el;
    const style = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => (prop === 'display' ? (isVisible(id) ? '' : 'none') : ''),
      set: (_t, prop, value) => {
        styleWrites.push({ id, prop: String(prop), value });
        return true;
      },
    });
    el = {
      id,
      style,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      get hidden() { return !isVisible(id); },
      get offsetWidth() { return isVisible(id) ? 300 : 0; },
      get offsetHeight() { return isVisible(id) ? 300 : 0; },
      get offsetParent() { return isVisible(id) ? {} : null; },
      getBoundingClientRect: () => (isVisible(id)
        ? { x: 0, y: 0, width: 300, height: 300, top: 0, left: 0, right: 300, bottom: 300 }
        : { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
      getClientRects: () => (isVisible(id) ? [{}] : []),
      setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
      addEventListener() {}, removeEventListener() {},
    };
    elements.set(id, el);
    return el;
  }

  function railButton(rail: string): Record<string, unknown> {
    const key = `rail:${rail}`;
    const existing = elements.get(key);
    if (existing) return existing;
    const press = () => {
      clicks.push(rail);
      const pid = railToPanel.get(rail);
      if (pid && clickToggles) {
        if (visible.has(pid)) visible.delete(pid); else visible.add(pid);
      }
    };
    const el: Record<string, unknown> = {
      ...element(key),
      click: press,
      dispatchEvent: () => { press(); return true; },
      scrollIntoView() {},
    };
    elements.set(key, el);
    return el;
  }

  const lookup = (sel: string): Record<string, unknown> | null => {
    const id = sel.match(/^#([\w-]+)$/);
    if (id) return element(id[1]!);
    const rail = sel.match(/data-panel\s*=\s*["']?([\w-]+)["']?/);
    if (rail && railToPanel.has(rail[1]!)) return railButton(rail[1]!);
    return element(`sel:${sel}`);
  };

  const fakeDocument = {
    getElementById: (id: string) => element(id),
    querySelector: (sel: string) => lookup(sel),
    querySelectorAll: (sel: string) => [lookup(sel)].filter(Boolean),
    body: element('body'),
    documentElement: element('html'),
  };
  const fakeWindow: Record<string, unknown> = {
    getComputedStyle: (el: { id?: string }) => {
      const v = el?.id ? isVisible(el.id) : true;
      return { display: v ? 'block' : 'none', visibility: v ? 'visible' : 'hidden', opacity: '1' };
    },
  };
  if (opts.consoleResult !== 'missing') {
    fakeWindow.__gameConsole = (cmd: string) => {
      consoleCalls.push(cmd);
      return opts.consoleResult ?? { success: true, output: 'ok' };
    };
  }

  const stubs: Record<string, unknown> = {
    window: fakeWindow,
    document: fakeDocument,
    getComputedStyle: fakeWindow.getComputedStyle,
    MouseEvent: class { constructor(public type: string) {} },
    Event: class { constructor(public type: string) {} },
  };

  const page: A11yPage = {
    async evaluate(fn: unknown, ...args: unknown[]) {
      evaluateCalls++;
      for (const [k, v] of Object.entries(stubs)) vi.stubGlobal(k, v);
      let result: unknown = typeof fn === 'string' ? (0, eval)(fn) : fn;
      if (typeof result === 'function') result = (result as (...a: unknown[]) => unknown)(...args);
      return (await result) as never;
    },
    async waitForSelector(sel: string, o?: { visible?: boolean }) {
      awaited.push(sel);
      const id = sel.match(/^#([\w-]+)/);
      if (id && panelIds.has(id[1]!) && o?.visible !== false && !visible.has(id[1]!)) {
        throw new Error(`Waiting for selector \`${sel}\` failed: timeout`);
      }
      return {};
    },
  };

  return {
    page,
    visible,
    consoleCalls,
    awaited,
    clicks,
    styleWrites,
    get evaluateCalls() { return evaluateCalls; },
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('A11Y constants', () => {
  it('start command boots a staffed new game', () => {
    expect(A11Y_START_COMMAND).toContain('new_game');
    expect(A11Y_START_COMMAND).toContain('staffed:true');
  });

  it('covers every tool-rail panel', () => {
    const rails = A11Y_PANELS.map((p) => p.rail);
    for (const r of ['blast', 'survey', 'contracts', 'ops', 'build', 'vehicles', 'employees']) {
      expect(rails).toContain(r);
    }
  });

  it('gives every entry a distinct non-empty panel id', () => {
    const ids = A11Y_PANELS.map((p) => p.panelId);
    expect(ids.every((i) => i.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('startGame', () => {
  it('issues a new_game staffed:true command through __gameConsole', async () => {
    const f = makeFake();
    await startGame(f.page);
    const cmd = f.consoleCalls.find((c) => c.includes('new_game'));
    expect(cmd).toBeDefined();
    expect(cmd).toContain('staffed:true');
  });

  it('waits for the HUD and the rail buttons', async () => {
    const f = makeFake();
    await startGame(f.page);
    expect(f.awaited.some((s) => s.includes('#bs-hud-top'))).toBe(true);
    expect(f.awaited.some((s) => s.includes('data-panel'))).toBe(true);
  });

  it('throws naming __gameConsole when it is missing', async () => {
    const f = makeFake({ consoleResult: 'missing' });
    await expect(startGame(f.page)).rejects.toThrow(/__gameConsole/);
  });

  it('throws including the console output when the command is refused', async () => {
    const f = makeFake({ consoleResult: { success: false, output: 'seed rejected by console' } });
    await expect(startGame(f.page)).rejects.toThrow(/seed rejected by console/);
  });

  it('never writes style.display on the menu or any panel', async () => {
    const f = makeFake();
    await startGame(f.page);
    expect(f.styleWrites.filter((w) => w.prop === 'display')).toEqual([]);
  });
});

describe('openPanelViaRail', () => {
  it('clicks the rail button and ends with the panel visible', async () => {
    const f = makeFake();
    await openPanelViaRail(f.page, 'blast', 'bs-blast-panel');
    expect(f.clicks).toEqual(['blast']);
    expect(f.visible.has('bs-blast-panel')).toBe(true);
  });

  it('works for every declared rail/panel pair', async () => {
    for (const { rail, panelId } of A11Y_PANELS) {
      const f = makeFake();
      await openPanelViaRail(f.page, rail, panelId);
      expect(f.clicks).toEqual([rail]);
      expect(f.visible.has(panelId)).toBe(true);
    }
  });

  it('does not click when the panel is already visible (toggle safety)', async () => {
    const f = makeFake({ visible: ['bs-survey-panel'] });
    await openPanelViaRail(f.page, 'survey', 'bs-survey-panel');
    expect(f.clicks).toEqual([]);
    expect(f.visible.has('bs-survey-panel')).toBe(true);
  });

  it('throws naming the rail key and panel id when it never becomes visible', async () => {
    const f = makeFake({ clickToggles: false });
    const err = await openPanelViaRail(f.page, 'ops', 'bs-operations-panel').then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('ops');
    expect(err!.message).toContain('bs-operations-panel');
  }, 15000);

  it('never sets style.display on the panel', async () => {
    const f = makeFake();
    await openPanelViaRail(f.page, 'build', 'bs-build-panel');
    expect(f.styleWrites.filter((w) => w.prop === 'display')).toEqual([]);
  });
});

describe('closePanelViaRail', () => {
  it('is a no-op when the panel is already hidden', async () => {
    const f = makeFake();
    await closePanelViaRail(f.page, 'vehicles', 'bs-vehicle-panel');
    expect(f.clicks).toEqual([]);
  });

  it('clicks the rail button when the panel is visible', async () => {
    const f = makeFake({ visible: ['bs-vehicle-panel'] });
    await closePanelViaRail(f.page, 'vehicles', 'bs-vehicle-panel');
    expect(f.clicks).toEqual(['vehicles']);
    expect(f.visible.has('bs-vehicle-panel')).toBe(false);
  });

  it('never sets style.display', async () => {
    const f = makeFake({ visible: ['bs-employee-panel'] });
    await closePanelViaRail(f.page, 'employees', 'bs-employee-panel');
    expect(f.styleWrites.filter((w) => w.prop === 'display')).toEqual([]);
  });
});

describe('assertRegionsPopulated', () => {
  it('accepts when every required region has elements', () => {
    expect(() => assertRegionsPopulated({ hud: 5, rail: 7, panel: 1 }, ['hud', 'rail', 'panel'])).not.toThrow();
  });

  it('accepts an empty requirement list', () => {
    expect(() => assertRegionsPopulated({}, [])).not.toThrow();
  });

  it('rejects a region with zero elements and names it', () => {
    expect(() => assertRegionsPopulated({ hud: 5, rail: 0 }, ['hud', 'rail'])).toThrow(/rail/);
  });

  it('rejects a required region missing from the counts', () => {
    expect(() => assertRegionsPopulated({ hud: 5 }, ['hud', 'minimap'])).toThrow(/minimap/);
  });

  it('lists every empty region in the error', () => {
    expect(() => assertRegionsPopulated({ a: 0, b: 0, c: 3 }, ['a', 'b', 'c'])).toThrow(/a[\s\S]*b|b[\s\S]*a/);
  });

  it('does not complain about unrequired empty regions', () => {
    expect(() => assertRegionsPopulated({ hud: 2, extra: 0 }, ['hud'])).not.toThrow();
  });
});

describe('A11Y_PANELS', () => {
  it('matches the scenario executor PANEL_ELEMENT_ID map', () => {
    const fromPanels = A11Y_PANELS.map((p) => [p.rail, p.panelId]).sort();
    expect(fromPanels).toEqual(Object.entries(PANEL_ELEMENT_ID).sort());
  });
});
