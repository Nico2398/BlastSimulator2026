// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { filterBar, FilterBarSelection, type FilterBarConfig } from '../../../src/ui/filterBar.js';

function makeCfg(overrides: Partial<FilterBarConfig> = {}): FilterBarConfig {
  return {
    choices: [
      { value: 'dirtite', label: 'Dirtite' },
      { value: 'rustite', label: 'Rustite' },
      { value: '', label: 'Rubble' },
    ],
    sorts: [
      { key: 'price', label: 'Price' },
      { key: 'deadline', label: 'Deadline' },
    ],
    onChange: () => {},
    allLabel: 'All',
    filterLabel: 'Material',
    sortLabel: 'Sort',
    clearLabel: 'Clear',
    ...overrides,
  };
}

function choiceBtn(bar: HTMLElement, value: string): HTMLButtonElement {
  return bar.querySelector<HTMLButtonElement>(`button[data-filter-value="${value}"]`)!;
}
function sortBtn(bar: HTMLElement, key: string): HTMLButtonElement {
  return bar.querySelector<HTMLButtonElement>(`button[data-sort-key="${key}"]`)!;
}
function allBtn(bar: HTMLElement): HTMLButtonElement {
  return bar.querySelector<HTMLButtonElement>('button[data-filter-all]')!;
}
function clearBtn(bar: HTMLElement): HTMLButtonElement | null {
  return bar.querySelector<HTMLButtonElement>('.bs-filter-clear');
}
function pressed(btn: Element | null): boolean {
  return btn?.getAttribute('aria-pressed') === 'true';
}

describe('FilterBarSelection', () => {
  it('starts inactive with no filter and no sort', () => {
    const sel = new FilterBarSelection();
    expect(sel.filter).toBeNull();
    expect(sel.sort).toBeNull();
    expect(sel.isActive()).toBe(false);
  });

  it('is active when only a filter is set', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'dirtite';
    expect(sel.isActive()).toBe(true);
  });

  it('is active when only a sort is set', () => {
    const sel = new FilterBarSelection();
    sel.sort = 'price';
    expect(sel.isActive()).toBe(true);
  });

  it('is active for the empty-string filter value (rubble)', () => {
    const sel = new FilterBarSelection();
    sel.filter = '';
    expect(sel.isActive()).toBe(true);
  });

  it('clear() resets both fields', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'dirtite';
    sel.sort = 'price';
    sel.clear();
    expect(sel.filter).toBeNull();
    expect(sel.sort).toBeNull();
    expect(sel.isActive()).toBe(false);
  });

  it('clear() on an inactive selection is a no-op', () => {
    const sel = new FilterBarSelection();
    sel.clear();
    expect(sel.isActive()).toBe(false);
  });
});

describe('filterBar structure', () => {
  it('root carries the bs-filter-bar class', () => {
    const bar = filterBar(new FilterBarSelection(), makeCfg());
    expect(bar.classList.contains('bs-filter-bar')).toBe(true);
  });

  it('renders one button per choice with its value attribute and label', () => {
    const bar = filterBar(new FilterBarSelection(), makeCfg());
    expect(bar.querySelectorAll('button[data-filter-value]').length).toBe(3);
    expect(choiceBtn(bar, 'dirtite').textContent).toContain('Dirtite');
    expect(choiceBtn(bar, 'rustite').textContent).toContain('Rustite');
    expect(choiceBtn(bar, '').textContent).toContain('Rubble');
  });

  it('renders one button per sort with its key attribute and label', () => {
    const bar = filterBar(new FilterBarSelection(), makeCfg());
    expect(bar.querySelectorAll('button[data-sort-key]').length).toBe(2);
    expect(sortBtn(bar, 'price').textContent).toContain('Price');
    expect(sortBtn(bar, 'deadline').textContent).toContain('Deadline');
  });

  it('renders an all button carrying the all label', () => {
    const bar = filterBar(new FilterBarSelection(), makeCfg());
    expect(allBtn(bar)).not.toBeNull();
    expect(allBtn(bar).textContent).toContain('All');
  });

  it('shows the filter and sort group labels', () => {
    const text = filterBar(new FilterBarSelection(), makeCfg()).textContent ?? '';
    expect(text).toContain('Material');
    expect(text).toContain('Sort');
  });

  it('renders no clear button while the selection is inactive', () => {
    const bar = filterBar(new FilterBarSelection(), makeCfg());
    expect(clearBtn(bar)).toBeNull();
  });

  it('renders the clear button with its label once a filter is set', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'dirtite';
    const clear = clearBtn(filterBar(sel, makeCfg()));
    expect(clear).not.toBeNull();
    expect(clear!.textContent).toContain('Clear');
  });

  it('renders the clear button once only a sort is set', () => {
    const sel = new FilterBarSelection();
    sel.sort = 'price';
    expect(clearBtn(filterBar(sel, makeCfg()))).not.toBeNull();
  });

  it('renders no filter buttons when there are no choices, still rendering sorts', () => {
    const bar = filterBar(new FilterBarSelection(), makeCfg({ choices: [] }));
    expect(bar.querySelectorAll('button[data-filter-value]').length).toBe(0);
    expect(bar.querySelectorAll('button[data-sort-key]').length).toBe(2);
  });

  it('omits the sort row when there are no sorts (#2162)', () => {
    const bar = filterBar(new FilterBarSelection(), makeCfg({ sorts: [] }));
    expect(bar.querySelectorAll('button[data-sort-key]').length).toBe(0);
    const labels = [...bar.querySelectorAll('.bs-filter-label')].map(l => l.textContent);
    expect(labels).toEqual(['Material']);
    expect(bar.querySelectorAll('button[data-filter-value]').length).toBe(3);
  });

  it('marks no choice or sort as pressed on a fresh selection', () => {
    const bar = filterBar(new FilterBarSelection(), makeCfg());
    for (const b of bar.querySelectorAll('button[data-filter-value], button[data-sort-key]')) {
      expect(pressed(b)).toBe(false);
    }
  });
});

describe('filterBar clicks', () => {
  it('clicking a choice sets the filter and calls onChange with the selection', () => {
    const sel = new FilterBarSelection();
    const onChange = vi.fn();
    const bar = filterBar(sel, makeCfg({ onChange }));
    choiceBtn(bar, 'dirtite').click();
    expect(sel.filter).toBe('dirtite');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(sel);
  });

  it('clicking the empty-value choice sets the filter to the empty string, not null', () => {
    const sel = new FilterBarSelection();
    const bar = filterBar(sel, makeCfg());
    choiceBtn(bar, '').click();
    expect(sel.filter).toBe('');
  });

  it('clicking another choice replaces the filter', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'dirtite';
    const bar = filterBar(sel, makeCfg());
    choiceBtn(bar, 'rustite').click();
    expect(sel.filter).toBe('rustite');
  });

  it('clicking the selected choice again clears the filter and still calls onChange', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'dirtite';
    const onChange = vi.fn();
    const bar = filterBar(sel, makeCfg({ onChange }));
    choiceBtn(bar, 'dirtite').click();
    expect(sel.filter).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('clicking the selected empty-value choice again clears it to null', () => {
    const sel = new FilterBarSelection();
    sel.filter = '';
    const bar = filterBar(sel, makeCfg());
    choiceBtn(bar, '').click();
    expect(sel.filter).toBeNull();
  });

  it('clicking a sort sets the sort and calls onChange', () => {
    const sel = new FilterBarSelection();
    const onChange = vi.fn();
    const bar = filterBar(sel, makeCfg({ onChange }));
    sortBtn(bar, 'deadline').click();
    expect(sel.sort).toBe('deadline');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(sel);
  });

  it('clicking the selected sort again returns to default order (null)', () => {
    const sel = new FilterBarSelection();
    sel.sort = 'price';
    const onChange = vi.fn();
    const bar = filterBar(sel, makeCfg({ onChange }));
    sortBtn(bar, 'price').click();
    expect(sel.sort).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a sort click leaves the filter alone and a filter click leaves the sort alone', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'dirtite';
    sel.sort = 'price';
    const bar = filterBar(sel, makeCfg());
    sortBtn(bar, 'deadline').click();
    expect(sel.filter).toBe('dirtite');
    choiceBtn(bar, 'rustite').click();
    expect(sel.sort).toBe('deadline');
  });

  it('the all button resets the filter, keeps the sort, and calls onChange', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'dirtite';
    sel.sort = 'price';
    const onChange = vi.fn();
    const bar = filterBar(sel, makeCfg({ onChange }));
    allBtn(bar).click();
    expect(sel.filter).toBeNull();
    expect(sel.sort).toBe('price');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('the clear button resets both filter and sort and calls onChange', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'rustite';
    sel.sort = 'deadline';
    const onChange = vi.fn();
    const bar = filterBar(sel, makeCfg({ onChange }));
    clearBtn(bar)!.click();
    expect(sel.filter).toBeNull();
    expect(sel.sort).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(sel);
  });
});

describe('filterBar selection persistence', () => {
  it('a bar built from a selection with a filter shows that choice pressed and the others not', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'rustite';
    const bar = filterBar(sel, makeCfg());
    expect(pressed(choiceBtn(bar, 'rustite'))).toBe(true);
    expect(pressed(choiceBtn(bar, 'dirtite'))).toBe(false);
    expect(pressed(choiceBtn(bar, ''))).toBe(false);
  });

  it('a bar built from a selection with a sort shows that sort pressed and the others not', () => {
    const sel = new FilterBarSelection();
    sel.sort = 'deadline';
    const bar = filterBar(sel, makeCfg());
    expect(pressed(sortBtn(bar, 'deadline'))).toBe(true);
    expect(pressed(sortBtn(bar, 'price'))).toBe(false);
  });

  it('the empty-string filter shows the empty-value choice pressed', () => {
    const sel = new FilterBarSelection();
    sel.filter = '';
    const bar = filterBar(sel, makeCfg());
    expect(pressed(choiceBtn(bar, ''))).toBe(true);
    expect(pressed(choiceBtn(bar, 'dirtite'))).toBe(false);
  });

  it('a new bar built after a click shows the same pressed buttons (survives re-render)', () => {
    const sel = new FilterBarSelection();
    const cfg = makeCfg();
    const first = filterBar(sel, cfg);
    choiceBtn(first, 'dirtite').click();
    sortBtn(first, 'price').click();

    const second = filterBar(sel, cfg);
    expect(pressed(choiceBtn(second, 'dirtite'))).toBe(true);
    expect(pressed(sortBtn(second, 'price'))).toBe(true);
    expect(pressed(choiceBtn(second, 'rustite'))).toBe(false);
    expect(pressed(sortBtn(second, 'deadline'))).toBe(false);
    expect(clearBtn(second)).not.toBeNull();
  });

  it('after clear the rebuilt bar has nothing pressed and no clear button', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'dirtite';
    sel.sort = 'price';
    const cfg = makeCfg();
    clearBtn(filterBar(sel, cfg))!.click();
    const rebuilt = filterBar(sel, cfg);
    expect(pressed(choiceBtn(rebuilt, 'dirtite'))).toBe(false);
    expect(pressed(sortBtn(rebuilt, 'price'))).toBe(false);
    expect(clearBtn(rebuilt)).toBeNull();
  });
});

describe('filterBar extra groups (#2160)', () => {
  const groups = [
    { id: 'union', label: 'Union', choices: [{ value: 'union', label: 'Union only' }, { value: 'non_union', label: 'Non-union only' }] },
    { id: 'level', label: 'Min level', choices: [{ value: '2', label: '2+' }, { value: '3', label: '3+' }] },
  ];

  function row(bar: HTMLElement, id: string): HTMLElement | null {
    return bar.querySelector<HTMLElement>(`[data-filter-group="${id}"]`);
  }
  function groupBtn(bar: HTMLElement, id: string, value: string): HTMLButtonElement {
    return row(bar, id)!.querySelector<HTMLButtonElement>(`button[data-filter-value="${value}"]`)!;
  }
  const groupValue = (sel: FilterBarSelection, id: string): string | null => sel.groups[id] ?? null;

  it('a fresh selection has no group values', () => {
    expect(new FilterBarSelection().groups).toEqual({});
  });

  it('renders no group rows when the config has no groups', () => {
    const bar = filterBar(new FilterBarSelection(), makeCfg());
    expect(bar.querySelectorAll('[data-filter-group]').length).toBe(0);
  });

  it('renders one row per group with a button per choice and its label', () => {
    const bar = filterBar(new FilterBarSelection(), makeCfg({ groups }));
    expect(row(bar, 'union')).not.toBeNull();
    expect(row(bar, 'level')).not.toBeNull();
    expect(row(bar, 'union')!.querySelectorAll('button[data-filter-value]').length).toBe(2);
    expect(row(bar, 'level')!.querySelectorAll('button[data-filter-value]').length).toBe(2);
    expect(groupBtn(bar, 'union', 'non_union').textContent).toContain('Non-union only');
    expect(row(bar, 'level')!.textContent).toContain('Min level');
  });

  it('keeps the main filter and sort rows working beside the groups', () => {
    const bar = filterBar(new FilterBarSelection(), makeCfg({ groups }));
    expect(allBtn(bar)).not.toBeNull();
    expect(sortBtn(bar, 'price')).not.toBeNull();
    expect(bar.textContent).toContain('Material');
  });

  it('clicking a group choice sets that group only and calls onChange with the selection', () => {
    const sel = new FilterBarSelection();
    const onChange = vi.fn();
    const bar = filterBar(sel, makeCfg({ groups, onChange }));
    groupBtn(bar, 'union', 'union').click();
    expect(groupValue(sel, 'union')).toBe('union');
    expect(groupValue(sel, 'level')).toBeNull();
    expect(sel.filter).toBeNull();
    expect(sel.sort).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(sel);
  });

  it('clicking another choice in the same group replaces the value', () => {
    const sel = new FilterBarSelection();
    sel.groups['union'] = 'union';
    const bar = filterBar(sel, makeCfg({ groups }));
    groupBtn(bar, 'union', 'non_union').click();
    expect(groupValue(sel, 'union')).toBe('non_union');
  });

  it('clicking the selected group choice again clears it and still calls onChange', () => {
    const sel = new FilterBarSelection();
    sel.groups['level'] = '3';
    const onChange = vi.fn();
    const bar = filterBar(sel, makeCfg({ groups, onChange }));
    groupBtn(bar, 'level', '3').click();
    expect(groupValue(sel, 'level')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a group click leaves the main filter and sort alone', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'dirtite';
    sel.sort = 'price';
    const bar = filterBar(sel, makeCfg({ groups }));
    groupBtn(bar, 'level', '2').click();
    expect(sel.filter).toBe('dirtite');
    expect(sel.sort).toBe('price');
  });

  it('a main-filter click leaves the group values alone', () => {
    const sel = new FilterBarSelection();
    sel.groups['union'] = 'union';
    const bar = filterBar(sel, makeCfg({ groups }));
    choiceBtn(bar, 'rustite').click();
    expect(groupValue(sel, 'union')).toBe('union');
  });

  it('the all button leaves group values alone', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'dirtite';
    sel.groups['union'] = 'union';
    const bar = filterBar(sel, makeCfg({ groups }));
    allBtn(bar).click();
    expect(sel.filter).toBeNull();
    expect(groupValue(sel, 'union')).toBe('union');
  });

  it('a bar rebuilt from a selection shows the group choice pressed and the others not', () => {
    const sel = new FilterBarSelection();
    const cfg = makeCfg({ groups });
    groupBtn(filterBar(sel, cfg), 'level', '3').click();
    const rebuilt = filterBar(sel, cfg);
    expect(pressed(groupBtn(rebuilt, 'level', '3'))).toBe(true);
    expect(pressed(groupBtn(rebuilt, 'level', '2'))).toBe(false);
    expect(pressed(groupBtn(rebuilt, 'union', 'union'))).toBe(false);
  });

  it('the same value in two groups is pressed only in its own group', () => {
    const sel = new FilterBarSelection();
    const twin = [
      { id: 'a', label: 'A', choices: [{ value: 'x', label: 'X' }] },
      { id: 'b', label: 'B', choices: [{ value: 'x', label: 'X' }] },
    ];
    sel.groups['a'] = 'x';
    const bar = filterBar(sel, makeCfg({ groups: twin }));
    expect(pressed(groupBtn(bar, 'a', 'x'))).toBe(true);
    expect(pressed(groupBtn(bar, 'b', 'x'))).toBe(false);
  });

  it('a group value alone makes the selection active and shows the clear button', () => {
    const sel = new FilterBarSelection();
    expect(clearBtn(filterBar(sel, makeCfg({ groups })))).toBeNull();
    sel.groups['union'] = 'union';
    expect(sel.isActive()).toBe(true);
    expect(clearBtn(filterBar(sel, makeCfg({ groups })))).not.toBeNull();
  });

  it('a group set back to null does not keep the selection active', () => {
    const sel = new FilterBarSelection();
    sel.groups['union'] = null;
    expect(sel.isActive()).toBe(false);
  });

  it('clear() resets group values as well as filter and sort', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'dirtite';
    sel.sort = 'price';
    sel.groups['union'] = 'union';
    sel.groups['level'] = '3';
    sel.clear();
    expect(groupValue(sel, 'union')).toBeNull();
    expect(groupValue(sel, 'level')).toBeNull();
    expect(sel.isActive()).toBe(false);
  });

  it('the clear button resets group values and calls onChange', () => {
    const sel = new FilterBarSelection();
    sel.groups['level'] = '2';
    const onChange = vi.fn();
    const bar = filterBar(sel, makeCfg({ groups, onChange }));
    clearBtn(bar)!.click();
    expect(groupValue(sel, 'level')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
