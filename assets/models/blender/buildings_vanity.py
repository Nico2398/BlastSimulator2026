"""Vanity-project building models (#1948): the board's trophies, single tier, no crew.

Same axes as buildings.py: centred on the footprint, ground z = 0, front (+Y). Scene root holds
only `Body`; the type colour (`TintBody`) covers the marble, lawn, pad and cladding.

* ceo_statue         2x2  Golden CEO in a hard hat, belly out, one arm flung at the pit, on a marble
                          plinth with a gold plaque.
* golf_course        6x6  Lurid lawn with a flag, a sand bunker and a sad tilted golf cart, sitting on
                          a slab of grey rubble ringed with boulders.
* executive_helipad  4x4  Raised pad with a painted H, glowing edge lights, a windsock and a red carpet
                          ramp that runs off the pad and stops in the dirt.
* gold_tower         4x4  A narrow, too-tall tower in gold cladding, one glowing penthouse window and a
                          giant rooftop coin. Taller than the other three on purpose.

Builder signature mirrors buildings.py: (sx, sz, tier, ex, xx, m). The footprint comes from
building-defs.json (BuildingDefs), so sx/sz are the cell sizes; parts are sized from them.
"""
from __future__ import annotations

import math
import random

from common import (
    array, assign, bevel, box, capsule, cylinder, icosphere, pivot, prism, rotate, sphere, torus,
)

TOWER_SHAFT_H = 6.4        # wall height above the podium
TOWER_SHAFT_W = 1.7        # narrow on purpose: a 4x4 footprint holds a 1.7 m shaft
GOLF_SLAB_H = 0.4          # rubble slab under the lawn
GOLF_LAWN_H = 0.2
HELIPAD_H = 0.5


def _put(parts, ob, mat, bev=None):
    """Colour a part, optionally round it, and collect it under Body."""
    if bev:
        bevel(ob, *bev)
    assign(ob, mat)
    parts.append(ob)
    return ob


def _blob(radius: float, wobble: float, seed: int, n: int = 16):
    """A lumpy closed outline: n points, radius jittered by a seeded wobble."""
    rng = random.Random(seed)
    return [(math.cos(2 * math.pi * i / n) * radius * (1 + rng.uniform(-wobble, wobble)),
             math.sin(2 * math.pi * i / n) * radius * (1 + rng.uniform(-wobble, wobble))) for i in range(n)]


def build_ceo_statue(sx, sz, tier, ex, xx, m):
    parts = []
    w = min(sx, sz) * 0.75                      # plinth width
    _put(parts, box('PlinthStep', (w + 0.3, w + 0.3, 0.18), loc=(0, 0, 0.09)), m['plinth'], (0.04, 2))
    h = 0.85
    _put(parts, box('PlinthMarble', (w, w, h), loc=(0, 0, 0.18 + h / 2)), m['body'], (0.06, 3))
    _put(parts, box('PlinthCap', (w + 0.12, w + 0.12, 0.1), loc=(0, 0, 0.18 + h + 0.05)), m['body'], (0.03, 2))
    _put(parts, box('PlaqueBack', (0.7, 0.06, 0.34), loc=(0, w / 2 + 0.02, 0.18 + h * 0.5)), m['dark'], (0.02, 2))
    _put(parts, box('Plaque', (0.58, 0.04, 0.22), loc=(0, w / 2 + 0.05, 0.18 + h * 0.5)), m['gold'], (0.01, 2))
    z0 = 0.18 + h + 0.1
    # Figure: short legs, huge belly, small head. Everything gold.
    for side, dx in (('L', -0.14), ('R', 0.14)):
        _put(parts, capsule(f'Leg{side}', 0.11, 0.4, loc=(dx, 0, z0 + 0.32), segments=12, rings=6), m['gold'])
    _put(parts, sphere('Belly', 0.4, loc=(0, 0, z0 + 0.95), scale=(1, 0.9, 1.15), segments=20, rings=10), m['gold'])
    _put(parts, box('Suit', (0.62, 0.36, 0.5), loc=(0, 0, z0 + 1.2)), m['gold'], (0.15, 3))
    _put(parts, sphere('Head', 0.22, loc=(0, 0, z0 + 1.72), segments=18, rings=10), m['gold'])
    _put(parts, sphere('HatDome', 0.25, loc=(0, 0, z0 + 1.86), scale=(1, 1, 0.75), segments=18, rings=8), m['stripe_y'])
    _put(parts, cylinder('HatBrim', 0.32, 0.05, loc=(0, 0, z0 + 1.78), segments=20), m['stripe_y'], (0.015, 2))
    _put(parts, box('Nose', (0.08, 0.1, 0.08), loc=(0, 0.2, z0 + 1.7)), m['gold'])
    # Pointing arm (+X, up a little) and a fist on the hip.
    ax = (math.sin(math.radians(75)), 0, math.cos(math.radians(75)))
    c = (0.34 + ax[0] * 0.38, 0, z0 + 1.35 + ax[2] * 0.38)
    _put(parts, capsule('ArmPoint', 0.09, 0.55, loc=c, rot=(0, 75, 0), segments=12, rings=6), m['gold'])
    _put(parts, capsule('Finger', 0.04, 0.2, loc=(c[0] + ax[0] * 0.45, 0, c[2] + ax[2] * 0.45), rot=(0, 75, 0),
                        segments=8, rings=4), m['gold'])
    _put(parts, capsule('ArmHip', 0.09, 0.4, loc=(-0.42, 0, z0 + 1.0), rot=(0, -25, 0), segments=12, rings=6), m['gold'])
    pivot('Body', (0, 0, 0), parts)


def build_golf_course(sx, sz, tier, ex, xx, m):
    parts = []
    s = min(sx, sz) - 0.1
    _put(parts, box('RubbleSlab', (s, s, GOLF_SLAB_H), loc=(0, 0, GOLF_SLAB_H / 2)), m['rubble'], (0.2, 3))
    rng = random.Random(1948)
    for i in range(14):                         # boulders lining the slab edge
        t = 2 * math.pi * i / 14 + rng.uniform(-0.1, 0.1)
        r = s / 2 * rng.uniform(0.9, 1.0)
        x, y = max(-r, min(r, math.cos(t) * s)), max(-r, min(r, math.sin(t) * s))
        rock = icosphere(f'Boulder{i}', rng.uniform(0.28, 0.45), loc=(x, y, GOLF_SLAB_H + 0.05), subdivisions=1,
                         scale=(1, 1, 0.65))
        _put(parts, rock, m['rubble2'] if i % 2 else m['rock'])
    lawn_z = GOLF_SLAB_H
    _put(parts, prism('Lawn', _blob(s * 0.38, 0.1, 7), GOLF_LAWN_H, loc=(0, 0, lawn_z + GOLF_LAWN_H / 2), axis='Z'),
         m['body'], (0.05, 2))
    top = lawn_z + GOLF_LAWN_H
    _put(parts, prism('PuttingGreen', _blob(0.95, 0.06, 3), 0.04, loc=(0.9, 0.7, top + 0.02), axis='Z'), m['green'])
    _put(parts, prism('BunkerRim', _blob(0.8, 0.08, 5), 0.06, loc=(-0.9, -0.5, top + 0.03), axis='Z'), m['stripe_k'])
    _put(parts, prism('Sand', _blob(0.7, 0.08, 6), 0.08, loc=(-0.9, -0.5, top + 0.04), axis='Z'), m['sand'])
    _put(parts, cylinder('Hole', 0.1, 0.02, loc=(0.9, 0.7, top + 0.05), segments=10), m['dark'])
    _put(parts, cylinder('FlagPole', 0.03, 1.3, loc=(0.9, 0.7, top + 0.65), segments=8), m['white'])
    _put(parts, prism('Flag', [(0, 0), (0.55, 0.14), (0, 0.28)], 0.03, loc=(0.9, 0.7, top + 1.0), axis='Y'), m['red'])
    # The sad golf cart: tilted on a flat tyre, one wheel gone, roof sagging.
    cx, cy, rz = -1.9, 2.0, 25.0
    cart = []
    cz = GOLF_SLAB_H
    cart.append(box('CartBody', (1.0, 0.55, 0.28), loc=(0, 0, cz + 0.32)))
    assign(cart[-1], m['white']); bevel(cart[-1], 0.05, 2)
    cart.append(box('CartSeat', (0.4, 0.45, 0.3), loc=(-0.15, 0, cz + 0.6)))
    assign(cart[-1], m['dark']); bevel(cart[-1], 0.04, 2)
    for i, (px, py) in enumerate(((-0.4, -0.3), (0.4, -0.3), (0.4, 0.3))):
        wheel = cylinder(f'CartWheel{i}', 0.17 if i != 1 else 0.11, 0.1, loc=(px, py, cz + (0.17 if i != 1 else 0.11)),
                         axis='Y', segments=12)
        assign(wheel, m['stripe_k']); cart.append(wheel)
    for i, (px, py) in enumerate(((-0.45, -0.25), (-0.45, 0.25), (0.15, -0.25), (0.15, 0.25))):
        post = cylinder(f'CartPost{i}', 0.025, 0.55, loc=(px, py, cz + 0.8), segments=6)
        assign(post, m['steel']); cart.append(post)
    roof = box('CartRoof', (0.75, 0.6, 0.05), loc=(-0.15, 0, cz + 1.1), rot=(8, 0, 0))
    assign(roof, m['red']); cart.append(roof)
    for ob in cart:                             # tilt/place the whole cart as one group
        ob.location.x, ob.location.y = _rot(ob.location.x, ob.location.y, rz, cx, cy)
        ob.rotation_euler.z += math.radians(rz)
    parts += cart
    pivot('Body', (0, 0, 0), parts)


def _rot(x, y, deg, ox, oy):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return x * c - y * s + ox, x * s + y * c + oy


def build_executive_helipad(sx, sz, tier, ex, xx, m):
    parts = []
    s = min(sx, sz) - 0.2
    _put(parts, box('PadBase', (s, s, HELIPAD_H), loc=(0, 0, HELIPAD_H / 2)), m['body'], (0.12, 3))
    top = HELIPAD_H
    _put(parts, cylinder('PadRing', s * 0.43, 0.04, loc=(0, 0, top + 0.02), segments=28), m['white'])
    _put(parts, cylinder('PadDisc', s * 0.37, 0.05, loc=(0, 0, top + 0.03), segments=28), m['dark'])
    for name, size, loc in (('HBarL', (0.22, 1.2, 0.05), (-0.45, 0, 0)), ('HBarR', (0.22, 1.2, 0.05), (0.45, 0, 0)),
                            ('HBarMid', (1.1, 0.22, 0.05), (0, 0, 0))):
        _put(parts, box(name, size, loc=(loc[0], loc[1], top + 0.07)), m['white'])
    lights = []
    for i, (lx, ly) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1), (0, 1), (0, -1), (1, 0), (-1, 0))):
        lights.append(_put(parts, sphere(f'EdgeLight{i}', 0.09, loc=(lx * (s / 2 - 0.12), ly * (s / 2 - 0.12), top + 0.07),
                                         segments=8, rings=4), m['lamp']))
    # Windsock on a pole in the back corner.
    px, py = -s / 2 + 0.25, -s / 2 + 0.25
    _put(parts, cylinder('WindPole', 0.035, 1.5, loc=(px, py, top + 0.75), segments=8), m['steel'])
    _put(parts, cylinder('Sock', 0.17, 0.7, loc=(px + 0.4, py, top + 1.4), axis='X', segments=12, radius2=0.07), m['cone'])
    _put(parts, torus('SockRing', 0.14, 0.03, loc=(px + 0.07, py, top + 1.4), rot=(0, 90, 0), major_segments=12,
                      minor_segments=6), m['white'])
    # Red carpet ramps down the front edge and stops in the dirt.
    half = s / 2
    ramp = [(half - 0.1, top + 0.01), (half + 1.0, 0.07), (half + 1.0, 0.0), (half - 0.1, top - 0.05)]
    _put(parts, prism('CarpetRamp', ramp, 0.9, loc=(0, 0, 0), axis='X'), m['carpet'])
    for side, dx in (('L', -0.55), ('R', 0.55)):
        _put(parts, cylinder(f'Stanchion{side}', 0.05, 0.6, loc=(dx, half + 1.0, 0.3), segments=8), m['gold'])
        _put(parts, sphere(f'StanchionKnob{side}', 0.08, loc=(dx, half + 1.0, 0.62), segments=8, rings=4), m['gold'])
    pivot('Body', (0, 0, 0), parts)


def build_gold_tower(sx, sz, tier, ex, xx, m):
    parts = []
    pod = min(sx, sz) - 0.6
    _put(parts, box('Podium', (pod, pod, 0.4), loc=(0, 0, 0.2)), m['plinth'], (0.06, 3))
    w, h = TOWER_SHAFT_W, TOWER_SHAFT_H
    _put(parts, box('Shaft', (w, w, h), loc=(0, 0, 0.4 + h / 2)), m['body'], (0.07, 3))
    for side, y in (('Front', w / 2 + 0.02), ('Back', -w / 2 - 0.02)):   # ribbon windows
        strip = box(f'Ribbon{side}', (1.2, 0.06, 0.22), loc=(0, y, 1.0))
        assign(strip, m['glass'])
        array(strip, 6, (0, 0, 0.9))
        parts.append(strip)
    ribs = box('Rib', (w + 0.16, w + 0.16, 0.1), loc=(0, 0, 1.3))
    assign(ribs, m['gold']); array(ribs, 7, (0, 0, 0.9)); parts.append(ribs)
    top = 0.4 + h
    _put(parts, box('PenthouseSlab', (w + 0.3, w + 0.3, 0.12), loc=(0, 0, top + 0.06)), m['gold'], (0.03, 2))
    pz = top + 0.12
    _put(parts, box('Penthouse', (1.2, 1.2, 0.85), loc=(0, 0, pz + 0.425)), m['body'], (0.06, 3))
    _put(parts, box('PenthouseWindow', (0.5, 0.05, 0.4), loc=(0, -0.6, pz + 0.43)), m['lamp'])
    _put(parts, box('PenthouseWindowFrame', (0.62, 0.04, 0.52), loc=(0, -0.6, pz + 0.43)), m['dark'])
    _put(parts, box('PenthouseRoof', (1.4, 1.4, 0.08), loc=(0, 0, pz + 0.89)), m['gold'], (0.02, 2))
    # Rooftop logo: a coin on two stilts with a dollar bar.
    rz = pz + 0.93
    for sd, dx in (('L', -0.3), ('R', 0.3)):
        _put(parts, cylinder(f'LogoLeg{sd}', 0.04, 0.5, loc=(dx, 0, rz + 0.25), segments=6), m['steel'])
    _put(parts, cylinder('LogoCoin', 0.55, 0.14, loc=(0, 0, rz + 0.95), axis='Y', segments=24), m['gold'], (0.02, 2))
    _put(parts, torus('LogoRim', 0.46, 0.04, loc=(0, 0, rz + 0.95), rot=(90, 0, 0), major_segments=24, minor_segments=6),
         m['stripe_y'])
    _put(parts, box('LogoBar', (0.1, 0.18, 0.7), loc=(0, 0, rz + 0.95)), m['dark'], (0.02, 2))
    _put(parts, box('LogoSlashA', (0.4, 0.18, 0.1), loc=(0, 0, rz + 1.12)), m['dark'])
    _put(parts, box('LogoSlashB', (0.4, 0.18, 0.1), loc=(0, 0, rz + 0.78)), m['dark'])
    pivot('Body', (0, 0, 0), parts)
