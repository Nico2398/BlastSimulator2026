---
name: buildings
description: >
  Buildings system specification for BlastSimulator2026: 9 building types with 3 tiers each,
  placement rules, training buildings, living quarters, warehouses, Research Center,
  destruction effects, and atomic task breakdown. Use when implementing or modifying buildings,
  construction, demolition, tier upgrades, or any building-gated action.
---

## Design Philosophy

Buildings are player's infrastructure layer. Gate actions behind qualified employees + physical capacity.

- **Every action requires qualified employee.** No qualified employee → immediate error, not silent queue.
- **Training buildings** upskill employees for time + fee. Hiring pre-qualified staff generally cheaper.
- **Research Center** prerequisite for unlocking higher tiers of all other buildings.
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

Tier 1 is available from the start. Higher tiers unlocked by paid Research Center tasks:
- Research task occupies Research Center for fixed duration + costs money
- Higher tiers: larger capacity, better performance, larger physical footprint
- Upgrading: demolish old building → construct new tier on same/adjacent cleared ground
- Both construction and demolition carry a cost

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

## TypeScript Reference

```typescript
export type BuildingType =
  | 'driving_center' | 'blasting_academy' | 'management_office' | 'geology_lab'
  | 'research_center' | 'living_quarters' | 'explosive_warehouse' | 'freight_warehouse'
  | 'vehicle_depot' | 'ramp';

export type BuildingTier = 1 | 2 | 3;

export interface BuildingDef {
  type: BuildingType;
  tier: BuildingTier;
  nameKey: string;           // i18n key
  footprint: number[][];     // [x, z] relative cell offsets
  constructCost: number;
  demolishCost: number;
  maintenanceCostPerTick: number;
  capacity: number;          // role-specific (beds, kg, m³, …)
  structuralResistance: number; // blast energy sum threshold before destruction
}
```

## Atomic Task Breakdown

| # | Task | File(s) |
|---|------|---------|
| 1.1 | Define `BuildingType` union with all 9 types | `src/core/entities/Building.ts` |
| 1.2 | Define `BuildingTier`, footprint patterns, `BUILDING_DEFS` catalog | `src/core/entities/Building.ts` |
| 1.3 | Implement `canPlaceBuilding()` — flat surface + overlap check | `src/core/entities/Building.ts` |
| 1.4 | Protected-voxel check — block drill/blast under building | `src/core/mining/DrillPlan.ts` |
| 1.5 | Building destruction on blast — check footprint vs blast AABB | `src/core/mining/BlastCalc.ts` |
| 1.6 | Explosive Warehouse secondary blast on destruction | `src/core/mining/BlastCalc.ts` |
| 1.7 | Research Center task queue — paid tasks unlock tiers | `src/core/entities/Building.ts` |
| 1.8 | Training task — time cost + fee + skill grant | `src/core/entities/Building.ts`, `Employee.ts` |
| 1.9 | Qualified-employee check — emit error on unqualified assignment | `src/core/engine/GameLoop.ts` |
| 1.10 | Living Quarters well-being multiplier per tier | `src/core/entities/Building.ts`, `src/core/scores/` |
| 1.11 | Freight Warehouse ore storage and contract sell interface | `src/core/entities/Building.ts` |
| 1.12 | Add i18n keys for all 9 types, tier names, training courses (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` |
| 1.13 | Wire `build`, `demolish`, `research` console commands | `src/console/commands/entities.ts` |
| 1.14 | Update building renderer — footprint shape and tier visuals | `src/renderer/BuildingMesh.ts` |
