# BlastSimulator2026 — Next Phase Design Document

This document specifies the next wave of gameplay systems to implement. Each chapter is self-contained and includes data definitions, algorithms, and an atomic task breakdown for implementation.

**Chapters:**

1. [Buildings System (Tiers & Funny Names)](#1-buildings-system)
2. [Vehicle Fleet (Types, Routing & Drivers)](#2-vehicle-fleet)
3. [Employee Skills & Task Queue](#3-employee-skills--task-queue)
4. [Rock Composition & Survey System](#4-rock-composition--survey-system)
5. [Blast Algorithm Enhancements](#5-blast-algorithm-enhancements)
6. [NavMesh & Pathfinding](#6-navmesh--pathfinding)
7. [Employee Needs (Eating, Sleeping, Breaks)](#7-employee-needs)
8. [Testing Strategy](#8-testing-strategy)

---

## 1. Buildings System

### 1.1 Design Goals

Buildings are the player's main tool for supporting operations and keeping employees happy. Each building type comes in **3 tiers** (Basic → Improved → Deluxe) with increasingly silly names, higher capacity, better score bonuses, and higher cost. Buildings occupy a **fixed rectangular footprint** on the surface grid and must be placed on **flat terrain** (no voxels removed beneath).

### 1.2 Building Types & Tiers

All names are fictional and humorous, localized via i18n (`en.json` + `fr.json`).

| Type | Tier 1 (Basic) | Tier 2 (Improved) | Tier 3 (Deluxe) |
|------|----------------|-------------------|-----------------|
| Worker Quarters | "The Shack" | "Cozy Crate" | "Minion Manor" |
| Storage Depot | "The Pile" | "Stuff Bunker" | "Hoarder's Paradise" |
| Vehicle Depot | "Rusty Garage" | "Grease Palace" | "Mecha Hangar" |
| Office | "Paper Dungeon" | "Bureaucracy Box" | "Corner Office" |
| Break Room | "Sad Bench" | "Vending Lounge" | "Zen Den" |
| Canteen | "Slop Trough" | "Chow Hall" | "Gourmet Grotto" |
| Medical Bay | "Band-Aid Hut" | "Nurse Nook" | "Trauma Tower" |
| Explosives Magazine | "Boom Closet" | "Blast Vault" | "Fort Kaboom" |
| Fuel Station | "Drip Tank" | "Pump Palace" | "Petrol Colosseum" |
| Guard Post | "Lookout Shack" | "Watch Tower" | "Fortress of Compliance" |
| Parking Lot | "Dirt Patch" | "Paved Plaza" | "Multi-Story Mech Park" |

#### Tier Progression Rules
- Tier 1 is available from game start on all levels
- Tier 2 unlocks when the player has built at least 3 buildings of any type
- Tier 3 unlocks when the player reaches Level 2 or has $100,000+ cash
- Upgrading an existing building costs `(next_tier_cost - current_tier_cost) * 0.7` (discount for upgrade vs. new build)
- Upgrades happen in-place — same footprint, no repositioning needed

### 1.3 Building Data Schema

Extends the existing `BuildingDef` interface in `src/core/entities/Building.ts`:

```typescript
export type BuildingTier = 1 | 2 | 3;

export interface BuildingDef {
  type: BuildingType;
  tier: BuildingTier;
  /** i18n key for the funny tier name, e.g. 'building.worker_quarters.tier1' */
  nameKey: string;
  /** Grid footprint width × depth (cells). */
  sizeX: number;
  sizeZ: number;
  /** One-time construction cost ($). */
  constructionCost: number;
  /** Operating cost per tick ($). */
  operatingCostPerTick: number;
  /** Capacity: storage (kg), employee slots, vehicle slots, etc. */
  capacity: number;
  /** HP before destruction by projections. */
  maxHp: number;
  /** Score effects per tick while building is active. */
  scoreEffects: Partial<Record<ScoreId, number>>;
  /** Minimum flat surface area required (cells). Must equal sizeX * sizeZ. */
  flatFootprint: number;
}
```

### 1.4 Placement Rules

1. **Flat surface check:** Every cell in the footprint must have a surface voxel at the same Y level (±0.5 cell tolerance). No holes, no slopes.
2. **No overlap:** Buildings cannot overlap each other or the active blast zone.
3. **Safety distance:** Buildings must be at least 5 cells from any drill hole in the current blast plan (configurable in `balance.ts`).
4. **Road access:** At least one edge cell of the building must be adjacent to a navigable path (for employee/vehicle access).
5. **Explosives magazine** must be at least 15 cells from any other building (real regulation: 300m scaled down).

### 1.5 Destructibility

- Buildings hit by blast projections lose HP based on fragment kinetic energy
- At 0 HP, the building is destroyed: removed from grid, score penalties applied
- Destroyed buildings trigger events (lawsuits if employees were inside, insurance claims)
- Contents (stored materials, vehicles parked inside) are also destroyed

### 1.6 Building Effects on Gameplay

| Building | Primary Effect | Secondary Effect |
|----------|---------------|-----------------|
| Worker Quarters | Houses employees (capacity = beds) | Well-being +2/+4/+6 per tier |
| Storage Depot | Stores rubble/ore (capacity = kg) | Enables material contracts |
| Vehicle Depot | Parks & maintains vehicles (capacity = slots) | Reduces maintenance cost by 10%/20%/30% |
| Office | Required for contract management | Unlocks negotiation at Tier 2+ |
| Break Room | Satisfies employee break needs | Well-being +3/+5/+8 per tier |
| Canteen | Satisfies employee food needs | Well-being +2/+4/+7; efficiency +5%/+10%/+15% |
| Medical Bay | Treats injured employees | Safety +3/+5/+8; recovery speed ×1/×2/×3 |
| Explosives Magazine | Stores explosives safely | Required to purchase explosives |
| Fuel Station | Refuels vehicles automatically | Reduces fuel cost by 5%/10%/15% |
| Guard Post | Deters mafia events | Safety +1/+2/+4; mafia event probability −10%/−20%/−30% |
| Parking Lot | Extra vehicle storage (overflow) | Cheaper than vehicle depot but no maintenance bonus |

### 1.7 Atomic Task Breakdown

| # | Task | File(s) | Test |
|---|------|---------|------|
| 1.7.1 | Add `BuildingTier` type and `tier` field to `BuildingDef` | `src/core/entities/Building.ts` | `tests/unit/entities/Building.test.ts` |
| 1.7.2 | Add 3 new building types (`fuel_station`, `guard_post`, `parking_lot`) to `BuildingType` union | `src/core/entities/Building.ts` | Update existing tests |
| 1.7.3 | Create full 33-entry `BUILDING_DEFS` catalog (11 types × 3 tiers) | `src/core/entities/Building.ts` | Test: every type has 3 tiers, costs increase per tier |
| 1.7.4 | Add i18n keys for all 33 building names (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve |
| 1.7.5 | Implement `canPlaceBuilding()` with flat-surface + overlap + safety-distance checks | `src/core/entities/Building.ts` | Test: placement validation with mock terrain |
| 1.7.6 | Implement `upgradeBuilding()` — in-place tier upgrade with cost calculation | `src/core/entities/Building.ts` | Test: cost = `(next - current) * 0.7` |
| 1.7.7 | Add tier unlock conditions to `balance.ts` | `src/core/config/balance.ts` | Test: tier availability based on game state |
| 1.7.8 | Wire building placement into console command `build` | `src/console/commands/entities.ts` | Integration test |
| 1.7.9 | Add `upgrade_building` console command | `src/console/commands/entities.ts` | Integration test |
| 1.7.10 | Update `BuildingMesh.ts` to vary geometry/color by tier | `src/renderer/BuildingMesh.ts` | Visual test |

---

*Chapters 2–8 to be added in subsequent sessions.*
