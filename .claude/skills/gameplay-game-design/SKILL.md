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
3. **Design blast plans** (drill holes, load explosives, define detonation sequence)
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
**Detonation Sequence:** Order and delay (ms) per hole; affects fragmentation, vibrations, free face

### Blast Preview / Software Upgrades
Tier 0 (none) → Tier 1 (energy heatmap) → Tier 2 (fragment prediction) → Tier 3 (projection risk) → Tier 4 (vibration model)

### Blast Execution
See blast-system skill for detailed physics algorithm.

### Post-Blast Recovery
Fragments picked up by excavators → loaded onto trucks → sold via contracts

## Economy & Management

### Contracts
- **Negotiable** with probabilistic outcomes
- Types: ore sale, rubble disposal, supply
- Each specifies: material type, quantity, unit price, deadline, penalties

### Buildings
9 canonical building types (see gameplay-buildings skill for the full catalog).
Can be placed, moved, destroyed. Projections can destroy them.

### Vehicle Fleet
Trucks, excavators, drill rigs, bulldozers. Each has purchase/maintenance/fuel cost, capacity, speed.

### Employees
Hired with salaries. Specialized roles: drillers, blasters, drivers, surveyors, managers.
Unionized employees cannot be fired. Affected by well-being score.

### Scores (0-100 each)
| Score | Affected by |
|-------|------------|
| **Worker Well-being** | Quarters quality, breaks, overwork, raises, accidents |
| **Safety** | Equipment investment, accident rate, evacuation, PPE |
| **Ecology** | Dust, water contamination, waste management, restoration |
| **Neighbor Nuisance** | Blast vibrations, noise, dust, projections, traffic |

## Event System

### Architecture
Events grouped into categories with independent timers. Timer fires → check available events → roll weighted selection → fire event. Weights + values depend on player scores.

Gating (#1412): `CATEGORY_PREREQUISITE` (EventSystem.ts) blocks `union` until an employee exists and `lawsuit` until some cause exists (environmental cause, a death, or staff). Environmental lawsuits additionally require `hasEnvironmentalCause` (a blast fired, or ecology/nuisance strictly below `ENV_CAUSE_*_MAX` = 45, under the initial 50). `lawsuitCount` counts fired lawsuit-category events.

### Categories
- **Unions:** Strike threats, wage demands, safety complaints, overtime protests
- **Politics/External:** Supplier wars, competitor mines, activist blockades, regulation changes, tax audits
- **Weather/Natural:** Rain floods, drought dust, earthquake instability, heat waves
- **Mafia:** Unlocked via corruption — arranged accidents, protection rackets, smuggling
- **Lawsuits:** Triggered by accidents/deaths/environmental damage

### Resolution
Each event presents 2-4 decision options with different consequences on scores, finances, future event probabilities.

## Corruption & Mafia Gameplay

- **Corruption:** Bribe judges, union leaders, inspectors. Success: problem goes away. Failure: scandal, fines, criminal charges.
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
Each has: energy yield, cost, water sensitivity, charge limits, rock tier requirement, blast radius modifier, vibration profile.
Examples: Pop-Rock (starter), Big Bada Boom (mid), Dynatomics (endgame).
Cost: costPerKg x kg is charged when the charge order is placed (finance category `explosives`) and refunded in full if the order is cancelled; firing the blast charges nothing.

Level explosive lists (`availableExplosives`) are enforced in the Charge step and console `charge` (single, `hole:*`, saved-plan queue); sandbox/new_game (no known level) use the full catalog.

### Ores
Fictional humorous names. "Treranium" (très rare, high value), common ores, exotic ores.

## Weather System

Procedural cycle: sunny → cloudy → rain → heavy rain → storm → heat wave → cold snap.
Rain fills drill holes. Water-sensitive explosives fail without tubing. Porous rock = faster water infiltration.
Tubing is purchasable per-hole waterproofing.
Weather advances once per tick in `runTick` (`tickWeather`, right after time advances, before events read `weatherId`) and lives in `GameState.weather` (`WeatherCycleState`), persisted with the save (v30) with its own PRNG stream `rngState` (mulberry32 int32, seeded `seed + WEATHER_RNG_SEED_OFFSET`); history is capped at `WEATHER_HISTORY_MAX`. The TopBar forecast runs the same `tickWeather` primitive on a clone, so forecast day N equals the live weather after N days of ticks. `createGame` reseeds weather for every start (browser level swap, console `new_game`, sandbox, campaign); a refused start leaves the old state untouched. `weather advance` uses `forceAdvanceInState`.
Tubing lifecycle: installing needs a drilled hole (unknown id refused); removing a hole or firing the blast drops its tubing record with no refund; unused inventory persists.

## Safety & Projection Profiles

- Safety zone evacuation required before each blast
- Projection trajectories based on overcharge, stemming, free face, sequence
- Buildings, vehicles, and people in path take damage/die

## Campaign & World Map

### 3-Level Campaign
1. **"Dusty Hollow"** — Desert, soft rocks, basic explosives, generous contracts, no villages
2. **"Grumpstone Ridge"** — Mountain, mixed rocks, mid-tier explosives, nearby village, moderate events
3. **"Treranium Depths"** — Tropical, endgame rocks + Treranium, demanding contracts, multiple villages, volatile weather

### Progression
Level 1 unlocked at start → profit threshold unlocks next → star ratings (1-3) for replayability.

### Win/Lose per Level
- **Lose:** Bankruptcy, arrest (corruption), ecology=0, well-being=0
- **Arrest:** mafia exposure >= `ARREST_EXPOSURE_THRESHOLD` (0.9) arrests immediately. `ARREST_WARNING_EXPOSURE` (0.75) fires one `arrest:warning` event (toast) and shows an exposure pip (warn, critical from 0.9); the warning re-arms when exposure drops under 0.75. A jump past 0.9 skips the warning.
- **Revolt:** well-being at 0 for `REVOLT_TICKS` (120) revolts; `REVOLT_WARNING_TICKS` (40) fires `revolt:warning`. A well-being pip shows below `WELL_BEING_ALERT_THRESHOLD` (20, warn), and at 0 becomes a critical revolt countdown (`revoltTicksRemaining`).
- **Win:** Reach profit threshold → next level unlocked
- **Campaign complete:** All 3 campaign levels (tier > 0; the tutorial level is excluded) completed. The final level's victory screen announces it.
- **Site Map and the live game (#1314):** a *live game* is a state that exists and whose level has not ended. While one is live: the main menu shows RESUME (`#bs-menu-resume`) above CONTINUE; the Site Map opened from the top bar shows BACK TO SITE (`#bs-world-map-back-to-site`) and Esc does the same (a confirm closes first); Start on a level card asks for confirmation first, since it restarts that level from scratch. The map's Site Map entry from the level-end screen offers no way back. Both returns change no game state.

## Save System

- **Backends:** IndexedDB (web primary), File system (local), File download/upload (fallback)
- **Multiple slots** with full GameState + campaign progression + metadata
- **Auto-save** every 2 game minutes in dedicated slot
- **Cross-session persistence** via IndexedDB
- **Fallback and confirms (#1325):** when IndexedDB fails its startup probe (missing, blocked, errored, 3 s timeout) saves go to a session-only in-memory backend — never a file download per save; the Saves modal shows a persistent notice and save status says "this session only". Autosave failure shows one error per failure streak. Overwrite (filled manual slots only; the auto slot has none), Delete, and Load ask for confirmation; Load confirms only when a live, unfinished game would be discarded. Empty SAVE HERE and MainMenu CONTINUE never confirm. Manual `.json` export remains the durable escape hatch.
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
