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

## 2. Vehicle Fleet

### 2.1 Design Goals

Vehicles are the player's **operational muscle** — they drill holes, haul rubble, load trucks, and clear terrain. The current system defines 4 vehicle types with flat stats. This chapter adds **tiers & funny names** (matching the buildings pattern), a **driver assignment system**, **fuel management**, **routing**, and **breakdowns** to create a deeper management layer.

### 2.2 Vehicle Types & Tiers

Each vehicle type has 3 tiers with escalating stats and absurd names. All names localized via i18n.

| Type | Tier 1 (Rusty) | Tier 2 (Decent) | Tier 3 (Beast) |
|------|----------------|-----------------|-----------------|
| Truck | "Dumpster on Wheels" | "Haul-o-Matic 3000" | "Mega Mover XL" |
| Excavator | "The Claw" | "Digzilla" | "Earth Eater 9000" |
| Drill Rig | "Pokey McPoke" | "Bore Master" | "Helldriller" |
| Bulldozer | "Shove-It" | "Flatten Fred" | "The Obliterator" |
| Water Truck | "Leaky Larry" | "Spritz Machine" | "Dust Destroyer" |
| Crane | "Wobbly Arm" | "Lift King" | "Sky Hook Supreme" |

**New types:**
- **Water Truck** — suppresses dust (reduces nuisance score penalty from blasting and hauling). Required at higher difficulty levels.
- **Crane** — required for building construction and heavy equipment placement. Without a crane, buildings take 3× longer to construct.

### 2.3 Tier Stat Multipliers

Each tier multiplies the base stats from the existing `VehicleDef`:

| Stat | Tier 1 (×) | Tier 2 (×) | Tier 3 (×) |
|------|-----------|-----------|-----------|
| `capacity` | 1.0 | 1.6 | 2.5 |
| `speed` | 1.0 | 1.3 | 1.8 |
| `maxHp` | 1.0 | 1.5 | 2.2 |
| `purchaseCost` | 1.0 | 2.0 | 4.0 |
| `maintenanceCostPerTick` | 1.0 | 1.4 | 2.0 |
| `fuelCostPerTick` | 1.0 | 1.2 | 1.5 |

### 2.4 Extended Vehicle Data Schema

Extends `VehicleDef` and `Vehicle` in `src/core/entities/Vehicle.ts`:

```typescript
export type VehicleTier = 1 | 2 | 3;

export interface VehicleDef {
  type: VehicleType;
  tier: VehicleTier;
  /** i18n key, e.g. 'vehicle.truck.tier1' → "Dumpster on Wheels" */
  nameKey: string;
  purchaseCost: number;
  maintenanceCostPerTick: number;
  fuelCostPerTick: number;
  capacity: number;
  speed: number;
  maxHp: number;
  /** Fuel tank size (ticks of operation before refueling). */
  fuelCapacity: number;
}

export interface Vehicle {
  id: number;
  type: VehicleType;
  tier: VehicleTier;
  x: number;
  z: number;
  hp: number;
  task: VehicleTask;
  targetX: number;
  targetZ: number;
  /** Current fuel level (ticks of operation remaining). */
  fuel: number;
  /** Assigned driver employee ID, or null if uncrewed. */
  driverId: number | null;
  /** Ticks since last maintenance. Breakdown chance increases over time. */
  ticksSinceMaintenance: number;
  /** Whether the vehicle is currently broken down. */
  brokenDown: boolean;
}
```

### 2.5 Driver Assignment

- Each vehicle requires a **driver** (employee with role `'driver'`) to operate
- Uncrewed vehicles remain parked and cannot perform tasks
- One driver per vehicle; one vehicle per driver
- If a driver is injured, their vehicle becomes idle until reassigned
- Drivers gain a hidden **experience** counter: +1 per tick of active driving. At 100/500/1000 xp, they unlock efficiency bonuses (+5%/+10%/+15% to vehicle speed)

```typescript
/** Driver experience thresholds and bonuses. */
export const DRIVER_XP_BONUSES = [
  { threshold: 100, speedMultiplier: 1.05 },
  { threshold: 500, speedMultiplier: 1.10 },
  { threshold: 1000, speedMultiplier: 1.15 },
] as const;
```

### 2.6 Fuel System

- Every vehicle has a **fuel tank** (`fuelCapacity` in ticks of operation)
- Each tick a vehicle is not idle, it consumes 1 fuel unit
- At 0 fuel, the vehicle stops where it is and enters `'idle'` state with a `needsFuel` flag
- Vehicles auto-refuel when they return to a **Fuel Station** building (instant) or a **Vehicle Depot** (takes 3 ticks)
- Fuel station tier affects refuel speed: Tier 1 = 3 ticks, Tier 2 = 2 ticks, Tier 3 = instant
- Fuel tank sizes by type: Truck 50, Excavator 40, Drill Rig 35, Bulldozer 45, Water Truck 30, Crane 25

### 2.7 Breakdown System

Vehicles accumulate **wear** over time. Breakdown probability increases with `ticksSinceMaintenance`:

```
breakdownChance = min(0.5, ticksSinceMaintenance * 0.0005)
```

- Checked once per tick when the vehicle is active (not idle)
- Uses seeded PRNG (`rng.next() < breakdownChance`)
- Broken-down vehicles cannot operate until repaired
- Repair requires the vehicle to be at a **Vehicle Depot** and takes `10 / tier` ticks (Tier 3 depot = 3.3 ticks ≈ 4 ticks)
- Maintenance resets wear: sending a vehicle to a depot for 5 ticks resets `ticksSinceMaintenance` to 0
- Vehicles depoted at a Tier 2+ Vehicle Depot gain a 50% slower wear accumulation

### 2.8 Routing & Movement

Vehicles move on the **surface grid** (top solid voxel layer). Movement rules:

1. **A\* pathfinding** on the 2D surface grid (details in Chapter 6: NavMesh)
2. Movement cost per cell = 1.0 for flat, 2.0 for ramp, ∞ for cliff/hole
3. Speed = `def.speed * driverXpMultiplier` cells per tick
4. Vehicles cannot overlap on the same cell (queueing at bottlenecks)
5. **Ramp requirement:** Vehicles cannot traverse vertical drops > 1 cell. Ramps must be built or blasted to create gradual transitions.

### 2.9 Vehicle Tasks — State Machine

```
                    ┌──────────┐
          ┌────────►│   idle   │◄────────┐
          │         └────┬─────┘         │
          │              │ assign        │ arrive/unload
          ▼              ▼               │
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │  refuel  │   │  moving  │──►│ working  │
    └──────────┘   └──────────┘   └──────────┘
          ▲              │               │
          │              ▼               ▼
          │         ┌──────────┐   ┌──────────┐
          └─────────│breakdown │   │ loading  │
                    └──────────┘   └──────────┘
```

Task descriptions:
| Task | Applicable Vehicles | Behavior |
|------|-------------------|----------|
| `idle` | All | Parked, no fuel consumed. Awaiting assignment. |
| `moving` | All | Pathfinding to target cell. Consumes fuel. |
| `transport` | Truck | Carrying payload from source to destination. |
| `loading` | Excavator | Loading rubble into adjacent truck. |
| `drilling` | Drill Rig | Drilling a hole at target position. |
| `clearing` | Bulldozer | Removing surface material at target. |
| `watering` | Water Truck | Spraying water to suppress dust. |
| `lifting` | Crane | Assisting building construction. |
| `refuel` | All | Parked at fuel station/depot, refueling. |
| `breakdown` | All | Broken down, awaiting repair at depot. |

### 2.10 Vehicle Effects on Scores

| Situation | Score Impact |
|-----------|-------------|
| Active trucks hauling | Nuisance −0.5/truck/tick (dust, noise) |
| Water truck active | Nuisance +1.0/tick (dust suppression) |
| Vehicle breakdown | Safety −2 (one-time event) |
| Vehicle destroyed by blast | Safety −5, Well-being −3 (one-time) |
| All vehicles maintained (wear < 50) | Safety +1/tick bonus |

### 2.11 Atomic Task Breakdown

| # | Task | File(s) | Test |
|---|------|---------|------|
| 2.11.1 | Add `VehicleTier`, `tier` field, and `fuelCapacity` to `VehicleDef` | `src/core/entities/Vehicle.ts` | `tests/unit/entities/Vehicle.test.ts` |
| 2.11.2 | Add 2 new vehicle types (`water_truck`, `crane`) to `VehicleType` union | `src/core/entities/Vehicle.ts` | Update existing tests |
| 2.11.3 | Create 18-entry `VEHICLE_DEFS` catalog (6 types × 3 tiers) with tier multipliers | `src/core/entities/Vehicle.ts` | Test: every type has 3 tiers, stats scale correctly |
| 2.11.4 | Add i18n keys for all 18 vehicle names (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve |
| 2.11.5 | Add `fuel`, `driverId`, `ticksSinceMaintenance`, `brokenDown` to `Vehicle` interface | `src/core/entities/Vehicle.ts` | Test: default values on purchase |
| 2.11.6 | Implement `assignDriver()` — links employee to vehicle, validates role | `src/core/entities/Vehicle.ts` | Test: only drivers can be assigned |
| 2.11.7 | Implement fuel consumption in `tickVehicle()` — decrement fuel, stop at 0 | `src/core/engine/GameLoop.ts` | Test: vehicle stops when fuel = 0 |
| 2.11.8 | Implement breakdown check in `tickVehicle()` — PRNG-based | `src/core/engine/GameLoop.ts` | Test: breakdown probability scales with wear |
| 2.11.9 | Implement `repairVehicle()` and `maintainVehicle()` depot interactions | `src/core/entities/Vehicle.ts` | Test: repair time scales with depot tier |
| 2.11.10 | Add `DRIVER_XP_BONUSES` and driver XP accumulation to balance/Employee | `src/core/config/balance.ts`, `src/core/entities/Employee.ts` | Test: XP thresholds and speed bonuses |
| 2.11.11 | Add `watering` and `lifting` task types to `VehicleTask` | `src/core/entities/Vehicle.ts` | Test: task state machine transitions |
| 2.11.12 | Wire vehicle purchase/assign into console commands | `src/console/commands/entities.ts` | Integration test |
| 2.11.13 | Add vehicle tier visuals (mesh scale/color) to renderer | `src/renderer/VehicleMesh.ts` | Visual test |

---

*Chapters 3–8 to be added in subsequent sessions.*
