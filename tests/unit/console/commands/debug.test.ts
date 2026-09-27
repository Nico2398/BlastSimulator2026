// BlastSimulator2026 — debugCommand unit tests (#1206)
// `debug occupancy status|on|off` was previously exercised only indirectly
// through a scenario step that has since switched to `new_game
// agent_occupancy:true`, leaving debug.ts uncovered. These tests exercise it
// directly.

import { describe, it, expect } from 'vitest';
import { debugCommand } from '../../../../src/console/commands/debug.js';
import { makeEmptyGameContext, makeGameContext } from '../../../helpers/gameContext.js';
import type { AgentOccupancy } from '../../../../src/core/nav/AgentOccupancy.js';

describe('debugCommand', () => {
  it('requires a loaded game', () => {
    const ctx = makeEmptyGameContext();
    const result = debugCommand(ctx, ['occupancy', 'status'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });

  it('rejects an unknown top-level subcommand', () => {
    const ctx = makeGameContext();
    const result = debugCommand(ctx, ['bogus'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage: debug occupancy');
  });

  it('rejects a completely empty argument list', () => {
    const ctx = makeGameContext();
    const result = debugCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage: debug occupancy');
  });

  describe('occupancy status reporting', () => {
    it('reports OFF when defaulted off and no action given', () => {
      const ctx = makeGameContext();
      ctx.state!.agentOccupancyEnabled = false;
      const result = debugCommand(ctx, ['occupancy'], {});
      expect(result.success).toBe(true);
      expect(result.output).toBe('Agent occupancy: OFF.');
    });

    it('reports ON via explicit "status" when enabled', () => {
      const ctx = makeGameContext();
      ctx.state!.agentOccupancyEnabled = true;
      const result = debugCommand(ctx, ['occupancy', 'status'], {});
      expect(result.success).toBe(true);
      expect(result.output).toBe('Agent occupancy: ON.');
    });

    it('reports OFF via explicit "status" when disabled', () => {
      const ctx = makeGameContext();
      ctx.state!.agentOccupancyEnabled = false;
      const result = debugCommand(ctx, ['occupancy', 'status'], {});
      expect(result.success).toBe(true);
      expect(result.output).toBe('Agent occupancy: OFF.');
    });
  });

  describe('occupancy on', () => {
    it('sets agentOccupancyEnabled to true', () => {
      const ctx = makeGameContext();
      ctx.state!.agentOccupancyEnabled = false;
      const result = debugCommand(ctx, ['occupancy', 'on'], {});
      expect(result.success).toBe(true);
      expect(result.output).toBe('Agent occupancy: ON.');
      expect(ctx.state!.agentOccupancyEnabled).toBe(true);
    });
  });

  describe('occupancy off', () => {
    it('sets agentOccupancyEnabled to false and drops agentOccupancy to null', () => {
      const ctx = makeGameContext();
      ctx.state!.agentOccupancyEnabled = true;
      ctx.state!.agentOccupancy = {} as unknown as AgentOccupancy;
      const result = debugCommand(ctx, ['occupancy', 'off'], {});
      expect(result.success).toBe(true);
      expect(result.output).toBe('Agent occupancy: OFF.');
      expect(ctx.state!.agentOccupancyEnabled).toBe(false);
      expect(ctx.state!.agentOccupancy).toBeNull();
    });
  });

  it('rejects an unknown occupancy sub-action', () => {
    const ctx = makeGameContext();
    const result = debugCommand(ctx, ['occupancy', 'foo'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage: debug occupancy');
  });
});
