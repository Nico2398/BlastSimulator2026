---
name: gameplay-vehicle-fleet
description: >
  Vehicle fleet specification for BlastSimulator2026: 5 vehicle roles with 3 tiers each, driver
  licensing, and the mount/itinerary model that makes an employee the only mobile agent and a
  vehicle an inert tool they ride. Use when implementing or modifying vehicles, boarding, driving,
  movement planning, action cost estimation, traffic, hauling, drilling, digging, or demolition.
---

## Design Philosophy

A vehicle is a **tool an employee rides**, never an agent. The employee performs the work; the
vehicle multiplies their speed and unlocks the work their licence permits. One employee controls
one vehicle at a time.

Vehicles share the navmesh with employees; congestion is intentional gameplay.

Two rules make the whole system tractable, and every invariant below follows from them:

1. **Only an employee moves.** A vehicle's position changes only because its occupant's movement
   step wrote it. A vehicle has no destination, no path, no stuck state, and no task of its own.
2. **A journey is an object, not a sequence of side effects.** `planItinerary` produces it, the
   cost estimator sums it, the movement tick walks it. One structure, one arithmetic.

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

Tier-1 base stats and these multipliers live in `src/core/config/balance.ts`. Every consumer reads
`getVehicleDefByTier(role, tier)` — a stat read that ignores `tier` is a defect, including upkeep
and fuel.

Units the field names do not state: `capacity` is kg for a Debris Hauler, m³/tick for a Rock
Digger, holes/tick for a Drill Rig. `nameKey` is an i18n key of the form `vehicle.<role>.tier<N>`.
Only a Debris Hauler carries cargo.

## Driver Licensing

| Role | Licence (`ROLE_LICENCE_REQUIRED`) |
|------|-----------------------------------|
| Debris Hauler, Building Destroyer | `driving.truck` |
| Rock Digger, Rock Fragmenter | `driving.excavator` |
| Drill Rig | `driving.drill_rig` |

Licences are earned at the Driving Center. A vehicle is not owned by a driver: any licensed
employee may board any vehicle that is unoccupied and unclaimed. Nothing persists a driver
assignment across tasks.

## State Model

### Employee owns locomotion

```ts
type Locomotion =
  | { kind: 'on_foot' }
  | { kind: 'mounted'; vehicleId: number };
```

Movement speed is a pure function of it: `AGENT_WALK_SPEED` on foot, the vehicle's tiered `speed`
when mounted. Nothing else reads or writes an entity's speed.

### Vehicle is inert

A vehicle stores identity, position, condition, cargo, and who is inside it. It stores no
destination, no task, no phase, no movement tracker. `VehicleOperationalState` and `VehicleTask`
are **derived** for display by `computeVehicleStatus(v, vehicleState, occupant)`, never stored.

Seats: `occupantIds` is an array capped by `VEHICLE_SEAT_COUNT` (every role 1 for now). The
**driver** is `occupantIds[0]` — the occupant whose itinerary moves the vehicle. Passengers are an
additive change to the cap, not a change of shape.

A vehicle-gated action's claim on a vehicle is not stored on the vehicle. It lives in
`VehicleState.reservations` as `{ vehicleId, actionId }` entries, read and written through
`getVehicleReservation`, `findVehicleReservedForAction` and `removeVehicleReservation`
(`Vehicle.ts`), so two employees never plan onto the same vehicle. It is released when the action
that holds it ends, by any route.

### The Itinerary

```ts
interface Leg {
  mode: 'foot' | 'drive';
  vehicleId: number | null;        // set for 'drive'; also for a 'foot' leg ending in a board
  destX: number; destZ: number;
  arrival: 'exact' | 'adjacent';   // 'adjacent' = Chebyshev distance <= 1
  onArrive: ArrivalStep;
  estTicks: number;                // the planner's own estimate for this leg
}

type ArrivalStep =
  | { kind: 'none' }
  | { kind: 'board';  vehicleId: number }
  | { kind: 'alight' }
  | { kind: 'effect'; effectId: string };   // haul load/unload, boulder split

interface Itinerary {
  legs: Leg[];                     // legs[0] is current; consumed front-to-back
  goal: Goal;
  workTicks: number;                // ticks of work at the goal, once every leg has arrived
  estTotalTicks: number;            // sum of every leg's estTicks plus workTicks
}

type Goal =
  | { kind: 'work';       actionId: number }
  | { kind: 'reposition'; x: number; z: number }
  | { kind: 'rest';       buildingId: number };
```

An employee's walk destination is `legs[0]`. `Employee.destinationX/Z` still exists as a read-only
mirror of it, written by `moveTo`/`Locomotion.ts`/`alight()` — nothing reads it to drive movement.

## Movement API

```ts
moveTo(state, employeeId, { x, z }, opts?: { via?: number })   // via = vehicle id, a hint
moveTo(state, employeeId, { vehicleId })                       // walk to it and board
moveTo(state, employeeId, { actionId }, opts?: { via?: number }) // the journey a claimed action needs
```

`moveTo` is the only entry point that starts movement. Every form is a thin wrapper over
`planItinerary` — `via` is a preference, not a command, because the planner still has to insert the
foot leg to the vehicle and the board step that physically must happen.

The coordinate-target overload also accepts an `allowUnreachable` option: when true, a target
unreachable right now still gets an itinerary installed (retrying every tick, abandoning at the
usual stuck threshold) instead of the call failing.

A `reposition` goal moves a vehicle with no work attached: parking the fleet clear of a blast is
`moveTo(driverId, safeCell, { via: vehicleId })`.

## Cost Model

A queued action's cost is the itinerary's cost. For a vehicle-gated action claimed by an employee
on foot that is exactly:

```
walk(employee -> board cell of vehicle) / AGENT_WALK_SPEED
+ drive(vehicle -> approach cell of target) / vehicle speed
+ work ticks (skill proficiency, need multiplier, living-quarters multiplier, vehicle tier)
```

`planItinerary(state, employee, goal, fidelity)` serves ranking and execution alike. `fidelity:
'estimate'` measures each leg with `octileHeuristic`; `fidelity: 'exact'` measures each leg with a
real `findPath`. Same legs, same arithmetic, different distance oracle — a cost that disagrees with
what the simulation then does is a bug in one shared function, not a drift between two.

Two behaviours follow and are never special-cased:

- **Continuity.** An employee already mounted in a qualifying vehicle plans a zero-length first leg,
  which the planner drops. Their cost for the next same-role action is strictly lower than any
  on-foot candidate's, so they keep the vehicle by ranking. Nothing dismounts on completion.
- **Transport.** For a `'work'` goal with a real `actionId` the planner compares walking against
  `[foot -> vehicle, board, drive, alight, foot -> target]` across every vehicle role and picks the
  cheaper — never for `'reposition'` or `'rest'` goals, which stay foot-only. `place_building` and
  `level_ground` goals are excluded: their target cell becomes NavGrid-blocked once construction
  completes, which would strand a vehicle left standing on it.

## Board, Alight, and the 3D Model

| | Rule |
|---|---|
| Board | The foot leg's `arrival` is `'adjacent'`: the employee boards from within 1 tile. Sets `locomotion`, appends to `occupantIds`, snaps the employee onto the vehicle's cell, emits `employee:mounted`. |
| Alight | Clears `locomotion`, removes from `occupantIds`, places the employee on the nearest free walkable cell within 1 tile of the vehicle (fallback: the vehicle's own cell), emits `employee:alighted`. |
| Render | `EntitySync.syncEntitySets` renders no character mesh for an employee whose `locomotion.kind` is `'mounted'`. The two models are never both visible. |

The employee stays mounted while working — a digger digs from the cab. Alighting happens only when
a plan needs them on foot, or when an interruption replans them.

Cargo stays in the vehicle when its occupant alights. Nothing is dropped on the ground.

## Hauling and Breaking

Both are ordinary itineraries with effect steps, not phase machines:

```
haul:  [foot -> hauler, board] [drive -> fragment, effect 'load'] [drive -> depot, effect 'unload']
break: [foot -> fragmenter, board] [drive -> boulder, effect 'split']
```

Hauling is self-dispatching: each tick `HaulDispatch.ts` queues one `haul_debris` action per
on-ground fragment not already covered (an oversized fragment queues `fragment_debris` instead).
A destination targeting a depot resolves through the building-approach-cell lookup
(`gameplay-navmesh`), never the building's raw coordinates.

## Traffic

Vehicles cannot share a cell. A driver whose next drive step is occupied waits and retries, then
attempts one vehicle-avoiding reroute, then reports stuck. Long waiting chains raise a
`TrafficJamEvent`. Rock debris after a blast marks cells blocked until cleared.

Player solutions to congestion: widen ramps, build parallel haulage routes, relocate the Freight
Warehouse, clear debris with Rock Fragmenters before hauling.

## Invariants

`assertWorldInvariants(state)` checks these at the end of every tick outside production builds. A
kind listed in `FATAL_VIOLATION_KINDS` (`WorldInvariants.ts`) aborts the tick. Every other kind
becomes a `WORLD INVARIANT VIOLATION` line in the tick output, and fails nothing unless a test
checks it — `tests/helpers/worldInvariants.ts`'s `expectNoWorldInvariantViolations` is how a test
does. The path-scoped `vehicles` rule names these invariants; this is where they are defined.

| # | Invariant |
|---|-----------|
| I1 | `v.occupantIds.includes(e.id)` **iff** `e.locomotion` is `{ mounted, vehicleId: v.id }` |
| I2 | A mounted employee's `x`/`z` equals their vehicle's `x`/`z` |
| I3 | `occupantIds.length <= VEHICLE_SEAT_COUNT[v.type]`, and no employee appears in two vehicles |
| I4 | A vehicle whose `x`/`z` changed this tick had an occupant this tick |
| I5 | A vehicle's reservation names a live `PendingAction` whose holder is alive and is the vehicle's driver, is walking to board it, or holds the action as a queued reserve-ahead |
| I6 | `e.itinerary !== null` implies `legs.length > 0` |
| I7 | `leg.mode === 'drive'` implies the employee is mounted in `leg.vehicleId` |
| I8 | `v.payload !== null` implies that fragment's logistics state is `in_transit` |
| I9 | `e.taskTicksRemaining !== null` implies `e.itinerary === null` (arrived, no longer travelling) |

Three lint checks keep the writers singular. `tests/unit/lint/SingleVehicleMover.test.ts`: only
`Locomotion.ts` assigns a vehicle's `x`/`z`, and nothing outside it pathfinds from a vehicle's
position. `tests/unit/lint/SingleMountWriter.test.ts`: only `Mount.ts` assigns `occupantIds` or
`locomotion`.

## Status

The migration this page specifies is complete: phases 0a to 7 landed as #1083 to #1093. The
tutorial box-cut, the case that started it, is asserted at no more than 2 rock-digger boardings for
the whole ramp in both `tests/integration/needs.integration.test.ts` and the interaction-mode
`scripts/scenario-defs/tutorial-boxcut-full.json`. The baseline measured before the migration was 3.

Where the code still differs from this page, each difference has an owner:

| Deviation | Owner |
|-----------|-------|
| Only I8 is fatal. I4 and I5 fire in 14 command-mode scenarios; I1, I3, I6, I7 and I9 fire nowhere, and I2 fires only from hand-built test fixtures | #1115 |
| A mounted employee keeps the vehicle for the whole rest, not just the drive there | #1122 |

Remove a row when its issue lands.
