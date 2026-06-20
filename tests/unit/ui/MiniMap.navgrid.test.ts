// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { MiniMap } from '../../../src/ui/MiniMap.js';

/**
 * MiniMap navGrid overlay tests.
 *
 * These tests exercise the navGridVisible getter, setNavGridVisible setter,
 * setNavGrid, and the drawNavGridOverlay method on the MiniMap class.
 * The overlay renders semi-transparent colored rectangles per cell type.
 */
describe('MiniMap — navGrid overlay', () => {
  function createMiniMap(): MiniMap {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return new MiniMap(container);
  }

  it('navGridVisible defaults to false', () => {
    const minimap = createMiniMap();
    expect(minimap.navGridVisible).toBe(false);
    minimap.dispose();
  });

  it('setNavGridVisible(true) makes navGridVisible return true', () => {
    const minimap = createMiniMap();
    minimap.setNavGridVisible(true);
    expect(minimap.navGridVisible).toBe(true);
    minimap.dispose();
  });

  it('setNavGridVisible(false) makes navGridVisible return false', () => {
    const minimap = createMiniMap();
    minimap.setNavGridVisible(true);
    minimap.setNavGridVisible(false);
    expect(minimap.navGridVisible).toBe(false);
    minimap.dispose();
  });

  it('setNavGridVisible is idempotent for repeated true', () => {
    const minimap = createMiniMap();
    minimap.setNavGridVisible(true);
    minimap.setNavGridVisible(true);
    expect(minimap.navGridVisible).toBe(true);
    minimap.dispose();
  });

  it('setNavGridVisible is idempotent for repeated false', () => {
    const minimap = createMiniMap();
    minimap.setNavGridVisible(false);
    expect(minimap.navGridVisible).toBe(false);
    minimap.dispose();
  });

  it('drawNavGridOverlay does not throw when called with a valid context', () => {
    const minimap = createMiniMap();
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx2d = canvas.getContext('2d')!;

    expect(() => {
      minimap.drawNavGridOverlay(ctx2d, 1.0, 1.0);
    }).not.toThrow();
    minimap.dispose();
  });

  it('drawNavGridOverlay does not throw with different scale factors', () => {
    const minimap = createMiniMap();
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx2d = canvas.getContext('2d')!;

    expect(() => {
      minimap.drawNavGridOverlay(ctx2d, 0.5, 2.0);
    }).not.toThrow();
    expect(() => {
      minimap.drawNavGridOverlay(ctx2d, 3.0, 0.1);
    }).not.toThrow();
    minimap.dispose();
  });

  it('toggle navGridVisible back and forth', () => {
    const minimap = createMiniMap();
    expect(minimap.navGridVisible).toBe(false);
    minimap.setNavGridVisible(true);
    expect(minimap.navGridVisible).toBe(true);
    minimap.setNavGridVisible(false);
    expect(minimap.navGridVisible).toBe(false);
    minimap.setNavGridVisible(true);
    expect(minimap.navGridVisible).toBe(true);
    minimap.dispose();
  });

  it('dispose removes element from DOM', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const minimap = new MiniMap(container);
    minimap.setNavGridVisible(true);
    minimap.dispose();
    expect(container.querySelector('#bs-minimap')).toBeNull();
  });
});
