# Issue #1409: Smuggling vs tax audit, balance model

This is the balancing model for the tax-audit mechanic decided on #1409. Every
number here comes from [`issue-1409-smuggling-model.py`](issue-1409-smuggling-model.py),
which uses only the standard library, is seeded, and runs in about 2 minutes
(`python3 docs/plans/issue-1409-smuggling-model.py`).

## TL;DR

The designer sets **six numbers**. Every other constant is derived from them by
closed-form formulas, and the 20 % peak is guaranteed by construction.

| Designer input | Default | Meaning |
|---|---|---|
| `TAX_AUDIT_TIME_BASE_TICKS` (B) | 2160 (90 days) | the period the three audit chances refer to |
| `TAX_AUDIT_CHANCE_AT_ZERO` (P₀) | 0.20 | chance of an audit within B at 0 % smuggling (harmless) |
| `TAX_AUDIT_CHANCE_AT_SWEET_SPOT` (P₂₀) | 0.50 | chance of an audit within B at 20 % share, a coin flip |
| `TAX_AUDIT_CHANCE_AT_MAX` (P₅₀) | 0.80 | chance of an audit within B at a share of 50 % or more |
| `TAX_AUDIT_GAIN_AT_SWEET_SPOT` (E₂₀) | +0.10 | expected gain at 20 %: +10 % over an honest mine's income |
| `TAX_AUDIT_GAIN_AT_MAX` (E₅₀) | −0.25 | expected gain at 50 %: −25 % against an honest mine |

Secondary knobs. The cooldown and ramp are proven EV-neutral (§3), and recidivism
is a deliberate extra deterrent (§5):

| Knob | Default |
|---|---|
| `TAX_AUDIT_COOLDOWN_TICKS` | 720 (30 days): no audit at all after any audit |
| `TAX_AUDIT_RAMP_TICKS` | 720 (30 days): the audit clock then speeds back up linearly |
| `TAX_RECIDIVISM_SURCHARGE` (δ) | 0.20 added to ρ per earlier conviction this level |
| `TAX_RECIDIVISM_MAX_STEPS` | 2 (surcharge capped at +0.40) |
| anchor shares s₁, s₂ | 0.20 and 0.50 (the sweet spot and the max-risk share) |

Result with the defaults, for a player with a clean record. These values are
exact for any level length:

| Smuggling share | 0 % | 5 % | 10 % | 15 % | **20 %** | 25 % | 30 % | 40 % | **50 %** | 75 % |
|---|---|---|---|---|---|---|---|---|---|---|
| Audit chance within 3 months | 20 % | 28 % | 35 % | 43 % | **50 %** | 55 % | 60 % | 70 % | **80 %** | 80 % |
| Regularisation multiplier ρ | none | 1.91 | 1.57 | 1.35 | **1.20** | 1.59 | 1.73 | 1.71 | **1.56** | 1.56 |
| Expected gain vs honest | **0** | +2.5 % | +5.0 % | +7.5 % | **+10 %** | +4.2 % | −1.7 % | −13 % | **−25 %** | −75 % |

- **0 %** is perfectly safe. Audits happen, but they find nothing.
- **20 %** is the best on average and a coin flip per quarter. Uncaught, the player
  keeps all the smuggling. Caught, they repay 120 % of it.
- **50 %** has an 80 % audit chance per quarter, high but never certain. When
  caught, the player repays 156 %.

## 1. Why the current code cannot balance

- **No share to choose.** Smuggling is a flat $8,000/tick toggle, or $1.34 M per
  week, about 17× Dusty Hollow's $80 k target.
- **Arrest overrides everything.** Smuggling adds +0.02 exposure per tick and
  exposure never decays. That reaches the arrest threshold of 0.9 after 45
  ticks, under two game days, at any intensity. No audit maths matters while
  that rule holds (§7).

## 2. The three formulas

Notation: legit income C = 1 per unit of time; share s; smuggling income
S(s) = s/(1−s). At 20 %, S = 0.25; at 50 %, S = 1.

**Audit chance within one time base**, piecewise linear through the three anchors:

    P(s) = P₀ + (P₂₀ − P₀)·s/s₁                   for s ≤ s₁
         = P₂₀ + (P₅₀ − P₂₀)·(s − s₁)/(s₂ − s₁)   for s₁ < s ≤ s₂
         = P₅₀                                     for s > s₂

**Target expected gain**, as a fraction of legit income. It is piecewise linear
through (0, 0), (s₁, E₂₀), (s₂, E₅₀), then follows the curve of a constant ρ:

    G*(s) = E₂₀·s/s₁                              for s ≤ s₁
          = E₂₀ + (E₅₀ − E₂₀)·(s − s₁)/(s₂ − s₁)  for s₁ < s ≤ s₂
          = E₅₀·S(s)/S(s₂)                         for s > s₂

**Regularisation multiplier**, computed at audit time from the share s of the
books under review. The mechanic in §3 catches each smuggled dollar with
probability exactly P(s), so G(s) = S(s)·(1 − ρ(s)·P(s)). Solving for ρ:

    ρ(s) = (1 − G*(s)/S(s)) / P(s)

    so  ρ(s₁) = (1 − E₂₀·(1−s₁)/s₁) / P₂₀   = (1 − 4·E₂₀)/P₂₀   = 1.20
        ρ(s₂) = (1 − E₅₀) / P₅₀                                 = 1.5625

What the construction guarantees:

- **G = G\* exactly.** E₂₀ and E₅₀ are reached by definition, at every level
  length and every time base.
- **The peak is exactly at s₁** for any valid inputs, because G\* rises before s₁
  and falls after it.
- **No mixing beats steady play.** G\* is concave on [0, s₂], so by Jensen's
  inequality a player who alternates between a low and a high share does worse
  than one who holds the average share steadily (verified in §6).
- **ρ is not monotone.** It is 2.5 at tiny shares, dips to 1.2 at 20 %, then climbs
  to about 1.7 at 30 %. This is what forces the peak: past 20 % the penalty has
  to rise faster than the smuggling income does. The player never sees ρ, only
  the amount they pay, so the shape is not a visible tell.

## 3. The mechanic (implementation spec)

**Open books with an audit clock.** The audit clock X advances at speed m per
tick: m = 0 during a cooldown, m rises linearly from 0 to 1 during the ramp,
and m = 1 otherwise.

- Income is booked into daily buckets, each holding legit income, smuggling
  income and the X at which it was earned.
- A bucket leaves the books ("prescribed") once X has advanced by B since it
  was earned. The tax office reviews the last three months of audit-clock time.
- The share used everywhere is the smuggling share of the open books.

**Per tick:** an audit happens with probability

    h = 1 − (1 − P(s))^(m/B)        (B in ticks; exactly P(s) over one time base at m = 1)

**On an audit:**
- If the open books hold smuggling U > 0, the player pays
  (ρ(s) + δ·min(k, k_max))·U and the conviction count k rises by one.
- If U = 0, it is a clean audit ("everything is in order", no cost).
- Either way, the books are cleared and the cooldown starts.

**Closing audit at level completion.** If the open books hold smuggling, sample
how far back the next audit would have reached:

    T = −B·ln(u) / (−ln(1 − P(s))),   u uniform in (0, 1)

Then regularise every bucket whose remaining clock time (B minus its age) is
greater than T. If the payment drops profit below the target, the level goes on.
Without the closing audit, "smuggle hard just before winning" escapes every audit,
which is #1409's original exploit.

**Why the cooldown and ramp cost nothing in balance.** The clock stops during the
cooldown and slows during the ramp, but a dollar only leaves the books after a
full time base of audit-clock exposure. So every dollar faces exactly one time
base of full-strength risk, which is exactly P(s), however the audits are spaced.
The cooldown and ramp only change how often audits happen and how large each one
is. They never change the averages, so they can be tuned for feel alone. The
simulation confirms it: clean-record means equal G\* to within Monte Carlo noise at
every level length: ±0.007 up to a 50 % share, ±0.02 at 75 % (§5).

## 4. Valid inputs (checked by `validate()`; port it as a test)

| Constraint | Why |
|---|---|
| 0 < P₀ ≤ P₂₀ ≤ P₅₀ < 1 | an audit is never impossible and never certain |
| E₅₀ < 0 < E₂₀ | the shape the owner asked for |
| E₂₀ ≤ s₁·(1 − P₀) (= 0.16 at defaults) | ρ ≥ 1 at tiny shares: being caught always leaves you worse off than not smuggling |
| E₂₀ ≤ s₁/(1−s₁)·(1 − P₂₀) (= 0.125) | ρ ≥ 1 at the sweet spot |
| min ρ(s) ≥ 1 on (0, 1) (numeric scan) | the same rule everywhere |
| δ·k_max·[(P₂₀−P₀)/s₁·S(s₁) + P₂₀/(1−s₁)²] < E₂₀/s₁ (0.40 < 0.50 at defaults) | recidivism cannot pull the peak below s₁ (a conservative check, §5) |

Examples:

- E₂₀ = +0.15 is rejected, because ρ would drop below 1.
- P₂₀ = 0.60 with E₂₀ = 0.10 sits exactly on the ρ = 1 boundary and is rejected.

## 5. Results over a level, including recidivism

The model works in days, with steady shares and n = 3,000 runs per cell. "Clean"
is the run without recidivism, which shows the mechanic hitting G\*. The other
columns include recidivism.

| Level length | 10 % | **20 %** | 25 % | 30 % | **50 %** | argmax |
|---|---|---|---|---|---|---|
| clean, any length | +5.0 % | **+10.0 %** | +4.2 % | −1.7 % | **−25 %** | 20 % |
| 3 months | +4.8 % | **+9.3 %** | +2.7 % | −3.1 % | **−33.6 %** | 20 % |
| 6 months | +4.7 % | **+8.6 %** | +2.3 % | −4.5 % | **−40.9 %** | 20 % |
| 1 year | +4.6 % | **+7.6 %** | +0.6 % | −6.8 % | **−47.0 %** | 20 % |
| 2 years | +4.1 % | **+6.4 %** | −1.1 % | −9.3 % | **−51.7 %** | 20 % |

**Recidivism.** It makes repeat offending progressively worse, the longer the
level the more so, but **the peak stays at exactly 20 % at every length**. The
peak is a kink in G\*, with a slope of +0.5 to its left and −1.17 to its right. A
recidivism cost smaller than the left slope cannot move it, which is the
constraint in §4. The targets E₂₀ and E₅₀ are therefore the clean-record
expectation. Lower δ if the long-level erosion feels too strong.

**Variability**, over a 1-year level with recidivism:

| Share | σ | 5th–95th percentile | P(ends worse than honest) | P(never caught all level) | Audits per year |
|---|---|---|---|---|---|
| 0 % | 0 | 0 to 0 | 0 % | 100 % | 0.8 (all clean) |
| 10 % | 4.5 % | −3.9 % to +11.1 % | 17 % | 11 % | 1.8 |
| **20 %** | **9.2 %** | **−8.3 % to +22.9 %** | **23 %** | **3 %** | 2.6 |
| 30 % | 21.1 % | −43 % to +25 % | 61 % | 1 % | 3.2 |
| 50 % | 37.3 % | −91 % to +24 % | 88 % | 0 % | 4.5 |

**Per quarter, the odds are exactly the inputs.** At 20 %, a 3-month level ends
never caught 26 % of the time and a 6-month level 12 % of the time.

## 6. Exploit strategies (1-year level, with recidivism)

| Strategy | Net gain |
|---|---|
| **steady 20 %** | **+7.9 %** |
| alternate months 0 % / 40 % | +0.7 % |
| alternate quarters 0 % / 40 % | −3.6 % |
| 50 % during cooldown and ramp, otherwise 20 % | −14.5 % |
| smuggle only during cooldown and ramp (50 %) | −5.2 % |
| 20 %, then 75 % in the last 30 days | −7.4 % |
| honest, then 75 % in the last 14 days | −1.1 % (closing audit) |
| 20 % until caught, then 10 % | +6.3 % |
| 20 % until caught, then honest | +3.5 % |

No strategy beats a steady 20 %. The cooldown is not a free window, because its
income stays on the books until the clock has run a full time base.

## 7. Required changes outside the formulas (written into #1409)

1. **Smuggling income becomes a chosen share.** Income per tick = k × trailing
   operating income per hour (`OperatingFinance`,
   `OPERATING_INCOME_WINDOW_TICKS`, #1375), with k set by a volume control
   (for example k = 0.1 / 0.25 / 0.5 / 1, which is a 9 / 20 / 33 / 50 % share).
   No risk figures are shown. A mine that does no mining earns $0 from
   smuggling, which removes #1409's repro by construction. The levels' contract
   income is unknown and lumpy, so this keeps the share the player's own lever.
2. **Smuggling stops adding `SMUGGLING_EXPOSURE_PER_TICK`.** The audit replaces it
   as smuggling's risk channel; otherwise arrest at tick 45 overrides everything.
   Every other exposure and arrest rule (accidents, framings) is unchanged.
   A conviction adds no exposure, so an audit can never by itself end a run.
3. **Never bankrupt from one regularisation.** Take what is available above
   `BANKRUPTCY_THRESHOLD` immediately and collect the rest from future income
   (for example over 30 days). The EV is unchanged.

**Size of one hit.** The open books can span at most about 135 days of wall time:
a 30-day cooldown, a 30-day ramp, then 75 more days. The worst case at 20 % with
two prior convictions is 135 × 0.25 × 1.6 ≈ 54 days of legit income. That is a
net loss of about 20 days against not having smuggled in that window: it stings
but does not end the game. At 50 % the same worst case is about 265 days (net
−130), the zone the curve exists to discourage. A shorter time base shrinks every
hit proportionally and leaves G\* unchanged.

## 8. Sensitivity: tweak one input (1-year level, with recidivism)

| Variant | valid | ρ(20 %) | ρ(50 %) | argmax | G(20 %) | G(50 %) |
|---|---|---|---|---|---|---|
| defaults | yes | 1.20 | 1.56 | 20 % | +7.8 % | −47.4 % |
| P₂₀ = 0.40 | yes | 1.50 | 1.56 | 20 % | +8.5 % | −47.4 % |
| E₅₀ = −0.50 | yes | 1.20 | 1.88 | 20 % | +7.8 % | −72.4 % |
| B = 180 days | yes | 1.20 | 1.56 | 20 % | +8.5 % | −42.0 % |
| E₂₀ = +0.05 | recidivism check fails (conservative) | 1.60 | 1.56 | 20 % | +2.8 % | −47.4 % |
| P₂₀ = 0.60 | ρ = 1 boundary | 1.00 | 1.56 | 20 % | +6.8 % | −47.4 % |

Changing the time base B moves only the frequency and size of audits. The clean
curve G\* does not depend on B.

## 9. What the implementation should pin

- **Pure-function test.** Port `P_of`, `G_target`, `rho_of` and `validate`. Assert
  that defaults validate; that S(s)·(1 − ρ(s)P(s)) equals G\*(s) on a grid; that
  the argmax is 0.20, G(0) = 0, G(0.2) = E₂₀ and G(0.5) = E₅₀; and that ρ ≥ 1.
- **Seeded multi-run simulation** through the real tick code. With recidivism
  off, mean gain at 0 / 20 / 50 % is within a tolerance of G\*, and the ordering
  20 % > 0 % > 50 % holds with recidivism on. 0 % never pays.
- **Scenario.** Smuggling-only on Dusty Hollow earns $0 and cannot complete the
  level. Steady (20 %) alongside mining ends ahead of mining alone on average.

## 10. Design history (why earlier drafts were replaced)

- **"Regularise everything since the previous audit"** with no limit catches every
  dollar eventually, so G = S·(1 − ρ) is monotone in s and no sweet spot exists.
  The time-base look-back fixes this: a dollar is caught with probability P(s)
  exactly.
- **Weekly checks** made being caught at least once per level near-certain at any
  share of 10 % or more. Defining the chances over a 3-month base puts the coin
  flip at the scale the player actually experiences.
- **A wall-clock look-back with a cooldown or ramp** dilutes risk and invites
  cooldown bursts: a ramp starting at ×0.5 let a burst beat steady play by 15 to
  161 %. Running the look-back on the audit clock makes both EV-neutral.
- **A constant ρ** cannot hit two gain targets. ρ(s) derived from G\* hits both
  and pins the peak.
