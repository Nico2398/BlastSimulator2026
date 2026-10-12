// @vitest-environment jsdom
// BlastSimulator2026 — Fenced audio faults are logged once
// The interface layer swallows its own faults so a click is never broken, but a fault must stay visible
// (the browser smoke test watches console.error). One line per module, not one per click.

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { RecordingPlayer } from '../../../helpers/audioPlayerFakes.js';

let errors: MockInstance<Parameters<typeof console.error>, void>;

beforeEach(() => {
  vi.resetModules(); // each test gets modules whose "already reported" flags are fresh
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => errors.mockRestore());

describe('createFaultReporter', () => {
  it('logs the first fault with its prefix and drops the rest', async () => {
    const { createFaultReporter } = await import('../../../../src/audio/ui/safePlay.js');
    const report = createFaultReporter('thing');
    const first = new TypeError('first');
    report(first);
    report(new Error('second'));
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]![0]).toContain('[thing]');
    expect(errors.mock.calls[0]![1]).toBe(first);
  });

  it('keeps one flag per reporter', async () => {
    const { createFaultReporter } = await import('../../../../src/audio/ui/safePlay.js');
    createFaultReporter('a')(new Error('x'));
    createFaultReporter('b')(new Error('y'));
    expect(errors).toHaveBeenCalledTimes(2);
  });
});

describe('safePlay', () => {
  it('swallows a throwing player, logs once, and keeps playing afterwards', async () => {
    const { safePlay } = await import('../../../../src/audio/ui/safePlay.js');
    const player = new RecordingPlayer();
    player.throwOnPlay = true;
    expect(() => safePlay(player, 'ui_click')).not.toThrow();
    expect(() => safePlay(player, 'ui_click')).not.toThrow();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]![0]).toContain('[safePlay]');
    player.throwOnPlay = false;
    safePlay(player, 'ui_open');
    expect(player.ids).toEqual(['ui_open']);
  });
});

describe('installUiSounds listeners', () => {
  it('swallows a fault inside a handler, logs it once, and never breaks the click', async () => {
    const { installUiSounds } = await import('../../../../src/audio/ui/installUiSounds.js');
    const dispose = installUiSounds(document, new RecordingPlayer(), {
      isInert: () => { throw new TypeError('inert probe failed'); },
    });
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    let reached = false;
    btn.addEventListener('click', () => { reached = true; });
    expect(() => btn.click()).not.toThrow();
    btn.click();
    expect(reached).toBe(true);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]![0]).toContain('[installUiSounds]');
    expect(errors.mock.calls[0]![1]).toBeInstanceOf(TypeError);
    dispose();
    btn.remove();
  });
});
