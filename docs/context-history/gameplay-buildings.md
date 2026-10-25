# History — gameplay-buildings

Records why the rules in the `gameplay-buildings` skill exist: the issues that introduced or changed each mechanic, measurements, decision reviews and earlier behaviour.

## Tier System

- Research Center speed and slots by tier: introduced by #1936.
- Original wording: "Cancel (no centre left, head task refunded) and the closed-centre pause (no progress) are unchanged." (unchanged by the speed/slots rework of #1936).
- In-place upgrade: #1875. Upgrade price (next tier minus half the current tier): #1905.
- Demolition ranking in the `charge_hole` tier: #1840.
- Footprint refusals naming the blocker: #1830, #1008.
- Original wording: "New-build, Move and Demolish prices are unchanged." (by the in-place upgrade of #1875).
- Decisions of #1875, original text: "Decisions: the building keeps standing and operating during the works (reverse: treat `upgrading` as non-operating in `computeBuildingStatus` / `syncBuildingServiceFlags`; status `upgrading`, "Upgrading to tier N · X%", shown as a badge on its placed Build-menu row, not as a separate site row); price is the next tier's construction cost minus half the current tier's (reverse: set `BUILDING_UPGRADE_CREDIT_SHARE` to 0 for the full next-tier price); hp is refilled to the new tier's max on completion (reverse: `completeUpgrade` in `BuildingUpgrade.ts`); a building gone or a footprint that no longer fits at completion refunds the order; saves from before this flow have their pending upgrade demolitions and orphaned rebuild sites cancelled and refunded in full on load (`cancelLegacyUpgradeOrders`)." Before #1875 an upgrade demolished the building and rebuilt it.
- Demolish confirmation modal: #1399.
- Action buttons removed from Build menu rows: #1768.
- Selectable Build menu rows: #1759.

## Training Buildings

- Vehicle `repair` skill taught at the Driving Center: #1393.

## Living Quarters Well-Being Effects

- Damped well-being score per housing tier: #1692.
- Living Quarters inspector occupants: #1760.

## Warehouses

- Explosive Warehouse stock and bulk price: #1678.
- Original wording: "No warehouse (or no matching stock) = today's flow and price, unchanged." (the pre-#1678 flow).
- Explosive delivery wait: #1895.
- Delivery-wait rationale (#1895): "This is the warehouse's payback: ~400 ticks saved per stocked pattern at ~1 pattern per 500 ticks." Original: "a cancel refunds as before."
- Blast Workshop stock UI: #1685.
- Storage inspector Contents section: #1757.
- Original lead-in: "Decisions (#1678): bulk factor 0.7 applies together with the event price factor; ..."
- Per-warehouse inventory: #1372.

## Placement Rules

- Reserved terrain rule: #1390.
- Placement cutoff warning: #1391.
- Ramps as terrain features, not buildings: #1298.
- Spoil Heap: #1530.
- Finite spoil heap capacity: #1892. Sizing probe, original text: "Probe (desert_badlands seed 42, sandbox full kit, 3x3 krackle shot at 36,30, ramp, crews as played): the heap held 3.7 t at +500 ticks after the blast, 24 t at +750 and was full at ~+1,230 (tick ~1,500 of the opening); the issue's own measurement (54 t at t3,068) puts it near t3,000, so 50 t sits at the fast end of the 2,000-3,000 tick target and is the one lever (`SPOIL_HEAP_CAPACITY_KG`) to retune."
- Barren overflow: #2018.
- Rubble contracts take barren rock only: #1871.
- Starting heap on Dusty Hollow and the tutorial: #1574.
- Leftover barren rock released from warehouses: #1690.
- Spoil heap stand-in box pending its model: #1572.

## Vanity Projects

- Vanity projects: #1947.
- Vanity Blender models: #1948.
- Original label: "**Decisions**: a "touch" means sharing an edge ..."

## Destruction Effects

- Demolition carried out by a Building Destroyer: #1392.
- Secondary-blast crater: #1896.
- Decisions of #1896, original text: "Decisions: blast pipeline over a plain carve (fragments to haul, nav/render follow `terrain:updated` for free; reverse: a direct voxel carve in `carveSecondaryCraters`); hole depth 3 m (`SECONDARY_BLAST_CRATER_HOLE_DEPTH_M`); heaviest explosive sets the type (reverse: `secondaryCraterPlan`); crater fragments do not feed projection damage (the radius model already covers it)."

## Building Effects Summary

- Safety score settling at a building-set target: #1977.

## Types

- Event closures (`out_of_service` modifier): #1568.
