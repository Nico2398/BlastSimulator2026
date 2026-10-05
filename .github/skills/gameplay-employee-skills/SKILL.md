---
name: gameplay-employee-skills
description: >
  Employee skills and task queue system for BlastSimulator2026: skill categories,
  proficiency levels (1-5), XP gain, task duration formula, pending-action pool,
  ghost preview rendering, and in-scene task progress bars. Use when implementing
  or modifying employee qualifications, task dispatch, action queuing, or
  proficiency mechanics.
---

## Design Philosophy

Employees not interchangeable tokens. Each has skill qualifications with proficiency levels, executes queued work autonomously.

- **Every physical action is queued, not instant.** Commands → global pending-action pool → each idle-or-eligible-busy qualified employee auto-claims the cheapest reachable action for them, not the first one in the pool.
- **Pending actions show 3D ghost.** Semi-transparent blue fresnel-effect mesh at target position — distinguishes pending from completed.
- **Working actions show a progress bar.** Billboarded fill above the employee, tracking `taskProgressFraction` (`src/core/entities/EmployeeActivity.ts`) from empty to full over the task's duration — distinguishes "busy" from "idle" once the ghost's action is claimed.
- **No qualified employee = immediate error** (not silent queue). Fired when zero employees have required skill.
- **Some tasks require vehicle.** Hauling + drilling require employee to board vehicle of appropriate role.

## Skill Categories

| Category | Required for | Training building |
|----------|-------------|-------------------|
| `driving.<vehicle_role>` | Operating vehicles of that role | Driving Center |
| `blasting` | Charging holes, setting sequences, monitoring blasts | Blasting Academy |
| `management` | Contract negotiation, hiring/firing, policy setting | Management Office |
| `geology` | Seismic, core-sample, and aerial surveys | Geology Lab |

## Proficiency Levels & Effects

| Level | Label | Task duration multiplier |
|-------|-------|------------------------|
| 1 | Rookie | ×1.00 (baseline) |
| 2 | Competent | ×0.85 |
| 3 | Skilled | ×0.70 |
| 4 | Expert | ×0.55 |
| 5 | Master | ×0.40 |

XP gain per tick of active work: `xpPerTick = 1 + floor(currentLevel * 0.5)`

An action's XP award is a list, not a single slot — `computeTaskXpAwards` (`src/core/entities/EmployeeXpRules.ts`) evaluates two independent rules per tick: a non-null `requiredSkill` grants that skill category, and a non-null `requiredVehicleRole` additionally grants the licence category `ROLE_LICENCE_REQUIRED[role]` maps it to (`src/core/entities/VehicleDriverAssignment.ts`). An action can carry both fields — `drill_hole` grants blasting and driving.drill_rig XP in the same tick — or just one: `survey` grants geology only, `haul_debris` grants driving.truck only, `fragment_debris` grants driving.excavator only. Every award uses the same `xpPerTick` formula above, keyed to the employee's current proficiency in that award's own category (default level 1 if unqualified in it yet).

## Task Duration Formula

```
ticksRequired = baseDuration / (proficiency_multiplier * wellbeing_multiplier * event_multipliers)
```

**Wellbeing modifiers** (multiplicative):

| Condition | Multiplier |
|-----------|-----------|
| Well-fed | ×1.00 |
| Hungry (overdue) | ×0.80 |
| Starving (severely) | ×0.60 |
| Well-rested | ×1.00 |
| Sleep-deprived | ×0.75 |
| Exhausted | ×0.50 |
| Living Quarters Tier 3 bonus | ×1.10 |
| Living Quarters Tier 1 | ×0.90 |

**Event modifiers** are temporary multipliers injected by the event system (e.g., "Union Happy Hour +20%", "Heatwave −15%"). Listed in the employee detail panel with source.

## Pending-Action Pool & Ghost Preview

`src/core/state/GameState.ts` declares `PendingAction`, `PendingActionStatus`, `ActionType` and `GhostPreview`, and is the only authority on their fields and on which action types exist. Read it before queueing or claiming an action — the pool grows a type per feature, so a list written down anywhere else is already short.

A `PendingAction` has a lifecycle, not a single claimed/unclaimed bit: `queued` (unclaimed, `holderId: null`) → `assigned` (claimed, employee en route) → `in_progress` (employee working it) → exits the pool via completion or cancellation, the two ways an action's lifecycle ends. `claimPendingAction` (`src/core/engine/TaskDispatch.ts`) transitions `status`/`holderId` in place; `completePendingAction` removes the action from the pool on normal completion. `cancelAction` (same file) removes it at any stage — queued, assigned, or in-progress — releases the holder employee (if any) back to idle, and refunds order-time costs via `addIncome`; it refuses engine-owned `rest` actions, which are not player-cancellable. Both completion and cancellation call the shared `clearActiveTaskFields(emp)` helper to reset the employee's active-task state.

**Claim logic (each tick, `tickEmployees` in `src/core/engine/GameLoop.ts`) — cost-based, not first-come-first-served:**
1. Employees process in ascending id order for determinism. Each idle-or-eligible-busy employee picks the lowest-total-cost `queued` action it qualifies for, via `selectBestActionForEmployee` (`src/core/engine/ActionSelection.ts`): an optional `isClaimable` predicate (e.g. a vehicle-role licence check) first filters the whole candidate pool, before ranking and before the attempt budget — a candidate that categorically can't be claimed is never counted against the budget. The surviving candidates rank by `estimateActionCost` (octile-heuristic travel + work-duration estimate), ties broken by lowest `action.id`, then only the top `ACTION_SELECTION_MAX_PATH_ATTEMPTS` of them get a real `findPath` cost via `resolveActionCost` — the first reachable one wins. An action every attempted candidate reports unreachable leaves the employee idle that tick, retried next tick.
2. An action with `targetEmployeeId` set is claimed only by that employee, eagerly and without cost ranking (never contested) — up to `MAX_EMPLOYEE_TASK_QUEUE_DEPTH`. A vehicle-gated action still passes the same vehicle-role licence gate as the open-pool path: `findVehicleForClaim` (`src/core/engine/VehicleReservation.ts`) is shared by both of `GameLoop.ts`'s claim sites, and a targeted claim that fails it stays queued, retried next tick — see `gameplay-vehicle-fleet` for the licence/reservation mechanism itself.
3. Each employee holds at most one active action plus a bounded personal `taskQueue: number[]` (action ids) — total active+queued capped at `MAX_EMPLOYEE_TASK_QUEUE_DEPTH` (`src/core/config/balance.ts`). A busy employee reserves at most one open-pool candidate ahead per tick into `taskQueue`, so a personal queue builds up gradually rather than all at once.
4. An action is exclusive to whichever employee holds it — no two employees ever race the same `PendingAction`.
5. If NO *living* employee with the skill exists on the roster → the action goes into `unqualified` and raises the unqualified-task event (see below). An injured, training or about-to-train holder is only temporarily unavailable: the action waits (non-blocking `no_qualified_employee` warning), no event (#1380).
6. On claim: `status` moves to `assigned` (then `in_progress` once work starts), `holderId` set to the claiming employee — the action and its ghost stay in place, nothing is deleted.
7. Any count of "unclaimed work" (e.g. `OperationsPanel`) filters `status === 'queued'`, never plain presence in `state.pendingActions`.

**Unqualified-task event (#1380):** raised once per blocked action, not every tick — `detectUnqualifiedTask` keeps `events.raisedUnqualifiedActionIds` (pruned to ids still blocked each tick; a newly blocked action raises it again) and stamps the event with every blocked id (`unqualifiedActionIds`). Options act on those actions (`src/core/events/UnqualifiedTaskEffects.ts`):
- **Cancel the Task:** each id is cancelled (`cancelAction`, order cost refunded) and its planned entry released (`releasePlannedOrderForCancelledAction`, `CancelledOrderCleanup.ts`).
- **Hire a Contractor:** costs `UNQUALIFIED_CONTRACTOR_FEE`, debited once by the option's `cashDelta`. A synthetic, off-roster contractor (rank 1 in the skill, no XP) applies the completion effects (`applyTaskCompletion`) of each blocked action of a supported type (`general_work`, `survey`, `drill_hole`, `charge_hole`, `place_building`, `level_ground`); other types stay queued. If nothing could be done the fee is returned and the `_alt` outcome shows.
- **Send Someone to Training:** books the first blocked action's skill with the best school on site for the lowest-id employee who is alive, not injured, not training and below Master in it; the course fee is debited as `plan.fee` like `employee train`. No school, candidate, cash or free seat: nothing is booked (`_alt`). The action stays queued until the course finishes.

**Ghost rendering:** For every `PendingAction`, renderer creates a blue fresnel-effect translucent mesh with pulsing animation, tracked via `GhostPreview.claimed`. Claiming sets `claimed: true` — the ghost stays blue but renders dimmer and pulses slower (`src/renderer/GhostMesh.ts`) to distinguish claimed from unclaimed work without removing it. The ghost is removed when the action completes or is cancelled.

**Red ghost (unreachable work, #1306):** a queued, unclaimed action's ghost is red (`GhostPreview.unreachable`, derived, never saved) when none of the actors able to perform *that* action can reach its target, or no such actor exists. Cost is still charged and nothing is refused — the player simply sees work nobody can do. A claimed ghost is never red.
- **Actors are per action** (`src/core/engine/OrderReachability.ts`, grouped by `orderActorKey`: `requiredSkill`, `requiredVehicleRole`, `targetEmployeeId`): any alive rostered employee when there is no skill; with a role, employees licensed for it holding the skill, paired with a vehicle of that role; with a target employee, only that one. Alive and on the roster is enough — injured, resting, training, striking or busy actors still count, so a ghost never flips red on a break. Dead, fired, sold or destroyed ones do not.
- **Reach** is a climb-aware fill from all candidate actors at once (`computeClimbReachableSetFromSources`, `NavGridReachability.ts`): one fill per distinct actor key at employee clearance, plus one at vehicle clearance for role keys (vehicles usable when their driver is aboard or an actor can walk to them). Cost scales with the grid and the number of distinct keys, never with the number of actors. No `freight_warehouse` anchor is involved.
- **Ramps:** every queued layer of a ramp takes the verdict of its first not-done layer (the one next to dig), so layers waiting behind a half-dug layer never flicker red; if that layer is already claimed, its own ghost is blue and the layers behind it follow the verdict of its target.
- **Update paths:** `tickEmployees` re-classifies every tick (`classifyQueuedOrders`, which also stamps `blockedReason`: `target_unreachable` for player orders, `debris_out_of_reach` for auto debris, the existing `no_*` reasons when no actor exists); a new order is classified in `dispatchPendingAction`; commands run while paused re-classify through `ConsoleRunner`'s `afterCommand` hook (`refreshOrderReachability`, no events); a load re-classifies after the nav grid is rebuilt. `ghostPreviewsRevision` bumps only when a colour flips. The renderer swaps the material in place on the same mesh.
- Colours and opacities are the `GHOST_UNREACHABLE_*` constants in `GhostMesh.ts`; the red hue sits >= 15 degrees from the building exit marker and >= 30 degrees from the ramp arrow.

- **Decisions (#1306):** a vehicle counts as an actor's tool when its driver (a candidate) is aboard or a candidate can walk to it, regardless of reservation or damage; warning reasons `no_vehicle_in_fleet` / `no_licensed_driver` / `no_qualified_employee` keep their pre-existing meaning (employees able to work *now*), and only apply when no reachability warning does; the hologram stands at the footprint's own position at the approach cell's surface height.

**Building hologram (#1306):** a `place_building` ghost carries `GhostPreview.building` (`type`, `tier`, `x`, `z`, taken from `PlannedBuilding`) and draws that building's own model (`instantiateBuildingModel`, `BuildingMesh.ts`) with the shared ghost material on every mesh — blue, dimmer when claimed, red when unreachable — centred on its footprint exactly like the real building. The footprint box stands in until the model has loaded (`GhostMesh.refreshModels` on a library revision change). Shared model geometry is never disposed by the ghost.

**Cancellation (player-initiated):** Console command `employee cancel <id>` and the Operations panel's "Work Queue" section (`src/ui/panels/OperationsPanel.ts`, one row per live player-cancellable action, Cancel button; engine-owned `rest` actions excluded) both call `cancelAction`. Any count of "unclaimed work" or live actions filters by `status`, same as claim logic below.

**Task progress rendering:** For every employee whose `computeEmployeeActivity` reads `kind: 'working'`, `TaskProgressBar` (`src/renderer/TaskProgressBar.ts`) billboards a fill bar above the character, parented under its `CharacterMesh.getGroup(id)` transform so it tracks position without per-frame copying. Fill fraction comes from `taskProgressFraction`, shared with the Crew panel's own progress line so the two never disagree. Removed when the task ends.

## Salary Calculation

Salary = base + sum of qualification level bonuses. Multi-skilled employee costs more than single-skill specialist.

## Work & Rest Policies

| Policy | Description |
|--------|-------------|
| `shift_8h` | Standard 8h work, 8h rest. Low fatigue accumulation. |
| `shift_12h` | Long shift. Faster output but fatigue builds; requires higher-tier Living Quarters. |
| `continuous` | No enforced breaks. Maximum short-term output; employees degrade rapidly. |
| `custom` | Player sets individual rest thresholds per employee. |

Meals auto-scheduled at hunger threshold (default: eat when hunger < 40). Break times follow same configurable threshold.

## Employee Detail Panel (UI)

Shows: name, portrait, skill qualifications with proficiency stars, current task, time remaining, task queue (5 entries, reorderable), need meters (Hunger/Fatigue/Social/Comfort), active modifiers with source, salary breakdown, XP progress per qualification.

## Types

`src/core/entities/Employee.ts` declares `Employee`, `SkillQualification`, `SkillCategory` and `TrainingState`, and is the only authority on their fields. Read it before writing against an employee — the record carries the whole dispatch state machine (claimed action, pending arrival, rest, movement), not only the fields this spec discusses.

`taskQueue` holds `PendingAction` ids beyond the claimed one, bounded by `MAX_EMPLOYEE_TASK_QUEUE_DEPTH` and executed in cheapest-next order recomputed from the employee's current position — the order is not fixed at enqueue time.

