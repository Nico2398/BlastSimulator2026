# Issue #1409: Smuggling vs tax audit, balance analysis

This analysis feeds the "Open question" in #1409, which needs the expected-value
model and constants for the tax-audit mechanic. Every number below comes from
[`issue-1409-smuggling-model.py`](issue-1409-smuggling-model.py). The script uses
only the standard library and fixed seeds, and runs in about 12 s
(`python3 docs/plans/issue-1409-smuggling-model.py`).

## TL;DR: recommended constants

| Constant | Value | Meaning |
|---|---|---|
| `TAX_AUDIT_CHECK_INTERVAL_TICKS` | 168 (1 game week) | one audit draw per eligible check |
| `TAX_AUDIT_BASE_PROBABILITY` (p₀) | 0.10 | at 0 % smuggling: about one clean "everything is in order" audit every 12 weeks |
| `TAX_AUDIT_MAX_PROBABILITY` (p_max) | 0.80 | the owner's cap |
| `TAX_AUDIT_MAX_SHARE` (s_cap) | 0.50 | p rises linearly from p₀ at 0 % to p_max at 50 % |
| `TAX_AUDIT_COOLDOWN_WEEKS` (K_c) | 2 | no check at all for 2 weeks after any audit |
| `TAX_AUDIT_MITIGATION_WEEKS` (K_m) | 2 | the next 2 checks run at ×0.75, then ×0.875, then ×1 |
| `TAX_AUDIT_MITIGATION_FLOOR` (m₁) | 0.75 | must stay ≥ 0.75 (exploit analysis, §6) |
| `TAX_REGULARISATION_MULTIPLIER` (ρ) | 1.60 | first offence: repay 100 % of the smuggling under review **plus a 60 % penalty** |
| `TAX_RECIDIVISM_SURCHARGE` (δ) | 0.25 | +25 % per earlier conviction in this level |
| `TAX_RECIDIVISM_MAX_STEPS` | 2 | capped at ρ = 2.10 (3rd conviction onward) |

Resulting curve (exact expected value over a 12-week level, as a fraction of the mine's legit income):

| Smuggling share | 0 % | 5 % | 10 % | 15 % | **20 %** | 25 % | 30 % | 40 % | 50 % |
|---|---|---|---|---|---|---|---|---|---|
| Expected net gain | **0** | +3.8 % | +6.8 % | +8.8 % | **+9.6 %** | +9.1 % | +6.9 % | −3.9 % | **−27.7 %** |
| Audit chance per check | 10 % | 17 % | 24 % | 31 % | **38 %** | 45 % | 52 % | 66 % | **80 %** |
| P(level ends worse than honest) | 0 | 1 % | 4 % | 8 % | **14 %** | 21 % | 29 % | 47 % | **65 %** |

- **0 %** is perfectly safe: zero variance, and audits find nothing.
- **20 %** is the best on average (+9.6 %) and the most volatile of the profitable
  shares. A 12-week level spans −7 % to +22 % (5th to 95th percentile).
- **50 %** loses 28 % of a level's legit income on average. Each check catches the
  player 80 % of the time, never 100 %.

These results only hold if five mechanics change (§8). Two of the changes are
blocking: smuggling income must become a player-chosen share, and the
per-tick smuggling exposure has to go.

---

## 1. Why the current code cannot produce any sweet spot

1. **Smuggling is a flat $8,000/tick on/off toggle.** That is $1.34 M per game
   week, about 17× Dusty Hollow's $80 k target. The player has no share to
   choose; the share is only a side effect of how much they mine.
2. **Exposure +0.02/tick, never decaying, gets the player arrested at exposure
   0.9 after 45 ticks** (under two game days), whatever the intensity. Any
   sustained smuggling ends the level long before the first weekly audit. While
   that rule stays, the audit maths has no effect. The issue says "exposure/arrest
   rules are unchanged", but that cannot hold for smuggling (§8.2).

## 2. Model

Time is counted in audit checks, one game week each. Notation:

- C: legit income per week (contracts and sales, the `OPERATING_INCOME_CATEGORIES`), normalised to 1.
- s: smuggling share of income, so smuggling income is S = C·s/(1−s).
  At 20 % share, S = 0.25 C; at 50 %, S = C.
- p(s) = p₀ + (p_max − p₀)·min(1, s/0.5): audit probability per eligible check.
- ρ: regularisation multiplier. A conviction costs ρ × the smuggling under review.

The net gain over an honest mine is G(s) = S(s) − E[regularisations]. Everything
scales with C, so **the optimum share does not depend on how rich the mine is.**
It holds on every level without per-level tuning.

## 3. Core result: the single-draw closed form

Suppose every smuggled dollar faces exactly one audit draw at probability p(s).
The gain is then

    G(s) = C · s/(1−s) · (1 − ρ·p(s))

Write p(s) = p₀ + k·s with k = 2(p_max − p₀), a = 1 − ρp₀ and b = ρk. Setting
dG/ds = 0 gives b·s² − 2b·s + a = 0, so

    s* = 1 − √(1 − a/b)

For a target optimum s* the condition is a/b = s*(2 − s*), which is 0.36 at
s* = 0.20. Solving for ρ:

    ρ = 1 / (p₀ + 0.72·(p_max − p₀))        (for s* = 0.20, s_cap = 0.5)

| p₀ | ρ for s* = 20 % | G(20 %) | G(50 %) |
|---|---|---|---|
| 0.05 | 1.695 | +10.2 % | −35.2 % |
| 0.10 | 1.656 | +9.3 % | −32.5 % |

Three properties follow directly from the formula:
- **G(0.5) = 1 − ρ·p_max < 0 holds automatically** whenever p₀ < p_max. The 20 %
  optimum and the 50 % loss are the same constraint, not two to balance.
- ρ > 1 always. Once caught, the smuggling under review nets −(ρ−1), so it ends
  up worse than doing nothing. That matches the owner's "less interesting than a
  contract".
- The optimum depends only on p₀, p_max and ρ, not on C, the level, or its length.

The rest of the analysis makes the real mechanic (cooldown, ramp, recidivism,
level end) behave like this closed form.

## 4. The audit must close the books at every check

A naive reading of "regularisation on the smuggling income since the previous
audit" has a fatal flaw. Every audit finds all the unaudited smuggling, so
**every smuggled dollar is eventually regularised**. In the long run
G(s) = S·(1 − ρ), which is monotone in s: either "smuggle as much as possible"
(ρ < 1) or "never smuggle" (ρ > 1), with no sweet spot. Capping the look-back at
L weeks only partly fixes this. A brute-force search over (p₀, K_c, K_m, L, ρ)
found a weak, flat peak: about +6.7 % at 20 %, nearly the same at 10 % and 30 %.

**Fix: the books are open between eligible checks.** At each eligible check, the
auditor looks at the open books (all income since the books last closed):

- The audit probability is p(share of the open books) × the mitigation multiplier.
- If there is an audit and the open books contain smuggling, the player pays
  ρ_k × the smuggling in the open books (k is the conviction count). If there is
  smuggling but no audit, nothing is owed.
- **The books close either way** ("fiscal period closed"). The same dollar is
  never charged twice.
- During the cooldown there is no check, so **the books stay open**. Cooldown
  income is reviewed at the first eligible check after it.

Without mitigation, each dollar then faces exactly one draw at p(s), which is the
closed form in §3. **The cooldown alone is EV-neutral**: it makes audits rarer
but larger. Its only cost to the player is variance, which is intended.

## 5. The mitigation ramp lowers effective risk and must be compensated

A mitigated check (×m < 1) still closes the books, so dollars earned during the
cooldown settle at a reduced probability. Measured with the renewal model, the
effective risk is κ(s)·p(s):

| share | 10 % | 20 % | 30 % | 50 % |
|---|---|---|---|---|
| κ (K_c=2, K_m=2, m₁=0.75) | 0.87 | 0.83 | 0.81 | 0.78 |

κ falls as the share rises because heavy smugglers are audited more often and so
spend more of their time in cooldown and ramp. That flattens the curve at high
shares, and ρ has to rise to compensate: from 1.66 without a ramp to 2.07 with
this ramp and no recidivism.

An alternative was tested: closing the books only at full-strength checks. It
over-penalises low shares (κ > 1, peaking near 20 %) and was rejected.

## 6. Exploits: cooldown bursts and end-of-level bursts

The ramp lets a player smuggle hard during the cooldown and settle at a weak
check. An exact renewal search over phase-dependent shares (p₀ = 0.05, no recidivism,
ρ refitted per row so steady play peaks at 20 %) measured how much the best such
policy beats a steady 20 %:

| Ramp | ρ needed | Best adaptive policy vs steady 20 % |
|---|---|---|
| none (K_m = 0) | 1.69 | +0 % (steady is optimal) |
| K_c=1, K_m=1, m₁=0.50 | 2.39 | **+161 %** (90 % share through cooldown and ramp) |
| K_c=2, K_m=2, m₁=0.50 | 2.68 | +15 % |
| K_c=2, K_m=2, m₁=0.75 | 2.10 | +1.5 % (negligible) |

**Rule: m₁ ≥ 0.75.** With the final constants, a 12-week Monte Carlo
(n = 20,000) of named strategies:

| Strategy | Net gain |
|---|---|
| steady 20 % | **+9.7 %** |
| best phase-dependent policy (grid search) | steady 20 % / 20 % / 20 % |
| 50 % during cooldown, else 20 % | −12.6 % |
| 75 % during cooldown and ramp, else 20 % | −60.1 % |
| smuggle only during cooldown (50 %) | −2.5 % |
| 20 % until caught, then honest | +2.2 % |
| 20 %, then 10 % once caught | +7.4 % |
| honest, 75 % in the last week | −6.0 % (closing audit) |

Without a **closing audit** at level completion, "smuggle hard just before
reaching the target" escapes every check. That is the exact exploit #1409 was
filed for. The closing audit draws once on the open books at full p(s), with no
cooldown or mitigation.

## 7. Recidivism over a level

Over a level, a steady smuggler is convicted repeatedly (2.7 times in 12 weeks at
20 %). A per-conviction surcharge therefore pulls the level-average optimum down.
With ρ = 2.1 and +0.5 per conviction, the optimum fell to 10–15 %. ρ and δ
were fitted together so that the **level-average** optimum is 20 %
(12-week Monte Carlo, n = 6,000):

| ρ | δ | argmax | G(10 %) | G(20 %) | G(30 %) | G(50 %) |
|---|---|---|---|---|---|---|
| 1.5 | 0.25 | 22.5 % | +7.0 % | +10.4 % | +8.8 % | −22.1 % |
| **1.6** | **0.25** | **20 %** | +6.8 % | **+9.6 %** | +6.9 % | **−28.7 %** |
| 1.7 | 0.25 | 20 % | +6.5 % | +8.8 % | +5.1 % | −35.2 % |
| 1.6 | 0.35 | 17.5 % | +6.6 % | +8.7 % | +4.5 % | −38.3 % |

The second offence costs 185 % and the third onward 210 %. Recidivism resets
with each level.

A player who adapts to their conviction count gains nothing. A grid search over
shares per conviction count (0 / 1 / 2+ convictions, each in 15–35 %) found
(20 %, 25 %, 20 %) at +9.76 %, against +9.69 % for a steady 20 %, which is within
Monte Carlo noise. **20 % is the optimum at every point of a level, not only on
average.** Easing off is mildly worse but not punished ("20 %, then 10 % once
caught" scores +7.4 %).

Pitfall: do not tune ρ from a model where ρ never changes. Under the renewal
model, ρ = 1.6 alone would put the optimum at about 30 %. Only the
level-scale fit above, which counts the surcharges a conviction triggers later,
gives 20 %.

## 8. Changes the mechanic needs (owner decisions)

1. **Smuggling becomes a share the player chooses.** Smuggling income per tick
   = k × the trailing operating income per hour
   (`OperatingFinance`, `OPERATING_INCOME_WINDOW_TICKS` = 72, #1375). The player
   sets k with a volume control (for example Discreet / Steady / Bold / Brazen at
   k = 0.1 / 0.25 / 0.5 / 1, which is 9 / 20 / 33 / 50 % share), with no risk
   figures shown. Satirical framing: the contraband rides in your ore trucks.
   Side effects:
   - **A mine that does no mining earns $0 from smuggling.** This removes #1409's
     original repro (win in 13 ticks with zero mining) by construction.
   - It also keeps the optimum stable. With *flat* smuggling and lumpy contract
     income (CV = 1), the share fluctuates, convexity costs EV, and the optimum
     drifts to 15 % (+6.0 % at best instead of +9.5 %).
   - If a flat floor is wanted anyway, then at 100 % share
     G = S·(1 − 1.6·0.8) < 0, and with the closing audit the chance of reaching a
     target over n weekly checks with no conviction is ≤ 0.2ⁿ⁺¹.
2. **Remove `SMUGGLING_EXPOSURE_PER_TICK` from smuggling.** The audit replaces it
   as smuggling's risk channel. Otherwise arrest at tick 45 overrides everything.
   Arrest stays fed by accidents and framings, as today. I recommend that a
   conviction adds **no** exposure, so an audit can never end a run.
3. **Every eligible check closes the books** (§4), and **the cooldown keeps them open**.
4. **Closing audit at level completion** (§6).
5. **Mitigation floor m₁ ≥ 0.75** (§6).

## 9. Keeping it fun when caught

- **Size of a hit.** At 20 % share, a normal-week conviction costs 0.25 × 1.6 =
  0.4 week of legit income, a net loss of 0.15 week against not having smuggled
  that week. The biggest possible hit (first check after a cooldown, three weeks
  under review, third offence) is 0.75 × 2.1 ≈ 1.6 weeks of legit income, a net
  loss of 0.8 week. That stings but does not end the game. At 50 % the same worst
  case is 6.3 weeks (net −3.3), which is the zone the player was warned off by
  the game's own outcomes.
- **Never bankrupt from a regularisation.** Take what is available above
  `BANKRUPTCY_THRESHOLD` immediately and collect the rest as an instalment plan
  from future income (for example over 4 weeks). EV is unchanged, and an audit
  can never by itself trigger the bankruptcy grace period.
- **Variability is the point.** At 20 %, a 12-week level has σ = 9.1 % against a
  mean of 9.6 % (coefficient of variation ≈ 1), and 14 % of runs end below
  honest. At 10 %, σ = 3.2 % and 4 % end below honest. Honest play has σ = 0.
- **Honest players still see the system.** At p₀ = 0.10 they get about one clean
  audit per 12 weeks ("everything is in order"), so the mechanic is known before
  anyone gets caught.

### "Probability of being caught": per check vs per level

The 80 % cap is **per check**. Over a level of many weekly checks, a steady
smuggler at 10 % or more is almost surely caught at least once (12 weeks at
20 %: P(never caught) ≈ 0). The variability comes from how many times and how
large each hit is, not from whether it happens at all. If the owner wants
"never caught this level" to be a real outcome, lengthen the check period.
The whole model is measured in checks, so the 20 % optimum is unchanged:

| Checks per level | P(never caught) at 10 % | at 20 % | at 30 % | at 50 % | G(20 %) | G(50 %) |
|---|---|---|---|---|---|---|
| 3 | 45 % | 24 % | 11 % | 1 % | +9.0 % | −39.7 % |
| 4 | 34 % | 15 % | 5 % | 0 % | +10.0 % | −19.6 % |
| 6 | 20 % | 6 % | 1 % | 0 % | +10.1 % | −28.6 % |

The trade-off: fewer, larger hits. A monthly check (672 ticks) is a reasonable
alternative if a level runs about 3 months of game time.

## 10. Robustness (exact Markov chain; Monte Carlo agrees to ±0.001)

| Level length | G(10 %) | G(20 %) | G(30 %) | G(40 %) | G(50 %) | argmax |
|---|---|---|---|---|---|---|
| 6 weeks | +6.9 % | +10.1 % | +7.8 % | −3.2 % | −28.6 % | 20 % |
| 12 weeks | +6.8 % | +9.6 % | +6.9 % | −3.9 % | −27.7 % | 20 % |
| 20 weeks | +6.6 % | +9.2 % | +6.2 % | −4.8 % | −28.6 % | 20 % |
| 30 weeks | +6.5 % | +8.9 % | +5.9 % | −5.2 % | −29.1 % | 20 % |

Lumpy legit income (gamma, CV = 1) with proportional smuggling: argmax stays at
20 % (+9.5 %).

## 11. What the implementation should pin

- **Deterministic test.** Port `exact_level` (§10, a forward Markov chain over
  weeks since audit, conviction count and open-book weeks: about 30 states, no
  randomness) to `src/core/` as a pure function of the balance constants.
  Assert that argmax over s ∈ {0, 0.05, …, 0.5} is 0.20, that G(0) = 0, that
  G(0.2) > G(0.1) and G(0.2) > G(0.3), and that G(0.5) < 0.
- **Seeded simulation.** Run the real `TickPipeline` audit code over many seeds
  with scripted shares 0 / 0.2 / 0.5. Check that the mean ordering is
  20 % > 0 % > 50 %, that 0 % never pays a regularisation, and that 50 % pays at
  least one in most runs.
- **Scenario.** Smuggling-only on Dusty Hollow earns $0 (proportional) and cannot
  complete the level. A mine at Steady (20 %) ends ahead of the same mine at Off
  on average.
