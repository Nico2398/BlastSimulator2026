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

- **Every physical action is queued, not instant.** Commands → global pending-action pool → free qualified employee auto-claims.
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

```typescript
export interface PendingAction {
  id: number;
  type: ActionType;
  status: 'queued' | 'assigned' | 'in_progress';
  holderId: number | null;  // employee id once claimed, else null
  requiredSkill: SkillQualification;
  requiredVehicleRole: VehicleRole | null;  // null = on-foot task
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

A `PendingAction` has a lifecycle, not a single claimed/unclaimed bit: `queued` (unclaimed, `holderId: null`) → `assigned` (claimed, employee en route) → `in_progress` (employee working it) → exits the pool via completion or cancellation, the two ways an action's lifecycle ends. `claimPendingAction` (`src/core/engine/TaskDispatch.ts`) transitions `status`/`holderId` in place; `completePendingAction` removes the action from the pool on normal completion. `cancelAction` (same file) removes it at any stage — queued, assigned, or in-progress — releases the holder employee (if any) back to idle, and refunds order-time costs via `addIncome`; it refuses engine-owned `rest` actions, which are not player-cancellable. Both completion and cancellation call the shared `clearActiveTaskFields(emp)` helper to reset the employee's active-task state.

**Claim logic (each tick):**
1. For each `PendingAction` with `status: 'queued'`, scan idle employees for matching `requiredSkill`
2. If `requiredVehicleRole` non-null, also verify a qualified vehicle+driver is available
3. If NO employee with the skill exists on roster at all → emit `UnqualifiedTaskError` immediately
4. If qualified employees exist but all temporarily busy → wait silently (no error)
5. On claim: `status` moves to `assigned` (then `in_progress` once work starts), `holderId` set to the claiming employee — the action and its ghost stay in place, nothing is deleted
6. Any count of "unclaimed work" (e.g. `OperationsPanel`) filters `status === 'queued'`, never plain presence in `state.pendingActions`

**Ghost rendering:** For every `PendingAction`, renderer creates blue fresnel-effect translucent mesh with pulsing animation, tracked via `GhostPreview.claimed`. Claiming sets `claimed: true` — the ghost stays blue but renders dimmer and pulses slower (`src/renderer/GhostMesh.ts`) to distinguish claimed from unclaimed work without removing it. The ghost is removed when the action completes or is cancelled.

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

## TypeScript Reference

```typescript
export interface SkillQualification {
  category: SkillCategory;
  proficiencyLevel: 1 | 2 | 3 | 4 | 5;
  xp: number;
}

export interface Employee {
  id: number;
  name: string;
  qualifications: SkillQualification[];
  salaryPerTick: number;
  taskQueue: PendingAction[];
  // Need meters (Ch.7):
  hunger: number;
  fatigue: number;
  breakNeed: number;
  collapsing: boolean;
}
```

