#!/usr/bin/env python3
"""Issue #1409 — tax-audit balance model for mafia smuggling.

Reproduces every number in docs/plans/issue-1409-smuggling-balance.md.
Pure standard library, deterministic (seeded), about 2 minutes. Run:

    python3 docs/plans/issue-1409-smuggling-model.py

Units: one step = one game day (24 ticks). Legit (contract + sales) income is
normalised to C = 1 per day, so every result reads as "fraction of the mine's
legit income". A smuggling share s means smuggling income S = s / (1 - s) per day.

The six designer inputs (time base, three audit chances, two expected gains)
determine every derived constant; nothing else is tuned.
"""
from collections import deque
import math
import random
import statistics as st

# ── Designer inputs (the tweakable balance variables) ──────────────────────
INPUTS = dict(
    base_days=90,   # time base B: audit chances below are "within one B"
    P0=0.20,        # chance of an audit within B at   0 % smuggling share
    P20=0.50,       # chance of an audit within B at  20 % smuggling share
    P50=0.80,       # chance of an audit within B at >=50 % smuggling share
    E20=+0.10,      # expected gain at 20 % share, as a fraction of legit income
    E50=-0.25,      # expected gain at 50 % share, as a fraction of legit income
)
# ── Secondary knobs (EV-neutral by construction, or a deliberate extra) ────
KNOBS = dict(
    cooldown_days=30,  # no audit at all for this long after any audit
    ramp_days=30,      # then the audit clock speeds back up linearly from 0 to 1
    delta=0.20,        # recidivism surcharge on rho per prior conviction this level
    kcap=2,            # surcharge stops growing after 2 prior convictions (+0.40)
)
S1, S2 = 0.20, 0.50  # anchor shares (the sweet spot and the max-risk share)


# ── Closed-form layer ──────────────────────────────────────────────────────
def S_of(s):
    return s / (1 - s)


def P_of(s, I=INPUTS):
    """Audit chance within one time base, piecewise linear through the 3 anchors."""
    if s <= S1:
        return I['P0'] + (I['P20'] - I['P0']) * s / S1
    if s <= S2:
        return I['P20'] + (I['P50'] - I['P20']) * (s - S1) / (S2 - S1)
    return I['P50']


def G_target(s, I=INPUTS):
    """Target expected gain (fraction of legit income): 0 -> E20 -> E50, then S*E50."""
    if s <= 0:
        return 0.0
    if s <= S1:
        return I['E20'] * s / S1
    if s <= S2:
        return I['E20'] + (I['E50'] - I['E20']) * (s - S1) / (S2 - S1)
    return S_of(s) * I['E50'] / S_of(S2)


def rho_of(s, I=INPUTS):
    """Regularisation multiplier (clean record) for a reviewed share s.

    Each smuggled dollar is caught with probability exactly P(s), so
    G(s) = S(s) * (1 - rho(s) P(s)); solve for rho.
    """
    s = max(s, 1e-9)
    return (1 - G_target(s, I) / S_of(s)) / P_of(s, I)


def validate(I=INPUTS, K=KNOBS):
    """Return the list of violated constraints (empty = valid)."""
    bad = []
    if not 0 < I['P0'] <= I['P20'] <= I['P50'] < 1:
        bad.append('need 0 < P0 <= P20 <= P50 < 1')
    if not I['E50'] < 0 < I['E20']:
        bad.append('need E50 < 0 < E20')
    if I['E20'] / S1 > 1 - I['P0']:
        bad.append('need E20 <= s1 * (1 - P0)            (rho >= 1 at tiny shares)')
    if I['E20'] * (1 - S1) / S1 > 1 - I['P20']:
        bad.append('need E20 <= s1 / (1 - s1) * (1 - P20) (rho >= 1 at the sweet spot)')
    if min(rho_of(i / 1000, I) for i in range(1, 1000)) < 1 - 1e-9:
        bad.append('rho dips below 1 somewhere in (0, 1)')
    # Recidivism must not out-slope the rising side of G at s1, or the peak slides left.
    slope = I['E20'] / S1
    dPS = (I['P20'] - I['P0']) / S1 * S_of(S1) + I['P20'] / (1 - S1) ** 2
    recid = K['delta'] * K['kcap'] * dPS
    if recid >= slope:
        bad.append(f'recidivism may move the peak: delta*kcap*d(PS)/ds = {recid:.3f} >= E20/s1 = {slope:.3f}')
    return bad


# ── Simulation layer (day steps) ───────────────────────────────────────────
def clock_speed(since, K=KNOBS):
    """Audit-clock speed m: 0 in cooldown, linear ramp back to 1, then 1."""
    if since is None or since >= K['cooldown_days'] + K['ramp_days']:
        return 1.0
    if since < K['cooldown_days']:
        return 0.0
    return (since - K['cooldown_days'] + 1) / (K['ramp_days'] + 1)


def run_level(policy, days, rng, I=INPUTS, K=KNOBS, recidivism=True):
    """One level. policy(day, days, since, convictions) -> share.

    Open books = daily buckets whose audit-clock age is below the time base.
    The clock X advances at speed m, so cooldown and ramp never shorten how
    much audit exposure a dollar faces: they only delay it.
    Returns (net gain / legit income, convictions, audits).
    """
    B = I['base_days']
    X = 0.0
    books = deque()  # (X at earning, S, C)
    oS = oC = 0.0
    since = None
    conv = audits = 0
    net = legit = 0.0

    def surcharge():
        return K['delta'] * min(conv, K['kcap']) if recidivism else 0.0

    for d in range(days):
        s = policy(d, days, since, conv)
        S = S_of(s) if s > 0 else 0.0
        books.append((X, S, 1.0))
        oS += S
        oC += 1.0
        net += S
        legit += 1.0
        m = clock_speed(since, K)
        X += m
        while books and X - books[0][0] >= B:
            _, s_, c_ = books.popleft()
            oS -= s_
            oC -= c_
        if m > 0 and oS + oC > 0:
            sh = oS / (oS + oC)
            if rng.random() < 1 - (1 - P_of(sh, I)) ** (m / B):
                audits += 1
                if oS > 1e-12:
                    net -= (rho_of(sh, I) + surcharge()) * oS
                    conv += 1
                books.clear()
                oS = oC = 0.0
                since = -1
        since = None if since is None else since + 1
    if oS > 1e-12:  # closing audit: sample how far back the next audit would reach
        sh = oS / (oS + oC)
        lam = -math.log(1 - P_of(sh, I)) / B
        T = -math.log(1 - rng.random()) / lam
        caught = sum(s_ for xe, s_, _ in books if B - (X - xe) > T)
        if caught > 0:
            net -= (rho_of(sh, I) + surcharge()) * caught
            conv += 1
            audits += 1
    return net / legit, conv, audits


def steady(s):
    return lambda d, D, since, c: s


def mc(policy, days, n, seed=1, **kw):
    rng = random.Random(seed)
    return [run_level(policy, days, rng, **kw) for _ in range(n)]


SHARES = (0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.75)


def report_closed_form():
    print('validate(defaults):', validate() or 'OK')
    print('share  P(audit in B)  rho(clean)  target G')
    for s in SHARES[1:]:
        print(f'{s:5.2f}   {P_of(s):.3f}        {rho_of(s):.3f}      {G_target(s):+.4f}')


def report_levels(n=3000):
    for days in (90, 180, 365, 730):
        print(f'\n--- {days}-day level, n={n}: mean (clean-record check) | with recidivism: '
              'mean, sd, p05, p95, P(<honest), P(never caught), E[audits]')
        best = None
        for s in SHARES:
            clean = st.mean(o[0] for o in mc(steady(s), days, n, recidivism=False))
            out = mc(steady(s), days, n)
            xs = sorted(o[0] for o in out)
            q = lambda f: xs[int(f * (len(xs) - 1))]
            m = st.mean(xs)
            if best is None or m > best[1]:
                best = (s, m)
            print(f'{s:4.2f}  clean {clean:+.3f} (target {G_target(s):+.3f}) | '
                  f'{m:+.3f} {st.pstdev(xs):.3f} {q(.05):+.3f} {q(.95):+.3f} '
                  f'{sum(x < 0 for x in xs) / len(xs):.2f} '
                  f'{sum(o[1] == 0 for o in out) / len(out):.2f} {st.mean(o[2] for o in out):.2f}')
        print('argmax share (with recidivism):', best[0])


def report_exploits(days=365, n=3000):
    cd, rp = KNOBS['cooldown_days'], KNOBS['ramp_days']
    in_cd = lambda since: since is not None and since < cd + rp
    pols = {
        'honest': steady(0.0),
        'steady 20 %': steady(0.2),
        'alternate months 0 % / 40 %': lambda d, D, sn, c: 0.4 if (d // 30) % 2 else 0.0,
        'alternate quarters 0 % / 40 %': lambda d, D, sn, c: 0.4 if (d // 90) % 2 else 0.0,
        '50 % in cooldown+ramp, else 20 %': lambda d, D, sn, c: 0.5 if in_cd(sn) else 0.2,
        'only smuggle in cooldown+ramp (50 %)': lambda d, D, sn, c: 0.5 if in_cd(sn) else 0.0,
        '20 %, last 30 days 75 %': lambda d, D, sn, c: 0.75 if d >= D - 30 else 0.2,
        'honest, last 14 days 75 %': lambda d, D, sn, c: 0.75 if d >= D - 14 else 0.0,
        '20 % until caught, then 10 %': lambda d, D, sn, c: 0.2 if c == 0 else 0.1,
        '20 % until caught, then honest': lambda d, D, sn, c: 0.2 if c == 0 else 0.0,
    }
    print(f'\n--- Exploit strategies, {days}-day level, n={n} (with recidivism)')
    for name, pol in pols.items():
        print(f'{name:40s} {st.mean(o[0] for o in mc(pol, days, n, seed=3)):+.4f}')


def report_sensitivity(n=1500, days=365):
    variants = {
        'defaults': {},
        'P20=0.40': dict(P20=0.40),
        'P20=0.60': dict(P20=0.60),
        'E20=+0.05': dict(E20=0.05),
        'E50=-0.50': dict(E50=-0.50),
        'P0=0.10, P50=0.90': dict(P0=0.10, P50=0.90),
        'base 180 days': dict(base_days=180),
    }
    print(f'\n--- Sensitivity: tweak one input, {days}-day level, n={n} (with recidivism)')
    for name, ov in variants.items():
        I = dict(INPUTS, **ov)
        bad = validate(I)
        row = {s: st.mean(o[0] for o in mc(steady(s), days, n, I=I)) for s in (0.1, 0.15, 0.2, 0.25, 0.3, 0.5)}
        best = max(row, key=row.get)
        print(f'{name:20s} valid={not bad} {"; ".join(bad)}\n{"":20s} rho20={rho_of(0.2, I):.3f} rho50={rho_of(0.5, I):.3f} '
              f'argmax={best} ' + ' '.join(f'{s:.2f}:{v:+.3f}' for s, v in row.items()))


if __name__ == '__main__':
    report_closed_form()
    report_levels()
    report_exploits()
    report_sensitivity()
