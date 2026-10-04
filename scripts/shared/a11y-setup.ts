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
  waitForFunction?(fn: string, o?: { timeout?: number }): Promise<unknown>;
}

const PANEL_VISIBLE_TIMEOUT_MS = 8000;
const HUD_TIMEOUT_MS = 15000;

interface ConsoleOutcome { ok: boolean; output: string; missing: boolean }

function runConsole(page: A11yPage, cmd: string): Promise<ConsoleOutcome> {
  return page.evaluate((c: string) => {
    const g = (window as unknown as { __gameConsole?: (x: string) => { success: boolean; output: string } }).__gameConsole;
    if (typeof g !== 'function') return { ok: false, output: '', missing: true };
    const r = g(c);
    return { ok: r.success, output: r.output, missing: false };
  }, cmd);
}

async function runOrThrow(page: A11yPage, cmd: string): Promise<void> {
  const r = await runConsole(page, cmd);
  if (r.missing) throw new Error('window.__gameConsole is not available; the game did not boot');
  if (!r.ok) throw new Error(`Console refused "${cmd}": ${r.output}`);
}

/** Start the staffed game through the console bridge and wait for the shell to render. */
export async function startGame(page: A11yPage): Promise<void> {
  await page.waitForSelector('canvas', { timeout: HUD_TIMEOUT_MS });
  await page.waitForFunction?.('typeof window.__gameConsole === "function"', { timeout: HUD_TIMEOUT_MS });
  await runOrThrow(page, A11Y_START_COMMAND);
  await runOrThrow(page, 'tick 1');
  await page.waitForSelector('#bs-hud-top', { timeout: HUD_TIMEOUT_MS, visible: true });
  await page.waitForSelector('#bs-toolbar button[data-panel]', { timeout: HUD_TIMEOUT_MS, visible: true });
}

function isVisible(page: A11yPage, panelId: string): Promise<boolean> {
  return page.evaluate((id: string) => {
    const el = document.getElementById(id);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return window.getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0;
  }, panelId);
}

function clickRail(page: A11yPage, rail: string): Promise<boolean> {
  return page.evaluate((key: string) => {
    const b = document.querySelector<HTMLButtonElement>(`#bs-toolbar button[data-panel="${key}"]`);
    if (!b) return false;
    b.click();
    return true;
  }, rail);
}

/** Open a panel by clicking its real rail button. Clicking an active button closes it, so check first. */
export async function openPanelViaRail(page: A11yPage, rail: string, panelId: string): Promise<void> {
  if (!(await isVisible(page, panelId))) {
    if (!(await clickRail(page, rail))) throw new Error(`Rail button "${rail}" not found (panel ${panelId})`);
  }
  try {
    await page.waitForSelector(`#${panelId}`, { timeout: PANEL_VISIBLE_TIMEOUT_MS, visible: true });
  } catch {
    throw new Error(`Panel ${panelId} never became visible after clicking rail "${rail}"`);
  }
}

/** Close a panel through its rail button; no-op when already hidden. */
export async function closePanelViaRail(page: A11yPage, rail: string, panelId: string): Promise<void> {
  if (!(await isVisible(page, panelId))) return;
  await clickRail(page, rail);
}

/** Throws when any required region has zero counted elements. */
export function assertRegionsPopulated(
  counts: Readonly<Record<string, number>>,
  required: readonly string[],
): void {
  const empty = required.filter(r => !((counts[r] ?? 0) > 0));
  if (empty.length > 0) {
    throw new Error(`a11y regions measured no text: ${empty.map(r => `${r} (${counts[r] ?? 0})`).join(', ')}`);
  }
}
