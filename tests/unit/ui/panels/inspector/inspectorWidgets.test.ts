// @vitest-environment jsdom
// syncSection / linkFactory (#1762).
import { describe, it, expect, vi } from 'vitest';
import { syncSection, linkFactory } from '../../../../../src/ui/panels/inspector/inspectorWidgets.js';
import type { InspectorLinks } from '../../../../../src/ui/panels/inspector/InspectorContent.js';

function div(cls: string, text: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  return d;
}

describe('syncSection', () => {
  it('appends the section when missing', () => {
    const root = document.createElement('div');
    syncSection(root, 'x-sec', () => div('x-sec', 'a'));
    expect(root.querySelector('.x-sec')!.textContent).toBe('a');
  });

  it('keeps the same node when the rebuilt markup is identical', () => {
    const root = document.createElement('div');
    syncSection(root, 'x-sec', () => div('x-sec', 'a'));
    const first = root.querySelector('.x-sec');
    syncSection(root, 'x-sec', () => div('x-sec', 'a'));
    expect(root.querySelector('.x-sec')).toBe(first);
  });

  it('keeps a section whose only difference is tutorial rail marks', () => {
    const build = (): HTMLElement => {
      const sec = div('x-sec', 'a');
      const btn = document.createElement('button');
      btn.className = 'train';
      sec.append(btn);
      return sec;
    };
    const root = document.createElement('div');
    syncSection(root, 'x-sec', build);
    const first = root.querySelector('.x-sec')!;
    const btn = first.querySelector('button')!;
    btn.classList.add('bs-tutorial-allowed', 'bsx-highlight');
    syncSection(root, 'x-sec', build);
    expect(root.querySelector('.x-sec')).toBe(first);
    expect(first.querySelector('button')!.classList.contains('bs-tutorial-allowed')).toBe(true);
  });

  it('swaps the node when the markup differs', () => {
    const root = document.createElement('div');
    syncSection(root, 'x-sec', () => div('x-sec', 'a'));
    const first = root.querySelector('.x-sec');
    syncSection(root, 'x-sec', () => div('x-sec', 'b'));
    expect(root.querySelector('.x-sec')).not.toBe(first);
    expect(root.querySelector('.x-sec')!.textContent).toBe('b');
    expect(root.querySelectorAll('.x-sec')).toHaveLength(1);
  });

  it('null removes the section', () => {
    const root = document.createElement('div');
    syncSection(root, 'x-sec', () => div('x-sec', 'a'));
    syncSection(root, 'x-sec', () => null);
    expect(root.querySelector('.x-sec')).toBeNull();
  });

  it('null with nothing present is a no-op', () => {
    const root = document.createElement('div');
    expect(() => syncSection(root, 'x-sec', () => null)).not.toThrow();
  });
});

describe('linkFactory', () => {
  it('builds a link carrying kind/id and the label that selects through links', () => {
    const select = vi.fn();
    const links = { select, run: vi.fn(), confirm: vi.fn() } as InspectorLinks;
    const a = linkFactory(links)('vehicle', 3, 'Hauler #3');
    expect(a.textContent).toBe('Hauler #3');
    expect(a.dataset['selectKind']).toBe('vehicle');
    expect(a.dataset['selectId']).toBe('3');
    a.click();
    expect(select).toHaveBeenCalledWith('vehicle', 3);
  });
});
