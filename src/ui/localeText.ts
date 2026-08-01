// BlastSimulator2026 — Locale text registry (UI helper)
//
// Panel content built inside update() re-runs t() every tick, so it follows a
// language switch on its own. Static text baked in a constructor — titles,
// close buttons, section headers, tooltips, <option> labels — is translated
// once and then never again, which is why a locale switch left half the UI in
// the previous language. Panels register those nodes here as they create them;
// refresh() re-applies t() with whatever locale is active at call time, so the
// result is idempotent under repeated EN→FR→EN switching.

import { t } from '../core/i18n/I18n.js';

export type LocaleParams = Record<string, string | number>;

/** DOM property a binding writes to. */
type Target = 'text' | 'title';

interface Binding {
  readonly el: HTMLElement;
  readonly key: string;
  readonly params: LocaleParams | undefined;
  readonly target: Target;
  readonly prefix: string;
}

function apply(b: Binding): void {
  const value = b.prefix + t(b.key, b.params);
  if (b.target === 'title') b.el.title = value;
  else b.el.textContent = value;
}

export class LocaleTextRegistry {
  private readonly bindings: Binding[] = [];

  /**
   * Set `el.textContent` to `prefix + t(key, params)` now, and again on every
   * refresh(). Returns the element so it can be used inline.
   */
  bindText<T extends HTMLElement>(el: T, key: string, params?: LocaleParams, prefix = ''): T {
    const binding: Binding = { el, key, params, target: 'text', prefix };
    this.bindings.push(binding);
    apply(binding);
    return el;
  }

  /** Same as bindText, but writes `el.title` (tooltips). */
  bindTitle<T extends HTMLElement>(el: T, key: string, params?: LocaleParams): T {
    const binding: Binding = { el, key, params, target: 'title', prefix: '' };
    this.bindings.push(binding);
    apply(binding);
    return el;
  }

  /** Re-apply every binding against the locale active right now. */
  refresh(): void {
    for (const b of this.bindings) apply(b);
  }
}
