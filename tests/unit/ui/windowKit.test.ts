// @vitest-environment jsdom
// Central window kit (#2242): frame, single scrolling body, sections, grids, cards, figures.
import { describe, it, expect } from 'vitest';
import { cardGrid, entityCard, haveNeedBar, kpiRow, kpiTile, statusPill, windowBody, windowRoot, windowSection } from '../../../src/ui/windowKit.js';
import { rolePortraitSpec } from '../../../src/ui/portraits.js';
import { WINDOW_STYLES_CSS } from '../../../src/ui/windowStyles.js';

describe('window frame', () => {
  it('starts hidden, like every panel root', () => {
    const root = windowRoot('bs-test-window');
    expect(root.id).toBe('bs-test-window');
    expect(root.style.display).toBe('none');
    expect(root.classList.contains('bsx-window')).toBe(true);
  });

  it('has one body that owns the scroll, inline so it holds before any stylesheet', () => {
    const body = windowBody('bsx-panel-body');
    expect(body.style.overflowY).toBe('auto');
    expect(body.classList.contains('bsx-window-body')).toBe(true);
    expect(body.classList.contains('bsx-panel-body')).toBe(true);
  });

  it('lifts every scroll-bounded list inside a window, so nothing nests a second scrollbar', () => {
    expect(WINDOW_STYLES_CSS).toMatch(/\.bsx-window \.bsx-bounded \{ max-height: none !important; overflow: visible !important; \}/);
  });
});

describe('sections, grids, cards', () => {
  it('a section carries its title, count and note in one head row', () => {
    const s = windowSection({ title: 'Roster', count: '6', note: 'all hands', children: [document.createElement('div')], className: 'bs-x' });
    expect(s.classList.contains('bs-x')).toBe(true);
    expect(s.querySelector('.bsx-wsection-title')!.textContent).toBe('Roster');
    expect(s.querySelector('.bsx-wsection-count')!.textContent).toBe('6');
    expect(s.querySelector('.bsx-wsection-note')!.textContent).toBe('all hands');
    expect(s.children).toHaveLength(2);
  });

  it('a grid takes its minimum column width as a custom property', () => {
    expect(cardGrid([], 250).style.getPropertyValue('--bsx-grid-min')).toBe('250px');
  });

  it('an entity card shows its portrait, title, lines and footer', () => {
    const card = entityCard({
      portrait: { spec: rolePortraitSpec('driller', 'Driller'), size: 56 },
      title: 'Nick', titleNote: '#1', sub: 'Driller', lines: [document.createElement('p')], footer: [document.createElement('button')],
      attrs: { 'data-x': '1' },
    });
    expect(card.dataset['x']).toBe('1');
    expect(card.querySelector('.bsx-portrait')!.getAttribute('data-portrait')).toBe('worker_driller');
    expect(card.querySelector('.bsx-ecard-name')!.textContent).toBe('Nick');
    expect(card.querySelector('.bsx-ecard-footer button')).not.toBeNull();
  });

  it('drops an empty footer', () => {
    expect(entityCard({ title: 'x', footer: [null] }).querySelector('.bsx-ecard-footer')).toBeNull();
  });
});

describe('figures', () => {
  it('a key figure keeps its label, value and hook', () => {
    const tile = kpiTile({ label: 'Idle', value: '3', sub: 'waiting', tone: 'info', key: 'idle' });
    expect(tile.dataset['kpi']).toBe('idle');
    expect(tile.querySelector('.bsx-kpi-value')!.textContent).toBe('3');
    expect(kpiRow([tile]).children).toHaveLength(1);
  });

  it('a have-vs-need bar fills to have/need, full when nothing is needed, clamped past it', () => {
    const fill = (have: number, need: number) => (haveNeedBar(have, need, 'warn').firstElementChild as HTMLElement).style.width;
    expect(fill(1, 4)).toBe('25%');
    expect(fill(0, 0)).toBe('100%');
    expect(fill(9, 3)).toBe('100%');
  });

  it('a status pill carries its tone class and label', () => {
    const pill = statusPill('Short', 'warn');
    expect(pill.classList.contains('bsx-pill-warn')).toBe(true);
    expect(pill.textContent).toBe('Short');
  });
});
