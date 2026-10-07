#!/usr/bin/env python3
"""Issue #1409 — tax-audit balance model for mafia smuggling.

Reproduces every number in docs/plans/issue-1409-smuggling-balance.md.
Pure standard library, deterministic (seeded). Run:

    python3 docs/plans/issue-1409-smuggling-model.py

Units: one step = one audit-check period (1 game week = 168 ticks).
Legit (contract + sales) income is normalised to C = 1 per week, so every
result reads as "fraction of the mine's legit income". A smuggling share s
means smuggling income S = s / (1 - s) per week.
"""
from collections import defaultdict
import itertools
import random
import statistics as st

# ── Recommended constants ──────────────────────────────────────────────────
CFG = dict(
    p0=0.10,     # audit probability per eligible check at 0 % smuggling
    pmax=0.80,   # audit probability cap
    s_cap=0.50,  # share at which pmax is reached (linear in between)
    Kc=2,        # cooldown: weeks after any audit with no check at all
    Km=2,        # mitigation: eligible checks ramping back to full strength
    m1=0.75,     # ramp multiplier at the first eligible check (then linear to 1)
    rho=1.60,    # regularisation multiplier, first offence (back taxes + penalty)
    delta=0.25,  # recidivism surcharge per prior conviction this level
    kmax=3,      # surcharge stops growing at the 3rd conviction (rho <= 2.10)
)


def p_of(s, cfg=CFG):
    return cfg['p0'] + (cfg['pmax'] - cfg['p0']) * min(1.0, s / cfg['s_cap'])


def ramp(j, cfg=CFG):
    """Multiplier at the j-th eligible check after a cooldown (j = 99: no audit yet)."""
    if j > cfg['Km']:
        return 1.0
    return cfg['m1'] + (1 - cfg['m1']) * (j - 1) / cfg['Km']


def rho_k(convictions, cfg=CFG):
    return cfg['rho'] + cfg['delta'] * min(convictions, cfg['kmax'] - 1)


def S_of(s):
    return s / (1 - s)


# ── 1. Closed form (single-draw model) ─────────────────────────────────────
def closed_form_rho(target_share, p0, pmax, s_cap=0.5):
    """rho that puts argmax of G(s) = s/(1-s) * (1 - rho p(s)) at target_share."""
    c = target_share * (2 - target_share)
    return 1.0 / (p0 + c * (pmax - p0) / s_cap)


def G_single(s, rho, p0, pmax, s_cap=0.5):
    p = p0 + (pmax - p0) * min(1.0, s / s_cap)
    return S_of(s) * (1 - rho * p)


# ── 2. Exact expected value over a level (forward Markov chain) ────────────
def exact_level(s, weeks, cfg=CFG):
    """Expected net smuggling gain / total legit income, constant share s.

    State: (weeks since last audit or None, convictions, weeks of open books).
    Books close at every eligible check (audit or not); they stay open through
    the cooldown. A closing audit runs on the open books at level end.
    """
    S = S_of(s)
    dist = {(None, 0, 0): 1.0}
    E = 0.0
    cap = cfg['Kc'] + cfg['Km'] + 1
    for _ in range(weeks):
        nd = defaultdict(float)
        for (since, conv, o), pr in dist.items():
            E += pr * S
            o2 = o + 1
            sn = None if since is None else since + 1
            if sn is not None and sn <= cfg['Kc']:
                nd[(sn, conv, o2)] += pr
                continue
            j = 99 if sn is None else sn - cfg['Kc']
            h = ramp(j, cfg) * p_of(S / (S + 1), cfg)
            if S > 0:
                E -= pr * h * rho_k(conv, cfg) * S * o2
            nd[(0, min(conv + (1 if S > 0 else 0), cfg['kmax'] - 1), 0)] += pr * h
            nd[(None if sn is None else min(sn, cap), conv, 0)] += pr * (1 - h)
        dist = nd
    for (since, conv, o), pr in dist.items():
        if o > 0 and S > 0:
            E -= pr * p_of(S / (S + 1), cfg) * rho_k(conv, cfg) * S * o
    return E / weeks


# ── 3. Monte Carlo over a level ────────────────────────────────────────────
def run_level(policy, weeks, rng, cfg=CFG, cv=0.0, flat_ratio=None):
    """policy(week, weeks, since, convictions) -> share. Returns (uplift, convictions, audits)."""
    since = None
    oS = oC = 0.0
    conv = audits = 0
    net = legit = 0.0
    for w in range(weeks):
        C = rng.gammavariate(1 / cv ** 2, cv ** 2) if cv > 0 else 1.0
        s = policy(w, weeks, since, conv)
        S = flat_ratio if flat_ratio is not None else (S_of(s) * C if s > 0 else 0.0)
        oS += S
        oC += C
        net += S
        legit += C
        since = None if since is None else since + 1
        if since is not None and since <= cfg['Kc']:
            continue  # cooldown: no check, books stay open
        j = 99 if since is None else since - cfg['Kc']
        if rng.random() < ramp(j, cfg) * p_of(oS / (oS + oC), cfg):
            audits += 1
            if oS > 0:
                net -= rho_k(conv, cfg) * oS
                conv += 1
            since = 0
        oS = oC = 0.0  # eligible check: books close either way
    if oS > 0 and rng.random() < p_of(oS / (oS + oC), cfg):  # closing audit
        net -= rho_k(conv, cfg) * oS
        conv += 1
        audits += 1
    return net / legit, conv, audits


def mc_table(weeks, n=20000, seed=11, cv=0.0, flat=False):
    print(f'\n--- Monte Carlo, {weeks}-week level, income cv={cv}, '
          f'{"flat" if flat else "proportional"} smuggling, n={n}')
    print('share   mean    sd     p05     p50     p95   P(<honest) E[conv] P(never caught)')
    best = None
    for s in (0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50):
        rng = random.Random(seed)
        out = [run_level(lambda *a, s=s: s, weeks, rng, cv=cv,
                         flat_ratio=(S_of(s) if flat and s > 0 else None)) for _ in range(n)]
        xs = sorted(o[0] for o in out)
        q = lambda f: xs[int(f * (n - 1))]
        m = st.mean(xs)
        if best is None or m > best[1]:
            best = (s, m)
        print(f'{s:4.2f} {m:+.3f} {st.pstdev(xs):.3f} {q(.05):+.3f} {q(.5):+.3f} {q(.95):+.3f}'
              f'   {sum(x < 0 for x in xs) / n:.2f}     {st.mean(o[1] for o in out):.2f}'
              f'     {sum(o[1] == 0 for o in out) / n:.2f}')
    print('argmax share:', best[0])


# ── 4. Exploit strategies ──────────────────────────────────────────────────
def exploit_suite(weeks=12, n=20000, seed=3, cfg=CFG):
    cool = lambda sn: sn is not None and sn <= cfg['Kc']
    rmp = lambda sn: sn is not None and cfg['Kc'] < sn <= cfg['Kc'] + cfg['Km']
    pols = {
        'honest': lambda w, W, sn, c: 0.0,
        'steady 20%': lambda w, W, sn, c: 0.2,
        'burst 50% in cooldown, else 20%': lambda w, W, sn, c: 0.5 if cool(sn) else 0.2,
        'burst 75% in cooldown+ramp, else 20%': lambda w, W, sn, c: 0.75 if cool(sn) or rmp(sn) else 0.2,
        'only smuggle in cooldown (50%)': lambda w, W, sn, c: 0.5 if cool(sn) else 0.0,
        '20% until caught, then honest': lambda w, W, sn, c: 0.2 if c == 0 else 0.0,
        '20%, then 10% once caught': lambda w, W, sn, c: 0.2 if c == 0 else 0.1,
        'honest, last week 75%': lambda w, W, sn, c: 0.75 if w == W - 1 else 0.0,
        '20%, last week 75%': lambda w, W, sn, c: 0.75 if w == W - 1 else 0.2,
    }
    print(f'\n--- Exploit strategies, {weeks}-week level, n={n}')
    for name, pol in pols.items():
        rng = random.Random(seed)
        print(f'{name:40s} {st.mean(run_level(pol, weeks, rng, cfg)[0] for _ in range(n)):+.4f}')
    best = None
    grid = [0, 0.1, 0.2, 0.3, 0.5]
    for sc, sr, sn_ in itertools.product(grid, grid, [0.1, 0.15, 0.2, 0.25, 0.3]):
        pol = lambda w, W, s_, c, sc=sc, sr=sr, sn_=sn_: sc if cool(s_) else (sr if rmp(s_) else sn_)
        rng = random.Random(seed)
        g = st.mean(run_level(pol, weeks, rng, cfg)[0] for _ in range(4000))
        if best is None or g > best[0]:
            best = (g, (sc, sr, sn_))
    print(f'best phase-dependent policy (cooldown, ramp, normal) = {best[1]} -> {best[0]:+.4f}')


if __name__ == '__main__':
    print('Closed-form rho for s* = 0.20:',
          {p0: round(closed_form_rho(0.2, p0, 0.8), 3) for p0 in (0.05, 0.10)})
    r = closed_form_rho(0.2, 0.10, 0.8)
    print('Single-draw G(s), p0=0.10:',
          {s: round(G_single(s, r, 0.10, 0.8), 4) for s in (0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5)})
    for wk in (6, 12, 20, 30):
        print(f'Exact level EV, {wk:2d} weeks:',
              {s: round(exact_level(s, wk), 4) for s in (0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5)})
    mc_table(12)
    mc_table(12, cv=1.0)
    mc_table(12, cv=1.0, flat=True)
    exploit_suite()
