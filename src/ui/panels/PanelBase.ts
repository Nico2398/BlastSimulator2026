// BlastSimulator2026 — Shared behaviour for the slide-out panels.
//
// Every panel wears the same shell (built by dom.ts's panelRoot/panelHeader/
// panelBody) and answers the same handful of calls about it: hand me your
// root, tell me when you are closed, show/hide yourself, say whether you are
// visible, take yourself off the page. Nine panels carried an identical copy
// of that block; it lives here now.
//
// Deliberately narrow: only what every panel shares. A panel that dispatches
// console commands keeps its own `gameConsole` field, because two of them
// (BlastWorkshop forwards to its four steps, FinancesPanel needs none) do not
// want the plain setter, and an inherited API that two subclasses have to
// work around is worse than one line repeated.

/** Stamped on a panel's own close control so the tutorial rails can allow every
 *  panel's close button without a per-panel selector list (#1041) — navigating
 *  the UI is not an action the rails need to gate. */
export const PANEL_CLOSE_ATTR = 'data-panel-close';
export const PANEL_CLOSE_SELECTOR = `[${PANEL_CLOSE_ATTR}]`;

/** dataset key on a panel root counting every show() call, including re-shows of an
 *  already-visible panel, so tutorial polling can see a re-open (#1628). */
export const PANEL_OPEN_COUNT_KEY = 'openCount';

export abstract class PanelBase {
  /** The panel's root element — created by `panelRoot()`, hidden until `show()`. */
  protected readonly el: HTMLElement;
  protected onCloseCb?: () => void;

  protected constructor(el: HTMLElement) {
    this.el = el;
  }

  get root(): HTMLElement { return this.el; }

  setCloseHandler(cb: () => void): void { this.onCloseCb = cb; }

  show(): void {
    this.el.style.display = 'flex';
    this.el.dataset[PANEL_OPEN_COUNT_KEY] = String((Number(this.el.dataset[PANEL_OPEN_COUNT_KEY]) || 0) + 1);
  }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  /** Removes the panel from the page. Override to release anything else first, then call `super.dispose()`. */
  dispose(): void { this.el.remove(); }
}
