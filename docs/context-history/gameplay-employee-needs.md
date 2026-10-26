# History — gameplay-employee-needs

Records why the rules in the `gameplay-employee-needs` skill exist: the issues that introduced or changed each mechanic, measurements, decision reviews and earlier behaviour.

## Design Goals

- Original text: "Hunger and break pressure were removed as separate gauges (#928) — fatigue is the sole gauge, and its own drain/threshold/penalty constants were rescaled so the single gauge carries the well-being weight the old three-gauge sum used to."

## Need Gauge

- `traveling` drain tier: #928.

## Morale Effects of Needs

- The morale penalties were "rescaled 3× at #928 so the single gauge's per-tick range stays comparable to the old three-gauge sum."
- Comfort recovery, reason (#1778): "default site policy rests at 60 and in-place rests end at 70, so a working crew never exceeded 80 and morale latched at 0. Below 50 the penalties are unchanged".
- Rest-completion credit (#1801), reason: "A vehicle-work cycle (debris hauler: fatigue ~70 down to ~26, rests only at the depot) never enters the comfort band long enough, netting about -41 morale per ~44-tick cycle, so its driver stayed at 0 for the whole game."
- The `continuous` exclusion keeps the revolt scenarios revolting.

## Collapse

- Search radius scaling with level size: #458.

## Resting With No Building

- Why the no-building ceiling exists: "without the no-building ceiling, resting in the dirt for the same (doubled) duration would restore further still — building nothing would be the optimal play."
- Why a policy-forced rest is never doubled: "the policy's own premise is that it protects an employee regardless of site infrastructure, and every trigger already costs real, un-doubled ticks against whatever work it interrupts."

## Resting Inside a Building

- Resting inside a building: #1204, on the shared occupancy model of #1202.
- A mounted employee's rest behaved the same before #1204.

## Proactive Need Queuing

- `need_warning` toast: #1387.

## Injury and Recovery

- Timed injury: #1382.
- Injured employees' queues released: #1381.

## Rest and the evacuation rescue

- Evacuation rescue never cuts a rest: #1746.
- Huts in a spent zone serve rests again once the blast fires (#2089).

## Cost of Needs

- Fatigue rest was never charged, unlike the removed hunger/breakNeed gauges.

## Shift System

- Single always-on policy path: #1379.
- Original wording: "The old fixed-duration Tier 2+ path (`forceShiftRestIfNeeded`, `WORK_DURATION_TICKS`) is no longer called by the engine."
- Vehicle-work rest timing: #1673, #1709.
- Pacing (#1709), original text: "the former 8-tick shift sent the driller to rest after every hole (a 3x3 plan with quarters beside it took 208 ticks). Now it drills in 140 ticks (zero collapses at 12 m and 25 m)."
- Multi-hole plans and box-cut ramp completion: #945, #1090; livelock guard: #1118.
- `ticksWorked` reset on any completed rest: #1669.
- Forced but not-worthwhile rest taken in place: a 1 m/tick digger drove to a far hut for every rest (#2089).
- Rest destination skips quarters with no route; none reachable means resting in place: on the seed-42 full-kit ladder a driver left in a 70-cell crater pocket re-ordered a stuck walk to an unreachable hut every shift (#2091).

## Walk-survival guard

- Walk-survival guard: #928.

## Well-being score

- Damped well-being score: #1692.
- `WB_FATIGUE_COMFORT` at the comfortable line: #1778.
- Original text: "Zero morale still falls 1 per tick, so the revolt path is unchanged. Measured (busy crew of 8, 1000 ticks): peaks stay below 98 and T1 < T2 < T3; a crew of 30 on one T1 settles far lower."

## Types

- Revolt defeat tip naming the cause: #1421.
