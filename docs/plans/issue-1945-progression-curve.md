# Issue #1945: Progression curve (partial, measured)

Status: the `ladder` probe strategy plays grade 1 and grade 2 on the digger kit; it does not yet play the
ladder to grade 3, 4 or 5. No balance constant was tuned in this run: no lever could be shown to close a gap,
because the policy cannot reach the grades the levers act on. Every target below is reported with its measured
value. Measured with seed 42, desert_badlands, base commit `681dae65` plus the policy changes in
`scripts/shared/probe-strategies.ts` (probe code only; `src/` is unchanged).

## Rerun

```bash
npm run long -- start ldig -- npm run probe:progression -- --seed 42 --biome desert_badlands --kit digger --strategy ladder --horizon 12000 --json /tmp/ldig.json
npm run long -- start lfull -- npm run probe:progression -- --seed 42 --biome desert_badlands --kit full --strategy ladder --horizon 12000 --json /tmp/lfull.json
npm run long -- start sg1 -- npm run probe:progression -- --seed 42 --biome desert_badlands --kit full --strategy stay_g1 --horizon 10000 --json /tmp/sg1.json
npm run long -- wait ldig      # explicit timeout 600000 on every call; exit 75 = still running, call again
```

A 12,000-tick single run takes about 5 to 10 minutes on 4 cores with three runs in parallel.

To continue to the unmeasured grades (needs the policy fixes under "Follow-up"):

```bash
npm run long -- start full50k -- npm run probe:progression -- --seed 42 --biome desert_badlands --kit full --strategy ladder --horizon 50000 --json /tmp/full50k.json
```

## Measured

| run | g1 tick | g2 tick | g3 | cash@3000 | cash@6000 | cash@10000 | end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ladder / digger | 978 | 3762 | not reached | 2,425,498 | 3,845,282 | 7,440,251 | t12000 alive |
| ladder / full | 1088 | not reached | not reached | 2,254,615 | 5,025,009 | 8,487,902 | t12000 alive |
| stay_g1 / full | 1088 | n/a (capped) | n/a | 2,254,615 | 5,025,009 | 8,487,902 | t10000 alive |

Per grade (what the run showed; grades 3-5 were never reached, so those rows are targets only):

| grade | reference shot | fleet and crew | binding constraint (measured) | tick reached | cash at grade |
| --- | --- | --- | --- | --- | --- |
| 1 | 3x3 Krackle 4 kg, depth 5 (opening) then 4x4 7.5 kg depth 10 at the grade-1 limit | kit fleet, 5-6 crew | 2nd blast and 5 t delivered | digger 978, full 1088 | 635,743 / 593,425 |
| 2 | 4x4 120 kg (grade-1 limit), 10 m holes, 89 mm | kit fleet + fragmenter + licensed driver, 6 crew | ore delivered 30 t (~9 kg/tick delivered) and pit 10 m (needs the first crater cleared and a ramp to its floor) | digger 3762 (full: not reached) | 2,884,758 |
| 3 | not run | not run | ore 150 t (cumulative: `oreDeliveredKg` never resets) at ~9 kg/tick delivered is ~t16,700 absolute, ~12,900 ticks after grade 2 (t3762); depth 20 m needs a tier-2 rig, its licence and a ramp longer than the policy digs | - | - |
| 4 | not run | - | - | - | - |
| 5 | not run | - | - | - | - |

## Target against measured

| target (ladder, full kit, seed 42, desert_badlands unless noted) | measured | verdict |
| --- | --- | --- |
| grade 3 at t8,000-14,000 | not reached by t12000 (digger g2 at 3762; full stuck at g1) | MISSED, no value |
| grade 4 at t15,000-25,000 | not run | MISSED, not measured |
| grade 5 at t30,000-45,000 | not run | MISSED, not measured |
| catalog never fully bought | no run bought the whole catalog (`catalogBoughtTick` null in all three) | held, trivially (no tier-2/3 purchase was reached either) |
| >= 60% of boulder ore sells with a fragmenter (metric `boulderOreSoldShare`) | full kit ladder 68%, stay_g1 58%; digger ladder (bought fragmenter) 52% | full ladder met; stay_g1 58% missed by 2 points; digger 52% missed by 8 points |
| fragmenter run ahead of no-fragmenter run at t10000 | full ladder 8,487,902 vs digger ladder 7,440,251 | met, but the kits differ in more than the fragmenter |
| ladder ahead of stay_g1 at t10000 | 8,487,902 vs 8,487,902 | MISSED by 0: the full-kit ladder never leaves grade 1 (safety 38 of 40 at every interval it checked), so it plays the same game as stay_g1 |

## What the ladder policy fixed

- Bankruptcy at t7009: a driver was hired per equipment purchase (12 purchases, salaries about $1.5M by t4500). The ladder now upgrades a vehicle in place (`vehicle upgrade`, no new driver), only the rig, hauler and digger, only when cash stays above `LADDER_UPGRADE_RESERVE` ($150,000) and the vehicle is unreserved with a driver holding the next tier's licence. Digger kit: alive at t12000.
- `fragment_debris:no_licensed_driver`: the probe now builds a Driving Center, hires a driver and runs `employee train` (`earnLicence`), never `assign_skill`. Digger kit: the licence was held at t1000.
- Probe defects that stalled the run, fixed in the probe: a refused detonation (event blast ban) dropped the charged pattern forever; an evacuation stranding a worker left the pattern armed for thousands of ticks (now `blast cancel` and retry); a blaster who died left every charge order blocked (a replacement is hired); a hole charge sized by the grid, not the limit (an n x n pattern now takes limit / n^2 kg per hole).

## Why the run stops at grade 2 (measured, not tuned)

1. Deepening needs the crater clear and a ramp to its floor. Shots fired into a crater still holding rubble leave holes `buried_under_rubble`; deeper craters leave haul orders `debris_out_of_reach` and a worker who cannot leave the blast zone. Ramps dug per crater (tried) made it worse: income stalled and the run went bankrupt at t7389 to t10869 on both kits. `ladderCraterRamp` in `scripts/shared/probe-strategies.ts` is that per-crater ramp and IS committed: seeded with `rampedOrigins: 1` it skips only the opening crater and orders a ramp into every later crater. The measured figures in this document were not re-measured with it active, so they are not evidence for or against it; the bankruptcies above came from the variant tried before it was committed.
2. Safety 38 to 40 on the full kit: the grade-2 target (40) was met only on an interval boundary for the digger kit; the safety figures (38 to 40, 67) are read from console output, not a probe metric; a Management Office (safety equipment) lifted it to 67 in a trial but that variant also went bankrupt (item 1) and is not committed.
3. Delivered ore is about 9 kg/tick, so the grade-3 target (150 t) is ~t16,700 absolute (cumulative ore, ~12,900 ticks after grade 2) at the current rate; reaching grade 3 by t14,000 needs ~10.7 kg/tick (1.2x), by t8,000 ~18.8 kg/tick (2.1x), or a lower grade-3 ore target (first lever in the issue's order: `MINE_GRADES`). Not changed, because no run reached grade 3 to confirm the other grade-3 targets (depth 20, neighbours 35, no death in 1,000) would then bind later.

## Balance constants

No constant changed. Nothing in `src/core/config/balance.ts` moved, so no sandbox pin in
`tests/integration/sandbox-economy-balance.integration.test.ts` needed re-measuring, and no ordering pin was added
(the full-vs-digger ordering holds on one seed and one policy version; ladder-vs-stay_g1 is a tie).

## Follow-up scope

1. Pit access policy: clear a crater before deepening, then dig a ramp (or the spiral, #1940) to its new floor; keep one working pit. This is what stops the run at grade 2.
2. Safety and neighbour policy for grades 2 and 3 (Management Office, berms, barbecue events).
3. Then run `full50k` above, tune in the issue's order: `MINE_GRADES` ore/depth targets, `BUYER_*`, fees, `PERMIT_LIMITS`, and re-measure the sandbox pins that move.

## Update (#2041): pit-access policy, 50,000-tick probe

Seed 42, desert_badlands, probe code only (`scripts/shared/probe-strategies.ts`, `scripts/shared/probe-ladder-policy.ts`);
`src/` and every balance constant are unchanged, so no sandbox or campaign pin moved and none was re-measured.

Policy added to `ladder`: `decideLadderRamp` (a ramp once per new pit floor, `rampedFloorM`, cash reserve kept; ordered as soon as the yield is
measured, never gated on the rubble being cleared or a depth target being open: the ramp is how haulers reach the rubble, and a gate on
a clear crater stalled the Shareholder Summit competent run into a firing), `decideLadderSafety` (Management Office built/upgraded while a safety target is open),
a deepen only into a crater with no rubble and no pending haul over its footprint, and a refire of a charged pattern
whose shot was abandoned (see below).

Root cause found: an abandoned shot (refused or cancelled detonation, then the 3,000-tick timeout) left its holes charged and
unfired. The blast zone then stayed "threatened", every haul over it kept `evacuationHold`, no later shot could start
(`idle` false) and income stopped for thousands of ticks (full kit: stuck t4000-t10000 at pit 9.99 m). The ladder now fires
such a pattern again (`reinvestShot`, ladder only).

| run | g1 tick | g2 tick | g3 | cash@3000 | cash@6000 | cash@10000 | end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ladder / full, 12,000 | 1088 | 4102 | not reached | 2,494,173 | 3,390,837 | 6,697,581 | t12000 alive |
| stay_g1 / full, 12,000 | 1088 | n/a (capped) | n/a | 2,494,173 | 4,474,295 | 7,956,509 | t12000 alive |
| ladder / digger, 12,000 | 978 | 3742 | not reached | 2,898,815 | 4,724,856 | 7,476,141 | t12000 alive |
| ladder / full, 50,000 | 1088 | 4102 | not reached | 2,494,173 | 3,390,837 | 6,697,581 | bankrupt t22089 (cash@15000 6,145,920) |

| target | measured | verdict |
| --- | --- | --- |
| grade 3 at t8,000-14,000 | not reached (cumulative ore 117 t of 150 t at t16,250 in a trial; depth 12.1 m of 20 m) | MISSED, no value |
| grade 4 at t15,000-25,000 | not reached | MISSED |
| grade 5 at t30,000-45,000 | not reached | MISSED |
| ladder ahead of stay_g1 at t10,000 | 6,697,581 vs 7,956,509 | MISSED: the ladder pays the grade-2 fee, upgrades and a larger crew |
| fragmenter ahead of no-fragmenter at t10,000 | full ladder 6,697,581 vs digger ladder 7,476,141 | MISSED here (the kits differ in more than the fragmenter) |
| >= 60% boulder ore sold | full ladder 56%, stay_g1 60%, digger ladder 56% | stay_g1 met; ladder missed by 4 points |
| whole catalog never bought | `catalogBoughtTick` null in every run | held |

Why no constant was tuned: the policy still does not play the ladder past grade 2. Delivered ore is about 7 to 9 kg/tick, so
grade 5 (2,500 t, cumulative) is ~300,000 ticks away at that rate against a 30,000-45,000 target; no lever in the issue's order
(`MINE_GRADES` ore/depth, `BUYER_*`, fees, `PERMIT_LIMITS`) was shown to close a gap of that size on a run that never reaches
grade 3, and a blind retune of the ore targets would be unmeasured. Open policy defects (next run):

1. After grade 2 the 800 kg shots bury the pit in rubble the two haulers do not clear; deliveries stop (ore flat t15,500-t17,500 in a trial)
   while payroll keeps running, ending in bankruptcy at t22,089. A haul-capacity upgrade or a second hauler before the first deep shot, and a
   payroll-aware stop on shooting, are the candidates.
2. Trials that held fresh shots until the latest crater was cleared (one pit at a time, strictly) were worse: stay_g1 cash@10000 fell from 7.96 M to
   4.21 M and the digger kit lost grade 2. The committed policy deepens any clear crater and takes a fresh site otherwise.
3. Depth: the 10 m hole cap yields a pit of 9.99 m, a hair under the grade-2 depth target; only a second bench past the ramp satisfies it.
4. Neighbours (nuisance) has no probe action yet (`decideLadderSafety` returns `neighbours`, the ladder does nothing for it).

## Update (#2054): survive-the-50k attempt (partial, MISSED)

Seed 42, desert_badlands, full kit, `ladder`. Probe code only (`scripts/shared/probe-strategies.ts`, `probe-ladder-policy.ts`);
no balance constant, `MINE_GRADES`, `BUYER_*`, fee or `PERMIT_LIMITS` value moved, so no sandbox or campaign pin moved and the
grade table in `gameplay-game-design` is unchanged.

Traced (cash, delivered ore, rubble kg, haulers, payroll, unmet targets every 500 ticks). Findings:

1. At current `main` (`7810dff5` and later) the ladder does not reach grade 2 at all by t11,000 (the t4102 of #2041 is not reproducible): the grade-1
   depth target stops at 9.9917 m of 10 (10 m holes), and the fresh shots fired meanwhile bury the map (13,321 fragments, 2,668 queued hauls at t4,500).
2. Rubble is mostly unreachable: 6.99 M kg stays on the ground from t8,000 with only `debris_out_of_reach` orders, so an absolute rubble gate would hold forever.
3. After grade 2 each fresh limit-sized crater lies beyond the tier-1 hauler's ramp reach: shots fire (`shot` true) but ore delivered stays flat
   (109,350 kg from t7,500) while payroll (~720 per tick) drains ~830 per tick until bankruptcy.

Changes: `decideLadderShotGate` (grade >= 2; holds above `LADDER_GATE_RUBBLE_KG` = 500,000 kg of reachable rubble or under
`LADDER_GATE_RUNWAY_TICKS` = 1,500 ticks of payroll cash); reachable rubble counts only fragments with an unblocked haul order;
ladder hole depth 11 m (inside the 12 m tier-1 safe face) so the first deep pit clears 10 m; fresh shots only for the first full-depth pit, a cleared crater
or an idle crew; up to 6 haulers while cash is idle; a half-drilled pattern stuck for a step budget is dropped (`drill_plan clear` / `remove`).

| run (50,000 horizon) | g1 (ticks) | g2 (ticks) | g3-5 | cash peak | end |
| --- | --- | --- | --- | --- | --- |
| `main` before | 1088 | not reached by t11,000 | no | 2.9 M @ t4,000 | trace stopped t11,000 alive |
| after | 1088 | before t3,000 (pit 10.86 m) | no | 9.3 M @ t7,000 | bankrupt about t18,300, ore flat since t7,500 |

| target | measured | verdict |
| --- | --- | --- |
| survive 50,000 ticks | bankrupt about t18,300 | MISSED |
| grade 3 at t8,000-14,000 | not reached (ore 109 t of 150 t, pit 10.86 m of 20 m) | MISSED |
| grade 4 at t15,000-25,000 | not reached | MISSED |
| grade 5 at t30,000-45,000 | not reached | MISSED |
| ladder ahead of stay_g1 at t10,000 / fragmenter ahead / >= 60% boulder ore sold | not re-measured | MISSED, unmeasured |

Remainder (needs its own run): deepening craters stay out of hauler reach. A ramp (or tier-2 hauler upgrade) into every new crater before its
rubble is counted, or sizing shots to what the fleet hauls, must precede any `MINE_GRADES`/`BUYER_*` tuning.

## Update (#2060): ladder reach gate (partial, MISSED)

Seed 42, desert_badlands, full kit, horizon 50,000, measured with `scripts/progression-probe.ts`. Probe code only; no balance constant, sandbox pin
or campaign pin was touched, and the grade table in `gameplay-game-design` is unchanged.

Changes: `decideLadderReach` / `reachableShotDepthM` (`scripts/shared/probe-ladder-policy.ts`) wired into `ladderCraterRamp` / `ladderPlan`.

1. The ladder digs a ramp into each fresh crater from grade 2, capped at the fleet climb ratio.
2. Deepening shot hole depth shrinks when the crater ramp is steeper than the fleet climbs.
3. `debris_hauler` is no longer auto-upgraded to tier 2: tier 2 climbs 24 deg against 30 deg, and the fleet stood idle with 439 queued haul orders.
4. A drill hole unreachable by the rig drops the pattern and bars the site.
5. After 3 disarmed detonations the site is given up.

| run (50,000 horizon) | g1 | g2 | g3-5 | cash@10k | cash@15k | cash@25k | end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ladder before | n/a | n/a | no | n/a | n/a | n/a | bankrupt about t18,300 |
| ladder after | 968 | 2812 | not reached | 7.18 M | 3.21 M | n/a | bankrupt t19,139, delivered ore flat after about t7,500 |
| stay_g1 before | n/a | n/a (capped) | n/a | n/a | n/a | n/a | bankrupt t21,539 |
| stay_g1 after | n/a | n/a (capped) | n/a | 8.31 M | 4.72 M | n/a | bankrupt t23,039 |
| reinvest (unchanged) | 1178 | n/a | n/a | 6.65 M | 7.70 M | 3.10 M | bankrupt t31,779 |

| target | measured | verdict |
| --- | --- | --- |
| grade 3 at t8,000-14,000 | not reached | MISSED |
| grade 4 at t15,000-25,000 | not reached | MISSED |
| grade 5 at t30,000-45,000 | not reached | MISSED |
| ladder ahead of stay_g1 at t10,000 | 7.18 M vs 8.31 M | MISSED |
| fragmenter ahead of no-fragmenter at t10,000 | not measured | UNKNOWN |
| >= 60% boulder ore sold | not measured | UNKNOWN |

The ladder never reached grade 3; the values above are the closest measured.

Root cause of the remaining bankruptcy (remainder, needs its own run):

1. Orderless rubble: fragments sealed under intact ground (`sealedFragmentIdsOf` in `HaulDispatch`) never get a haul order, so `craterRubble === 0` never
   holds and deepening never starts. Excluding them in `craterRubble` stalled grade 1 (pit stayed 5 m, 26 shots) and was reverted; deepening needs its own gate.
2. Fresh shots on used-up ore ground hit barren 0-ore ground and add unhaulable rubble.
3. Ramp paths are unprotected from neighbouring blasts: a blast cut crater 1's ramp and trapped a hauler. Barring ramp paths from shot sites shrank
   the sites so grade 2 never came.
4. The `upgrade_first` branch maps to "dig a ramp" because tier 2 reduces the climb ratio.

## Update (#2062): probe-policy slice

Landed (probe code only, `scripts/shared/probe-ladder-policy.ts` and `scripts/shared/probe-strategies.ts`):

1. Deepen gate: `decideLadderDeepen` replaces the `craterRubble === 0` test. Sealed rubble no longer blocks deepening; ordered or reachable orderless rubble and a pending haul still do.
2. Barren-site skip: `decideFreshShotSite` skips fresh sites over used-up ground while ore remains elsewhere.
3. Ramp-corridor protection: `rampProtectionZones` / `shotOverlapsProtectedRamp` keep fresh shots off recorded ramp footprints, falling back when that would leave no site.
4. `fleetClimbRatio` uses the slowest hauler tier.
5. The `upgrade_first` branch of `decideLadderReach` is removed.

NOT done in this slice: tuning of `MINE_GRADES`, `BUYER_*`, fees and `PERMIT_LIMITS`, and the 50,000-tick survival measurement. No new measurement is
reported here. The remainder is filed as #2066.

## Update (#2066): measurement under the #2062 policy, no tuning landed (MISSED)

Seed 42, desert_badlands, measured with `scripts/progression-probe.ts`:

```
npm run probe:progression -- --seed 42 --biome desert_badlands --kit full   --strategy ladder  --horizon 50000
npm run probe:progression -- --seed 42 --biome desert_badlands --kit digger --strategy ladder  --horizon 12000
npm run probe:progression -- --seed 42 --biome desert_badlands --kit full   --strategy stay_g1 --horizon 10000
npm run probe:progression -- --seed 42 --biome desert_badlands --kit full   --strategy reinvest --horizon 10000
```

| run | g1 | g2-5 | cash@3k | cash@6k | cash@10k | cash@15k | boulder ore sold | end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ladder, full kit | 968 | not reached | 4.84 M | 10.62 M | 7.51 M | 3.25 M | 75% | bankrupt t18,589 |
| ladder, digger kit | 868 | not reached | 0.92 M | n/a | n/a | n/a | 0% | bankrupt t4,309 |
| stay_g1, full kit | 968 | capped | 4.84 M | 10.62 M | 7.51 M | n/a | 75% | t10,000 |
| reinvest, full kit | 1178 | n/a | 2.83 M | 4.60 M | 6.65 M | n/a | 39% | t10,000 |

| target | measured | verdict |
| --- | --- | --- |
| grade 3 at t8,000-14,000 | not reached | MISSED |
| grade 4 at t15,000-25,000 | not reached | MISSED |
| grade 5 at t30,000-45,000 | not reached | MISSED |
| ladder ahead of stay_g1 at t10,000 | 7.51 M vs 7.51 M (identical: the ladder never leaves grade 1) | MISSED |
| full kit ahead of digger kit at t10,000 | 7.51 M vs bankrupt at t4,309 | MET |
| >= 60% boulder ore sold | 75% | MET |
| ladder survives 50,000 ticks | bankrupt t18,589 | MISSED |

No `MINE_GRADES`, `BUYER_*`, `PERMIT_LIMITS`, sandbox pin or campaign pin changed. Tuning was not attempted: the ladder never reaches grade 2, so no grade-3-to-5
window can be measured, and retuning balance to route around a stalled probe policy would hide the defect.

Root cause (measured by instrumenting a 4,000-tick run; instrumentation reverted). Diagnosis superseded by the follow-up below: the real stall was hole depth, not the ramp gate.

1. Grade 2 needs depth 10 m; the pit stays at 5.02 m for the whole run (ore 55-69 k kg and safety targets are met by t3,500, cash is 5-9 M and idle).
2. `ladderCraterRamp` returns while `m.shot !== null`. With cash plentiful the next shot is ordered the tick after the last fires, so a shot is always pending
   and no ramp is ever ordered after the opening crater's. `needsWayIn` is also gated to grade >= `LADDER_GATE_MIN_GRADE` (2), unreachable here.
3. Deepening shots (`decideLadderDeepen`, sealed rubble ignored) then re-fire at a crater whose rubble is all sealed (365, then 660 fragments with no way in), adding sealed
   rubble and no depth.
4. `LADDER_SITE_ORE_FLOOR` (1 vs 20) and `LADDER_RAMP_PROTECT_MARGIN_M` (2 vs 6) changed nothing: depth 5.02 m in every combination at t3,500.
5. Removing both ramp gates orders a ramp into the second crater but income collapsed (3 blasts, 9 k ore, bankrupt t2,505): the ramp work starves the hauling crew. Reverted.

Remainder (superseded by the follow-up below; the ramp-sequencing idea is not what unblocked grade 2): make the ladder dig a way into each fresh crater without starving hauling (sequence the ramp between shots, or give ramp work its own
crew), then tune `BUYER_*`, `MINE_GRADES` and `PERMIT_LIMITS` against the g3/g4/g5 windows and the 50,000-tick survival.

### Follow-up (#2066): hole-depth fix, grade 2 reached (partial, MISSED)

Instrumented 4,000-tick runs found the real stall: the ladder drilled 11 m holes (`LADDER_HOLE_DEPTH_M`) with a grade-1 charge (120 kg). Under that much cover
the blast buries its rubble sealed and opens no crater (surface unchanged), so the pit stayed at 5.02 m and `orderRamp` found no depression to ramp into.
Hole depth sweep, pit depth at t4,000-5,500: 5 m -> 6.5 m, 7 m -> 8.2 m, 9 m -> grade 2 at t2,282, 10 m -> stalls at 9.99 m (just under the 10 m target), 11 m -> 5.02 m.

Probe changes (`scripts/shared/probe-strategies.ts`): the 9 m hole depth and the ungated way-in (`needsWayIn` in `ladderCraterRamp` no longer waits for
grade 2) apply to sandbox probe runs only (`sandboxRun`: no active campaign level). `LADDER_HOLE_DEPTH_M` no longer exists; it is split into
`LADDER_SANDBOX_HOLE_DEPTH_M` = 9 and `LADDER_CAMPAIGN_HOLE_DEPTH_M` = 11 (the old value), picked by `ladderHoleDepthM`. Campaign runs keep 11 m because the
volcanic_flats Shareholder Summit ends in a worker revolt with 9 m holes.
Boulder share: the earlier section above reports 75% (the ladder never left grade 1); this follow-up reports 55% over the whole 14,000-tick run, because the ladder now
progresses and the share is measured across more of the run.
No balance constant, sandbox pin or campaign pin changed (no balance tuning was reached).

| run | g1 | g2 | g3-5 | cash@3k | cash@6k | cash@10k | boulder ore sold | end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ladder, full, 14,000 horizon | 968 | 2372 | not reached | 4.24 M | 10.27 M | 14.45 M | 55% | t14,000, 6 blasts |
| ladder, digger, 12,000 horizon | 948 | 3092 | not reached | 2.15 M | n/a | n/a | 0% | bankrupt t5,989 |
| stay_g1, full, 10,000 horizon | 968 | capped | n/a | 4.77 M | 10.79 M | 14.01 M | 59% | t10,000 |
| reinvest, full (unchanged policy) | 1178 | n/a | n/a | 2.83 M | 4.60 M | 6.65 M | 39% | t10,000 |

| target | measured | verdict |
| --- | --- | --- |
| grade 3 at t8,000-14,000 | not reached by t14,000 | MISSED |
| grade 4 at t15,000-25,000 | not measured (horizon 14,000) | MISSED |
| grade 5 at t30,000-45,000 | not measured | MISSED |
| ladder ahead of stay_g1 at t10,000 | 14.45 M vs 14.01 M | MET |
| full kit ahead of digger kit at t10,000 | 14.45 M vs bankrupt t5,989 | MET |
| >= 60% boulder ore sold | 55% (ladder, whole run to t14,000); 82% at t4,000 | MISSED |
| ladder survives 50,000 ticks | not measured: the 50,000-tick run did not finish in over 90 minutes of wall clock | UNKNOWN |

Observations for the remainder: only 6 blasts in 14,000 ticks (each shot takes about 500 ticks to drill and charge), and a probe run past grade 2 becomes very slow
(a 14,000-tick run took about 40 minutes), so the g3 gate and `BUYER_*` / `MINE_GRADES` / `PERMIT_LIMITS` tuning need a faster loop, or the ladder needs
to fire more often once cash is idle. The digger ladder still goes bankrupt.

## 2026-10-22 record: ladder hole-depth policy (#2068)

With the #2068 hole-depth policy (`decideLadderHoleDepth`, dud barring, blocked-order rubble counts; fresh cap 9 m sandbox / 11 m campaign kept),
the 50,000-tick seed-42 desert_badlands full-kit ladder probe: g1@968, g2@2482, cash 10.54M @6000, 9.67M @10000, 6.13M @15000,
bankrupt at t23799 (low cash -86,300), g3 (window 8000-14000) missed; boulder ore sold 45%.
Shareholder Summit competent ladder (volcanic_flats, digger, seed 42) wins at tick 3461 (was 2981 on main).
Remaining: survival to 50,000 and g3+ are tracked in #2072.

## 2026-10-23 record (#2076)

Seed 42, desert_badlands, full kit, `scripts/progression-probe.ts`, ladder, 50,000 horizon. Probe policy only (scripts/); no balance constant, `MINE_GRADES`, `BUYER_*`,
fee or `PERMIT_LIMITS` value moved. Wired: `decideBuriedPattern` (drop a pattern buried 500 ticks, bar its hole bounding box), `decideLadderShotSide` (no grade cap and no sealed-rubble shrink: caps of 3-6 and the 100-fragment shrink each starved yield and ended the summit run in a worker revolt, #2080; shrink one step after a failed shot), `siteHoldsOre` (25% of the best site's ore), a 16 m building keep-out on fresh sites, and an
oldest-bar age-out when no site orders.

| run | g1 | g2 | g3-5 | cash@3k | cash@6k | cash@10k | cash@15k | boulder ore sold | end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ladder, 50,000 horizon | 968 | 2372 | not reached | 4.61 M | 10.35 M | 12.15 M | 8.88 M | 57% | bankrupt t28359 (low cash -73,033) |

| target | measured | verdict |
| --- | --- | --- |
| ladder survives 50,000 ticks | bankrupt t28359 (was t23799) | MISSED |
| grade 3 at t8,000-14,000 | not reached (pit 10.2 m of 20 m flat from t2,000) | MISSED |
| grade 4-5 | not reached | MISSED |

Findings from instrumented runs (instrumentation removed):

1. Before the building keep-out, shot 5 destroyed a building and well-being went 96 to 0: worker_revolt at t8520 with 10 M cash.
2. After g2 the pit sits at 10.2 m. Reachable rubble (1.0-1.1 M kg) clears at about 220 kg a tick, so the next shot waits to t7,300; then every crater on the 64 m map is
   barred, buried or sealed and `freshSites` returns no candidate (origins plus bars cover the map): the ladder fires 5 to 8 shots in 28,000 ticks and bleeds payroll.
3. Open: deepening existing craters is the only way left to gain depth; it needs a crater with no ordered rubble, and sealed rubble plus bars exclude every one.


## 2026-10-23 note: evacuation cancelled by rubble-boxed walker (#2077)

An armed detonation was cancelled "cannot leave the blast zone" when an in-zone employee was boxed in by rubble (`fragmentOccupancy > 0` on the neighbour cells).
`findSafeEvacuationCell` proved reachability with a relaxed `findPath`, but `Locomotion.planPath` used `findFootPathWithVehicleFallback`, whose fallback rejects
relaxed routes crossing fragment cells (#954/#1090), so the walker stuck and the phase read 'stranded'. `Zone.clearZone` now passes `crossFragments: true`; the flag is stamped on the leg
(`Leg.crossesFragments`) so the cost estimate and the executor agree. Every other caller keeps the fragment guard; blocked/void rings stay stranded.

## 2026-10-23 re-measure on merged main (#2076)

Branch policy (`decideBuriedPattern`, `decideLadderShotSide`, `siteHoldsOre`, building keep-out) merged with main's #2077 (evacuating walkers cross rubble), #2082 (auto access ramp) and #2084 (g2 shot side keeps limit size).
Seed 42, desert_badlands, full kit, ladder, horizon 50,000, no balance constant moved. Probe policy unchanged by this re-measure.

| run | g1 | g2 | g3-5 | cash@3k | cash@6k | cash@10k | cash@15k | blasts | boulder ore sold | end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ladder, 50,000 horizon | 968 | 2452 | not reached | 4.29 M | 9.91 M | 7.75 M | 3.82 M | 4 | 51% | bankrupt t19908 (low cash -69,456, final cash below zero) |

| target | measured | verdict |
| --- | --- | --- |
| ladder survives 50,000 ticks | bankrupt t19908 (was t28359 before the main merge) | MISSED |
| grade 3 at t8,000-14,000 | not reached | MISSED |
| grade 4-5 | not reached | MISSED |

Limit: only 4 blasts fire in 19,900 ticks, so after g2 income is flat while payroll drains about 9 M by t15,000. Deepening needs a crater with no ordered rubble; no ore yield or depth arrives to
lift the grade-3 gate. Not fixable from probe policy alone without per-tick instrumentation (a run costs about 12 minutes of wall clock); the remaining lever is the balance side (`MINE_GRADES`,
`BUYER_*`, payroll vs. income) tracked in #2072 / #2063. #2076 lands the policy pieces and tests; survival and g3 stay open under #2072.

## 2026-10-23 instrumented iteration (#2076)

Seed 42, desert_badlands, full kit, `ladder`, probe policy only (`scripts/shared/probe-strategies.ts`, `probe-ladder-policy.ts`); no balance constant moved.
New permanent diagnostics: `PROBE_DIAG=1 [PROBE_DIAG_TICKS=1000] npm run probe:progression ...` prints a `[diag tN]` line (grade, blasts, pit, cash, payroll/tick,
idle crew, rubble kg, reachable rubble kg, ore delivered, haul orders, pattern state, crater rubble ordered/orderless/sealed, shot plan cost, fleet and drivers,
blocked orders by reason) and a `[diag-act tN]` line (pending orders by type, active orders, per-employee fatigue/rest/queue) to stderr.

Findings (each read off the diagnostics, not guessed):

1. Licence stall (fixed). `ladderEquipment` upgraded all six haulers to tier 2 around the one driver holding the tier 2 licence; when he left the roster every haul
   order read `licence_level_too_low`, ore delivered froze at 113,250 kg from t7500 and payroll drained the cash to bankruptcy. Haulers are no longer upgraded
   (`LADDER_UPGRADE_ROLES`), as the comment above it always claimed.
2. Degenerate gentle ramp (fixed). The tier 2 "gentle" ramp over a 10 m crater found no start outside the crater at a buildable length and was ordered from the crater's
   own rim (1 m deep, `target_unreachable` for good). It recorded a gentle slope for the crater, so `ladderCraterRamp` believed the crater had a way in and never ordered a
   real one. `rampStartsInsideCrater` now refuses such starts; `dropStaleRamp` cancels a ramp unreachable for `LADDER_STALE_RAMP_TICKS`, bans its lane and forgets it.
   Neither changed the outcome: the replacement ramp segments also read `target_unreachable`.
3. Not a policy lever: after 4 limit-sized shots (about 1 M kg of rubble each) 3.1 to 3.7 M kg lies on the 64 m map; about 1.1 M kg of haul orders are `debris_out_of_reach`
   and 945 fragments of the deepest crater are sealed. Haulers clear what they reach by t6000 to t7000 (ore 110 k of the 150 k needed), then no reachable rubble remains,
   income is zero, the crew idles (9 of 11 resting or idle) and fresh shots fail: the last charge hole of every pattern is unreachable among rubble, the pattern is
   dropped after 500 ticks and reordered. The ramp digger cannot reach any ramp segment (`dig_ramp_segment:target_unreachable`), so the sealed crater is never opened and
   the pit stays at 10.2 m of the 20 m grade-3 target.
4. Twelve haulers (tried, reverted): reachable rubble is gone by t4000, ore stalls at 58 k and the run is bankrupt by t9000. Six stay.
5. t2000 to t6000 the ladder fires no shot while cash climbs from 2.4 M to 9.9 M: `wanted` is false (no cleared crater, haulers busy, pit at the hole depth). Firing
   there only adds rubble no hauler reaches (finding 3), so it was not changed.

| run | g1 | g2 | g3-5 | cash@6k | cash@10k | cash@15k | blasts | end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ladder, 50,000 horizon (final) | 968 | 2452 | not reached | 9.91 M | 7.60 M | 3.34 M | 4 | bankrupt t18899 (low cash -76,828) |

| target | measured | verdict |
| --- | --- | --- |
| ladder survives 50,000 ticks | bankrupt t18899 (was t19908) | MISSED |
| grade 3 at t8,000-14,000 | not reached (pit 10.2 m of 20 m, ore 110 k of 150 k kg) | MISSED |

Blocker for the remainder: reachability of rubble and ramp segments after limit-sized grade-1 shots (`OrderReachability` / `CraterAccessSync`, #2082), not the probe policy.
The ladder has no income once the reachable rubble is hauled; payroll alone (about 650 a tick) outlasts about 15,000 ticks of the 10 M peak. The Shareholder Summit
competent integration test still passes (wins at 2901 ticks).

## 2026-10-23 note: stranded crater access (#2085)

After #2082 the ladder probe stalled at ~10.2 m: blocked `dig_ramp_segment` orders suppressed every later access ramp and ~1,000 `debris_out_of_reach` haul orders never cleared.
`syncCraterAccess` now ignores blocked segments (`hasLiveRampWork`), has the planner avoid footprints of fully blocked ramps (`blockedRampFootprints` -> `planCraterAccess(..., avoid)`),
and cancels debris orders of floors unplannable for `CRATER_ACCESS_ABANDON_DEBRIS_TICKS` (`pruneAbandonedDebris`; fragments marked so dispatch does not re-queue them until the next access ramp is ordered).
Ramp reachability already ignores fragment occupancy and drive legs cross fragments, so no reachability change was needed. Rules: `gameplay-navmesh`, "Crater access".

Probe after #2085 (seed 42 desert_badlands full ladder, 14,000-tick horizon): still g1@968, g2@2452, bankrupt t11,919 after 4 blasts; the 20 m depth is NOT reached.
Instrumented diagnosis (instrumentation reverted): the only `rock_digger` ends parked, driverless, on a crater floor (surface 8.5 m) cut off from the site network by the unfinished ramp. `fillPool` in `OrderReachability.ts` counts a vehicle as an
actor only when its driver is a candidate or its cell is in the employees' on-foot reach, so every `dig_ramp_segment` reads `target_unreachable` (all 44-57 segments blocked) even though a climb labelling from the digger itself reaches the targets.
Nobody can board the digger, so the ramp that would free it can never be dug: a deadlock that planner avoidance and debris pruning cannot resolve. Separately, a probe-placed Driving Center at (8,8) walls the rally yard on this seed.

## 2026-10-24 note: spoil overflow heap, probe result (#2085, second part)

`ladderSpoil` now also builds a spoil heap (up to `LADDER_MAX_SPOIL_HEAPS`) when queued `haul_debris` orders are blocked `spoil_heap_full` (`pendingSpoilOverflowKg > 0`).

Probe, seed 42 desert_badlands, full ladder, 14,000-tick horizon:

| g1 | g2 | g3 | bankruptcy | blasts | cash@6000 | cash@10000 | boulder sold share | boulder ore sold | warehouseFull | end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 978 | 2272 | missed (window 8,000-14,000) | none (was bankrupt t20,509) | 7 | 10.15 M | 9.28 M | 51% | 45% | tick 805 | t14000 |

Pit depth was not recorded by the probe table, so it is not stated here.

Verdict: 20 m / grade 3 still not reached within 14,000 ticks. The bankruptcy is gone, but the next stall is unmeasured. Cash is not the limit (9-10 M idle).
Next step: a pit-depth and stall diagnosis.
