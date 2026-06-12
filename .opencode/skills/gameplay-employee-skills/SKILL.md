---
name: gameplay-employee-skills
description: >
  Employee skills and task queue system for BlastSimulator2026: skill categories,
  proficiency levels (1-5), XP gain, task duration formula, pending-action pool,
  and ghost preview rendering. Use when implementing or modifying
  employee qualifications, task dispatch, action queuing, or proficiency mechanics.
---

## Design Philosophy

Employees not interchangeable tokens. Each has skill qualifications with proficiency levels, executes queued work autonomously.

- **Every physical action is queued, not instant.** Commands → global pending-action pool → free qualified employee auto-claims.
- **Pending actions show 3D ghost.** Semi-transparent blue fresnel-effect mesh at target position — distinguishes pending from completed.
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

**Claim logic (each tick):**
1. For each unclaimed `PendingAction`, scan idle employees for matching `requiredSkill`
2. If `requiredVehicleRole` non-null, also verify a qualified vehicle+driver is available
3. If NO employee with the skill exists on roster at all → emit `UnqualifiedTaskError` immediately
4. If qualified employees exist but all temporarily busy → wait silently (no error)

**Ghost rendering:** For every `PendingAction`, renderer creates blue fresnel-effect translucent mesh with pulsing animation. Ghost removed on claim.

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

