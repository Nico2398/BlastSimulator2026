# History — gameplay-employee-skills

Records why the rules in the `gameplay-employee-skills` skill exist: the issues that introduced or changed each mechanic, measurements, decision reviews and earlier behaviour.

## Skill Categories

- `repair` skill: #1393.

## Starting Qualifications

- Blaster starting `driving.truck` licence: #1667.
- `TrainingState.raisesLicenceTo` predates `grantsLevel` (original: "is legacy, read only to finish courses saved before `grantsLevel`"). Vehicle upgrade licence warning: #1401.

## Proficiency Levels & Effects

- Building Destroyer demolition XP: #1392.
- Phase-driven work XP: #1833.

## Pending-Action Pool & Ghost Preview

- Ore-demand haul bonus: #1817, grade scaling #1828. Decision review note: "set the bonus constant to 0 to reverse, or `ORE_DEMAND_MIN_GRADE`=0 with a tiny `ORE_DEMAND_FULL_GRADE` for any-trace behaviour".
- Unqualified vs temporarily unavailable holders: #1380.
- Red ghost for unreachable work and building hologram: #1306.
- Original lead-in: "**Decisions (#1306):**".
- Original: "warning reasons ... keep their pre-existing meaning (employees able to work *now*)".
- Tier-first ranking: #1742.
- `demolish_building` in tier 1: #1840. Loaded drivers never abandon the haul: #1709.
- Before #1742 a reserved `haul_debris` starved a pool `charge_hole`.
- Open pool skips `debris_out_of_reach`: a crater of unreachable rubble used up every bounded path attempt and its access ramp segment was never claimed (#2089).
- Pool search skipped when no candidate passes the vehicle gates: 78% of the non-empty searches on the seed-42 full-kit ladder at t6000 (busy drivers reserving ahead with every hauler reserved or an idle driver standing by); 62 to 48 ms a tick on the same 300 ticks, same trajectory.

## Hiring Candidate Pools

- Hiring candidate pools: #1385.
- Unique names: #1886.

## Salary Calculation

- Flat licence pay: #1843.

## Types

- Buried-hole rule: #1937.
