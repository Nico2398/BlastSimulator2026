---
name: employee-needs
description: >
  Employee needs system for BlastSimulator2026: 3 need gauges (hunger, fatigue, break pressure),
  morale effects, collapse and interruption, proactive queue insertion, building replenishment
  rates, shift cycles, and atomic task breakdown. Use when implementing or modifying employee
  well-being, rest mechanics, canteen, bunkhouse, break room, or shift systems.
---

## Design Goals

3 biological needs modelled as gauges — fill over time, satisfied by visiting buildings. Unmet needs drain morale, reduce effectiveness, cause collapse. Connects to Buildings (Ch.1) + Task Queue (Ch.3).

## Need Gauges

Each employee has three gauges (0–100; 100 = fully satisfied):

| Gauge | Fills at | Drains at | Collapse Threshold |
|-------|----------|------------|-------------------|
| `hunger` | Eating at Canteen | −1/tick (working) / −0.5/tick (idle) | ≤ 10 |
| `fatigue` | Sleeping at Bunkhouse | −0.5/tick (awake) / −2/tick (active task) | ≤ 5 |
| `breakNeed` | Taking break at Break Room | −0.8/tick (working) | ≤ 15 |

**Rate modifiers:**
- High morale (>70): drain rate ×0.85
- Low morale (<30): drain rate ×1.20

## Morale Effects of Needs

```
moraleEffect = Σ_need [ needPenalty(gaugeValue) ]

needPenalty(g):
  g >= 50: 0 (comfortable)
  g >= 30: −0.5/tick (uncomfortable)
  g >= 15: −1.5/tick (suffering)
  g <  15: −3.0/tick (critical — approaching collapse)
```

All needs above 80 simultaneously → **"well-rested" bonus**: +1 morale/tick (max 100).

## Collapse

When any gauge hits its collapse threshold:

1. Current task immediately interrupted (pushed back to front of queue)
2. `rest` task prepended — targeting nearest available building of the correct type
3. Employee flagged `collapsing: true` — effectiveness drops to 0 until rest completes
4. On `rest` completion: `collapsing` cleared, interrupted task resumes

| Collapsed Gauge | Rest Building | Rest Duration (ticks) |
|----------------|--------------|----------------------|
| `hunger` | Canteen | 2 |
| `fatigue` | Bunkhouse | 8 |
| `breakNeed` | Break Room | 3 |

If no suitable building within 20 cells: employee collapses in place, rest duration doubled.

## Building Replenishment Rates

| Building | Tier 1 | Tier 2 | Tier 3 |
|---------|--------|--------|--------|
| Canteen | +12 hunger/tick | +18 hunger/tick | +25 hunger/tick |
| Bunkhouse | +8 fatigue/tick | +14 fatigue/tick | +20 fatigue/tick |
| Break Room | +10 breakNeed/tick | +16 breakNeed/tick | +22 breakNeed/tick |

Building full → employee waits in queue (gauges drain at normal awake rate while waiting). Route to next nearest if no capacity.

## Proactive Need Queuing

Auto-insert rest tasks at warning thresholds — don't wait for collapse:

| Gauge | Warning Threshold | Auto-Insert Behaviour |
|-------|------------------|----------------------|
| `hunger` | 35 | Insert `rest(canteen)` after current task if not already queued |
| `fatigue` | 25 | Insert `rest(bunkhouse)` after current task if not already queued |
| `breakNeed` | 30 | Insert `rest(break_room)` after current task if not already queued |

Queue full → skip auto-insert + emit `need_warning` event for player.

## Cost of Needs

| Building | Cost per Visit |
|---------|---------------|
| Canteen | $10 (Tier 1) / $8 (Tier 2) / $6 (Tier 3) |
| Bunkhouse | $0 (included in salary) |
| Break Room | $5 per employee |

## Shift System

If player builds a **Bunkhouse Tier 2+**, an 8-tick shift cycle activates:
- Employees work 6 ticks → automatically enter 8-tick sleep rest at bunkhouse
- `employee_shift_change` event fired at shift boundaries
- Without Bunkhouse: employees remain awake indefinitely (fatigue accumulates faster)

## TypeScript Reference

```typescript
// Fields added to Employee interface (Ch.3):
export interface Employee {
  // ... existing fields ...
  hunger: number;       // 0–100
  fatigue: number;      // 0–100
  breakNeed: number;    // 0–100
  collapsing: boolean;
}
```

## Atomic Task Breakdown

| # | Task | File(s) |
|---|------|---------|
| 7.1 | Add `hunger`, `fatigue`, `breakNeed`, `collapsing` fields to `Employee` | `src/core/entities/Employee.ts` |
| 7.2 | Add `NEED_DRAIN_RATES`, `NEED_WARNING_THRESHOLDS`, `NEED_COLLAPSE_THRESHOLDS` to `balance.ts` | `src/core/config/balance.ts` |
| 7.3 | Implement `tickNeedGauges()` — drain rates based on task state + morale modifier | `src/core/entities/Employee.ts` |
| 7.4 | Implement `needsMoraleEffect()` — morale delta from all gauges per tick | `src/core/entities/Employee.ts` |
| 7.5 | Implement `replenishNeed()` — fill gauge at building tier rate, enforce capacity | `src/core/entities/Employee.ts` |
| 7.6 | Implement `checkCollapse()` — interrupt task queue, prepend `rest` task | `src/core/entities/Employee.ts` |
| 7.7 | Implement `autoInsertNeedTasks()` — proactive queue insertion at warning thresholds | `src/core/entities/Employee.ts` |
| 7.8 | Deduct per-visit food/break costs from cash balance | `src/core/engine/GameLoop.ts` |
| 7.9 | Implement shift cycle for Bunkhouse Tier 2+ | `src/core/engine/GameLoop.ts` |
| 7.10 | Wire need events into event system (`need_warning`, `employee_collapsed`, `employee_shift_change`) | `src/core/events/EventSystem.ts` |
| 7.11 | Add i18n keys for need events and building-full message (en + fr) | `src/core/i18n/locales/en.json`, `fr.json` |
| 7.12 | Add `needs` console command — print all employees' gauge values | `src/console/commands/entities.ts` |
