# Issue #1944: Sandbox yield calibration

Calibrates the sandbox's ore grade scale, ore prices, grade-0/1 blast limits and starting cash with the
progression probe (#1922). Reinvest strategy only (it carries every target); the `opening` strategy was not re-run.

## Chosen values

| Lever | Before | After |
|---|---|---|
| `SANDBOX_ORE_GRADE_SCALE` (wired as `oreGradeScale` in `sandboxLevelDef`) | 1 (implicit) | 0.08 |
| `PRODUCTION_ORE_PRICES` dirtite ... treranium ($/kg) | 21 ... 336 | 105 ... 1,680 (x5, rarity order and 16x ladder kept) |
| Buyer tier ranges | unchanged | unchanged (not needed) |
| `PERMIT_LIMITS[0]` | 80 kg, 9 holes | 40 kg, 9 holes |
| `PERMIT_LIMITS[1]` | 250 kg, 16 holes | 120 kg, 16 holes (grade 2 stays 800 kg / 36 holes) |
| `SANDBOX_STARTING_CASH` digger / full | 210,000 / 250,000 | 330,000 / 370,000 (full > digger kept) |
| `SANDBOX_REFERENCE_SHOT_CYCLE_TICKS` | 11,300 | 2,900 (estimated from the delivered share, not timed) |
| Reference opening `SHOT` (`scripts/shared/probe-strategies.ts`) | 3x3, spacing 4, depth 8, 8 kg (72 kg) | 3x3, spacing 4, depth 5, 4 kg (36 kg) |

`SANDBOX_REFERENCE_CREW_COST_PER_TICK` (250) unchanged. Campaign LevelDefs unchanged.

## Rerun

```bash
npm run probe:progression -- --quick --strategy reinvest          # one site, 3000 ticks
npm run long -- start probe -- npm run probe:progression -- --strategy reinvest --json /tmp/probe.json
npm run long -- wait probe          # explicit timeout 600000; exit 75 = still running, call again
```

Full matrix: desert_badlands and green_foothills x digger and full x seeds 42/7/13, horizon 10000. The tables
below were run as four parallel handles (one per biome/kit, three seeds each). Columns: cash at tick,
lowest cash and its tick, bankruptcy tick, first grade tick.

## Before (HEAD `36675a22`, old shot, scale 1, old prices; landed work since the #1922 baseline made a re-run necessary)

| seed | biome | kit | cash@1000 | cash@3000 | cash@6000 | cash@10000 | low cash | low tick | bankrupt tick | grades | end |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 7 | desert_badlands | digger | - | - | - | - | -57151 | 528 | 543 | - | game_over:bankruptcy |
| 13 | desert_badlands | digger | 129044 | - | - | - | -27753 | 1469 | 1469 | - | game_over:bankruptcy |
| 42 | desert_badlands | digger | 393189 | 2114065 | 2871381 | 3714552 | -2382 | 484 | - | g1@873 | t10000 |
| 7 | desert_badlands | full | 104726 | - | - | - | -40266 | 2560 | 2583 | - | game_over:bankruptcy |
| 13 | desert_badlands | full | 187996 | - | - | - | -38020 | 2860 | 2884 | - | game_over:bankruptcy |
| 42 | desert_badlands | full | 464580 | 1727085 | 4261737 | 7971390 | -4165 | 532 | - | g1@883 | t10000 |
| 7 | green_foothills | digger | 361226 | - | - | - | -26479 | 2179 | 2179 | - | game_over:bankruptcy |
| 13 | green_foothills | digger | - | - | - | - | -33481 | 486 | 553 | - | game_over:bankruptcy |
| 42 | green_foothills | digger | 336530 | 1622110 | 2652258 | 1354031 | -2250 | 438 | - | g1@816 | t10000 |
| 7 | green_foothills | full | 460352 | 239457 | - | - | -39664 | 4689 | 4689 | - | game_over:bankruptcy |
| 13 | green_foothills | full | - | - | - | - | -21211 | 540 | 560 | - | game_over:bankruptcy |
| 42 | green_foothills | full | 153428 | 1072011 | 2725365 | 4441225 | -663 | 430 | - | g1@968 | t10000 |

## After (values above)

| seed | biome | kit | cash@1000 | cash@3000 | cash@6000 | cash@10000 | low cash | low tick | bankrupt tick | grades | end |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 7 | desert_badlands | digger | 319740 | 416984 | - | - | -27582 | 4339 | 4339 | - | game_over:bankruptcy |
| 13 | desert_badlands | digger | - | - | - | - | -47629 | 979 | 979 | - | game_over:bankruptcy |
| 42 | desert_badlands | digger | 504681 | 1830807 | 819358 | - | -29762 | 8440 | 8440 | g1@1048 | game_over:bankruptcy |
| 7 | desert_badlands | full | 412225 | 1381008 | 3441111 | 4950546 | 87985 | 450 | - | - | t10000 |
| 13 | desert_badlands | full | 273861 | - | - | - | -32192 | 1879 | 1879 | - | game_over:bankruptcy |
| 42 | desert_badlands | full | 445164 | 1881402 | 3919066 | 7112614 | 79912 | 540 | - | g1@1128 | t10000 |
| 7 | green_foothills | digger | 235838 | 1447211 | - | - | -40301 | 5819 | 5819 | g1@1248 | game_over:bankruptcy |
| 13 | green_foothills | digger | 714325 | 1759293 | 732097 | - | -26023 | 8109 | 8109 | g1@1208 | game_over:bankruptcy |
| 42 | green_foothills | digger | 209197 | - | - | - | -26708 | 1849 | 1849 | - | game_over:bankruptcy |
| 7 | green_foothills | full | 317116 | 2314664 | 4782581 | 5358827 | 64942 | 480 | - | g1@1178 | t10000 |
| 13 | green_foothills | full | 399570 | 2977496 | 7975437 | 14360331 | 76961 | 440 | - | g1@1308 | t10000 |
| 42 | green_foothills | full | 707947 | 2035522 | 940321 | - | -32179 | 8449 | 8449 | g1@988 | game_over:bankruptcy |

## Targets

| Target | Result | Verdict |
|---|---|---|
| Low point >= 15% of start cash, no bankruptcy | Early trough (t440-540) of the four surviving full-kit runs: 65k-88k = 17.6-23.8% of 370k, and the 0.12/3.5 trial (start 320k) held digger troughs at 45-87k. Later: 8 of 12 runs go bankrupt (before: 9 of 12), 3 early (t979, t1879, t1849) and 5 late (t4339-t8449) | MISSED |
| Cash at t1000 within +-25% of start | In band: desert/digger/7, desert/full/7, desert/full/42, green/full/7, green/full/13 (5 of 11 that reached t1000). Out: 505k, 715k, 209k, 236k (digger), 274k, 708k (full) | MISSED |
| >= 70% of a grade-0 shot's ore sold within 2,000 ticks | The probe has no per-2,000-tick column (`firstBlastSold@6000` is capped by the second blast, 1-3% here). Diagnostic run (scale 0.1, desert/digger/42): 19.1 t delivered of a 24.9 t shot by t2000 = 76%; scale 0.08 delivers a slightly larger share. Not measured at 0.08 | Plausible, unproven |
| Grade 1 at ~t1500-3000 | Reached t988-1308 on the 7 runs that got there (5 digger/full runs never did: stalled hauling or too little ore) | MISSED (early) |
| Grade 2 at ~t4000-7000 | No run reached grade 2 within 10,000 ticks. The `depth_m` 10 target needs deeper digging than the fixed-depth reference shot | MISSED |
| t6000 cash below next grade's fee + tier-2 hauler | The 4 survivors at t6000 hold 3.4M-8.0M, far above grade 2's $75k + a tier-2 hauler | MISSED |

## Closest values found (single trials, horizon 3000-4000)

| Scale / price factor / start | Finding |
|---|---|
| 0.30 / x1.5 / 250k,290k | median cash@1000 ~150k, 4 early bankruptcies, g1 at t708-1208 |
| 0.30 / x2 / 250k,290k | median cash@1000 ~310k, 5 of 12 bankrupt, g1 at t708-1208 |
| 0.12 / x3.5 / 320k,360k | troughs 45k-125k, 4 of 12 bankrupt by t4000, g1 at t788-1288 |
| 0.06 / x7 / 320k,360k | g1 at t1048-1588 (closest to the 1500-3000 window), but one trough at -2k |
| 0.08 / x5 / 330k,370k (chosen) | table above |

## Why the misses stay

- **Stalled hauling, not economics.** Desert/digger/13 hauls ~2 t, then every `haul_debris` order sits at
  `debris_out_of_reach` (and `fragment_debris` at `no_vehicle_in_fleet` on the digger kit) while the crew
  runs at fatigue 82-94; payroll then drains the cash. The same seeds went bankrupt in the baseline at
  scale 1, so thinning the ore cannot fix it. It is a reachability/crew defect for a separate issue.
- **Grade 1 too early.** Grade 1 needs 5 t of ore and 2 blasts (`MINE_GRADES`, not a lever of this task).
  Thinner ore (0.06) delays it to t1048-1588 but costs the opening its margin.
- **Grade 2 and the t6000 check.** The reference strategy never digs 10 m, so grade 2 cannot be reached
  and a surviving player accumulates millions; this needs a deeper-shot rule in the strategy (calibration
  tasks extend it) and re-pitched grade fees, not these levers.
- **Late bankruptcies** (t4339-t8449) follow cash that peaked at 1-2M: the reinvest policy spends down
  to its reserve and payroll outruns sales when hauling stalls.

Sandbox integration pins (`sandbox-economy-balance`, `sandbox-ecology`, `sandbox-opening-kit-haul`) were not
re-measured in this step; they are updated separately.
