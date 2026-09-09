"""Buildings — 9 types × 3 tiers, sized from building-defs.json, plus the ruin.

Axes: the model is centred on its footprint, x spanning ±sizeX/2 and y
spanning ±sizeZ/2 (game +Z is Blender −Y, so the FRONT — the row holding
the entry and exit cells — is +Y). The entry door is green-framed, the exit
door orange-framed, matching the roof markers the game draws. `TintBody`
is the type colour, recoloured per instance by the game.
"""
from __future__ import annotations

import json
import math
import os
import random

import bpy
from mathutils import Vector

from common import (
    array, assign, bevel, box, capsule, cylinder, material, pivot, prism, rotate, sphere, torus,
)

DEFS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'building-defs.json')

TYPE_COLORS = {
    'driving_center': 0x44AAFF,
    'blasting_academy': 0xFF6600,
    'management_office': 0x77BBDD,
    'geology_lab': 0x996633,
    'research_center': 0x9944CC,
    'living_quarters': 0x4488CC,
    'explosive_warehouse': 0xFF2222,
    'freight_warehouse': 0x888888,
    'vehicle_depot': 0xDDAA22,
}

FLOOR_H = 1.45
ENTRY_GREEN = 0x00CC44
EXIT_ORANGE = 0xFF4400


def _materials(btype: str) -> dict[str, bpy.types.Material]:
    return {
        'body': material('TintBody', TYPE_COLORS[btype], roughness=0.75),
        'plinth': material('Plinth', 0x4D4A52, roughness=0.9),
        'roof': material('Roof', 0x5B5560, roughness=0.85),
        'roof_red': material('RoofRed', 0xC2432E, roughness=0.85),
        'roof_brown': material('RoofBrown', 0x8B4A2B, roughness=0.85),
        'glass': material('Glass', 0xA8DCFF, roughness=0.15),
        'frame': material('Frame', 0xF2EFE6, roughness=0.7),
        'dark': material('Dark', 0x2E2C33, roughness=0.85),
        'steel': material('Steel', 0x9AA0AA, roughness=0.5, metallic=0.3),
        'chrome': material('Chrome', 0xDCE1E8, roughness=0.3, metallic=0.5),
        'entry': material('EntryFrame', ENTRY_GREEN, roughness=0.6),
        'exit': material('ExitFrame', EXIT_ORANGE, roughness=0.6),
        'door': material('Door', 0x3A3238, roughness=0.8),
        'stripe_y': material('StripeYellow', 0xF5C518, roughness=0.7),
        'stripe_k': material('StripeBlack', 0x1E1E24, roughness=0.7),
        'red': material('Red', 0xD8322B, roughness=0.6),
        'white': material('White', 0xF4F1EA, roughness=0.7),
        'rock': material('Rock', 0x8A7F73, roughness=0.95),
        'rubble': material('Rubble', 0x6E6A66, roughness=0.95),
        'rubble2': material('RubbleDark', 0x4F4B49, roughness=0.95),
        'wood': material('Wood', 0xB07A45, roughness=0.9),
        'lamp': material('Lamp', 0xFFF2A8, roughness=0.3, emission=0xFFE080, emission_strength=0.5),
        'beacon': material('Beacon', 0xFF8A2A, roughness=0.3, emission=0xFF7A1A, emission_strength=0.8),
        'green': material('Green', 0x3FA65B, roughness=0.8),
        'cone': material('Cone', 0xFF7A1A, roughness=0.7),
    }


# --------------------------------------------------------------- parts ---

def block(name: str, sx: float, sy: float, h: float, z0: float, m, mat=None, loc_xy=(0.0, 0.0),
          radius: float = 0.08) -> bpy.types.Object:
    """A rounded wall block standing on z0."""
    b = box(name, (sx, sy, h), loc=(loc_xy[0], loc_xy[1], z0 + h / 2))
    bevel(b, min(radius, sx * 0.2, sy * 0.2, h * 0.2), 3)
    assign(b, mat or m['body'])
    return b


def plinth(sx: float, sy: float, m, h: float = 0.16) -> bpy.types.Object:
    p = box('Plinth', (sx + 0.1, sy + 0.1, h), loc=(0, 0, h / 2))
    bevel(p, 0.04, 2)
    assign(p, m['plinth'])
    return p


def door(name: str, x: float, y_face: float, z0: float, m, frame_mat, width: float = 0.55,
         height: float = 1.0, facing: float = 1.0) -> list[bpy.types.Object]:
    """A framed door on a wall face at y = y_face (normal ±Y)."""
    fr = box(f'{name}.Frame', (width + 0.12, 0.08, height + 0.08), loc=(x, y_face + facing * 0.03, z0 + height / 2))
    bevel(fr, 0.02, 2)
    assign(fr, frame_mat)
    dr = box(f'{name}.Leaf', (width, 0.06, height), loc=(x, y_face + facing * 0.05, z0 + height / 2))
    bevel(dr, 0.015, 2)
    assign(dr, m['door'])
    knob = sphere(f'{name}.Knob', 0.03, loc=(x + width * 0.3, y_face + facing * 0.09, z0 + height * 0.5), segments=10, rings=5)
    assign(knob, m['chrome'])
    lamp = box(f'{name}.Lamp', (0.14, 0.08, 0.08), loc=(x, y_face + facing * 0.06, z0 + height + 0.16))
    bevel(lamp, 0.02, 2)
    assign(lamp, m['lamp'])
    return [fr, dr, knob, lamp]


def windows_row(name: str, sx: float, y_face: float, z: float, m, facing: float = 1.0,
                w: float = 0.42, h: float = 0.42, gap: float = 0.75, margin: float = 0.55,
                avoid=()) -> list[bpy.types.Object]:
    """Glass panes with a pale frame along a ±Y face, skipping x positions in `avoid`."""
    out = []
    n = max(1, int((sx - 2 * margin) / gap) + 1)
    x0 = -(n - 1) * gap / 2
    for i in range(n):
        x = x0 + i * gap
        if any(abs(x - a) < 0.55 for a in avoid):
            continue
        fr = box(f'{name}.Frame', (w + 0.08, 0.05, h + 0.08), loc=(x, y_face + facing * 0.02, z))
        bevel(fr, 0.015, 2)
        assign(fr, m['frame'])
        pane = box(f'{name}.Pane', (w, 0.05, h), loc=(x, y_face + facing * 0.04, z))
        assign(pane, m['glass'])
        out += [fr, pane]
    return out


def windows_side(name: str, sy: float, x_face: float, z: float, m, facing: float = 1.0,
                 w: float = 0.42, h: float = 0.42, gap: float = 0.75, margin: float = 0.55) -> list[bpy.types.Object]:
    out = []
    n = max(1, int((sy - 2 * margin) / gap) + 1)
    y0 = -(n - 1) * gap / 2
    for i in range(n):
        y = y0 + i * gap
        fr = box(f'{name}.Frame', (0.05, w + 0.08, h + 0.08), loc=(x_face + facing * 0.02, y, z))
        bevel(fr, 0.015, 2)
        assign(fr, m['frame'])
        pane = box(f'{name}.Pane', (0.05, w, h), loc=(x_face + facing * 0.04, y, z))
        assign(pane, m['glass'])
        out += [fr, pane]
    return out


def flat_roof(sx: float, sy: float, z: float, m, mat=None, lip: float = 0.12) -> list[bpy.types.Object]:
    slab = box('Roof.Slab', (sx + 0.16, sy + 0.16, 0.14), loc=(0, 0, z + 0.07))
    bevel(slab, 0.04, 3)
    assign(slab, mat or m['roof'])
    par = box('Roof.Parapet', (sx + 0.16, sy + 0.16, lip), loc=(0, 0, z + 0.14 + lip / 2))
    bevel(par, 0.03, 2)
    assign(par, mat or m['roof'])
    inner = box('Roof.Inner', (sx - 0.1, sy - 0.1, lip + 0.02), loc=(0, 0, z + 0.14 + lip / 2 - 0.02))
    assign(inner, m['dark'])
    return [slab, par, inner]


def pitched_roof(sx: float, sy: float, z: float, h: float, m, mat=None, along: str = 'X',
                 overhang: float = 0.22) -> list[bpy.types.Object]:
    """Gable roof; ridge runs along `along`."""
    if along == 'X':
        pts = [(-sy / 2 - overhang, 0.0), (sy / 2 + overhang, 0.0), (0.0, h)]
        r = prism('Roof.Gable', pts, sx + 2 * overhang, loc=(0, 0, z), axis='X')
    else:
        pts = [(-sx / 2 - overhang, 0.0), (sx / 2 + overhang, 0.0), (0.0, h)]
        r = prism('Roof.Gable', pts, sy + 2 * overhang, loc=(0, 0, z), axis='Y')
    bevel(r, 0.04, 3)
    assign(r, mat or m['roof_brown'])
    ridge = box('Roof.Ridge', ((sx if along == 'X' else 0.16) + 2 * overhang, (0.16 if along == 'X' else sy + 2 * overhang), 0.1),
                loc=(0, 0, z + h))
    bevel(ridge, 0.03, 2)
    assign(ridge, m['dark'])
    return [r, ridge]


def barrel_roof(sx: float, sy: float, z: float, m, mat=None, along: str = 'X') -> list[bpy.types.Object]:
    """Half-cylinder hangar roof spanning the shorter axis, ridge along `along`."""
    import bmesh
    span = sy if along == 'X' else sx
    length = sx if along == 'X' else sy
    r = span / 2 + 0.1
    name = 'Roof.Barrel'
    c = cylinder(name, r, length + 0.3, loc=(0, 0, z), axis=along, segments=40)
    bm = bmesh.new()
    bm.from_mesh(c.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0), plane_no=(0, 0, 1), clear_inner=True)
    edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(c.data)
    bm.free()
    c.data.shade_smooth()
    c.scale = (1, 1, 0.6) if along == 'X' else (1, 1, 0.6)
    assign(c, mat or m['roof'])
    return [c]


def dome(name: str, r: float, loc, m, mat=None) -> bpy.types.Object:
    import bmesh
    d = sphere(name, r, loc=loc, segments=32, rings=16)
    bm = bmesh.new()
    bm.from_mesh(d.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0), plane_no=(0, 0, 1), clear_inner=True)
    edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(d.data)
    bm.free()
    d.data.shade_smooth()
    assign(d, mat or m['steel'])
    return d


def chimney(name: str, loc, h: float, m, r: float = 0.14) -> list[bpy.types.Object]:
    c = cylinder(f'{name}.Stack', r, h, loc=(loc[0], loc[1], loc[2] + h / 2), segments=16)
    assign(c, m['dark'])
    cap = cylinder(f'{name}.Cap', r * 1.35, 0.1, loc=(loc[0], loc[1], loc[2] + h), segments=16)
    bevel(cap, 0.03, 2, angle=60)
    assign(cap, m['steel'])
    return [c, cap]


def antenna(name: str, loc, h: float, m) -> list[bpy.types.Object]:
    mast = cylinder(f'{name}.Mast', 0.035, h, loc=(loc[0], loc[1], loc[2] + h / 2), segments=8)
    assign(mast, m['steel'])
    ball = sphere(f'{name}.Ball', 0.09, loc=(loc[0], loc[1], loc[2] + h), segments=12, rings=6)
    assign(ball, m['red'])
    ring = torus(f'{name}.Ring', 0.16, 0.02, loc=(loc[0], loc[1], loc[2] + h * 0.6), major_segments=20, minor_segments=6)
    assign(ring, m['steel'])
    return [mast, ball, ring]


def dish(name: str, loc, r: float, m, yaw: float = 30.0, tilt: float = 50.0) -> list[bpy.types.Object]:
    import bmesh
    base = cylinder(f'{name}.Base', 0.09, 0.5, loc=(loc[0], loc[1], loc[2] + 0.25), segments=12)
    assign(base, m['steel'])
    d = sphere(f'{name}.Dish', r, loc=(loc[0], loc[1], loc[2] + 0.55), segments=28, rings=14)
    bm = bmesh.new()
    bm.from_mesh(d.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, r * 0.45), plane_no=(0, 0, 1), clear_outer=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(d.data)
    bm.free()
    d.data.shade_smooth()
    d.scale = (1, 1, 0.6)
    rotate(d, x=-tilt, z=yaw)
    d.location.z += 0.15
    assign(d, m['white'])
    feed = cylinder(f'{name}.Feed', 0.03, r * 0.9, loc=(loc[0], loc[1], loc[2] + 0.55 + r * 0.3), segments=8)
    rotate(feed, x=-tilt, z=yaw)
    assign(feed, m['dark'])
    return [base, d, feed]


def ac_units(name: str, sx: float, sy: float, z: float, m, count: int = 2) -> list[bpy.types.Object]:
    out = []
    rnd = random.Random(int(sx * 7 + sy * 13))
    for i in range(count):
        x = rnd.uniform(-sx / 2 + 0.5, sx / 2 - 0.5)
        y = rnd.uniform(-sy / 2 + 0.5, sy / 2 - 0.5)
        u = box(f'{name}.Box', (0.45, 0.45, 0.32), loc=(x, y, z + 0.16))
        bevel(u, 0.04, 2)
        assign(u, m['steel'])
        fan = cylinder(f'{name}.Fan', 0.16, 0.04, loc=(x, y, z + 0.33), segments=16)
        assign(fan, m['dark'])
        out += [u, fan]
    return out


def hazard_band(name: str, sx: float, sy: float, z: float, m, h: float = 0.22) -> list[bpy.types.Object]:
    """Alternating yellow/black band around all four walls."""
    out = []
    seg = 0.4
    for face, length, fixed in (('F', sx, sy / 2), ('B', sx, -sy / 2), ('L', sy, -sx / 2), ('R', sy, sx / 2)):
        n = max(2, int(length / seg))
        for i in range(n):
            t = -length / 2 + seg * (i + 0.5)
            if face in ('F', 'B'):
                loc = (t, fixed + (0.03 if face == 'F' else -0.03), z)
                size = (seg, 0.05, h)
            else:
                loc = (fixed + (0.03 if face == 'R' else -0.03), t, z)
                size = (0.05, seg, h)
            b = box(f'{name}.Seg', size, loc=loc)
            assign(b, m['stripe_y'] if i % 2 == 0 else m['stripe_k'])
            out.append(b)
    return out


def crate(name: str, loc, s: float, m, rot_z: float = 0.0) -> list[bpy.types.Object]:
    c = box(f'{name}.Box', (s, s, s), loc=(loc[0], loc[1], loc[2] + s / 2))
    bevel(c, s * 0.08, 2)
    rotate(c, z=rot_z)
    assign(c, m['wood'])
    band = box(f'{name}.Band', (s + 0.02, s + 0.02, s * 0.18), loc=(loc[0], loc[1], loc[2] + s / 2))
    rotate(band, z=rot_z)
    assign(band, m['dark'])
    return [c, band]


def barrel(name: str, loc, m, mat=None) -> list[bpy.types.Object]:
    b = cylinder(f'{name}.Drum', 0.19, 0.55, loc=(loc[0], loc[1], loc[2] + 0.275), segments=16)
    bevel(b, 0.03, 2, angle=60)
    assign(b, mat or m['red'])
    ring = torus(f'{name}.Ring', 0.19, 0.02, loc=(loc[0], loc[1], loc[2] + 0.18), major_segments=16, minor_segments=6)
    assign(ring, m['dark'])
    ring2 = torus(f'{name}.Ring', 0.19, 0.02, loc=(loc[0], loc[1], loc[2] + 0.38), major_segments=16, minor_segments=6)
    assign(ring2, m['dark'])
    return [b, ring, ring2]


def cone_prop(name: str, loc, m) -> list[bpy.types.Object]:
    c = cylinder(f'{name}.Cone', 0.16, 0.42, loc=(loc[0], loc[1], loc[2] + 0.21), segments=16, radius2=0.04)
    assign(c, m['cone'])
    b = box(f'{name}.Base', (0.34, 0.34, 0.04), loc=(loc[0], loc[1], loc[2] + 0.02))
    assign(b, m['dark'])
    band = cylinder(f'{name}.Band', 0.12, 0.08, loc=(loc[0], loc[1], loc[2] + 0.25), segments=16, radius2=0.095)
    assign(band, m['white'])
    return [c, b, band]


def sign_post(name: str, loc, m, mat, h: float = 1.6, plate=(0.9, 0.5)) -> list[bpy.types.Object]:
    post = cylinder(f'{name}.Post', 0.04, h, loc=(loc[0], loc[1], loc[2] + h / 2), segments=10)
    assign(post, m['steel'])
    p = box(f'{name}.Plate', (plate[0], 0.06, plate[1]), loc=(loc[0], loc[1], loc[2] + h + plate[1] / 2 - 0.05))
    bevel(p, 0.03, 2)
    assign(p, mat)
    return [post, p]


def lamp_post(name: str, loc, m, h: float = 2.2) -> list[bpy.types.Object]:
    post = cylinder(f'{name}.Post', 0.045, h, loc=(loc[0], loc[1], loc[2] + h / 2), segments=10)
    assign(post, m['dark'])
    head = box(f'{name}.Head', (0.35, 0.18, 0.12), loc=(loc[0] + 0.15, loc[1], loc[2] + h))
    bevel(head, 0.03, 2)
    assign(head, m['dark'])
    glow = box(f'{name}.Glow', (0.3, 0.14, 0.03), loc=(loc[0] + 0.15, loc[1], loc[2] + h - 0.07))
    assign(glow, m['lamp'])
    return [post, head, glow]


# ------------------------------------------------------------ builders ---

def _base(sx: float, sz: float, tier: int, m, floors: int | None = None, inset: float = 0.12,
          window_rows: bool = True, entry_x: float = 0.0, exit_x: float = 0.0, roof_mat=None):
    """Plinth + wall block of `floors` storeys with doors and window rows on the front."""
    floors = floors or tier
    h = FLOOR_H * floors + 0.3
    parts = [plinth(sx, sz, m)]
    wall_sx, wall_sy = sx - inset, sz - inset
    parts.append(block('Walls', wall_sx, wall_sy, h, 0.12, m))
    front = wall_sy / 2
    parts += door('Entry', entry_x, front, 0.14, m, m['entry'])
    parts += door('Exit', exit_x, front, 0.14, m, m['exit'])
    if window_rows:
        for f in range(floors):
            z = 0.12 + FLOOR_H * f + 0.9
            avoid = (entry_x, exit_x) if f == 0 else ()
            parts += windows_row(f'Win{f}', wall_sx, front, z, m, avoid=avoid)
            parts += windows_row(f'WinB{f}', wall_sx, -front, z, m, facing=-1)
            if wall_sy > 1.6:
                parts += windows_side(f'WinL{f}', wall_sy, -wall_sx / 2, z, m, facing=-1)
                parts += windows_side(f'WinR{f}', wall_sy, wall_sx / 2, z, m, facing=1)
    return parts, h + 0.12, wall_sx, wall_sy


def build_driving_center(sx, sz, tier, ex, xx, m):
    parts, top, wsx, wsy = _base(sx, sz, tier, m, entry_x=ex, exit_x=xx)
    parts += flat_roof(wsx, wsy, top, m)
    # Roll-up bay door on the back, cones out front, steering-wheel sign.
    gate = box('BayDoor', (min(1.4, wsx * 0.6), 0.06, 1.0), loc=(0, -wsy / 2 - 0.02, 0.65))
    assign(gate, m['dark'])
    parts.append(gate)
    slats = box('BaySlat', (min(1.4, wsx * 0.6), 0.03, 0.04), loc=(0, -wsy / 2 - 0.05, 0.3))
    array(slats, 5, (0, 0, 0.17))
    assign(slats, m['steel'])
    parts.append(slats)
    parts += cone_prop('Cone1', (sx / 2 - 0.35, sz / 2 + 0.35, 0), m)
    parts += cone_prop('Cone2', (-sx / 2 + 0.3, sz / 2 + 0.55, 0), m)
    wheel = torus('Sign.Wheel', 0.3, 0.06, loc=(0, 0, top + 0.55), rot=(90, 0, 0), major_segments=24, minor_segments=8)
    assign(wheel, m['dark'])
    hub = cylinder('Sign.Hub', 0.09, 0.08, loc=(0, 0, top + 0.55), axis='Y', segments=12)
    assign(hub, m['steel'])
    spoke = box('Sign.Spoke', (0.05, 0.05, 0.55), loc=(0, 0, top + 0.55))
    array(spoke, 1, (0, 0, 0))
    assign(spoke, m['steel'])
    spoke2 = box('Sign.Spoke', (0.55, 0.05, 0.05), loc=(0, 0, top + 0.55))
    assign(spoke2, m['steel'])
    post = cylinder('Sign.Post', 0.04, 0.4, loc=(0, 0, top + 0.15), segments=8)
    assign(post, m['steel'])
    parts += [wheel, hub, spoke, spoke2, post]
    if tier >= 2:
        parts += lamp_post('Lamp', (-sx / 2 - 0.2, -sz / 2 + 0.3, 0), m)
    if tier >= 3:
        tower = cylinder('Tower', 0.5, 1.3, loc=(-wsx / 2 + 0.7, -wsy / 2 + 0.7, top + 0.65), segments=24)
        bevel(tower, 0.05, 3, angle=60)
        assign(tower, m['body'])
        glass = cylinder('Tower.Glass', 0.54, 0.4, loc=(-wsx / 2 + 0.7, -wsy / 2 + 0.7, top + 1.1), segments=24)
        assign(glass, m['glass'])
        cap = cylinder('Tower.Cap', 0.62, 0.12, loc=(-wsx / 2 + 0.7, -wsy / 2 + 0.7, top + 1.36), segments=24)
        bevel(cap, 0.03, 2, angle=60)
        assign(cap, m['roof'])
        parts += [tower, glass, cap]
    pivot('Body', (0, 0, 0), parts)


def build_blasting_academy(sx, sz, tier, ex, xx, m):
    parts, top, wsx, wsy = _base(sx, sz, tier, m, entry_x=ex, exit_x=xx)
    parts += flat_roof(wsx, wsy, top, m)
    parts += hazard_band('Hazard', wsx, wsy, 0.42, m)
    # The "boom" cone: a red cone on the roof, taller each tier.
    ch = 0.9 + 0.35 * tier
    cone = cylinder('BoomCone', min(wsx, wsy) * 0.32, ch, loc=(0, 0, top + 0.26 + ch / 2), segments=28, radius2=0.05)
    assign(cone, m['roof_red'])
    parts.append(cone)
    ring = torus('BoomRing', min(wsx, wsy) * 0.34, 0.05, loc=(0, 0, top + 0.3), major_segments=28, minor_segments=8)
    assign(ring, m['dark'])
    parts.append(ring)
    # Giant dynamite stick by the wall.
    stick = cylinder('Dynamite', 0.16, 1.1, loc=(sx / 2 + 0.25, -0.2, 0.55), segments=16)
    bevel(stick, 0.04, 2, angle=60)
    assign(stick, m['red'])
    fuse = capsule('Fuse', 0.025, 0.25, loc=(sx / 2 + 0.25, -0.2, 1.25), segments=8, rings=4)
    rotate(fuse, y=30)
    assign(fuse, m['dark'])
    band = torus('DynamiteBand', 0.16, 0.025, loc=(sx / 2 + 0.25, -0.2, 0.8), major_segments=16, minor_segments=6)
    assign(band, m['white'])
    parts += [stick, fuse, band]
    if tier >= 2:
        parts += barrel('Drum1', (-sx / 2 - 0.3, sz / 2 - 0.4, 0), m)
        parts += barrel('Drum2', (-sx / 2 - 0.3, sz / 2 - 0.85, 0), m)
    if tier >= 3:
        siren = cylinder('Siren', 0.14, 0.2, loc=(wsx / 2 - 0.4, wsy / 2 - 0.4, top + 0.36), segments=16, radius2=0.1)
        assign(siren, m['beacon'])
        parts.append(siren)
        parts += antenna('Ant', (-wsx / 2 + 0.4, -wsy / 2 + 0.4, top + 0.26), 1.2, m)
    pivot('Body', (0, 0, 0), parts)


def build_management_office(sx, sz, tier, ex, xx, m):
    parts, top, wsx, wsy = _base(sx, sz, tier, m, entry_x=ex, exit_x=xx)
    parts += flat_roof(wsx, wsy, top, m, mat=m['frame'])
    parts += ac_units('AC', wsx, wsy, top + 0.26, m, count=1 + tier)
    # Flagpole and a glass entrance canopy.
    pole = cylinder('Flag.Pole', 0.035, 2.4, loc=(sx / 2 + 0.3, sz / 2 + 0.3, 1.2), segments=8)
    assign(pole, m['chrome'])
    flag = box('Flag.Cloth', (0.55, 0.03, 0.32), loc=(sx / 2 + 0.58, sz / 2 + 0.3, 2.2))
    rotate(flag, z=15)
    assign(flag, m['body'])
    parts += [pole, flag]
    canopy = box('Canopy', ((xx - ex) + 0.7, 0.3, 0.05), loc=((ex + xx) / 2, wsy / 2 + 0.18, 1.22))
    bevel(canopy, 0.02, 2)
    assign(canopy, m['glass'])
    parts.append(canopy)
    if tier >= 3:
        tw = min(wsx, wsy) * 0.55
        tower = box('Tower', (tw, tw, 1.6), loc=(-wsx / 2 + tw / 2 + 0.2, -wsy / 2 + tw / 2 + 0.2, top + 0.26 + 0.8))
        bevel(tower, 0.06, 3)
        assign(tower, m['glass'])
        parts.append(tower)
        parts += antenna('Ant', (-wsx / 2 + tw / 2 + 0.2, -wsy / 2 + tw / 2 + 0.2, top + 1.86), 0.9, m)
    pivot('Body', (0, 0, 0), parts)


def build_geology_lab(sx, sz, tier, ex, xx, m):
    parts, top, wsx, wsy = _base(sx, sz, tier, m, entry_x=ex, exit_x=xx)
    parts += flat_roof(wsx, wsy, top, m)
    r = min(wsx, wsy) * 0.3
    d = dome('Dome', r, (wsx * 0.15, -wsy * 0.1, top + 0.26), m, mat=m['frame'])
    parts.append(d)
    slit = box('Dome.Slit', (0.14, r * 1.1, r * 1.05), loc=(wsx * 0.15, -wsy * 0.1, top + 0.26 + r * 0.45))
    assign(slit, m['dark'])
    parts.append(slit)
    parts += chimney('Chimney', (-wsx / 2 + 0.35, wsy / 2 - 0.35, top), 0.8, m)
    # Rock samples on display out front.
    rnd = random.Random(11)
    for i in range(3 + tier):
        rr = rnd.uniform(0.14, 0.26)
        rock = sphere(f'Sample{i}', rr, loc=(rnd.uniform(-sx / 2, sx / 2), sz / 2 + rnd.uniform(0.3, 0.6), rr * 0.7),
                      scale=(rnd.uniform(0.8, 1.3), rnd.uniform(0.8, 1.2), rnd.uniform(0.6, 0.9)), segments=12, rings=7)
        rotate(rock, rnd.uniform(0, 40), rnd.uniform(0, 40), rnd.uniform(0, 180))
        assign(rock, m['rock'])
        parts.append(rock)
    if tier >= 2:
        parts += crate('Crate', (-sx / 2 - 0.35, -0.2, 0), 0.5, m, rot_z=12)
    if tier >= 3:
        d2 = dome('Dome2', r * 0.7, (-wsx * 0.25, wsy * 0.15, top + 0.26), m, mat=m['frame'])
        parts.append(d2)
    pivot('Body', (0, 0, 0), parts)


def build_research_center(sx, sz, tier, ex, xx, m):
    parts, top, wsx, wsy = _base(sx, sz, tier, m, entry_x=ex, exit_x=xx)
    parts += flat_roof(wsx, wsy, top, m)
    r = min(wsx, wsy) * 0.36
    d = dome('Dome', r, (0, 0, top + 0.26), m, mat=m['glass'])
    parts.append(d)
    ribs = torus('Dome.Rib', r * 1.005, 0.03, loc=(0, 0, top + 0.26), rot=(90, 0, 0), major_segments=24, minor_segments=6)
    assign(ribs, m['frame'])
    parts.append(ribs)
    ribs2 = torus('Dome.Rib', r * 1.005, 0.03, loc=(0, 0, top + 0.26), rot=(90, 0, 90), major_segments=24, minor_segments=6)
    assign(ribs2, m['frame'])
    parts.append(ribs2)
    parts += dish('Dish', (wsx / 2 - 0.45, -wsy / 2 + 0.45, top + 0.26), 0.35 + 0.1 * tier, m)
    parts += antenna('Ant', (-wsx / 2 + 0.4, wsy / 2 - 0.4, top + 0.26), 1.0 + 0.3 * tier, m)
    if tier >= 2:
        parts += ac_units('AC', wsx, wsy, top + 0.26, m, count=1)
    if tier >= 3:
        parts += dish('Dish2', (-wsx / 2 + 0.6, -wsy / 2 + 0.6, top + 0.26), 0.3, m, yaw=-40)
    pivot('Body', (0, 0, 0), parts)


def build_living_quarters(sx, sz, tier, ex, xx, m):
    parts, top, wsx, wsy = _base(sx, sz, tier, m, entry_x=ex, exit_x=xx)
    along = 'X' if wsx >= wsy else 'Y'
    rh = min(wsx, wsy) * 0.42
    parts += pitched_roof(wsx, wsy, top, rh, m, along=along)
    parts += chimney('Chimney', (-wsx * 0.25, wsy * 0.15, top + rh * 0.5), rh * 0.9, m, r=0.16)
    # Porch bench and a planter by the entry.
    bench = box('Bench', (0.6, 0.25, 0.08), loc=(ex + 0.75 if ex + 1.2 < xx else ex, sz / 2 + 0.3, 0.32))
    bevel(bench, 0.02, 2)
    assign(bench, m['wood'])
    parts.append(bench)
    legs = box('Bench.Leg', (0.06, 0.2, 0.3), loc=(bench.location.x - 0.25, sz / 2 + 0.3, 0.15))
    array(legs, 2, (0.5, 0, 0))
    assign(legs, m['dark'])
    parts.append(legs)
    pot = cylinder('Planter', 0.16, 0.26, loc=(xx + 0.35, sz / 2 + 0.28, 0.13), segments=14, radius2=0.13)
    assign(pot, m['wood'])
    bush = sphere('Bush', 0.2, loc=(xx + 0.35, sz / 2 + 0.28, 0.4), segments=14, rings=8)
    assign(bush, m['green'])
    parts += [pot, bush]
    if tier >= 2:
        for i in range(2):
            win = box(f'Dormer{i}', (0.5, 0.5, 0.45), loc=(-wsx * 0.25 + i * wsx * 0.5, wsy / 2 - 0.1, top + 0.3))
            bevel(win, 0.03, 2)
            assign(win, m['body'])
            parts.append(win)
            pane = box(f'Dormer{i}.Pane', (0.3, 0.05, 0.3), loc=(-wsx * 0.25 + i * wsx * 0.5, wsy / 2 + 0.17, top + 0.33))
            assign(pane, m['glass'])
            parts.append(pane)
    if tier >= 3:
        parts += antenna('Ant', (wsx * 0.3, -wsy * 0.2, top + rh), 0.8, m)
        line = cylinder('WashLine', 0.015, 1.2, loc=(-sx / 2 - 0.5, 0, 1.1), axis='Y', segments=6)
        assign(line, m['dark'])
        parts.append(line)
        for i, yy in enumerate((-0.4, 0.0, 0.4)):
            cloth = box(f'Cloth{i}', (0.05, 0.25, 0.3), loc=(-sx / 2 - 0.5, yy, 0.95))
            assign(cloth, m['white'] if i != 1 else m['body'])
            parts.append(cloth)
        for yy in (-0.6, 0.6):
            post = cylinder('WashPost', 0.03, 1.2, loc=(-sx / 2 - 0.5, yy, 0.6), segments=8)
            assign(post, m['dark'])
            parts.append(post)
    pivot('Body', (0, 0, 0), parts)


def build_explosive_warehouse(sx, sz, tier, ex, xx, m):
    # A vault, not a tower: walls grow a little per tier rather than a storey.
    parts, top, wsx, wsy = _base(sx, sz, tier, m, floors=1 + 0.4 * (tier - 1), window_rows=False, entry_x=ex, exit_x=xx)
    parts += barrel_roof(wsx, wsy, top, m, along='X' if wsx >= wsy else 'Y')
    parts += hazard_band('Hazard', wsx, wsy, 0.9, m)
    # Vents on the vault roof, blast berm around the back.
    vent = cylinder('Vent', 0.12, 0.35, loc=(-wsx * 0.25, 0, top + min(wsx, wsy) * 0.28), segments=12)
    array(vent, 2, (wsx * 0.5, 0, 0))
    assign(vent, m['steel'])
    parts.append(vent)
    bollard = cylinder('Bollard', 0.08, 0.6, loc=(-sx / 2 + 0.3, sz / 2 + 0.45, 0.3), segments=10)
    array(bollard, max(2, int(sx)), (max(0.8, (sx - 0.6) / max(1, int(sx) - 1)), 0, 0))
    assign(bollard, m['stripe_y'])
    parts.append(bollard)
    for i in range(tier + 1):
        parts += barrel(f'Drum{i}', (sx / 2 + 0.3, sz / 2 - 0.35 - i * 0.42, 0), m)
    sign = sign_post('Sign', (-sx / 2 - 0.35, sz / 2 + 0.2, 0), m, m['stripe_y'], h=1.1, plate=(0.6, 0.5))
    parts += sign
    bolt = box('Sign.Bolt', (0.12, 0.08, 0.3), loc=(-sx / 2 - 0.35, sz / 2 + 0.17, 1.28))
    rotate(bolt, y=25)
    assign(bolt, m['stripe_k'])
    parts.append(bolt)
    if tier >= 2:
        parts += lamp_post('Lamp', (sx / 2 + 0.3, -sz / 2 + 0.2, 0), m, h=1.8)
    if tier >= 3:
        for i in range(3):
            post = cylinder(f'Fence.Post{i}', 0.04, 0.9, loc=(-sx / 2 - 0.9, -sz / 2 + 0.4 + i * 0.9, 0.45), segments=8)
            assign(post, m['steel'])
            parts.append(post)
        rail = box('Fence.Rail', (0.04, 1.9, 0.05), loc=(-sx / 2 - 0.9, -sz / 2 + 1.3, 0.75))
        array(rail, 2, (0, 0, -0.35))
        assign(rail, m['steel'])
        parts.append(rail)
    pivot('Body', (0, 0, 0), parts)


def build_freight_warehouse(sx, sz, tier, ex, xx, m):
    # A hangar: one tall hall that gains headroom per tier, not storeys.
    parts, top, wsx, wsy = _base(sx, sz, tier, m, floors=1.2 + 0.6 * (tier - 1), window_rows=False, entry_x=ex, exit_x=xx)
    along = 'X' if wsx >= wsy else 'Y'
    parts += barrel_roof(wsx, wsy, top, m, along=along)
    # Big sliding doors on the back wall, high windows, loading dock with crates.
    dw = min(2.2, wsx * 0.55)
    door_ = box('BigDoor', (dw, 0.06, top * 0.55), loc=(0, -wsy / 2 - 0.02, top * 0.3))
    assign(door_, m['dark'])
    parts.append(door_)
    frame = box('BigDoor.Frame', (dw + 0.2, 0.05, top * 0.55 + 0.16), loc=(0, -wsy / 2 - 0.01, top * 0.3 + 0.04))
    assign(frame, m['stripe_y'])
    parts.append(frame)
    for side in (-1, 1):
        eave = box('Eave', (wsx + 0.3, 0.12, 0.14), loc=(0, side * (wsy / 2 + 0.05), top + 0.02))
        bevel(eave, 0.03, 2)
        assign(eave, m['stripe_y'])
        parts.append(eave)
    rail = box('BigDoor.Rail', (dw + 0.6, 0.08, 0.08), loc=(0, -wsy / 2 - 0.05, top * 0.58))
    assign(rail, m['steel'])
    parts.append(rail)
    split = box('BigDoor.Split', (0.06, 0.04, top * 0.55), loc=(0, -wsy / 2 - 0.06, top * 0.3))
    assign(split, m['steel'])
    parts.append(split)
    parts += windows_row('HighWin', wsx, wsy / 2, top - 0.5, m, w=0.5, h=0.3)
    dock = box('Dock', (wsx * 0.8, 0.7, 0.35), loc=(0, wsy / 2 + 0.4, 0.175))
    bevel(dock, 0.03, 2)
    assign(dock, m['plinth'])
    parts.append(dock)
    parts += crate('Crate1', (sx / 2 + 0.4, 0.2, 0), 0.55, m)
    parts += crate('Crate2', (sx / 2 + 0.4, -0.45, 0), 0.45, m, rot_z=20)
    if tier >= 2:
        parts += crate('Crate3', (sx / 2 + 0.4, 0.2, 0.55), 0.45, m, rot_z=8)
        parts += barrel('Drum', (-sx / 2 - 0.3, -sz / 2 + 0.4, 0), m, mat=m['stripe_y'])
    if tier >= 3:
        # Roof-mounted gantry crane rail.
        beam = box('Gantry.Beam', (wsx + 1.2, 0.16, 0.16), loc=(0, sz / 2 + 0.9, top + 0.4))
        assign(beam, m['stripe_y'])
        parts.append(beam)
        for xg in (-wsx / 2 - 0.4, wsx / 2 + 0.4):
            leg = box('Gantry.Leg', (0.16, 0.16, top + 0.4), loc=(xg, sz / 2 + 0.9, (top + 0.4) / 2))
            assign(leg, m['stripe_y'])
            parts.append(leg)
        hook = cylinder('Gantry.Hook', 0.03, 0.9, loc=(0.6, sz / 2 + 0.9, top - 0.1), segments=8)
        assign(hook, m['dark'])
        parts.append(hook)
    pivot('Body', (0, 0, 0), parts)


def build_vehicle_depot(sx, sz, tier, ex, xx, m):
    parts, top, wsx, wsy = _base(sx, sz, tier, m, floors=1 + 0.35 * (tier - 1), window_rows=False, entry_x=ex, exit_x=xx)
    parts += flat_roof(wsx, wsy, top, m)
    # Open service bays on the front between the two doors, arched.
    span = max(1.2, (xx - ex) - 1.3)
    bays = max(1, int(span / 1.3))
    bw = span / bays
    for i in range(bays):
        x = (ex + xx) / 2 - span / 2 + bw * (i + 0.5)
        opening = box(f'Bay{i}', (bw - 0.25, 0.1, top * 0.62), loc=(x, wsy / 2 + 0.02, top * 0.34))
        bevel(opening, 0.06, 3)
        assign(opening, m['dark'])
        parts.append(opening)
        arch = torus(f'Bay{i}.Arch', (bw - 0.25) / 2, 0.05, loc=(x, wsy / 2 + 0.04, top * 0.62 + 0.02), rot=(90, 0, 0),
                     major_segments=20, minor_segments=6)
        import bmesh
        bm = bmesh.new(); bm.from_mesh(arch.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.02], context='VERTS')
        bm.to_mesh(arch.data); bm.free()
        assign(arch, m['stripe_y'])
        parts.append(arch)
    # Tyre stack, oil drums, fuel pump.
    for i in range(3):
        t = torus(f'Tyre{i}', 0.28, 0.1, loc=(sx / 2 + 0.4, -sz / 2 + 0.45, 0.1 + i * 0.2), major_segments=20, minor_segments=8)
        assign(t, m['dark'])
        parts.append(t)
    parts += barrel('Drum1', (sx / 2 + 0.4, 0.3, 0), m, mat=m['stripe_y'])
    pump = box('Pump', (0.35, 0.3, 0.9), loc=(-sx / 2 - 0.4, sz / 2 - 0.4, 0.45))
    bevel(pump, 0.04, 2)
    assign(pump, m['red'])
    parts.append(pump)
    screen = box('Pump.Screen', (0.05, 0.2, 0.18), loc=(-sx / 2 - 0.6, sz / 2 - 0.4, 0.7))
    assign(screen, m['glass'])
    parts.append(screen)
    hose = capsule('Pump.Hose', 0.025, 0.5, loc=(-sx / 2 - 0.4, sz / 2 - 0.2, 0.55), axis='Z', segments=8, rings=4)
    rotate(hose, x=25)
    assign(hose, m['dark'])
    parts.append(hose)
    if tier >= 2:
        parts += crate('Crate', (-sx / 2 - 0.4, -sz / 2 + 0.4, 0), 0.5, m, rot_z=10)
        parts += sign_post('Sign', (sx / 2 + 0.4, sz / 2 + 0.3, 0), m, m['body'], h=1.8, plate=(0.9, 0.45))
    if tier >= 3:
        parts += lamp_post('Lamp', (0, sz / 2 + 0.5, 0), m, h=2.2)
        parts += ac_units('AC', wsx, wsy, top + 0.26, m, count=2)
    pivot('Body', (0, 0, 0), parts)


def build_ruin(m):
    """A 2×2 rubble mound; the game scales it to the destroyed building's footprint."""
    rnd = random.Random(5)
    parts = []
    mound = sphere('Mound', 1.0, loc=(0, 0, 0.05), scale=(1.0, 1.0, 0.42), segments=24, rings=12)
    assign(mound, m['rubble'])
    parts.append(mound)
    for i in range(10):
        s = rnd.uniform(0.25, 0.55)
        slab = box(f'Slab{i}', (s, s * rnd.uniform(0.5, 1.0), s * 0.35),
                   loc=(rnd.uniform(-0.75, 0.75), rnd.uniform(-0.75, 0.75), rnd.uniform(0.15, 0.5)))
        bevel(slab, 0.03, 2)
        rotate(slab, rnd.uniform(-25, 25), rnd.uniform(-25, 25), rnd.uniform(0, 180))
        assign(slab, m['rubble2'] if i % 2 else m['plinth'])
        parts.append(slab)
    wall = box('BrokenWall', (0.9, 0.16, 0.9), loc=(-0.55, 0.5, 0.45))
    bevel(wall, 0.03, 2)
    rotate(wall, x=-12, z=20)
    assign(wall, m['rubble'])
    parts.append(wall)
    for i in range(3):
        beam = box(f'Beam{i}', (1.0, 0.08, 0.08), loc=(rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), rnd.uniform(0.35, 0.6)))
        rotate(beam, 0, rnd.uniform(-30, 30), rnd.uniform(0, 180))
        assign(beam, m['dark'])
        parts.append(beam)
    pivot('Body', (0, 0, 0), parts)


TYPE_BUILDERS = {
    'driving_center': build_driving_center,
    'blasting_academy': build_blasting_academy,
    'management_office': build_management_office,
    'geology_lab': build_geology_lab,
    'research_center': build_research_center,
    'living_quarters': build_living_quarters,
    'explosive_warehouse': build_explosive_warehouse,
    'freight_warehouse': build_freight_warehouse,
    'vehicle_depot': build_vehicle_depot,
}


def _load_defs() -> dict:
    if not os.path.exists(DEFS_PATH):
        raise SystemExit(f'{DEFS_PATH} missing — run `npm run models:defs` first')
    with open(DEFS_PATH) as f:
        return json.load(f)


def build_building(btype: str, tier: int) -> None:
    d = _load_defs()[btype][str(tier)]
    sx, sz = d['sizeX'], d['sizeZ']
    # Entry/exit cells are (dx, dz) from the placement origin; the model is centred on the footprint.
    ex = d['entry'][0] + 0.5 - sx / 2
    xx = d['exit'][0] + 0.5 - sx / 2
    TYPE_BUILDERS[btype](sx, sz, tier, ex, xx, _materials(btype))


def registry() -> dict:
    reg = {}
    for btype in TYPE_BUILDERS:
        for tier in (1, 2, 3):
            reg[f'building_{btype}_t{tier}'] = (lambda b, t: (lambda: build_building(b, t)))(btype, tier)
    reg['building_ruin'] = lambda: build_ruin(_materials('freight_warehouse'))
    return reg
