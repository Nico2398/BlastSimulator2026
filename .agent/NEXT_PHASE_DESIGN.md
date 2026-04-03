# BlastSimulator2026 — Next Phase Design Document

This document specifies the next wave of gameplay systems to implement. Each chapter is self-contained and includes data definitions, algorithms, and an atomic task breakdown for implementation.

**Chapters:**

1. [Buildings System (Tiers & Funny Names)](#1-buildings-system) [to be confirmed]
2. [Vehicle Fleet (Types, Routing & Drivers)](#2-vehicle-fleet) [to be confirmed]
3. [Employee Skills & Task Queue](#3-employee-skills--task-queue) [to be confirmed]
4. [Rock Composition & Survey System](#4-rock-composition--survey-system) [to be confirmed]
5. [Blast Algorithm Enhancements](#5-blast-algorithm-enhancements) [to be confirmed]
6. [NavMesh & Pathfinding](#6-navmesh--pathfinding) [to be confirmed]
7. [Employee Needs (Eating, Sleeping, Breaks)](#7-employee-needs) [to be confirmed]
8. [Testing Strategy](#8-testing-strategy) [to be confirmed]

---

## 1. Buildings System

### 1.1 Design Goals

Buildings are the player's main tool for supporting operations and keeping employees happy. Each building type comes in **3 tiers** (Basic → Improved → Deluxe) with increasingly silly names, higher capacity, better score bonuses, and higher cost. Buildings occupy a **fixed rectangular footprint** on the surface grid and must be placed on **flat terrain** (no voxels removed beneath).

### 1.2 Building Types & Tiers

All names are fictional and humorous, localized via i18n (`en.json` + `fr.json`).

| Type | Tier 1 (Basic) | Tier 2 (Improved) | Tier 3 (Deluxe) | [to be confirmed]
|------|----------------|-------------------|-----------------|
| Worker Quarters | "The Shack" | "Cozy Crate" | "Minion Manor" | [to be confirmed]
| Storage Depot | "The Pile" | "Stuff Bunker" | "Hoarder's Paradise" | [to be confirmed]
| Vehicle Depot | "Rusty Garage" | "Grease Palace" | "Mecha Hangar" | [to be confirmed]
| Office | "Paper Dungeon" | "Bureaucracy Box" | "Corner Office" | [to be confirmed]
| Break Room | "Sad Bench" | "Vending Lounge" | "Zen Den" | [to be confirmed]
| Canteen | "Slop Trough" | "Chow Hall" | "Gourmet Grotto" | [to be confirmed]
| Medical Bay | "Band-Aid Hut" | "Nurse Nook" | "Trauma Tower" | [to be confirmed]
| Explosives Magazine | "Boom Closet" | "Blast Vault" | "Fort Kaboom" | [to be confirmed]
| Fuel Station | "Drip Tank" | "Pump Palace" | "Petrol Colosseum" | [to be confirmed]
| Guard Post | "Lookout Shack" | "Watch Tower" | "Fortress of Compliance" | [to be confirmed]
| Parking Lot | "Dirt Patch" | "Paved Plaza" | "Multi-Story Mech Park" | [to be confirmed]

#### Tier Progression Rules
- Tier 1 is available from game start on all levels [to be confirmed]
- Tier 2 unlocks when the player has built at least 3 buildings of any type [to be confirmed]
- Tier 3 unlocks when the player reaches Level 2 or has $100,000+ cash [to be confirmed]
- Upgrading an existing building costs `(next_tier_cost - current_tier_cost) * 0.7` (discount for upgrade vs. new build) [to be confirmed]
- Upgrades happen in-place — same footprint, no repositioning needed [to be confirmed]

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

1. **Flat surface check:** Every cell in the footprint must have a surface voxel at the same Y level (±0.5 cell tolerance). No holes, no slopes. [to be confirmed]
2. **No overlap:** Buildings cannot overlap each other or the active blast zone. [to be confirmed]
3. **Safety distance:** Buildings must be at least 5 cells from any drill hole in the current blast plan (configurable in `balance.ts`). [to be confirmed]
4. **Road access:** At least one edge cell of the building must be adjacent to a navigable path (for employee/vehicle access). [to be confirmed]
5. **Explosives magazine** must be at least 15 cells from any other building (real regulation: 300m scaled down). [to be confirmed]

### 1.5 Destructibility

- Buildings hit by blast projections lose HP based on fragment kinetic energy [to be confirmed]
- At 0 HP, the building is destroyed: removed from grid, score penalties applied [to be confirmed]
- Destroyed buildings trigger events (lawsuits if employees were inside, insurance claims) [to be confirmed]
- Contents (stored materials, vehicles parked inside) are also destroyed [to be confirmed]

### 1.6 Building Effects on Gameplay

| Building | Primary Effect | Secondary Effect | [to be confirmed]
|----------|---------------|-----------------|
| Worker Quarters | Houses employees (capacity = beds) | Well-being +2/+4/+6 per tier | [to be confirmed]
| Storage Depot | Stores rubble/ore (capacity = kg) | Enables material contracts | [to be confirmed]
| Vehicle Depot | Parks & maintains vehicles (capacity = slots) | Reduces maintenance cost by 10%/20%/30% | [to be confirmed]
| Office | Required for contract management | Unlocks negotiation at Tier 2+ | [to be confirmed]
| Break Room | Satisfies employee break needs | Well-being +3/+5/+8 per tier | [to be confirmed]
| Canteen | Satisfies employee food needs | Well-being +2/+4/+7; efficiency +5%/+10%/+15% | [to be confirmed]
| Medical Bay | Treats injured employees | Safety +3/+5/+8; recovery speed ×1/×2/×3 | [to be confirmed]
| Explosives Magazine | Stores explosives safely | Required to purchase explosives | [to be confirmed]
| Fuel Station | Refuels vehicles automatically | Reduces fuel cost by 5%/10%/15% | [to be confirmed]
| Guard Post | Deters mafia events | Safety +1/+2/+4; mafia event probability −10%/−20%/−30% | [to be confirmed]
| Parking Lot | Extra vehicle storage (overflow) | Cheaper than vehicle depot but no maintenance bonus | [to be confirmed]

### 1.7 Atomic Task Breakdown

| # | Task | File(s) | Test | [to be confirmed]
|---|------|---------|------|
| 1.7.1 | Add `BuildingTier` type and `tier` field to `BuildingDef` | `src/core/entities/Building.ts` | `tests/unit/entities/Building.test.ts` | [to be confirmed]
| 1.7.2 | Add 3 new building types (`fuel_station`, `guard_post`, `parking_lot`) to `BuildingType` union | `src/core/entities/Building.ts` | Update existing tests | [to be confirmed]
| 1.7.3 | Create full 33-entry `BUILDING_DEFS` catalog (11 types × 3 tiers) | `src/core/entities/Building.ts` | Test: every type has 3 tiers, costs increase per tier | [to be confirmed]
| 1.7.4 | Add i18n keys for all 33 building names (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve | [to be confirmed]
| 1.7.5 | Implement `canPlaceBuilding()` with flat-surface + overlap + safety-distance checks | `src/core/entities/Building.ts` | Test: placement validation with mock terrain | [to be confirmed]
| 1.7.6 | Implement `upgradeBuilding()` — in-place tier upgrade with cost calculation | `src/core/entities/Building.ts` | Test: cost = `(next - current) * 0.7` | [to be confirmed]
| 1.7.7 | Add tier unlock conditions to `balance.ts` | `src/core/config/balance.ts` | Test: tier availability based on game state | [to be confirmed]
| 1.7.8 | Wire building placement into console command `build` | `src/console/commands/entities.ts` | Integration test | [to be confirmed]
| 1.7.9 | Add `upgrade_building` console command | `src/console/commands/entities.ts` | Integration test | [to be confirmed]
| 1.7.10 | Update `BuildingMesh.ts` to vary geometry/color by tier | `src/renderer/BuildingMesh.ts` | Visual test | [to be confirmed]

---

## 2. Vehicle Fleet

### 2.1 Design Goals

Vehicles are the player's **operational muscle** — they drill holes, haul rubble, load trucks, and clear terrain. The current system defines 4 vehicle types with flat stats. This chapter adds **tiers & funny names** (matching the buildings pattern), a **driver assignment system**, **fuel management**, **routing**, and **breakdowns** to create a deeper management layer.

### 2.2 Vehicle Types & Tiers

Each vehicle type has 3 tiers with escalating stats and absurd names. All names localized via i18n.

| Type | Tier 1 (Rusty) | Tier 2 (Decent) | Tier 3 (Beast) | [to be confirmed]
|------|----------------|-----------------|-----------------|
| Truck | "Dumpster on Wheels" | "Haul-o-Matic 3000" | "Mega Mover XL" | [to be confirmed]
| Excavator | "The Claw" | "Digzilla" | "Earth Eater 9000" | [to be confirmed]
| Drill Rig | "Pokey McPoke" | "Bore Master" | "Helldriller" | [to be confirmed]
| Bulldozer | "Shove-It" | "Flatten Fred" | "The Obliterator" | [to be confirmed]
| Water Truck | "Leaky Larry" | "Spritz Machine" | "Dust Destroyer" | [to be confirmed]
| Crane | "Wobbly Arm" | "Lift King" | "Sky Hook Supreme" | [to be confirmed]

**New types:**
- **Water Truck** — suppresses dust (reduces nuisance score penalty from blasting and hauling). Required at higher difficulty levels. [to be confirmed]
- **Crane** — required for building construction and heavy equipment placement. Without a crane, buildings take 3× longer to construct. [to be confirmed]

### 2.3 Tier Stat Multipliers

Each tier multiplies the base stats from the existing `VehicleDef`:

| Stat | Tier 1 (×) | Tier 2 (×) | Tier 3 (×) | [to be confirmed]
|------|-----------|-----------|-----------|
| `capacity` | 1.0 | 1.6 | 2.5 | [to be confirmed]
| `speed` | 1.0 | 1.3 | 1.8 | [to be confirmed]
| `maxHp` | 1.0 | 1.5 | 2.2 | [to be confirmed]
| `purchaseCost` | 1.0 | 2.0 | 4.0 | [to be confirmed]
| `maintenanceCostPerTick` | 1.0 | 1.4 | 2.0 | [to be confirmed]
| `fuelCostPerTick` | 1.0 | 1.2 | 1.5 | [to be confirmed]

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

- Each vehicle requires a **driver** (employee with role `'driver'`) to operate [to be confirmed]
- Uncrewed vehicles remain parked and cannot perform tasks [to be confirmed]
- One driver per vehicle; one vehicle per driver [to be confirmed]
- If a driver is injured, their vehicle becomes idle until reassigned [to be confirmed]
- Drivers gain a hidden **experience** counter: +1 per tick of active driving. At 100/500/1000 xp, they unlock efficiency bonuses (+5%/+10%/+15% to vehicle speed) [to be confirmed]

```typescript
/** Driver experience thresholds and bonuses. */
export const DRIVER_XP_BONUSES = [
  { threshold: 100, speedMultiplier: 1.05 },
  { threshold: 500, speedMultiplier: 1.10 },
  { threshold: 1000, speedMultiplier: 1.15 },
] as const;
```

### 2.6 Fuel System

- Every vehicle has a **fuel tank** (`fuelCapacity` in ticks of operation) [to be confirmed]
- Each tick a vehicle is not idle, it consumes 1 fuel unit [to be confirmed]
- At 0 fuel, the vehicle stops where it is and enters `'idle'` state with a `needsFuel` flag [to be confirmed]
- Vehicles auto-refuel when they return to a **Fuel Station** building (instant) or a **Vehicle Depot** (takes 3 ticks) [to be confirmed]
- Fuel station tier affects refuel speed: Tier 1 = 3 ticks, Tier 2 = 2 ticks, Tier 3 = instant [to be confirmed]
- Fuel tank sizes by type: Truck 50, Excavator 40, Drill Rig 35, Bulldozer 45, Water Truck 30, Crane 25 [to be confirmed]

### 2.7 Breakdown System

Vehicles accumulate **wear** over time. Breakdown probability increases with `ticksSinceMaintenance`:

```
breakdownChance = min(0.5, ticksSinceMaintenance * 0.0005)
```

- Checked once per tick when the vehicle is active (not idle) [to be confirmed]
- Uses seeded PRNG (`rng.next() < breakdownChance`) [to be confirmed]
- Broken-down vehicles cannot operate until repaired [to be confirmed]
- Repair requires the vehicle to be at a **Vehicle Depot** and takes `10 / tier` ticks (Tier 3 depot = 3.3 ticks ≈ 4 ticks) [to be confirmed]
- Maintenance resets wear: sending a vehicle to a depot for 5 ticks resets `ticksSinceMaintenance` to 0 [to be confirmed]
- Vehicles depoted at a Tier 2+ Vehicle Depot gain a 50% slower wear accumulation [to be confirmed]

### 2.8 Routing & Movement

Vehicles move on the **surface grid** (top solid voxel layer). Movement rules:

1. **A\* pathfinding** on the 2D surface grid (details in Chapter 6: NavMesh) [to be confirmed]
2. Movement cost per cell = 1.0 for flat, 2.0 for ramp, ∞ for cliff/hole [to be confirmed]
3. Speed = `def.speed * driverXpMultiplier` cells per tick [to be confirmed]
4. Vehicles cannot overlap on the same cell (queueing at bottlenecks) [to be confirmed]
5. **Ramp requirement:** Vehicles cannot traverse vertical drops > 1 cell. Ramps must be built or blasted to create gradual transitions. [to be confirmed]

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
| Task | Applicable Vehicles | Behavior | [to be confirmed]
|------|-------------------|----------|
| `idle` | All | Parked, no fuel consumed. Awaiting assignment. | [to be confirmed]
| `moving` | All | Pathfinding to target cell. Consumes fuel. | [to be confirmed]
| `transport` | Truck | Carrying payload from source to destination. | [to be confirmed]
| `loading` | Excavator | Loading rubble into adjacent truck. | [to be confirmed]
| `drilling` | Drill Rig | Drilling a hole at target position. | [to be confirmed]
| `clearing` | Bulldozer | Removing surface material at target. | [to be confirmed]
| `watering` | Water Truck | Spraying water to suppress dust. | [to be confirmed]
| `lifting` | Crane | Assisting building construction. | [to be confirmed]
| `refuel` | All | Parked at fuel station/depot, refueling. | [to be confirmed]
| `breakdown` | All | Broken down, awaiting repair at depot. | [to be confirmed]

### 2.10 Vehicle Effects on Scores

| Situation | Score Impact | [to be confirmed]
|-----------|-------------|
| Active trucks hauling | Nuisance −0.5/truck/tick (dust, noise) | [to be confirmed]
| Water truck active | Nuisance +1.0/tick (dust suppression) | [to be confirmed]
| Vehicle breakdown | Safety −2 (one-time event) | [to be confirmed]
| Vehicle destroyed by blast | Safety −5, Well-being −3 (one-time) | [to be confirmed]
| All vehicles maintained (wear < 50) | Safety +1/tick bonus | [to be confirmed]

### 2.11 Atomic Task Breakdown

| # | Task | File(s) | Test | [to be confirmed]
|---|------|---------|------|
| 2.11.1 | Add `VehicleTier`, `tier` field, and `fuelCapacity` to `VehicleDef` | `src/core/entities/Vehicle.ts` | `tests/unit/entities/Vehicle.test.ts` | [to be confirmed]
| 2.11.2 | Add 2 new vehicle types (`water_truck`, `crane`) to `VehicleType` union | `src/core/entities/Vehicle.ts` | Update existing tests | [to be confirmed]
| 2.11.3 | Create 18-entry `VEHICLE_DEFS` catalog (6 types × 3 tiers) with tier multipliers | `src/core/entities/Vehicle.ts` | Test: every type has 3 tiers, stats scale correctly | [to be confirmed]
| 2.11.4 | Add i18n keys for all 18 vehicle names (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve | [to be confirmed]
| 2.11.5 | Add `fuel`, `driverId`, `ticksSinceMaintenance`, `brokenDown` to `Vehicle` interface | `src/core/entities/Vehicle.ts` | Test: default values on purchase | [to be confirmed]
| 2.11.6 | Implement `assignDriver()` — links employee to vehicle, validates role | `src/core/entities/Vehicle.ts` | Test: only drivers can be assigned | [to be confirmed]
| 2.11.7 | Implement fuel consumption in `tickVehicle()` — decrement fuel, stop at 0 | `src/core/engine/GameLoop.ts` | Test: vehicle stops when fuel = 0 | [to be confirmed]
| 2.11.8 | Implement breakdown check in `tickVehicle()` — PRNG-based | `src/core/engine/GameLoop.ts` | Test: breakdown probability scales with wear | [to be confirmed]
| 2.11.9 | Implement `repairVehicle()` and `maintainVehicle()` depot interactions | `src/core/entities/Vehicle.ts` | Test: repair time scales with depot tier | [to be confirmed]
| 2.11.10 | Add `DRIVER_XP_BONUSES` and driver XP accumulation to balance/Employee | `src/core/config/balance.ts`, `src/core/entities/Employee.ts` | Test: XP thresholds and speed bonuses | [to be confirmed]
| 2.11.11 | Add `watering` and `lifting` task types to `VehicleTask` | `src/core/entities/Vehicle.ts` | Test: task state machine transitions | [to be confirmed]
| 2.11.12 | Wire vehicle purchase/assign into console commands | `src/console/commands/entities.ts` | Integration test | [to be confirmed]
| 2.11.13 | Add vehicle tier visuals (mesh scale/color) to renderer | `src/renderer/VehicleMesh.ts` | Visual test | [to be confirmed]

---

## 3. Employee Skills & Task Queue

### 3.1 Design Goals

Employees should feel like individuals you develop over time, not interchangeable tokens. This chapter adds a **skill level** per role (1–5 stars), a **specialization** system for late-game differentiation, and a **persistent task queue** so employees carry out multi-step work autonomously without constant micromanagement.

### 3.2 Skill Levels

Each employee has a `skillLevel` (1–5) that directly affects their output quality and speed. Skill increases through **XP** earned by completing tasks.

| Skill Level | Label | XP to Reach | Effectiveness Bonus | [to be confirmed]
|------------|-------|-------------|-------------------|
| 1 | Rookie | 0 | ×1.00 | [to be confirmed]
| 2 | Decent | 50 | ×1.15 | [to be confirmed]
| 3 | Skilled | 150 | ×1.30 | [to be confirmed]
| 4 | Expert | 350 | ×1.50 | [to be confirmed]
| 5 | Legend | 700 | ×1.75 | [to be confirmed]

XP gain per tick of active work: `1 + floor(skillLevel * 0.5)` (legends level up faster). XP is role-specific — a driller who gets reassigned as a driver starts at skill 1 for driving.

Skill multiplier stacks with the existing morale-based `getEffectiveness()` multiplier:
```
totalEffectiveness = moraleEffectiveness * skillMultiplier
```

### 3.3 Specializations

At skill level 4, an employee may choose one **specialization** (player chooses from 2 options offered). Specializations are permanent and add a targeted bonus on top of the skill multiplier.

| Role | Specialization A | Specialization B | [to be confirmed]
|------|-----------------|-----------------|
| Driller | "Speed Demon" — drill time −25% | "Deep Corer" — max hole depth +50% | [to be confirmed]
| Blaster | "Precision Popper" — over-blast chance −40% | "Big Banger" — explosive efficiency +20% | [to be confirmed]
| Driver | "Speed Racer" — vehicle speed +20% | "Heavy Hauler" — truck capacity +30% | [to be confirmed]
| Surveyor | "Eagle Eye" — survey accuracy +30% | "Speed Scanner" — survey time −40% | [to be confirmed]
| Manager | "Taskmaster" — task queue length +3 | "Morale Booster" — all nearby employee morale +5/tick | [to be confirmed]

### 3.4 Task Queue

Each employee has a **task queue** (ordered list of `TaskEntry` items). The game loop processes the front of the queue each tick; on completion the entry is dequeued and the next begins.

```typescript
export type TaskType =
  | 'move_to'         // Walk to grid position
  | 'drill_hole'      // Drill at assigned hole position
  | 'charge_hole'     // Place explosive charge in a drilled hole
  | 'clear_rubble'    // Clear fragmented material from cell
  | 'survey_zone'     // Survey a grid region for composition
  | 'supervise'       // Manager supervises nearby workers (+morale)
  | 'rest'            // Forced rest (injured / break time)
  | 'await_vehicle';  // Wait for assigned vehicle to arrive

export interface TaskEntry {
  type: TaskType;
  /** Target grid position (for move_to, drill_hole, etc.) */
  targetX?: number;
  targetZ?: number;
  /** Additional payload (e.g., charge spec, survey radius). */
  payload?: Record<string, unknown>;
  /** Ticks remaining for current active task (counts down each tick). */
  ticksRemaining: number;
  /** Ticks required to complete the task (set on assignment). */
  ticksRequired: number;
}
```

**Queue rules:**
- Default queue capacity = 5 entries (Manager "Taskmaster" specialization raises it to 8) [to be confirmed]
- The player assigns tasks via console `assign` command or UI drag-and-drop (Ch. 6) [to be confirmed]
- If an employee becomes injured, their queue is paused and a `rest` task is prepended [to be confirmed]
- If a required building (e.g., canteen) becomes unavailable, queued `rest` tasks at that building are cancelled and requeued at the next available building [to be confirmed]
- Employees with empty queues enter `idle` state and lose morale at −1/tick (boredom) [to be confirmed]

### 3.5 Task Duration Formulas

Base durations (in ticks), modified by skill, morale, and specializations:

| Task | Base Duration | Modifier | [to be confirmed]
|------|--------------|---------|
| `move_to` | `ceil(distance / walkSpeed)` | walkSpeed = 2 cells/tick | [to be confirmed]
| `drill_hole` | `ceil(depth / (2 * effectiveness))` | depth in cells | [to be confirmed]
| `charge_hole` | 3 ticks flat | ×0.8 if blaster skill ≥ 3 | [to be confirmed]
| `clear_rubble` | `ceil(volume / (5 * effectiveness))` | volume in cells³ | [to be confirmed]
| `survey_zone` | `ceil(radius² * 0.5 / effectiveness)` | radius in cells | [to be confirmed]
| `supervise` | Continuous | Runs until cancelled | [to be confirmed]
| `rest` | Varies (see Ch. 7) | — | [to be confirmed]

### 3.6 Atomic Task Breakdown

| # | Task | File(s) | Test | [to be confirmed]
|---|------|---------|------|
| 3.6.1 | Add `skillLevel`, `xp`, `specialization` fields to `Employee` interface | `src/core/entities/Employee.ts` | `tests/unit/entities/Employee.test.ts` | [to be confirmed]
| 3.6.2 | Add `SKILL_XP_THRESHOLDS` and `SKILL_EFFECTIVENESS_MULTIPLIERS` to `balance.ts` | `src/core/config/balance.ts` | Test: XP → skill level progression | [to be confirmed]
| 3.6.3 | Implement `gainXp()` — awards XP after task, triggers level-up event | `src/core/entities/Employee.ts` | Test: level up at correct thresholds | [to be confirmed]
| 3.6.4 | Add `SPECIALIZATIONS` catalog (10 entries) | `src/core/entities/Employee.ts` | Test: each role has exactly 2 options | [to be confirmed]
| 3.6.5 | Implement `chooseSpecialization()` — only valid at skill 4, one-time | `src/core/entities/Employee.ts` | Test: reject if not skill 4 or already chosen | [to be confirmed]
| 3.6.6 | Add `TaskEntry` and `TaskType` definitions | `src/core/entities/Employee.ts` | Type-only, no test needed | [to be confirmed]
| 3.6.7 | Add `taskQueue: TaskEntry[]` to `Employee` interface | `src/core/entities/Employee.ts` | Test: default empty queue | [to be confirmed]
| 3.6.8 | Implement `enqueueTask()` — validates queue capacity, rejects overflow | `src/core/entities/Employee.ts` | Test: overflow returns error | [to be confirmed]
| 3.6.9 | Implement `tickEmployee()` — advances task, awards XP on completion, dequeues | `src/core/engine/GameLoop.ts` | Test: multi-step queue completes in correct order | [to be confirmed]
| 3.6.10 | Implement `computeTaskDuration()` — formulas from §3.5 | `src/core/entities/Employee.ts` | Test: durations scale with skill | [to be confirmed]
| 3.6.11 | Add i18n keys for all specialization names and descriptions (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve | [to be confirmed]
| 3.6.12 | Wire `assign` and `queue` console commands | `src/console/commands/entities.ts` | Integration test | [to be confirmed]

---

## 4. Rock Composition & Survey System

### 4.1 Design Goals

The player should not know exactly what ore is in the ground — discovery should feel rewarding and create strategic decisions. Before blasting, a player can run surveys to estimate rock composition. Surveys cost time and money but reveal ore density maps that help the player choose blast patterns, explosive types, and contract targets.

The existing `VoxelGrid` already stores `oreDensities` per voxel, and `RockCatalog` defines `oreProbabilities`. This chapter adds the **player-visible layer** on top: surveys, reveal mechanics, estimation error, and the "fog of war" for sub-surface composition.

### 4.2 Survey Methods

Three survey tools, each with a different cost/accuracy/coverage tradeoff:

| Method | Tool | i18n Key | Cost ($) | Time (ticks) | Accuracy | Coverage | [to be confirmed]
|--------|------|---------|---------|-------------|---------|---------|
| Seismic Survey | Detonates a small charge and records reflections | `survey.seismic` | 3,000 | 8 | ±15% ore density | 20-cell radius, full depth | [to be confirmed]
| Core Sample | Drills a narrow extraction core | `survey.core_sample` | 800 | 4 | ±5% ore density | Single column, full depth | [to be confirmed]
| Aerial Spectroscopy | Drone scans surface mineral signature | `survey.aerial` | 1,500 | 3 | ±25% ore density | 30-cell radius, surface only (depth 0–2) | [to be confirmed]

Accuracy improves with surveyor skill level:
```
finalError = baseError * (1 - (skillLevel - 1) * 0.12)
// Skill 1: ±15%, Skill 5 (with Eagle Eye): ±15% * (1 - 0.48) * 0.7 = ≈±5%
```

### 4.3 Survey Result Data

A survey produces a `SurveyResult` that is persisted in `GameState`:

```typescript
export type SurveyMethod = 'seismic' | 'core_sample' | 'aerial';

export interface SurveyResult {
  id: number;
  method: SurveyMethod;
  /** Survey origin in grid coordinates. */
  centerX: number;
  centerZ: number;
  /** Tick when the survey was completed. */
  completedTick: number;
  /** Surveyor employee ID. */
  surveyorId: number;
  /** Estimated ore densities per revealed voxel column (x,z → ore_id → estimated density). */
  estimates: Record<string, Record<string, number>>;
  /** Confidence factor 0–1 based on surveyor skill and method accuracy. */
  confidence: number;
}
```

Survey results are stale after 100 ticks (rock may be disturbed by blasts). The UI renders a confidence heatmap overlay over the terrain.

### 4.4 Estimation Algorithm

The survey estimation algorithm runs in `src/core/mining/SurveyCalc.ts`:

1. **Sample true voxel composition** from `VoxelGrid.getVoxel(x, y, z).oreDensities` [to be confirmed]
2. **Add Gaussian noise** scaled by the method's base error and surveyor skill: [to be confirmed]
   ```
   estimatedDensity = trueDensity + rng.gaussian(0, baseError * (1 - skillBonus))
   estimatedDensity = clamp(estimatedDensity, 0, 1)
   ```
3. **Round to nearest 0.05** (discrete bands: 0, 5%, 10%... 100%) — players see bands not raw floats [to be confirmed]
4. For **aerial** surveys: only samples Y = surfaceY and surfaceY−1 (shallow horizon only) [to be confirmed]
5. For **seismic**: averages estimates over a 3-voxel vertical smear (coarser vertical resolution) [to be confirmed]

### 4.5 Ore Grade Reporting Post-Blast

After a blast, the game computes the **actual ore yield** from destroyed voxels and reports it as a `BlastOreReport`. This report is compared to the pre-blast survey estimate, and the delta drives feedback events:

| Condition | Event | Effect | [to be confirmed]
|-----------|-------|--------|
| Actual yield > 120% of estimate | "Lucky Strike" | +$2,000 bonus, ecology −1 | [to be confirmed]
| Actual yield < 60% of estimate | "Barren Blast" | No bonus, surveyor morale −10 | [to be confirmed]
| Treranium ore found (any amount) | "Legendary Vein" | Contract premium ×3 for 20 ticks | [to be confirmed]
| Absurdium > 30% of yield | "Absurdium Jackpot" | Mafia event trigger probability +40% | [to be confirmed]

### 4.6 Survey Visibility Rules

- Un-surveyed voxels appear as the dominant rock type color with no ore overlay [to be confirmed]
- Surveyed voxels show a color-coded ore density overlay (opacity = confidence) [to be confirmed]
- Surveys are shared across the team — all players see the same result (no fog per player in this single-player game) [to be confirmed]
- Seismic surveys disturb nearby buildings: if a building is within 5 cells, it loses 10 HP per survey detonation [to be confirmed]

### 4.7 Atomic Task Breakdown

| # | Task | File(s) | Test | [to be confirmed]
|---|------|---------|------|
| 4.7.1 | Add `SurveyMethod`, `SurveyResult` interfaces | `src/core/mining/SurveyCalc.ts` (new file) | `tests/unit/mining/SurveyCalc.test.ts` | [to be confirmed]
| 4.7.2 | Implement `estimateSurveyResult()` — noise + skill scaling | `src/core/mining/SurveyCalc.ts` | Test: estimate within expected error bounds (seeded RNG) | [to be confirmed]
| 4.7.3 | Implement `isSurveyStale()` — returns true after 100 ticks | `src/core/mining/SurveyCalc.ts` | Test: stale at tick 101, fresh at 99 | [to be confirmed]
| 4.7.4 | Add `surveyResults: SurveyResult[]` and `nextSurveyId` to `GameState` | `src/core/GameState.ts` | Test: initial state has empty array | [to be confirmed]
| 4.7.5 | Add survey cost constants to `balance.ts` | `src/core/config/balance.ts` | — | [to be confirmed]
| 4.7.6 | Implement `runSurvey()` — validates surveyor, deducts cost, enqueues task | `src/core/mining/SurveyCalc.ts` | Test: insufficient funds returns error | [to be confirmed]
| 4.7.7 | Implement `computeBlastOreReport()` — yields from destroyed voxels | `src/core/mining/SurveyCalc.ts` | Test: ore mass = Σ(density × voxelVolume × rockDensity) | [to be confirmed]
| 4.7.8 | Wire ore report events to event system | `src/core/events/EventEngine.ts` | Test: lucky strike fires at >120% | [to be confirmed]
| 4.7.9 | Add i18n keys for survey methods and events (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve | [to be confirmed]
| 4.7.10 | Add `survey` console command (`survey seismic x:10 z:10`) | `src/console/commands/mining.ts` | Integration test | [to be confirmed]
| 4.7.11 | Render survey confidence overlay in `TerrainMesh.ts` | `src/renderer/TerrainMesh.ts` | Visual test | [to be confirmed]

---

## 5. Blast Algorithm Enhancements

### 5.1 Design Goals

The current blast pipeline (energy field → fragmentation → vibration) is solid but flat. This chapter adds **angled holes**, **deck charging** (multiple charges per hole), **presplit blasting** (wall control technique), and **buffer row mechanics** for precision bench cuts. It also adds a real-time **vibration budget** that limits how much the player can fire per delay before regulatory penalties trigger.

### 5.2 Angled Holes

Currently all holes are vertical. Angled holes allow the player to direct energy at the free face more efficiently, reducing back-break and improving fragmentation near the bench floor.

```typescript
export interface DrillHole {
  id: string;
  x: number;
  z: number;
  depth: number;
  /** Inclination angle from vertical, degrees. 0 = vertical, max 30°. */
  inclinationDeg: number;
  /** Bearing (compass direction) the hole leans toward, degrees. 0 = north. */
  bearingDeg: number;
}
```

**Energy field change:** The hole column is no longer vertical. The mid-column source point is calculated along the inclined axis:

```
collarPos = (hole.x, surfaceY, hole.z)
toeDir = (sin(bearing) * sin(inclination), -cos(inclination), cos(bearing) * sin(inclination))
midPos = collarPos + toeDir * (depth / 2)
```

**Fragmentation bonus:** If the hole leans within 15° of perpendicular to the nearest free face:
```
freeAlignmentBonus = 1.0 + 0.2 * cos(angleBetweenHoleAxisAndFaceNormal)
effectiveEnergy *= freeAlignmentBonus
```

**Constraints:**
- Inclination capped at 30° (beyond that, drill rigs lose stability) [to be confirmed]
- Angled holes require Drill Rig Tier 2+ (Tier 1 cannot drill angled) [to be confirmed]
- Angled holes cost +30% drilling time per degree of inclination [to be confirmed]

### 5.3 Deck Charging

A single drill hole can hold **up to 3 charge decks** separated by inert stemming plugs. This allows different explosives at different depths without drilling multiple holes.

```typescript
export interface DeckCharge {
  /** Explosive type ID. */
  explosiveId: string;
  amountKg: number;
  /** Depth of this deck's midpoint from surface (m). */
  deckDepthM: number;
  /** Stemming height above this deck (m). */
  stemmingAboveM: number;
}

export interface HoleCharge {
  holeId: string;
  /** Single charge (legacy) OR multiple decks. */
  decks: DeckCharge[];
  /** Whether tubing is present for water-sensitive explosives. */
  hasTubing: boolean;
}
```

**Energy calculation change:** Each deck contributes its own energy field independently:
```
E(P) += Σ_decks [ deckEnergy / (dist(P, deckMidPos)² + ε) ]
```

**Typical use:** Hard rock at bottom of hole (high-energy deck) + gentle explosive near surface (low-energy deck) for cleaner bench floor and reduced fly-rock.

**Cost:** Each additional deck adds $50 + `deck.amountKg * explosivePricePerKg` per hole.

### 5.4 Presplit Blasting

Presplit is a wall-control technique: a row of lightly charged, closely spaced holes is fired **before the main blast** to create a clean fracture line along the designed wall. This prevents back-break (unwanted rock fracture behind the bench).

```typescript
export type HoleRole = 'production' | 'presplit' | 'buffer';

// Added to DrillHole:
export interface DrillHole {
  // ...existing fields...
  role: HoleRole;
}
```

**Presplit rules:**
- Presplit holes must be spaced ≤ 1.5 m (game cells) apart [to be confirmed]
- Charge energy must be ≤ 30% of normal production charge [to be confirmed]
- Presplit holes fire in delay slot 0 (before all production holes) [to be confirmed]
- If presplit conditions are met, `backBreakPenalty` for the blast is set to 0 (otherwise it is `0.2 * productionEnergy`) [to be confirmed]

**Back-break penalty effect:**
- Back-break damages the wall behind the blast zone [to be confirmed]
- Mechanically: voxels behind the presplit line have their `fractureModifier` reduced by `backBreakPenalty * 0.5` [to be confirmed]
- Score impact: Ecology −0.1 per voxel of back-break (soil destabilization) [to be confirmed]

### 5.5 Buffer Row

The **buffer row** is the last row of production holes before the new wall. It is charged at 60–80% of the main burden charge to avoid over-blasting toward the newly formed face.

```
bufferChargeRatio = clamp(userSetting, 0.6, 0.8)
bufferHoleEnergy = productionHoleEnergy * bufferChargeRatio
```

If no buffer row is used (all holes at full charge), back-break increases by 50%. The console `blast_plan` command accepts a `buffer_ratio` argument to set this.

### 5.6 Vibration Budget

Real mines operate under vibration limits imposed by regulators. The player faces a **vibration budget per blast**:

```
vibrationBudget = BASE_VIBRATION_BUDGET + manager_bonus
```

- `BASE_VIBRATION_BUDGET` = 50 (arbitrary game units, corresponds to ≈50mm/s PPV) [to be confirmed]
- Manager with "Taskmaster" specialization: +10 budget [to be confirmed]
- Proximity to town (set per level): budget reduced by up to −20 [to be confirmed]

**Per-blast check (runs in `BlastCalc.calculateVibrations()`):**

```
peakVibration = calculateVibrations(chargePerDelay, distanceToNearestSensitivePoint, groundFactor)
```

If `peakVibration > vibrationBudget`:
- Warning displayed (but blast allowed on first offence) [to be confirmed]
- Second offence: Nuisance score −5 and $1,000 fine [to be confirmed]
- Third offence: Blast halted by regulator, $5,000 fine and Safety −3 [to be confirmed]

Splitting the blast into more delay slots (smaller charge per delay) is the primary mitigation.

The player can view predicted peak vibration **before** firing via the `blast_preview` console command.

### 5.7 New Balance Constants

```typescript
// In src/core/config/balance.ts:

/** Maximum drill hole inclination (degrees). Beyond this, drill rig is unstable. */
export const MAX_HOLE_INCLINATION_DEG = 30;

/** Energy bonus multiplier for free-face-aligned angled holes. */
export const ANGLED_HOLE_ALIGNMENT_BONUS = 0.2;

/** Max charge decks per hole. */
export const MAX_CHARGE_DECKS = 3;

/** Cost per additional deck charge beyond the first ($). */
export const DECK_CHARGE_BASE_COST = 50;

/** Max presplit hole spacing (cells). */
export const PRESPLIT_MAX_SPACING = 1.5;

/** Presplit max charge fraction of production charge. */
export const PRESPLIT_MAX_CHARGE_RATIO = 0.3;

/** Default buffer row charge ratio. */
export const BUFFER_CHARGE_DEFAULT_RATIO = 0.7;

/** Base vibration budget per blast (game units). */
export const BASE_VIBRATION_BUDGET = 50;
```

### 5.8 Atomic Task Breakdown

| # | Task | File(s) | Test | [to be confirmed]
|---|------|---------|------|
| 5.8.1 | Add `inclinationDeg`, `bearingDeg`, `role` to `DrillHole` interface | `src/core/mining/DrillPlan.ts` | `tests/unit/mining/DrillPlan.test.ts` | [to be confirmed]
| 5.8.2 | Update `calculateEnergyField()` to use inclined hole axis for mid-column source | `src/core/mining/BlastCalc.ts` | Test: angled vs vertical hole gives different energy at same point | [to be confirmed]
| 5.8.3 | Implement free-face alignment bonus in energy calculation | `src/core/mining/BlastCalc.ts` | Test: bonus applies only when within 15° of face normal | [to be confirmed]
| 5.8.4 | Replace `HoleCharge.amountKg` + `stemmingM` with `decks: DeckCharge[]` | `src/core/mining/ChargePlan.ts` | Test: single-deck backward-compat wrapper | [to be confirmed]
| 5.8.5 | Update `effectiveHoleEnergy()` to sum across all decks | `src/core/mining/BlastCalc.ts` | Test: multi-deck energy > single deck same total kg | [to be confirmed]
| 5.8.6 | Implement `validatePresplit()` — checks spacing and charge limits | `src/core/mining/BlastCalc.ts` | Test: reject spacing > 1.5 cells | [to be confirmed]
| 5.8.7 | Implement `calculateBackBreak()` — penalty from missing presplit / buffer | `src/core/mining/BlastCalc.ts` | Test: zero penalty when presplit conditions met | [to be confirmed]
| 5.8.8 | Add `BASE_VIBRATION_BUDGET` and blast constants to `balance.ts` | `src/core/config/balance.ts` | — | [to be confirmed]
| 5.8.9 | Implement `checkVibrationBudget()` — compare to budget, return violation level | `src/core/mining/BlastCalc.ts` | Test: violation levels at correct thresholds | [to be confirmed]
| 5.8.10 | Wire vibration violation into event system (fines + score penalties) | `src/core/events/EventEngine.ts` | Test: $1,000 fine on second offence | [to be confirmed]
| 5.8.11 | Add `blast_preview` console command — prints predicted vibration + back-break | `src/console/commands/mining.ts` | Integration test | [to be confirmed]
| 5.8.12 | Update `drill_plan` console command to accept `inclination`, `bearing`, `role` args | `src/console/commands/mining.ts` | Integration test | [to be confirmed]
| 5.8.13 | Update `charge` console command to accept `deck` argument (deck index) | `src/console/commands/mining.ts` | Integration test | [to be confirmed]
| 5.8.14 | Add i18n keys for vibration warnings and presplit feedback (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve | [to be confirmed]

---

## 6. NavMesh & Pathfinding

### 6.1 Design Goals

Employees and vehicles must navigate the mine surface autonomously, routing around drill holes, buildings, parked vehicles, and the pit edges. As blasts create craters and benches, the navigable surface changes dynamically. Pathfinding must be fast enough for 20+ simultaneous agents at 8× game speed without frame drops.

The implementation uses a **2D navigation grid** derived from the `VoxelGrid` surface, refreshed incrementally after blasts. Full 3D pathfinding is not required — vertical movement is handled via dedicated ramps (see §6.4).

### 6.2 Navigation Grid

The `NavGrid` is a 2D array of `NavCell` entries mirroring the `VoxelGrid`'s X×Z footprint:

```typescript
export type NavCellType =
  | 'walkable'       // Open surface, clear of obstacles
  | 'blocked'        // Building footprint, vehicle parked here, or pit edge
  | 'drill_hole'     // Active or drilled hole — agents avoid stepping in
  | 'ramp'           // Slope connecting bench levels, walkable with speed penalty
  | 'void';          // No solid voxel below — not accessible

export interface NavCell {
  type: NavCellType;
  /** Movement cost multiplier (1.0 = normal, >1.0 = slower). */
  moveCost: number;
  /** Bench level index (0 = surface, 1 = first bench below, etc.). */
  benchLevel: number;
  /** Whether a vehicle occupies this cell this tick. Updated every tick. */
  vehicleOccupied: boolean;
}
```

**Derivation rules (run once on world gen; patched after blasts):**
1. A cell is `void` if the voxel directly below the surface at that column is air [to be confirmed]
2. A cell is `drill_hole` if a `DrillHole` exists at that (x, z) coordinate [to be confirmed]
3. A cell is `blocked` if a building footprint covers it, or a parked/stationary vehicle occupies it [to be confirmed]
4. A cell is `ramp` if the surface height delta between it and at least one neighbor exceeds 1 voxel unit (placed by the player or auto-detected after terrain subtraction) [to be confirmed]
5. All remaining solid-surface cells are `walkable` [to be confirmed]

Move costs:
| Cell Type | Cost | [to be confirmed]
|-----------|------|
| `walkable` | 1.0 | [to be confirmed]
| `ramp` | 1.8 | [to be confirmed]
| `drill_hole` | 5.0 (passable but discouraged) | [to be confirmed]
| `blocked` / `void` | ∞ (impassable) | [to be confirmed]

### 6.3 A\* Pathfinding

Pathfinding uses **A\* with 8-directional movement** (cardinal + diagonal). Diagonal moves cost √2 × `moveCost`.

```typescript
export interface PathRequest {
  agentId: number;
  /** Source cell in NavGrid coordinates. */
  fromX: number;
  fromZ: number;
  /** Destination cell. */
  toX: number;
  toZ: number;
  /** If true, do not cross cells occupied by vehicles. */
  avoidVehicles: boolean;
}

export interface PathResult {
  found: boolean;
  /** Ordered list of (x, z) waypoints including start and end. */
  waypoints: Array<{ x: number; z: number }>;
  /** Total movement cost (sum of moveCosts along path). */
  totalCost: number;
}
```

Heuristic: **octile distance** (standard for 8-directional grids):
```
h(a, b) = max(|dx|, |dz|) + (√2 − 1) * min(|dx|, |dz|)
```

**Pathfinding budget:** A\* is capped at **500 explored nodes per request**. If the budget is exceeded, the agent falls back to a **direct line walk** (ignoring non-`blocked`/`void` obstacles) and emits a `pathfinding_budget_exceeded` dev warning.

### 6.4 Ramps & Multi-Level Navigation

The pit descends in bench levels. Employees and vehicles access lower benches via **ramp structures** (placed by the player as buildings, Chapter 1). Ramps appear in the NavGrid as `ramp` cells bridging two bench levels.

Multi-level path planning:
1. Check if start and destination are on the same bench level → run standard A\* [to be confirmed]
2. If on different levels → find the nearest ramp connecting the required levels → route: `start → ramp entrance → ramp exit → destination` (3 sequential A\* queries) [to be confirmed]
3. If no ramp exists connecting the required levels → return `found: false`, emit `no_ramp_available` event [to be confirmed]

**Ramp definition** (added to Building types from Chapter 1):
```typescript
// Added to BuildingType:
'ramp'  // Connects benchLevel N to benchLevel N+1; footprint 1×4 cells, oriented N/S/E/W
```

### 6.5 Dynamic NavGrid Updates

The NavGrid must be **incrementally updated** when the world changes — a full rebuild of a 100×100 grid every tick would be too expensive.

Triggered updates:
| Trigger | Region Updated | [to be confirmed]
|---------|---------------|
| Blast completes | All cells in the blast's AABB + 2-cell margin | [to be confirmed]
| Building placed or demolished | Building footprint cells | [to be confirmed]
| Vehicle parks or departs | Single cell | [to be confirmed]
| Drill hole added | Single cell | [to be confirmed]
| Ramp built | 1×4 footprint + adjacent cells | [to be confirmed]

Each update patches only the affected `NavCell` entries and does **not** invalidate cached paths that do not cross the updated region. Paths that do cross the region are marked stale and re-requested next tick.

### 6.6 Path Following

Agents follow waypoints by moving at most `walkSpeed` cells per tick toward the next waypoint. If the next waypoint becomes `blocked` mid-path (e.g., a vehicle parks there), the agent re-requests a path from current position. After 3 consecutive failed re-requests, the agent enters `stuck` state (idle, morale −2/tick, emits `agent_stuck` event) until the path clears.

### 6.7 Atomic Task Breakdown

| # | Task | File(s) | Test | [to be confirmed]
|---|------|---------|------|
| 6.7.1 | Define `NavCell`, `NavCellType`, `NavGrid` interfaces | `src/core/nav/NavGrid.ts` (new file) | `tests/unit/nav/NavGrid.test.ts` | [to be confirmed]
| 6.7.2 | Implement `buildNavGrid()` — derives NavGrid from VoxelGrid + buildings + holes | `src/core/nav/NavGrid.ts` | Test: blocked cells match building footprints | [to be confirmed]
| 6.7.3 | Implement `patchNavGrid()` — incremental update for a bounding box | `src/core/nav/NavGrid.ts` | Test: patch only affects specified region | [to be confirmed]
| 6.7.4 | Implement A\* `findPath()` with 8-directional movement and octile heuristic | `src/core/nav/Pathfinding.ts` (new file) | Test: correct path length on simple grid; impassable tiles are avoided | [to be confirmed]
| 6.7.5 | Implement node budget cap and direct-line fallback | `src/core/nav/Pathfinding.ts` | Test: falls back when grid is very large and budget is hit | [to be confirmed]
| 6.7.6 | Implement multi-level routing via ramp lookup | `src/core/nav/Pathfinding.ts` | Test: 3-segment path when ramp present; `found: false` when no ramp | [to be confirmed]
| 6.7.7 | Implement `advanceAgent()` — move agent 1 step along waypoints per tick | `src/core/nav/AgentMovement.ts` (new file) | Test: agent reaches destination in expected ticks | [to be confirmed]
| 6.7.8 | Implement stale-path detection and re-request on obstacle change | `src/core/nav/AgentMovement.ts` | Test: path re-requested when cell blocked mid-route | [to be confirmed]
| 6.7.9 | Implement `stuck` state and `agent_stuck` event | `src/core/nav/AgentMovement.ts` | Test: stuck state after 3 failed re-requests | [to be confirmed]
| 6.7.10 | Integrate NavGrid build into `GameState` initialization | `src/core/state/GameState.ts` | Smoke test: GameState serializes NavGrid | [to be confirmed]
| 6.7.11 | Wire NavGrid patch calls into blast pipeline and building placement | `src/core/engine/GameLoop.ts` | Test: NavGrid reflects new hole after drill | [to be confirmed]
| 6.7.12 | Add i18n keys for pathfinding events (`agent_stuck`, `no_ramp_available`) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve | [to be confirmed]

---

## 7. Employee Needs (Eating, Sleeping, Breaks)

### 7.1 Design Goals

Employees have three biological needs — **hunger**, **fatigue**, and **break pressure** — modelled as gauges that fill over time and must be satisfied by visiting appropriate buildings. Unmet needs drain morale, reduce effectiveness, and eventually cause the employee to collapse (forced rest). Satisfying needs promptly is the player's main micro-management loop during long mining sessions.

This chapter connects directly to the Buildings system (Chapter 1 — canteen, bunkhouse, break room) and the Task Queue system (Chapter 3 — `rest` task type).

### 7.2 Need Gauges

Each employee has three need gauges (0–100; 100 = fully satisfied):

| Gauge | Name | Fills at | Drains at | Collapse Threshold | [to be confirmed]
|-------|------|----------|------------|-------------------|
| `hunger` | Hunger | Eating at Canteen | −1/tick while working | ≤ 10 | [to be confirmed]
| `fatigue` | Fatigue | Sleeping at Bunkhouse | −0.5/tick (awake) / −2/tick (active task) | ≤ 5 | [to be confirmed]
| `breakNeed` | Break Pressure | Taking break at Break Room | −0.8/tick while working | ≤ 15 | [to be confirmed]

**Rate modifiers:**
- Active task (non-`rest`) drains gauges at the "active task" rate [to be confirmed]
- Idle state drains at the normal "awake" rate [to be confirmed]
- High morale (>70): drain rate ×0.85 (happy workers last longer) [to be confirmed]
- Low morale (<30): drain rate ×1.20 (miserable workers tire faster) [to be confirmed]

### 7.3 Morale Effects of Needs

Needs affect morale at the end of each tick via the `needsMoraleEffect()` function:

```
moraleEffect = Σ_need [ needPenalty(gaugeValue) ]

needPenalty(g):
  if g >= 50: 0          // Comfortable — no effect
  if g >= 30: −0.5/tick  // Uncomfortable — slow drain
  if g >= 15: −1.5/tick  // Suffering
  if g <  15: −3.0/tick  // Critical — approaching collapse
```

Conversely, all needs above 80 simultaneously grants a **"well-rested" bonus**: +1 morale/tick (max bonus capped at 100).

### 7.4 Collapse

When any gauge hits its collapse threshold:

1. The employee's current task is immediately interrupted (pushed back to front of queue) [to be confirmed]
2. A `rest` task is prepended with `taskType = 'rest'`, targeting the nearest available building of the correct type [to be confirmed]
3. The employee is flagged `collapsing: true` — effectiveness drops to 0 until the `rest` task completes [to be confirmed]
4. On completion of the `rest` task, `collapsing` is cleared and the interrupted task resumes [to be confirmed]

| Collapse Gauge | Rest Building | Rest Duration (ticks) | [to be confirmed]
|---------------|--------------|----------------------|
| `hunger` | Canteen | 2 | [to be confirmed]
| `fatigue` | Bunkhouse | 8 | [to be confirmed]
| `breakNeed` | Break Room | 3 | [to be confirmed]

If no suitable building exists within 20 cells, the employee collapses in place: `collapsing: true`, the `rest` task uses the employee's current position, and duration is doubled (miserable ground-rest).

### 7.5 Need Replenishment Rates

Each building tier refills gauges at different speeds:

| Building | Tier 1 | Tier 2 | Tier 3 | [to be confirmed]
|---------|--------|--------|--------|
| Canteen | +12 hunger/tick | +18 hunger/tick | +25 hunger/tick | [to be confirmed]
| Bunkhouse | +8 fatigue/tick | +14 fatigue/tick | +20 fatigue/tick | [to be confirmed]
| Break Room | +10 breakNeed/tick | +16 breakNeed/tick | +22 breakNeed/tick | [to be confirmed]

Buildings have finite capacity (from Chapter 1). If a building is full, the employee must wait (`await_vehicle`-style queue at building entrance) or route to the next nearest. Waiting in queue slowly drains gauges at the normal awake rate.

### 7.6 Proactive Need Queuing

Employees don't wait until collapse — the game automatically **inserts need-satisfaction tasks** into the queue when a gauge falls below the warning threshold:

| Gauge | Warning Threshold | Auto-Insert Behaviour | [to be confirmed]
|-------|------------------|----------------------|
| `hunger` | 35 | Insert `rest(canteen)` after current task if not already queued | [to be confirmed]
| `fatigue` | 25 | Insert `rest(bunkhouse)` after current task if not already queued | [to be confirmed]
| `breakNeed` | 30 | Insert `rest(break_room)` after current task if not already queued | [to be confirmed]

If the queue is full (capacity exceeded), auto-insert is skipped but a `need_warning` event is emitted so the player can manually intervene. The Manager "Morale Booster" specialization (Chapter 3) slows drain rates by ×0.9 for all nearby employees.

### 7.7 Cost of Needs

Each visit to a building consumes resources:

| Building | Cost per Visit | [to be confirmed]
|---------|---------------|
| Canteen | $10 per employee (food cost) | [to be confirmed]
| Bunkhouse | $0 (included in salary — staying costs nothing) | [to be confirmed]
| Break Room | $5 per employee (coffee, snacks) | [to be confirmed]

Canteen food costs scale with tier: Tier 1 × $10, Tier 2 × $8 (bulk purchasing), Tier 3 × $6 (optimized supply chain).

### 7.8 Shift System (Optional Layer)

If the player builds a **Bunkhouse Tier 2+**, an 8-tick shift cycle activates: employees work for 6 ticks, then automatically enter an 8-tick sleep rest at the bunkhouse. Shift boundaries trigger an `employee_shift_change` event. Without a Bunkhouse, employees remain awake indefinitely (fatigue accumulates faster).

### 7.9 Atomic Task Breakdown

| # | Task | File(s) | Test | [to be confirmed]
|---|------|---------|------|
| 7.9.1 | Add `hunger`, `fatigue`, `breakNeed`, `collapsing` fields to `Employee` interface | `src/core/entities/Employee.ts` | Test: new fields initialized on hire | [to be confirmed]
| 7.9.2 | Add `NEED_DRAIN_RATES`, `NEED_WARNING_THRESHOLDS`, `NEED_COLLAPSE_THRESHOLDS` to `balance.ts` | `src/core/config/balance.ts` | — | [to be confirmed]
| 7.9.3 | Implement `tickNeedGauges()` — drain gauges based on task state + morale modifier | `src/core/entities/Employee.ts` | Test: drain rates match table; active task drains faster | [to be confirmed]
| 7.9.4 | Implement `needsMoraleEffect()` — compute tick-level morale delta from all gauges | `src/core/entities/Employee.ts` | Test: zero effect above 50; −3/tick at critical | [to be confirmed]
| 7.9.5 | Implement `replenishNeed()` — fill gauge at building tier rate, enforce capacity | `src/core/entities/Employee.ts` | Test: gauge fills at correct rate per tier | [to be confirmed]
| 7.9.6 | Implement `checkCollapse()` — interrupt task queue, prepend `rest` task | `src/core/entities/Employee.ts` | Test: interrupted task re-queued; `collapsing` flag set | [to be confirmed]
| 7.9.7 | Implement `autoInsertNeedTasks()` — proactive queue insertion at warning thresholds | `src/core/entities/Employee.ts` | Test: `rest` inserted after current task; skipped if queue full | [to be confirmed]
| 7.9.8 | Deduct per-visit food/break costs from cash balance | `src/core/engine/GameLoop.ts` | Test: canteen visit deducts $10; tier 3 deducts $6 | [to be confirmed]
| 7.9.9 | Implement shift cycle for Bunkhouse Tier 2+ | `src/core/engine/GameLoop.ts` | Test: shift cycle fires at tick 6; sleep rest queued | [to be confirmed]
| 7.9.10 | Wire all need events into event system (`need_warning`, `employee_collapsed`, `employee_shift_change`) | `src/core/events/EventSystem.ts` | Test: events fire at correct gauge levels | [to be confirmed]
| 7.9.11 | Add i18n keys for all need events and building-full message (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve | [to be confirmed]
| 7.9.12 | Add `needs` console command — print all employees' gauge values | `src/console/commands/entities.ts` | Integration test | [to be confirmed]

---

## 8. Testing Strategy

### 8.1 Overview

BlastSimulator2026 uses a three-layer test pyramid:

1. **Unit tests** — Pure functions in `src/core/`. Fast, no I/O, seeded PRNG. Run with `npm run test`. [to be confirmed]
2. **Integration tests** — Console command sequences that exercise multiple systems together. Run with `npm run test`. [to be confirmed]
3. **Scenario tests** — Full browser sessions driven by Puppeteer. Screenshots + JSON state dumps after every command. Run with the scenario-test script. [to be confirmed]

All three layers must pass before any PR is merged. The `npm run validate` command runs TypeScript type-checking, unit + integration tests, and a production build in sequence.

### 8.2 Unit Test Conventions

Unit tests live in `tests/unit/` mirroring the source tree. Every exported pure function in `src/core/` must have at least one positive test and one edge-case test. Test files use `vitest` (`describe`/`it`/`expect`). Fixtures use `Random` with a fixed seed (conventionally `seed: 42`).

**Naming convention:** `<Module>.test.ts` in the same directory path as the source. E.g. `src/core/nav/Pathfinding.ts` → `tests/unit/nav/Pathfinding.test.ts`.

**Coverage targets (per chapter):**

| Chapter | Minimum Line Coverage | [to be confirmed]
|---------|----------------------|
| 1 — Buildings | 90% | [to be confirmed]
| 2 — Vehicles | 85% | [to be confirmed]
| 3 — Employee Skills | 90% | [to be confirmed]
| 4 — Survey System | 90% | [to be confirmed]
| 5 — Blast Enhancements | 95% | [to be confirmed]
| 6 — NavMesh | 85% | [to be confirmed]
| 7 — Employee Needs | 90% | [to be confirmed]

### 8.3 Integration Test Conventions

Integration tests live in `tests/integration/`. They use the same `vitest` runner but are allowed to import from `src/console/` (the command layer) and must exercise at least one full round-trip through the game loop. No DOM, no Three.js.

Required integration test suites per chapter:

| Chapter | Test Suite | Key Assertions | [to be confirmed]
|---------|-----------|---------------|
| 1 | `buildings.integration.test.ts` | Place + upgrade building; demolish; placement failure on invalid terrain | [to be confirmed]
| 2 | `vehicles.integration.test.ts` | Purchase → assign driver → move → refuel cycle | [to be confirmed]
| 3 | `skills.integration.test.ts` | 700 XP triggers Legend; specialization chosen and applied | [to be confirmed]
| 4 | `survey.integration.test.ts` | Full survey → blast → ore report comparison | [to be confirmed]
| 5 | `blast-enhanced.integration.test.ts` | Deck charge > single-deck; presplit eliminates back-break | [to be confirmed]
| 6 | `navmesh.integration.test.ts` | Agent routes around building; multi-level ramp path | [to be confirmed]
| 7 | `needs.integration.test.ts` | Collapse triggers rest task; shift cycle fires on schedule | [to be confirmed]

### 8.4 Scenario Test Definitions

Scenario tests are defined in `scripts/scenario-defs/` as JSON files. Each scenario lists console commands; the test runner captures a screenshot and state JSON after each. New scenarios required for these chapters:

| Scenario File | Purpose | Win Condition | [to be confirmed]
|--------------|---------|---------------|
| `survey-then-blast.json` | Run seismic survey, inspect estimates, blast, check ore report | Lucky Strike event fires if yield > 120% estimate | [to be confirmed]
| `skill-progression.json` | Hire driller, run 700 ticks of work, verify Legend level | `employee.skillLevel === 5` in state JSON | [to be confirmed]
| `multi-deck-blast.json` | Place 3-deck charge, blast, verify energy field depth profile | No over-blast projection at surface; deep voxels fractured | [to be confirmed]
| `presplit-wall.json` | Drill presplit row + production holes, verify zero back-break | `backBreakPenalty === 0` in blast result | [to be confirmed]
| `needs-cycle.json` | Hire 3 workers, fast-forward 20 ticks, verify canteen visit auto-queued | `employee.hunger > 30` after visit | [to be confirmed]
| `ramp-navigation.json` | Build ramp, assign worker to task on lower bench | Agent reaches destination; no `agent_stuck` event | [to be confirmed]
| `vibration-budget.json` | Fire blast exceeding vibration budget 3 times | Third blast halted; $5,000 fine deducted | [to be confirmed]

### 8.5 Regression Test Policy

Any bug fix must be accompanied by a new unit or integration test that would have caught the bug. The test must fail on the buggy code and pass on the fix. This is enforced via PR review checklist.

### 8.6 Test-Driven Workflow for New Features

For each atomic task in chapters 1–7:

1. Write the test first (red) [to be confirmed]
2. Implement the minimum code to pass (green) [to be confirmed]
3. Refactor for clarity if needed (refactor) [to be confirmed]
4. Run `npm run validate` to confirm no regressions [to be confirmed]
5. For visual changes: run the relevant scenario test and inspect screenshots [to be confirmed]

### 8.7 Performance Benchmarks

The following benchmarks must pass as part of CI (failing marks the build as yellow, not red):

| Benchmark | Target | Measurement | [to be confirmed]
|-----------|--------|------------|
| A\* path on 100×100 grid | < 2ms per request | `performance.now()` in unit test | [to be confirmed]
| Full blast pipeline (500 voxels) | < 50ms | Unit test timing | [to be confirmed]
| NavGrid full rebuild (100×100) | < 10ms | Unit test timing | [to be confirmed]
| Frame tick at 8× speed, 20 agents | < 16ms | Integration test timing | [to be confirmed]
| Survey estimation (radius 20) | < 5ms | Unit test timing | [to be confirmed]

### 8.8 Atomic Task Breakdown

| # | Task | File(s) | Test | [to be confirmed]
|---|------|---------|------|
| 8.8.1 | Add coverage reporter to `vitest.config.ts` (v8 provider, per-file thresholds) | `vitest.config.ts` | CI: coverage gate fails under threshold | [to be confirmed]
| 8.8.2 | Create `tests/integration/` directory and add to test runner config | `vitest.config.ts`, `package.json` | Smoke: integration runner picks up test files | [to be confirmed]
| 8.8.3 | Add 7 integration test suites (one per chapter) | `tests/integration/` | Each suite passes | [to be confirmed]
| 8.8.4 | Add 7 scenario JSON files to `scripts/scenario-defs/` | `scripts/scenario-defs/` | Scenario runner executes all without crash | [to be confirmed]
| 8.8.5 | Add performance benchmark suite | `tests/unit/benchmarks/` | Benchmarks log timing; thresholds enforced | [to be confirmed]
| 8.8.6 | Add `npm run test:integration` and `npm run test:scenarios` scripts | `package.json` | Each script runs in isolation | [to be confirmed]
| 8.8.7 | Update `npm run validate` to include integration tests | `package.json` | `npm run validate` exits 0 on clean repo | [to be confirmed]
| 8.8.8 | Document test conventions in `README.md` under a "Testing" section | `README.md` | — | [to be confirmed]
