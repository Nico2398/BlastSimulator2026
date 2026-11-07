// BlastSimulator2026 — shared filter/sort bar for list panels (#2159).
// The bar only chooses what to show; the panel applies the selection to its rows.

export interface FilterChoice {
  /** Value stored in the selection ('' is a valid value, e.g. generic rubble). */
  value: string;
  label: string;
}

export interface SortChoice {
  key: string;
  label: string;
}

export interface FilterBarConfig {
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

  clear(): void {
    throw new Error('not implemented');
  }

  isActive(): boolean {
    throw new Error('not implemented');
  }
}

/** Build the bar from the selection; clicks mutate the selection and call `onChange`. */
export function filterBar(_selection: FilterBarSelection, _cfg: FilterBarConfig): HTMLElement {
  throw new Error('not implemented');
}
