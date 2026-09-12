// BlastSimulator2026 — placementRefusalReason, the shared "why is Confirm dead" text
//
// Every panel that arms the placement tool (BuildMenu, SurveyPanel, the Drill
// blast step) routes its refusal copy through this one function, so a refusal
// reads the same wherever it comes from (#489). The order of its checks is the
// behaviour worth pinning: a claim refusal outranks an uneven footprint, which
// outranks an out-of-region tile, which outranks "nothing picked yet".
//
// Two branches had no test until the #1008 tolerance added a third: the
// footprint-spread refusal and the fallback for a selection that is present but
// unconfirmable for no reason the controller names.

import { describe, it, expect } from 'vitest';
import { placementRefusalReason } from '../../../../src/ui/scene/PlacementKit.js';
import type { PlacementController } from '../../../../src/ui/scene/PlacementController.js';
import { t } from '../../../../src/core/i18n/I18n.js';
import { BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD } from '../../../../src/core/config/balance.js';

type ControllerShape = Pick<
  PlacementController,
  'canConfirm' | 'refusalReason' | 'footprintInvalid' | 'refusedTile' | 'selection'
>;

function controller(over: Partial<ControllerShape> = {}): PlacementController {
  const stub: ControllerShape = {
    canConfirm: false,
    refusalReason: null,
    footprintInvalid: false,
    refusedTile: null,
    selection: null,
    ...over,
  };
  return stub as PlacementController;
}

describe('placementRefusalReason', () => {
  it('says nothing when Confirm is live', () => {
    expect(placementRefusalReason(controller({ canConfirm: true }))).toBeUndefined();
  });

  it('names the claim refusal ahead of every other reason', () => {
    const reason = placementRefusalReason(
      controller({
        refusalReason: 'protected_structure',
        footprintInvalid: true,
        refusedTile: { x: 3, z: 4 },
      })
    );
    expect(reason).toBe(t('shell.placement.refused_protected_ground'));
  });

  it('maps each claim refusal to its own copy, with not_adjacent bridged onto too_far', () => {
    expect(placementRefusalReason(controller({ refusalReason: 'expansion_disabled' }))).toBe(
      t('shell.placement.refused_expansion_disabled')
    );
    expect(placementRefusalReason(controller({ refusalReason: 'too_far' }))).toBe(
      t('shell.placement.refused_too_far')
    );
    expect(placementRefusalReason(controller({ refusalReason: 'not_adjacent' }))).toBe(
      t('shell.placement.refused_too_far')
    );
  });

  it('names the height tolerance the footprint broke, interpolated from the constant', () => {
    const reason = placementRefusalReason(
      controller({ footprintInvalid: true, refusedTile: { x: 1, z: 1 }, selection: null })
    );
    expect(reason).toBe(
      t('shell.placement.refused_uneven_ground', { max: BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD })
    );
    expect(reason).toContain(String(BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD));
  });

  it('points an out-of-region tile back inside the outline', () => {
    expect(placementRefusalReason(controller({ refusedTile: { x: 9, z: 2 } }))).toBe(
      t('shell.placement.outside_region')
    );
  });

  it('asks for a first click when nothing is picked', () => {
    expect(placementRefusalReason(controller())).toBe(t('shell.placement.pick_first'));
  });

  it('falls back to the out-of-region copy for a selection the controller refuses unnamed', () => {
    const selection: PlacementController['selection'] = { x1: 2, z1: 2, x2: 2, z2: 2 };
    expect(placementRefusalReason(controller({ selection }))).toBe(
      t('shell.placement.outside_region')
    );
  });
});
