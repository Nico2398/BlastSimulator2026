---
name: game-design
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
Worker quarters, storage depots, vehicle depot, office, break rooms, medical bay, explosives magazine.
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

- **Interactive zone:** Rocky extraction zone + neutral border
- **Underground grid:** 3D voxel grid with rock types and ore densities (Simplex noise)
- **Mine type choice:** Affects rocks, ores, terrain shape, settlements, climate

## Material Catalogs

### Rocks (fictional, humorous names)
Each has: ore probability, procedural texture, hardness, porosity, density.
Examples: Cruite (soft), Grumpite (medium), Obstiite (hard), endgame rocks.

### Explosives (fictional, humorous names)
Each has: energy yield, cost, water sensitivity, charge limits, rock tier requirement, blast radius modifier, vibration profile.
Examples: Pop-Rock (starter), Big Bada Boom (mid), Dynatomics (endgame).

### Ores
Fictional humorous names. "Treranium" (très rare, high value), common ores, exotic ores.

## Weather System

Procedural cycle: sunny → cloudy → rain → heavy rain → storm → heat wave → cold snap.
Rain fills drill holes. Water-sensitive explosives fail without tubing. Porous rock = faster water infiltration.
Tubing is purchasable per-hole waterproofing.

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
- **Win:** Reach profit threshold → next level unlocked
- **Campaign complete:** All 3 levels done

## Save System

- **Backends:** IndexedDB (web primary), File system (local), File download/upload (fallback)
- **Multiple slots** with full GameState + campaign progression + metadata
- **Auto-save** every 2 game minutes in dedicated slot
- **Cross-session persistence** via IndexedDB

## Time Management

Real-time with adjustable speed: 1x, 2x, 4x, 8x. Pause available. Some actions auto-pause.

## Audio System

Hooks for all events. Placeholder synthesized sounds. Categories: ambient, blast, vehicle, UI, event, weather.

## Localization (i18n)

English (en) + French (fr) from day one. All text externalized. Interpolation support. All fictional names localized.

## Art Direction

3D cartoon, Minion-like characters. Placeholder geometric shapes. Replaceable assets. Procedural rock textures. Marching cubes terrain.
