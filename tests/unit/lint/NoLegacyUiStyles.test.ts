// BlastSimulator2026 — the pre-redesign UI style stays gone (#1739)
//
// The bsx design system replaced the legacy stylesheet, but src/ui/styles.ts kept
// rules for classes nothing renders and rules in the warm gold/brown palette.
// Inline bsx styles masked them property by property, so any unmasked property
// (minimap border, plan-name field) showed the old look. Two invariants:
//   (a) every class styled by styles.ts is rendered by some other file under src/
//   (b) no pre-redesign palette literal appears under src/ui/
// Class names may stay as selector hooks; legacy *styling* may not.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');
const UI = join(SRC, 'ui');
const STYLES = join(UI, 'styles.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Class names appearing as `.class` tokens in selectors of a CSS source (comments stripped). */
function classSelectorsOf(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Set<string>();
  // Selector text = everything before a `{`. Declaration values never contain `{`.
  for (const m of stripped.matchAll(/([^{}]+)\{/g)) {
    const selector = m[1]!;
    if (selector.trim().startsWith('@')) continue;
    for (const c of selector.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) found.add(c[1]!);
  }
  return [...found].sort();
}

/** Class names from `classes` that none of `texts` mentions as a whole token. */
function unrenderedClasses(classes: string[], texts: string[]): string[] {
  const hay = texts.join('\n');
  return classes.filter(c => !new RegExp(`(?<![\\w-])${c.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&')}(?![\\w-])`).test(hay));
}

/** Palette literals that are the pre-redesign warm look, anywhere under src/ui/. */
const LEGACY_LITERALS = [
  '#e8e0d0', '#d8d0c0', '#c0a060', '#6a5030', '#ffe0a0', '#9a8868', '#a09070', '#d0c8b0',
  '#857b6b', '#14100a', '#060402', '#d8c8a8', '#e0d8c8', '#847a6a', '#d0b090', '#bda989',
  '#c8a848', '#706050', '#605040', '#807060', '#ffe090', '#f0c060', '#80c878',
  'rgba(8,6,3,', 'rgba(200,160,60,', 'rgba(220,150,0,', 'rgba(255,180,0,',
];
/** Legacy only inside styles.ts: elsewhere it is --bsx-scene-amber (ParamStrip, tokens). */
const LEGACY_IN_STYLES_ONLY = ['#ffc840', 'rgba(255,200,64,'];

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

function legacyPaletteHits(file: string, text: string): string[] {
  const hay = normalise(text);
  const list = file.endsWith('styles.ts') ? [...LEGACY_LITERALS, ...LEGACY_IN_STYLES_ONLY] : LEGACY_LITERALS;
  return list.filter(lit => hay.includes(normalise(lit)));
}

describe('NoLegacyUiStyles helpers (seeded violations)', () => {
  it('classSelectorsOf reads class tokens from selectors and ignores comments and values', () => {
    const css = `
      /* .bs-commented { } */
      .bs-a, .bs-b:hover > .bs-c { color: #fff; }
      #bs-minimap.bs-d::after { content: ".bs-not-a-class"; }
      @media (max-width: 600px) { .bs-e { margin: 0.5px; } }
    `;
    expect(classSelectorsOf(css)).toEqual(['bs-a', 'bs-b', 'bs-c', 'bs-d', 'bs-e']);
  });

  it('arm (a) flags a styled class that nothing renders and accepts a whole-token hook', () => {
    const classes = classSelectorsOf('.bs-live { } .bs-dead { } .bs-live-ish { }');
    const rendered = [`el('div', { className: 'bs-live bsx-card' }); const x = "bs-live-ish";`];
    expect(unrenderedClasses(classes, rendered)).toEqual(['bs-dead']);
    // a longer class must not satisfy a shorter one
    expect(unrenderedClasses(['bs-live'], [`'bs-live-ish'`])).toEqual(['bs-live']);
  });

  it('arm (b) flags a legacy literal regardless of case and spacing', () => {
    expect(legacyPaletteHits('src/ui/X.ts', `color:#E8E0D0`)).toEqual(['#e8e0d0']);
    expect(legacyPaletteHits('src/ui/X.ts', `background: rgba( 8, 6, 3, .9)`)).toEqual(['rgba(8,6,3,']);
    expect(legacyPaletteHits('src/ui/X.ts', `border:1px solid var(--bsx-hairline)`)).toEqual([]);
  });

  it('#ffc840 counts only inside styles.ts', () => {
    expect(legacyPaletteHits('src/ui/styles.ts', 'color:#ffc840')).toEqual(['#ffc840']);
    expect(legacyPaletteHits('src/ui/scene/ParamStrip.ts', 'color:#ffc840')).toEqual([]);
    expect(legacyPaletteHits('src/ui/tokens.ts', '--bsx-scene-amber: #ffc840')).toEqual([]);
    expect(legacyPaletteHits('src/ui/styles.ts', 'border:rgba(255,200,64,.6)')).toEqual(['rgba(255,200,64,']);
  });
});

describe('NoLegacyUiStyles', () => {
  it('every class styled by src/ui/styles.ts is rendered by some other file under src/', () => {
    const classes = classSelectorsOf(readFileSync(STYLES, 'utf8'));
    const others = walk(SRC).filter(f => f !== STYLES).map(f => readFileSync(f, 'utf8'));
    expect(unrenderedClasses(classes, others), 'styles.ts rules for classes nothing renders').toEqual([]);
  });

  it('no pre-redesign palette literal appears under src/ui/', () => {
    const hits: string[] = [];
    for (const f of walk(UI)) {
      for (const lit of legacyPaletteHits(f, readFileSync(f, 'utf8'))) hits.push(`${relative(ROOT, f)}: ${lit}`);
    }
    expect(hits).toEqual([]);
  });

  it('the bsx tokens themselves hold no legacy literal', () => {
    expect(legacyPaletteHits(join(UI, 'tokens.ts'), readFileSync(join(UI, 'tokens.ts'), 'utf8'))).toEqual([]);
  });
});
