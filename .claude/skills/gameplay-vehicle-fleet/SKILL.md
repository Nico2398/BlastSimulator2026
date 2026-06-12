---
name: gameplay-vehicle-fleet
description: >
  Vehicle fleet specification for BlastSimulator2026: 5 vehicle roles with 3 tiers each,
  TypeScript schemas, driver qualification,   traffic and routing logic, and task types. Use when implementing or modifying vehicles, driving,
  traffic, hauling, drilling, digging, or demolition mechanics.
---

## Design Philosophy

Vehicles are player's operational muscle. Every vehicle needs **qualified driver** (trained at Driving Center for that specific role). Vehicles share navmesh with employees; congestion is intentional gameplay.

- **Traffic congestion** — poorly laid out ramps, clustered warehouses, neglected debris clearance → queuing + lost productivity.
- **Navmesh shared** — vehicles + employees navigate same 2D nav grid (Ch.6); rock debris immediately marks cells as blocked.

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

- Each vehicle role requires distinct driving licence from **Driving Center**
- Employee without licence for role cannot be assigned to that vehicle
- One driver per vehicle; one vehicle per driver at a time
- Driver injured or leaves → vehicle idles until qualified replacement assigned

## Traffic & Routing

Vehicles use shared navmesh (Ch.6) with A* pathfinding. Congestion is gameplay-relevant:
- Vehicles cannot share a cell. Blocked vehicle → `'waiting'` state, retries each tick
- Long waiting chains (≥ 3 vehicles on same path for ≥ 10 ticks) → `TrafficJamEvent` alert
- Rock debris after blast immediately marks cells as blocked until cleared
- Destroyed building collapses into debris cell → blocks navmesh until removed

**Player solutions to congestion:** Widen ramps, build parallel haulage routes, relocate Freight Warehouse, clear debris with Rock Fragmenters before hauling.

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

