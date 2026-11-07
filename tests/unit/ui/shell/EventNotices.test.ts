// @vitest-environment jsdom
//
// The minor-event notice dock (#2146): one card per notice, a choice button that answers it by event id, a countdown
// that updates in place (so a click that straddles a tick is not lost), and no overlap with the minimap.
import { describe, it, expect, beforeEach } from 'vitest';
import { EventNotices } from '../../../../src/ui/shell/EventNotices.js';
import { shellLayoutRegistry, rectsIntersect } from '../../../../src/ui/shell/LayoutRegistry.js';
import { setupEvents } from '../../../../src/core/events/index.js';
import { getAllEvents } from '../../../../src/core/events/EventPool.js';
import { isMajorEvent } from '../../../../src/core/events/EventWeight.js';
import { createGame, type GameState } from '../../../../src/core/state/GameState.js';
import { MINIMAP_EDGE_OFFSET_PX, MINIMAP_HEIGHT_PX, MINIMAP_WIDTH_PX } from '../../../../src/ui/tokens.js';

function setup(): { state: GameState; eventId: string; dock: EventNotices; root: HTMLElement; sent: string[] } {
  setupEvents();
  const state = createGame({ seed: 42 });
  state.cash = 100_000;
  const def = getAllEvents().find(d => !isMajorEvent(d, state.cash))!;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dock = new EventNotices(container);
  const sent: string[] = [];
  dock.setGameConsole(cmd => { sent.push(cmd); return { success: true, output: '' }; });
  return { state, eventId: def.id, dock, root: container.querySelector('#bs-event-notices') as HTMLElement, sent };
}

describe('EventNotices dock', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('renders no card without a notice, and one card per notice with a countdown', () => {
    const { state, eventId, dock, root } = setup();
    dock.update(state);
    expect(root.querySelectorAll('.bs-notice')).toHaveLength(0);
    state.events.minorNotices.push({ eventId, firedAtTick: 0, expiresAtTick: 150, minor: true });
    dock.update(state);
    expect(root.querySelectorAll('.bs-notice')).toHaveLength(1);
    expect(root.querySelector('.bs-notice-countdown')!.textContent).toContain('150');
  });

  it('answers by option index and event id when a choice is clicked', () => {
    const { state, eventId, dock, root, sent } = setup();
    state.events.minorNotices.push({ eventId, firedAtTick: 0, expiresAtTick: 150, minor: true });
    dock.update(state);
    (root.querySelectorAll('.bs-notice-choice')[1] as HTMLElement).click();
    expect(sent).toEqual([`event choose 1 ${eventId}`]);
  });

  it('updates the countdown in place without rebuilding the card', () => {
    const { state, eventId, dock, root } = setup();
    state.events.minorNotices.push({ eventId, firedAtTick: 0, expiresAtTick: 150, minor: true });
    dock.update(state);
    const card = root.querySelector('.bs-notice');
    const choice = root.querySelector('.bs-notice-choice');
    state.tickCount = 40;
    dock.update(state);
    expect(root.querySelector('.bs-notice')).toBe(card);
    expect(root.querySelector('.bs-notice-choice')).toBe(choice);
    expect(root.querySelector('.bs-notice-countdown')!.textContent).toContain('110');
  });

  it('declares a region that clears the minimap, and drops it on dispose', () => {
    const { dock } = setup();
    const viewport = { width: 1280, height: 720 };
    const region = shellLayoutRegistry.list().find(r => r.id === 'event-notices')!;
    const minimap = {
      x: viewport.width - MINIMAP_EDGE_OFFSET_PX - MINIMAP_WIDTH_PX,
      y: viewport.height - MINIMAP_EDGE_OFFSET_PX - MINIMAP_HEIGHT_PX,
      width: MINIMAP_WIDTH_PX, height: MINIMAP_HEIGHT_PX,
    };
    expect(rectsIntersect(region.bounds(viewport), minimap)).toBe(false);
    dock.dispose();
    expect(shellLayoutRegistry.has('event-notices')).toBe(false);
  });
});
