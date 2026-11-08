// @vitest-environment jsdom
// BlastSimulator2026 — Unit tests: ActivityLog rows (#2169)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ActivityLog } from '../../../../src/ui/shell/ActivityLog.js';
import { NotificationCenter } from '../../../../src/ui/notify/NotificationCenter.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { EntityOpener } from '../../../../src/ui/entityLinks.js';
import { formatGameClock } from '../../../../src/ui/formatGameClock.js';
import { setLocale } from '../../../../src/core/i18n/I18n.js';

const LINK = 'button[data-select-kind][data-select-id]';

function mount(): { container: HTMLElement; log: ActivityLog; center: NotificationCenter } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const log = new ActivityLog(container);
  log.show();
  return { container, log, center: new NotificationCenter() };
}

/** Raises a notification stamped with `tick` (the centre stamps entries with the last state it saw). */
function notifyAt(center: NotificationCenter, tick: number, input: Parameters<NotificationCenter['notify']>[0]): void {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.tickCount = tick;
  center.update(state);
  center.notify(input);
}

afterEach(() => { document.body.innerHTML = ''; setLocale('en'); });

describe('ActivityLog (#2169)', () => {
  it('shows the empty state with no entries', () => {
    const { container, log, center } = mount();
    log.update(center);
    expect(container.querySelector(LINK)).toBeNull();
    log.dispose();
  });

  it('an entry with a ref renders its title as an entity link that opens the entity', () => {
    const { container, log, center } = mount();
    const open = vi.fn();
    const opener: EntityOpener = { open, focus: vi.fn() };
    log.setEntityOpener(opener);
    notifyAt(center, 30, { severity: 'warn', title: 'Crew alert', body: 'Bob fainted.', ref: { kind: 'employee', id: 9 } });
    log.update(center);
    const link = container.querySelector<HTMLElement>(LINK)!;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('Crew alert');
    expect(link.dataset['selectKind']).toBe('employee');
    expect(link.dataset['selectId']).toBe('9');
    link.click();
    expect(open).toHaveBeenCalledWith('employee', 9);
    log.dispose();
  });

  it('a vehicle ref opens a vehicle', () => {
    const { container, log, center } = mount();
    const open = vi.fn();
    log.setEntityOpener({ open, focus: vi.fn() });
    notifyAt(center, 5, { severity: 'warn', title: 'Truck', body: 'b', ref: { kind: 'vehicle', id: 4 } });
    log.update(center);
    container.querySelector<HTMLElement>(LINK)!.click();
    expect(open).toHaveBeenCalledWith('vehicle', 4);
    log.dispose();
  });

  it('an entry without a ref stays plain text', () => {
    const { container, log, center } = mount();
    log.setEntityOpener({ open: vi.fn(), focus: vi.fn() });
    notifyAt(center, 5, { severity: 'info', title: 'Plain entry', body: 'b' });
    log.update(center);
    expect(container.querySelector(LINK)).toBeNull();
    expect(container.textContent).toContain('Plain entry');
    log.dispose();
  });

  it('an entry with a ref but no opener wired stays plain text', () => {
    const { container, log, center } = mount();
    notifyAt(center, 5, { severity: 'info', title: 'No opener', body: 'b', ref: { kind: 'employee', id: 2 } });
    log.update(center);
    expect(container.querySelector(LINK)).toBeNull();
    expect(container.textContent).toContain('No opener');
    log.dispose();
  });

  it('rows show the game clock of the entry, not the raw tick', () => {
    const { container, log, center } = mount();
    notifyAt(center, 100, { severity: 'info', title: 'Late', body: 'b' });
    log.update(center);
    expect(container.textContent).toContain(formatGameClock(100));
    expect(container.textContent).not.toContain('t100');
    log.dispose();
  });

  it('each row carries its own clock', () => {
    const { container, log, center } = mount();
    notifyAt(center, 30, { severity: 'info', title: 'First', body: 'b' });
    notifyAt(center, 130, { severity: 'info', title: 'Second', body: 'b' });
    log.update(center);
    const text = container.textContent ?? '';
    expect(text).toContain(formatGameClock(30));
    expect(text).toContain(formatGameClock(130));
    log.dispose();
  });
});
