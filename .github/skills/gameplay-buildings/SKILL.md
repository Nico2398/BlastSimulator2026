---
name: gameplay-buildings
description: >
  Buildings system specification for BlastSimulator2026: 9 building types (8 with 3 tiers, the Spoil Heap with one),
  placement rules, training buildings, living quarters, warehouses, Research Center,
  and destruction effects. Use when implementing or modifying buildings,
  construction, demolition, tier upgrades, or any building-gated action.
---

## Design Philosophy

Buildings are player's infrastructure layer. Gate actions behind qualified employees + physical capacity.

- **Every action requires qualified employee.** No qualified employee → immediate error, not silent queue.
- **Training buildings** upskill employees for time + fee. A course at a tier-N school brings a skill to level N, so a higher tier teaches higher levels, at a higher fee and longer course (still multiplied by the tier's faster speed). Hiring is not a cheaper route to a high level: only schools and work raise one.
- **Research Center** prerequisite for unlocking higher tiers of all other buildings — a placed Research Center building is required before any research task can be queued, not just implied by the unlock fiction.
- **Placement tradeoff:** Far-from-pit reduces projection damage risk but increases travel time (productivity loss).

## Building Types & Tier Names

All tier names are fictional and humorous. Localized via i18n (`en.json` + `fr.json`).

| Building | Tier 1 | Tier 2 | Tier 3 | Purpose |
|----------|--------|--------|--------|---------|
| Driving Center | "Learner's Lot" | "Wheel Academy" | "Turbo Campus" | Trains employees for specific vehicle roles and vehicle repair |
| Blasting Academy | "Boom Shack" | "Detonation Den" | "The Kaboom Institute" | Trains explosives handling and blast sequencing |
| Management Office | "The Cupboard" | "Bureaucracy Box" | "Corner Office Supreme" | Trains HR and commercial operations |
| Geology Lab | "Rock Shed" | "Stone Science HQ" | "Institute of Expensive Rocks" | Trains survey techniques |
| Research Center | "Think Tank Tent" | "Innovation Bunker" | "The Ivory Crater" | Unlocks higher tiers (paid research tasks) |
| Living Quarters | "The Cells" | "Staff Dormitory" | "Unnecessarily Luxurious Hotel" | Houses + feeds employees; grade → well-being |
| Explosive Warehouse | "Boom Closet" | "Blast Vault" | "Fort Kaboom" | Bulk explosive stock, cheaper per kg |
| Freight Warehouse | "The Pile" | "Stuff Bunker" | "Hoarder's Paradise" | Stores ore debris; primary income source |
| Spoil Heap | "The Dump" | (single tier) | (single tier) | Takes barren rock hauled off the blast; unlimited capacity; no crew needed |

## Tier System

Tier 1 is available from the start. Higher tiers unlocked by paid Research Center tasks.

**A placed `research_center` building is a hard prerequisite to queue any research task.** No research center on the map → no research task can be queued, enforced at the point research is queued, not left to the unlock fiction.

Research task shape:
- **Cost** (money) — every research task has one.
- **Duration** (ticks occupying the Research Center) — every task beyond the first upgrade has one.
- **Conditions** (prerequisites already met — e.g. a specific other building already at a given tier, or another research already completed) — every task beyond the first upgrade has these too.
- **Exception — first upgrade (tier 1 → tier 2) of any building type:** cost only, no duration, no conditions.

`tickResearch` emits `research:completed` (tier unlocked) and `research:cancelled` (with refund); `wireResearchNotifications` raises the toasts. The Build Menu research button shows cost and duration (`ui.build.queue_research_cost`); once queued it is replaced by live progress (`getResearchProgress`, `.bs-build-research-progress`).

Higher tiers: larger capacity, better performance, larger physical footprint.
Upgrading: demolish old building → construct new tier on the same ground (#1392). Both construction and demolition carry a cost.
`build destroy <id>` / `build upgrade <id>` are queued orders, not instant: cost is charged at order time (full refund on cancel), a Building Destroyer with a licensed driver carries the demolition out (`gameplay-vehicle-fleet`), and the building stays standing and operating until it finishes. A second order on a building already being demolished is refused. An upgrade reserves a `PlannedBuilding` keeping the SAME id (next tier, same x/z, footprint blocked from order time); when the demolition completes the old building is removed, occupants put out, and the reserved `place_building` action is dispatched with normal construction time. While rebuilding the id is absent from `state.buildings`; selecting it shows the site as "Rebuilding…" with actions disabled. `maxBuildingTier` in serialized state is the highest standing tier (0 when none).
Demolish is confirmed (#1399) from the Build menu row and the inspector via `ConfirmModal`: it names the building, the cost, that nothing is refunded and it cannot be undone, plus the kg of stored explosives lost when any.

Build menu rows (placed buildings and `.bs-build-site-row` construction sites) are selectable (#1759): a click routes through the shared selection path (`selectionRoute.ts`), and `UIManager.setListSelection` feeds `BuildMenu.setSelectedEntity` to highlight the row of the scene selection. Construction progress renders through `fractionOf` (`core/math/Fraction.ts`).

## Training Buildings

| Building | Skill Granted |
|----------|--------------|
| Driving Center | Vehicle licence — truck, excavator, drill rig, rock fragmenter; also the `repair` skill (vehicle repair, #1393). Roles arrive holding their own; the rock fragmenter licence is only earned here |
| Blasting Academy | Explosives charging and blast sequencing |
| Management Office | HR and commercial operations |
| Geology Lab | Survey techniques and rock analysis |

Employee travels to building, stays for fixed ticks (unavailable + paid salary). Training costs direct fee. **Tier = level taught:** a tier-N school brings a skill to level N (never above its tier). Fee `TRAINING_LEVEL_FEE` (base fee x level) and duration `TRAINING_BASE_TICKS * TRAINING_TIER_SPEED[tier] * TRAINING_LEVEL_TICKS_MULT[tier]`; a held skill at or above N is refused (`trainingRefusal`).

## People Inside a Building

An employee can be inside a building the way they ride a vehicle — one occupancy model, specified
in `gameplay-vehicle-fleet` (State Model, and the Enter/Leave rows of its model table). What is
building-specific:

- **People capacity** — `getBuildingPeopleCapacity(type, tier)`. The four training buildings and
  Living Quarters take people, and their `capacity` is that count (trainees, beds). Every other
  type takes none. A type starts taking people by being added to `PEOPLE_HOLDING_TYPES`
  (`Building.ts`), never by special-casing a caller.
- **Entering** — from a cell on the building's ring (the one-cell band just outside its
  footprint), on foot, while under capacity; a full building refuses the next one, who stays on
  the ring. `moveTo(state, employeeId, { buildingId })` walks there and enters on arrival.
- **Leaving** — onto the free ring cell nearest the one they entered from.
- **While inside** — the employee holds no ground cell, is not drawn in the scene or on the
  minimap, cannot be picked, and is still listed in the Crew panel.

Occupants are stored on the building instance (`Building.occupantIds`) and saved with it; a save
from before they existed loads with every building empty.

## Living Quarters Well-Being Effects

| Tier | Description | Effect |
|------|------------|--------|
| 1 | "The Cells" | Baseline (penalty if absent) → productivity ×0.90 |
| 2 | "Staff Dormitory" | Moderate well-being bonus |
| 3 | "Unnecessarily Luxurious Hotel" | Large well-being bonus → productivity ×1.10 |

Overcapacity (more employees than beds) → well-being penalty for all residents.

Well-being score (#1692): the tier's `wellBeing` effect (+2 / +4 / +6) is a per-tick gain damped as the score nears 100, so a higher tier settles at a higher equilibrium and no tier pins it at the cap. Beds come from `getBedCapacity` (sum of capacity over operating Living Quarters); a crew beyond the beds adds a crowding drag proportional to the unhoused share, on top of the productivity penalty. Overwork and accidents drag it too; see `gameplay-employee-needs`.

## Warehouses

**Explosive Warehouse:**
- Optional risk/reward store (#1678). `buy explosive:<id> kg:<n>` puts explosive into stock at the **bulk price** (catalog `costPerKg` x `EXPLOSIVE_BULK_PRICE_FACTOR` 0.7 x the live `explosive_price` event factor); `buyExplosiveStock` in `ExplosiveStock.ts`.
- Stock is per explosive id (`Building.storedExplosives`, kg). Capacity (500 / 1,500 / 4,000 kg by tier) is shared across types and summed over operating warehouses; stores fill in placement order. Saves without the field load as empty.
- Charge orders draw matching stock first, the remainder is paid in cash at the list price; stock is reserved at order time. No warehouse (or no matching stock) = today's flow and price, unchanged.
- Cancelling a charge order refunds in the currency paid: stock goes back to the warehouses; kg that no longer fit are refunded as cash at the bulk price (booked as a `refund`).
- UI (#1685): the Blast Workshop Charge step lists each offered explosive's stock (`[data-stock]`), buys into stock in `STOCK_BUY_STEP_KG` (50 kg) steps (`[data-action="stock-buy"]`, disabled with a visible reason from the pure `buyStockBlockReason`), and shows how much of the current pattern is paid from stock (`[data-info="paid-from"]`). A selected Explosive Warehouse shows its stock and free kg in the inspector (`[data-info="warehouse-stock"]`).
- Inspector contents (#1757, `storageContent.ts`): a Contents section for every storage building. Explosive Warehouse: a row per explosive held, used/capacity gauge, and the secondary-blast detonation radius while stocked (replaced by "stock unavailable" while closed). Freight Warehouse: gauge, free and in-transit-reserved kg, per-ore rows and a barren row from `warehouseStockByOre` (`FreightWarehouses.ts`, one pass over the stored fragments; `loseOrphanedStock` reuses it). Spoil Heap: spoil kg, no capacity. Rows of 0.5 kg or less are hidden.
- Previews are net of stock at list price (`stockAwareChargesCost`): Charge All label, footer and Preflight cost read the cash part of the recorded orders (`recordedChargesCost`, from each charge's `fromStockKg`, absent = 0 in old saves). The blast report's `spent` is cash only; `spentFromStock` is the list value of the stock-supplied kg.
- Capacity scales with tier; an order for more kg than free space is refused entirely (whole-kg purchases only).
- `plannedChargesCost` and UI cost previews stay at list price.
- Decisions (#1678): bulk factor 0.7 applies together with the event price factor; a purchase over free capacity is refused whole, never partly filled; stock is reserved (consumed) at order time, not at loading; unrestockable kg on cancel are refunded as cash at the bulk price.
- If destroyed by blast projection while containing explosives → **secondary blast event**

**Freight Warehouse:**
- Stores ore debris hauled from blast zone
- Primary income source via ore sale contracts
- Capacity scales with tier; farther from pit = longer haulage trips = lower throughput
- Capacity per tier: 25,000 / 72,000 / 200,000 kg, from `FREIGHT_WAREHOUSE_CAPACITY_KG` (`balance.ts`): tier 2 holds a typical good Dusty Hollow blast (~57,000-66,000 kg ore) with margin.
- **Per-warehouse inventory** (#1372): every stored fragment carries the `warehouseId` it sits in
  (reserved while `in_transit`, null on the ground); each warehouse's stock and free room are derived
  from fragments (`FreightWarehouses.ts`). A hauler loads only when some warehouse has room for the
  fragment and unloads at the **nearest warehouse with room** (tie: lowest id; re-picked on arrival if
  the reserved one vanished or filled). A fragment no single warehouse can hold is never claimed.
- **Shared pool view:** `storedMassKg`, `storageCapacityKg` and `collectedOre` stay the pooled totals;
  selling and contract delivery draw from all warehouses, removing only the sold mass.
- **Ore-sale contracts require a Freight Warehouse** (`contractAcceptBlocker`): console accept refuses
  and the Accept button is disabled with a hint until one stands.

## Placement Rules

1. **Fixed footprint:** cell pattern per type+tier (2×2, 3×1, L-shape…); higher tiers = larger footprint
2. **Level enough, then levelled:** the footprint's surface heights may spread at most
   `BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD` voxel levels (`isFootprintBuildable`, `Building.ts`) — a slight
   slope is a legal site, a steeper one is refused with `'Uneven surface'`. Whatever step the placement
   tolerated is then cut away: finishing construction (and an upgrade or a relocation, which land a
   footprint on unlevelled ground too) levels the footprint down to its lowest column
   (`levelGroundRect`, `LevelGround.ts`), so a standing building always sits on flat ground
3. **Protected voxels:** voxels beneath building cannot be drilled or blasted (blocked with error)
4. **Blast destruction:** if blast reaches voxels beneath building → building destroyed instantly
5. **No overlap:** buildings cannot overlap each other
5b. **Reserved terrain** (#1390): a footprint may not cover a built or planned ramp corridor, nor an ordered or drilled hole (`terrainReservations`, `PlacementReservations.ts`); order, move and upgrade are refused with a localized reason. Edge-adjacent is allowed.
5c. **Cutoff warning** (#1391): a placement, move or upgrade that would strand ground from the crew warns, never refuses. `computePlacementCutoff` (`PlacementCutoff.ts`) floods from the crew (alive employees) before and after the footprint blocks (a move or upgrade also frees its old footprint), and counts cells reachable now but not after, excluding the footprint itself. Fewer than `PLACEMENT_CUTOFF_MIN_CELLS` cut cells, or no crew, means no warning. Reported: distinct `benchLevel`s cut, drill holes (drilled and planned), queued orders. `BuildMenu` shows the line and a "Place anyway?" confirm modal (`placementCutoffConfirm.ts`); confirming places. Console commands skip the check. The verdict is memoized per footprint and nav revision.
6. **Ramps are not buildings** (#1298): a ramp is a dug terrain feature (`state.builtRamps`, see `gameplay-navmesh`), never in `state.buildings`. It takes the selection plumbing only (click picks it, corridor highlighted, inspector) and offers a widen action — no demolish, no tier upgrade, no move, no occupants.

**Spoil Heap (#1530):**
- Cost $2000 (`constructionCost`), demolish $500, 2x2, no upkeep, unlimited capacity (`spoilHeapSites`
  report `capacityKg: Infinity`). Barren rock never uses freight storage.
- **Barren** = a fragment whose summed ore density is at most `SPOIL_BARREN_ORE_FRACTION_THRESHOLD`
  (`isBarrenFragment`, `SpoilHeaps.ts`; an empty density map is barren). Barren fragments haul to the
  nearest heap (`pickSpoilHeap`: squared distance, tie lowest id), ore fragments to warehouses. On
  delivery the fragment leaves `logistics.fragments` and its mass is added to the heap building's
  `storedSpoilKg`; `storedMassKg` and `collectedOre` are untouched. A batch never mixes barren and ore.
- Ecology +2 (`scoreEffects`, +0.2/tick per active heap; inactive gives none). One heap carries ordinary play against
  the settling dust from a blast (a ~2,344 t pile, blast every ~600 ticks); extra heaps shorten and soften
  the dips. Hauling rock off the ground shrinks the settled loss and the next fresh dust pulse.
- With no heap placed, barren hauls are blocked as `no_spoil_heap` ("place a spoil heap"), never
  `storage_full`. Rubble-disposal contracts draw on heap stock first, then storage.
- **Starting heap (#1574):** Dusty Hollow (`DUSTY_HOLLOW_STARTING_SITE`) and the tutorial
  (`TUTORIAL_STARTING_SITE`) open with one free, active heap placed at tick 0, so the first blast's
  barren rock has a dump and no "place a spoil heap" notice appears. Later levels still build their own.
- **Crewless** (`isCrewlessBuilding`): `build spoil_heap at:x,z` and the Build menu validate funds and
  footprint as usual, then charge and place immediately (`placeBuilding`) — no `PlannedBuilding`, no
  `place_building` action, works with an empty roster.
- **Single tier** (`isSingleTierType`): tiers 2/3 alias tier 1; no upgrade or research UI and
  `build upgrade` is refused. The Build menu shows no capacity line.
- **Leftover rock (#1690):** once an ore sale leaves a stored fragment barren, it leaves the warehouse
  at once (`releaseBarrenStoredFragments`, `Logistics.ts`): removed from `fragments`, debited from
  `storedMassKg` and any residual `collectedOre`, credited to the first heap (`creditFirstSpoilHeap`).
  Rubble contracts still pay for it via the heap. With no heap it stays stored until a heap exists;
  the release also runs at the start of every ore sale and when a save loads.
- Destroying a heap loses its spoil silently. A save with no `storedSpoilKg` reads as 0. No Blender
  model yet: renders as a stand-in box (#1572).

## Destruction Effects

- Building destroyed by a blast → removed from grid immediately; a player demolition is removed when its Building Destroyer finishes (#1392)
- Employees inside → put out on its ring (any removal: destruction, demolition, an upgrade's
  replace); a projection that destroys it injures them first
- Stored contents lost. A Freight Warehouse's stock is lost with it (`loseOrphanedStock`): other
  warehouses are untouched, `storedMassKg`/`collectedOre` are debited, in-transit reservations are not
  lost (re-picked on delivery). Reported by the `logistics:warehouse_stock_lost` event (toast), the
  `blast` output, and a warning line on `build destroy`. An Explosive Warehouse destroyed by a blast or flying rock **with stock**
  detonates (`resolveSecondaryBlasts`, `SecondaryBlast.ts`):
  - Radius = `SECONDARY_BLAST_RADIUS_BASE_M + SECONDARY_BLAST_RADIUS_PER_SQRT_KG_M * sqrt(kg)`, capped at
    `SECONDARY_BLAST_RADIUS_MAX_M`, measured from the centre of the warehouse footprint.
  - Buildings and vehicles within it take `maxHp * SECONDARY_BLAST_STRUCTURE_DAMAGE_FRACTION` damage,
    falling off linearly to 0 at the radius. Employees within `SECONDARY_BLAST_DEATH_RADIUS_FRACTION`
    of the radius die (lawsuit pending, death count up); those further in are injured. Dead or already
    injured employees are skipped; occupants of a destroyed building or vehicle are injured.
  - Chain: another stocked warehouse destroyed by a detonation detonates once in turn (visited set).
  - The blast report lists each detonation; the `blast` output carries one line per detonation.
  - **Demolition does not detonate**: `build destroy` of a stocked warehouse only reports the lost kg.
- Well-being, Safety, Ecology score penalties applied
- Research Center destroyed while its enabling research task is in-flight and no other active Research Center remains → the in-flight task is cancelled and its cost refunded in full; a task still pending behind it in the queue is cancelled/refunded in turn once it reaches the head with no Research Center present. If another active Research Center still exists, the in-flight task is unaffected.

## Building Effects Summary

| Building | Primary Effect | Secondary Effect |
|----------|---------------|-----------------|
| Living Quarters Tier 1 | Housing/feeding | Baseline well-being |
| Living Quarters Tier 3 | Housing/feeding | High well-being → productivity ×1.10 |
| Explosive Warehouse | Bulk explosive stock at 0.7x price | Secondary blast if destroyed with stock |
| Freight Warehouse | Enables ore sale contracts | Main income; throughput limited by distance |
| Spoil Heap | Dumps barren rock off the freight pool | Without one, barren hauls are blocked |
| Research Center | Unlocks building tiers | Occupied during each research task |
| Training Buildings | Grants skill qualifications | Prevents unqualified-task errors |

## Types

`src/core/entities/Building.ts` declares `BuildingType`, `BuildingTier` and `BuildingDef`, and is the only authority on their fields — costs, `footprint` and the approach `entryPoint`/`exitPoint` offsets, `capacity`, `maxHp`, `scoreEffects`. Read that file before writing against them.

Meanings the code does not state: `capacity` is role-specific (beds for Living Quarters, trainees for a training building, kg for a warehouse) — how many people fit inside is `getBuildingPeopleCapacity`, not `capacity` read raw; `nameKey` is an i18n key naming the tier-specific building name. Per-tier costs and thresholds live in `src/core/config/balance.ts`.


Build catalog rows show a one-line purpose plus operating cost in $/h and a tooltip of absolute stats (footprint, capacity with unit, upkeep), built in `src/ui/catalogCardText.ts`; the tooltip follows the selected tier.

Event closures (#1568): a live `out_of_service` modifier naming a building sets the derived `Building.outOfService` flag each tick (`syncBuildingServiceFlags`, after `tickModifiers`); the player's `active` choice is untouched. `isOperating(b)` (= active and not closed) gates ore/explosive/spoil storage, nearest-building lookups, well-being, training (`availableTrainingOffers` skips it, `enrolInTraining` refuses with `employees.train_school_closed`) and the Research Center (queueing blocked as `no_research_center`). A closed centre only pauses research progress; destroying or switching it off still cancels and refunds. `research_cost` scales the task cost at queue time (`scaledCost`); the stored `task.cost` is what cancel refunds.
