// @vitest-environment jsdom
// Shared Locate icon button (#1422)
import { describe, it, expect, vi } from 'vitest';
import { makeLocateButton, LOCATE_CAMERA_DISTANCE } from '../../../src/ui/locateButton.js';

describe('makeLocateButton', () => {
  it('builds a button with data-action="locate"', () => {
    const btn = makeLocateButton({ title: 'Locate', onClick: () => {} });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('data-action')).toBe('locate');
  });

  it('sets title and aria-label from the title option', () => {
    const btn = makeLocateButton({ title: 'Locate worker', onClick: () => {} });
    expect(btn.title).toBe('Locate worker');
    expect(btn.getAttribute('aria-label')).toBe('Locate worker');
  });

  it('defaults to 26px square', () => {
    const btn = makeLocateButton({ title: 'x', onClick: () => {} });
    expect(btn.style.width).toBe('26px');
    expect(btn.style.height).toBe('26px');
  });

  it('honours an explicit size', () => {
    const btn = makeLocateButton({ title: 'x', size: 32, onClick: () => {} });
    expect(btn.style.width).toBe('32px');
    expect(btn.style.height).toBe('32px');
  });

  it('calls onClick on click', () => {
    const onClick = vi.fn();
    const btn = makeLocateButton({ title: 'x', onClick });
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exports the camera distance 15', () => {
    expect(LOCATE_CAMERA_DISTANCE).toBe(15);
  });
});
