// BlastSimulator2026 — Console commands for ground levelling (#1009)
// Mirrors ramp.ts's shape: an order-time validation followed by queued
// `level_ground` PendingAction work carved out by a qualified driver.
//
// TODO: implement — skeleton phase only, every export below throws.

import type { CommandResult } from '../../ConsoleRunner.js';
import type { MiningContext } from './types.js';
import type { LevelOrderDef } from '../../../core/mining/LevelGround.js';

/** Payload carried by a queued `level_ground` PendingAction. */
export interface LevelGroundActionPayload {
  rect: LevelOrderDef;
  targetY: number;
  cells: { x: number; y: number; z: number }[];
  region: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  orderCost: number;
}

export function levelGroundCommand(
  _ctx: MiningContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  throw new Error('not implemented');
}

export function cancelLevelGroundCommand(_ctx: MiningContext, _actionId: string): CommandResult {
  throw new Error('not implemented');
}
