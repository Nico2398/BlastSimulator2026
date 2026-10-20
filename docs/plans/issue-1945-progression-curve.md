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
| 3 | not run | not run | ore 150 t at ~9 kg/tick delivered is ~16,700 ticks after grade 2; depth 20 m needs a tier-2 rig, its licence and a ramp longer than the policy digs | - | - |
| 4 | not run | - | - | - | - |
| 5 | not run | - | - | - | - |

## Target against measured

| target (ladder, full kit, seed 42, desert_badlands unless noted) | measured | verdict |
| --- | --- | --- |
| grade 3 at t8,000-14,000 | not reached by t12000 (digger g2 at 3762; full stuck at g1) | MISSED, no value |
| grade 4 at t15,000-25,000 | not run | MISSED, not measured |
| grade 5 at t30,000-45,000 | not run | MISSED, not measured |
| catalog never fully bought | no run bought the whole catalog (`catalogBoughtTick` null in all three) | held, trivially (no tier-2/3 purchase was reached either) |
| >= 60% of boulder ore sells with a fragmenter | full kit ladder 68%, stay_g1 58%; digger ladder (bought fragmenter) 52% | full ladder met; stay_g1 58% missed by 2 points; digger 52% missed by 8 points |
| fragmenter run ahead of no-fragmenter run at t10000 | full ladder 8,487,902 vs digger ladder 7,440,251 | met, but the kits differ in more than the fragmenter |
| ladder ahead of stay_g1 at t10000 | 8,487,902 vs 8,487,902 | MISSED by 0: the full-kit ladder never leaves grade 1 (safety 38 of 40 at every interval it checked), so it plays the same game as stay_g1 |

## What the ladder policy fixed

- Bankruptcy at t7009: a driver was hired per equipment purchase (12 purchases, salaries about $1.5M by t4500). The ladder now upgrades a vehicle in place (`vehicle upgrade`, no new driver), only the rig, hauler and digger, only when cash stays above `LADDER_UPGRADE_RESERVE` ($150,000) and the vehicle is unreserved with a driver holding the next tier's licence. Digger kit: alive at t12000.
- `fragment_debris:no_licensed_driver`: the probe now builds a Driving Center, hires a driver and runs `employee train` (`earnLicence`), never `assign_skill`. Digger kit: the licence was held at t1000.
- Probe defects that stalled the run, fixed in the probe: a refused detonation (event blast ban) dropped the charged pattern forever; an evacuation stranding a worker left the pattern armed for thousands of ticks (now `blast cancel` and retry); a blaster who died left every charge order blocked (a replacement is hired); a hole charge sized by the grid, not the limit (an n x n pattern now takes limit / n^2 kg per hole).

## Why the run stops at grade 2 (measured, not tuned)

1. Deepening needs the crater clear and a ramp to its floor. Shots fired into a crater still holding rubble leave holes `buried_under_rubble`; deeper craters leave haul orders `debris_out_of_reach` and a worker who cannot leave the blast zone. Ramps dug per crater (tried) made it worse: income stalled and the run went bankrupt at t7389 to t10869 on both kits. That variant is not committed.
2. Safety 38 to 40 on the full kit: the grade-2 target (40) was met only on an interval boundary for the digger kit; a Management Office (safety equipment) lifted it to 67 in a trial but that variant also went bankrupt (item 1) and is not committed.
3. Delivered ore is about 9 kg/tick, so the grade-3 target (150 t) is ~16,700 ticks after grade 2 at the current rate; reaching t8,000-14,000 needs either about a 2.5x delivery rate or a lower grade-3 ore target (first lever in the issue's order: `MINE_GRADES`). Not changed, because no run reached grade 3 to confirm the other grade-3 targets (depth 20, neighbours 35, no death in 1,000) would then bind later.

## Balance constants

No constant changed. Nothing in `src/core/config/balance.ts` moved, so no sandbox pin in
`tests/integration/sandbox-economy-balance.integration.test.ts` needed re-measuring, and no ordering pin was added
(the full-vs-digger ordering holds on one seed and one policy version; ladder-vs-stay_g1 is a tie).

## Follow-up scope

1. Pit access policy: clear a crater before deepening, then dig a ramp (or the spiral, #1940) to its new floor; keep one working pit. This is what stops the run at grade 2.
2. Safety and neighbour policy for grades 2 and 3 (Management Office, berms, barbecue events).
3. Then run `full50k` above, tune in the issue's order: `MINE_GRADES` ore/depth targets, `BUYER_*`, fees, `PERMIT_LIMITS`, and re-measure the sandbox pins that move.
