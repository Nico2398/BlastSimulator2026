// @vitest-environment jsdom
//
// #1425 — `#bs-ui-root` must be a full-viewport, click-through overlay rather
// than a static block after the canvas (which left a 52px strip at the bottom).
// jsdom has no layout engine, so the CSS rules are asserted as text.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { injectStyles } from '../../../src/ui/styles.js';

const norm = (s: string): string => s.replace(/\s+/g, ' ');

describe('#bs-ui-root overlay (#1425)', () => {
  it('index.html styles #bs-ui-root as a fixed, inset-0, click-through layer', () => {
    const html = norm(readFileSync(resolve(__dirname, '../../../index.html'), 'utf8'));
    const m = /#bs-ui-root\s*\{([^}]*)\}/.exec(html);
    expect(m, '#bs-ui-root rule missing in index.html').not.toBeNull();
    const body = m![1].replace(/\s+/g, '');
    expect(body).toContain('position:fixed');
    expect(body).toContain('inset:0');
    expect(body).toContain('pointer-events:none');
  });

  it('injectStyles re-enables pointer events for direct children via zero-specificity rule', () => {
    injectStyles();
    const text = Array.from(document.head.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');
    const m = /:where\(\s*#bs-ui-root\s*\)\s*>\s*:where\(\s*\*\s*\)\s*\{([^}]*)\}/.exec(norm(text));
    expect(m, ':where(#bs-ui-root) > :where(*) rule missing').not.toBeNull();
    expect(m![1].replace(/\s+/g, '')).toContain('pointer-events:auto');
  });
});
