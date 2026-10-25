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

Fatigue is the sole gauge; its drain, threshold and penalty constants carry the whole well-being weight.

## Need Gauge

The employee has one gauge, `fatigue` (0–100; 100 = fully rested), on `Employee` in `src/core/entities/Employee.ts`. It fills by resting (at Living Quarters, or in place with a penalty — see below) and drains every tick at a rate selected by the employee's current work state (`NEED_DRAIN_RATES.fatigue` in `src/core/config/balance.ts`):

| Work state | Drain/tick | When it applies |
|-----------|-----------|------------------|
| `working` | −2 | Actively performing a task |
| `idle` | −0.5 | Not working, not resting, not traveling toward anything claimed |
| `traveling` | −1 | Walking toward a claimed task or rest destination, not yet arrived (`pendingTaskDuration` or `pendingRestDuration` !== null) |
| `resting` | 0 | Actively resting (`restTicksRemaining` !== null) — holds steady so accrued drain can't outpace the completion-time replenishment |

`tickNeedGauges` (`src/core/entities/EmployeeNeeds.ts`) selects the tier via the `EmployeeWorkState` union (`'working' | 'idle' | 'resting' | 'traveling'`, also exported from `Employee.ts`). The `traveling` tier is symmetric in both directions — it applies identically whether the employee is walking to start a task or walking to start a rest, and only for the walk itself; once arrived, drain switches to `working` or `resting` respectively.

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

(`needsMoraleEffect`, `NEED_MORALE_EFFECT_THRESHOLDS`, `NEED_MORALE_EFFECT_PENALTIES`.)

Fatigue above 80 (`NEED_WELL_RESTED_THRESHOLD`) → **"well-rested" bonus**: +1 morale/tick (`NEED_WELL_RESTED_BONUS`). Fatigue in the comfortable band [50, 80] → **comfort recovery**: +0.1 morale/tick (`NEED_COMFORT_MORALE_RECOVERY`); it replaces, never stacks with, the well-rested bonus. Below 50 the penalties above apply; injured employees stay at 0.

**Rest-completion credit.** When a **policy-forced** rest completes (`payload.triggeredBy === 'shift_cycle_policy'`, `ForceShiftRest.ts`), morale gains `REST_COMPLETION_MORALE_CREDIT` (+50, clamped to 100; `restCompletionMoraleCredit`, applied by `creditPolicyRestMorale` in both completion paths). Gated on `sitePolicy.fatigueRestThreshold >= NEED_MORALE_EFFECT_THRESHOLDS.comfortable` (50): `continuous` (threshold 0) gets none. Collapse, soft-threshold and interrupted rests, and injured employees, get nothing.

## Collapse

Two threshold states exist per gauge: a **soft threshold** (`NEED_SOFT_THRESHOLDS`, see Proactive Need Queuing below) that never interrupts, and a **hard threshold** (`NEED_HARD_THRESHOLDS`) that interrupts immediately. The hard threshold is always exactly the gauge's own zero floor — not a separately tunable balance number — so a new `NeedKey` gets collapse behaviour for free at 0 without picking its own value.

When fatigue hits its hard threshold (`NEED_HARD_THRESHOLDS.fatigue` = 0):

1. Current task immediately interrupted — `interruptActiveAction` (`src/core/engine/TaskDispatch.ts`) returns it to the pool as `queued`, not discarded; work-in-progress ticks are preserved, not restarted. Reclaimed later via the normal cost-based dispatch (`gameplay-employee-skills`), by this employee or another qualified one.
2. `rest` task self-claimed for the employee — targeting nearest available Living Quarters
3. Employee flagged `collapsing: true` — effectiveness drops to 0 until rest completes
4. On `rest` completion: `collapsing` cleared, interrupted task reclaimable again

| Collapsed Gauge | Rest Building | Rest Duration (ticks) |
|----------------|--------------|----------------------|
| `fatigue` | Living Quarters | 8 (`NEED_REST_DURATIONS.fatigue`) |

If no suitable building within the search radius (`needRestSearchRadius` — `max(20, gridWidth / 4)`, scaling with level size): employee collapses in place, rest duration doubled.

Rest duration itself only starts counting down once the employee physically arrives at the building (or, resting in place, immediately) — walking there is separate travel time on top of the duration, arrival-gated per `dev-architecture`'s arrival-gated-actions convention.

## Resting With No Building

An employee whose need has no building to service it — none built, or the nearest beyond the search radius — rests where they stand. Two penalties apply, and together they keep an empty site strictly worse than a Tier 1 one:

| Penalty | Value | Constant |
|---------|-------|----------|
| Gauge ceiling | rest tops the gauge out at 70, never higher | `NEED_REST_NO_BUILDING_CAP` |
| Duration | ×2 the same rest at a building | `NEED_REST_NO_BUILDING_DURATION_MULTIPLIER` |

A gauge already above the ceiling is left alone, not pulled down to it. Per-visit cost still applies (currently $0 — see Cost of Needs below). A rest at a building applies its tier's replenishment rate once per tick of the rest's own duration (`completeRestForEmployee` — Tier 1's 8/tick × the 8-tick fatigue rest duration, capped at `MAX_NEED_GAUGE`).

A policy-forced rest (`forceShiftRestIfNeededByPolicy`, see Shift System below) is the one exception: it never doubles duration for lacking a building.

## Building Replenishment Rates

| Building | Tier 1 | Tier 2 | Tier 3 |
|---------|--------|--------|--------|
| Living Quarters (fatigue) | +8 fatigue/tick | +14 fatigue/tick | +20 fatigue/tick |

(`BUILDING_REPLENISH_RATES.fatigue`.) A full living_quarters (occupants plus everyone already walking there, `isRestBuildingFull`) is never offered by the nearest-building search — the next nearest one with a free bed wins. When every living_quarters is full, the no-building degraded rest above applies (capped gauge, doubled duration) — the same fallback as no living_quarters existing at all.

## Resting Inside a Building

A rest targeting a living_quarters walks the employee to its ring and inside it, unseen for the whole stay — the same occupancy model buildings and vehicles share: `Building.occupantIds`, `Employee.locomotion: {kind:'inside', buildingId}`, admitted and released by `Mount.ts`'s `enterBuilding`/`leaveBuilding`. `completeRestForEmployee` puts them back out on a free ring cell (`leaveBuildingIfInside`) once the rest completes; a building destroyed mid-rest ejects them the same generic way every other occupant is (`releaseOccupantsOfRemovedBuildings`) — no rest-specific handling. A mounted employee's rest never enters a building at all — mount continuity (see Shift System below) takes priority.

## Proactive Need Queuing

Auto-insert a rest task at the soft threshold — don't wait for the hard threshold (Collapse, above):

| Gauge | Soft Threshold | Auto-Insert Behaviour |
|-------|------------------|----------------------|
| `fatigue` | 25 (`NEED_SOFT_THRESHOLDS.fatigue`) | Insert `rest(living_quarters)` after current task if not already queued |

`need_warning` (toast to the player) fires only when the queue is full (`employeeQueueDepth >= MAX_EMPLOYEE_TASK_QUEUE_DEPTH`) and no rest is queued yet, once per episode (`Employee.needWarningLatched`, cleared when no gauge is below threshold). The rest is still inserted. A rest already queued is skipped (`rest_action_already_queued`) with no warning.

**Soft-threshold contract:** hitting it never interrupts — the employee finishes the action already in progress. The queued rest then wins priority over any other action once the employee next goes idle, or when actions are claimed in the same dispatch batch (`EmployeeDispatchSteps.ts`).

## Injury and Recovery

Injury is a timed state, not a permanent one. `injureEmployee` sets `injured`, starts `injuryTicksRemaining = INJURY_RECOVERY_TICKS` (48) and costs `INJURY_MORALE_PENALTY` (20) morale once; injuring an already-injured employee is a no-op. `healEmployee` clears the timer; `killEmployee` clears it too. `injuryHoursRemaining` (`Employee.ts`) is the UI read: `ceil(remaining)`, `null` when healthy; Crew panel tag tip and detail card show it (`ui.crew.injured_back_in`).

- **Recovery tick:** `tickInjuryRecovery` (`engine/InjuryRecovery.ts`) runs once per tick after `tickCollapse`, before `autoInsertNeedTasks`. It drops the active non-rest action (`interruptActiveAction`), then counts the timer down. A missing counter (save without it) is backfilled lazily.
- **Bed routing:** an injured employee on foot with no itinerary walks to the nearest free-bed `living_quarters` (`findNearestBuildingOfType`, `moveTo` with `allowUnreachable`). Mounted employees recover in place at the on-foot rate. No living quarters: recover where they stand.
- **Speed-up:** progress per tick is `INJURY_ON_FOOT_RECOVERY_RATE` (1) anywhere, or `INJURY_RECOVERY_RATE_BY_LQ_TIER` (1: 2, 2: 3, 3: 4) while inside a living quarters of that tier. At <= 0 the employee heals and leaves the building.
- **Frozen needs:** `tickNeedGauges` returns early for injured employees (no fatigue drain) and `needsMoraleEffect` returns 0 (morale held). They stay in `computeAverageMorale`.
- **Work:** injured employees are not dispatched; queued non-rest work returns to the pool (`releaseInjuredEmployeesQueues`).
- **Tunables** (`balance.ts`): `INJURY_RECOVERY_TICKS`, `INJURY_MORALE_PENALTY`, `INJURY_ON_FOOT_RECOVERY_RATE`, `INJURY_RECOVERY_RATE_BY_LQ_TIER`.

## Rest and the evacuation rescue

An armed blast fetches a licensed employee to drive a parked vehicle out of the danger zone, but never cuts their rest: a resting licence holder (`restTicksRemaining` or `pendingRestDuration` set) is awaited and ordered by the next periodic re-evacuation after the rest ends. An employee busy with work is not awaited; another free licence holder is used or the vehicle stays stranded. Detail in `gameplay-vehicle-fleet`.

A living quarters inside a zone still being evacuated, or still threatened by a live plan, is no rest destination (`findNearestBuildingOfType`): the rest is taken in place. The zone lifts the moment its blast fires, so the crew back at work in the crater rests in the huts there again.

## Cost of Needs

Flat per-visit cost, not tier-scaled (`NEED_REST_COSTS` in `src/core/config/balance.ts`):

| Building | Need Gauge | Cost per Visit |
|---------|-----------|---------------|
| Living Quarters | fatigue | $0 (included in salary) |

## Shift System

A single policy path runs, always in force: `processShiftCycle` (`ShiftCycle.ts`) calls `forceShiftRestIfNeededByPolicy` (`ForceShiftRest.ts`) for every alive, non-injured employee (injured ones are recovering, see Injury and Recovery), regardless of building tier or whether the player ever applied a policy. A new game's default policy (`shift_8h`, threshold 60, `revision` 0) is therefore live from tick 0. A Tier 1 Living Quarters, or no building at all (rest in place), is a valid rest destination. `state.sitePolicy.revision` counts explicit player applications only (`set_policy`, Operations panel) and never gates the engine. `shouldForceRest` (`src/core/entities/SitePolicy.ts`) trips on either of two conditions, evaluated per shift mode (`shift_8h`, `shift_12h`, `continuous`): the timed modes force rest once `ticksWorked` reaches the shift duration (20 or 30 working ticks — `SHIFT_DURATIONS_TICKS`, rationale beside the constants); every mode also force-rests once fatigue falls to or below the policy's threshold, default 60 (`SITE_POLICY_DEFAULT_THRESHOLD`). The engine does not call the fixed-duration Tier 2+ path (`forceShiftRestIfNeeded`, `WORK_DURATION_TICKS`).

Vehicle work: a worker rests before fatigue runs out, counting the time of the trip they will actually take. They finish the job in hand: mid-execution of vehicle-gated work is never interrupted, and mid-drive to a vehicle-gated target the policy defers only while `fatigue - restTripFatigueCost >= NEED_REST_ARRIVAL_FATIGUE_FLOOR (5) + NEED_VEHICLE_JOB_FATIGUE_ALLOWANCE (15)`. Once the gauge no longer covers the trip the drive-phase deferral ends and the rest starts. At an idle job boundary a forced rest is not deferred by a queued same-role follow-up: the worker rests, then the follow-up is claimed. A rest the policy forces although the round trip is not worthwhile (`restRoundTripWorthwhile` false: the uncovered vehicle job, or an expired shift between vehicle jobs) is taken in place rather than at the far building.

Rest trip rule (`chooseRestTrip`, `RestActionHelpers.ts`): the faster of walking and driving. On foot: walk. Mounted: drive only when the `estimate` itinerary from `planItinerary` is strictly fewer ticks than walking from where the vehicle stands (`AGENT_WALK_SPEED`); a tie walks. A slow vehicle (the drill rig, 1 m/tick against walking's 2) is therefore parked where it stands (`alightIfMounted`, the occupancy writer stays `Mount.ts`) and the worker walks to the quarters; a driver who may not alight (loaded haul, `canReleaseDriver`) drives. `beginRestTravel` executes the choice, with no same-role mount continuity on the walking path. There is no explicit return step: once the rest ends, ordinary dispatch of the interrupted job plans the board leg back to the parked vehicle. `restTripFatigueCost` and `restRoundTripWorthwhile` cost the chosen trip, so the trigger covers the trip taken (an unplannable trip counts as covered). Collapse is the extreme case only: no reachable rest building, or a worker stuck with no route; `tickCollapse` is the last-resort floor, not the intended backstop. Walking time grows with the distance to the quarters, which is the player's layout lever. Pacing: `SHIFT_DURATIONS_TICKS.shift_8h` = 20 working ticks (30 for `shift_12h`), longer than one rig job (~8-13 worked ticks), so a driller covers about two holes per rest. An idle rig left on a work cell is not an obstacle: `relocateIdleDestinationBlocker` (`Locomotion.ts`) moves a parked rig, with its idle driller aboard, to the nearest free cell when another mover needs that cell (a charging truck reaching the last hole). Multi-hole plans and the box-cut ramp must still complete (the livelock guard holds because execution stays protected).

A completed rest of any origin (collapse, need restoration, soft-threshold, policy-forced) resets `ticksWorked` to 0 (`tickGeneralRestCompletion`); an interrupted or discarded rest does not.

### Walk-survival guard

`forceShiftRestIfNeededByPolicy` (`src/core/engine/ForceShiftRest.ts`) skips an employee who is mid-walk toward an already-claimed task (`pendingTaskDuration !== null`) rather than yanking them into a rest walk instead — a proactive/forced rest never cancels a walk to a job the employee has already committed to. The one exception is a genuinely stuck walk (`emp.isMoveStuck`, set by `EntityMovementTick.ts`): an employee whose claimed destination has become unreachable (e.g. boxed in by a building placed after the walk was claimed) is exempted from the guard, so they remain eligible for this function's own rescue-to-living-quarters path instead of being left defenseless against whatever danger they happen to be stuck in.

## Well-being score

The well-being score (0-100, `updateScores` in `src/core/scores/ScoreManager.ts`, helper `wellBeingDelta`) is a defeat condition, so one cheap Living Quarters must not pin it at 100. Per tick: gain `g` = positive building effect x `WB_BUILDING_GAIN` + (avg morale - 50)+ x `WB_MORALE_GAIN_PER_POINT`; loss `l` = (50 - avg morale)+ x `WB_MORALE_LOSS_PER_POINT`. Once a Living Quarters gives a positive building effect, gains are damped by headroom `clamp((100 - wb) / WB_HEADROOM_SPAN, 0, 1)`, so each housing tier settles at its own equilibrium below 100 (T1 ~94, T3 higher); a site with no positive building effect climbs undamped, keeping the early buffer an unhoused crew has against a morale crash. Losses and a negative building effect are never damped. Drags subtract every tick: overwork `WB_OVERWORK_DRAG_MAX` x `computeCrewFatigueStrain` (mean over living, non-injured crew of `clamp((WB_FATIGUE_COMFORT - fatigue) / WB_FATIGUE_COMFORT, 0, 1)`; `WB_FATIGUE_COMFORT` = 50, the morale `comfortable` line, so a crew cycling 60-70 under the default policy takes no overwork drag), crowding `WB_CROWDING_DRAG_MAX` x the unhoused share of the crew ((crew - beds) / crew when crew exceeds `getBedCapacity`, 0 with no Living Quarters since the absent-housing path already pulls), and `WB_ACCIDENT_DRAG` per accident of the last 10 ticks. Then the usual decay toward 50. Zero morale falls 1 per tick. Target (busy crew of 8, 1000 ticks): peaks stay below 98 and T1 < T2 < T3; a crew of 30 on one T1 settles far lower.

## Types

The single `fatigue` gauge (0–100) and `collapsing` live on `Employee` in `src/core/entities/Employee.ts`, alongside the rest state the needs system drives — `restTicksRemaining`, `restNeedKey`, `pendingRestDuration`, `pendingRestNeedKey`, `ticksWorked`. `NeedKey` (currently just `'fatigue'`) and `EmployeeWorkState` (`'working' | 'idle' | 'resting' | 'traveling'`) are defined in `src/core/entities/EmployeeNeeds.ts` and re-exported from `Employee.ts`. That file is the authority on their names and shapes; thresholds and rates are in `src/core/config/balance.ts`.

The worker-revolt defeat tip names the real cause (`revoltCause`, `src/core/scores/RevoltCause.ts`): continuous shift mode -> `no_rest_policy` (highest precedence), else no active Living Quarters -> `no_housing`, else `morale_drain`; the level-end screen shows `ui.level_end.defeat.worker_revolt.tip.<cause>`.

History: docs/context-history/gameplay-employee-needs.md
