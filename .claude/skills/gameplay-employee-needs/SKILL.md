---
name: gameplay-employee-needs
description: >
  Employee needs system for BlastSimulator2026: single fatigue gauge, morale effects, collapse
  and interruption, proactive queue insertion, building replenishment and shift cycles. Use when
  implementing or modifying employee well-being, rest mechanics, living quarters replenishment,
  or shift systems.
---

## Design Goals

One biological need — fatigue — modelled as a gauge that drains over time and is satisfied by resting, ideally at a building. Unmet need drains morale, reduces effectiveness, causes collapse. Connects to Buildings (Ch.1) + Task Queue (Ch.3).

Hunger and break pressure were removed as separate gauges (#928) — fatigue is the sole gauge, and its own drain/threshold/penalty constants were rescaled so the single gauge carries the well-being weight the old three-gauge sum used to.

## Need Gauge

The employee has one gauge, `fatigue` (0–100; 100 = fully rested), on `Employee` in `src/core/entities/Employee.ts`. It fills by resting (at Living Quarters, or in place with a penalty — see below) and drains every tick at a rate selected by the employee's current work state (`NEED_DRAIN_RATES.fatigue` in `src/core/config/balance.ts`):

| Work state | Drain/tick | When it applies |
|-----------|-----------|------------------|
| `working` | −2 | Actively performing a task |
| `idle` | −0.5 | Not working, not resting, not traveling toward anything claimed |
| `traveling` | −1 | Walking toward a claimed task or rest destination, not yet arrived (`pendingTaskDuration` or `pendingRestDuration` !== null) |
| `resting` | 0 | Actively resting (`restTicksRemaining` !== null) — holds steady so accrued drain can't outpace the completion-time replenishment |

`tickNeedGauges` (`src/core/entities/EmployeeNeeds.ts`) selects the tier via the `EmployeeWorkState` union (`'working' | 'idle' | 'resting' | 'traveling'`, also exported from `Employee.ts`). The `traveling` tier (#928) is symmetric in both directions — it applies identically whether the employee is walking to start a task or walking to start a rest, and only for the walk itself; once arrived, drain switches to `working` or `resting` respectively.

**Rate modifiers** — applied to the selected tier's base rate (`getMoraleDrainMultiplier`, `NEED_MORALE_DRAIN_MULTIPLIERS`, `MORALE_THRESHOLDS`):
- Morale > 70: drain rate ×0.85
- Morale < 30: drain rate ×1.20

Productivity is also reduced directly by low fatigue (`getNeedMultiplier`, `NEED_THRESHOLDS.fatigue`, `NEED_PRODUCTIVITY_MULTIPLIERS.fatigue`): below 40 → ×0.75 effectiveness, below 15 → ×0.50.

## Morale Effects of Needs

```
moraleEffect = needPenalty(fatigue)

needPenalty(g):
  g >= 50: 0     (comfortable)
  g >= 30: −1.5  (uncomfortable)
  g >= 15: −4.5  (suffering)
  g <  15: −9.0  (critical — approaching collapse)
```

(`needsMoraleEffect`, `NEED_MORALE_EFFECT_THRESHOLDS`, `NEED_MORALE_EFFECT_PENALTIES` — rescaled 3× at #928 so the single gauge's per-tick range stays comparable to the old three-gauge sum.)

Fatigue above 80 (`NEED_WELL_RESTED_THRESHOLD`) → **"well-rested" bonus**: +1 morale/tick (`NEED_WELL_RESTED_BONUS`).

## Collapse

When fatigue hits its collapse threshold (`NEED_COLLAPSE_THRESHOLDS.fatigue` = 5):

1. Current task immediately interrupted — `interruptActiveAction` (`src/core/engine/TaskDispatch.ts`) returns it to the pool as `queued`, not discarded; work-in-progress ticks are preserved, not restarted. Reclaimed later via the normal cost-based dispatch (`gameplay-employee-skills`), by this employee or another qualified one.
2. `rest` task self-claimed for the employee — targeting nearest available Living Quarters
3. Employee flagged `collapsing: true` — effectiveness drops to 0 until rest completes
4. On `rest` completion: `collapsing` cleared, interrupted task reclaimable again

| Collapsed Gauge | Rest Building | Rest Duration (ticks) |
|----------------|--------------|----------------------|
| `fatigue` | Living Quarters | 8 (`NEED_REST_DURATIONS.fatigue`) |

If no suitable building within the search radius (`needRestSearchRadius` — `max(20, gridWidth / 4)`, scaling with level size, #458): employee collapses in place, rest duration doubled.

Rest duration itself only starts counting down once the employee physically arrives at the building (or, resting in place, immediately) — walking there is separate travel time on top of the duration, arrival-gated per `dev-architecture`'s arrival-gated-actions convention.

## Resting With No Building

An employee whose need has no building to service it — none built, or the nearest beyond the search radius — rests where they stand. Two penalties apply, and together they keep an empty site strictly worse than a Tier 1 one:

| Penalty | Value | Constant |
|---------|-------|----------|
| Gauge ceiling | rest tops the gauge out at 70, never higher | `NEED_REST_NO_BUILDING_CAP` |
| Duration | ×2 the same rest at a building | `NEED_REST_NO_BUILDING_DURATION_MULTIPLIER` |

A gauge already above the ceiling is left alone, not pulled down to it. Per-visit cost still applies (currently $0 — see Cost of Needs below). A rest at a building applies its tier's replenishment rate once per tick of the rest's own duration (`completeRestForEmployee` — Tier 1's 8/tick × the 8-tick fatigue rest duration, capped at `MAX_NEED_GAUGE`); without the no-building ceiling, resting in the dirt for the same (doubled) duration would restore further still — building nothing would be the optimal play.

A policy-forced rest (`forceShiftRestIfNeededByPolicy`, see Shift System below) is the one exception: it never doubles duration for lacking a building — the policy's own premise is that it protects an employee regardless of site infrastructure, and every trigger already costs real, un-doubled ticks against whatever work it interrupts.

## Building Replenishment Rates

| Building | Tier 1 | Tier 2 | Tier 3 |
|---------|--------|--------|--------|
| Living Quarters (fatigue) | +8 fatigue/tick | +14 fatigue/tick | +20 fatigue/tick |

(`BUILDING_REPLENISH_RATES.fatigue`.) Building full → employee waits in queue (gauge drains at normal rate for its current work state while waiting). Route to next nearest if no capacity.

## Proactive Need Queuing

Auto-insert a rest task at the warning threshold — don't wait for collapse:

| Gauge | Warning Threshold | Auto-Insert Behaviour |
|-------|------------------|----------------------|
| `fatigue` | 25 (`NEED_WARNING_THRESHOLDS.fatigue`) | Insert `rest(living_quarters)` after current task if not already queued |

Queue full → skip auto-insert + emit `need_warning` event for player.

## Cost of Needs

Flat per-visit cost, not tier-scaled (`NEED_REST_COSTS` in `src/core/config/balance.ts`):

| Building | Need Gauge | Cost per Visit |
|---------|-----------|---------------|
| Living Quarters | fatigue | $0 (included in salary — fatigue rest was never charged, unlike the removed hunger/breakNeed gauges) |

## Shift System

Two shift paths exist, selected by whether a site policy has been applied (`state.sitePolicy.revision > 0`):

- **No policy applied (legacy):** gated on a Living Quarters Tier 2+ existing anywhere on site. If so, an 8-tick shift cycle activates: employees work 6 ticks (`WORK_DURATION_TICKS`) → automatically enter an 8-tick sleep rest (`SHIFT_SLEEP_DURATION_TICKS`) at Living Quarters (any tier ≥2). `employee_shift_change` fires at shift boundaries. Without a Tier 2+ Living Quarters, employees remain awake indefinitely (fatigue accumulates faster with no shift-forced rest, though proactive queuing and collapse still apply).
- **Policy applied:** runs for every alive, non-injured employee regardless of building tier — a Tier 1 Living Quarters, or no building at all, is a valid rest destination under a policy, not a disqualifier (`SitePolicy.ts`, `ForceShiftRest.ts`'s `forceShiftRestIfNeededByPolicy`). `shouldForceRest` (`src/core/entities/SitePolicy.ts`) trips on either of two conditions, evaluated per shift mode (`shift_8h`, `shift_12h`, `continuous`, `custom`): the timed modes force rest once `ticksWorked` reaches the shift duration (8 or 12 ticks — `SHIFT_DURATIONS_TICKS`); every mode also force-rests once fatigue falls to or below the policy's threshold, default 60 (`SITE_POLICY_DEFAULT_THRESHOLD`), overridable per-employee in `custom` mode (`customThresholds`).

### Walk-survival guard (#928)

Both `forceShiftRestIfNeeded` and `forceShiftRestIfNeededByPolicy` (`src/core/engine/ForceShiftRest.ts`) skip an employee who is mid-walk toward an already-claimed task (`pendingTaskDuration !== null`) rather than yanking them into a rest walk instead — a proactive/forced rest never cancels a walk to a job the employee has already committed to. The one exception is a genuinely stuck walk (`emp.isMoveStuck`, set by `EntityMovementTick.ts`): an employee whose claimed destination has become unreachable (e.g. boxed in by a building placed after the walk was claimed) is exempted from the guard, so they remain eligible for this function's own rescue-to-living-quarters path instead of being left defenseless against whatever danger they happen to be stuck in.

## Types

The single `fatigue` gauge (0–100) and `collapsing` live on `Employee` in `src/core/entities/Employee.ts`, alongside the rest state the needs system drives — `restTicksRemaining`, `restNeedKey`, `pendingRestDuration`, `pendingRestNeedKey`, `ticksWorked`. `NeedKey` (currently just `'fatigue'`) and `EmployeeWorkState` (`'working' | 'idle' | 'resting' | 'traveling'`) are defined in `src/core/entities/EmployeeNeeds.ts` and re-exported from `Employee.ts`. That file is the authority on their names and shapes; thresholds and rates are in `src/core/config/balance.ts`.
