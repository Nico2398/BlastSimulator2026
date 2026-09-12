// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { scrollBoundedSection, panelHeader } from '../../../src/ui/dom.js';
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
