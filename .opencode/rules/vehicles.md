# Vehicles and Movement

An employee is the only mobile agent. A vehicle is a tool they ride: it multiplies their speed and
unlocks licensed work, and it has no destination, no path, no task, and no will of its own. Full
model, cost formula, and the numbered invariant list: `gameplay-vehicle-fleet` skill.

## Invariants

- A vehicle's `x`/`z` is written in exactly one place: the locomotion tick, from its occupant's
  position. Nothing else moves a vehicle, and nothing pathfinds from a vehicle's position.
- `occupantIds` and `Locomotion` agree in both directions, always — for a vehicle and for a
  building alike: they are one occupancy model, and `Mount.ts` is the single writer of both sides.
  One employee is inside at most one host; a vehicle holds at most `VEHICLE_SEAT_COUNT[role]`
  occupants, a building at most `getBuildingPeopleCapacity(type, tier)`.
- A mounted employee's position equals their vehicle's position, and their character mesh is not
  rendered. The two 3D models are never both visible. An employee inside a building has no
  character mesh and no minimap dot either.
- Boarding and alighting happen within 1 tile of the vehicle; entering and leaving a building
  happen on its ring.
- `VehicleOperationalState` and `VehicleTask` are derived for display by `computeVehicleStatus`.
  Storing either on the vehicle reintroduces a second truth.
- Every stat read goes through `getVehicleDefByTier(role, tier)`, upkeep and fuel included.
- Cargo rides in the vehicle. An occupant who alights leaves it there.

## Movement and cost go through the planner

`moveTo` is the only entry point that starts movement. `planItinerary` is the only thing that
decides a route, and the action-cost estimator sums the itinerary it returns rather than measuring
a journey of its own — a vehicle-gated action costs the walk to the vehicle at walking speed, plus
the drive to the site at vehicle speed, plus the work.

Keeping a driver mounted across consecutive same-role actions is an outcome of that cost ranking.
Adding a continuity shortcut, a dismount-on-completion default, or a second route calculation
recreates the class of bug this design removes.

## Verification

`assertWorldInvariants(state)` runs at the end of every tick outside production builds. Only the
kinds in `FATAL_VIOLATION_KINDS` abort the tick; every other kind prints a line and fails nothing
on its own, so a test covering a change here asserts none with
`expectNoWorldInvariantViolations`. A change here also
carries its own case in the planner/executor equivalence test: the plan's `estTotalTicks` and the
ticks the simulation actually spends stay within tolerance.

Player-visible movement, boarding, and the mesh swap need the `visual` channel — see the
`rendering` rule.
