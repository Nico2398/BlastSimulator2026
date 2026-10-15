// @vitest-environment jsdom
// BlastSimulator2026 — minimap chrome is bsx, not the legacy bs-ui/bs-panel (#1739)
//
// #bs-minimap carried `bs-ui bs-panel`; its background was overridden inline but
// its border computed to the legacy gold rgba(200,160,60,.3), an olive outline.
// Every other docked surface uses the grey hairline.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { MiniMap } from '../../../src/ui/MiniMap.js';

function mount(): HTMLElement {
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  new MiniMap(document.body);
  return document.getElementById('bs-minimap') as HTMLElement;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('MiniMap chrome', () => {
  it('does not carry the legacy bs-ui / bs-panel classes', () => {
    const el = mount();
    expect(el.classList.contains('bs-ui')).toBe(false);
    expect(el.classList.contains('bs-panel')).toBe(false);
    expect(el.classList.contains('bsx-root')).toBe(true);
  });

  it('outlines itself with the bsx hairline like the other docked surfaces', () => {
    const el = mount();
    // Longhands: jsdom drops a style string holding `border:… var(…)`.
    const style = el.getAttribute('style') ?? '';
    expect(style).toMatch(/border-width:\s*1px/);
    expect(style).toMatch(/border-style:\s*solid/);
    expect(style).toMatch(/border-color:\s*var\(--bsx-hairline-strong\)/);
  });

  it('keeps its fixed position, layering inputs and dimensions', () => {
    const el = mount();
    expect(el.style.position).toBe('fixed');
    expect(el.style.right).not.toBe('');
    expect(el.style.bottom).not.toBe('');
    expect(el.style.width).not.toBe('');
    expect(el.style.overflow).toBe('hidden');
  });
});
