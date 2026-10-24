# History — gameplay-game-design

Records why the rules in `.claude/skills/gameplay-game-design/SKILL.md` exist: the issues that introduced or changed each mechanic, the owner decisions behind them, and the measurements and earlier values they replaced.

## Contracts

- Negotiation run by a Manager, with the management-level bonus: #1340.
- Offers restricted to ores the active site's rocks can yield, off-site badge: #1364.
- Rubble contracts (cheap and paid clearance, sized to barren stock): #1892, owner decision 2026-10-17. The cheap clearance pays at what was then "today's `rubblePricePerKg`".
- Automatic delivery: #1367. Spoil Heap `storedSpoilKg` drawn first: #1530. Ore-bearing fragments and `collectedOre` never consumed by rubble disposal: #1871.
- Delivering one ore removes only that ore: #1371.
- Markets (legacy / production profiles): #1681. Ore sales sized to what the opening kit can haul and fill: #1719. Supply offers 4-8 t with 1500-2500 tick deadlines and the fillability invariant: #1789. Rubble 2.5-50 t sized to barren stock: #1892. `PRODUCTION_ORE_PRICES` 16x ladder pitched at `SANDBOX_ORE_GRADE_SCALE` 0.08: #1944. `SANDBOX_REFERENCE_SHOT_CYCLE_TICKS` "estimated ~2,900 since #1944".
- Buyer tiers: #1929. Ore market saturation: #1930. Contracts market strip: #1931.
- Demand-weighted haul ranking: #1817; grade-weighted urgency: #1828; the bonus it stacks on is the ore bonus from #671.
- Sandbox starting kit: #1891, cash #1747; digger kit's rock digger, ramp and licensed driver: #1874; 3x3 Krackle opening and grade limits: #1944.
  - "The $195,000 hard tier is retired (it shared digger's kit and differed by cash only)."
  - "The old $150k / $120k went bankrupt at ~t609 / ~t582."

## Employees

- Union benefit (member salary discount): #1873.
- Union grievance and event volume: #1890.

## Operating cost and runway

- Section introduced by #1375.

## Scores (0-100 each)

- Safety as a managed score (`safetyTarget` / `safetyDelta`): #1977.

## Event System

- Option balance: #1894.
- Category gating (`CATEGORY_PREREQUISITE`): #1412.

## Event effects

- Structured event effects: #1414.
- Event variety rule: #1538.
- Event leavers drawn at fire time: #1908.

## Corruption & Mafia Gameplay

- Corruption meter and mafia tiers: #1407.
- Independent rolls per bribe/accident/frame: #1838.
- Protection linger: #1816. Removed sentence: "Prices, corruption deltas and failure rules unchanged: the bribe now delivers what it already promised."
- Corruption failure and mafia failure: #1411. Removed sentence: "Mafia rewards unchanged."
- Union members and dismissal: #1872.
- Arranged accident booked as a workplace death: #1700.
- Smuggling vs tax audit: #1409.

## The site expands

- Expanding site: #473, #558. Original wording: the border wall is "what the border wall now marks".

## Pit mask shape

- Pit mask shape: #1680. Campaign levels and standalone worlds kept `DEFAULT_PIT_MASK` "unchanged".
- Envelope rule: #1734. Original wording: "0.25 was picked by measurement (0.45 left sides of tropical/alpine seeds with no climbable path to drill-hole rings 6/18/30 m outside the grid)".

## Explosives

- Delivery wait: #1895, owner decision 2026-10-17. Original wording: "Rationale: a site firing about one pattern per 500 ticks saves ~400 ticks per stocked pattern, which is what pays the warehouse's build cost and upkeep back (price discount alone never did)."

## Weather System

- Pinned weather: #1585. Hole water: #1350.
- Per-biome climates: #1688. The temperate fallback is "the original tables verbatim"; adding climates left "saves unchanged and the RNG stream shape identical".

## Safety & Projection Profiles

- Evacuation and detonation as one flow: #1362.

## Campaign & World Map

- Shareholder Summit level: #1949. Original load note: "`campaignComplete` is derived on load (a stored true from before the summit existed no longer holds)."
- Shareholder Summit tuning: #1949, #2047, measured with the #1945 ladder probe. Removed: "Seed 4444 (the first terrain pick) crew-revolted by tick 5300; seeds 4001, 4006-4008 were tried, 4001 had the best opening."
- Tutorial determinism: #1600. The scripted ore sale meant the `sell-ore` step "no longer holds `clockMustRun`".
- Dusty Hollow opens staffed, and its decisions: #1363; free Freight Warehouse and Spoil Heap: #1574.

## Progression / Win/Lose per Level

- Star rating: #1311.
- Operating profit as the win figure: #1363.
- Keep playing: #1647; the freeze at a win: #1313.
- Site Map and the live game: #1314.

## Board of directors

- Board of directors: #1946.

## Save System

- Fallback and confirms: #1325. Tutorial save and resume: #1333. Campaign profile: #1312.

## Mine grades (progression v1)

- Campaign levels with `progression` (Shareholder Summit): #1949.
- Original wording: "#1945 measured the ladder probe (seed 42, desert_badlands): grade 1 at t978 (digger) / t1088 (full), grade 2 at t3762 (digger); grades 3-5 not yet reached by any policy, so no value above was re-tuned".
- Permit panel: #1924. Workshop: #1925. Permit events: #1927. Approval ceremony: #1926.
