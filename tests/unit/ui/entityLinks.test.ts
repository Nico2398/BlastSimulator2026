// @vitest-environment jsdom
// Generic entity links any panel can show (#2165): openerLink and coordLink.
import { describe, it, expect, vi } from 'vitest';
import { openerLink, coordLink, LINK_STYLE, type EntityOpener, type OpenableKind } from '../../../src/ui/entityLinks.js';

function makeOpener(): { opener: EntityOpener; open: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> } {
  const open = vi.fn();
  const focus = vi.fn();
  return { opener: { open, focus }, open, focus };
}

describe('LINK_STYLE', () => {
  it('reads as a link: underlined, pointer cursor, no button chrome', () => {
    expect(LINK_STYLE).toContain('underline');
    expect(LINK_STYLE).toContain('cursor:pointer');
  });
});

describe('openerLink', () => {
  it('is a button carrying the kind and id as data attributes, with the label as its text', () => {
    const { opener } = makeOpener();
    const link = openerLink(opener, 'employee', 12, 'Dorian Kask');
    expect(link.tagName).toBe('BUTTON');
    expect(link.dataset['selectKind']).toBe('employee');
    expect(link.dataset['selectId']).toBe('12');
    expect(link.textContent).toBe('Dorian Kask');
  });

  it('click calls opener.open with the same kind and id, once', () => {
    const { opener, open, focus } = makeOpener();
    const link = openerLink(opener, 'vehicle', 4, 'Hauler');
    link.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('vehicle', 4);
    expect(focus).not.toHaveBeenCalled();
  });

  it.each<OpenableKind>(['employee', 'vehicle', 'building', 'hole'])('forwards kind %s unchanged', kind => {
    const { opener, open } = makeOpener();
    const link = openerLink(opener, kind, 9, 'x');
    expect(link.dataset['selectKind']).toBe(kind);
    link.click();
    expect(open).toHaveBeenCalledWith(kind, 9);
  });

  it('accepts id 0', () => {
    const { opener, open } = makeOpener();
    const link = openerLink(opener, 'building', 0, 'Office');
    expect(link.dataset['selectId']).toBe('0');
    link.click();
    expect(open).toHaveBeenCalledWith('building', 0);
  });

  it('is styled as a link', () => {
    const { opener } = makeOpener();
    const link = openerLink(opener, 'employee', 1, 'Walt');
    expect(link.style.textDecoration).toContain('underline');
    expect(link.style.cursor).toBe('pointer');
  });

  it('is plain text, not a button, without an opener', () => {
    const link = openerLink(undefined, 'employee', 12, 'Dorian Kask');
    expect(link.textContent).toBe('Dorian Kask');
    expect(link.tagName).not.toBe('BUTTON');
    expect(link.querySelector('button')).toBeNull();
    expect(link.dataset['selectKind']).toBeUndefined();
    expect(link.dataset['selectId']).toBeUndefined();
  });

  it('clicking the plain text without an opener does not throw', () => {
    const link = openerLink(undefined, 'hole', 3, 'Hole 3');
    expect(() => link.click()).not.toThrow();
  });
});

describe('coordLink', () => {
  it('is a button carrying x and z as data attributes, with the label as its text', () => {
    const { opener } = makeOpener();
    const link = coordLink(opener, 12, 34, '(12, 34)');
    expect(link.tagName).toBe('BUTTON');
    expect(link.dataset['focusX']).toBe('12');
    expect(link.dataset['focusZ']).toBe('34');
    expect(link.textContent).toBe('(12, 34)');
  });

  it('click calls opener.focus with x and z, once, and never open', () => {
    const { opener, open, focus } = makeOpener();
    const link = coordLink(opener, 12, 34, '(12, 34)');
    link.click();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith(12, 34);
    expect(open).not.toHaveBeenCalled();
  });

  it('accepts the origin and negative coordinates', () => {
    const { opener, focus } = makeOpener();
    const origin = coordLink(opener, 0, 0, 'o');
    expect(origin.dataset['focusX']).toBe('0');
    expect(origin.dataset['focusZ']).toBe('0');
    origin.click();
    expect(focus).toHaveBeenLastCalledWith(0, 0);
    const negative = coordLink(opener, -3, -7, 'n');
    negative.click();
    expect(focus).toHaveBeenLastCalledWith(-3, -7);
  });

  it('is styled as a link', () => {
    const { opener } = makeOpener();
    const link = coordLink(opener, 1, 2, 'c');
    expect(link.style.textDecoration).toContain('underline');
    expect(link.style.cursor).toBe('pointer');
  });

  it('is plain text, not a button, without an opener', () => {
    const link = coordLink(undefined, 12, 34, '(12, 34)');
    expect(link.textContent).toBe('(12, 34)');
    expect(link.tagName).not.toBe('BUTTON');
    expect(link.dataset['focusX']).toBeUndefined();
    expect(link.dataset['focusZ']).toBeUndefined();
    expect(() => link.click()).not.toThrow();
  });
});
