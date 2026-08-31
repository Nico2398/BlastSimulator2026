# Integration Suites — required coverage

The minimum each suite carries. A new suite starts from the row that names it; an existing suite grows past its row, never below it.

## Small Integration Tests (≥ 8 scenarios per suite)

| Suite | Key Scenarios (minimum) |
|-------|------------------------|
| `buildings.integration.test.ts` | (1) Place valid flat terrain; (2) reject slope; (3) reject overlap; (4) demolish frees navmesh; (5) blast destroys building + score penalty; (6) explosive warehouse secondary blast; (7) LQ well-being per tier; (8) research center unlocks tier; (9) overcapacity penalty; (10) protected voxels block drill |
| `vehicles.integration.test.ts` | (1) Purchase → qualified driver → move; (2) reject unqualified; (3) two vehicles converge → one waits; (4) TrafficJamEvent at threshold; (5) `broken` state after damage; (6) depot repair; (7) blast projection destroys vehicle; (8) driver re-enters for next task; (9) uncrewed vehicle rejected; (10) payload tracked during haul |
| `skills.integration.test.ts` | (1) New hire has 0 qualifications; (2) training grants skill; (3) XP accumulates per task tick; (4) level-up at threshold; (5) proficiency reduces duration; (6) multi-skill salary higher; (7) unqualified → UnqualifiedTaskError; (8) qualified-busy → no error; (9) ghost added/removed; (10) duration uses combined modifiers |
| `survey.integration.test.ts` | (1) Seismic within ±15%; (2) core sample within ±5%; (3) aerial surface-only; (4) stale at tick 101; (5) Lucky Strike > 120%; (6) Barren Blast < 60%; (7) insufficient funds error; (8) skill level reduces error; (9) seismic damages nearby building; (10) overlapping surveys accumulate |
| `blast-enhanced.integration.test.ts` | (1) Multi-rock threshold weighted; (2) energy local for strong rock; (3) spreads for weak rock; (4) island flood-fill; (5) building destroyed at threshold; (6) death probability scales; (7) Voronoi count scales; (8) deep fragment v≈0; (9) surface overcharged v≈MAX; (10) Tier A cap enforced; (11) ore yield matches voxels; (12) navmesh dirty-region fires |
| `navmesh.integration.test.ts` | (1) A* shortest path; (2) avoids blocked; (3) avoids buildings; (4) drill hole passable; (5) multi-level via ramp; (6) no ramp → found:false; (7) path re-requested on block; (8) stuck after 3 fails; (9) patch only affects blast region; (10) patch after building; (11) vehicle-occupied flag per tick |
| `needs.integration.test.ts` | (1) Hunger drains during task; (2) fatigue faster during task; (3) rest auto-inserted at warning; (4) collapse interrupts + prepends; (5) rest resolves + resumes; (6) building-full queuing; (7) well-rested bonus at all >80; (8) shift cycle for Living Quarters Tier 2+; (9) living_quarters visit cost deducted; (10) ground-rest 2× when no building |
| `economy.integration.test.ts` | (1) Ore sale deducts + credits; (2) missed deadline fine; (3) successful negotiation; (4) failed negotiation; (5) supply contract delivers on schedule; (6) rubble disposal cost; (7) bankruptcy tracker; (8) save/load finance state |
| `events.integration.test.ts` | (1) Union timer interval; (2) probability scales with score; (3) decision affects follow-up; (4) mafia unlocked after corruption; (5) lawsuit after death; (6) weather modifies flood state; (7) TrafficJamEvent threshold; (8) UnqualifiedTaskError; (9) timer resets; (10) fine amounts scale with score |
| `campaign.integration.test.ts` | (1) Level completes at profit threshold; (2) star rating computed; (3) next level unlocked; (4) progress persists on restart; (5) bankruptcy ends level; (6) arrest ends level; (7) ecological shutdown; (8) worker revolt; (9) replay completed level; (10) star rating updates on replay |

## Full-Level Integration Tests

Each runs `new_game` through to a terminal outcome and asserts `levelEndReason`.

| Test File | Level | Outcome | Final Assertion |
|-----------|-------|---------|-----------------|
| `level1-win.integration.test.ts` | Level 1 (Dusty Hollow) | Win — efficient run | `levelEndReason === 'completed'`; star ≥ 2 |
| `level1-lose-bankruptcy.integration.test.ts` | Level 1 | Lose — overspend | `levelEndReason === 'bankruptcy'` |
| `level1-lose-revolt.integration.test.ts` | Level 1 | Lose — neglect needs | `levelEndReason === 'worker_revolt'` |
| `level1-lose-ecology.integration.test.ts` | Level 1 | Lose — repeated overblast | `levelEndReason === 'ecological_shutdown'` |
| `level1-lose-arrest.integration.test.ts` | Level 1 | Lose — corruption path | `levelEndReason === 'arrest'` |
| `level2-win.integration.test.ts` | Level 2 (Grumpstone Ridge) | Win — multi-bench + vibration management | `levelEndReason === 'completed'`; star ≥ 2 |
| `level2-lose-bankruptcy.integration.test.ts` | Level 2 | Lose — cascade fines | `levelEndReason === 'bankruptcy'` |
| `level2-lose-revolt.integration.test.ts` | Level 2 | Lose — continuous shift, no LQ upgrade | `levelEndReason === 'worker_revolt'` |
| `level3-win.integration.test.ts` | Level 3 (Treranium Depths) | Win — deep Treranium extraction | `levelEndReason === 'completed'`; star ≥ 1 |
| `level3-lose-ecology.integration.test.ts` | Level 3 | Lose — tropical storm + overblast | `levelEndReason === 'ecological_shutdown'` |
