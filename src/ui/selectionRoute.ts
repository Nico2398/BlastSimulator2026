import type { EntityPick } from './scene/ScenePicking.js';

/** The entity currently selected in the scene, as list panels see it. */
export type ListSelection = { kind: EntityPick['kind']; id: number } | null;

/** True when `sel` names exactly the entity (`kind`, `id`). */
export function isSelected(sel: ListSelection, kind: EntityPick['kind'], id: number): boolean {
  return sel !== null && sel.kind === kind && sel.id === id;
}

/** CSS class marking the selected row in a list panel. */
export const SELECTED_ROW_CLASS = 'bs-row-selected';

/** Highlight exactly the row of `kind` matching `sel` (rows carry its id in `dataAttr`, e.g. `data-building-id`) under each container. */
export function applyRowSelection(containers: ReadonlyArray<HTMLElement>, sel: ListSelection, kind: EntityPick['kind'], dataAttr: string): void {
  for (const container of containers) {
    for (const row of Array.from(container.querySelectorAll<HTMLElement>(`[${dataAttr}]`))) {
      const on = isSelected(sel, kind, Number(row.getAttribute(dataAttr)));
      row.classList.toggle(SELECTED_ROW_CLASS, on);
      if (on) row.setAttribute('aria-selected', 'true');
      else row.removeAttribute('aria-selected');
    }
  }
}

/**
 * Re-apply `sel` to the rows under `container` and, when `scroll` is set and
 * `sel` is of `kind`, bring the highlighted row into view.
 */
export function syncRowSelection(container: HTMLElement, sel: ListSelection, kind: EntityPick['kind'], dataAttr: string, scroll: boolean): void {
  applyRowSelection([container], sel, kind, dataAttr);
  if (!scroll || sel?.kind !== kind) return;
  // Optional chained on the method: jsdom doesn't implement scrollIntoView.
  container.querySelector<HTMLElement>(`.${SELECTED_ROW_CLASS}`)?.scrollIntoView?.({ block: 'nearest' });
}

/** True when `a` and `b` name different entities (including one being null). */
export function selectionChanged(a: ListSelection, b: ListSelection): boolean {
  return a?.id !== b?.id || a?.kind !== b?.kind;
}
