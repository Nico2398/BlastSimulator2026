// BlastSimulator2026 — game bootstrap and panel driving for the a11y check (#1419).

export const A11Y_START_COMMAND = 'new_game seed:42 staffed:true';

/** Tool-rail entry (`data-panel`) and the panel element id it opens. */
export const A11Y_PANELS: readonly { rail: string; panelId: string }[] = [
  { rail: 'blast', panelId: 'bs-blast-panel' },
  { rail: 'survey', panelId: 'bs-survey-panel' },
  { rail: 'contracts', panelId: 'bs-contract-panel' },
  { rail: 'ops', panelId: 'bs-operations-panel' },
  { rail: 'build', panelId: 'bs-build-panel' },
  { rail: 'vehicles', panelId: 'bs-vehicle-panel' },
  { rail: 'employees', panelId: 'bs-employee-panel' },
];

/** Minimal page surface needed; a Puppeteer Page satisfies it. */
export interface A11yPage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate<T>(fn: ((...a: any[]) => T) | string, ...args: any[]): Promise<T>;
  waitForSelector(sel: string, o?: { timeout?: number; visible?: boolean }): Promise<unknown>;
}

export async function startGame(_page: A11yPage): Promise<void> {
  throw new Error('not implemented');
}

export async function openPanelViaRail(_page: A11yPage, _rail: string, _panelId: string): Promise<void> {
  throw new Error('not implemented');
}

export async function closePanelViaRail(_page: A11yPage, _rail: string, _panelId: string): Promise<void> {
  throw new Error('not implemented');
}

/** Throws when any required region has zero counted elements. */
export function assertRegionsPopulated(
  _counts: Readonly<Record<string, number>>,
  _required: readonly string[],
): void {
  throw new Error('not implemented');
}
