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

| run (50,000 horizon) | g1 | g2 | g3-5 | cash peak | end |
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
| fragmenter ahead of no-fragmenter at t10,000 | not met | MISSED |
| >= 60% boulder ore sold | not met | MISSED |

The ladder never reached grade 3; the values above are the closest measured.

Root cause of the remaining bankruptcy (remainder, needs its own run):

1. Orderless rubble: fragments sealed under intact ground (`sealedFragmentIdsOf` in `HaulDispatch`) never get a haul order, so `craterRubble === 0` never
   holds and deepening never starts. Excluding them in `craterRubble` stalled grade 1 (pit stayed 5 m, 26 shots) and was reverted; deepening needs its own gate.
2. Fresh shots on used-up ore ground hit barren 0-ore ground and add unhaulable rubble.
3. Ramp paths are unprotected from neighbouring blasts: a blast cut crater 1's ramp and trapped a hauler. Barring ramp paths from shot sites shrank
   the sites so grade 2 never came.
4. The `upgrade_first` branch maps to "dig a ramp" because tier 2 reduces the climb ratio.
