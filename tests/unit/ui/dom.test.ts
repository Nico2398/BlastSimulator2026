// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { scrollBoundedSection, panelHeader, replaceChildrenKeepingScroll, explainable, chip, gauge, statGrid } from '../../../src/ui/dom.js';
import type { ScrollBoundedSectionOptions } from '../../../src/ui/dom.js';
import { PANEL_CLOSE_ATTR, PANEL_CLOSE_SELECTOR } from '../../../src/ui/panels/PanelBase.js';

function child(text: string): HTMLElement {
  const div = document.createElement('div');
  div.textContent = text;
  return div;
}

describe('scrollBoundedSection', () => {
  it('returns a single element with the given children appended in order', () => {
    const kids = [child('a'), child('b'), child('c')];
    const wrapper = scrollBoundedSection(kids, 200);

    expect(wrapper).toBeInstanceOf(HTMLElement);
    expect(Array.from(wrapper.children)).toEqual(kids);
    expect(wrapper.textContent).toBe('abc');
  });

  it('sets inline overflow-y:auto, flex-shrink:0, and a numeric max-height equal to the given maxHeightPx', () => {
    const wrapper = scrollBoundedSection([child('x')], 220);

    expect(wrapper.style.overflowY).toBe('auto');
    expect(wrapper.style.flexShrink).toBe('0');
    expect(wrapper.style.maxHeight).toBe('220px');
  });

  it('uses a different exact max-height when given a different maxHeightPx', () => {
    const wrapper = scrollBoundedSection([child('x')], 200);
    expect(wrapper.style.maxHeight).toBe('200px');
  });

  it('lays children out as a column flex with display:flex;flex-direction:column', () => {
    const wrapper = scrollBoundedSection([child('x')], 200);

    expect(wrapper.style.display).toBe('flex');
    expect(wrapper.style.flexDirection).toBe('column');
  });

  it('defaults gap to 8px when opts.gap is omitted', () => {
    const wrapper = scrollBoundedSection([child('x')], 200);
    expect(wrapper.style.gap).toBe('8px');
  });

  it('uses opts.gap when given, overriding the default', () => {
    const opts: ScrollBoundedSectionOptions = { gap: 4 };
    const wrapper = scrollBoundedSection([child('x')], 200, opts);
    expect(wrapper.style.gap).toBe('4px');
  });

  it('applies opts.className when given', () => {
    const opts: ScrollBoundedSectionOptions = { className: 'bsx-work-queue' };
    const wrapper = scrollBoundedSection([child('x')], 200, opts);
    expect(wrapper.classList.contains('bsx-work-queue')).toBe(true);
  });

  it('handles an empty children array without throwing, producing a childless wrapper', () => {
    const wrapper = scrollBoundedSection([], 200);
    expect(wrapper.children.length).toBe(0);
  });

  it('skips null/undefined entries in the children array, matching el()\'s convention', () => {
    const kept = child('kept');
    const wrapper = scrollBoundedSection([null, kept, undefined], 200);
    expect(Array.from(wrapper.children)).toEqual([kept]);
  });
});

// #1041: every panel built through panelHeader() (Build, Blast, Contracts,
// Crew, Finances, Fleet, Operations, Shady, Survey) gets a close control the
// tutorial rails can allow unconditionally, without a per-panel selector —
// PANEL_CLOSE_SELECTOR ([data-panel-close]) is what the rails match against.
describe('panelHeader — close control carries PANEL_CLOSE_ATTR (#1041)', () => {
  it('stamps the close button with the data-panel-close attribute', () => {
    const { closeBtn } = panelHeader({ icon: 'x', accent: 'amber' });
    expect(closeBtn.hasAttribute(PANEL_CLOSE_ATTR)).toBe(true);
  });

  it('the close button matches PANEL_CLOSE_SELECTOR once mounted in the DOM', () => {
    const { header, closeBtn } = panelHeader({ icon: 'x', accent: 'amber' });
    document.body.appendChild(header);
    expect(document.querySelector(PANEL_CLOSE_SELECTOR)).toBe(closeBtn);
    header.remove();
  });

  it('still fires the onClose callback — stamping the attribute does not disturb the click handler', () => {
    let closed = false;
    const { closeBtn } = panelHeader({ icon: 'x', accent: 'amber', onClose: () => { closed = true; } });
    closeBtn.click();
    expect(closed).toBe(true);
  });
});

// ── Scroll + typed-input preservation across rebuilds (#1592) ──

function keyedScroller(key: string, scrollTop = 0): HTMLElement {
  const s = scrollBoundedSection([child('row')], 200, { scrollKey: key });
  s.scrollTop = scrollTop;
  return s;
}

describe('scrollBoundedSection scrollKey (#1592)', () => {
  it('stamps data-scroll-key from the scrollKey option', () => {
    const s = scrollBoundedSection([child('x')], 200, { scrollKey: 'roster' });
    expect(s.getAttribute('data-scroll-key')).toBe('roster');
  });

  it('stamps nothing without a scrollKey', () => {
    const s = scrollBoundedSection([child('x')], 200);
    expect(s.hasAttribute('data-scroll-key')).toBe(false);
  });
});

describe('replaceChildrenKeepingScroll (#1592)', () => {
  it('restores scrollTop of a keyed descendant on its replacement', () => {
    const host = document.createElement('div');
    host.append(keyedScroller('roster', 80));
    replaceChildrenKeepingScroll(host, [keyedScroller('roster', 0)]);
    expect(host.querySelector<HTMLElement>('[data-scroll-key="roster"]')!.scrollTop).toBe(80);
  });

  it('restores each key independently', () => {
    const host = document.createElement('div');
    host.append(keyedScroller('a', 10), keyedScroller('b', 70));
    replaceChildrenKeepingScroll(host, [keyedScroller('b'), keyedScroller('a')]);
    expect(host.querySelector<HTMLElement>('[data-scroll-key="a"]')!.scrollTop).toBe(10);
    expect(host.querySelector<HTMLElement>('[data-scroll-key="b"]')!.scrollTop).toBe(70);
  });

  it('actually swaps in the new nodes', () => {
    const host = document.createElement('div');
    host.append(keyedScroller('roster', 5));
    const fresh = keyedScroller('roster');
    replaceChildrenKeepingScroll(host, [fresh]);
    expect(host.firstElementChild).toBe(fresh);
    expect(host.children.length).toBe(1);
  });

  it('ignores keys absent from the new tree and leaves unkeyed new scrollers at 0', () => {
    const host = document.createElement('div');
    host.append(keyedScroller('gone', 60));
    const unkeyed = scrollBoundedSection([child('x')], 200);
    replaceChildrenKeepingScroll(host, [unkeyed, keyedScroller('new')]);
    expect(unkeyed.scrollTop).toBe(0);
    expect(host.querySelector<HTMLElement>('[data-scroll-key="new"]')!.scrollTop).toBe(0);
  });

  it('accepts an empty next list', () => {
    const host = document.createElement('div');
    host.append(keyedScroller('roster', 40));
    expect(() => replaceChildrenKeepingScroll(host, [])).not.toThrow();
    expect(host.children.length).toBe(0);
  });

  it('skips null and undefined entries in next', () => {
    const host = document.createElement('div');
    replaceChildrenKeepingScroll(host, [null, child('a'), undefined]);
    expect(host.textContent).toBe('a');
  });

  it('restores a nested keyed scroller, not only direct children', () => {
    const host = document.createElement('div');
    const wrap = document.createElement('div');
    wrap.append(keyedScroller('deep', 33));
    host.append(wrap);
    const wrap2 = document.createElement('div');
    wrap2.append(keyedScroller('deep'));
    replaceChildrenKeepingScroll(host, [wrap2]);
    expect(host.querySelector<HTMLElement>('[data-scroll-key="deep"]')!.scrollTop).toBe(33);
  });

  function numberInput(defaultValue: string, max: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.setAttribute('value', defaultValue);
    input.max = max;
    input.setAttribute('data-preserve-key', 'amount');
    return input;
  }

  it('carries a user-edited preserve-key input value over', () => {
    const host = document.createElement('div');
    const old = numberInput('40', '40');
    host.append(old);
    old.value = '25';
    old.dispatchEvent(new Event('input', { bubbles: true }));
    replaceChildrenKeepingScroll(host, [numberInput('40', '40')]);
    expect(host.querySelector<HTMLInputElement>('[data-preserve-key="amount"]')!.value).toBe('25');
  });

  it('clamps the carried value to the new max', () => {
    const host = document.createElement('div');
    const old = numberInput('40', '40');
    host.append(old);
    old.value = '35';
    old.dispatchEvent(new Event('input', { bubbles: true }));
    replaceChildrenKeepingScroll(host, [numberInput('10', '10')]);
    expect(host.querySelector<HTMLInputElement>('[data-preserve-key="amount"]')!.value).toBe('10');
  });

  it('leaves an unedited preserve-key input on the new default', () => {
    const host = document.createElement('div');
    host.append(numberInput('40', '40'));
    replaceChildrenKeepingScroll(host, [numberInput('55', '55')]);
    expect(host.querySelector<HTMLInputElement>('[data-preserve-key="amount"]')!.value).toBe('55');
  });
});

describe('explainable', () => {
  it('sets data-explain, a focusable tabindex and the visible-mark class, and returns the same node', () => {
    const node = document.createElement('span');
    const out = explainable(node, 'What this does');

    expect(out).toBe(node);
    expect(node.getAttribute('data-explain')).toBe('What this does');
    expect(node.getAttribute('tabindex')).toBe('0');
    expect(node.classList.contains('bsx-explainable')).toBe(true);
  });

  it('keeps the node classes it already had', () => {
    const node = document.createElement('div');
    node.className = 'existing';
    explainable(node, 'text');
    expect(node.classList.contains('existing')).toBe(true);
    expect(node.classList.contains('bsx-explainable')).toBe(true);
  });

  it('leaves the node untouched for undefined text', () => {
    const node = document.createElement('span');
    const out = explainable(node, undefined);

    expect(out).toBe(node);
    expect(node.hasAttribute('data-explain')).toBe(false);
    expect(node.hasAttribute('tabindex')).toBe(false);
    expect(node.classList.contains('bsx-explainable')).toBe(false);
  });

  it('leaves the node untouched for empty text', () => {
    const node = document.createElement('span');
    explainable(node, '');

    expect(node.hasAttribute('data-explain')).toBe(false);
    expect(node.hasAttribute('tabindex')).toBe(false);
    expect(node.classList.contains('bsx-explainable')).toBe(false);
  });

  it('a later call with new text replaces the explanation', () => {
    const node = document.createElement('span');
    explainable(node, 'first');
    explainable(node, 'second');
    expect(node.getAttribute('data-explain')).toBe('second');
  });
});

describe('chip explanation', () => {
  it('a chip given an explanation is explainable and keeps its label and tone', () => {
    const c = chip('UNION', 'warn', 'Members cost less');
    expect(c.textContent).toBe('UNION');
    expect(c.classList.contains('bsx-chip-warn')).toBe(true);
    expect(c.getAttribute('data-explain')).toBe('Members cost less');
    expect(c.getAttribute('tabindex')).toBe('0');
    expect(c.classList.contains('bsx-explainable')).toBe(true);
  });

  it('a chip without an explanation is unchanged: no data-explain, no tabindex', () => {
    const c = chip('WET');
    expect(c.hasAttribute('data-explain')).toBe(false);
    expect(c.hasAttribute('tabindex')).toBe(false);
    expect(c.classList.contains('bsx-explainable')).toBe(false);
    expect(c.className).toBe('bsx-chip bsx-chip-neutral');
  });

  it('an empty explanation counts as none', () => {
    const c = chip('WET', 'info', '');
    expect(c.hasAttribute('data-explain')).toBe(false);
    expect(c.hasAttribute('tabindex')).toBe(false);
  });
});

describe('gauge explanation', () => {
  it('the whole gauge row is explainable when explain is given', () => {
    const row = gauge('Fatigue', 55, 'red', { explain: 'Tired crews work slower' });
    expect(row.classList.contains('bsx-gauge-row')).toBe(true);
    expect(row.getAttribute('data-explain')).toBe('Tired crews work slower');
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.classList.contains('bsx-explainable')).toBe(true);
  });

  it('a gauge without explain is unchanged', () => {
    const row = gauge('Fatigue', 55, 'red', { thresholdPct: 40 });
    expect(row.hasAttribute('data-explain')).toBe(false);
    expect(row.hasAttribute('tabindex')).toBe(false);
    expect(row.textContent).toContain('Fatigue');
    expect(row.textContent).toContain('55');
  });

  it('explain does not disturb the threshold tick', () => {
    const row = gauge('Fatigue', 55, 'red', { thresholdPct: 40, explain: 'x' });
    expect(row.querySelector('.bsx-gauge-tick')).not.toBeNull();
  });
});

describe('statGrid explanation', () => {
  it('an item with explain makes its value cell explainable', () => {
    const grid = statGrid([{ key: 'Salary', value: '$5/h', explain: 'Paid every cycle' }, { key: 'Other', value: '1' }], 2);
    const values = grid.querySelectorAll<HTMLElement>('.bsx-stat-value');
    expect(values[0]!.getAttribute('data-explain')).toBe('Paid every cycle');
    expect(values[0]!.getAttribute('tabindex')).toBe('0');
    expect(values[0]!.classList.contains('bsx-explainable')).toBe(true);
  });

  it('an item without explain has no data-explain and no tabindex', () => {
    const grid = statGrid([{ key: 'Salary', value: '$5/h', explain: 'Paid every cycle' }, { key: 'Other', value: '1' }], 2);
    const plain = grid.querySelectorAll<HTMLElement>('.bsx-stat-value')[1]!;
    expect(plain.hasAttribute('data-explain')).toBe(false);
    expect(plain.hasAttribute('tabindex')).toBe(false);
  });

  it('the existing info hook still works beside explain', () => {
    const grid = statGrid([{ key: 'K', value: 'V', info: 'tip', explain: 'why' }], 1);
    const v = grid.querySelector<HTMLElement>('.bsx-stat-value')!;
    expect(v.dataset['info']).toBe('tip');
    expect(v.getAttribute('data-explain')).toBe('why');
  });

  it('info alone leaves the cell not explainable', () => {
    const grid = statGrid([{ key: 'K', value: 'V', info: 'tip' }], 1);
    const v = grid.querySelector<HTMLElement>('.bsx-stat-value')!;
    expect(v.dataset['info']).toBe('tip');
    expect(v.hasAttribute('data-explain')).toBe(false);
  });
});

describe('explainable placement', () => {
  function place(rect: Partial<DOMRect>, cls = '', vw = 1000, vh = 700, evt = 'pointerenter'): HTMLElement {
    const node = document.createElement('span');
    if (cls !== '') node.classList.add(cls);
    explainable(node, 'text');
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0, ...rect } as DOMRect);
    vi.stubGlobal('innerWidth', vw);
    vi.stubGlobal('innerHeight', vh);
    node.dispatchEvent(new Event(evt));
    vi.unstubAllGlobals();
    return node;
  }

  it('opens below with room to spare', () => {
    const n = place({ top: 100, bottom: 120, left: 50, right: 90 });
    expect(n.style.getPropertyValue('--bsx-explain-top')).toBe('124px');
    expect(n.style.getPropertyValue('--bsx-explain-bottom')).toBe('auto');
    expect(n.style.getPropertyValue('--bsx-explain-left')).toBe('50px');
  });

  it('flips above near the viewport bottom', () => {
    const n = place({ top: 650, bottom: 670, left: 50, right: 90 });
    expect(n.style.getPropertyValue('--bsx-explain-top')).toBe('auto');
    expect(n.style.getPropertyValue('--bsx-explain-bottom')).toBe('54px');
  });

  it('right-anchors bsx-explain-end nodes and clamps left to 0', () => {
    const n = place({ top: 100, bottom: 120, left: 100, right: 150 }, 'bsx-explain-end', 1000, 700, 'focus');
    expect(n.style.getPropertyValue('--bsx-explain-left')).toBe('0px');
  });

  it('clamps left inside the viewport width', () => {
    const n = place({ top: 100, bottom: 120, left: 990, right: 1000 });
    expect(n.style.getPropertyValue('--bsx-explain-left')).toBe('812px');
  });

  it('attaches listeners once across repeated calls', () => {
    const node = document.createElement('span');
    const spy = vi.spyOn(node, 'addEventListener');
    explainable(node, 'a');
    explainable(node, 'b');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
