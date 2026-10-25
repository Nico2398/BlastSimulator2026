# History — gameplay-vehicle-fleet

Records why the rules in the `gameplay-vehicle-fleet` skill exist: the issues that introduced or changed each mechanic, and the decisions taken along the way.

## Vehicle Roles & Tier Names

- Building Destroyer: carries out every building demolition (#1392); tier upgrades are done in place by a builder (#1875).
- Charging Truck introduced by #1645. Every `charge_hole` order requires it since #1649. A freshly hired Blaster holds the tier-1 `driving.truck` licence, so it can charge with no course (#1667). Every blasting opening carries a tier-1 truck plus a blaster holding `blasting` + `driving.truck` (#1648).
- Drill rig reach introduced by #1679; drill rig bore by #1934; drill rig work rate by #1935.
- "**Charging Truck decisions (#1645, defaulted).** Licence: the existing `driving.truck`, like the hauler and destroyer (no new `SkillCategory`, Driving Center course or starting qualification; Drivers already hold it). Base stats (`VEHICLE_BASE_STATS.charging_truck`) ... Arrival task `loading` ..., one seat (`VEHICLE_SEAT_COUNT`). Reverse by changing those `balance.ts` entries." These were defaults taken under #1645 for a human to revisit.

## Driver Licensing

- Blaster's tier-1 truck licence at hire: #1667.
- Licence level (1-3, separate from proficiency) introduced by #1524.
- Licence proficiency neither gates tiers nor changes pay or speed: #1843.

## Cost Model

- Ranking tier first, then cost (`ACTION_RANK_TIER`): #1742. A cheap haul never outranks a `charge_hole` or a `demolish_building`: #1840. A loaded haul is still never abandoned: #1709.

## Evacuation rescue of a parked vehicle

- Section introduced by #1746.

## Hauling and Breaking

- Multi-fragment cargo: #1370.
- Hauling destination (barren to Spoil Heap, ore to Freight Warehouse): #1530.
- Heaps are finite (`no_spoil_heap` / `spoil_heap_full`): #1892.
- Barren yields to ore: #1870.

## Vehicle Repair

- Introduced by #1393.

## Vehicle Upgrade

- Introduced by #1401. The Fleet panel rows have carried no buttons, only Locate, since #1767. `isLicensedForVehicleTier` became tier-aware (`canDriveTier`) with #1524.

## Vehicle inspector job, ETA and running cost

- Introduced by #1761.

## Traffic

- Parked-vehicle yield to a free cell off the blocked mover's route (`pickYieldCell`): #1696.
- Jams and chokepoints (`TrafficJams.ts`): #1208.

## Status

- "The migration this page specifies is complete: phases 0a to 7 landed as #1083 to #1093. The tutorial box-cut, the case that started it, is asserted at no more than 2 rock-digger boardings for the whole ramp ... The baseline measured before the migration was 3."
- Deviation owners: "Only I8 is fatal. I4 and I5 fire in 14 command-mode scenarios; ..." owned by #1115; "A mounted employee keeps the vehicle for the whole rest, not just the drive there" owned by #1122. The original instruction read "Remove a row when its issue lands."
- Dealership card licence level shown = tier, per #1524.
- Event closures (`out_of_service` modifier): #1568.
- "Truck-worked charging stalls (#1660), decisions taken:" — the three bullets were decisions taken in #1660. Original wording of the third: "plain drive pathing repaths every tick through the parked vehicle, so a reroute step was undone next tick and reset the stuck counters, never reaching `MOVE_STUCK_ABANDON_TICKS`. Parking the truck clear of the blast zone is out of scope."

## Tier slope limit

- Introduced by #1938. Progression-sandbox spawn sharing one component driveable at the slowest tier: #2044.
- "**Decision (#1938): per-step limit, diagonals included.** ... Recorded decision (see `gameplay-navmesh`)."

## Dealer grade gate

- Introduced by #1928.

## Stranded vehicle recovery — provenance (merged from main)

- `recoverStranded` came with #2085.

## One vehicle slope limit

- Every vehicle tier climbs the same 20° on a progression site, and a limited request has no diagonal shortcut up a ramp: #2045.
- Stranded vehicle recovery removed with core crater access: #2095.
