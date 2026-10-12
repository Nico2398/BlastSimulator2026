import { describe, it, expect } from 'vitest';
import { blastLosses } from '../../../../src/audio/director/blastLosses.js';
import { takeSnapshot } from '../../../../src/audio/director/worldSnapshot.js';
import { addBuilding, addVehicle, makeState } from './helpers.js';

function world() {
  const state = makeState();
  const hall = addBuilding(state, 'living_quarters', 10, 20);
  const depot = addBuilding(state, 'management_office', 30, 40);
  const truck = addVehicle(state, 'debris_hauler', 50, 60);
  return { snapshot: takeSnapshot(state), hall, depot, truck };
}

describe('blastLosses', () => {
  it('places the buildings and vehicles flyrock destroyed where they stood before the blast', () => {
    const { snapshot, hall, truck } = world();
    const report = { accidents: [{ type: 'building_destroyed', entityId: hall.id }, { type: 'vehicle_destroyed', entityId: truck.id }] };
    expect(blastLosses(report, snapshot)).toEqual({ buildings: [{ x: 10, z: 20 }], vehicles: [{ x: 50, z: 60 }] });
  });

  it('does not repeat a building the report already lists', () => {
    const { snapshot, hall, depot } = world();
    const report = {
      destroyedBuildings: [{ buildingId: hall.id }],
      accidents: [{ type: 'building_destroyed', entityId: hall.id }, { type: 'building_destroyed', entityId: depot.id }],
    };
    expect(blastLosses(report, snapshot).buildings).toEqual([{ x: 30, z: 40 }]);
  });

  it('counts an entity hit twice once', () => {
    const { snapshot, hall } = world();
    const report = { accidents: [{ type: 'building_destroyed', entityId: hall.id }, { type: 'building_destroyed', entityId: hall.id }] };
    expect(blastLosses(report, snapshot).buildings).toHaveLength(1);
  });

  it('ignores damage and casualties, entities it never saw, and accidents with no id', () => {
    const { snapshot } = world();
    const report = {
      accidents: [
        { type: 'building_damage', entityId: 1 },
        { type: 'vehicle_damage', entityId: 1 },
        { type: 'death', entityId: 1 },
        { type: 'building_destroyed', entityId: 9999 },
        { type: 'vehicle_destroyed' },
      ],
    };
    expect(blastLosses(report, snapshot)).toEqual({ buildings: [], vehicles: [] });
  });

  it('finds nothing without a report or without a look at the world', () => {
    const { snapshot, hall } = world();
    expect(blastLosses(null, snapshot)).toEqual({ buildings: [], vehicles: [] });
    expect(blastLosses({ accidents: [{ type: 'building_destroyed', entityId: hall.id }] }, null)).toEqual({ buildings: [], vehicles: [] });
    expect(blastLosses({}, snapshot)).toEqual({ buildings: [], vehicles: [] });
  });
});
