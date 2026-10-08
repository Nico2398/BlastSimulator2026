---
name: gameplay-game-design
description: >
  Complete game design document for BlastSimulator2026: satirical open-pit mine management game.
  Covers core gameplay loop, mining mechanics, economy, events, corruption, world generation,
  material catalogs, weather, safety, campaign, save system, and win/lose conditions.
  Use when implementing or modifying any game mechanic or feature.
---

## Concept

**BlastSimulator2026** — wacky open-pit mine management game in spirit of Theme Hospital / Two Point Hospital. Player manages open-pit quarry: blasting rock, recovering rubble, evacuating materials. Unabashed **caricature of capitalism** — dark humor, ethical dilemmas, corruption, union-busting, environmental destruction.

**Tone:** Satirical, absurd, Minion-like characters, exaggerated consequences.

## Core Gameplay Loop

1. **Survey** terrain to identify ore veins
2. **Plan** access (build ramps, clear surface)
3. **Design blast plans** (drill holes, load explosives, preview, fire)
4. **Execute blasts** — physics simulation determines fragments, projections, damage
5. **Recover rubble** with vehicles (excavators, trucks)
6. **Sell or store** materials via contracts
7. **Manage** employees, finances, events, safety, ecology scores
8. **Repeat**, going deeper, unlocking better tech

## Mining Gameplay — Realistic Blast Workflow

### Geological Survey
- Player sends survey teams to sample terrain at specific coordinates
- Reveals rock type and ore density; surveys cost money and time

### Access Preparation
- Build ramps to access blast zone; ramp placement affects vehicle routing

### Blast Plan Design
**Drill Pattern:** Grid of holes with positions, depth, diameter, spacing, burden
**Charge Loading:** Per hole: explosive type, amount (kg), stemming height, optional tubing
**Detonation:** All charges fire together; no per-hole order or delay. Vibration uses the total charge of every hole

### Blast Preview / Software Upgrades
Tier 0 (none) → Tier 1 (energy heatmap) → Tier 2 (fragment prediction) → Tier 3 (projection risk) → Tier 4 (vibration model)

### Blast Execution
See blast-system skill for detailed physics algorithm.

### Post-Blast Recovery
Fragments picked up by excavators → loaded onto trucks → sold via contracts

## Economy & Management

### Contracts
- **Negotiable** with probabilistic outcomes, run by a Manager: no eligible manager (alive, not injured, not in training) means no negotiation. Best manager `management` level raises the success rate by `NEGOTIATION_MANAGEMENT_BONUS_PER_LEVEL` per level above 1 (#1340)
- Types: ore sale, rubble disposal, supply
- Offers only ask for ores the active site's rocks can yield (`resolveContractOres`: biome dominant rocks, softest+hardest when `mixedRockHardness`, via `oresYieldedByRocks`), plus rubble disposal. Supply picks from the cheapest `SUPPLY_COMMON_ORE_COUNT` of those ores. A site with no yielding ore offers rubble only. The panel badges an off-site offer (e.g. from an older save) "not found on this site" (`data-contract-onsite`) (#1364)
- Each specifies: material type, quantity, unit price, deadline, penalties
- **Automatic delivery (#1367):** every tick (`TickPipeline` step 3, before `checkDeadlines`) `autoDeliverContracts` (`ContractFulfilment.ts`) delivers stored ore to each active, non-held contract, soonest deadline first (`acceptedAtTick + deadlineTicks`, tie lowest id). Each takes `min(stock, remaining)` of its material (`ore_sale`/`supply` from `collectedOre`, `rubble_disposal` from `storedMassKg`), re-reading stock after every delivery since contracts share one warehouse. Payment is `kg * pricePerKg` plus the early bonus when completed before 50% of the deadline, booked as `contracts` / `bonus` income (`bookDeliveryIncome`, shared with the console `contract deliver`, which uses `deliverStoredOre`). Partial payments accumulate in `paidTotal`. Manual Deliver still works.
- **Delivering one ore removes only that ore (#1371):** `consumeStoredOre` takes just the sold ore's mass out of each fragment (`extractOreFromFragment`); other ores in the same fragments stay stored and in `collectedOre`. Rubble disposal removes raw mass and debits every ore it carried.
- **Hold / Resume:** `contract hold <id>` / `contract release <id>` (ContractsPanel Hold/Resume, `data-action="hold-toggle"`) sets `held`; a held contract is skipped by automatic delivery but still expires and still raises the expiry warning.
- **Partial-delivery expiry:** the penalty is `round(penaltyAmount * undeliveredShare)` (recorded in `penaltyCharged`); what was delivered and paid stays paid. Zero delivered = full penalty. The expiry warning (`CONTRACT_EXPIRY_WARNING_TICKS` before the deadline) only fires for contracts still short of stock (`contractShortOfStock`).

### Buildings
9 canonical building types (see gameplay-buildings skill for the full catalog).
Can be placed, moved, destroyed. Projections can destroy them.

### Vehicle Fleet
Trucks, excavators, drill rigs, bulldozers. Each has purchase/maintenance/fuel cost, capacity, speed.

### Employees
Hired with salaries. Specialized roles: drillers, blasters, drivers, surveyors, managers (managers run contract negotiation; hiring/firing/policy are not gated on one yet).
Unionized employees cannot be fired. Affected by well-being score.

### Operating cost and runway (#1375)
`src/core/economy/OperatingFinance.ts` owns the definition, in $/hour (1 tick = 1 hour). **Operating cost** = payroll (living employees' salaries / `PAY_CYCLE_TICKS`) + active-building upkeep + vehicle maintenance + fuel of reserved vehicles. **Operating income** = ledger `sales` + `contracts` over the trailing `OPERATING_INCOME_WINDOW_TICKS`, per hour. TopBar trend = income - cost; **runway** (days) = cash / (cost - income) / `TICKS_PER_DAY`, or "sustainable" when income covers cost. One-off spending (construction, equipment, fines) never enters either side. Ledger categories: building upkeep = `maintenance`, `vehicle_maintenance`, `fuel` booked separately.

### Scores (0-100 each)
| Score | Affected by |
|-------|------------|
| **Worker Well-being** | Quarters quality, breaks, overwork, raises, accidents |
| **Safety** | Equipment investment, accident rate, evacuation, PPE |
| **Ecology** | Dust, water contamination, waste management, restoration |
| **Neighbour Relations** | High = good. Lowered by blast vibrations, noise, dust, projections, traffic, failed bribes; raised by events that please the village |

## Event System

### Architecture
Events grouped into categories with independent timers. Timer fires → check available events → roll weighted selection → fire event. Weights + values depend on player scores.

Gating (#1412): `CATEGORY_PREREQUISITE` (EventSystem.ts) blocks `union` until an employee exists and `lawsuit` until some cause exists (environmental cause, a death, or staff). Environmental lawsuits additionally require `hasEnvironmentalCause` (a blast fired, or ecology/neighbour relations (`nuisance`) strictly below `ENV_CAUSE_*_MAX` = 45, under the initial 50). `lawsuitCount` counts fired lawsuit-category events.

### Categories
- **Unions:** Strike threats, wage demands, safety complaints, overtime protests
- **Politics/External:** Supplier wars, competitor mines, activist blockades, regulation changes, tax audits
- **Weather/Natural:** Rain floods, drought dust, earthquake instability, heat waves
- **Mafia:** Unlocked via corruption — arranged accidents, protection rackets, smuggling
- **Lawsuits:** Triggered by accidents/deaths/environmental damage

### Resolution
Each event presents 2-4 decision options with different consequences on scores, finances, future event probabilities.

## Corruption & Mafia Gameplay

- **Corruption (#1407):** a 0 to `CORRUPTION_MAX` (100) meter, clamped. Event choices keep their own deltas. A successful bribe adds `BRIBE_CORRUPTION_DELTA[target]` and grants a timed protection; a failed one adds only `BRIBERY_FAILURE_CORRUPTION_DELTA`, grants nothing and does not extend an existing protection. `mafiaUnlocked` latches at `MAFIA_UNLOCK_THRESHOLD` (20) and never unlatches; the `mafia` event category needs `corruptionLevel >= MAFIA_UNLOCK_THRESHOLD`. Within the category, each mafia event's `canFire` gates on `mafiaTier(n)` (`EventBuilder.ts`) = `MAFIA_UNLOCK_THRESHOLD + (n-1) * MAFIA_ESCALATION_STEP` (10): tier 1 = 20 ... tier 5 = 60, so later events open as the meter climbs.
- **Protections (`economy/BribeProfile` table in `BribeProtection.ts`):** price = `BRIBE_PRICE_PER_PROTECTION_DAY` x `BRIBE_PROTECTION_DAYS` (witness: flat). Re-bribing refreshes to max(existing, now + duration), never stacks. Followups already queued are not shielded. Shown in the Shady panel (`[data-protection="<target>"]`) with remaining time.

| Target | Delta | Days | Price | Effect |
|--------|-------|------|-------|--------|
| judge | 15 | 5 | $50,000 | next lawsuit event dismissed (one-shot, counts as fired); lawsuit timer x`JUDGE_LAWSUIT_TIMER_STRETCH` (1.8) |
| politician | 12 | 4 | $30,000 | no `politics` events |
| union_leader | 8 | 4 | $15,000 | no `union` events |
| inspector | 5 | 3 | $8,100 | no events tagged `INSPECTION_EVENT_TAG` (`inspection`: paperwork fine, OSHA hardhats, EPA, blast limit fines, UN inspector) |
| witness | 5 | none | $10,000 | lowers mafia exposure by `WITNESS_EXPOSURE_REDUCTION` (0.25) |
- **Corruption failure (#1411):** a failed bribe fines `BRIBERY_FAILURE_FINE_FRACTION` (0.5) of its cost (expense category `fines`), lowers the neighbour-relations score (`nuisance`) by `BRIBERY_FAILURE_NUISANCE_HIT` (8), and adds `BRIBERY_FAILURE_CORRUPTION_DELTA` (2) corruption (can unlock the mafia).
- **Mafia failure (#1411):** a botched accident or detected frame raises exposure by `INVESTIGATION_EXPOSURE_JUMP` (0.2) and queues the repeatable follow-up `INVESTIGATION_FOLLOWUP_EVENT_ID` (`mafia_police_investigation`: pay off detective / hire lawyer / stonewall; events may carry `exposureDelta`). Exposed smuggling charges `SMUGGLING_EXPOSED_FINE` (25000), adds `SMUGGLING_EXPOSED_EXPOSURE_JUMP` (0.1) exposure and shuts smuggling off. Exposure decays `EXPOSURE_DECAY_PER_TICK` (0.004) per tick once `EXPOSURE_CLEAN_GRACE_TICKS` (30) pass with no mafia action and no active smuggling (`mafia.lastActivityTick`). Each of these raises a toast (`ui/notify/corruptionNotifications.ts`). Mafia rewards unchanged.
- **Mafia:** Dark escalation path. Arrange incidents for unionized employees. Smuggling. Gets progressively more dangerous.

## World Generation

- **Interactive zone:** the claimed site — a set of 16x16 chunks, not a fixed square
- **Underground grid:** 3D voxel grid with rock types and ore densities (Simplex noise)
- **Mine type choice:** Affects rocks, ores, terrain shape, settlements, climate

### The site expands (#473, #558)

A level starts as a square, and grows wherever play takes it. Acting past the edge — drilling, surveying, building, cutting a ramp — claims the action's whole footprint (e.g. a survey's full coverage disc, not just its center cell) plus whatever intermediate chunks bridge it to the site as one connected worksite, and generates it all from the seed. The site ends up whatever shape play gives it, and is seemingly unbounded.

Expansion is **never implicit**: a claim answers with success or a refusal the player can read. Three things refuse:

| Refusal | Meaning |
|---------|---------|
| `protected_structure` | A village, river or landmark stands there. Inviolable — the only permanent limit in the world, and what the border wall now marks. |
| `too_far` | The action's footprint is more chunks from the site than one claim will bridge (`MAX_CLAIM_BRIDGE_CHUNKS`) — a reach limit, not a hard wall; still claimable in a closer step. |
| `expansion_disabled` | This site has a fixed boundary. |

`not_adjacent` (touches no ground the site owns) still exists as a defensive fallback on the single-chunk `claim` path; the bridging claim above is what player actions actually go through.

Claiming is currently free. A land price per chunk would fit the satire and is an open design question, not a technical one.

## Material Catalogs

### Rocks (fictional, humorous names)
Each has: ore probability, procedural texture, hardness, porosity, density.
Examples: Cruite (soft), Grumpite (medium), Obstiite (hard), endgame rocks.

### Explosives (fictional, humorous names)
Each has: energy yield, cost, water sensitivity, charge limits, minimum rock tier (rock harder than that breaks only at a steep energy penalty, never refused), vibration profile.
Examples: Pop-Rock (starter), Big Bada Boom (mid), Dynatomics (endgame).
Cost: costPerKg x kg is charged when the charge order is placed (finance category `explosives`) and refunded in full if the order is cancelled; firing the blast charges nothing.

Level explosive lists (`availableExplosives`) are enforced in the Charge step and console `charge` (single, `hole:*`, saved-plan queue); sandbox/new_game (no known level) use the full catalog.

### Ores
Fictional humorous names. "Treranium" (très rare, high value), common ores, exotic ores.

## Weather System

Procedural cycle: sunny → cloudy → rain → heavy rain → storm → heat wave → cold snap.
Rain fills drill holes. Water-sensitive explosives fizzle in a wet hole. Tubing is purchasable per-hole waterproofing.
**Hole water (#1350).** Each drilled hole carries `GameState.holeWater[id] = { level 0..1, porosity }` (porosity sampled once from the dominant rock under the hole, `dominantRockUnderHole` + `getRock().porosity`; grid-less runs use 0), and the site carries `groundWetness` 0..1; both persist (save v32). `tickHoleWater` runs in `runTick` right after `tickWeather` and advances every hole with `advanceHoleWater`: rain adds `rain * HOLE_RAIN_FILL_RATE`, wet ground seeps in `groundWetness * porosity * HOLE_SEEP_RATE`, and with no rain the level fades by `HOLE_WATER_FADE_RATE * (1 - porosity * HOLE_FADE_POROSITY_SLOWDOWN)` (porous rock holds water about twice as long). Ground wetness rises with rain (`GROUND_WETNESS_RISE_RATE`) and decays when dry (`GROUND_WETNESS_DECAY_RATE`, lingers a few ticks). Tuning: a storm fills a bare hole in about 2 ticks, light rain about 8; water fades in 12-24 ticks in tight rock; tight rock (0.03) never floods from wet ground, porous rock (0.35) does within about 100 ticks at full wetness. A hole is wet while `level > HOLE_WET_THRESHOLD` (`isHoleFlooded`); `wetHoles` / `wetHoleIdsFor` derive from the stored level, so the previews, `executeBlast`, the blast report, the preflight checklist and the Drill/Charge/Fire steps all read the same water state. Wet holes keep their effect on water-sensitive explosives.
**Tubing is watertight, not draining.** A tubed hole neither gains nor loses water; tubing never removes water already inside. It can be bought and installed at any time, rain or not (the Charge step offers it whenever untubed holes exist).
**Draining.** `drain_hole hole:<id|*>` (Charge step: Drain button, plus one per hole row) sets a wet hole's level to 0 and costs `HOLE_DRAIN_COST_PER_HOLE`. Refused when the hole is dry, unknown, cash is short, or it is untubed in porous rock (`porosity >= HOLE_DRAIN_POROSITY_LIMIT`: the ground refills it at once; tube it first, then drain, or wait). `*` targets every wet hole: blocked ones are named, the rest still drain. Removing a hole, firing, or `resetPlanState` drops its water entry. `weather set <state>` (console override) changes the weather only; standing water stays and fades or seeps away on its own, so a scenario that needs dry holes waits on `wetHoleCount` reaching 0.
Weather advances once per tick in `runTick` (`tickWeather`, right after time advances, before events read `weatherId`) and lives in `GameState.weather` (`WeatherCycleState`), persisted with the save (v30) with its own PRNG stream `rngState` (mulberry32 int32, seeded `seed + WEATHER_RNG_SEED_OFFSET`); history is capped at `WEATHER_HISTORY_MAX`. The TopBar forecast runs the same `tickWeather` primitive on a clone, so forecast day N equals the live weather after N days of ticks. `createGame` reseeds weather for every start (browser level swap, console `new_game`, sandbox, campaign); a refused start leaves the old state untouched. `weather advance` uses `forceAdvanceInState`.
Tubing lifecycle: installing needs a drilled hole (unknown id refused); removing a hole or firing the blast drops its tubing record with no refund; unused inventory persists.

## Safety & Projection Profiles

- Safety zone evacuation before each blast is one flow (#1362): FIRE opens the pre-flight modal, DETONATE (`blast detonate`) arms `state.pendingDetonation`, evacuates the danger zone (`DetonationSequence.ts`), re-orders late entrants out every `DETONATION_REEVACUATE_INTERVAL_TICKS`, and fires automatically on the tick the zone is clear (at once when it already is). No separate horn step.
- Waiting state: modal and `blast status` show who is left, or by name who is stranded (cannot leave). `blast` with no argument = fire anyway (clears the pending detonation, fires with people inside, they die). `blast cancel` = abort. A second `blast detonate` while armed is refused. Armed with no holes left = cancelled automatically. Saved (`pendingDetonation`, save v34).
- Projection trajectories based on overcharge, stemming, free face
- Buildings, vehicles, and people in path take damage/die

## Campaign & World Map

### 3-Level Campaign
1. **"Dusty Hollow"** — Desert, soft rocks, basic explosives, generous contracts, no villages
2. **"Grumpstone Ridge"** — Mountain, mixed rocks, mid-tier explosives, nearby village, moderate events
3. **"Treranium Depths"** — Tropical, endgame rocks + Treranium, demanding contracts, multiple villages, volatile weather

**Dusty Hollow opens staffed (#1363):** `LevelDef.startingSite` (`DUSTY_HOLLOW_STARTING_SITE`) hires a driller, a blaster and a driver, buys a drill rig and a debris hauler, and places a Tier 1 Freight Warehouse for free, so the crew can work from tick 0 with storage already synced (`regenerateGrid` → `placeStartingBuildings`, which spirals out from `STARTING_BUILDING_STANDOFF_M` from the crew toward the site centre so a footprint cannot wall a vehicle in). `createGameForLevel`/`campaign start` take a tri-state `staffed`: absent = the level's own site, `true` = the global `STARTING_SITE_STAFFED_COMPOSITION`, `false` = a bare site. Dusty Hollow's `contractPriceMultiplier` is `DUSTY_HOLLOW_CONTRACT_PRICE_MULTIPLIER` (bisect window in `balance.ts`).

**Decisions (#1363):**
- Hiring and training fees (`salaries` category) count as running costs; only `equipment` and `construction` are capital.
- `refund` income is excluded: selling or demolishing back must not inflate the target.
- Payroll (~$200/tick for the opening crew) makes the level a race: wellbeing collapses (no rest above `NEED_REST_NO_BUILDING_CAP` restores morale) into a revolt around tick 450-630, so prices are tuned for a win within a few blasts rather than a long grind. Starting cash stays $50,000: a 2x2 pattern lands its first sale by ~tick 130, well before bankruptcy.

### Progression
Level 1 unlocked at start → profit threshold unlocks next → star ratings (1-3) for replayability.

**Star rating (#1311):** one rating, computed by `calculateStarRating` (`SuccessTracker`) from the end-of-run values: 1 star each for profit target reached, no deaths, and ecology at the end (`finalEcology`) >= `STAR_ECOLOGY_MIN` (60); minimum 1 star on completion. On level completion `checkLevelComplete` persists it with `recordStars` as `LevelProgress.bestStars` (max-merge, a replay only raises it; `getBestStars` falls back to 1 for old completed saves). The Portfolio card, its x / 9 total and the level-end star row all read the stored best; the level-end breakdown shows this run, with a note when it is below the best.

### Win/Lose per Level
- **Lose:** Bankruptcy, arrest (corruption), ecology=0, well-being=0
- **Arrest:** mafia exposure >= `ARREST_EXPOSURE_THRESHOLD` (0.9) arrests immediately. `ARREST_WARNING_EXPOSURE` (0.75) fires one `arrest:warning` event (toast) and shows an exposure pip (warn, critical from 0.9); the warning re-arms when exposure drops under 0.75. A jump past 0.9 skips the warning.
- **Revolt:** well-being at 0 for `REVOLT_TICKS` (120) revolts; `REVOLT_WARNING_TICKS` (40) fires `revolt:warning`. A well-being pip shows below `WELL_BEING_ALERT_THRESHOLD` (20, warn), and at 0 becomes a critical revolt countdown (`revoltTicksRemaining`).
- **Win:** Reach the profit threshold → next level unlocked. The figure is **operating profit** (#1363): income excluding `refund`, minus every expense outside `CAPITAL_EXPENSE_CATEGORIES` (`equipment`, `construction`) — `getOperatingProfit` / `FinancialReport.operatingProfit` (`Finance.ts`). One-off purchases of vehicles and buildings never count against the target. Everything that shows or checks progress reads it: `checkLevelComplete`, `snapshotStats` (`totalWealth`), `campaign complete`, the `finances` command, the goal chip, the Finances panel row and `console-api` `profit`.
- **Campaign complete:** All 3 campaign levels (tier > 0; the tutorial level is excluded) completed. The final level's victory screen announces it.
- **Site Map and the live game (#1314):** a *live game* is a state that exists and whose level has not ended. While one is live: the main menu shows RESUME (`#bs-menu-resume`) above CONTINUE; the Site Map opened from the top bar shows BACK TO SITE (`#bs-world-map-back-to-site`) and Esc does the same (a confirm closes first); Start on a level card asks for confirmation first, since it restarts that level from scratch. The map's Site Map entry from the level-end screen offers no way back. Both returns change no game state.

## Save System

- **Backends:** IndexedDB (web primary), File system (local), File download/upload (fallback)
- **Multiple slots** with full GameState + campaign progression + metadata
- **Auto-save** every 2 game minutes in dedicated slot
- **Cross-session persistence** via IndexedDB
- **Fallback and confirms (#1325):** when IndexedDB fails its startup probe (missing, blocked, errored, 3 s timeout) saves go to a session-only in-memory backend — never a file download per save; the Saves modal shows a persistent notice and save status says "this session only". Autosave failure shows one error per failure streak. Overwrite (filled manual slots only; the auto slot has none), Delete, and Load ask for confirmation; Load confirms only when a live, unfinished game would be discarded. Empty SAVE HERE and MainMenu CONTINUE never confirm. Manual `.json` export remains the durable escape hatch.
- **Tutorial save and resume (#1333):** the Tutorial auto-saves to its own slot `auto_tutorial` (`TUTORIAL_AUTO_SAVE_SLOT`, chosen by `autoSaveSlotFor(levelId)` in `SavesModal.ts`) so it never overwrites the campaign `auto` slot; both show as auto-style slots (no manual save/overwrite) and Continue picks the most recent across all slots. `GameState.tutorialProgress` (`{stepIndex, snapshot}`, optional, no save-version bump, sanitized on deserialize) is recorded on every step landing and cleared when the tutorial ends (finish, exit, abandon). Loading a save of the tutorial level with valid progress calls `TutorialOverlay.resume(state)`: restores the step and its snapshot (baseline is not re-captured), re-arms rails, guide and auto-advance, and pauses. Loading any other level, or a save without valid progress, abandons the tutorial.
- **Campaign profile (#1312):** campaign progress lives in its own persistent profile (`src/persistence/CampaignProfile.ts`, localStorage key `bs_campaign_profile_v1`, in `GameContext.campaignProfile`), outside any `GameState`. Campaign levels (tier > 0) play on the profile's own campaign, so completion, best profit and stars (`bestStars`) write straight to it. Sandbox, the Tutorial and `new_game` use a throwaway campaign and never read or write the profile. Loading a save merges monotonically into the profile (unlocks, completions, profit, stars only ever increase; an old save never lowers newer progress). New Campaign asks for confirmation when progress exists, then resets the profile (console: `campaign reset`). Settings -> Replay Tutorial confirms before discarding a live game. Storage access is try/catch-wrapped; blocked storage degrades to an in-memory profile. Scenario mode ignores the stored profile.
- **Save size tracks play, not level size** (v7): a save stores the claimed-chunk set plus the voxel data of the chunks play actually changed. Every other chunk is regenerated from the seed on load, which is exact because generation is a pure function of position and seed.

## Time Management

Real-time with adjustable speed: 1x, 2x, 4x, 8x. Pause available. Some actions auto-pause.

## Audio System

Hooks for all events. Placeholder synthesized sounds. Categories: ambient, blast, vehicle, UI, event, weather.

## Localization (i18n)

English (en) + French (fr) from day one. All text externalized. Interpolation support. All fictional names localized.

## Art Direction

3D cartoon, Minion-like characters. Placeholder geometric shapes. Replaceable assets. Procedural rock textures. Marching cubes terrain.
