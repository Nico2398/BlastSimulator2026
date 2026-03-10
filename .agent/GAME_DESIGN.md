# BlastSimulator2026 — Game Design Document

## 1. Concept

**BlastSimulator2026** is a wacky open-pit mine management game in the spirit of Theme Hospital / Two Point Hospital. The player manages an open-pit quarry (also called a "career"), dealing with blasting rock, recovering rubble, and evacuating materials to run a profitable operation. The game is an unabashed **caricature of capitalism** — dark humor, ethical dilemmas, corruption, union-busting, and environmental destruction are all part of the fun.

**Tone:** Satirical, absurd, Minion-like characters, exaggerated consequences. Think "what if the worst mining company in the world was run by the player, and every shortcut had hilarious repercussions."

---

## 2. Core Gameplay Loop

1. **Survey** the terrain to identify ore veins
2. **Plan** access (build ramps, clear surface)
3. **Design blast plans** (drill holes, load explosives, define detonation sequence)
4. **Execute blasts** — physics simulation determines fragments, projections, damage
5. **Recover rubble** with vehicles (excavators, trucks)
6. **Sell or store** materials via contracts
7. **Manage** employees, finances, events, safety, ecology scores
8. **Repeat**, going deeper into the pit, unlocking better tech

---

## 3. Mining Gameplay — Realistic Blast Workflow

This is the **central mechanic** of the game and must faithfully reproduce real-life blasting procedures.

### 3.1 Geological Survey
- Player sends survey teams to sample terrain at specific coordinates
- Each sample reveals the rock type and ore density at that location
- Without surveys, the player is mining blind — expensive mistakes
- Surveys cost money and time (employee + equipment)

### 3.2 Access Preparation
- Before blasting at depth, the player may need to **build a ramp** to access the blast zone base
- Alternatively, use machines to dig or perform an initial "bench blast" with angled holes
- Ramp placement affects vehicle routing and future expansion

### 3.3 Blast Plan Design
A blast plan consists of three sub-steps:

#### 3.3.1 Drill Pattern
- Define drill holes, typically in a **grid pattern**
- Parameters: hole positions (x,y), hole depth, hole diameter
- Spacing and burden (distance between rows) affect fragmentation quality
- Common patterns: rectangular grid, staggered grid, single-row

#### 3.3.2 Charge Loading
- For each hole, define:
  - Explosive type (from the explosive catalog)
  - Amount (kg)
  - Stemming height (inert material packed on top to contain blast energy)
  - Optional: casing/tubing if hole is wet and explosive is water-sensitive
- Different explosives have different energy yields, costs, water resistance, and game-tier requirements

#### 3.3.3 Detonation Sequence
- Define the **order and delay** (in milliseconds) for each hole's detonation
- Proper sequencing ensures:
  - Rock moves in the desired direction (toward the free face)
  - Vibrations are minimized (critical for neighbor relations)
  - Fragmentation is optimized
- Bad sequencing → excessive vibrations → neighbor complaints → fines/events
- Bad sequencing → poor fragmentation → oversized blocks requiring secondary blasting

### 3.4 Blast Preview / Software Upgrades
- At game start, the player has **no prediction tools** — must rely on experience and caution
- Purchasable software upgrades provide progressively better previews:
  - **Tier 1:** Basic energy distribution heatmap
  - **Tier 2:** Fragment size prediction
  - **Tier 3:** Projection risk overlay
  - **Tier 4:** Vibration propagation model (shows impact on neighbors)
- These are presented in-game as "software licenses" the player buys — a nod to real-life blast design software

### 3.5 Blast Execution
- See BLAST_SYSTEM.md for the detailed physics algorithm
- Outcomes depend on energy correctness:
  - **Too low:** Rock insufficiently fractured → large immovable blocks, wasted explosives
  - **Correct:** Clean fragmentation → manageable rubble, efficient recovery
  - **Too high:** Excessive projections → rubble flies far, destroys buildings, kills people
- Fragments are physical entities that fall, roll, collide, and cause damage

### 3.6 Post-Blast Recovery
- Fragments lying on the ground can be picked up by appropriate vehicles (excavators load trucks)
- Rich ore fragments are valuable → sell via contracts
- Plain rock/rubble may need to be disposed of → can cost money
- Player is heavily reliant on excavators (limited resource) → must blast efficiently to keep throughput high

---

## 4. Economy & Management

### 4.1 Contracts
- **Negotiable**: each contract can be negotiated; outcomes are probabilistic:
  - Success → better terms (higher price, lower penalties, longer deadline)
  - Failure → terms may stay the same or worsen
- **Types:**
  - Ore sale contracts: sell rich rubble for profit
  - Rubble disposal contracts: pay to get rid of plain rock (or find a buyer)
  - Supply contracts: bulk agreements with recurring deliveries
- Each contract specifies: material type, quantity, unit price, delivery deadline, penalties for breach

### 4.2 Buildings
- Prefabricated buildings that the player places on the map:
  - **Worker quarters** (affects well-being score)
  - **Storage depots** for rubble/ore
  - **Vehicle depot** (maintenance, parking)
  - **Office** (admin, contract management)
  - **Break rooms / canteen** (well-being)
  - **Medical bay** (safety, post-accident)
  - **Explosives magazine** (required to store explosives safely)
- Buildings can be placed, moved, and destroyed
- Buildings hit by projections are destroyed (with consequences)

### 4.3 Vehicle Fleet
- **Trucks:** transport rubble from pit to depot/sale point
- **Excavators:** load rubble onto trucks (bottleneck resource)
- **Drill rigs:** bore holes for blast plans
- **Bulldozers:** build ramps, clear terrain
- Each vehicle: purchase cost, maintenance cost, fuel cost, capacity, speed
- Vehicles can be moved, assigned to zones, and are destroyable by projections

### 4.4 Employees
- Hired with salaries; affected by well-being score
- Can demand raises (via union events)
- Can be injured or killed (safety score, lawsuits)
- Specialized roles: drillers, blasters, drivers, surveyors, managers
- Unionized employees cannot be fired (see Mafia gameplay)

### 4.5 Scores
Every player action can influence one or more scores:
| Score | Affected by |
|-------|------------|
| **Worker Well-being** | Quarters quality, break facilities, overwork, raises, accidents |
| **Safety** | Equipment investment, accident rate, evacuation protocols, PPE |
| **Ecology** | Dust, water contamination, waste management, restoration efforts |
| **Neighbor Nuisance** | Blast vibrations, noise, dust, projection incidents, traffic |

Scores range from 0-100 and influence event probabilities, contract terms, and endgame outcomes.

---

## 5. Event System

### 5.1 Architecture
- Events are grouped into **categories**: unions, politics, weather, mafia, lawsuits, external
- Each category has its own **timer** (countdown to next event trigger)
- When a timer fires:
  1. Check which events in that category are **available** (prerequisites met)
  2. Each available event has a **probability weight** (modified by player scores)
  3. Roll to select which event fires
  4. Event **values** (amounts, severity, demands) are also score-dependent
- Timer intervals, probability weights, and event values all depend on player scores

### 5.2 Event Categories & Examples (50-100 events per category, to be generated during implementation)

#### Unions
- Strike threat, wage demands, safety complaints, overtime protests
- Severity scales with how poorly workers are treated
- A well-treated workforce has mild, infrequent union events

#### Politics / External
- War in a supplier country (explosive prices spike)
- Competitor opens a nearby mine (contract prices drop)
- Environmental blockade by activists
- Government regulation changes
- Tax audits

#### Weather / Natural
- Heavy rain → floods drill holes, ruins water-sensitive explosives
- Drought → dust problems, neighbor complaints
- Earthquake → terrain instability
- Heat wave → worker productivity drops

#### Mafia
- Unlocked via corruption gameplay
- "Accidents" can be arranged for problematic unionized employees
- Protection rackets, smuggling opportunities
- Risk of exposure and criminal charges

#### Lawsuits
- Triggered by accidents, deaths, environmental damage
- Families of victims sue; settlement or trial
- Player can attempt to corrupt judges (risk/reward)

### 5.3 Event Resolution
- Each event presents **2-4 decision options**
- Each option has different consequences on scores, finances, and future event probabilities
- Some options unlock new event chains (e.g., choosing corruption opens mafia storyline)

---

## 6. Corruption & Mafia Gameplay

- **Corruption:** Player can attempt to bribe judges during lawsuits, bribe union leaders, bribe inspectors
  - Success: problem goes away
  - Failure: scandal, fines, reputation damage, potential criminal charges
- **Mafia:** Dark escalation path
  - Unionized employees can't be fired → player can "arrange incidents" or frame them
  - Smuggling explosives for side income
  - Gets progressively more dangerous and expensive
  - Can lead to game-ending scenarios (arrest, investigation)

---

## 7. World Generation

### 7.1 Terrain
- **Interactive zone:** Large square area containing:
  - Rocky extraction zone (center) with ore veins
  - Neutral border zone (dirt/sand, nothing valuable)
- **Extended terrain:** Generated slightly beyond interactive zone for visual plausibility
- **Distant scenery:** Mountains, plains, fields, forests — purely decorative, placed far away

### 7.2 Underground Grid
- 3D voxel grid of materials beneath the surface
- Each cell contains:
  - Rock type (from rock catalog)
  - Density values for each ore type (0.0 to 1.0)
- Generation uses noise functions (Perlin/Simplex) to create realistic vein distributions
- Different rock types have natural boundaries and transitions

### 7.3 Mine Type Choice
- At game start, player chooses the type of mine / region
- This affects: rock types available, ore distribution, terrain shape, nearby settlements, climate

---

## 8. Material Catalogs

### 8.1 Rock Catalog
All names are **fictional and humorous.** Each rock type has:
- Ore probability distribution (which ores can be found, at what rates)
- 3D procedural texture representation (for surface rendering; textures interpolate at rock transitions)
- Hardness / solidity rating (endgame rocks require endgame explosives to fracture)
- Porosity (affects water infiltration into drill holes → explosive reliability)
- Density (affects fragment weight and vehicle load)

Example rocks (names to be finalized during implementation):
- Cruite (soft starter rock)
- Granite... wait no, "Grumpite" (medium, grumpy-looking)
- Obsidienne... "Obstiite" (hard, obstinate)
- Endgame: "Adamantite" or "Absurdite"

### 8.2 Explosive Catalog
All names are **fictional and humorous.** Each explosive has:
- Energy yield per kg
- Cost per kg
- Water sensitivity (boolean or scale)
- Minimum/maximum charge per hole
- Rock tier requirement (which rocks it can fracture)
- Blast radius modifier
- Projection risk modifier
- Vibration profile

Example explosives (names to be finalized during implementation):
- "Pop-Rock" (starter, cheap, low energy)
- "Big Bada Boom" (mid-tier, good all-rounder)
- "Dynatomics" (endgame, massive energy, expensive, dangerous)

### 8.3 Ore Catalog
Fictional ores with humorous names:
- "Treranium" (très rare → very rare mineral, high value)
- Common ores for bulk sale
- Exotic ores for special contracts

---

## 9. Weather System

- Procedural weather cycle: sunny, cloudy, rain, heavy rain, storm, heat wave, cold snap
- Rain affects:
  - Drill holes fill with water
  - Water-sensitive explosives become inoperable if not cased (tubing)
  - Tubing is purchasable equipment, installable per hole
  - Porous rock → faster water infiltration
- Weather events can trigger or modify other events (floods, droughts)

### 9.1 Tubing / Casing
- If an explosive is water-sensitive AND the rock is porous AND it rains → explosive fails
- Player can buy tubing equipment and install it in holes to waterproof them
- This is called "tubage" in real blasting — represented as a purchasable upgrade
- Adds cost and time but prevents failed blasts

---

## 10. Safety & Projection Profiles

### 10.1 Safety Zone
- Before each blast, player should evacuate the blast zone
- Projection risk depends on blast plan quality
- Mini-profiles can be purchased (software upgrade) to visualize projection arcs
- Failing to evacuate → casualties → lawsuits → score damage

### 10.2 Projection Profiles
- Each blast generates projection trajectories based on:
  - Overcharged holes
  - Insufficient stemming
  - Free face orientation
  - Sequence errors
- Projections are physical objects that fly, bounce, and destroy things
- Buildings, vehicles, and people in the path take damage/die

---

## 11. Time Management
- Game runs in real-time with adjustable speed: 1x, 2x, 4x, 8x
- Pause available
- Some actions (blast execution, event resolution) may auto-pause

---

## 12. Audio System
- Prepare audio hooks for all game events
- Use placeholder sounds initially (simple synthesized beeps, booms, etc.)
- Categories: ambient, blast, vehicle, UI, event notification, weather
- System designed so real sound files can replace placeholders later

---

## 13. Localization (i18n)
- All game text externalized to locale files
- Ship with **French (fr)** and **English (en)** from day one
- System supports adding any new language by adding a locale file
- Interpolation support for dynamic values: `"blast.projections": "{count} projections detected!"`
- All fictional names (rocks, explosives, ores, countries) also go through i18n so they can be localized

---

## 14. Art Direction

- **3D Cartoon style**, very simple, Minion-like characters
- Placeholder assets: simple geometric shapes (boxes, cylinders, spheres) with solid colors
- Assets designed to be **easily replaceable** — clean interfaces between asset data and game logic
- Procedural 3D rock textures that remain coherent after fragmentation (fragments inherit parent texture)
- Terrain uses marching cubes from voxel data → natural-looking surface

---

## 15. Campaign & World Map

### 15.1 World Map
The game features a **world map** that serves as the campaign hub. The map shows a stylized view of the world (can be 2D illustrated or a 3D flyover) with mine site locations marked on it. Each location represents a **level** — a distinct mine with unique terrain, rock composition, challenges, and difficulty.

### 15.2 Level Progression
- The game ships with **3 levels**, ordered by increasing difficulty
- At game start, only Level 1 is unlocked
- Completing a level (reaching its cumulative profit threshold) unlocks the next level
- The player can replay any unlocked level at any time
- Each level is a fresh start (new terrain, new finances, new employees) but campaign progression persists
- Future updates can add more levels without changing the system architecture

### 15.3 The Three Levels

**Level 1 — "Dusty Hollow"**
A small desert quarry. Ideal for learning the ropes. Soft rocks (Cruite, Sandite), basic explosives (Pop-Rock, Mini Boom), generous contracts with long deadlines, low event frequency, no nearby villages (nuisance is irrelevant). The tutorial runs on this level. Profit threshold to unlock Level 2 is low — the player just needs to demonstrate basic competence.

**Level 2 — "Grumpstone Ridge"**
A medium-sized mountain site with mixed rock hardness. Mid-tier explosives become available (Big Bada Boom, Quake Charge). Contracts are tighter with stricter deadlines. Events occur at moderate frequency. A nearby village means vibration management matters. The terrain is hillier, requiring more ramp construction. Profit threshold to unlock Level 3 is moderate — requires efficiency and smart contract management.

**Level 3 — "Treranium Depths"**
A large tropical site containing the rare Treranium ore buried deep in endgame rocks. All explosives available including Dynatomics. Contracts are demanding, with high quantities and severe penalties. Events are frequent across all categories. Multiple nearby villages amplify nuisance concerns. Weather is volatile (tropical storms). The mafia storyline is more likely to develop here. Profit threshold is high — requires mastery of all game systems.

### 15.4 Level Completion
When the player accumulates enough profit on a level:
- A "Level Complete" event fires with a summary screen showing key stats
- The player can **continue playing** the current level (for fun, higher star rating, or experimentation) or **return to the world map** to start the next level
- On the world map, completed levels show a star rating (1-3 stars) based on performance metrics: profit margin efficiency, casualty count, average ecology score, time to completion

### 15.5 Level Failure
Game-over conditions (bankruptcy, arrest, ecological disaster, worker revolt) end the **current level only**. The player is returned to the world map and can retry the level. Campaign progression (unlocked levels) is never lost.

---

## 16. Save System

### 16.1 Architecture
The save system uses a persistence abstraction layer with multiple backends:
- **IndexedDB** (web primary): survives page reloads, stores multiple save slots, no size limit issues for typical game states
- **File system** (local/desktop): saves as JSON files in a user-configurable directory
- **File download/upload** (web fallback): allows exporting a save as a `.json` file and importing via file picker — ensures saves are never truly lost even if IndexedDB is cleared

### 16.2 Save Slots
The game supports multiple save slots (at least 5). Each slot stores:
- Full serialized GameState (terrain, entities, finances, everything)
- Campaign progression (which levels unlocked, star ratings, stats per level)
- Metadata: slot name, timestamp, current level name, cash balance snapshot (for display in load screen)

### 16.3 Auto-Save
- Auto-save triggers at configurable intervals (default: every 2 minutes of game time)
- Auto-save uses a dedicated slot that is overwritten each time
- Manual saves go to player-chosen slots

### 16.4 Cross-Session Persistence
On the web, the game must persist between browser sessions. IndexedDB is the best option for this — it survives page reloads and has generous storage limits. The game auto-detects the environment (web vs. Node.js/local) and selects the appropriate backend. If IndexedDB is unavailable or cleared, the player can import their last exported save file.

---

## 17. Endgame / Win-Lose Conditions

**Per-level lose conditions:**
- **Financial bankruptcy** → Level failed, return to world map
- **Criminal arrest** (corruption/mafia path) → Level failed, return to world map
- **Ecological disaster** (ecology score hits 0 sustained) → Government shuts down mine → Level failed
- **Worker revolt** (well-being score hits 0 sustained) → Permanent strike → Level failed

**Per-level win condition:**
- Accumulate enough profit to reach the level's unlock threshold → Level complete, next level unlocked

**Campaign completion:**
- All 3 levels completed = campaign victory
- Star ratings encourage replayability (can the player get 3 stars on every level?)
- The game is inherently a balancing act between profit and consequences — pushing too hard causes failures, being too cautious means never reaching the profit threshold
