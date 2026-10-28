// @vitest-environment jsdom
// BlastSimulator2026 — Charge step stock block and tubing header follow the active locale (#2103)

import { describe, it, expect, afterEach } from 'vitest';
import { ChargeStockBlock } from '../../../../src/ui/panels/blastSteps/ChargeStock.js';
import { ChargeStep } from '../../../../src/ui/panels/blastSteps/Charge.js';
import { setLocale, t } from '../../../../src/core/i18n/I18n.js';

const STOCK_KEY = 'ui.blast_workshop.charge.stock_section';
const TUBING_KEY = 'ui.blast_workshop.charge.tubing_section';

function labels(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('.bsx-section-label')).map(n => n.textContent ?? '');
}

function englishText(key: string): string {
  setLocale('en');
  return t(key);
}

function frenchText(key: string): string {
  setLocale('fr');
  const text = t(key);
  setLocale('en');
  return text;
}

function makeBlock(): ChargeStockBlock {
  setLocale('en');
  return new ChargeStockBlock(() => {}, () => {});
}

afterEach(() => setLocale('en'));

describe('ChargeStockBlock.refreshLocale (#2103)', () => {
  it('is built in English with the warehouse stock header', () => {
    const block = makeBlock();
    expect(labels(block.root)).toContain('Warehouse stock');
  });

  it('reads the French header after the locale switches to fr and refreshes', () => {
    const block = makeBlock();
    setLocale('fr');
    block.refreshLocale();
    const found = labels(block.root);
    expect(found).toContain("Stock de l'entrepôt");
    expect(found).not.toContain('Warehouse stock');
  });

  it('reads English again after switching back and refreshing', () => {
    const block = makeBlock();
    setLocale('fr');
    block.refreshLocale();
    setLocale('en');
    block.refreshLocale();
    const found = labels(block.root);
    expect(found).toContain('Warehouse stock');
    expect(found).not.toContain("Stock de l'entrepôt");
  });

  it('is idempotent under repeated switching and repeated refreshes', () => {
    const block = makeBlock();
    for (let i = 0; i < 3; i++) {
      setLocale('fr');
      block.refreshLocale();
      block.refreshLocale();
      expect(labels(block.root)).toEqual(["Stock de l'entrepôt"]);
      setLocale('en');
      block.refreshLocale();
      block.refreshLocale();
      expect(labels(block.root)).toEqual(['Warehouse stock']);
    }
  });

  it('keeps exactly one section header and leaves the buy stepper in place', () => {
    const block = makeBlock();
    setLocale('fr');
    block.refreshLocale();
    expect(block.root.querySelectorAll('.bsx-section-label').length).toBe(1);
    expect(block.root.querySelector('[data-field="stock-kg"]')).not.toBeNull();
    expect(block.stepKg).toBeGreaterThan(0);
  });

  it('matches the catalog values of the locales', () => {
    const block = makeBlock();
    setLocale('fr');
    block.refreshLocale();
    expect(labels(block.root)).toContain(frenchText(STOCK_KEY));
  });
});

describe('ChargeStep.refreshLocale section headers (#2103)', () => {
  function makeStep(): ChargeStep {
    setLocale('en');
    return new ChargeStep(document.createElement('div'));
  }

  it('shows the English headers when built in English', () => {
    const found = labels(makeStep().root);
    expect(found).toContain(englishText(STOCK_KEY));
    expect(found).toContain(englishText(TUBING_KEY));
  });

  it('shows no English stock or tubing header after refreshing under fr', () => {
    const step = makeStep();
    const enStock = englishText(STOCK_KEY);
    const enTubing = englishText(TUBING_KEY);
    setLocale('fr');
    step.refreshLocale();
    const found = labels(step.root);
    expect(found).not.toContain(enStock);
    expect(found).not.toContain(enTubing);
  });

  it('shows the French stock and tubing headers after refreshing under fr', () => {
    const step = makeStep();
    setLocale('fr');
    step.refreshLocale();
    const found = labels(step.root);
    expect(found).toContain(frenchText(STOCK_KEY));
    expect(found).toContain(frenchText(TUBING_KEY));
  });

  it('returns to English headers after switching back and refreshing', () => {
    const step = makeStep();
    setLocale('fr');
    step.refreshLocale();
    setLocale('en');
    step.refreshLocale();
    const found = labels(step.root);
    expect(found).toContain(englishText(STOCK_KEY));
    expect(found).toContain(englishText(TUBING_KEY));
    expect(found).not.toContain(frenchText(STOCK_KEY));
    expect(found).not.toContain(frenchText(TUBING_KEY));
  });
});
