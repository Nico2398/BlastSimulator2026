---
name: vehicle-fleet
description: >
  Vehicle fleet specification for BlastSimulator2026: 5 vehicle roles with 3 tiers each,
  TypeScript schemas, driver qualification, traffic and routing logic, task types,
  and atomic task breakdown. Use when implementing or modifying vehicles, driving,
  traffic, hauling, drilling, digging, or demolition mechanics.
---

## Design Philosophy

Vehicles are the player's operational muscle. Every vehicle needs a **qualified driver** (trained at Driving Center for that specific role). Vehicles share the navmesh with employees; congestion is intentional gameplay.

- **Traffic congestion** — poorly laid out ramps, clustered warehouses, or neglected debris clearance cause queuing and lost productivity.
- **Navmesh shared** — vehicles and employees navigate the same 2D nav grid (Ch.6); rock debris immediately marks cells as blocked.

## Vehicle Roles & Tier Names

Five roles, 3 tiers each. All names are fictional, humorous, and i18n-localized.

| Role | Tier 1 | Tier 2 | Tier 3 | Function |
|------|--------|--------|--------|---------|
| **Building Destroyer** | "Wrecking Rascal" | "Demolition Darling" | "Obliterator Supreme" | Demolishes buildings; required for tier-upgrade workflow |
| **Debris Hauler** | "Dumpster on Wheels" | "Haul-o-Matic 3000" | "Mega Mover XL" | Hauls fragmented rock from blast zone to Freight Warehouse |
| **Drill Rig** | "Pokey McPoke" | "Bore Master" | "Helldriller" | Drills blast holes to specified depth and angle |
| **Rock Digger** | "The Scratch" | "Scoop Sergeant" | "Voxel Vanquisher" | Removes one voxel at a time; used for ramp shaping and access routes |
| **Rock Fragmenter** | "Cracky" | "Smasher 2000" | "The Atomizer" | Breaks oversized debris boulders into transportable fragments |

## Tier Stat Multipliers

| Stat | Tier 1 | Tier 2 | Tier 3 |
|------|--------|--------|--------|
| `speed` | ×1.0 | ×1.3 | ×1.8 |
| `capacity` | ×1.0 | ×1.6 | ×2.5 |
| `workRate` | ×1.0 | ×1.4 | ×2.0 |
| `maxHp` | ×1.0 | ×1.5 | ×2.2 |
| `purchaseCost` | ×1.0 | ×2.0 | ×4.0 |
| `maintenanceCostPerTick` | ×1.0 | ×1.4 | ×2.0 |

## TypeScript Schema

```typescript
export type VehicleRole =
  | 'building_destroyer'
  | 'debris_hauler'
  | 'drill_rig'
  | 'rock_digger'
  | 'rock_fragmenter';

export type VehicleTier = 1 | 2 | 3;

export interface VehicleDef {
  role: VehicleRole;
  tier: VehicleTier;
  nameKey: string;               // i18n key, e.g. 'vehicle.debris_hauler.tier1'
  purchaseCost: number;
  maintenanceCostPerTick: number;
  speed: number;                 // cells/tick
  capacity: number;              // kg for hauler, m³ for digger, etc.
  workRate: number;              // voxels/tick, kg/tick, etc. (role-specific)
  maxHp: number;
}

export interface Vehicle {
  id: number;
  role: VehicleRole;
  tier: VehicleTier;
  x: number;
  z: number;
  hp: number;
  driverId: number | null;       // Employee ID of driver; null = uncrewed
  state: VehicleState;
  targetX: number | null;
  targetZ: number | null;
  payloadKg: number;             // Debris Hauler only
}

export type VehicleState =
  | 'idle'      // parked, no task
  | 'moving'    // travelling to target
  | 'working'   // drilling, digging, hauling, demolishing, or fragmenting
  | 'waiting'   // blocked by traffic; retries each tick
  | 'broken';   // requires repair at Vehicle Depot
```

## Driver Qualification

- Each vehicle role requires a distinct driving licence from the **Driving Center**
- Employee without the licence for a role cannot be assigned to that vehicle
- One driver per vehicle; one vehicle per driver at a time
- If driver is injured or leaves → vehicle becomes idle until qualified replacement assigned

## Traffic & Routing

Vehicles use shared navmesh (Ch.6) with A* pathfinding. Congestion is gameplay-relevant:
- Vehicles cannot share a cell. Blocked vehicle → `'waiting'` state, retries each tick
- Long waiting chains (≥ 3 vehicles on same path for ≥ 10 ticks) → `TrafficJamEvent` alert
- Rock debris after blast immediately marks cells as blocked until cleared
- Destroyed building collapses into debris cell → blocks navmesh until removed

**Player solutions to congestion:** widen ramps, build parallel haulage routes, relocate Freight Warehouse, clear debris with Rock Fragmenters before hauling.

## Vehicle Tasks

| Task | Applicable Roles | Description |
|------|-----------------|-------------|
| `move_to` | All | Travel to target cell via navmesh |
| `haul` | Debris Hauler | Pick up fragments at source → carry to Freight Warehouse |
| `drill_hole` | Drill Rig | Drill hole at target x,z to specified depth and angle |
| `dig_voxel` | Rock Digger | Remove one voxel at target position |
| `fragment` | Rock Fragmenter | Break oversized boulder at target cell into smaller fragments |
| `demolish` | Building Destroyer | Demolish the building occupying target footprint |
| `wait` | All | Blocked by traffic; retries movement each tick |

## Atomic Task Breakdown

| # | Task | File(s) |
|---|------|---------|
| 2.8.1 | Define `VehicleRole` union; rename `VehicleType` → `VehicleRole` | `src/core/entities/Vehicle.ts` |
| 2.8.2 | Define `VehicleTier`, `VehicleDef`, `VehicleState` types | `src/core/entities/Vehicle.ts` |
| 2.8.3 | Create `VEHICLE_DEFS` catalog (5 roles × 3 tiers = 15 entries) with tier multipliers | `src/core/entities/Vehicle.ts` |
| 2.8.4 | Add i18n keys for all 15 vehicle tier names (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` |
| 2.8.5 | Add `driverId`, `state`, `payloadKg`, `targetX/Z` fields to `Vehicle` | `src/core/entities/Vehicle.ts` |
| 2.8.6 | Implement `assignDriver()` — validate employee has licence for this role | `src/core/entities/Vehicle.ts` |
| 2.8.7 | Implement `tickVehicle()` — advance movement along navmesh; `waiting` on cell collision | `src/core/engine/GameLoop.ts` |
| 2.8.8 | Implement `TrafficJamEvent` — fires at ≥3 vehicles waiting ≥10 ticks | `src/core/events/EventEngine.ts` |
| 2.8.9 | Implement `demolishBuilding()` task — remove building, update navmesh | `src/core/entities/Building.ts` |
| 2.8.10 | Implement `digVoxel()` task for Rock Digger — remove single voxel, update navmesh | `src/core/mining/DrillPlan.ts` |
| 2.8.11 | Implement `fragmentBoulder()` task — convert oversized debris to transportable fragments | `src/core/mining/BlastCalc.ts` |
| 2.8.12 | Wire vehicle purchase, assign-driver, task dispatch into console commands | `src/console/commands/entities.ts` |
| 2.8.13 | Update vehicle renderer — role-specific mesh, tier color/scale variation | `src/renderer/VehicleMesh.ts` |
