"""Decorative props — trees per biome, bushes, rocks and village houses.

Everything here is drawn instanced, hundreds of copies per level, so each
model stays under ~1.5k triangles and carries one node (`Body`). Trees and
bushes are bent by the wind shader by height, so they stand with their
base at z = 0 and grow up. Rocks use the `TintRock` material so the game
can colour them per biome. Houses are unit-sized (1 × 1 footprint, walls
1 high) and stretched to each village house's w × h × d; the chimney sits
at (+0.25 w, +0.25 d) in the game's x/z frame (Blender +X, −Y), where
ChimneySmoke lights its puffs.
"""
from __future__ import annotations

import math
import random

import bpy
from mathutils import Vector

from common import (
    assign, bend, bevel, box, capsule, cylinder, displace, icosphere, material, pivot, rotate, sphere,
    subsurf, torus,
)

TREE_FAMILIES = ['deciduous', 'conifer', 'tropical', 'desert', 'volcanic']
TREE_VARIANTS = 3
BUSH_VARIANTS = 2
ROCK_VARIANTS = 3
HOUSE_VARIANTS = 3


def _materials() -> dict[str, bpy.types.Material]:
    return {
        'leaf_a': material('LeafA', 0x5FA83A, roughness=0.9),
        'leaf_b': material('LeafB', 0x4C9436, roughness=0.9),
        'leaf_c': material('LeafC', 0x7DBE4B, roughness=0.9),
        'trunk': material('Trunk', 0x6B4A2E, roughness=0.95),
        'pine': material('Pine', 0x2F6B3A, roughness=0.9),
        'pine_light': material('PineLight', 0x3E8448, roughness=0.9),
        'snow': material('Snow', 0xF2F6F8, roughness=0.8),
        'frond': material('Frond', 0x4FA34B, roughness=0.9),
        'frond_dark': material('FrondDark', 0x3D8A3F, roughness=0.9),
        'palm': material('PalmTrunk', 0x8C6A48, roughness=0.95),
        'coconut': material('Coconut', 0x6B4A2E, roughness=0.9),
        'cactus': material('Cactus', 0x5C9A4E, roughness=0.9),
        'cactus_dark': material('CactusDark', 0x4A7F40, roughness=0.9),
        'flower': material('Flower', 0xFF6FA8, roughness=0.8),
        'deadwood': material('DeadWood', 0x9A8266, roughness=0.95),
        'agave': material('Agave', 0x7FA86E, roughness=0.9),
        'char': material('Char', 0x2B2622, roughness=0.95),
        'ash': material('AshLeaf', 0x6A6D68, roughness=0.9),
        'ember': material('Ember', 0xFF6A2A, roughness=0.6, emission=0xFF4A10, emission_strength=1.2),
        'rock': material('TintRock', 0x8E8A84, roughness=0.95),
        'wall': material('Wall', 0xF1E7D2, roughness=0.9),
        'wall_b': material('WallB', 0xE7D6B8, roughness=0.9),
        'roof_red': material('RoofRed', 0xB9432F, roughness=0.9),
        'roof_brown': material('RoofBrown', 0x7E4E31, roughness=0.9),
        'roof_grey': material('RoofGrey', 0x6B6F78, roughness=0.9),
        'door': material('Door', 0x5A3B24, roughness=0.9),
        'window': material('Window', 0x9FD8FF, roughness=0.2),
        'chimney': material('Chimney', 0x8A6E5C, roughness=0.9),
        'timber': material('Timber', 0x7A5236, roughness=0.9),
        'berry': material('Berry', 0xE2453C, roughness=0.7),
    }


# ---------------------------------------------------------------- trees ---

def _trunk(name: str, r_base: float, r_top: float, h: float, m, mat=None, loc=(0, 0, 0)) -> bpy.types.Object:
    t = cylinder(name, r_base, h, loc=(loc[0], loc[1], loc[2] + h / 2), radius2=r_top, segments=10)
    assign(t, mat or m['trunk'])
    return t


def _blob(name: str, r: float, loc, mat, scale=(1, 1, 1), seed: int = 0, lumps: float = 0.12) -> bpy.types.Object:
    """A lumpy canopy sphere: icosphere + displacement, smooth shaded."""
    b = icosphere(name, r, loc=loc, subdivisions=3, scale=scale)
    displace(b, strength=lumps, noise_scale=r * 1.4, seed=seed)
    assign(b, mat)
    return b


def tree_deciduous(v: int, m) -> list[bpy.types.Object]:
    parts = []
    if v == 0:
        # Classic lollipop: one big round crown.
        parts.append(_trunk('Trunk', 0.28, 0.2, 2.2, m))
        parts.append(_blob('Crown', 1.9, (0, 0, 3.6), m['leaf_a'], scale=(1.0, 1.0, 0.92), seed=1))
        parts.append(_blob('CrownTop', 1.1, (0.3, -0.2, 4.7), m['leaf_c'], seed=2))
    elif v == 1:
        # Tall: two stacked crowns on a longer trunk.
        parts.append(_trunk('Trunk', 0.26, 0.16, 3.0, m))
        parts.append(_blob('CrownLow', 1.6, (0.2, 0.1, 3.9), m['leaf_b'], scale=(1.1, 1.05, 0.9), seed=3))
        parts.append(_blob('CrownHigh', 1.3, (-0.2, -0.1, 5.5), m['leaf_a'], seed=4))
        branch = cylinder('Branch', 0.1, 1.2, loc=(0.5, 0.3, 3.1), radius2=0.05, segments=8)
        rotate(branch, x=-35, y=40)
        assign(branch, m['trunk'])
        parts.append(branch)
    else:
        # Wide: three lobes side by side on a short trunk.
        parts.append(_trunk('Trunk', 0.3, 0.22, 1.6, m))
        parts.append(_blob('CrownL', 1.4, (-1.1, 0.2, 2.9), m['leaf_b'], seed=5))
        parts.append(_blob('CrownR', 1.5, (1.0, -0.2, 3.0), m['leaf_a'], seed=6))
        parts.append(_blob('CrownMid', 1.3, (0, 0.1, 3.9), m['leaf_c'], seed=7))
    return parts


def tree_conifer(v: int, m) -> list[bpy.types.Object]:
    parts = []
    tiers = [3, 4, 3][v]
    height = [5.0, 6.5, 4.2][v]
    trunk_h = [1.2, 1.6, 1.0][v]
    parts.append(_trunk('Trunk', 0.24, 0.16, trunk_h + 0.5, m))
    base_r = [1.6, 1.8, 1.9][v]
    z = trunk_h
    tier_h = (height - trunk_h) / tiers * 1.35
    for i in range(tiers):
        r = base_r * (1.0 - i * 0.22)
        cone = cylinder(f'Tier{i}', r, tier_h, loc=(0, 0, z + tier_h / 2), radius2=0.08, segments=14)
        bevel(cone, 0.08, 2, angle=50)
        assign(cone, m['pine'] if i % 2 == 0 else m['pine_light'])
        parts.append(cone)
        z += tier_h * 0.62
    if v == 1:
        # Alpine snow cap on the top tier.
        cap = cylinder('SnowCap', base_r * (1.0 - (tiers - 1) * 0.22) * 0.7, tier_h * 0.45,
                       loc=(0, 0, z - tier_h * 0.62 + tier_h * 0.62), radius2=0.05, segments=14)
        cap.location.z = z - tier_h * 0.62 + tier_h * 0.75
        assign(cap, m['snow'])
        parts.append(cap)
    return parts


def tree_tropical(v: int, m) -> list[bpy.types.Object]:
    parts = []
    if v == 0:
        # Palm: bent trunk, radiating fronds, coconuts.
        trunk = cylinder('Trunk', 0.22, 5.0, loc=(0, 0, 2.5), radius2=0.15, segments=10)
        ring = torus('TrunkRing', 0.24, 0.03, loc=(0, 0, 0.6), major_segments=10, minor_segments=5)
        assign(ring, m['coconut'])
        parts.append(ring)
        bend(trunk, 28, axis='Y')
        assign(trunk, m['palm'])
        parts.append(trunk)
        top = Vector((1.15, 0, 4.85))  # roughly where the bend puts the tip
        for i in range(7):
            a = i * 360 / 7
            frond = box(f'Frond{i}', (2.6, 0.55, 0.08), loc=top + Vector((math.cos(math.radians(a)) * 1.2, math.sin(math.radians(a)) * 1.2, 0.1)))
            bevel(frond, 0.04, 2)
            rotate(frond, y=22, z=a)
            assign(frond, m['frond'] if i % 2 else m['frond_dark'])
            parts.append(frond)
        for i in range(3):
            a = math.radians(i * 120 + 30)
            nut = sphere(f'Coconut{i}', 0.17, loc=top + Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, -0.25)), segments=10, rings=6)
            assign(nut, m['coconut'])
            parts.append(nut)
    elif v == 1:
        # Broadleaf: huge bright crown, buttressed trunk.
        parts.append(_trunk('Trunk', 0.42, 0.24, 2.4, m))
        for i in range(3):
            a = math.radians(i * 120)
            root = box(f'Root{i}', (0.9, 0.16, 0.5), loc=(math.cos(a) * 0.5, math.sin(a) * 0.5, 0.25))
            rotate(root, z=math.degrees(a))
            assign(root, m['trunk'])
            parts.append(root)
        parts.append(_blob('Crown', 2.4, (0, 0, 4.0), m['leaf_c'], scale=(1.15, 1.15, 0.75), seed=8, lumps=0.18))
        parts.append(_blob('CrownTop', 1.4, (0.4, 0.3, 5.1), m['leaf_a'], seed=9))
    else:
        # Banana-like: fan of tall leaves from a short stem.
        stem = cylinder('Stem', 0.22, 1.2, loc=(0, 0, 0.6), radius2=0.16, segments=10)
        assign(stem, m['frond_dark'])
        parts.append(stem)
        for i in range(6):
            a = i * 60 + 15
            leaf = box(f'Leaf{i}', (0.5, 0.18, 2.6), loc=(math.cos(math.radians(a)) * 0.45, math.sin(math.radians(a)) * 0.45, 2.2))
            bevel(leaf, 0.06, 2)
            leaf.scale = (1.0, 1.0, 1.0)
            rotate(leaf, x=-math.sin(math.radians(a)) * 28, y=math.cos(math.radians(a)) * 28, z=a)
            assign(leaf, m['frond'] if i % 2 else m['leaf_c'])
            parts.append(leaf)
    return parts


def tree_desert(v: int, m) -> list[bpy.types.Object]:
    parts = []
    if v == 0:
        # Saguaro: ribbed body with two raised arms and a flower.
        body = capsule('Stem', 0.42, 3.2, loc=(0, 0, 2.0), segments=14, rings=8)
        assign(body, m['cactus'])
        parts.append(body)
        for side, z0, h in ((1, 1.6, 1.4), (-1, 2.3, 1.1)):
            elbow = capsule(f'Elbow{side}', 0.28, 0.5, loc=(side * 0.75, 0, z0), axis='X', segments=12, rings=6)
            assign(elbow, m['cactus_dark'])
            parts.append(elbow)
            arm = capsule(f'Arm{side}', 0.28, h, loc=(side * 1.0, 0, z0 + h / 2 + 0.2), segments=12, rings=6)
            assign(arm, m['cactus'])
            parts.append(arm)
        flower = sphere('Flower', 0.22, loc=(0, 0, 3.75), segments=10, rings=6)
        assign(flower, m['flower'])
        parts.append(flower)
        for i in range(5):
            a = math.radians(i * 72)
            rib = box(f'Rib{i}', (0.06, 0.06, 3.0), loc=(math.cos(a) * 0.42, math.sin(a) * 0.42, 2.0))
            assign(rib, m['cactus_dark'])
            parts.append(rib)
    elif v == 1:
        # Dead tree: bleached trunk with forked bare branches.
        trunk = cylinder('Trunk', 0.3, 3.4, loc=(0, 0, 1.7), radius2=0.12, segments=9)
        assign(trunk, m['deadwood'])
        parts.append(trunk)
        for i, (ax, ay, z, length) in enumerate(((35, 10, 2.2, 1.8), (-30, -25, 2.8, 1.5), (10, 40, 3.2, 1.2), (-45, 20, 1.6, 1.0))):
            br = cylinder(f'Branch{i}', 0.11, length, loc=(0, 0, z), radius2=0.04, segments=7)
            br.location = (math.sin(math.radians(ay)) * length / 2, -math.sin(math.radians(ax)) * length / 2, z + length / 2 * 0.7)
            rotate(br, x=ax, y=ay)
            assign(br, m['deadwood'])
            parts.append(br)
    else:
        # Agave / joshua clump: spiky leaves in a rosette on a stubby trunk.
        stump = cylinder('Stump', 0.3, 0.9, loc=(0, 0, 0.45), radius2=0.24, segments=10)
        assign(stump, m['deadwood'])
        parts.append(stump)
        for i in range(10):
            a = i * 36
            tilt = 40 if i % 2 else 62
            leaf = cylinder(f'Spike{i}', 0.16, 1.7, loc=(0, 0, 0.9), radius2=0.02, segments=6)
            leaf.location = (math.cos(math.radians(a)) * math.sin(math.radians(tilt)) * 0.85,
                             math.sin(math.radians(a)) * math.sin(math.radians(tilt)) * 0.85,
                             0.9 + math.cos(math.radians(tilt)) * 0.85)
            rotate(leaf, x=math.sin(math.radians(a)) * tilt, y=-math.cos(math.radians(a)) * tilt)
            assign(leaf, m['agave'] if i % 2 else m['cactus'])
            parts.append(leaf)
    return parts


def tree_volcanic(v: int, m) -> list[bpy.types.Object]:
    parts = []
    if v == 0:
        # Charred snag with stubs and a faint ember seam.
        trunk = cylinder('Trunk', 0.34, 3.0, loc=(0, 0, 1.5), radius2=0.14, segments=9)
        assign(trunk, m['char'])
        parts.append(trunk)
        for i, (ax, ay, z) in enumerate(((40, 15, 1.9), (-35, -30, 2.5))):
            stub = cylinder(f'Stub{i}', 0.1, 0.9, loc=(0, 0, z), radius2=0.04, segments=6)
            stub.location = (math.sin(math.radians(ay)) * 0.4, -math.sin(math.radians(ax)) * 0.4, z + 0.3)
            rotate(stub, x=ax, y=ay)
            assign(stub, m['char'])
            parts.append(stub)
        seam = box('Ember', (0.05, 0.16, 1.1), loc=(0.3, 0, 1.2))
        rotate(seam, y=8)
        assign(seam, m['ember'])
        parts.append(seam)
    elif v == 1:
        # Ash-grey hardy tree: thin trunk, sparse grey-green tufts.
        parts.append(_trunk('Trunk', 0.2, 0.12, 2.6, m, mat=m['char']))
        parts.append(_blob('TuftA', 1.0, (0.4, 0.2, 3.0), m['ash'], seed=10))
        parts.append(_blob('TuftB', 0.8, (-0.5, -0.3, 3.4), m['ash'], seed=11))
        parts.append(_blob('TuftC', 0.7, (0.1, 0.4, 3.9), m['ash'], seed=12))
    else:
        # Low dark scrub over a lava rock with glowing cracks.
        rock = icosphere('LavaRock', 0.9, loc=(0, 0, 0.5), subdivisions=3, scale=(1.3, 1.1, 0.7))
        displace(rock, strength=0.3, noise_scale=0.9, seed=13)
        assign(rock, m['char'])
        parts.append(rock)
        crack = box('Crack', (1.1, 0.06, 0.08), loc=(0.1, 0.2, 0.95))
        rotate(crack, z=30)
        assign(crack, m['ember'])
        parts.append(crack)
        for i in range(3):
            a = math.radians(i * 120 + 40)
            parts.append(_blob(f'Scrub{i}', 0.55, (math.cos(a) * 0.7, math.sin(a) * 0.7, 1.15), m['ash'], seed=14 + i))
    return parts


def bush(v: int, m) -> list[bpy.types.Object]:
    parts = []
    if v == 0:
        parts.append(_blob('BushA', 0.7, (0, 0, 0.55), m['leaf_b'], scale=(1.2, 1.0, 0.8), seed=20))
        parts.append(_blob('BushB', 0.5, (0.45, 0.2, 0.75), m['leaf_a'], seed=21))
        parts.append(_blob('BushC', 0.45, (-0.4, -0.25, 0.7), m['leaf_c'], seed=22))
    else:
        parts.append(_blob('BushA', 0.6, (0, 0, 0.5), m['leaf_a'], scale=(1.1, 1.1, 0.9), seed=23))
        for i in range(5):
            a = math.radians(i * 72 + 10)
            berry = sphere(f'Berry{i}', 0.09, loc=(math.cos(a) * 0.5, math.sin(a) * 0.5, 0.75 + (i % 2) * 0.15), segments=8, rings=5)
            assign(berry, m['berry'])
            parts.append(berry)
    return parts


def rock(v: int, m) -> list[bpy.types.Object]:
    parts = []
    if v == 0:
        r = icosphere('Boulder', 1.0, loc=(0, 0, 0.7), subdivisions=4, scale=(1.3, 1.0, 0.85))
        displace(r, strength=0.35, noise_scale=0.8, seed=30)
        assign(r, m['rock'])
        parts.append(r)
    elif v == 1:
        r = icosphere('Slab', 1.0, loc=(0, 0, 0.55), subdivisions=4, scale=(1.6, 1.1, 0.6))
        displace(r, strength=0.25, noise_scale=1.1, seed=31)
        rotate(r, y=12, z=25)
        assign(r, m['rock'])
        parts.append(r)
    else:
        for i, (x, y, rr) in enumerate(((0, 0, 0.8), (0.9, 0.4, 0.5), (-0.7, 0.5, 0.45), (0.2, -0.8, 0.4))):
            r = icosphere(f'Stone{i}', rr, loc=(x, y, rr * 0.7), subdivisions=3, scale=(1.2, 1.0, 0.8))
            displace(r, strength=0.3, noise_scale=0.7, seed=32 + i)
            assign(r, m['rock'])
            parts.append(r)
    return parts


def house(v: int, m) -> list[bpy.types.Object]:
    """Unit house: footprint x,y in [-0.5, 0.5], walls 0 → 0.72, ridge at 1.0, chimney top 1.1 at (+0.25, +0.25)."""
    parts = []
    wall_h = 0.72
    walls = box('Walls', (0.94, 0.94, wall_h), loc=(0, 0, wall_h / 2))
    bevel(walls, 0.03, 2)
    assign(walls, m['wall'] if v != 2 else m['wall_b'])
    parts.append(walls)
    roof_mat = [m['roof_red'], m['roof_brown'], m['roof_grey']][v]
    if v == 1:
        # Hip roof: a squashed pyramid.
        roof = cylinder('Roof', 0.78, 0.32, loc=(0, 0, wall_h + 0.16), radius2=0.06, segments=4)
        rotate(roof, z=45)
        assign(roof, roof_mat)
        parts.append(roof)
    else:
        # Gable roof along X, with an overhang.
        from common import prism
        roof = prism('Roof', [(-0.56, 0), (0.56, 0), (0, 0.3)], 1.08, loc=(0, 0, wall_h), axis='X')
        bevel(roof, 0.02, 2)
        assign(roof, roof_mat)
        parts.append(roof)
        ridge = box('Ridge', (1.1, 0.08, 0.04), loc=(0, 0, wall_h + 0.3))
        assign(ridge, m['timber'])
        parts.append(ridge)
    # Door on the +Y face, windows on ±X.
    door = box('Door', (0.2, 0.03, 0.34), loc=(-0.15, 0.48, 0.17))
    assign(door, m['door'])
    parts.append(door)
    for x in (-0.5, 0.5):
        win = box('Window', (0.03, 0.22, 0.2), loc=(x, 0.1, 0.42))
        assign(win, m['window'])
        parts.append(win)
        frame = box('WindowFrame', (0.02, 0.27, 0.25), loc=(x * 0.98, 0.1, 0.42))
        assign(frame, m['timber'])
        parts.append(frame)
    win2 = box('WindowFront', (0.22, 0.03, 0.2), loc=(0.2, 0.48, 0.42))
    assign(win2, m['window'])
    parts.append(win2)
    chimney = box('Chimney', (0.14, 0.14, 0.42), loc=(0.25, -0.25, 0.9))
    assign(chimney, m['chimney'])
    parts.append(chimney)
    cap = box('ChimneyCap', (0.18, 0.18, 0.04), loc=(0.25, -0.25, 1.1))
    assign(cap, m['char'])
    parts.append(cap)
    if v == 2:
        # Porch awning over the door.
        awning = box('Awning', (0.5, 0.22, 0.03), loc=(-0.15, 0.58, 0.42))
        rotate(awning, x=12)
        assign(awning, roof_mat)
        parts.append(awning)
        for x in (-0.36, 0.06):
            post = cylinder('Post', 0.02, 0.4, loc=(x, 0.66, 0.2), segments=6)
            assign(post, m['timber'])
            parts.append(post)
    return parts


def registry() -> dict:
    reg = {}
    builders = {
        'deciduous': tree_deciduous, 'conifer': tree_conifer, 'tropical': tree_tropical,
        'desert': tree_desert, 'volcanic': tree_volcanic,
    }
    for family, fn in builders.items():
        for v in range(TREE_VARIANTS):
            reg[f'prop_tree_{family}_{v}'] = (lambda f, vv: (lambda: pivot('Body', (0, 0, 0), f(vv, _materials()))))(fn, v)
    for v in range(BUSH_VARIANTS):
        reg[f'prop_bush_{v}'] = (lambda vv: (lambda: pivot('Body', (0, 0, 0), bush(vv, _materials()))))(v)
    for v in range(ROCK_VARIANTS):
        reg[f'prop_rock_{v}'] = (lambda vv: (lambda: pivot('Body', (0, 0, 0), rock(vv, _materials()))))(v)
    for v in range(HOUSE_VARIANTS):
        reg[f'prop_house_{v}'] = (lambda vv: (lambda: pivot('Body', (0, 0, 0), house(vv, _materials()))))(v)
    return reg
