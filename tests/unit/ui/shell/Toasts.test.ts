// @vitest-environment jsdom
//
// Regression coverage for #955: toasts anchored at `top:12px` render behind
// the top bar (`height:52px`, z-index 150) because the toast stack's own
// z-index (100, `--bsx-z-panel`) sits below it. The fix moves the toast
// stack's top offset below the bar and lifts its z-index above it, both
// driven from the shared `LAYOUT.topbarHeight` / `--bsx-topbar-height`
// token rather than a second independently-set literal.
//
// jsdom has no real layout engine — real rects are always zero here — so
// intersection is proven by parsing the inline style strings each root
// actually carries (and, where jsdom resolves a literal px, the parsed
// number) rather than by reading getBoundingClientRect.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Toasts } from '../../../../src/ui/shell/Toasts.js';
import { TopBar } from '../../../../src/ui/shell/TopBar.js';
import { LAYOUT, Z_INDEX } from '../../../../src/ui/tokens.js';
import { NotificationCenter } from '../../../../src/ui/notify/NotificationCenter.js';

const TOASTS_SRC = readFileSync(resolve(__dirname, '../../../../src/ui/shell/Toasts.ts'), 'utf-8');
const TOPBAR_SRC = readFileSync(resolve(__dirname, '../../../../src/ui/shell/TopBar.ts'), 'utf-8');

function mount(): { container: HTMLDivElement; toasts: Toasts } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const toasts = new Toasts(container);
  return { container, toasts };
}

/** Root element `Toasts` appends into its container — it has no id/data-attr of its own. */
function toastsRoot(container: HTMLElement): HTMLElement {
  return container.querySelector('.bsx-root') as HTMLElement;
}

/** Pull a top-level `key:value` declaration's raw value out of an inline `cssText`-style string. */
function styleValue(cssText: string, prop: string): string | null {
  const match = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(cssText);
  return match ? match[1]!.trim() : null;
}

describe('Toasts — z-index and top-offset vs TopBar (#955)', () => {
  it('Z_INDEX.toast sits above Z_INDEX.topbar', () => {
    expect(Z_INDEX.toast).toBeGreaterThan(Z_INDEX.topbar);
  });

  it('the toast stack z-index is not the panel tier (which sits below the top bar)', () => {
    const { container, toasts } = mount();
    const root = toastsRoot(container);
    const zIndex = styleValue(root.style.cssText, 'z-index');
    // var(--bsx-z-panel) (100) is below var(--bsx-z-topbar) (150) — the toast
    // stack must not use it, whatever token it does use instead.
    expect(zIndex).not.toBe('var(--bsx-z-panel)');
    expect(zIndex).toBe('var(--bsx-z-toast)');
    toasts.dispose();
  });

  it("the toast stack's top offset clears the top bar's own height, not a fixed 12px", () => {
    const { container, toasts } = mount();
    const root = toastsRoot(container);
    const top = styleValue(root.style.cssText, 'top');
    expect(top).not.toBeNull();

    const pxMatch = /^(\d+(?:\.\d+)?)px$/.exec(top!);
    if (pxMatch) {
      // jsdom resolved a literal pixel value (the unfixed `top:12px`) — prove
      // the AABB non-intersection numerically against the top bar's own
      // known geometry (top:0, height LAYOUT.topbarHeight, full width).
      const topPx = Number(pxMatch[1]);
      expect(topPx).toBeGreaterThanOrEqual(LAYOUT.topbarHeight);
    } else {
      // jsdom cannot resolve calc()/custom properties — fall back to the raw
      // style string, which must build the offset from the shared token
      // rather than a new magic number.
      expect(top).toContain('calc(');
      expect(top).toContain('var(--bsx-topbar-height)');
    }
    toasts.dispose();
  });

  it('both Toasts.ts and TopBar.ts reference the same --bsx-topbar-height token (single source of truth)', () => {
    // Guards against "fixed" by hardcoding a second literal (e.g. `top:64px`
    // in Toasts.ts while TopBar.ts keeps its own `height:52px`) rather than
    // deriving both from the one token the issue calls for.
    expect(TOASTS_SRC).toContain('--bsx-topbar-height');
    expect(TOPBAR_SRC).toContain('--bsx-topbar-height');
  });

  it("TopBar's own root height is driven by the shared token, not a hardcoded 52px literal", () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const root = container.querySelector('#bs-hud-top') as HTMLElement;
    const height = styleValue(root.style.cssText, 'height');
    expect(height).toBe('var(--bsx-topbar-height)');
    topBar.dispose();
  });
});

describe('Toasts — behavior (no prior coverage in the repo before #955)', () => {
  it('is visible by default and toggles via show()/hide()', () => {
    const { container, toasts } = mount();
    expect(toasts.visible).toBe(true);
    toasts.hide();
    expect(toasts.visible).toBe(false);
    expect(toastsRoot(container).style.display).toBe('none');
    toasts.show();
    expect(toasts.visible).toBe(true);
    expect(toastsRoot(container).style.display).toBe('flex');
    toasts.dispose();
  });

  it('renders nothing before any notification is pushed', () => {
    const { container, toasts } = mount();
    const center = new NotificationCenter();
    toasts.update(center);
    expect(toastsRoot(container).children.length).toBe(0);
    toasts.dispose();
  });

  it('renders a toast with its title and body once a notification is pushed', () => {
    const { container, toasts } = mount();
    const center = new NotificationCenter();
    center.notify({ severity: 'info', title: 'Survey complete', body: 'Core sample analyzed.' });
    toasts.update(center);
    const root = toastsRoot(container);
    expect(root.children.length).toBe(1);
    expect(root.textContent).toContain('Survey complete');
    expect(root.textContent).toContain('Core sample analyzed.');
    toasts.dispose();
  });

  it('re-render is skipped when the toast id signature is unchanged (no redundant DOM rebuild)', () => {
    const { container, toasts } = mount();
    const center = new NotificationCenter();
    center.notify({ severity: 'info', title: 'A', body: 'a' });
    toasts.update(center);
    const root = toastsRoot(container);
    const firstChild = root.firstElementChild;
    toasts.update(center);
    expect(root.firstElementChild).toBe(firstChild);
    toasts.dispose();
  });

  it('dismisses a toast when its close button is clicked, leaving the other toasts', () => {
    // Two toasts, not one: dismissing the *only* toast is a separate edge
    // case in the signature-diffing this test isn't targeting — keeping a
    // second toast alive throughout keeps the assertion about the close
    // button itself.
    const { container, toasts } = mount();
    const center = new NotificationCenter();
    center.notify({ severity: 'warn', title: 'Contract expiring', body: 'Soon.' });
    center.notify({ severity: 'info', title: 'Survey complete', body: 'Done.' });
    toasts.update(center);
    const root = toastsRoot(container);
    expect(root.children.length).toBe(2);
    root.querySelector('button')!.click(); // closes the first (oldest) toast
    toasts.update(center);
    expect(root.children.length).toBe(1);
    expect(root.textContent).toContain('Survey complete');
    expect(root.textContent).not.toContain('Contract expiring');
    toasts.dispose();
  });

  it('a CTA button, when present, invokes onCta and dismisses its toast, leaving the other toasts', () => {
    const { container, toasts } = mount();
    const center = new NotificationCenter();
    let ctaFired = false;
    center.notify({
      severity: 'critical', title: 'Ecology critical', body: 'Act now.',
      cta: 'REVIEW', onCta: () => { ctaFired = true; },
    });
    center.notify({ severity: 'info', title: 'Survey complete', body: 'Done.' });
    toasts.update(center);
    const root = toastsRoot(container);
    const ctaBtn = Array.from(root.querySelectorAll('button')).find(b => b.textContent === 'REVIEW')!;
    expect(ctaBtn).toBeDefined();
    ctaBtn.click();
    expect(ctaFired).toBe(true);
    toasts.update(center);
    expect(root.children.length).toBe(1);
    expect(root.textContent).not.toContain('Ecology critical');
    toasts.dispose();
  });

  it('dispose() removes the root element from the container', () => {
    const { container, toasts } = mount();
    expect(toastsRoot(container)).not.toBeNull();
    toasts.dispose();
    expect(toastsRoot(container)).toBeNull();
  });
});
