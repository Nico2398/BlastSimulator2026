import type { EffectOutcome, EventWorld } from './TrafficJamEffects.js';

/** Resolves an unqualified_task event choice for the actions it concerns (#1380). */
export type UnqualifiedEffectHandler = (
  actionIds: readonly number[],
  world: EventWorld,
  tick: number,
) => EffectOutcome;

const emptyOutcome = (): EffectOutcome => ({
  effects: [],
  cashChange: 0,
  cashSettled: 0,
  scoreChanges: {},
  resultKeySuffix: '',
});

// TODO: implement
export const UNQUALIFIED_TASK_EFFECTS: Record<string, UnqualifiedEffectHandler> = {
  cancel_task: () => emptyOutcome(),
  hire_contractor: () => emptyOutcome(),
  train_employee: () => emptyOutcome(),
};
