---
name: gameplay-buildings
description: >
  Buildings system specification for BlastSimulator2026: 9 building types with 3 tiers each,
  placement rules, training buildings, living quarters, warehouses, Research Center,
  and destruction effects. Use when implementing or modifying buildings,
  construction, demolition, tier upgrades, or any building-gated action.
---

## Design Philosophy

Buildings are player's infrastructure layer. Gate actions behind qualified employees + physical capacity.

- **Every action requires qualified employee.** No qualified employee → immediate error, not silent queue.
- **Training buildings** upskill employees for time + fee. Hiring pre-qualified staff generally cheaper.
- **Research Center** prerequisite for unlocking higher tiers of all other buildings — a placed Research Center building is required before any research task can be queued, not just implied by the unlock fiction.
- **Placement tradeoff:** Far-from-pit reduces projection damage risk but increases travel time (productivity loss).

## Building Types & Tier Names

All tier names are fictional and humorous. Localized via i18n (`en.json` + `fr.json`).

| Building | Tier 1 | Tier 2 | Tier 3 | Purpose |
|----------|--------|--------|--------|---------|
| Driving Center | "Learner's Lot" | "Wheel Academy" | "Turbo Campus" | Trains employees for specific vehicle roles |
| Blasting Academy | "Boom Shack" | "Detonation Den" | "The Kaboom Institute" | Trains explosives handling and blast sequencing |
| Management Office | "The Cupboard" | "Bureaucracy Box" | "Corner Office Supreme" | Trains HR and commercial operations |
| Geology Lab | "Rock Shed" | "Stone Science HQ" | "Institute of Expensive Rocks" | Trains survey techniques |
| Research Center | "Think Tank Tent" | "Innovation Bunker" | "The Ivory Crater" | Unlocks higher tiers (paid research tasks) |
| Living Quarters | "The Cells" | "Staff Dormitory" | "Unnecessarily Luxurious Hotel" | Houses + feeds employees; grade → well-being |
| Explosive Warehouse | "Boom Closet" | "Blast Vault" | "Fort Kaboom" | Stores explosives from supply contracts |
| Freight Warehouse | "The Pile" | "Stuff Bunker" | "Hoarder's Paradise" | Stores ore debris; primary income source |
| Vehicle Depot | "Rusty Garage" | "Grease Palace" | "Mecha Hangar" | Parks and repairs vehicles |

## Tier System

Tier 1 is available from the start. Higher tiers unlocked by paid Research Center tasks.

**A placed `research_center` building is a hard prerequisite to queue any research task.** No research center on the map → no research task can be queued, enforced at the point research is queued, not left to the unlock fiction.

Research task shape:
- **Cost** (money) — every research task has one.
- **Duration** (ticks occupying the Research Center) — every task beyond the first upgrade has one.
- **Conditions** (prerequisites already met — e.g. a specific other building already at a given tier, or another research already completed) — every task beyond the first upgrade has these too.
- **Exception — first upgrade (tier 1 → tier 2) of any building type:** cost only, no duration, no conditions.

Higher tiers: larger capacity, better performance, larger physical footprint.
Upgrading: demolish old building → construct new tier on same/adjacent cleared ground.
Both construction and demolition carry a cost.

## Training Buildings

| Building | Skill Granted |
|----------|--------------|
| Driving Center | Vehicle licence — one per role (truck, excavator, drill rig, …) |
| Blasting Academy | Explosives charging and blast sequencing |
| Management Office | HR and commercial operations |
| Geology Lab | Survey techniques and rock analysis |

Employee travels to building, stays for fixed ticks (unavailable + paid salary). Training costs direct fee.

## Living Quarters Well-Being Effects

| Tier | Description | Effect |
|------|------------|--------|
| 1 | "The Cells" | Baseline (penalty if absent) → productivity ×0.90 |
| 2 | "Staff Dormitory" | Moderate well-being bonus |
| 3 | "Unnecessarily Luxurious Hotel" | Large well-being bonus → productivity ×1.10 |

Overcapacity (more employees than beds) → well-being penalty for all residents.

## Warehouses

**Explosive Warehouse:**
- Required to order and receive explosives; blasting impossible without it
- Capacity scales with tier
- If destroyed by blast projection while containing explosives → **secondary blast event**

**Freight Warehouse:**
- Stores ore debris hauled from blast zone
- Primary income source via ore sale contracts
- Capacity scales with tier; farther from pit = longer haulage trips = lower throughput

## Placement Rules

1. **Fixed footprint:** cell pattern per type+tier (2×2, 3×1, L-shape…); higher tiers = larger footprint
2. **Flat surface required:** all cells in footprint must be at same surface height
3. **Protected voxels:** voxels beneath building cannot be drilled or blasted (blocked with error)
4. **Blast destruction:** if blast reaches voxels beneath building → building destroyed instantly
5. **No overlap:** buildings cannot overlap each other
6. **Ramp** building type (added for NavMesh, Ch.6): 1×4 footprint, connects bench levels

## Destruction Effects

- Building destroyed → removed from grid immediately
- Employees inside → injured
- Stored contents lost; Explosive Warehouse detonation → secondary blast
- Well-being, Safety, Ecology score penalties applied
- Research Center destroyed while its enabling research task is in-flight and no other active Research Center remains → the in-flight task is cancelled and its cost refunded in full; a task still pending behind it in the queue is cancelled/refunded in turn once it reaches the head with no Research Center present. If another active Research Center still exists, the in-flight task is unaffected.

## Building Effects Summary

| Building | Primary Effect | Secondary Effect |
|----------|---------------|-----------------|
| Living Quarters Tier 1 | Housing/feeding | Baseline well-being |
| Living Quarters Tier 3 | Housing/feeding | High well-being → productivity ×1.10 |
| Explosive Warehouse | Enables supply contracts | Secondary blast if destroyed with stock |
| Freight Warehouse | Enables ore sale contracts | Main income; throughput limited by distance |
| Vehicle Depot | Vehicle parking/maintenance | Required for repairs |
| Research Center | Unlocks building tiers | Occupied during each research task |
| Training Buildings | Grants skill qualifications | Prevents unqualified-task errors |

## Types

`src/core/entities/Building.ts` declares `BuildingType`, `BuildingTier` and `BuildingDef`, and is the only authority on their fields — costs, `footprint` and the approach `entryPoint`/`exitPoint` offsets, `capacity`, `maxHp`, `scoreEffects`. Read that file before writing against them.

Meanings the code does not state: `capacity` is role-specific (beds for Living Quarters, kg for a warehouse, vehicle slots for a depot); `nameKey` is an i18n key naming the tier-specific building name. Per-tier costs and thresholds live in `src/core/config/balance.ts`.

