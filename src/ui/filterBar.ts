// BlastSimulator2026 — shared filter/sort bar for list panels (#2159).
// The bar only chooses what to show; the panel applies the selection to its rows.

import { el, paintToggleButton } from './dom.js';

interface FilterChoice {
  /** Value stored in the selection ('' is a valid value, e.g. generic rubble). */
  value: string;
  label: string;
}

interface SortChoice {
  key: string;
  label: string;
}

/** An extra single-choice row beside the main filter row (#2160). */
interface FilterBarGroup {
  id: string;
  label: string;
  choices: readonly FilterChoice[];
}

export interface FilterBarConfig {
  /** Extra filter rows, each keyed by `id` in `FilterBarSelection.groups`. */
  groups?: readonly FilterBarGroup[];
  choices: readonly FilterChoice[];
  sorts: readonly SortChoice[];
  onChange: (selection: FilterBarSelection) => void;
  filterLabel: string;
  sortLabel: string;
  allLabel: string;
  clearLabel: string;
}

/** The player's choice, owned by the panel so it survives re-renders. */
export class FilterBarSelection {
  filter: string | null = null;
  sort: string | null = null;
  /** Selected value per extra group id (absent or null = none). */
  groups: Record<string, string | null> = {};

  clear(): void {
    this.filter = null;
    this.sort = null;
    this.groups = {};
  }

  isActive(): boolean {
    return this.filter !== null || this.sort !== null || Object.values(this.groups).some(v => v != null);
  }
}

function barButton(label: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const btn = el('button', { className: 'bs-filter-btn', text: label, attrs: { type: 'button' } });
  paintToggleButton(btn, pressed, 'var(--bsx-hairline)');
  btn.addEventListener('click', onClick);
  return btn;
}

/** Build the bar from the selection; clicks mutate the selection and call `onChange`. */
export function filterBar(selection: FilterBarSelection, cfg: FilterBarConfig): HTMLElement {
  const emit = (): void => cfg.onChange(selection);
  const toggle = (current: string | null, next: string): string | null => (current === next ? null : next);

  const all = barButton(cfg.allLabel, selection.filter === null, () => { selection.filter = null; emit(); });
  all.dataset['filterAll'] = '';
  const filterRow = el('div', { className: 'bs-filter-row', children: [
    el('span', { className: 'bs-filter-label', text: cfg.filterLabel }),
    all,
    ...cfg.choices.map(choice => {
      const btn = barButton(choice.label, selection.filter === choice.value, () => {
        selection.filter = toggle(selection.filter, choice.value);
        emit();
      });
      btn.dataset['filterValue'] = choice.value;
      return btn;
    }),
  ] });

  const groupRows = (cfg.groups ?? []).map(group => {
    const row = el('div', { className: 'bs-filter-row', children: [
      el('span', { className: 'bs-filter-label', text: group.label }),
      ...group.choices.map(choice => {
        const btn = barButton(choice.label, selection.groups[group.id] === choice.value, () => {
          selection.groups[group.id] = toggle(selection.groups[group.id] ?? null, choice.value);
          emit();
        });
        btn.dataset['filterValue'] = choice.value;
        return btn;
      }),
    ] });
    row.dataset['filterGroup'] = group.id;
    return row;
  });

  const sortRow = cfg.sorts.length === 0 ? null : el('div', { className: 'bs-filter-row', children: [
    el('span', { className: 'bs-filter-label', text: cfg.sortLabel }),
    ...cfg.sorts.map(sort => {
      const btn = barButton(sort.label, selection.sort === sort.key, () => {
        selection.sort = toggle(selection.sort, sort.key);
        emit();
      });
      btn.dataset['sortKey'] = sort.key;
      return btn;
    }),
  ] });

  const clear = selection.isActive()
    ? barButton(cfg.clearLabel, false, () => { selection.clear(); emit(); })
    : null;
  if (clear) clear.classList.add('bs-filter-clear');

  return el('div', { className: 'bs-filter-bar', children: [filterRow, ...groupRows, sortRow, clear] });
}
