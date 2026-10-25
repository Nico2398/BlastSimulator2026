# History — gameplay-survey-system

Records why the rules in the `gameplay-survey-system` skill exist: the issues that introduced or changed each mechanic, measurements, decision reviews and earlier behaviour.

## Depth-resolved estimates

- Depth-resolved estimates: #1683.
- Original text: "The profile is built in a second pass after the column loop, so `estimates` and `confidence` and their RNG draws are unchanged. Additive: no `SAVE_VERSION` bump; an old save has no `depthProfile`, and the Survey panel and hover tag then show no depth line."

## Result card and overlay value

- Result card and overlay value: #1684.

## Ore Veins

- Biome ore progression: #1677.
- #1677 added only deeper ore; desert and red-canyon shallow ore was kept bit-identical.
- Ore deposits: #1682.
- Original: "Tuned over seeds 1, 7, 42 on all biomes: >= 30% of interior 8 m blocks hold < 1 t in the 0-8 and 8-16 m slabs."
- Pre-blast estimate coverage: #1967.
- Site ore grade scale: #1932.
- Original text: "Why density and not `ORE_DENSITY_KG_M3`: fragment mass, stored ore and contract ledgers all derive ore kg from density x that constant, so scaling the constant would split the ledgers (invariants #1786); scaling the density keeps every consumer consistent."
- Depth grade multiplier: #1933.
- Measurements at #1933, original text: "measured at seed 42 with the table above the richest 5 m band is ~3.6x desert surface, so the multipliers stand unlowered. Value per m3 (mean over depth bands 0-10, 10-20, 20-35, 35-55 m, seed 42) rises strictly in every biome (desert 6131/6751/7924/12037, red canyon 6610/7528/9782/12203, alpine 549/2923/6298/8440, green foothills 4741/7596/11691/12375, karst 6606/9405/13247/17874, volcanic 9300/10383/11374/15930; richest 5 m band 3.6x desert surface (green foothills), ceiling untouched)."
- Progression probe behind keeping the sandbox contract board on catalog ores: "cash at tick 6000 fell 4.9M -> 1.7M and reinvest stopped re-firing".

## Ore Grade Reporting Post-Blast

- Depth-aware post-blast report: #1703.

## Survey Visibility Rules

- Survey price scaled by `survey_cost` modifiers: #1568.
