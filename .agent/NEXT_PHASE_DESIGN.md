# BlastSimulator2026 — Next Phase Design Document

This document specifies the next wave of gameplay systems to implement. Each chapter is self-contained and includes data definitions, algorithms, and an atomic task breakdown for implementation.

**Chapters:**

1. [Buildings System](#1-buildings-system)
2. [Vehicle Fleet (Types, Routing & Drivers)](#2-vehicle-fleet)
3. [Employee Skills & Task Queue](#3-employee-skills--task-queue)
4. [Rock Composition & Survey System](#4-rock-composition--survey-system)
5. [Blast Algorithm — Full Pipeline](#5-blast-algorithm--full-pipeline)
6. [NavMesh & Pathfinding](#6-navmesh--pathfinding)
7. [Employee Needs (Eating, Sleeping, Breaks)](#7-employee-needs)
8. [Testing Strategy](#8-testing-strategy)

---

## 1. Buildings System

### 1.1 Design Philosophy

Buildings are the player's infrastructure layer. They gate actions behind qualified employees and physical capacity. Key principles:

- **Every action requires a qualified employee.** If no qualified employee (or required vehicle) is available, the game emits an error message immediately instead of queuing an impossible task.
- **Training buildings** allow the player to upskill existing employees in exchange for time (employee unavailable, still paid) and a direct training fee. This makes hiring pre-qualified staff generally more cost-efficient.
- **Research Center** is the prerequisite for unlocking higher tiers of all other buildings. Each tier upgrade is a separate paid research task.
- **Placement tradeoff:** Buildings placed far from the blast area reduce projection damage risk but increase employee and vehicle travel time, directly reducing productivity (especially critical for warehouses).

### 1.2 Building Types & Tier Names

All tier names are fictional and humorous. Localized via i18n (`en.json` + `fr.json`).

| Building | Tier 1 | Tier 2 | Tier 3 | Purpose |
|----------|--------|--------|--------|---------|
| Driving Center | "Learner's Lot" | "Wheel Academy" | "Turbo Campus" | Trains employees to operate a specific vehicle type |
| Blasting Academy | "Boom Shack" | "Detonation Den" | "The Kaboom Institute" | Trains employees in explosives handling and blast sequencing |
| Management Office | "The Cupboard" | "Bureaucracy Box" | "Corner Office Supreme" | Trains employees in HR and commercial operations |
| Geology Lab | "Rock Shed" | "Stone Science HQ" | "Institute of Expensive Rocks" | Trains employees in survey and rock analysis |
| Research Center | "Think Tank Tent" | "Innovation Bunker" | "The Ivory Crater" | Unlocks higher tiers of all other buildings (paid research tasks) |
| Living Quarters | "The Cells" | "Staff Dormitory" | "Unnecessarily Luxurious Hotel" | Houses and feeds employees; grade directly affects well-being → productivity |
| Explosive Warehouse | "Boom Closet" | "Blast Vault" | "Fort Kaboom" | Stores explosives ordered via supply contracts |
| Freight Warehouse | "The Pile" | "Stuff Bunker" | "Hoarder's Paradise" | Stores rock debris containing ore; primary income source via sale contracts |
| Vehicle Depot | "Rusty Garage" | "Grease Palace" | "Mecha Hangar" | Parks and maintains vehicles; required for vehicle repairs |

### 1.3 Tier System

Each building has multiple tiers. Tier 1 is available from the start. Higher tiers are unlocked by completing paid research tasks at the **Research Center**:

- Each research task occupies the Research Center for a fixed duration and costs money.
- Higher tiers provide larger capacity, better performance for the building's specific function, and a **larger physical footprint**.
- When upgrading, the player typically demolishes the old building and constructs the new tier on the same (or adjacent) cleared ground.
- Both construction and demolition carry a cost.

### 1.4 Training Buildings

One training building per employee skill category. Rules shared across all training buildings:

- The employee travels to the building and remains there for a fixed number of ticks.
- During training the employee is unavailable for other tasks and continues to receive their salary.
- The training itself costs a direct fee (materials, equipment wear).
- **Incentive:** hiring employees who are already qualified for a task is cheaper than training generalists, so the player must weigh hiring cost against training investment.

| Building | Skill Granted | Notes |
|----------|--------------|-------|
| Driving Center | Vehicle operation — one licence per vehicle type | Each vehicle type (truck, excavator, drill rig, …) requires a separate training course |
| Blasting Academy | Explosives charging and blast sequencing | Required before an employee can charge holes or set delay sequences |
| Management Office | HR and commercial operations | Required for contract negotiation, employee hiring and firing |
| Geology Lab | Survey techniques and rock analysis | Required to perform seismic, core-sample or aerial surveys |

### 1.5 Living Quarters (Multi-Grade)

A single building type with multiple tier grades, each representing a different quality of accommodation and catering. Grade directly affects employee **well-being**, which affects **productivity**.

| Tier | Description | Well-being Effect |
|------|------------|------------------|
| 1 | "Cells" — bare prison-like accommodation | Baseline (penalty if below this) |
| 2 | "Dormitory" — basic shared rooms with cafeteria | Moderate well-being bonus |
| 3 | "Unnecessarily Luxurious Hotel" | Large well-being bonus |

- Construction cost and maintenance cost increase with tier.
- The well-being multiplier applies to all employees whose assigned quarters are at that tier.
- If capacity is exceeded (more employees than beds), all residents suffer a well-being penalty.

### 1.6 Warehouses

**Explosive Warehouse**
- Stores explosives received from supply contracts.
- Required to order and receive explosive deliveries; blasting is impossible without it.
- Capacity (kg of explosives) scales with tier.
- If destroyed by a blast projection while containing explosives, a **secondary blast event** is triggered.

**Freight Warehouse**
- Stores rock debris containing ore, hauled from the blast zone by vehicles.
- Ore is sold via contracts — this is the player's **primary source of income**.
- Capacity (tonnes of material) scales with tier.
- The farther the warehouse is from the pit, the longer each haulage trip takes, reducing throughput.

### 1.7 Placement Rules

1. **Fixed footprint:** Each building type and tier has a fixed cell pattern (e.g. 2×2 square, 3×1 strip, L-shape). Higher tiers have larger footprints.
2. **Flat surface required:** Every cell in the footprint must lie at the same surface height. Placement on slopes or uneven ground is rejected.
3. **Protected voxels:** Voxels directly beneath a building footprint cannot be dug or blasted. Any attempt to do so is blocked with an error.
4. **Blast destruction:** If a blast reaches voxels beneath a building (e.g. due to an incorrectly aimed shot), the building is destroyed instantly.
5. **No overlap:** Buildings cannot overlap each other.

### 1.8 Destruction Effects

- A building destroyed by a blast is removed from the grid immediately.
- Employees inside at the time of destruction are injured.
- Stored contents (explosives, ore) are lost; an Explosive Warehouse detonation triggers a secondary blast.
- Well-being, Safety and Ecology score penalties are applied on destruction.

### 1.9 Building Effects Summary

| Building | Primary Effect | Secondary Effect |
|----------|---------------|-----------------|
| Living Quarters (Tier 1) | Employee housing and feeding | Baseline well-being (penalty if absent) |
| Living Quarters (Tier 3) | Employee housing and feeding | High well-being → high productivity multiplier |
| Explosive Warehouse | Enables explosive supply contracts | Secondary blast if destroyed with stock |
| Freight Warehouse | Enables ore sale contracts | Main income source; throughput limited by distance |
| Vehicle Depot | Vehicle parking and maintenance | Required for vehicle repairs |
| Research Center | Unlocks building tier upgrades | Occupied during each research task |
| Training Buildings | Grants skill qualifications to employees | Reduces unqualified-task errors |

### 1.10 Atomic Task Breakdown

| # | Task | File(s) | Test |
|---|------|---------|------|
| 1.1 | Define `BuildingType` union with all 9 building types | `src/core/entities/Building.ts` | `tests/unit/entities/Building.test.ts` |
| 1.2 | Define `BuildingTier`, per-type footprint patterns, and `BUILDING_DEFS` catalog | `src/core/entities/Building.ts` | Test: every type has correct footprint per tier; costs increase per tier |
| 1.3 | Implement `canPlaceBuilding()` — flat surface check + overlap check | `src/core/entities/Building.ts` | Test: rejects sloped terrain; rejects overlapping footprints |
| 1.4 | Implement protected-voxel check — block drill/blast under building footprint | `src/core/mining/DrillPlan.ts` | Test: drill command rejected when target cell is under a building |
| 1.5 | Implement building destruction on blast — check footprint overlap with blast AABB | `src/core/mining/BlastCalc.ts` | Test: building destroyed when voxel underneath is within blast zone |
| 1.6 | Implement Explosive Warehouse secondary blast on destruction | `src/core/mining/BlastCalc.ts` | Test: secondary blast event fires when warehouse destroyed with stock |
| 1.7 | Implement Research Center task queue — paid tasks unlock building tiers | `src/core/entities/Building.ts` | Test: tier locked before research completes; unlocked after |
| 1.8 | Implement training task in training buildings — time cost + fee + skill grant | `src/core/entities/Building.ts`, `src/core/entities/Employee.ts` | Test: employee gains skill qualification after required training ticks |
| 1.9 | Implement qualified-employee check — emit error on unqualified task assignment | `src/core/engine/GameLoop.ts` | Test: error event emitted; task not queued when no qualified employee available |
| 1.10 | Implement Living Quarters well-being multiplier per tier | `src/core/entities/Building.ts`, `src/core/scores/` | Test: productivity multiplier matches tier; overcapacity triggers penalty |
| 1.11 | Implement Freight Warehouse ore storage and contract sell interface | `src/core/entities/Building.ts` | Test: ore stored on haul arrival; contract triggers revenue deduction |
| 1.12 | Add i18n keys for all 9 building types, all tier names, training course names (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve |
| 1.13 | Wire `build`, `demolish`, and `research` console commands | `src/console/commands/entities.ts` | Integration test |
| 1.14 | Update building renderer — footprint pattern shape and tier visuals | `src/renderer/BuildingMesh.ts` | Visual test |

---

## 2. Vehicle Fleet

### 2.1 Design Philosophy

Vehicles are the player's operational muscle. They execute physical work that employees cannot do on foot. Key constraints:

- Every vehicle needs a **qualified driver** — an employee who has passed the appropriate course at the Driving Center for that specific vehicle type. An uncrewed or unqualified vehicle cannot be assigned any task.
- Vehicles have a **position** on the navmesh and move at a defined **speed** (cells/tick).
- All vehicles share the **navmesh** with on-foot employees (Chapter 6). The navmesh is dynamically updated after every blast (rock debris, new craters, collapsed terrain, new/destroyed buildings all reshape it).
- Vehicles cannot occupy the same cell. This creates realistic **traffic congestion** — poorly laid out ramps, clustered warehouses, or neglected debris clearance will cause queuing and lost productivity. The player must think about ramp placement, haulage routes, and debris clearance as active management decisions.

### 2.2 Vehicle Types & Tier Names

Five vehicle types, each with 3 tiers and humorous names. All localized via i18n (`en.json` + `fr.json`).

| Role | Tier 1 | Tier 2 | Tier 3 | Function |
|------|--------|--------|--------|---------|
| **Building Destroyer** | "Wrecking Rascal" | "Demolition Darling" | "Obliterator Supreme" | Demolishes buildings quickly; required for tier-upgrade workflow |
| **Debris Hauler** | "Dumpster on Wheels" | "Haul-o-Matic 3000" | "Mega Mover XL" | Transports fragmented rock from the blast zone to the Freight Warehouse |
| **Drill Rig** | "Pokey McPoke" | "Bore Master" | "Helldriller" | Drills blast holes to a specified depth and angle |
| **Rock Digger** | "The Scratch" | "Scoop Sergeant" | "Voxel Vanquisher" | Digs one voxel at a time — slow and expensive compared to blasting, but precise; used for ramp shaping, access route creation, and post-blast polish |
| **Rock Fragmenter** | "Cracky" | "Smasher 2000" | "The Atomizer" | Breaks oversized debris boulders into transportable fragments |

### 2.3 Vehicle Stats by Tier

Each tier multiplies the base stats of its type:

| Stat | Tier 1 (×) | Tier 2 (×) | Tier 3 (×) |
|------|-----------|-----------|-----------|
| `speed` | 1.0 | 1.3 | 1.8 |
| `capacity` | 1.0 | 1.6 | 2.5 |
| `workRate` | 1.0 | 1.4 | 2.0 |
| `maxHp` | 1.0 | 1.5 | 2.2 |
| `purchaseCost` | 1.0 | 2.0 | 4.0 |
| `maintenanceCostPerTick` | 1.0 | 1.4 | 2.0 |

### 2.4 Vehicle Data Schema

```typescript
export type VehicleRole =
  | 'building_destroyer'
  | 'debris_hauler'
  | 'drill_rig'
  | 'rock_digger'
  | 'rock_fragmenter';

export type VehicleTier = 1 | 2 | 3;

export interface VehicleDef {
  role: VehicleRole;
  tier: VehicleTier;
  /** i18n key for tier name, e.g. 'vehicle.debris_hauler.tier1' → "Dumpster on Wheels" */
  nameKey: string;
  purchaseCost: number;
  maintenanceCostPerTick: number;
  speed: number;         // cells/tick
  capacity: number;      // kg for hauler, m³ for digger, etc.
  workRate: number;      // voxels/tick, kg/tick, etc. (role-specific interpretation)
  maxHp: number;
}

export interface Vehicle {
  id: number;
  role: VehicleRole;
  tier: VehicleTier;
  /** Current position in grid coordinates. */
  x: number;
  z: number;
  hp: number;
  /** Employee ID of assigned driver, or null if uncrewed. */
  driverId: number | null;
  state: VehicleState;
  /** Current destination (null when idle or working in place). */
  targetX: number | null;
  targetZ: number | null;
  /** Payload currently carried (kg), for debris_hauler. */
  payloadKg: number;
}

export type VehicleState =
  | 'idle'        // parked, no task
  | 'moving'      // travelling to target cell
  | 'working'     // actively drilling, digging, hauling, demolishing, or fragmenting
  | 'waiting'     // blocked by traffic, waiting for cell to free
  | 'broken';     // requires repair at Vehicle Depot
```

### 2.5 Driver Qualification

- Each vehicle role requires a distinct driving licence obtained at the **Driving Center**.
- An employee without the licence for a given role cannot be assigned to that vehicle.
- One driver per vehicle; one vehicle per driver at a time.
- If a driver is injured or leaves, the vehicle becomes idle until a qualified replacement is assigned.

### 2.6 Traffic & Routing

Vehicles use the shared navmesh (Chapter 6) with A\* pathfinding. Congestion is intentional and gameplay-relevant:

- Vehicles cannot share a cell. A blocked vehicle enters `'waiting'` state and retries each tick.
- Long waiting chains (≥ 3 vehicles queued on a single path for ≥ 10 ticks) emit a `TrafficJamEvent` that is surfaced to the player as an alert.
- **Player solutions:** widen ramps, build parallel haulage routes, relocate the Freight Warehouse closer to the pit, clear debris faster with Rock Fragmenters before hauling.
- Rock debris deposited after a blast immediately marks those cells as blocked on the navmesh until cleared.
- A destroyed building collapses into a debris cell that blocks the navmesh until removed by a Rock Digger or Building Destroyer.

### 2.7 Vehicle Tasks

| Task | Applicable Roles | Description |
|------|-----------------|-------------|
| `move_to` | All | Travel to target cell via navmesh |
| `haul` | Debris Hauler | Pick up fragmented rock at source, carry to Freight Warehouse |
| `drill_hole` | Drill Rig | Drill a hole at target x,z to specified depth and angle |
| `dig_voxel` | Rock Digger | Remove one voxel at target position |
| `fragment` | Rock Fragmenter | Break an oversized boulder at target cell into smaller fragments |
| `demolish` | Building Destroyer | Demolish the building occupying target footprint |
| `wait` | All | Blocked by traffic; retries movement each tick |

### 2.8 Atomic Task Breakdown

| # | Task | File(s) | Test |
|---|------|---------|------|
| 2.1 | Define `VehicleRole` union and rename existing `VehicleType` → `VehicleRole` | `src/core/entities/Vehicle.ts` | `tests/unit/entities/Vehicle.test.ts` |
| 2.2 | Define `VehicleTier`, `VehicleDef`, and `VehicleState` types | `src/core/entities/Vehicle.ts` | Test: schema completeness |
| 2.3 | Create `VEHICLE_DEFS` catalog (5 roles × 3 tiers, 15 entries) with tier multipliers | `src/core/entities/Vehicle.ts` | Test: every role has 3 tiers; stats scale correctly |
| 2.4 | Add i18n keys for all 15 vehicle tier names (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve |
| 2.5 | Add `driverId`, `state`, `payloadKg`, `targetX/Z` fields to `Vehicle` interface | `src/core/entities/Vehicle.ts` | Test: defaults on purchase |
| 2.6 | Implement `assignDriver()` — validates employee has licence for this role | `src/core/entities/Vehicle.ts` | Test: unqualified employee rejected |
| 2.7 | Implement `tickVehicle()` — advances movement along navmesh path, handles `waiting` state on cell collision | `src/core/engine/GameLoop.ts` | Test: two vehicles converging on same cell — one enters waiting |
| 2.8 | Implement `TrafficJamEvent` — fires when ≥ 3 vehicles waiting on same path ≥ 10 ticks | `src/core/events/EventEngine.ts` | Test: event fires at correct threshold |
| 2.9 | Implement `demolishBuilding()` task — removes building from grid, updates navmesh | `src/core/entities/Building.ts` | Test: footprint cells freed after demolition |
| 2.10 | Implement `digVoxel()` task for Rock Digger — removes single voxel, updates surface + navmesh | `src/core/mining/DrillPlan.ts` | Test: voxel removed; navmesh updated |
| 2.11 | Implement `fragmentBoulder()` task — converts oversized debris to transportable fragments | `src/core/mining/BlastCalc.ts` | Test: oversized debris flagged; becomes transportable after fragmenting |
| 2.12 | Wire vehicle purchase, assign-driver, and task dispatch into console commands | `src/console/commands/entities.ts` | Integration test |
| 2.13 | Update vehicle renderer — role-specific mesh, tier color/scale variation | `src/renderer/VehicleMesh.ts` | Visual test |

---

## 3. Employee Skills & Task Queue

### 3.1 Design Philosophy

Employees are not interchangeable tokens. Each one has a set of **skill qualifications**, each with a proficiency level. They autonomously execute queued work, consume resources (food, sleep), and can be a bottleneck or an asset depending on how the player manages their roster, schedules, and training.

Key principles:

- **Every physical action is queued, not instant.** When the player issues a command (drill a hole, charge a hole, place a building, …), it is added to a global pending-action pool. A free employee with the required skill automatically claims and executes it.
- **Pending actions show a 3D ghost.** Until an action is started, the game renders a semi-transparent blue version of the result object (same 3D model as the finished version, with a fresnel-effect shader). This makes the player's intent visible and distinguishable from completed work.
- **No qualified employee = immediate error.** If the pending pool contains an action and zero employees with the required skill are free or available (all busy, sleeping, injured…), the game immediately surfaces an error panel rather than silently queuing forever.
- **Some tasks require a vehicle.** Actions like hauling and drilling cannot be performed on foot — the employee must first board a vehicle of the appropriate type.

### 3.2 Skill System

An employee has **0 to N qualifications** (typically 1, occasionally 2). Each qualification belongs to a **skill category** and has a **proficiency level** (1–5). Salary scales with the total number of qualifications and their combined levels — a multi-skilled employee is more expensive.

**Skill categories:**
| Category | Required for | Training building |
|----------|-------------|-------------------|
| `driving.<vehicle_role>` | Operating vehicles of that role | Driving Center |
| `blasting` | Charging holes, setting sequences, monitoring blasts | Blasting Academy |
| `management` | Contract negotiation, hiring/firing, policy setting | Management Office |
| `geology` | Seismic, core-sample, and aerial surveys | Geology Lab |

An employee **tends to be efficient at skills in the same category** (e.g., a blasting specialist is effective at all blasting tasks). They may also hold qualifications outside their core category, but typically at lower proficiency, and only after deliberate training or exceptional hire.

**Proficiency levels and effect:**

| Level | Label | Effect on task duration |
|-------|-------|------------------------|
| 1 | Rookie | ×1.00 (baseline) |
| 2 | Competent | ×0.85 |
| 3 | Skilled | ×0.70 |
| 4 | Expert | ×0.55 |
| 5 | Master | ×0.40 |

Proficiency increases through XP earned by performing the specific task. XP gain per tick of active work:
```
xpPerTick = 1 + floor(currentLevel * 0.5)
```

### 3.3 Task Duration Formula

Duration is calculated at dispatch time:

```
ticksRequired = baseDuration
              / (proficiency_multiplier * wellbeing_multiplier * event_multipliers)
```

**Wellbeing modifiers** stack multiplicatively:

| Condition | Multiplier |
|-----------|-----------|
| Well-fed (ate within last N ticks) | ×1.00 (neutral) |
| Hungry (overdue for a meal) | ×0.80 |
| Starving (severely overdue) | ×0.60 |
| Well-rested | ×1.00 |
| Sleep-deprived | ×0.75 |
| Exhausted | ×0.50 |
| Living Quarters Tier 3 bonus | ×1.10 |
| Living Quarters Tier 1 penalty | ×0.90 |

**Event modifiers** are temporary multipliers injected by the event system (e.g., "Union Happy Hour +20%", "Heatwave −15%"). All active modifiers are listed in the employee detail panel so the player can understand exactly why a task is slow.

### 3.4 Pending-Action Pool & Ghost Preview

The global `pendingActions` array in `GameState` holds all player-issued actions not yet started:

```typescript
export interface PendingAction {
  id: number;
  type: ActionType;
  /** Required skill qualification to claim this action. */
  requiredSkill: SkillQualification;
  /** Required vehicle role, or null if on-foot task. */
  requiredVehicleRole: VehicleRole | null;
  /** Grid position for ghost rendering and employee pathfinding. */
  targetX: number;
  targetZ: number;
  targetY: number;
  payload: Record<string, unknown>;
}

export type ActionType =
  | 'drill_hole'
  | 'charge_hole'
  | 'set_sequence'
  | 'place_building'
  | 'demolish_building'
  | 'survey'
  | 'fragment_debris'
  | 'haul_debris';
```

**Renderer:** For every entry in `pendingActions`, the renderer creates a ghost mesh (same geometry as the finished object) with a blue fresnel-effect translucent material and slight pulsing animation so the player can distinguish pending from complete.

**Claim logic (each tick):**
1. For each unclaimed `PendingAction`, scan idle employees for a match on `requiredSkill`.
2. If a match is found and `requiredVehicleRole` is non-null, also check that a vehicle of that role is available and has a qualified driver (or the employee is the driver).
3. If no match can ever succeed (no employee with the skill exists on the roster at all, regardless of current availability), immediately emit an `UnqualifiedTaskError` event.
4. If a match exists but all qualified employees are temporarily busy (working, eating, sleeping), do not emit an error — keep waiting.

### 3.5 Employee Needs

Employees have four tracked need meters (0–100):

| Need | Depletes when | Restored at | Effect if neglected |
|------|--------------|-------------|---------------------|
| **Hunger** | Always, at 1/tick while working, 0.5/tick idle | Eating at Living Quarters (Tier 1+) | Below 30: productivity ×0.80; below 10: ×0.60, employee refuses tasks |
| **Fatigue** | Working tick, accumulates | Sleeping at Living Quarters (Tier 1+) | Below 40: productivity ×0.75; below 15: ×0.50, employee collapses → forced rest |
| **Social** | Isolation (working alone) | Being near other employees, break room use | Below 20: morale −2/tick; affects well-being score |
| **Comfort** | Always slowly | Living Quarters tier bonus | Below 30: morale −1/tick |

### 3.6 Work & Rest Policies

The player configures a **site policy** that governs the automatic rest behaviour for all employees:

| Policy | Description |
|--------|-------------|
| `shift_8h` | Standard 8-hour work shift, 8-hour rest. Low fatigue accumulation. |
| `shift_12h` | Long shift. Faster output but fatigue builds; requires higher-tier Living Quarters to avoid productivity collapse. |
| `continuous` | No enforced breaks. Maximum output in short term; employees degrade rapidly. Useful for campaign deadline crunch. |
| `custom` | Player sets individual rest thresholds per employee. |

Meals are scheduled automatically based on the hunger meter threshold set in the policy (default: eat when hunger < 40).

Break times (social need) follow the same configurable threshold system.

### 3.7 Employee Detail Panel (UI)

When the player clicks an employee, the detail panel shows:

- Name, portrait, skill qualifications with proficiency stars
- Current task and time remaining
- Task queue (up to 5 pending entries, reorderable by drag)
- Need meters (Hunger, Fatigue, Social, Comfort) with current values
- All active modifiers with name, value, and source (event name / building / policy)
- Salary breakdown per tick
- XP progress bar per qualification

### 3.8 Atomic Task Breakdown

| # | Task | File(s) | Test |
|---|------|---------|------|
| 3.1 | Define `SkillQualification`, `SkillCategory`, proficiency levels on `Employee` | `src/core/entities/Employee.ts` | `tests/unit/entities/Employee.test.ts` |
| 3.2 | Add `PROFICIENCY_MULTIPLIERS` and XP thresholds to `balance.ts` | `src/core/config/balance.ts` | Test: XP → proficiency level transitions |
| 3.3 | Implement `gainXp()` — per-qualification XP, triggers level-up event | `src/core/entities/Employee.ts` | Test: level up at correct threshold |
| 3.4 | Implement salary calculation — base + sum of qualification level bonuses | `src/core/entities/Employee.ts` | Test: multi-skill employee costs more |
| 3.5 | Define `PendingAction`, `ActionType`, and `pendingActions` in `GameState` | `src/core/GameState.ts` | Test: initial state has empty array |
| 3.6 | Implement claim logic in `tickEmployees()` — match pending actions to idle qualified employees | `src/core/engine/GameLoop.ts` | Test: correct employee claims matching action; unmatched action emits error |
| 3.7 | Implement `UnqualifiedTaskError` event — fires when no roster employee has the required skill | `src/core/events/EventEngine.ts` | Test: event fires for truly unqualified; not fired when temporarily busy |
| 3.8 | Implement ghost-preview list in `GameState` (mirrors `pendingActions` for renderer) | `src/core/GameState.ts` | Test: ghost entry added on action dispatch, removed on claim |
| 3.9 | Add ghost mesh rendering in renderer — blue fresnel translucent, pulsing | `src/renderer/GhostMesh.ts` (new file) | Visual test |
| 3.10 | Implement need meters (Hunger, Fatigue, Social, Comfort) on `Employee` | `src/core/entities/Employee.ts` | Test: meters deplete at correct rates; productivity multipliers apply |
| 3.11 | Implement need restoration — employee auto-routes to Living Quarters when threshold crossed | `src/core/engine/GameLoop.ts` | Test: hungry employee claims meal slot; task queue paused during meal |
| 3.12 | Implement `SitePolicy` and policy tick logic — enforces shift/rest scheduling | `src/core/entities/SitePolicy.ts` (new file) | Test: shift_8h policy triggers rest after correct tick count |
| 3.13 | Implement `computeTaskDuration()` — proficiency × wellbeing × event multipliers | `src/core/entities/Employee.ts` | Test: all modifier combinations produce correct duration |
| 3.14 | Add i18n keys for skill categories, proficiency labels, policy names, need labels (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve |
| 3.15 | Wire `hire`, `assign_skill`, `set_policy` console commands | `src/console/commands/entities.ts` | Integration test |

---

## 4. Rock Composition & Survey System

### 4.1 Design Goals

The player should not know exactly what ore is in the ground — discovery should feel rewarding and create strategic decisions. Before blasting, a player can run surveys to estimate rock composition. Surveys cost time and money but reveal ore density maps that help the player choose blast patterns, explosive types, and contract targets.

The existing `VoxelGrid` already stores `oreDensities` per voxel, and `RockCatalog` defines `oreProbabilities`. This chapter adds the **player-visible layer** on top: surveys, reveal mechanics, estimation error, and the "fog of war" for sub-surface composition.

### 4.2 Survey Methods

Three survey tools, each with a different cost/accuracy/coverage tradeoff:

| Method | Tool | i18n Key | Cost ($) | Time (ticks) | Accuracy | Coverage |
|--------|------|---------|---------|-------------|---------|---------|
| Seismic Survey | Detonates a small charge and records reflections | `survey.seismic` | 3,000 | 8 | ±15% ore density | 20-cell radius, full depth |
| Core Sample | Drills a narrow extraction core | `survey.core_sample` | 800 | 4 | ±5% ore density | Single column, full depth |
| Aerial Spectroscopy | Drone scans surface mineral signature | `survey.aerial` | 1,500 | 3 | ±25% ore density | 30-cell radius, surface only (depth 0–2) |

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

1. **Sample true voxel composition** from `VoxelGrid.getVoxel(x, y, z).oreDensities`
2. **Add Gaussian noise** scaled by the method's base error and surveyor skill:
   ```
   estimatedDensity = trueDensity + rng.gaussian(0, baseError * (1 - skillBonus))
   estimatedDensity = clamp(estimatedDensity, 0, 1)
   ```
3. **Round to nearest 0.05** (discrete bands: 0, 5%, 10%... 100%) — players see bands not raw floats
4. For **aerial** surveys: only samples Y = surfaceY and surfaceY−1 (shallow horizon only)
5. For **seismic**: averages estimates over a 3-voxel vertical smear (coarser vertical resolution)

### 4.5 Ore Grade Reporting Post-Blast

After a blast, the game computes the **actual ore yield** from destroyed voxels and reports it as a `BlastOreReport`. This report is compared to the pre-blast survey estimate, and the delta drives feedback events:

| Condition | Event | Effect |
|-----------|-------|--------|
| Actual yield > 120% of estimate | "Lucky Strike" | +$2,000 bonus, ecology −1 |
| Actual yield < 60% of estimate | "Barren Blast" | No bonus, surveyor morale −10 |
| Treranium ore found (any amount) | "Legendary Vein" | Contract premium ×3 for 20 ticks |
| Absurdium > 30% of yield | "Absurdium Jackpot" | Mafia event trigger probability +40% |

### 4.6 Survey Visibility Rules

- Un-surveyed voxels appear as the dominant rock type color with no ore overlay
- Surveyed voxels show a color-coded ore density overlay (opacity = confidence)
- Surveys are shared across the team — all players see the same result (no fog per player in this single-player game)
- Seismic surveys disturb nearby buildings: if a building is within 5 cells, it loses 10 HP per survey detonation

### 4.7 Atomic Task Breakdown

| # | Task | File(s) | Test |
|---|------|---------|------|
| 4.1 | Add `SurveyMethod`, `SurveyResult` interfaces | `src/core/mining/SurveyCalc.ts` (new file) | `tests/unit/mining/SurveyCalc.test.ts` |
| 4.2 | Implement `estimateSurveyResult()` — noise + skill scaling | `src/core/mining/SurveyCalc.ts` | Test: estimate within expected error bounds (seeded RNG) |
| 4.3 | Implement `isSurveyStale()` — returns true after 100 ticks | `src/core/mining/SurveyCalc.ts` | Test: stale at tick 101, fresh at 99 |
| 4.4 | Add `surveyResults: SurveyResult[]` and `nextSurveyId` to `GameState` | `src/core/GameState.ts` | Test: initial state has empty array |
| 4.5 | Add survey cost constants to `balance.ts` | `src/core/config/balance.ts` | — |
| 4.6 | Implement `runSurvey()` — validates surveyor, deducts cost, enqueues task | `src/core/mining/SurveyCalc.ts` | Test: insufficient funds returns error |
| 4.7 | Implement `computeBlastOreReport()` — yields from destroyed voxels | `src/core/mining/SurveyCalc.ts` | Test: ore mass = Σ(density × voxelVolume × rockDensity) |
| 4.8 | Wire ore report events to event system | `src/core/events/EventEngine.ts` | Test: lucky strike fires at >120% |
| 4.9 | Add i18n keys for survey methods and events (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve |
| 4.10 | Add `survey` console command (`survey seismic x:10 z:10`) | `src/console/commands/mining.ts` | Integration test |
| 4.11 | Render survey confidence overlay in `TerrainMesh.ts` | `src/renderer/TerrainMesh.ts` | Visual test |

---

## 5. Blast Algorithm — Full Pipeline

This chapter replaces the previous blast implementation. The new system is a four-step physical simulation:

1. Energy propagation through the voxel grid
2. Voxel fragmentation and collision mesh rebuild
3. Fragment shape generation (Voronoi)
4. Fragment projection and physics settle

All tuning constants are defined in `src/core/config/balance.ts` and exposed in the UI so the designer can balance without code changes.

---

### 5.1 Rock & Voxel Data Model

#### 5.1.1 Voxel size

The voxel grid uses **1 m × 1 m × 1 m** cells. This is the ground truth unit; all distances, energies, and velocities are in SI-like units relative to this.

#### 5.1.2 Rock composition per voxel

Each voxel stores a mixture of up to 4 rock types. The mixture coefficients are produced by a **3D Simplex noise** field evaluated at the voxel centre, one noise octave per rock type, with a per-type level bias:

```typescript
export interface VoxelRockComposition {
  /** Up to 4 entries; coefficients sum to 1.0. */
  rocks: Array<{ rockId: string; coefficient: number }>;
}
```

Generation algorithm (run once at map creation for each voxel):
```
for each rockType r:
  raw[r] = simplex3(x * r.noiseFreq, y * r.noiseFreq, z * r.noiseFreq) + r.levelBias
raw[r] = max(0, raw[r])
coefficient[r] = raw[r] / sum(raw)   // normalize to sum 1
```

#### 5.1.3 Ore veins per voxel

Ores are **not** spread homogeneously. Each ore type has a vein seed and a separate Simplex field. Ore is present only where the field exceeds a high threshold, producing elongated vein shapes:

```typescript
export interface VoxelOreComposition {
  ores: Array<{ oreId: string; density: number }>; // density 0–1
}
```

Veins are visible on the surface because they modify the **surface tint** (same noise texture used for rendering, see §5.1.4). Non-surface veins require a core-sample or seismic survey to detect (Chapter 4).

#### 5.1.4 Surface texture coherence

The renderer samples rock + ore composition from the voxel at any grid point to produce texture colours. Because the same noise fields drive both composition and texture, fracturing the terrain always produces a visually coherent surface — new exposed faces show the same pattern as the undisturbed surface.

---

### 5.2 Step 1 — Energy Propagation

#### 5.2.1 Per-voxel energy threshold

Each voxel has an **energy absorption threshold** T, computed from its rock mixture:

```
T(v) = Σ_r [ coefficient[r] * rockDef[r].energyAbsorption ]
```

`energyAbsorption` is a per-rock constant (defined in `RockCatalog`).

#### 5.2.2 Initial energy from charges

Each charged hole cell seeds the propagation with an **initial explosive energy** computed from the explosive type, amount, and depth efficiency (stemming ratio):

```
E_init(v) = explosiveDef.energyPerKg * chargeKg * stemmingEfficiency(stemmingM, depthM)
```

The entire energy is placed in the hole voxel as **overflow energy** at the start of Step 1. Effective energy starts at 0.

#### 5.2.3 Propagation loop

```
Per-voxel storage (transient, not persisted to GameState after the blast):
  effectiveEnergy[v]   — energy permanently absorbed by this voxel (≤ T(v))
  overflowEnergy[v]    — pending energy to distribute to neighbours this iteration
  generatedOverflow[v] — cumulative total overflow this voxel produced (used in Step 4)
```

**Each iteration:**

```
for each voxel v with overflowEnergy[v] > 0:
  incoming = overflowEnergy[v]
  overflowEnergy[v] = 0

  absorbable = T(v) - effectiveEnergy[v]   // remaining capacity
  absorbed   = min(incoming, absorbable)
  effectiveEnergy[v] += absorbed

  leftover = incoming - absorbed
  generatedOverflow[v] += leftover          // accumulate for Step 4

  if leftover > 0:
    neighbours = adjacent non-air voxels of v   // up to 6 face-adjacent
    share = leftover / count(neighbours)
    for each n in neighbours:
      overflowEnergy[n] += share

repeat until no voxel has overflowEnergy > 0,
  or iteration count > MAX_PROPAGATION_ITERATIONS (guard, e.g. 500)
```

This naturally models confined blasts (energy stays local when rock is strong) and over-charged blasts (energy radiates outward).

---

### 5.3 Step 2 — Fragmentation & Collision Mesh Rebuild

#### 5.3.1 Fragmentation criterion

A voxel v is **fragmented** (→ air) if:

```
effectiveEnergy[v] >= FRAGMENTATION_MULTIPLIER * T(v)
```

`FRAGMENTATION_MULTIPLIER` (balance constant, e.g. 1.0 initially) controls how much energy it takes to actually break rock vs. merely stress it.

#### 5.3.2 Isolated rock islands

After the first fragmentation pass, perform a **flood-fill** from the outer boundary of the grid. Any solid voxel cluster that has no path to the boundary through solid voxels (i.e. fully surrounded by air or buildings) is also marked for fragmentation. This handles hanging rock arches that result from under-charged blasts.

#### 5.3.3 Damage to entities

For each fragmented voxel v, every **entity** (employee, vehicle, building) whose bounding box intersects v is processed:

- **Employees / vehicles standing on v:** instantly destroyed (killed / written off).
- **Buildings:** buildings are not per-voxel but span a footprint. Sum the `effectiveEnergy` of every voxel beneath the building footprint. If that sum exceeds `buildingDef.structuralResistance`, the building is destroyed. Occupants each independently roll a survival chance:
  ```
  deathProbability = clamp((totalEnergy / structuralResistance - 1.0) * 0.5, 0.30, 1.00)
  ```
  (min 30% death chance, up to 100% at extreme overkill). Uses seeded PRNG.

#### 5.3.4 NavMesh update

All fragmented voxels plus the new exposed surface cells are submitted as a **dirty region** to the NavMesh (Chapter 6), which recomputes the affected cells incrementally.

---

### 5.4 Step 3 — Fragment Shape Generation

#### 5.4.1 Fragmentation score

Each fragmented voxel receives a **fragmentation score** F:

```
F(v) = FRAGMENTATION_SCORE_SCALE * (effectiveEnergy[v] / T(v))
fragmentCount(v) = max(1, round(F(v)))
```

`FRAGMENTATION_SCORE_SCALE` is a balance constant (e.g. 3.0 initially, meaning a voxel at 3× threshold produces ≈3 fragments).

#### 5.4.2 Voronoi seed sampling

For each fragmented voxel v, randomly sample `fragmentCount(v)` 3D points uniformly inside the voxel's unit cube. All sampled points from all voxels form a global **point cloud P**.

#### 5.4.3 3D Voronoi decomposition

The implementation uses the **simplest correct Voronoi approach** that still produces natural fragment shapes:

1. **Delaunay tetrahedralization** of the global point cloud P using an incremental algorithm (Bowyer–Watson). The result is a set of tetrahedra whose circumsphere contains no other points.
2. **Dual Voronoi cells**: each Voronoi cell is built from the circumcentres of all Delaunay tetrahedra incident to a given point. Edges connect circumcentres of tetrahedra that share a face.
3. **Clip** each Voronoi cell to the bounding union of fragmented voxel boxes. Cells whose seed point came from voxel V are clipped to V's unit cube plus a small shared border tolerance to avoid gaps.

This gives one Voronoi cell per sampled point, entirely contained within the fragmented volume. Variable seed density (more seeds in high-score voxels) naturally produces smaller, more numerous fragments in the most energetically stressed zone.

> **Performance note:** The Delaunay tetrahedralization runs once per blast, not per frame. For typical blasts (50–300 fragmented voxels × 1–5 seeds each = 50–1500 points) the algorithm completes in &lt;16 ms on a modern CPU. If point count exceeds `MAX_VORONOI_POINTS` (balance constant, e.g. 2000), seeds are randomly culled from the lowest-score voxels first.

#### 5.4.4 Merging pass

To create non-convex, more realistic fragment shapes, run a random merging pass:

```
for each Voronoi cell C (in random order):
  if rng.next() < MERGE_PROBABILITY:
    neighbours = Voronoi cells sharing a face with C
    pick random neighbour N
    merge C and N into a single fragment (union of their convex hulls)
```

`MERGE_PROBABILITY` ≈ 0.35 (balance constant). Merged cells are not eligible for further merging in the same pass.

#### 5.4.5 Fragment physics objects

Each merged shape becomes a **RockFragment**:

```typescript
export interface RockFragment {
  id: number;
  /** World-space centroid at spawn. */
  cx: number; cy: number; cz: number;
  /** Graphic mesh vertices (world space). */
  graphicVertices: Float32Array;
  /** Collision mesh vertices (deflated inward by COLLISION_DEFLATE_AMOUNT). */
  collisionVertices: Float32Array;
  /** Rock + ore composition inherited from source voxels (weighted by overlap). */
  composition: VoxelRockComposition;
  oreComposition: VoxelOreComposition;
  /** Volume in m³. */
  volumeM3: number;
  /** kg, computed from volume and rock density. */
  massKg: number;
  /**
   * Sum of generatedOverflow from all source voxels, weighted by the fraction
   * of each voxel's volume this fragment occupies. Used by Step 4 for velocity.
   */
  overflowEnergy: number;
  /** Initial linear velocity (m/tick). Set in Step 4. */
  velocity: Vec3;
  /** Classification set by Step 4 before physics begins. */
  simulationTier: 'projected' | 'collapse';
  state: 'flying' | 'settling' | 'static';
}
```

**Collision mesh deflation:** for every vertex in the collision mesh, move it by `−COLLISION_DEFLATE_AMOUNT` (e.g. −0.05 m) along the vertex normal. The graphic mesh is untouched. This prevents physics tunnelling between resting fragments.

---

### 5.5 Step 4 — Fragment Projection & Physics Settle

#### 5.5.1 Projection velocity — energy gradient + surface proximity

**Confirmed algorithm.** For each fragment F with centroid C:

```
// 1. Energy gradient direction — finite differences on 3×3×3 neighbourhood
//    of the effectiveEnergy field at C.
//    Fragment moves away from the energy peak (highest pressure), so negate.
grad     = computeEnergyGradient(effectiveEnergy, C)
grad_dir = normalize(-grad)

// 2. Surface proximity factor — fragments near a free face (air) get full speed;
//    deeply buried fragments get near-zero speed.
distToAir              = distanceToNearestAirVoxel(C)      // in meters/cells
surfaceProximityFactor = exp(-distToAir * SURFACE_PROXIMITY_DECAY)   // e.g. decay = 0.5

// 3. Speed — derived from the overflow energy the fragment "inherited"
//    (overflowEnergy on RockFragment, set in §5.4.5).
//    sqrt(2E/m) is the kinetic energy formula inverted; scaled to game units.
v_mag = sqrt(2.0 * fragment.overflowEnergy / fragment.massKg)
      * surfaceProximityFactor

// 4. Clamp to prevent satellites
v_mag = min(v_mag, MAX_PROJECTION_VELOCITY)   // e.g. 80 m/s

// 5. Final velocity
F.velocity = grad_dir * v_mag
```

**Classification:** if `v_mag > PROJECTION_VELOCITY_THRESHOLD`, the fragment is tagged `simulationTier: 'projected'`; otherwise `'collapse'`. This tier drives the physics strategy below.

**Why this works:**
- **Deeply buried fragments**: `distToAir` is large → `surfaceProximityFactor ≈ 0` → `v_mag ≈ 0` → fragment collapses under gravity regardless of overflow energy.
- **Surface fragments, over-charged blast**: `distToAir ≈ 0` → factor = 1.0; high overflow energy → large `v_mag` → dangerous fly-rock.
- **Well-designed blast** (correct stemming/burden): overflow energy is low everywhere → `v_mag` small even at surface → pile of collapsed fragments, minimal projection.
- **Poor stemming** (energy leaks upward toward collar): gradient near collar points upward → upward projection, mimicking real fly-rock from collar blow-out.

#### 5.5.2 Tiered physics simulation

Running full cannon-es rigid-body simulation for every fragment is too expensive (potentially thousands of bodies). The `'projected'` / `'collapse'` classification drives a two-tier strategy:

**Tier A — Projected fragments** (`simulationTier: 'projected'`):
- Each fragment becomes a `CANNON.Body` with `massKg`, shape = convex hull of `collisionVertices`.
- Full 6-DOF rigid-body dynamics with gravity (−9.8 m/s²).
- **Hard cap:** only the first `PHYSICS_FRAGMENT_CAP` (e.g. 200) projected fragments get a full `CANNON.Body`. Fragments beyond the cap use simplified **parabolic trajectories** (ballistic arc computed analytically, no collision between them, only ground collision check at landing).
- **Aggressive sleep:** any Tier A body with `|velocity| < SLEEP_VELOCITY_THRESHOLD` for `SLEEP_TICKS_REQUIRED` consecutive ticks (e.g. 0.5 s worth) is converted to `'static'` immediately.

**Tier B — Collapse fragments** (`simulationTier: 'collapse'`):
- No cannon-es body created.
- Fragment drops straight down each tick by gravity until it hits the terrain height or a `'static'` fragment already registered in that column. No inter-fragment lateral collision.
- Landing is instantaneous: fragment snaps to resting position, registers in the surface grid, and enters `'static'` state.
- This tier is essentially free in terms of CPU.

**Landing damage (both tiers):**
- On landing, if a human, vehicle, or building occupies the impact cell → apply kinetic energy damage: `impactEnergy = massKg * v_mag²`. Building survival uses the same formula as §5.3.3 with `impactEnergy` replacing `totalBlastEnergy`.

#### 5.5.3 Fragment sleep & stack behaviour

- A **support graph** is maintained: fragment A supports fragment B if B is resting directly on A's top face.
- When A is collected (Debris Hauler) or broken (Rock Fragmenter), each fragment B that A was supporting independently starts a Tier B gravity-drop (no damage).
- Sleeping fragments are invisible to cannon-es and cost nothing per tick.

#### 5.5.4 Fragment size and collection rules

```
oversized = fragment.volumeM3 > OVERSIZED_FRAGMENT_THRESHOLD   // e.g. 0.5 m³

oversized  → must be broken by Rock Fragmenter first
!oversized → Debris Hauler with capacity ≥ fragment.massKg can collect directly
```

Ore content of each collected fragment is added to `GameState.collectedOre`, feeding the income calculation.

---

### 5.6 New Balance Constants

```typescript
// src/core/config/balance.ts

/** Maximum propagation iterations (guard against infinite loops). */
export const MAX_PROPAGATION_ITERATIONS = 500;

/** effectiveEnergy >= N * T triggers fragmentation. */
export const FRAGMENTATION_MULTIPLIER = 1.0;

/** Converts energy/threshold ratio to fragment count per voxel. */
export const FRAGMENTATION_SCORE_SCALE = 3.0;

/** Probability that a Voronoi cell merges with a neighbour in the merging pass. */
export const MERGE_PROBABILITY = 0.35;

/** Inward deflation of collision mesh vertices (m). */
export const COLLISION_DEFLATE_AMOUNT = 0.05;

/**
 * Exponential decay rate of surfaceProximityFactor = exp(-distToAir * k).
 * Higher value → factor drops faster with depth → fewer projections.
 */
export const SURFACE_PROXIMITY_DECAY = 0.5;

/** Hard cap on fragment projection velocity (m/s). Prevents satellites. */
export const MAX_PROJECTION_VELOCITY = 80;

/**
 * Fragments with v_mag above this threshold are simulated with full cannon-es.
 * Below it, simplified collapse simulation is used.
 */
export const PROJECTION_VELOCITY_THRESHOLD = 2.0;

/** Maximum number of full cannon-es rigid bodies per blast. */
export const PHYSICS_FRAGMENT_CAP = 200;

/** Fragment body is put to sleep when |v| < this threshold (m/s). */
export const SLEEP_VELOCITY_THRESHOLD = 0.1;

/** Number of consecutive ticks below SLEEP_VELOCITY_THRESHOLD before sleep. */
export const SLEEP_TICKS_REQUIRED = 15;

/** Maximum Voronoi seed points before culling low-score voxels. */
export const MAX_VORONOI_POINTS = 2000;

/** Volume threshold above which a fragment is too large to haul directly (m³). */
export const OVERSIZED_FRAGMENT_THRESHOLD = 0.5;
```

---

### 5.7 Atomic Task Breakdown

| # | Task | File(s) | Test |
|---|------|---------|------|
| **5.7.0** | **Prerequisite — multi-rock VoxelGrid:** Change `VoxelCell.rockId: string` to `VoxelCell.composition: VoxelRockComposition`; update `TerrainGen` to populate coefficients via Simplex noise + level bias; update all callers | `src/core/voxels/VoxelGrid.ts`, `src/core/terrain/TerrainGen.ts` | Test: coefficients sum to 1.0 per voxel; pure-rock voxel = single entry coeff 1.0 |
| 5.1 | Assert voxel cell size = 1 m and document it | `src/core/voxels/VoxelGrid.ts` | Test: grid dimensions in meters |
| 5.2 | Add `energyAbsorption` and `density` constants to each `RockDef` in `RockCatalog` | `src/core/config/RockCatalog.ts` | Test: all rock defs have positive absorption and density |
| 5.3 | Implement `computeThreshold(voxel)` — weighted sum of rock coefficients × absorption | `src/core/mining/BlastCalc.ts` | Test: pure rock = rock absorption; 50/50 mix = average |
| 5.4 | Implement `computeInitialEnergy(hole)` — explosiveDef × kg × stemming efficiency | `src/core/mining/BlastCalc.ts` | Test: more charge = more energy; full stemming = 100% efficiency |
| 5.5 | Implement `propagateEnergy(grid, initial)` — iterative overflow loop tracking `generatedOverflow[v]` | `src/core/mining/BlastCalc.ts` | Test: energy stays local for strong rock; spreads for weak rock; guard terminates; generatedOverflow = 0 for unsaturated voxels |
| 5.6 | Implement `identifyFragmentedVoxels(grid)` — fragmentation criterion + island flood-fill | `src/core/mining/BlastCalc.ts` | Test: isolated island flagged; exact threshold boundary |
| 5.7 | Implement entity damage from blast — employee/vehicle instant kill, building sum + survival roll | `src/core/mining/BlastCalc.ts` | Test: building at 1.5× resistance → death probability ≈ 55% |
| 5.8 | Implement `computeFragmentationScore(voxel)` and Voronoi seed sampling | `src/physics/VoronoiFrag.ts` (new) | Test: fragment count scales with E/T ratio; min 1 per voxel |
| 5.9 | Implement Bowyer–Watson incremental Delaunay tetrahedralization; compute dual Voronoi cells; clip to fragmented voxel union; respect `MAX_VORONOI_POINTS` cap | `src/physics/VoronoiFrag.ts` | Test: all volume covered; no overlaps; circumsphere property holds |
| 5.10 | Implement Voronoi merging pass (`MERGE_PROBABILITY ≈ 0.35`) | `src/physics/VoronoiFrag.ts` | Test: merge probability respected within ±10% over 1000 runs (seeded) |
| 5.11 | Generate `RockFragment` objects: graphic mesh, deflated collision mesh, `overflowEnergy` from source voxels | `src/physics/FragmentSim.ts` (new) | Test: collision mesh volume < graphic mesh volume; overflowEnergy ≥ 0 |
| 5.12 | Implement Step 4 velocity assignment: energy gradient × surface proximity factor; classify `simulationTier` | `src/physics/FragmentSim.ts` | Test: deep fragment v ≈ 0; surface over-charged fragment v near MAX; poor-stemming blast → upward gradient |
| 5.13 | Implement Tier A (projected) cannon-es loop — full rigid body, `PHYSICS_FRAGMENT_CAP`, parabolic fallback, stick-on-land | `src/physics/FragmentSim.ts` | Test: fragment sticks after landing; cap enforced; parabolic fallback lands at correct position |
| 5.14 | Implement Tier B (collapse) gravity-drop — straight-down, column stack, immediate static | `src/physics/FragmentSim.ts` | Test: collapse fragment rests on terrain; no lateral movement |
| 5.15 | Implement aggressive sleep: stationary for `SLEEP_TICKS_REQUIRED` ticks → `'static'` | `src/physics/FragmentSim.ts` | Test: body sleeps within expected tick window |
| 5.16 | Implement fragment support graph and stack-collapse on pickup | `src/physics/FragmentSim.ts` | Test: removing bottom fragment triggers Tier B drop for supported fragments |
| 5.17 | Implement fragment size check and oversized flag | `src/core/mining/BlastCalc.ts` | Test: volume above threshold flagged correctly |
| 5.18 | Wire ore reporting: collect fragment → add to `GameState.collectedOre` | `src/core/GameState.ts` | Test: ore yield matches source voxel composition |
| 5.19 | Trigger NavMesh dirty-region update after fragmentation pass | `src/core/voxels/NavGrid.ts` | Test: fragmented voxels removed from walkable set |
| 5.20 | Add all balance constants to `balance.ts` | `src/core/config/balance.ts` | — |
| 5.21 | Add i18n keys for blast damage events, oversized fragment alert (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve |
| 5.22 | Add `blast_preview` console command — prints energy map, predicted fragment count, and projected/collapse split | `src/console/commands/mining.ts` | Integration test |

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
1. A cell is `void` if the voxel directly below the surface at that column is air
2. A cell is `drill_hole` if a `DrillHole` exists at that (x, z) coordinate
3. A cell is `blocked` if a building footprint covers it, or a parked/stationary vehicle occupies it
4. A cell is `ramp` if the surface height delta between it and at least one neighbor exceeds 1 voxel unit (placed by the player or auto-detected after terrain subtraction)
5. All remaining solid-surface cells are `walkable`

Move costs:
| Cell Type | Cost |
|-----------|------|
| `walkable` | 1.0 |
| `ramp` | 1.8 |
| `drill_hole` | 5.0 (passable but discouraged) |
| `blocked` / `void` | ∞ (impassable) |

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
1. Check if start and destination are on the same bench level → run standard A\*
2. If on different levels → find the nearest ramp connecting the required levels → route: `start → ramp entrance → ramp exit → destination` (3 sequential A\* queries)
3. If no ramp exists connecting the required levels → return `found: false`, emit `no_ramp_available` event

**Ramp definition** (added to Building types from Chapter 1):
```typescript
// Added to BuildingType:
'ramp'  // Connects benchLevel N to benchLevel N+1; footprint 1×4 cells, oriented N/S/E/W
```

### 6.5 Dynamic NavGrid Updates

The NavGrid must be **incrementally updated** when the world changes — a full rebuild of a 100×100 grid every tick would be too expensive.

Triggered updates:
| Trigger | Region Updated |
|---------|---------------|
| Blast completes | All cells in the blast's AABB + 2-cell margin |
| Building placed or demolished | Building footprint cells |
| Vehicle parks or departs | Single cell |
| Drill hole added | Single cell |
| Ramp built | 1×4 footprint + adjacent cells |

Each update patches only the affected `NavCell` entries and does **not** invalidate cached paths that do not cross the updated region. Paths that do cross the region are marked stale and re-requested next tick.

### 6.6 Path Following

Agents follow waypoints by moving at most `walkSpeed` cells per tick toward the next waypoint. If the next waypoint becomes `blocked` mid-path (e.g., a vehicle parks there), the agent re-requests a path from current position. After 3 consecutive failed re-requests, the agent enters `stuck` state (idle, morale −2/tick, emits `agent_stuck` event) until the path clears.

### 6.7 Atomic Task Breakdown

| # | Task | File(s) | Test |
|---|------|---------|------|
| 6.1 | Define `NavCell`, `NavCellType`, `NavGrid` interfaces | `src/core/nav/NavGrid.ts` (new file) | `tests/unit/nav/NavGrid.test.ts` |
| 6.2 | Implement `buildNavGrid()` — derives NavGrid from VoxelGrid + buildings + holes | `src/core/nav/NavGrid.ts` | Test: blocked cells match building footprints |
| 6.3 | Implement `patchNavGrid()` — incremental update for a bounding box | `src/core/nav/NavGrid.ts` | Test: patch only affects specified region |
| 6.4 | Implement A\* `findPath()` with 8-directional movement and octile heuristic | `src/core/nav/Pathfinding.ts` (new file) | Test: correct path length on simple grid; impassable tiles are avoided |
| 6.5 | Implement node budget cap and direct-line fallback | `src/core/nav/Pathfinding.ts` | Test: falls back when grid is very large and budget is hit |
| 6.6 | Implement multi-level routing via ramp lookup | `src/core/nav/Pathfinding.ts` | Test: 3-segment path when ramp present; `found: false` when no ramp |
| 6.7 | Implement `advanceAgent()` — move agent 1 step along waypoints per tick | `src/core/nav/AgentMovement.ts` (new file) | Test: agent reaches destination in expected ticks |
| 6.8 | Implement stale-path detection and re-request on obstacle change | `src/core/nav/AgentMovement.ts` | Test: path re-requested when cell blocked mid-route |
| 6.9 | Implement `stuck` state and `agent_stuck` event | `src/core/nav/AgentMovement.ts` | Test: stuck state after 3 failed re-requests |
| 6.10 | Integrate NavGrid build into `GameState` initialization | `src/core/state/GameState.ts` | Smoke test: GameState serializes NavGrid |
| 6.11 | Wire NavGrid patch calls into blast pipeline and building placement | `src/core/engine/GameLoop.ts` | Test: NavGrid reflects new hole after drill |
| 6.12 | Add i18n keys for pathfinding events (`agent_stuck`, `no_ramp_available`) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve |

---

## 7. Employee Needs (Eating, Sleeping, Breaks)

### 7.1 Design Goals

Employees have three biological needs — **hunger**, **fatigue**, and **break pressure** — modelled as gauges that fill over time and must be satisfied by visiting appropriate buildings. Unmet needs drain morale, reduce effectiveness, and eventually cause the employee to collapse (forced rest). Satisfying needs promptly is the player's main micro-management loop during long mining sessions.

This chapter connects directly to the Buildings system (Chapter 1 — canteen, bunkhouse, break room) and the Task Queue system (Chapter 3 — `rest` task type).

### 7.2 Need Gauges

Each employee has three need gauges (0–100; 100 = fully satisfied):

| Gauge | Name | Fills at | Drains at | Collapse Threshold |
|-------|------|----------|------------|-------------------|
| `hunger` | Hunger | Eating at Canteen | −1/tick while working | ≤ 10 |
| `fatigue` | Fatigue | Sleeping at Bunkhouse | −0.5/tick (awake) / −2/tick (active task) | ≤ 5 |
| `breakNeed` | Break Pressure | Taking break at Break Room | −0.8/tick while working | ≤ 15 |

**Rate modifiers:**
- Active task (non-`rest`) drains gauges at the "active task" rate
- Idle state drains at the normal "awake" rate
- High morale (>70): drain rate ×0.85 (happy workers last longer)
- Low morale (<30): drain rate ×1.20 (miserable workers tire faster)

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

1. The employee's current task is immediately interrupted (pushed back to front of queue)
2. A `rest` task is prepended with `taskType = 'rest'`, targeting the nearest available building of the correct type
3. The employee is flagged `collapsing: true` — effectiveness drops to 0 until the `rest` task completes
4. On completion of the `rest` task, `collapsing` is cleared and the interrupted task resumes

| Collapse Gauge | Rest Building | Rest Duration (ticks) |
|---------------|--------------|----------------------|
| `hunger` | Canteen | 2 |
| `fatigue` | Bunkhouse | 8 |
| `breakNeed` | Break Room | 3 |

If no suitable building exists within 20 cells, the employee collapses in place: `collapsing: true`, the `rest` task uses the employee's current position, and duration is doubled (miserable ground-rest).

### 7.5 Need Replenishment Rates

Each building tier refills gauges at different speeds:

| Building | Tier 1 | Tier 2 | Tier 3 |
|---------|--------|--------|--------|
| Canteen | +12 hunger/tick | +18 hunger/tick | +25 hunger/tick |
| Bunkhouse | +8 fatigue/tick | +14 fatigue/tick | +20 fatigue/tick |
| Break Room | +10 breakNeed/tick | +16 breakNeed/tick | +22 breakNeed/tick |

Buildings have finite capacity (from Chapter 1). If a building is full, the employee must wait (`await_vehicle`-style queue at building entrance) or route to the next nearest. Waiting in queue slowly drains gauges at the normal awake rate.

### 7.6 Proactive Need Queuing

Employees don't wait until collapse — the game automatically **inserts need-satisfaction tasks** into the queue when a gauge falls below the warning threshold:

| Gauge | Warning Threshold | Auto-Insert Behaviour |
|-------|------------------|----------------------|
| `hunger` | 35 | Insert `rest(canteen)` after current task if not already queued |
| `fatigue` | 25 | Insert `rest(bunkhouse)` after current task if not already queued |
| `breakNeed` | 30 | Insert `rest(break_room)` after current task if not already queued |

If the queue is full (capacity exceeded), auto-insert is skipped but a `need_warning` event is emitted so the player can manually intervene. The Manager "Morale Booster" specialization (Chapter 3) slows drain rates by ×0.9 for all nearby employees.

### 7.7 Cost of Needs

Each visit to a building consumes resources:

| Building | Cost per Visit |
|---------|---------------|
| Canteen | $10 per employee (food cost) |
| Bunkhouse | $0 (included in salary — staying costs nothing) |
| Break Room | $5 per employee (coffee, snacks) |

Canteen food costs scale with tier: Tier 1 × $10, Tier 2 × $8 (bulk purchasing), Tier 3 × $6 (optimized supply chain).

### 7.8 Shift System (Optional Layer)

If the player builds a **Bunkhouse Tier 2+**, an 8-tick shift cycle activates: employees work for 6 ticks, then automatically enter an 8-tick sleep rest at the bunkhouse. Shift boundaries trigger an `employee_shift_change` event. Without a Bunkhouse, employees remain awake indefinitely (fatigue accumulates faster).

### 7.9 Atomic Task Breakdown

| # | Task | File(s) | Test |
|---|------|---------|------|
| 7.1 | Add `hunger`, `fatigue`, `breakNeed`, `collapsing` fields to `Employee` interface | `src/core/entities/Employee.ts` | Test: new fields initialized on hire |
| 7.2 | Add `NEED_DRAIN_RATES`, `NEED_WARNING_THRESHOLDS`, `NEED_COLLAPSE_THRESHOLDS` to `balance.ts` | `src/core/config/balance.ts` | — |
| 7.3 | Implement `tickNeedGauges()` — drain gauges based on task state + morale modifier | `src/core/entities/Employee.ts` | Test: drain rates match table; active task drains faster |
| 7.4 | Implement `needsMoraleEffect()` — compute tick-level morale delta from all gauges | `src/core/entities/Employee.ts` | Test: zero effect above 50; −3/tick at critical |
| 7.5 | Implement `replenishNeed()` — fill gauge at building tier rate, enforce capacity | `src/core/entities/Employee.ts` | Test: gauge fills at correct rate per tier |
| 7.6 | Implement `checkCollapse()` — interrupt task queue, prepend `rest` task | `src/core/entities/Employee.ts` | Test: interrupted task re-queued; `collapsing` flag set |
| 7.7 | Implement `autoInsertNeedTasks()` — proactive queue insertion at warning thresholds | `src/core/entities/Employee.ts` | Test: `rest` inserted after current task; skipped if queue full |
| 7.8 | Deduct per-visit food/break costs from cash balance | `src/core/engine/GameLoop.ts` | Test: canteen visit deducts $10; tier 3 deducts $6 |
| 7.9 | Implement shift cycle for Bunkhouse Tier 2+ | `src/core/engine/GameLoop.ts` | Test: shift cycle fires at tick 6; sleep rest queued |
| 7.10 | Wire all need events into event system (`need_warning`, `employee_collapsed`, `employee_shift_change`) | `src/core/events/EventSystem.ts` | Test: events fire at correct gauge levels |
| 7.11 | Add i18n keys for all need events and building-full message (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` | Test: all keys resolve |
| 7.12 | Add `needs` console command — print all employees' gauge values | `src/console/commands/entities.ts` | Integration test |

---

## 8. Testing Strategy

### 8.1 Overview

BlastSimulator2026 uses a four-layer test pyramid. **No layer is optional. More tests are always better — do not limit the number of test cases.**

1. **Unit tests** — Every exported pure function in `src/core/` has exhaustive coverage. Fast, no I/O, seeded PRNG. Run with `npm run test`.
2. **Small integration tests** — Console command sequences covering partial gameplay loops with a huge variation of scenarios. Multiple test files per system, stressing happy paths, edge cases, failure conditions, and cross-system interactions. Run with `npm run test:integration`.
3. **Full-level integration tests** — Complete gameplay loop simulations. Console-driven runs from `new_game` to a terminal outcome (win or each of the four loss conditions). Run with `npm run test:integration`.
4. **Visual scenario tests** — Full browser sessions driven by Puppeteer. Screenshots + JSON state dumps after every command. Mandatory after any rendering change; full-level playthroughs inspected manually by the implementing agent. Run with the scenario-test script.

All four layers must pass before any PR is merged. The `npm run validate` command runs TypeScript type-checking, unit + integration tests, and a production build in sequence. Visual scenario tests are run manually and screenshots are inspected before marking any visual task complete.

### 8.2 Unit Test Conventions

Unit tests live in `tests/unit/` mirroring the source tree. **Every exported pure function in `src/core/` must have exhaustive tests:** at minimum one positive test (expected happy path), one boundary test (edge values, empty inputs, zero, maximal values), and one failure/rejection test (invalid input, insufficient funds, missing qualification, wrong state). Functions that are trivial field getters may be tested implicitly by higher-level tests, but must still have at least one passing assertion.

Test files use `vitest` (`describe`/`it`/`expect`). Fixtures use `Random` with a fixed seed (conventionally `seed: 42`). Never use `Math.random()` in tests.

**Naming convention:** `<Module>.test.ts` in the same directory path as the source. E.g. `src/core/nav/Pathfinding.ts` → `tests/unit/nav/Pathfinding.test.ts`.

**Coverage targets (per chapter):**

| Chapter | Minimum Line Coverage |
|---------|----------------------|
| 1 — Buildings | 90% |
| 2 — Vehicles | 90% |
| 3 — Employee Skills | 90% |
| 4 — Survey System | 90% |
| 5 — Blast Enhancements | 95% |
| 6 — NavMesh | 90% |
| 7 — Employee Needs | 90% |

### 8.3 Integration Test Conventions

Integration tests live in `tests/integration/`. They use the same `vitest` runner but are allowed to import from `src/console/` (the command layer) and must exercise at least one full round-trip through the game loop. No DOM, no Three.js.

Integration tests are split into two tiers.

#### 8.3.1 Small Integration Tests — Partial Gameplay Loops

Each test file exercises one cross-system interaction with a large number of scenario variations. Every file must test **at least 8 distinct scenarios** (different seeds, configurations, edge cases, or failure conditions). More scenarios are always welcome.

| Test Suite | Key Scenarios (minimum set) |
|-----------|----------------------------|
| `buildings.integration.test.ts` | (1) Place on valid flat terrain; (2) reject on slope; (3) reject overlapping footprint; (4) demolish frees footprint on navmesh; (5) blast destroys building, applies score penalty; (6) explosive warehouse secondary blast when stock present; (7) living quarters well-being multiplier per tier; (8) research center unlocks tier after correct tick count; (9) overcapacity penalty in living quarters; (10) protected voxels block drill command |
| `vehicles.integration.test.ts` | (1) Purchase → assign qualified driver → move to target; (2) reject unqualified driver; (3) two vehicles converge on same cell — one waits; (4) TrafficJamEvent fires at queue threshold; (5) vehicle enters `broken` state after damage; (6) repair at depot restores HP; (7) vehicle destroyed by blast projection; (8) driver exits vehicle on arrival at destination, re-enters for next task; (9) uncrewed vehicle cannot be assigned task; (10) vehicle payload tracked correctly during haul |
| `skills.integration.test.ts` | (1) New hire has 0 qualifications; (2) training building grants skill after required ticks; (3) XP accumulates each active task tick; (4) level-up fires at correct XP threshold; (5) proficiency multiplier reduces task duration; (6) multi-skill employee salary higher than single-skill; (7) unqualified task emits UnqualifiedTaskError; (8) qualified-but-busy employee does not emit error; (9) pending action ghost added to state on dispatch, removed on claim; (10) task duration uses combined proficiency + wellbeing + event modifiers |
| `survey.integration.test.ts` | (1) Seismic survey produces estimates within ±15% of true value (seeded); (2) core sample within ±5%; (3) aerial survey reveals only surface horizon (Y=0, Y=−1); (4) survey becomes stale at tick 101; (5) Lucky Strike event fires when yield > 120% estimate; (6) Barren Blast event fires when yield < 60%; (7) insufficient funds returns error; (8) surveyor skill level reduces error margin; (9) seismic survey damages nearby building; (10) multiple overlapping surveys accumulate results |
| `blast-enhanced.integration.test.ts` | (1) Multi-rock voxel threshold is weighted average of coefficients; (2) energy stays local for strong rock; (3) energy spreads for weak rock; (4) island flood-fill marks hanging rock cluster; (5) building destroyed when blast energy exceeds structural resistance; (6) death probability scales with overkill energy; (7) Voronoi fragment count scales with energy/threshold ratio; (8) deep fragment velocity ≈ 0; (9) surface over-charged fragment velocity near MAX; (10) Tier A physics cap enforced; (11) ore yield matches source voxel composition; (12) navmesh dirty-region update fires after fragmentation |
| `navmesh.integration.test.ts` | (1) A\* finds shortest path on clear grid; (2) path avoids blocked cells; (3) path avoids building footprints; (4) drill hole cell discourages but allows passage; (5) multi-level path routes via ramp; (6) `found: false` when no ramp exists for required levels; (7) path re-requested when cell becomes blocked mid-route; (8) agent enters `stuck` after 3 consecutive failed re-requests; (9) navmesh patches only affected region after blast; (10) navmesh patches after building placement; (11) vehicle-occupied cell flagged per tick |
| `needs.integration.test.ts` | (1) Hunger drains at correct rate during active task; (2) fatigue drains faster during task than idle; (3) `rest` task auto-inserted at warning threshold; (4) collapse interrupts current task and prepends rest; (5) rest task resolves collapse flag, interrupted task resumes; (6) building at capacity queues waiting employee; (7) well-rested bonus fires when all gauges > 80 simultaneously; (8) shift cycle fires for Bunkhouse Tier 2+; (9) food cost deducted on canteen visit; (10) ground-rest lasts twice as long when no building within 20 cells |
| `economy.integration.test.ts` | (1) Ore sale contract deducts ore, credits cash; (2) missed deadline triggers penalty fine; (3) successful negotiation improves contract terms; (4) failed negotiation worsens or keeps terms; (5) supply contract delivers explosives on schedule to warehouse; (6) rubble disposal deducts cash for plain rock; (7) bankruptcy tracker fires after sustained negative balance; (8) finance state serializes and restores correctly via save/load |
| `events.integration.test.ts` | (1) Union event fires at correct timer interval; (2) event probability scales with well-being score; (3) decision choice affects follow-up event probabilities; (4) mafia unlocked after first corruption path choice; (5) lawsuit triggered by employee death event; (6) weather event modifies drill hole flood state; (7) TrafficJamEvent fires at correct vehicle queue threshold; (8) UnqualifiedTaskError emits for genuinely missing skill; (9) event timer resets after firing; (10) event values (fine amounts) scale with score |
| `campaign.integration.test.ts` | (1) Level completes when profit threshold reached; (2) star rating computed from performance metrics; (3) next level unlocked on completion; (4) campaign progress persists when level is restarted; (5) bankruptcy ends current level and returns to world map; (6) arrest ends current level; (7) ecological shutdown fires after sustained ecology score of 0; (8) worker revolt fires after sustained well-being of 0; (9) player can replay completed level; (10) star rating updates if improved on replay |

#### 8.3.2 Full-Level Integration Tests — Complete Gameplay Loops

These tests drive an entire level via console commands from `new_game` to a terminal outcome, verifying the final `GameState`. They cover every win condition and every loss condition for all levels. These tests are slower (may require hundreds of `tick` advances) and are kept in a separate sub-directory.

| Test File | Level | Outcome | Final Assertion |
|-----------|-------|---------|-----------------|
| `level1-win.integration.test.ts` | Level 1 (Dusty Hollow) | Win — reach profit threshold efficiently | `state.levelEndReason === 'completed'`; star rating ≥ 2 |
| `level1-lose-bankruptcy.integration.test.ts` | Level 1 | Lose — overspend on vehicles, fail to sell ore | `state.levelEndReason === 'bankruptcy'` |
| `level1-lose-revolt.integration.test.ts` | Level 1 | Lose — ignore employee needs; well-being hits 0 | `state.levelEndReason === 'worker_revolt'` |
| `level1-lose-ecology.integration.test.ts` | Level 1 | Lose — repeated overblast; ecology score hits 0 | `state.levelEndReason === 'ecological_shutdown'` |
| `level1-lose-arrest.integration.test.ts` | Level 1 | Lose — pursue corruption path to criminal charges | `state.levelEndReason === 'arrest'` |
| `level2-win.integration.test.ts` | Level 2 (Grumpstone Ridge) | Win — multi-bench blast cycle with vibration management | `state.levelEndReason === 'completed'`; star rating ≥ 2 |
| `level2-lose-bankruptcy.integration.test.ts` | Level 2 | Lose — strict deadline contracts missed; cascade fines | `state.levelEndReason === 'bankruptcy'` |
| `level2-lose-revolt.integration.test.ts` | Level 2 | Lose — continuous shift policy, no Living Quarters upgrade | `state.levelEndReason === 'worker_revolt'` |
| `level3-win.integration.test.ts` | Level 3 (Treranium Depths) | Win — deep Treranium extraction; all systems active | `state.levelEndReason === 'completed'`; star rating ≥ 1 |
| `level3-lose-ecology.integration.test.ts` | Level 3 | Lose — tropical storm + repeated overblast | `state.levelEndReason === 'ecological_shutdown'` |

### 8.4 Scenario Test Definitions

Scenario tests are defined in `scripts/scenario-defs/` as JSON files. Each scenario lists console commands; the test runner captures a screenshot and state JSON after every command. These produce step-by-step visual evidence that must be inspected by the implementing agent.

#### 8.4.1 Feature Scenario Tests

These verify specific features from chapters 1–7 and serve as the primary visual regression check per chapter.

| Scenario File | Chapter | Purpose | Pass Condition |
|--------------|---------|---------|----------------|
| `survey-then-blast.json` | 4 | Run seismic survey, inspect estimates, blast, check ore report | Lucky Strike event fires if yield > 120% estimate |
| `skill-progression.json` | 3 | Hire driller, run 700 ticks of work, verify Legend level | `employee.skillLevel === 5` in state JSON |
| `multi-deck-blast.json` | 5 | Place 3-deck charge, blast, verify energy field depth profile | No over-blast projection at surface; deep voxels fractured |
| `presplit-wall.json` | 5 | Drill presplit row + production holes, verify zero back-break | `backBreakPenalty === 0` in blast result |
| `needs-cycle.json` | 7 | Hire 3 workers, fast-forward 20 ticks, verify canteen visit auto-queued | `employee.hunger > 30` after visit |
| `ramp-navigation.json` | 6 | Build ramp, assign worker to task on lower bench | Agent reaches destination; no `agent_stuck` event |
| `vibration-budget.json` | — | Fire blast exceeding vibration budget 3 times | Third blast halted; $5,000 fine deducted |
| `building-lifecycle.json` | 1 | Place → research upgrade → demolish → rebuild at Tier 2 | Building tier transitions correctly in state JSON |
| `vehicle-traffic.json` | 2 | Launch 4 haulers on same narrow ramp | TrafficJamEvent fires; throughput reduced vs. wide route |
| `employee-training.json` | 3 | Hire generalist, train at Blasting Academy, assign blast task | Task accepted after training; task rejected before training |
| `blast-undercharge.json` | 5 | Blast with 30% of optimal charge | Oversized fragments flagged; zero projections |
| `blast-overcharge.json` | 5 | Blast with 500% of optimal charge | Projections > 0; catastrophic rating; building receives damage |
| `collapse-recovery.json` | 7 | Let employee fatigue reach collapse threshold | Task interrupted; rest task executed; original task resumes |
| `contract-negotiation.json` | — | Negotiate ore sale contract 10 times with different seeds | Both improved and worsened outcomes observed across runs |
| `weather-flood.json` | — | Trigger heavy rain; drill holes; charge water-sensitive explosive | Blast partially fails; reliability reduced; flood warning in state |

#### 8.4.2 Full-Level Visual Playthrough Scenarios

These drive a full level from opening state to a terminal outcome and produce screenshots after every significant action. **These must be run and inspected manually by the implementing agent after every rendering change** (see §8.5 for the full protocol).

| Scenario File | Level | Outcome | Visual Checkpoints |
|--------------|-------|---------|-------------------|
| `level1-playthrough-win.json` | Level 1 | Win (profit threshold) | Initial terrain, first survey, first blast crater, first warehouse delivery, HUD score update, level-complete screen |
| `level1-playthrough-revolt.json` | Level 1 | Loss (worker revolt) | Employee morale gauges declining, strike notification, game-over UI |
| `level2-playthrough-win.json` | Level 2 | Win (profit threshold) | Multi-bench terrain visible, ramp built and used, vibration alert panel, level-complete screen |
| `level2-playthrough-bankruptcy.json` | Level 2 | Loss (bankruptcy) | Balance declining in HUD, contract penalty dialog, bankruptcy screen |
| `level3-playthrough-win.json` | Level 3 | Win (profit threshold) | Deep pit with multiple benches, Treranium vein ore tint visible, tropical weather sky, level-complete screen |
| `level3-playthrough-ecology.json` | Level 3 | Loss (ecological shutdown) | Ecology score bar at 0, government notice event dialog, shutdown screen |

### 8.5 Level Visualization Protocol

This section defines how the implementing agent performs **manual visual validation** of the game's rendering at the level scale. These are the only non-automatic tests and must be executed before marking any rendering task complete.

#### Procedure

1. Start the dev server: `npm run dev &`
2. Run a full-level playthrough scenario:
   ```bash
   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npx tsx scripts/scenario-test.ts --scenario level3-playthrough-win
   ```
3. After the run, open every screenshot from the output directory using the `view` tool
4. Verify each checkpoint from the §8.4.2 table against the expected visual description
5. If any checkpoint fails visually → do **not** mark the task complete → fix the rendering issue → re-run

#### What to look for

| Issue | How to detect |
|-------|--------------|
| Missing terrain mesh | Black void where ground should be |
| Missing buildings | No structure visible at placed grid coordinates |
| Missing vehicles / employees | No characters visible in the 3D scene |
| Missing HUD / overlays | Score bars or cash counter absent from UI overlay |
| Wrong colors | Employee role colors, ore tints, building tier colors mismatched |
| Missing blast effects | No dust cloud, flash light, or fragment mesh during/after blast |
| Z-fighting | Flickering surfaces where two meshes overlap |
| Missing level-end screen | Win/loss UI absent after terminal condition reached |

#### Mandatory check cadence

| Trigger | Scenarios to run |
|---------|-----------------|
| After any terrain mesh change | `level1-playthrough-win.json` |
| After any building renderer change | `building-lifecycle.json` + `level2-playthrough-win.json` |
| After any employee / vehicle renderer change | `vehicle-traffic.json` + `level1-playthrough-win.json` |
| After any blast renderer change | `blast-overcharge.json` + `level3-playthrough-win.json` |
| After any UI / HUD change | All six level playthrough scenarios |
| Before merging any PR | All six level playthrough scenarios |

### 8.6 Regression Test Policy

Any bug fix must be accompanied by a new unit or integration test that would have caught the bug. The test must fail on the buggy code and pass on the fix. This is enforced via PR review checklist.

### 8.7 Test-Driven Workflow for New Features

For each atomic task in chapters 1–7:

1. Write the test first (red)
2. Implement the minimum code to pass (green)
3. Refactor for clarity if needed (refactor)
4. Run `npm run validate` to confirm no regressions
5. For visual changes: run the relevant scenario test and inspect screenshots per §8.5

### 8.8 Performance Benchmarks

The following benchmarks must pass as part of CI (failing marks the build as yellow, not red):

| Benchmark | Target | Measurement |
|-----------|--------|------------|
| A\* path on 100×100 grid | < 2ms per request | `performance.now()` in unit test |
| Full blast pipeline (500 voxels) | < 50ms | Unit test timing |
| NavGrid full rebuild (100×100) | < 10ms | Unit test timing |
| Frame tick at 8× speed, 20 agents | < 16ms | Integration test timing |
| Survey estimation (radius 20) | < 5ms | Unit test timing |
| Full-level integration test (Level 1 win path) | < 30s wall clock | CI timing |

### 8.9 Atomic Task Breakdown

| # | Task | File(s) | Test |
|---|------|---------|------|
| 8.1 | Add coverage reporter to `vitest.config.ts` (v8 provider, per-file thresholds matching §8.2) | `vitest.config.ts` | CI: coverage gate fails when a module is below threshold |
| 8.2 | Create `tests/integration/` and `tests/integration/full-level/` directories; add both to test runner config | `vitest.config.ts`, `package.json` | Smoke: both directories picked up by test runner |
| 8.3 | Add 10 small integration test suites (§8.3.1, ≥ 8 scenarios each) | `tests/integration/` | Each suite passes; all scenario variants exercise distinct code paths |
| 8.4 | Add 10 full-level integration tests (§8.3.2) | `tests/integration/full-level/` | Each test reaches the stated terminal condition with correct `levelEndReason` |
| 8.5 | Add 15 feature scenario JSON files (§8.4.1) | `scripts/scenario-defs/` | Scenario runner executes all without crash; state JSON reflects expected outcome |
| 8.6 | Add 6 full-level playthrough scenario JSON files (§8.4.2) | `scripts/scenario-defs/` | Each drives game to terminal state; screenshots captured at every checkpoint |
| 8.7 | Add performance benchmark suite | `tests/unit/benchmarks/` | All benchmarks meet targets; results logged to CI output |
| 8.8 | Add `npm run test:integration` and `npm run test:scenarios` scripts | `package.json` | Each script runs in full isolation without requiring the other |
| 8.9 | Update `npm run validate` to include integration tests and coverage gate | `package.json` | `npm run validate` exits 0 on clean repo; non-zero on coverage failure |
| 8.10 | Document test conventions and all script commands in `README.md` under a "Testing" section | `README.md` | Section covers all four test layers with example commands |
| 8.11 | Run all six level playthrough scenarios after final renderer integration; inspect screenshots per §8.5 | Manual step | All visual checkpoints (§8.5) verified by agent before marking complete |
