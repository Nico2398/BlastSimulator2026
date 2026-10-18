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
**Charge Loading:** Per hole: explosive type, amount (kg), stemming height, optional tubing. Done from a Charging Truck driven by an employee with `blasting` + `driving.truck`, never on foot
**Detonation:** All charges fire together; no per-hole order or delay. Vibration uses the total charge of every hole

### Blast Preview / Software Upgrades
Tier 0 (none) → Tier 1 (energy heatmap) → Tier 2 (fragment prediction) → Tier 3 (projection risk) → Tier 4 (vibration model)

### Blast Execution
See blast-system skill for detailed physics algorithm.

### Fragmenter Availability
Normal kit deliberately has no `rock_fragmenter` (Easy has one); oversized fragments need a purchased one. Not a bug.

### Post-Blast Recovery
Fragments picked up by excavators → loaded onto trucks → sold via contracts

## Economy & Management

### Contracts
- **Negotiable** with probabilistic outcomes, run by a Manager: no eligible manager (alive, not injured, not in training) means no negotiation. Best manager `management` level raises the success rate by `NEGOTIATION_MANAGEMENT_BONUS_PER_LEVEL` per level above 1 (#1340)
- Types: ore sale, rubble disposal, supply
- Offers only ask for ores the active site's rocks can yield (`resolveContractOres`: biome dominant rocks, softest+hardest when `mixedRockHardness`, via `oresYieldedByRocks`), plus rubble disposal. Supply picks from the cheapest `SUPPLY_COMMON_ORE_COUNT` of those ores. A site with no yielding ore offers rubble only. The panel badges an off-site offer (e.g. from an older save) "not found on this site" (`data-contract-onsite`) (#1364)
- Each specifies: material type, quantity, unit price, deadline, penalties
- **Rubble contracts (#1892, owner decision 2026-10-17):** rubble is something the mine must get rid of; rubble contracts exist to clear spoil heaps, not to make money (ore contracts do that). Two kinds: a **cheap clearance** pays the player (today's `rubblePricePerKg`, level multiplier applies) and a **paid clearance** (`RUBBLE_PAID_OFFER_CHANCE` 0.4) where the player pays `quantityKg * pricePerKg` at `rubbleFeePerKg` (production $0.02-0.05/kg, legacy $0.5-2/kg, not level-scaled; `playerPays`, `isPaidClearance`). Offers are sized when generated against the barren stock (`stateRubbleStockKg`): a roll of the market range capped at `stock * share` (`RUBBLE_CHEAP_STOCK_SHARE_MAX` 0.5, `RUBBLE_PAID_STOCK_SHARE_MAX` 1.0), rounded down to the market step; under the market minimum (production 2,500-50,000 kg, `PRODUCTION_RUBBLE_QTY_KG`) the roll becomes an ore sale (rubble-only sites offer nothing that refresh). A rubble contract carries no penalty (`penaltyAmount` 0, expiry charges 0): it is fillable by construction. A paid clearance has no early bonus; negotiation lowers its fee on success and raises it on failure. Accepting one needs cash >= the full fee (`contractAcceptBlocker` 'insufficient_funds_for_fee', Accept disabled in the panel, refused by `contract accept`). Fees are booked per delivery as a `contracts` expense (`bookDeliveryCashflow`). The card says "Removes N kg", "Pays $X"/"Costs $X" and "On spoil heaps N kg"; delivered amounts show whole kg.
- **Automatic delivery (#1367):** every tick (`TickPipeline` step 3, before `checkDeadlines`) `autoDeliverContracts` (`ContractFulfilment.ts`) delivers stored ore to each active, non-held contract, soonest deadline first (`acceptedAtTick + deadlineTicks`, tie lowest id). Each takes `min(stock, remaining)` of its material (`ore_sale`/`supply` from `collectedOre`, `rubble_disposal` from barren rock only: every Spoil Heap's `storedSpoilKg` drawn first (#1530), then barren stored fragments oldest-first; ore-bearing fragments and `collectedOre` are never consumed, #1871), re-reading stock after every delivery since contracts share one warehouse. Payment is `kg * pricePerKg` plus the early bonus when completed before 50% of the deadline, booked as `contracts` / `bonus` income, or a `contracts` expense for a paid rubble clearance (`bookDeliveryCashflow`, shared with the console `contract deliver`, which uses `deliverStoredOre`). Partial payments accumulate in `paidTotal`. Manual Deliver still works.
- **Delivering one ore removes only that ore (#1371):** `consumeStoredOre` takes just the sold ore's mass out of each fragment (`extractOreFromFragment`); other ores in the same fragments stay stored and in `collectedOre`. Rubble disposal removes barren rock only (heaps, then barren stored fragments); ore is never consumed by it, and trace ore in a barren fragment still debits `collectedOre`.
- **Markets (#1681):** `src/core/economy/Market.ts` holds two profiles, chosen per level by `LevelDef.market` and stored in `state.contracts.market` (`resolveMarketId`, default `'legacy'`). `legacy` is the campaign board (offers 50-500 kg, step 10, `ORE_PRICES`, catalog `valuePerKg`). `production` is the sandbox's (`SANDBOX_MARKET`): ore sales 250 kg-2 t (sized to what the opening kit can haul and fill, #1719), supply 4-8 t with 1500-2500 tick deadlines (#1789; fillability invariant: 1.5 x max qty <= measured delivered rate of one supply ore, ~9 kg/tick (the kit hauls ~31 kg/tick but the supply ore is only a share of the mixed haul) x min deadline, so every supply offer is deliverable in full), rubble 2.5-50 t (step 250 kg, sized to the site's barren stock, #1892), ore-sale price factor 0.9-1.1, supply 0.6-0.9, rubble $0.01-0.03/kg, ore at `PRODUCTION_ORE_PRICES` ($21 dirtite ... $336 treranium/kg, a flat 16x ladder pitched at what the opening kit hauls, ~31 kg of ore a tick). `oreValuePerKg(ore, market)` is the one valuation used by the blast report, `estimateBlastOreValue`, the Preflight/blast footer and the Operations ore rows, so every shown value matches what the board pays. Targets (named in `balance.ts`): the ordinary 3x3 desert shot's ore is worth 1.5-3x `SANDBOX_REFERENCE_CREW_COST_PER_TICK` over `SANDBOX_REFERENCE_SHOT_CYCLE_TICKS` (measured ~11,300: ~360 to fire plus the shot's ~340 t hauled at ~31 kg/tick; the 5-day absorb target yields to fillable offers, hauling binds); richest biome/depth block per m3 stays within `SANDBOX_MAX_RICHNESS_RATIO` (10; measured 3.7) of desert surface rock. Moving a campaign level onto it is `market: 'production'` on its `LevelDef` (follow-up).
- **Demand-weighted haul ranking (#1817):** a warehouse must not stay full of one ore while the board's open `ore_sale` offers for another ore go unfilled. `oreHaulUrgency` (`OreDemand.ts`) gives each ore with an open offer (or an active, non-held `ore_sale`/`supply` contract's remaining kg) an urgency `1 - stock/need` in 0..1, `need` being the active contracts' remaining kg plus the smallest open offer; 0 once `collectedOre` covers it. `rubble_disposal` and held contracts are ignored. `selectBestActionForEmployee` subtracts `ORE_DEMAND_HAUL_PRIORITY_BONUS_TICKS` (64, `balance.ts`) x the fragment's grade-weighted ore urgency (#1828: per ore, urgency x min(1, density / `ORE_DEMAND_FULL_GRADE` 0.5), 0 below `ORE_DEMAND_MIN_GRADE` 0.05, max over ores, so a rich far fragment beats a trace near one) from a haul candidate's sort key (on top of the #671 ore bonus; a sort key only, real cost/ETAs never include it, held hauls get none), and thinning keeps the nearest urgent-ore fragments out of bin thinning. Reverse: set the bonus constant to 0 (no call site moves); `ORE_DEMAND_MIN_GRADE`=0 with a tiny `ORE_DEMAND_FULL_GRADE` restores any-trace behaviour.
- **Sandbox starting kit (#1891, cash #1747):** the player picks a starting kit, not a difficulty. `SANDBOX_STARTING_CASH` (`balance.ts`, read by `SANDBOX_KITS` in `Sandbox.ts`): `digger` $210,000 (rock digger, ramp and its licensed driver, #1874), `full` $250,000 (digger kit plus a rock fragmenter and its licensed driver). The $195,000 hard tier is retired (it shared digger's kit and differed by cash only). Console `kit:<digger|full>`; `difficulty:` stays as a legacy alias (easy -> full, normal/hard -> digger; `kit:` wins if both). Kit ids and names ("Digger kit" / "Full kit") are defaulted decisions. Sized so the standard opening survives: tier-1 Living Quarters first, then one 3x3 Krackle 8 kg pattern on the ore deposit, blast at ~t560, sell. Payroll and upkeep run until the first sale, so the cash low point is linear in the start (digger kit bottoms at start - $181.5k); the minimum passing start is ~$181.6k, so digger's 210k adds ~15% margin. The old $150k / $120k went bankrupt at ~t609 / ~t582. Re-bisect when payroll, kit or build times change.
- **Hold / Resume:** `contract hold <id>` / `contract release <id>` (ContractsPanel Hold/Resume, `data-action="hold-toggle"`) sets `held`; a held contract is skipped by automatic delivery but still expires and still raises the expiry warning.
- **Partial-delivery expiry:** the penalty is `round(penaltyAmount * undeliveredShare)` (recorded in `penaltyCharged`); what was delivered and paid stays paid. Zero delivered = full penalty. The expiry warning (`CONTRACT_EXPIRY_WARNING_TICKS` before the deadline) only fires for contracts still short of stock (`contractShortOfStock`).

### Buildings
9 canonical building types (see gameplay-buildings skill for the full catalog).
Can be placed, moved, destroyed. Projections can destroy them.

### Vehicle Fleet
Trucks, excavators, drill rigs, bulldozers. Each has purchase/maintenance/fuel cost, capacity, speed.

### Employees
Hired with salaries. Specialized roles: drillers, blasters, drivers, surveyors, managers (managers run contract negotiation; hiring/firing/policy are not gated on one yet).
Unionized employees cannot be fired (only an arranged accident or an event removes them). Affected by well-being score. Union benefit (#1873): members are paid `UNION_MEMBER_SALARY_DISCOUNT_PCT` (15%) less (`unionDiscountedSalary`, kept through raises and training); hiring cards and the crew card name the trade-off. Union events are stretched (timer and cooldown) by `unionEventStretch` up to 4x at zero members (`UNION_TIMER_MIN_SHARE_FACTOR`), and below `UNION_STRIKE_MIN_MEMBERS` events with a `work_stoppage` option are not selected (`EventContext.unionMemberCount`; undefined = legacy). Union grievance and event volume (#1890): union events run on their own cooldown (`UNION_EVENT_MIN_INTERVAL_TICKS` + `UNION_EVENT_MIN_INTERVAL_RANDOM_RANGE`, drawn once per window) stretched by `unionEventStretch`, so fewer members means fewer union events; the shared cooldown is unstretched, a union fire does not reset the shared clock or action gate, and non-union categories keep their pace at any roster (the union's slots are not handed to other categories). Each resolved union event moves `events.unionGrievance` (`applyUnionDecision`, `core/events/UnionGrievance.ts`): refusal +`UNION_GRIEVANCE_PER_REFUSAL` (20), met demand -`UNION_GRIEVANCE_EASE_PER_MET` (15), clamped 0..`UNION_GRIEVANCE_MAX`. Decisions: a refusal is detected by the sign of the option's `wellBeing` delta (negative = refused, positive = met); a strike falls due at `UNION_GRIEVANCE_STRIKE_THRESHOLD` (60) with at least `UNION_STRIKE_MIN_MEMBERS`; events tagged `strike` get `UNION_STRIKE_WEIGHT_BOOST` weight while due; resolving a strike-tagged event resets grievance to `UNION_GRIEVANCE_AFTER_STRIKE` (20); no passive decay; `union_strike_threat` is `repeatable` (selectEvent honours the flag) so grievance can build to further strikes; union timers are stretched on timer reset (`categoryStretch`) and the union cooldown is stretched too, so the two compound at low membership; a bribe option (`wellBeing` < 0, e.g. bribing the union boss) counts as a refusal; a due strike surfaces the strike vote, which the player may settle for money (met demand) instead of striking; the strike reuses the existing all-role `work_stoppage` of `union_strike_threat` (also fires on well-being < 35). Members' Crew detail shows the strike pressure (`strikePressure`) and the union discount as its own PAY row.

### Operating cost and runway (#1375)
`src/core/economy/OperatingFinance.ts` owns the definition, in $/hour (1 tick = 1 hour). **Operating cost** = payroll (living employees' salaries / `PAY_CYCLE_TICKS`) + active-building upkeep + vehicle maintenance + fuel of reserved vehicles. **Operating income** = ledger `sales` + `contracts` over the trailing `OPERATING_INCOME_WINDOW_TICKS`, per hour. TopBar trend = income - cost; **runway** (days) = cash / (cost - income) / `TICKS_PER_DAY`, or "sustainable" when income covers cost. One-off spending (construction, equipment, fines) never enters either side. Ledger categories: building upkeep = `maintenance`, `vehicle_maintenance`, `fuel` booked separately.

### Scores (0-100 each)
| Score | Affected by |
|-------|------------|
| **Worker Well-being** | Quarters quality (higher tiers settle higher, gains taper near 100), bed crowding, overwork (fatigue strain), morale, accidents; drags are applied per tick (`gameplay-employee-needs`) |
| **Safety** | Equipment investment, accident rate, evacuation, PPE |
| **Ecology** | Waste management: each active spoil heap +0.2/tick (inactive none). Dust (settling model, `updateScores`): a blast's new loose rubble is fresh dust (`ScoreState.freshDustKg`), costing `ECOLOGY_DUST_PER_TONNE_PER_TICK` (0.0002) per tonne per tick and settling with half-life `ECOLOGY_DUST_SETTLE_HALF_LIFE_TICKS` (150); settled rubble costs only `ECOLOGY_DUST_SETTLED_PER_TONNE_PER_TICK` (0.000004). No cap. One heap carries ordinary play (a ~2,344 t pile, blast every ~600 ticks: visible dip to the mid 30s, then recovery); rapid blasting with rubble left lying (3 heaps, a blast every 100 ticks, no hauling) still reaches 0 within 3000 ticks. Hauling rock away shrinks the settled term and the next pulse. Blast vibration/projections and events lower it. At 0 `applyDecay` does not lift it, but a net-positive delta (heap gain minus dust/vibration) does, so the shutdown warning leaves room to act; neglect (no heaps) still reaches 0 and shuts down. The ecology star is earned by play, not neutral drift. |
| **Neighbour Relations** | High = good. Lowered by blast vibrations, noise, dust, projections, traffic, failed bribes; raised by events that please the village |

## Event System

### Architecture
Events grouped into categories with independent timers. Timer fires → check available events → roll weighted selection → fire event. Weights + values depend on player scores.

Option balance (#1894): no option of an event may dominate a sibling; rule and tooling (`npm run events:balance`) in `agentic-decision-autonomy`, section "Event option comparison".

Gating (#1412): `CATEGORY_PREREQUISITE` (EventSystem.ts) blocks `union` until an employee exists and `lawsuit` until some cause exists (environmental cause, a death, or staff). Environmental lawsuits additionally require `hasEnvironmentalCause` (a blast fired, or ecology/neighbour relations (`nuisance`) strictly below `ENV_CAUSE_*_MAX` = 45, under the initial 50). `lawsuitCount` counts fired lawsuit-category events.

### Categories
- **Unions:** Strike threats, wage demands, safety complaints, overtime protests
- **Politics/External:** Supplier wars, competitor mines, activist blockades, regulation changes, tax audits
- **Weather/Natural:** Rain floods, drought dust, earthquake instability, heat waves
- **Mafia:** Unlocked via corruption — arranged accidents, protection rackets, smuggling
- **Lawsuits:** Triggered by accidents/deaths/environmental damage

### Resolution
Each event presents 2-4 decision options with different consequences on scores, finances, future event probabilities.

### Event effects (#1414)
What an outcome sentence promises is what happens. An option carries `effects?: EventEffectSpec[]` (`EventEffectCatalog.ts`); the resolver runs `applyEventEffects` after the cash/score/corruption deltas. Raw `effectTag` strings are never shown (they only route the traffic-jam and unqualified-task handlers); the outcome lists structured chips (`EventEffectText.ts`, i18n `ui.event.effect.*`) and `event modifiers` (console) / the TopBar chips (`ModifierChips.ts`, `.bs-modifier-chip`) list live modifiers with remaining time. Tunables are `EVENT_EFFECT_*` and the per-event constants in `balance.ts`; adding a variant is a spec type plus its handler and `ui.event.effect.<type>` text (en + fr).

Time: hours = ticks, days = `days * TICKS_PER_DAY`. Timed effects register an `ActiveModifier` (`ActiveModifiers.ts`) in `state.events.activeModifiers`, saved with the game (`SAVE_VERSION` 35). An equal kind/role/target/category modifier is extended, never shortened; the list is capped at `MAX_ACTIVE_MODIFIERS`; factors are clamped to `MODIFIER_FACTOR_MIN..MAX`. `tickModifiers` (first step of the tick pipeline) prunes lapsed modifiers, pays recurring charges and applies morale drift.

| Group | Spec type | Effect |
|-------|-----------|--------|
| Workforce | `work_stoppage` | role (or all) claims nothing and task progress freezes |
| | `work_rate` (`pct` -40 = x0.6) | only a fraction of ticks counts; the remainder carries (`Employee.workProgressCarry`) |
| | `morale_shift` | morale drifts by `perHour` |
| | `fatigue_relief` | everyone rested |
| | `employee_leaves` (`random`/`role`/`junior`) | one employee leaves, unionised ones included (only events do this); `_alt` text when nobody matches |
| | `employee_joins` | free hire, spawned beside the rally flag |
| | `employee_injured` | a healthy employee is injured; `_alt` with nobody |
| Pay | `salary` (`days: null` = permanent) | payroll and HUD cost scale for a role or all |
| | `bonus_per_employee` | one-off cash per living employee |
| | `recurring_charge` | `perDay` cost for N days |
| Operations | `ban` `blast`/`haul`/`drill` | `blast detonate` and `blast` refuse (`mining.blast.banned`); haul/drill actions are not claimed |
| | `cost_factor` `explosive`/`upkeep` | charge orders and building/vehicle upkeep scale; `survey`/`research` are stored only (TODO(#1568)) |
| Market | `contract_price` | new offers priced by the factor (`resolveContractPriceMultiplier`) |
| | `special_contract` | one extra offer at `EVENT_EFFECT_SPECIAL_CONTRACT_PRICE_BONUS` |
| | `cancel_contract` | an active contract is cancelled, optionally with its outstanding penalty; `_alt` with none |
| Assets | `vehicle_breakdown`, `building_closed` | HP loss and an `out_of_service` modifier (not yet enforced, TODO(#1568)) |
| World | `forced_weather` | weather held each tick without drawing from the weather rng |
| | `event_weight` | category timer interval divided by the factor |

Named events: `union_strike_threat` call the bluff = all-role stoppage (`EVENT_STRIKE_HOURS`); `mafia_fbi_mole` fire him removes an employee; `union_hazard_emotional` pay = `EVENT_HAZARD_STIPEND_PER_DAY` for `EVENT_HAZARD_STIPEND_DAYS`; `politics_mayor_wins` relocate = `EVENT_RELOCATE_PAUSE_HOURS` stoppage on top of the cash cost; `politics_mining_ban_vote` partial ban = `EVENT_PARTIAL_BAN_WORK_PCT` for `EVENT_PARTIAL_BAN_HOURS`. Any result text that promises a lasting effect ("monthly", "lasting") must carry `effects`; otherwise it is written as one-off flavour. Event variety (#1538): every category (union, politics, weather, mafia, lawsuit) uses at least 6 distinct effect kinds, at least 60% of its events carry a lasting option and no kind exceeds 30% of a category's specs; every magnitude is a named `EVENT_*` constant in `balance.ts`, costs sit on the risky option and offsets on the fix. Unwired kinds (`vehicle_breakdown`, `building_closed`, `cost_factor` on survey/research) are never authored until #1568 lands (TODO(#1568)).

Decisions: an equal-kind modifier takes the newest magnitude; a salary change with `days: null` is the only permanent modifier; the junior pick is the most recently hired; unionised staff can be removed only through event effects.
Event leavers (#1908): an `employee_leaves` option names its leaver, drawn when the event fires (`storeLeavers`, `FiredEvent.leavers`); if that employee is gone at choice time nobody leaves (the `_alt` text), with no fresh draw.

## Corruption & Mafia Gameplay

- **Corruption (#1407):** a 0 to `CORRUPTION_MAX` (100) meter, clamped. Event choices keep their own deltas. A successful bribe adds `BRIBE_CORRUPTION_DELTA[target]` and grants a timed protection; a failed one adds only `BRIBERY_FAILURE_CORRUPTION_DELTA`, grants nothing and does not extend an existing protection. `mafiaUnlocked` latches at `MAFIA_UNLOCK_THRESHOLD` (20) and never unlatches; the `mafia` event category needs `corruptionLevel >= MAFIA_UNLOCK_THRESHOLD`. Within the category, each mafia event's `canFire` gates on `mafiaTier(n)` (`EventBuilder.ts`) = `MAFIA_UNLOCK_THRESHOLD + (n-1) * MAFIA_ESCALATION_STEP` (10): tier 1 = 20 ... tier 5 = 60, so later events open as the meter climbs.
- **Rolls (#1838):** each bribe, accident and frame completion draws its own roll. Salt = `corruption.attempts.length` for bribes, `mafia.rollCount` for mafia (incremented once per drawn roll; refused calls, union frame refusals and missing targets draw none). Seed = `rollSeed(seed, tick, salt)` (`core/math/Random.ts`; salt 0 = legacy `seed + tick`). Same-tick retries are independent draws at the displayed rate, deterministic for seed + command sequence.
- **Protections (`economy/BribeProfile` table in `BribeProtection.ts`):** price = `BRIBE_PRICE_PER_PROTECTION_DAY` x `BRIBE_PROTECTION_DAYS` (witness: flat). Re-bribing refreshes to max(existing, now + duration), never stacks. Followups already queued are not shielded. Shown in the Shady panel (`[data-protection="<target>"]`) with remaining time.
- **Linger (#1816):** the paid window (`expiresAtTick`) is shorter than the event gap (120-179 ticks plus a 10-command gate), so a protection stays active past it until it has shielded something, capped at `BRIBE_PROTECTION_MAX_LINGER_DAYS` (30) past expiry. `ActiveProtection.shielded` starts false on grant and on re-bribe (max-expiry rule kept); it flips true when `selectEvent` finds an eligible event the protection blocks (`markShielded`) or the judge's dismissal is spent (`consumeDismissal`). `isActive` = `tick < expiresAtTick || (!shielded && tick < expiresAtTick + linger)`; prune, `isEventShielded`, `consumeDismissal` use it. The judge's lawsuit-timer stretch uses the paid window only. Panel shows `ui.shady.protection_lingering` ("Waiting for the next one") instead of "0 left" while `isProtectionLingering`; notes read "Lasts {duration}, or until it has shielded the next one." Old saves load entries as shielded. Prices, corruption deltas and failure rules unchanged: the bribe now delivers what it already promised.

| Target | Delta | Days | Price | Effect |
|--------|-------|------|-------|--------|
| judge | 15 | 5 | $50,000 | next lawsuit event dismissed (one-shot, counts as fired); lawsuit timer x`JUDGE_LAWSUIT_TIMER_STRETCH` (1.8) |
| politician | 12 | 4 | $30,000 | no `politics` events |
| union_leader | 8 | 4 | $15,000 | no `union` events |
| inspector | 5 | 3 | $8,100 | no events tagged `INSPECTION_EVENT_TAG` (`inspection`: paperwork fine, OSHA hardhats, EPA, blast limit fines, UN inspector) |
| witness | 5 | none | $10,000 | lowers mafia exposure by `WITNESS_EXPOSURE_REDUCTION` (0.25) |
- **Corruption failure (#1411):** a failed bribe fines `BRIBERY_FAILURE_FINE_FRACTION` (0.5) of its cost (expense category `fines`), lowers the neighbour-relations score (`nuisance`) by `BRIBERY_FAILURE_NUISANCE_HIT` (8), and adds `BRIBERY_FAILURE_CORRUPTION_DELTA` (2) corruption (can unlock the mafia).
- **Mafia failure (#1411):** a botched accident or detected frame raises exposure by `INVESTIGATION_EXPOSURE_JUMP` (0.2) and queues the repeatable follow-up `INVESTIGATION_FOLLOWUP_EVENT_ID` (`mafia_police_investigation`: pay off detective / hire lawyer / stonewall; events may carry `exposureDelta`). Exposure decays `EXPOSURE_DECAY_PER_TICK` (0.004) per tick once `EXPOSURE_CLEAN_GRACE_TICKS` (30) pass with no mafia action (smuggling is not one) (`mafia.lastActivityTick`). Each of these raises a toast (`ui/notify/corruptionNotifications.ts`). Mafia rewards unchanged.
- **Union members and dismissal (#1872):** union members can be removed only by an arranged accident (and `employee_leaves` events); Crew dismissal and the frame refuse them (`frameRefusal` -> `mafia.frame_union_refused`: no cost, no exposure, no pending frame; a pending frame whose target has since unionized is dropped at completion with the same refusal and no roll). An ordinary dismissal dents every remaining living employee's morale by `DISMISSAL_CREW_MORALE_DENT` (6, clamped at 0, `applyDismissalMoraleDent`); a successful frame fires "for cause" (`forCause`) and does not, as do events. The frame is the clean way to remove a non-union employee; the accident the only way to remove a union one (it books a death).
- **Arranged accident (#1700):** a successful arranged accident is booked as a workplace death: `deathCount` rises (costs a safety star, shows on the level report) and `lawsuitPending` is set so death lawsuit/politics events can fire; a `death` AccidentRecord is logged (safety -5/tick for 10 ticks). Only the mafia's hand stays hidden; exposure is unchanged.
- **Mafia:** Dark escalation path. An arranged accident is the only way to remove a union member (besides events); a frame refuses union targets. Smuggling. Gets progressively more dangerous.
- **Smuggling vs tax audit (#1409):** smuggling income per tick = chosen volume (`SMUGGLING_VOLUME_LEVELS` 0.1 / 0.25 / 0.5 / 1, or off) x trailing operating income per hour, so a mine that does no mining earns $0. It adds no exposure; the risk channel is the **Tax audit** (fr « Contrôle fiscal »): open daily books on an audit clock, per-tick hazard from `P(share)`, a **regularisation** (fr « régularisation ») of `rho(share)` plus the recidivism surcharge (`TAX_RECIDIVISM_SURCHARGE`, capped at `TAX_RECIDIVISM_MAX_STEPS`) on the smuggled income under review, cooldown and ramp after any audit, and a closing audit at level completion. Clean audits cost nothing ("everything is in order"). A regularisation never bankrupts: cash above `BANKRUPTCY_THRESHOLD` is paid at once, the rest is collected from later income. Final constants are the `TAX_AUDIT_*` block in `src/core/config/balance.ts` (B 2160, P 0.20/0.50/0.80, E +0.10/-0.25, cooldown and ramp 720, anchors 0.20/0.50); formulas and rationale in `docs/plans/issue-1409-smuggling-balance.md`. **No risk figure is ever shown** (no audit chance, no sweet-spot hint, no audit percentage in the Shady panel or `mafia status`): the player only sees audits when they happen and what they cost.

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

### Pit mask shape (#1680)

The pit-suitability mask compresses relief toward the site's centre height inside the playable rect and blends back to raw height outside it. Its shape is `PitMaskShape { margin, reliefKeep, envelopeSlope?, outlineWobble?, cornerRadius? }` (`balance.ts`). Campaign levels and standalone worlds use `DEFAULT_PIT_MASK` (24 m, keep 0.3), unchanged. Sandbox starts use `SANDBOX_PIT_MASK` (14 m, keep 0.05, envelopeSlope 0.25, outlineWobble 3, cornerRadius 8) so at least `SANDBOX_FLAT_PAD_TARGET` (25%) of interior 9x9 m pads (origin step 3) have a surface spread of at most `SANDBOX_FLAT_PAD_MAX_SPREAD` (2 m); measured worst case ~68% (tropical_karst, seed 7, 64x64). Envelope rule (#1734, when `envelopeSlope` is set; legacy smoothstep blend otherwise): `d` = Euclidean distance from the flat core (rect inset by `margin`, corners rounded by `cornerRadius`) minus a deterministic outline wobble in [0, 2*outlineWobble] (`pitDistance`, `outlineWobbleAt`, `WorldGen.ts`); with `delta = h - centre`, `inner = delta*reliefKeep`, result = `centre + inner + clamp(delta - inner, -envelopeSlope*d, envelopeSlope*d)`. The flat area therefore joins the landscape on a cone of at most `envelopeSlope` m/m, continues beyond the rect, and equals natural height once inside the cone. 0.25 was picked by measurement (0.45 left sides of tropical/alpine seeds with no climbable path to drill-hole rings 6/18/30 m outside the grid); grid and landscape agree because both call `applyPitMask`. The clamp flattens a natural wall inside the cone but cannot erase it (pointwise mask), so the unit test only requires that the blend never makes a perimeter step steeper than the landscape's own. Mountains stay dramatic once past the cone. The mask rides `LevelDef.pitMask` -> `WorldState.pitMask` -> `SerializedTerrainGen.pitMask`, validated on load (`requireValidPitMask`), absent meaning the default. `TERRAIN_GENERATOR_VERSION` and `SAVE_VERSION` are not bumped (unreleased game policy).

## Material Catalogs

### Rocks (fictional, humorous names)
Each has: ore probability, procedural texture, hardness, porosity, density.
Examples: Cruite (soft), Grumpite (medium), Obstiite (hard), endgame rocks.

### Explosives (fictional, humorous names)
Each has: energy yield, cost, water sensitivity, charge limits, minimum rock tier (rock harder than that breaks only at a steep energy penalty, never refused), vibration profile.
Examples: Pop-Rock (starter), Big Bada Boom (mid), Dynatomics (endgame).
Cost: costPerKg x kg is charged when the charge order is placed (finance category `explosives`) and refunded in full if the order is cancelled; firing the blast charges nothing.

**Delivery wait (#1895, owner decision 2026-10-17):** explosives drawn from Explosive Warehouse stock load at once; the cash-bought part of a charge order is delivered `EXPLOSIVE_DELIVERY_TICKS` (400, flat per order, not per kg) after ordering, and nobody can claim that hole's charge order until then (blocked reason `explosives_in_transit`, a neutral wait, not a failure). An order fully covered by stock carries no wait. Rationale: a site firing about one pattern per 500 ticks saves ~400 ticks per stocked pattern, which is what pays the warehouse's build cost and upkeep back (price discount alone never did). Charge step shows `[data-info="delivery-hint"]` and `[data-info="delivery-transit"]`. Lever: the constant in `balance.ts`.

Level explosive lists (`availableExplosives`) are enforced in the Charge step and console `charge` (single, `hole:*`, saved-plan queue); sandbox/new_game (no known level) use the full catalog.

### Ores
Fictional humorous names. "Treranium" (très rare, high value), common ores, exotic ores.

## Weather System

Procedural cycle: sunny → cloudy → rain → heavy rain → storm → heat wave → cold snap.
Rain fills drill holes. Water-sensitive explosives fizzle in a wet hole. Tubing is purchasable per-hole waterproofing.

**Pinned weather (#1585).** A level may set `LevelDef.fixedWeather`; `createGame` then builds a pinned cycle (`WeatherCycleState.pinned`, optional so saves need no bump): `tickWeather` returns `current` without drawing from the rng, `forecast` repeats it, `setWeather`/`forceAdvance` stay explicit overrides. `tutorial_pit` is pinned `sunny` so rain cannot flood the scripted blast. Levels with `eventFreqMultiplier` 0 run no tax audits (income is still booked).
**Hole water (#1350).** Each drilled hole carries `GameState.holeWater[id] = { level 0..1, porosity }` (porosity sampled once from the dominant rock under the hole, `dominantRockUnderHole` + `getRock().porosity`; grid-less runs use 0), and the site carries `groundWetness` 0..1; both persist (save v32). `tickHoleWater` runs in `runTick` right after `tickWeather` and advances every hole with `advanceHoleWater`: rain adds `rain * HOLE_RAIN_FILL_RATE`, wet ground seeps in `groundWetness * porosity * HOLE_SEEP_RATE`, and with no rain the level fades by `HOLE_WATER_FADE_RATE * (1 - porosity * HOLE_FADE_POROSITY_SLOWDOWN)` (porous rock holds water about twice as long). Ground wetness rises with rain (`GROUND_WETNESS_RISE_RATE`) and decays when dry (`GROUND_WETNESS_DECAY_RATE`, lingers a few ticks). Tuning: a storm fills a bare hole in about 2 ticks, light rain about 8; water fades in 12-24 ticks in tight rock; tight rock (0.03) never floods from wet ground, porous rock (0.35) does within about 100 ticks at full wetness. A hole is wet while `level > HOLE_WET_THRESHOLD` (`isHoleFlooded`); `wetHoles` / `wetHoleIdsFor` derive from the stored level, so the previews, `executeBlast`, the blast report, the preflight checklist and the Drill/Charge/Fire steps all read the same water state. Wet holes keep their effect on water-sensitive explosives.
**Tubing is watertight, not draining.** A tubed hole neither gains nor loses water; tubing never removes water already inside. It can be bought and installed at any time, rain or not (the Charge step offers it whenever untubed holes exist).
**Draining.** `drain_hole hole:<id|*>` (Charge step: Drain button, plus one per hole row) sets a wet hole's level to 0 and costs `HOLE_DRAIN_COST_PER_HOLE`. Refused when the hole is dry, unknown, cash is short, or it is untubed in porous rock (`porosity >= HOLE_DRAIN_POROSITY_LIMIT`: the ground refills it at once; tube it first, then drain, or wait). `*` targets every wet hole: blocked ones are named, the rest still drain. Removing a hole, firing, or `resetPlanState` drops its water entry. `weather set <state>` (console override) changes the weather only; standing water stays and fades or seeps away on its own, so a scenario that needs dry holes waits on `wetHoleCount` reaching 0.
Weather advances once per tick in `runTick` (`tickWeather`, right after time advances, before events read `weatherId`) and lives in `GameState.weather` (`WeatherCycleState`), persisted with the save (v30) with its own PRNG stream `rngState` (mulberry32 int32, seeded `seed + WEATHER_RNG_SEED_OFFSET`); history is capped at `WEATHER_HISTORY_MAX`. The TopBar forecast runs the same `tickWeather` primitive on a clone, so forecast day N equals the live weather after N days of ticks. `createGame` reseeds weather for every start (browser level swap, console `new_game`, sandbox, campaign); a refused start leaves the old state untouched. `weather advance` uses `forceAdvanceInState`.
**Per-biome climates (#1688).** The weather follows the site's biome (`GameState.mineType`, a BiomeCatalog id). `WeatherClimates.ts` holds four climates (`transitions` + `durations`); `getWeatherClimate(biomeId)` maps `desert_badlands`/`red_canyon`/`volcanic_flats` to arid, `tropical_karst` to tropical, `alpine_granite` to alpine, `green_foothills` to temperate; undefined or unknown ids (including the `createGame` default `desert`) fall back to `WEATHER_FALLBACK_CLIMATE` (temperate, the original tables verbatim). The biome is passed in by each caller (`createWeatherCycle`, `tickWeather`, `forecast`, `forceAdvanceInState`, `setWeather`) and never stored in the cycle, so saves are unchanged and the RNG stream shape is identical. Initial state is always `sunny`; pinned weather is unaffected. Measured with `tickWeather`, 5 seeds x 6,000 ticks (wet = light rain + heavy rain + storm):

| Climate | Wet | Heat wave | Cold snap | Storm | Median dry spell |
|---------|-----|-----------|-----------|-------|------------------|
| arid | 6.4% | 16.0% | 0.9% | 0.2% | 43 ticks |
| tropical | 45.4% | 2.7% | 0.1% | 4.1% | 12 ticks |
| temperate | 28.3% | 4.4% | 3.0% | 2.0% | 29 ticks |
| alpine | 12.7% | 0.3% | 28.8% | 0.4% | 47 ticks |

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

**Tutorial determinism (#1600):** `LevelDef.hiringScript` (`TUTORIAL_HIRING_SCRIPT`: one non-union, skill-bonus-0 candidate per hiring role, ids 1..5) replaces the seeded hiring pool on `tutorial_pit` (`createHiringPool`/`refreshHiringPool` take the script; a refresh restores a hired candidate under the same id), and the hire stages target that candidate's `data-candidate-id`. `LevelDef.scriptedOreSale` (`TUTORIAL_ORE_SALE_OFFER`: 300 kg rustite, price factor 1.0, deadline 200) is put on the contract board by `ensureScriptedOreSale` at campaign start and on every contract refresh, with no RNG, so the `sell-ore` step never waits on the random board and no longer holds `clockMustRun`. 300 kg sits below the rustite the scripted blast always hauls in (334 kg after the first batch, 687 kg total). Only one candidate per role is offered, so a scenario hiring the same role twice must let the 24-tick pool refresh pass in between (24 single `tick 1`; a larger `tick` stops early on a need event).

**Dusty Hollow opens staffed (#1363):** `LevelDef.startingSite` (`DUSTY_HOLLOW_STARTING_SITE`) hires a driller, a blaster and a driver, buys a drill rig and a debris hauler, and places a Tier 1 Freight Warehouse and a Spoil Heap for free (#1574), so the crew can work from tick 0 with storage already synced and barren rock already having a dump (`regenerateGrid` → `placeStartingBuildings`, which spirals out from `STARTING_BUILDING_STANDOFF_M` from the crew toward the site centre so a footprint cannot wall a vehicle in). `createGameForLevel`/`campaign start` take a tri-state `staffed`: absent = the level's own site, `true` = the global `STARTING_SITE_STAFFED_COMPOSITION`, `false` = a bare site. The tutorial opens with a free Spoil Heap too (`TUTORIAL_STARTING_SITE`, no crew or fleet; with no crew `startingBuildingAnchor` stands off east of the site centre, clear of the tutorial's scripted build tiles). Dusty Hollow's `contractPriceMultiplier` is `DUSTY_HOLLOW_CONTRACT_PRICE_MULTIPLIER` (bisect window in `balance.ts`).

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
- **Keep playing (#1647):** a win's end screen offers a ghost KEEP PLAYING button (between REPLAY and CONTINUE, always on a win — tutorial, last level, 3 stars included; never on a defeat). `convertWinToFreePlay` (`Sandbox.ts`, console `campaign keep_playing`) refuses unless `levelEndReason === 'completed'`, then clears `levelEnded`/`levelEndReason` and detaches `campaign.activeLevelId` (recorded levels, stars and unlocks stay). The run is then sandbox free play: sandbox is derived from `activeLevelId === null`, no separate flag. `hasLevelEnded` is unchanged, so the freeze at a win (#1313) stays the default until the player opts in.
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

Sound is feedback and atmosphere: alive, never crowded, and it sounds like a worksite. Real field recordings from licensed free banks (machines, trucks, weather, thunder) carry the world; generative sounds carry the site's electronics (radio, phone, buzzer, backup alarm, siren) and the blast transient. Volume channels: master, effects, ambient, interface (music reserved). The Settings panel's "Audio credits" button opens the sound banks' licences and required attribution in a new tab.

- **Interface:** the site cabin. Every control has a click/hover/toggle sound inferred from what it is; panels open and close, tabs turn a page, a confirm stamps. Toasts come over the site radio by severity and a critical one sounds the alarm buzzer; a refused action buzzes. Orders are acknowledged over the radio, a hire signs and stamps the contract, a firing slams the cabin door, a purchase rings the till. Nothing sounds on the per-second tick.
- **World:** work bursts at the nearest sites (jackhammer, excavator, plate compactor, workshop hammer and grinder), trucks loading and tipping rock with their backup alarm, engines starting and air brakes, an air horn for a stuck vehicle, buildings finishing, drilled holes, loaded charges, survey beeps, workers collapsing, coins and the till for income, the shift whistle, a desk bell for research and level-ups, events ringing the cabin phone and then the caller (a picket crowd, a judge's gavel, knocks at the door, applause), and the end-of-shift whistle with applause or a breakdown and a dying whistle to end a level.
- **Blast:** evacuation siren and quickening warning beeps, a cancel tone, then a synthesized snap and sub-bass under real thunder cracks and claps scaled to the shot, the rumble rolling back off the pit walls, the debris rain from the real fragment flights, secondary and dud charges; the ambience ducks under it.
- **Ambience:** recorded breeze, storm wind, light and heavy rain beds follow the weather, and fair weather is nearly silent so the site is what you hear; thunder follows lightning; a diesel idle is heard only near machines that are running; now and then the rest of the site is heard from across the pit (a backup alarm, a jackhammer, a truck tipping).
- **Music:** none shipped; the architecture selects a menu track, one per biome and optionally one per campaign level.

Sound is positional (pan, distance, zoom). Everything is rate-limited in real time, so 8x speed never multiplies the noise. Implementation, licensing, tools and tuning: `dev-audio`.

## Localization (i18n)

English (en) + French (fr) from day one. All text externalized. Interpolation support. All fictional names localized.

## Art Direction

3D cartoon, Minion-like characters. Placeholder geometric shapes. Replaceable assets. Procedural rock textures. Marching cubes terrain.
