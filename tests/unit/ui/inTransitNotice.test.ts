import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
describe('removed explosive delivery save compatibility', () => {
  it('unblocks a legacy order and removes its delivery timestamp on load', () => {
    const saved = JSON.parse(serialize(createGame({ seed: 42 })));
    saved.pendingActions = [{ id: 1, type: 'charge_hole', status: 'queued',
      blockedReason: 'explosives_in_transit', payload: { deliveryArrivalTick: 400 } }];
    saved.ghostPreviews = [{ id: 1, type: 'charge_hole', blocked: true }];
    const restored = deserialize(JSON.stringify(saved));
    expect(restored.pendingActions[0]!.blockedReason).toBeNull();
    expect(restored.pendingActions[0]!.payload['deliveryArrivalTick']).toBeUndefined();
    expect(restored.ghostPreviews[0]!.blocked).toBe(false);
  });
});
