---
name: gameplay-vehicle-fleet
description: >
  Vehicle fleet specification for BlastSimulator2026: 5 vehicle roles with 3 tiers each,
  driver qualification, traffic and routing logic, and task types. Use when implementing or modifying vehicles, driving,
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
| **Rock Digger** | "The Scratch" | "Scoop Sergeant" | "Rock Reaper" | Removes one voxel at a time; used for ramp shaping and access routes |
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

## Types

`src/core/entities/Vehicle.ts` declares the shapes and is the only authority on their fields: `VehicleRole` (the five roles above), `VehicleTier`, `VehicleDef` (catalogue entry — costs, `speed` in cells/tick, `capacity`, role-specific `workRate`, `maxHp`), `Vehicle` (the live instance), `VehicleOperationalState` and `VehicleTask`. Read that file before writing against any of them — the field names there are what typechecks.

Units and per-role meanings the code does not state: `capacity` is kg for a Debris Hauler, m³/tick for a Rock Digger, holes/tick for a Drill Rig; `nameKey` is an i18n key of the form `vehicle.<role>.tier<N>`; a payload is carried by the Debris Hauler alone. Tier-1 base stats and the tier multipliers above live in `src/core/config/balance.ts`.

Operational states and what each means for the player: `idle` parked with no task, `moving` travelling to target, `working` drilling/digging/hauling/demolishing/fragmenting, `waiting` blocked by traffic and retrying each tick, `broken` needing repair at a Vehicle Depot.

## Driver Qualification

- Each vehicle role requires distinct driving licence from **Driving Center**
- Employee without licence for role cannot be assigned to that vehicle
- One driver per vehicle; one vehicle per driver at a time
- Driver injured or leaves → vehicle idles until qualified replacement assigned
- Assigning a driver (`vehicle driver <vehicleId> <employeeId>`) validates licence/availability immediately but only sets intent — the employee must walk to the vehicle's position first, and only becomes its driver on arrival (arrival-gated per `dev-architecture`'s arrival-gated-actions convention)

## Hauling

Self-dispatching, no player button involved: each tick, `HaulDispatch.ts` queues one `haul_debris` PendingAction per on-ground fragment not already covered by an existing action (an oversized fragment queues `fragment_debris` instead, claimed by a Rock Fragmenter). A licensed-but-idle employee auto-claims the action through the standard pending-action pool (`gameplay-employee-skills`), then walks to and boards a qualifying Debris Hauler — driven or not, as long as unreserved — same as any other vehicle-gated action. Once underway it resolves in phases, each arrival-gated (`dev-architecture`'s arrival-gated-actions convention): drive to fragment → load on arrival → drive to depot → unload on arrival. A destination targeting the depot building resolves through the building-approach-cell lookup (`gameplay-navmesh`), not the building's raw coordinates.

`vehicle haul <vehicleId> fragment:<fragmentId>` (Debris Hauler only, must already have a driver) remains as a manual/debug primitive: sets the same intent directly on an already-crewed vehicle, bypassing the queue.

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

