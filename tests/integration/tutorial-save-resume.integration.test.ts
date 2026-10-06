// @vitest-environment jsdom
// BlastSimulator2026 — Integration: tutorial progress survives save/load (#1333)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { campaignStartCommand } from '../../src/console/commands/campaign.js';
import { TutorialOverlay } from '../../src/ui/TutorialOverlay.js';
import { TUTORIAL_STEPS } from '../../src/ui/tutorialSteps.js';
import { serialize, deserialize } from '../../src/core/state/SaveLoad.js';
import { createGame } from '../../src/core/state/GameState.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { makeGameContext } from '../helpers/gameContext.js';

type Internals = { stepIndex: number; landOnStep: (i: number) => void };
const internals = (o: TutorialOverlay) => o as unknown as Internals;

const POLICY_STEP = TUTORIAL_STEPS.findIndex(s => s.id === 'set-early-policy');

function startTutorial(ctx: GameContext, container: HTMLElement): TutorialOverlay {
  campaignStartCommand(ctx, [], { level: 'tutorial_pit' });
  const overlay = new TutorialOverlay(container);
  overlay.start(ctx.state!);
  return overlay;
}

describe('Tutorial save/resume (#1333)', () => {
  let ctx: GameContext;
  let container: HTMLDivElement;
  const overlays: TutorialOverlay[] = [];
  const track = (o: TutorialOverlay) => { overlays.push(o); return o; };

  beforeEach(() => {
    ctx = makeGameContext({ seed: '42', size: '24' });
    container = document.createElement('div');
    document.body.appendChild(container);
    try { localStorage.removeItem('bs_tutorial_done'); } catch { /* ignore */ }
  });

  afterEach(() => {
    overlays.splice(0).forEach(o => o.dispose());
    container.remove();
  });

  it('fixture: policy step exists and has a snapshot', () => {
    expect(POLICY_STEP).toBeGreaterThan(0);
    expect(TUTORIAL_STEPS[POLICY_STEP]!.captureSnapshot).toBeDefined();
  });

  it('records progress on the state while the tutorial runs', () => {
    const o = track(startTutorial(ctx, container));
    expect(ctx.state!.tutorialProgress?.stepIndex).toBe(0);
    internals(o).landOnStep(POLICY_STEP);
    expect(ctx.state!.tutorialProgress?.stepIndex).toBe(POLICY_STEP);
  });

  it('resume on a fresh overlay restores step, active and paused', () => {
    const o = track(startTutorial(ctx, container));
    internals(o).landOnStep(POLICY_STEP);

    const loaded = deserialize(serialize(ctx.state!));
    const fresh = track(new TutorialOverlay(container));
    expect(fresh.resume(loaded)).toBe(true);
    expect(internals(fresh).stepIndex).toBe(POLICY_STEP);
    expect(fresh.isActive).toBe(true);
    expect(loaded.isPaused).toBe(true);
  });

  it('a snapshot-dependent step completes after resume using the saved baseline', () => {
    const o = track(startTutorial(ctx, container));
    internals(o).landOnStep(POLICY_STEP);
    // Policy changes after the baseline was captured but before the save: only
    // the saved baseline (not a re-captured one) sees this as a change.
    ctx.state!.sitePolicy.revision += 1;

    const loaded = deserialize(serialize(ctx.state!));
    const fresh = track(new TutorialOverlay(container));
    expect(fresh.resume(loaded)).toBe(true);
    expect(internals(fresh).stepIndex).toBe(POLICY_STEP);
    fresh.onCommandExecuted(loaded);
    expect(internals(fresh).stepIndex).toBe(POLICY_STEP + 1);
  });

  it('each step snapshot survives a JSON round-trip', () => {
    const o = track(startTutorial(ctx, container));
    TUTORIAL_STEPS.forEach((step, i) => {
      if (!step.captureSnapshot) return;
      const snap = step.captureSnapshot(ctx.state!);
      expect(JSON.parse(JSON.stringify(snap)), step.id).toEqual(snap);
      internals(o).landOnStep(i);
      const loaded = deserialize(serialize(ctx.state!));
      expect(loaded.tutorialProgress?.stepIndex, step.id).toBe(i);
      expect(loaded.tutorialProgress?.snapshot, step.id).toEqual(ctx.state!.tutorialProgress?.snapshot);
    });
  });

  it.each(['finish', 'exit', 'abandon'] as const)('%s clears tutorialProgress', (method) => {
    const o = track(startTutorial(ctx, container));
    internals(o).landOnStep(POLICY_STEP);
    expect(ctx.state!.tutorialProgress).toBeTruthy();
    (o as unknown as Record<string, () => void>)[method]!();
    expect(ctx.state!.tutorialProgress == null).toBe(true);
  });

  it('resume returns false for a non-tutorial level', () => {
    const o = track(startTutorial(ctx, container));
    internals(o).landOnStep(POLICY_STEP);
    const loaded = deserialize(serialize(ctx.state!));
    loaded.campaign.activeLevelId = 'level_1';
    const fresh = track(new TutorialOverlay(container));
    expect(fresh.resume(loaded)).toBe(false);
    expect(fresh.isActive).toBe(false);
  });

  it('resume returns false without progress', () => {
    campaignStartCommand(ctx, [], { level: 'tutorial_pit' });
    const fresh = track(new TutorialOverlay(container));
    expect(fresh.resume(ctx.state!)).toBe(false);
    expect(fresh.isActive).toBe(false);
  });

  it('resume returns false when the saved index is past the last step', () => {
    campaignStartCommand(ctx, [], { level: 'tutorial_pit' });
    const state: GameState = ctx.state!;
    state.tutorialProgress = { stepIndex: TUTORIAL_STEPS.length, snapshot: {} };
    const fresh = track(new TutorialOverlay(container));
    expect(fresh.resume(state)).toBe(false);
    expect(fresh.isActive).toBe(false);
  });

  it('resume returns false for a game that never had a tutorial', () => {
    const fresh = track(new TutorialOverlay(container));
    expect(fresh.resume(createGame({ seed: 1 }))).toBe(false);
  });
});
