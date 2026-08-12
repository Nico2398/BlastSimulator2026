---
name: gameplay-employee-needs
description: >
  Employee needs system for BlastSimulator2026: 3 need gauges (hunger, fatigue, break pressure),
  morale effects, collapse and interruption, proactive queue insertion, building replenishment
  and shift cycles. Use when implementing or modifying employee
  well-being, rest mechanics, living quarters replenishment, or shift systems.
---

## Design Goals

3 biological needs modelled as gauges — fill over time, satisfied by visiting buildings. Unmet needs drain morale, reduce effectiveness, cause collapse. Connects to Buildings (Ch.1) + Task Queue (Ch.3).

## Need Gauges

Each employee has three gauges (0–100; 100 = fully satisfied):

| Gauge | Fills at | Drains at | Collapse Threshold |
|-------|----------|------------|-------------------|
| `hunger` | Eating at Living Quarters | −1/tick (working) / −0.5/tick (idle) | ≤ 10 |
| `fatigue` | Sleeping at Living Quarters | −0.5/tick (awake) / −2/tick (active task) | ≤ 5 |
| `breakNeed` | Taking break at Living Quarters | −0.8/tick (working) | ≤ 15 |

**Rate modifiers:**
- High morale (>70): drain rate ×0.85
- Low morale (<30): drain rate ×1.20

## Morale Effects of Needs

```
moraleEffect = Σ_need [ needPenalty(gaugeValue) ]

needPenalty(g):
  g >= 50: 0 (comfortable)
  g >= 30: −0.5/tick (uncomfortable)
  g >= 15: −1.5/tick (suffering)
  g <  15: −3.0/tick (critical — approaching collapse)
```

All needs above 80 simultaneously → **"well-rested" bonus**: +1 morale/tick (max 100).

## Collapse

When any gauge hits its collapse threshold:

1. Current task immediately interrupted — `interruptActiveAction` (`src/core/engine/TaskDispatch.ts`) returns it to the pool as `queued`, not discarded; work-in-progress ticks are preserved, not restarted. Reclaimed later via the normal cost-based dispatch (`gameplay-employee-skills`), by this employee or another qualified one.
2. `rest` task self-claimed for the employee — targeting nearest available building of the correct type
3. Employee flagged `collapsing: true` — effectiveness drops to 0 until rest completes
4. On `rest` completion: `collapsing` cleared, interrupted task reclaimable again

| Collapsed Gauge | Rest Building | Rest Duration (ticks) |
|----------------|--------------|----------------------|
| `hunger` | Living Quarters | 2 |
| `fatigue` | Living Quarters | 8 |
| `breakNeed` | Living Quarters | 3 |

If no suitable building within 20 cells: employee collapses in place, rest duration doubled.

Rest duration itself only starts counting down once the employee physically arrives at the building (or, resting in place, immediately) — walking there is separate travel time on top of the duration, arrival-gated per `dev-architecture`'s arrival-gated-actions convention.

## Resting With No Building

An employee whose need has no building to service it — none built, or the nearest beyond 20 cells — rests where they stand. Two penalties apply, and together they keep an empty site strictly worse than a Tier 1 one:

| Penalty | Value | Constant |
|---------|-------|----------|
| Gauge ceiling | rest tops the gauge out at 70, never higher | `NEED_REST_NO_BUILDING_CAP` |
| Duration | ×2 the same rest at a building | `NEED_REST_NO_BUILDING_DURATION_MULTIPLIER` |

A gauge already above the ceiling is left alone, not pulled down to it. Per-visit cost still applies. Without the ceiling, resting in the dirt would restore a full gauge while a Tier 1 living_quarters restores about 11 — building nothing would be the optimal play.

## Building Replenishment Rates

| Building | Tier 1 | Tier 2 | Tier 3 |
|---------|--------|--------|--------|
| Living Quarters (hunger) | +12 hunger/tick | +18 hunger/tick | +25 hunger/tick |
| Living Quarters (fatigue) | +8 fatigue/tick | +14 fatigue/tick | +20 fatigue/tick |
| Living Quarters (breakNeed) | +10 breakNeed/tick | +16 breakNeed/tick | +22 breakNeed/tick |

Building full → employee waits in queue (gauges drain at normal awake rate while waiting). Route to next nearest if no capacity.

## Proactive Need Queuing

Auto-insert rest tasks at warning thresholds — don't wait for collapse:

| Gauge | Warning Threshold | Auto-Insert Behaviour |
|-------|------------------|----------------------|
| `hunger` | 35 | Insert `rest(living_quarters)` after current task if not already queued |
| `fatigue` | 25 | Insert `rest(living_quarters)` after current task if not already queued |
| `breakNeed` | 30 | Insert `rest(living_quarters)` after current task if not already queued |

Queue full → skip auto-insert + emit `need_warning` event for player.

## Cost of Needs

Flat per-visit cost, not tier-scaled (`NEED_REST_COSTS` in `src/core/config/balance.ts`):

| Building | Need Gauge | Cost per Visit |
|---------|-----------|---------------|
| Living Quarters | hunger | $50 |
| Living Quarters | fatigue | $0 (included in salary) |
| Living Quarters | breakNeed | $20 |

## Shift System

If player builds a **Living Quarters Tier 2+**, an 8-tick shift cycle activates:
- Employees work 6 ticks → automatically enter 8-tick sleep rest at Living Quarters
- `employee_shift_change` event fired at shift boundaries
- Without Living Quarters Tier 2+: employees remain awake indefinitely (fatigue accumulates faster)

## TypeScript Reference

```typescript
// Fields added to Employee interface (Ch.3):
export interface Employee {
  // ... existing fields ...
  hunger: number;       // 0–100
  fatigue: number;      // 0–100
  breakNeed: number;    // 0–100
  collapsing: boolean;
}
```

