"""Tier-1 buildings — improvised shacks, one caricature per type.

* driving_center     Learner's Lot: a dirt lot, plywood booth, wrecked car on a brick, cones, tyres, wobbly barrier.
* blasting_academy   Boom Shack: a shack whose roof was blown half off, scorched window, dynamite bench, KA-BOOM board.
* management_office  The Cupboard: an oversized wardrobe, door ajar on paper stacks, desk lamp, MANAGER sign, phone on a stool.
* geology_lab        Rock Shed: a garden shed, rock shelf, giant magnifying-glass sign, hammer, wheelbarrow, patched roof.
* research_center    Think Tank Tent: a patched wall tent with guy ropes, lightbulb sign, whiteboard, lawn chair, campfire.
* living_quarters    The Cells: an open-topped cage of cheap galvanized bars on a low steel kick plate,
                     no roof so the mattress and open steel toilet inside are visible from above, a
                     scavenged watchtower with a cold spotlight, cell doors 1 and 3 (2 welded shut).
* explosive_warehouse Boom Closet: a two-seat outhouse stuffed with dynamite, TNT stencil, lit fuse, danger sign, sandbags.
* freight_warehouse  The Pile: a junk heap under a tarp on crooked poles, bathtub, bent bike, scale, STUFF sign, rats.
* vehicle_depot      Rusty Garage: a rusted tin lean-to, car on bricks with the hood up, oil puddle, GAR GE sign, work lamp.

Same axes as buildings.py: the model is centred on its footprint, the FRONT
(entry and exit doors) is +Y, ground is z = 0. Every tier-1 model stays under
2.8 m so the tier-2 model above it is taller, and overhangs by at most 0.8 m.
"""
from __future__ import annotations

import math
import random

import bpy
import bmesh
from mathutils import Matrix, Vector

from common import (
    array, assign, bevel, box, capsule, cylinder, hex_rgb, icosphere, material, pivot, prism, rotate,
    solidify, sphere, srgb_to_linear, torus,
)
import buildings as B

# Weather-beaten takes on TYPE_COLORS: the type still reads, the paint does not.
DULL = {
    'driving_center': 0x7E9AAB,
    'blasting_academy': 0xB0743F,
    'management_office': 0x9C7B55,
    'geology_lab': 0x8C6A48,
    'research_center': 0x8E7A9E,
    'living_quarters': 0xAEB4B8,
    'explosive_warehouse': 0xA55A4A,
    'freight_warehouse': 0x7A756E,
    'vehicle_depot': 0xA08C4A,
}


# ------------------------------------------------------------ materials ---

def _recolor(mat, color: int, roughness: float) -> None:
    """material() reuses a same-named material, so TintBody is recoloured in place."""
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    r, g, b = hex_rgb(color)
    bsdf.inputs['Base Color'].default_value = (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    mat.diffuse_color = (r, g, b, 1.0)


def _t1_materials(btype: str, m: dict) -> dict:
    _recolor(m['body'], DULL[btype], 0.85)
    m.update({
        'plank': material('Plank', 0x9A7247, roughness=0.9),
        'plank2': material('PlankDark', 0x6B4A2C, roughness=0.9),
        'tin': material('Tin', 0x9DA6AB, roughness=0.55, metallic=0.25),
        'tin2': material('TinDark', 0x6F787E, roughness=0.6, metallic=0.25),
        'rust': material('Rust', 0x8F4B22, roughness=0.95),
        'tarp': material('Tarp', 0x2F6FB5, roughness=0.8),
        'canvas': material('Canvas', 0xD3C49E, roughness=0.95),
        'dirt': material('Dirt', 0x7A6244, roughness=1.0),
        'concrete': material('Concrete', 0x8F8F8A, roughness=0.95),
        'char': material('Char', 0x1A1817, roughness=1.0),
        'board': material('Board', 0x2F4A3B, roughness=0.9),
        'brick': material('Brick', 0xA8563A, roughness=0.9),
        'sandbag': material('Sandbag', 0xB9A57A, roughness=1.0),
        'cardboard': material('Cardboard', 0xC49A5C, roughness=0.95),
        'smoke': material('Smoke', 0xC4C8CC, roughness=1.0),
        'blue': material('Blue', 0x3B6EA8, roughness=0.7),
        'glow': material('Glow', 0xFFE9A0, roughness=0.3, emission=0xFFD24A, emission_strength=1.2),
        'spark': material('GlowSpark', 0xFFB040, roughness=0.3, emission=0xFF7A10, emission_strength=1.5),
        'spot': material('Spot', 0xCFE8FF, roughness=0.25, emission=0xCFE8FF, emission_strength=2.4),
        'mattress': material('Mattress', 0x7D8A93, roughness=0.9),
    })
    return m


# ----------------------------------------------------------- helpers ---

def _shift(ob, vec) -> None:
    """Translate the mesh data so the object origin (its pivot) lands elsewhere on it."""
    ob.data.transform(Matrix.Translation(Vector(vec)))


def _yawed(origin, yaw: float, local) -> tuple[float, float, float]:
    """World position of `local` (x, y, z) rotated by `yaw` degrees about Z around `origin`."""
    c, s = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    x, y, z = local
    return (origin[0] + x * c - y * s, origin[1] + x * s + y * c, origin[2] + z)


# Capital letters as strokes on a 3 × 5 grid, (x, y) with y up.
_V = lambda x, y0, y1: ((x, y0), (x, y1))  # noqa: E731
_H = lambda y, x0, x1: ((x0, y), (x1, y))  # noqa: E731
_FONT = {
    'A': [_V(0, 0, 4), _V(2, 0, 4), _H(4, 0, 2), _H(2, 0, 2)],
    'B': [_V(0, 0, 4), _V(2, 0, 4), _H(4, 0, 2), _H(2, 0, 2), _H(0, 0, 2)],
    'C': [_V(0, 0, 4), _H(4, 0, 2), _H(0, 0, 2)],
    'D': [_V(0, 0, 4), _H(4, 0, 1.5), _H(0, 0, 1.5), _V(2, 0.5, 3.5), ((1.5, 4), (2, 3.5)), ((1.5, 0), (2, 0.5))],
    'E': [_V(0, 0, 4), _H(4, 0, 2), _H(2, 0, 1.6), _H(0, 0, 2)],
    'F': [_V(0, 0, 4), _H(4, 0, 2), _H(2, 0, 1.6)],
    'G': [_V(0, 0, 4), _H(4, 0, 2), _H(0, 0, 2), _V(2, 0, 2), _H(2, 1, 2)],
    'H': [_V(0, 0, 4), _V(2, 0, 4), _H(2, 0, 2)],
    'I': [_V(1, 0, 4), _H(4, 0.4, 1.6), _H(0, 0.4, 1.6)],
    'K': [_V(0, 0, 4), ((0, 2), (2, 4)), ((0, 2), (2, 0))],
    'L': [_V(0, 0, 4), _H(0, 0, 2)],
    'M': [_V(0, 0, 4), _V(2, 0, 4), ((0, 4), (1, 2)), ((2, 4), (1, 2))],
    'N': [_V(0, 0, 4), _V(2, 0, 4), ((0, 4), (2, 0))],
    'O': [_V(0, 0, 4), _V(2, 0, 4), _H(4, 0, 2), _H(0, 0, 2)],
    'P': [_V(0, 0, 4), _H(4, 0, 2), _V(2, 2, 4), _H(2, 0, 2)],
    'R': [_V(0, 0, 4), _H(4, 0, 2), _V(2, 2, 4), _H(2, 0, 2), ((0.6, 2), (2, 0))],
    'S': [_H(4, 0, 2), _V(0, 2, 4), _H(2, 0, 2), _V(2, 0, 2), _H(0, 0, 2)],
    'T': [_H(4, 0, 2), _V(1, 0, 4)],
    'U': [_V(0, 0, 4), _V(2, 0, 4), _H(0, 0, 2)],
    'V': [((0, 4), (1, 0)), ((2, 4), (1, 0))],
    'W': [_V(0, 0, 4), _V(2, 0, 4), ((0, 0), (1, 2)), ((2, 0), (1, 2))],
    'X': [((0, 0), (2, 4)), ((0, 4), (2, 0))],
    'Y': [((0, 4), (1, 2)), ((2, 4), (1, 2)), _V(1, 0, 2)],
    'Z': [_H(4, 0, 2), ((2, 4), (0, 0)), _H(0, 0, 2)],
    '1': [_V(1, 0, 4), ((0.2, 3), (1, 4)), _H(0, 0.3, 1.7)],
    '2': [_H(4, 0, 2), _V(2, 2, 4), _H(2, 0, 2), _V(0, 0, 2), _H(0, 0, 2)],
    '3': [_H(4, 0, 2), _H(2, 0.5, 2), _H(0, 0, 2), _V(2, 0, 4)],
    '-': [_H(2, 0.4, 1.6)],
    '!': [_V(1, 1.4, 4), _V(1, 0, 0.3)],
    '?': [_H(4, 0, 2), _V(2, 2.5, 4), ((2, 2.5), (1, 1.6)), _V(1, 1.2, 1.6), _V(1, 0, 0.3)],
    ' ': [],
}


def text(name: str, txt: str, loc, h: float, mat, yaw: float = 0.0, depth: float = 0.03,
         weight: float = 0.24, tilt: float = 0.0) -> list:
    """Block capitals as flat stroke boxes, centred on `loc`, standing on a face whose outward normal is +Y
    rotated `yaw` degrees about Z. `tilt` leans the text back (degrees) for a sloping surface."""
    g = h / 4
    t = h * weight
    adv = 3 * g
    total = len(txt) * adv - g
    out = []
    cy, sy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    ct, st = math.cos(math.radians(tilt)), math.sin(math.radians(tilt))

    def place(u, w):
        # face coords (u along the face, w up), tilted back about the face's u axis, then yawed.
        n = -w * st  # tilt pushes the top of the text along the inward normal
        wz = w * ct
        return (loc[0] + u * cy - n * sy, loc[1] + u * sy + n * cy, loc[2] + wz)

    for i, ch in enumerate(txt):
        x0 = -total / 2 + i * adv
        for (a, b), (c, d) in _FONT.get(ch.upper(), []):
            u0, w0 = x0 + a * g, (b - 2) * g
            u1, w1 = x0 + c * g, (d - 2) * g
            du, dw = u1 - u0, w1 - w0
            ang = math.degrees(math.atan2(dw, du))
            ob = box(f'{name}.Stroke', (math.hypot(du, dw) + t, depth, t), loc=place((u0 + u1) / 2, (w0 + w1) / 2),
                     rot=(tilt, -ang, yaw))
            assign(ob, mat)
            out.append(ob)
    return out


def tin_sheet(name: str, sx: float, sy: float, loc, m, rot=(0, 0, 0), mat=None, thick: float = 0.05,
              spacing: float = 0.17) -> list:
    """Corrugated iron: a bevelled sheet plus a row of half-round ridges running along its local Y."""
    sheet = box(f'{name}.Sheet', (sx, sy, thick), loc=loc, rot=rot)
    bevel(sheet, 0.02, 2)
    assign(sheet, mat or m['tin'])
    n = max(2, int(sx / spacing))
    span = (n - 1) * spacing
    ridge = cylinder(f'{name}.Ridge', 0.035, sy * 0.97, loc=loc, axis='Y', segments=8, rot=rot)
    _shift(ridge, (-span / 2, 0, thick / 2))
    array(ridge, n, (spacing, 0, 0))
    assign(ridge, mat or m['tin'])
    return [sheet, ridge]


def plank_lines(name: str, sx: float, h: float, loc, m, yaw: float = 0.0, gap: float = 0.3,
                mat=None, depth: float = 0.02, vertical: bool = False) -> list:
    """Dark grooves on a wall face: cheap planking. Face normal +Y rotated by `yaw`; `loc` is the face centre.
    Horizontal grooves every `gap` up the face `h`, or vertical ones every `gap` across `sx`."""
    if vertical:
        n = max(1, int(sx / gap))
        line = box(f'{name}.Groove', (0.025, depth, h), loc=loc, rot=(0, 0, yaw))
        _shift(line, (-(n - 1) * gap / 2, 0, 0))
        array(line, n, (gap, 0, 0))
    else:
        n = max(1, int(h / gap))
        line = box(f'{name}.Groove', (sx, depth, 0.025), loc=loc, rot=(0, 0, yaw))
        _shift(line, (0, 0, -(n - 1) * gap / 2))
        array(line, n, (0, 0, gap))
    assign(line, mat or m['plank2'])
    return [line]


def gable_tin(name: str, ridge_len: float, half_span: float, rise: float, ridge_loc, m, along: str = 'X',
              mats=None, overhang: float = 0.12, ridge_mat=None) -> tuple[list, float, float]:
    """Two corrugated slopes hanging off a ridge beam at `ridge_loc`, ridge running along `along`.

    Returns (parts, slope length, slope angle in degrees). Rotation signs verified: +X Euler lifts +Y."""
    slope = math.hypot(half_span + overhang, rise)
    ang = math.degrees(math.atan2(rise, half_span + overhang))
    a, b = mats or (m['tin'], m['tin'])
    if along == 'X':
        specs = (((-ang, 0, 0), (0, slope / 2, -0.03), 'F', a), ((ang, 0, 0), (0, -slope / 2, -0.03), 'B', b))
        rsize = (ridge_len, 0.1, 0.1)
    else:
        specs = (((ang, 0, 90), (0, -slope / 2, -0.03), 'R', a), ((-ang, 0, 90), (0, slope / 2, -0.03), 'L', b))
        rsize = (0.1, ridge_len, 0.1)
    out = []
    for rot, shift, tag, mat in specs:
        sheet = tin_sheet(f'{name}{tag}', ridge_len, slope, ridge_loc, m, rot=rot, mat=mat)
        for ob in sheet:
            _shift(ob, shift)
        out += sheet
    ridge = box(f'{name}.Ridge', rsize, loc=ridge_loc)
    bevel(ridge, 0.03, 2)
    assign(ridge, ridge_mat or m['plank2'])
    out.append(ridge)
    return out, slope, ang


def on_slope(ridge_loc, ang: float, s: float, side: int, along: str = 'X', lift: float = 0.04):
    """World point `s` metres down a gable slope from the ridge, `lift` above its surface.
    `side` is +1 for the +Y (along X) / +X (along Y) slope, -1 for the other."""
    a = math.radians(ang)
    down = s * math.cos(a)
    z = ridge_loc[2] - s * math.sin(a) + lift * math.cos(a)
    n = lift * math.sin(a)
    if along == 'X':
        return (ridge_loc[0], ridge_loc[1] + side * (down + n), z)
    return (ridge_loc[0] + side * (down + n), ridge_loc[1], z)


def gable_attic(name: str, w: float, d: float, rise: float, loc_xy, top: float, m, along: str = 'X', mat=None):
    """Triangular prism filling the space under a gable roof, so the gable ends are solid wall."""
    if along == 'X':
        pts = [(-d / 2, 0.0), (d / 2, 0.0), (0.0, rise)]
        p = prism(f'{name}', pts, w, loc=(loc_xy[0], loc_xy[1], top), axis='X')
    else:
        pts = [(-w / 2, 0.0), (w / 2, 0.0), (0.0, rise)]
        p = prism(f'{name}', pts, d, loc=(loc_xy[0], loc_xy[1], top), axis='Y')
    bevel(p, 0.03, 2)
    assign(p, mat or m['body'])
    return p


def tyre(name: str, loc, m, r: float = 0.24, rot=None) -> list:
    t = torus(f'{name}.Tyre', r, r * 0.4, loc=loc, rot=rot, major_segments=20, minor_segments=8)
    assign(t, m['dark'])
    return [t]


def tyre_stack(name: str, loc, m, count: int = 3, r: float = 0.24, lean: float = 0.0) -> list:
    out = []
    for i in range(count):
        out += tyre(f'{name}{i}', (loc[0] + i * lean * 0.006, loc[1], loc[2] + r * 0.4 + i * r * 0.8), m, r=r,
                    rot=(0, lean * (i + 1), 0))
    return out


def brick(name: str, loc, m, yaw: float = 0.0) -> list:
    b = box(f'{name}.Brick', (0.22, 0.11, 0.08), loc=(loc[0], loc[1], loc[2] + 0.04), rot=(0, 0, yaw))
    bevel(b, 0.01, 1)
    assign(b, m['brick'])
    return [b]


def sandbag(name: str, loc, m, yaw: float = 0.0) -> list:
    s = capsule(f'{name}.Bag', 0.12, 0.2, loc=(loc[0], loc[1], loc[2] + 0.09), axis='X', segments=12, rings=6,
                rot=(0, 0, yaw))
    s.scale = (1, 1, 0.72)
    assign(s, m['sandbag'])
    return [s]


def sandbag_wall(name: str, points, m, z: float = 0.0, rows: int = 2) -> list:
    """Sandbags laid along a polyline, staggered per row."""
    out = []
    step = 0.3
    for r in range(rows):
        for (x0, y0), (x1, y1) in zip(points, points[1:]):
            length = math.hypot(x1 - x0, y1 - y0)
            yaw = math.degrees(math.atan2(y1 - y0, x1 - x0))
            n = max(1, int(length / step))
            for i in range(n):
                t = (i + 0.5 + 0.5 * (r % 2)) / n
                if t > 1.0:
                    continue
                out += sandbag(f'{name}{r}{i}', (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z + r * 0.16), m, yaw=yaw)
    return out


def dynamite(name: str, loc, m, length: float = 0.36, r: float = 0.055, rot=(0, 0, 0), lit: bool = False) -> list:
    """A red stick with a paper band and a fuse curling off its +Z end (before `rot`)."""
    stick = cylinder(f'{name}.Stick', r, length, loc=loc, segments=12, rot=rot)
    bevel(stick, r * 0.4, 2, angle=60)
    assign(stick, m['red'])
    band = cylinder(f'{name}.Band', r * 1.06, length * 0.16, loc=loc, segments=12, rot=rot)
    assign(band, m['white'])
    fuse = capsule(f'{name}.Fuse', r * 0.25, length * 0.35, loc=loc, segments=8, rings=4, rot=rot)
    _shift(fuse, (length * 0.12, 0, length / 2 + length * 0.2))
    assign(fuse, m['dark'])
    out = [stick, band, fuse]
    if lit:
        tip = sphere(f'{name}.Spark', r * 0.7, loc=loc, segments=10, rings=6)
        _shift(tip, (length * 0.2, 0, length / 2 + length * 0.42))
        tip.rotation_euler = stick.rotation_euler
        assign(tip, m['spark'])
        out.append(tip)
    return out


def swing_door(name: str, x: float, y_face: float, z0: float, m, frame_mat, width: float = 0.55,
               height: float = 1.0, facing: float = 1.0, swing: float = 0.0, hinge: int = -1,
               leaf_mat=None, lamp: bool = True) -> list:
    """Like buildings.door, but with a hollow frame (two jambs and a lintel) so the leaf can hang open by
    `swing` degrees around the `hinge` (-1 left, +1 right) edge and still read as a door."""
    out = []
    fd = 0.08
    for jx in (-1, 1):
        jamb = box(f'{name}.Jamb', (0.07, fd, height + 0.08), loc=(x + jx * (width / 2 + 0.03), y_face + facing * 0.03, z0 + height / 2))
        bevel(jamb, 0.015, 2)
        assign(jamb, frame_mat)
        out.append(jamb)
    lintel = box(f'{name}.Lintel', (width + 0.13, fd, 0.07), loc=(x, y_face + facing * 0.03, z0 + height + 0.045))
    bevel(lintel, 0.015, 2)
    assign(lintel, frame_mat)
    out.append(lintel)
    hx = x + hinge * width / 2
    leaf = box(f'{name}.Leaf', (width, 0.06, height), loc=(hx, y_face + facing * 0.05, z0 + height / 2))
    _shift(leaf, (-hinge * width / 2, 0, 0))
    bevel(leaf, 0.015, 2)
    rz = -hinge * facing * swing
    leaf.rotation_euler = (0, 0, math.radians(rz))
    assign(leaf, leaf_mat or m['door'])
    knob = sphere(f'{name}.Knob', 0.03, loc=_yawed((hx, y_face + facing * 0.05, z0 + height * 0.5), rz,
                                                    (-hinge * (width - 0.1), facing * 0.045, 0)), segments=10, rings=5)
    assign(knob, m['chrome'])
    out += [leaf, knob]
    if lamp:
        lp = box(f'{name}.Lamp', (0.14, 0.08, 0.08), loc=(x, y_face + facing * 0.06, z0 + height + 0.16))
        bevel(lp, 0.02, 2)
        assign(lp, m['lamp'])
        out.append(lp)
    return out


def wreck_car(name: str, loc, m, yaw: float = 0.0, body_mat=None, missing=(1, 1), hood: float = 0.0,
              bricks: bool = True, wheels: bool = True) -> list:
    """A dented compact car, local +X forward. `missing` = (x sign, y sign) of the wheel that is gone; the body
    sags onto a brick stack at that corner. `wheels=False` leaves it on four brick stacks instead."""
    out = []
    L, W = 1.5, 0.76
    wr = 0.17
    zb = 0.2 if wheels else 0.16
    # Sag toward the missing wheel: a small roll and pitch of every body part.
    mxs, mys = (missing if wheels else (0, 0))
    roll, pitch = -6.0 * mys, 5.0 * mxs

    def P(local):
        # Part centres follow the sag: roll drops the +Y side, pitch drops the +X side, then yaw.
        x, y, z = local
        return _yawed(loc, yaw, (x, y, z + y * math.sin(math.radians(roll)) - x * math.sin(math.radians(pitch))))

    def R(extra=(0, 0, 0)):
        return (roll + extra[0], pitch + extra[1], yaw + extra[2])

    paint = body_mat or m['blue']
    body = box(f'{name}.Body', (L, W, 0.36), loc=P((0, 0, zb + 0.18)), rot=R())
    bevel(body, 0.09, 3)
    assign(body, paint)
    cabin = box(f'{name}.Cabin', (0.7, W - 0.1, 0.34), loc=P((-0.15, 0, zb + 0.36 + 0.15)), rot=R())
    bevel(cabin, 0.08, 3)
    assign(cabin, paint)
    # Windscreen with a crack, side glass.
    ws = box(f'{name}.Screen', (0.05, W - 0.22, 0.24), loc=P((0.2, 0, zb + 0.36 + 0.15)), rot=R())
    assign(ws, m['glass'])
    crack = box(f'{name}.Crack', (0.02, 0.025, 0.22), loc=P((0.235, 0.05, zb + 0.36 + 0.15)), rot=R((12, 0, 0)))
    assign(crack, m['white'])
    crack2 = box(f'{name}.Crack', (0.02, 0.16, 0.025), loc=P((0.235, 0.1, zb + 0.36 + 0.19)), rot=R((0, 0, 20)))
    assign(crack2, m['white'])
    for side in (-1, 1):
        sg = box(f'{name}.SideGlass', (0.5, 0.04, 0.2), loc=P((-0.15, side * (W / 2 - 0.05), zb + 0.36 + 0.16)), rot=R())
        assign(sg, m['glass'])
        out.append(sg)
    # Crumpled bumper: bent off-axis. Dent in the door.
    bumper = box(f'{name}.Bumper', (0.1, W + 0.06, 0.09), loc=P((L / 2 + 0.02, 0.06, zb + 0.08)), rot=R((0, 0, 14)))
    bevel(bumper, 0.02, 2)
    assign(bumper, m['steel'])
    dent = sphere(f'{name}.Dent', 0.16, loc=P((0.1, -W / 2 - 0.02, zb + 0.16)), scale=(1, 0.35, 0.8), segments=12, rings=6)
    dent.rotation_euler = tuple(math.radians(a) for a in R())
    assign(dent, m['dark'])
    out += [body, cabin, ws, crack, crack2, bumper, dent]
    # Hood hinged at its rear edge; engine block underneath when open.
    if hood > 0:
        hd = box(f'{name}.Hood', (0.55, W - 0.12, 0.05), loc=P((0.2, 0, zb + 0.36 + 0.03)), rot=R((0, -hood, 0)))
        _shift(hd, (0.28, 0, 0))
        bevel(hd, 0.015, 2)
        assign(hd, paint)
        eng = box(f'{name}.Engine', (0.4, 0.4, 0.2), loc=P((0.42, 0, zb + 0.36 - 0.06)), rot=R())
        bevel(eng, 0.03, 2)
        assign(eng, m['dark'])
        out += [hd, eng]
    for sx_ in (-1, 1):
        for sy_ in (-1, 1):
            wx, wy = sx_ * 0.5, sy_ * (W / 2 + 0.02)
            gone = (sx_, sy_) == tuple(missing) or not wheels
            if gone:
                if bricks:
                    out += brick(f'{name}.Prop', _yawed(loc, yaw, (wx, sy_ * (W / 2 - 0.12), 0)), m, yaw=yaw + 8)
                    out += brick(f'{name}.Prop2', _yawed(loc, yaw, (wx, sy_ * (W / 2 - 0.12), 0.08)), m, yaw=yaw - 6)
                continue
            out += tyre(f'{name}.Wheel{sx_}{sy_}', _yawed(loc, yaw, (wx, wy, wr)), m, r=wr * 0.72, rot=(90, 0, yaw))
            hub = cylinder(f'{name}.Hub', wr * 0.35, 0.09, loc=_yawed(loc, yaw, (wx, wy, wr)), axis='Y', segments=10,
                           rot=(0, 0, yaw))
            assign(hub, m['chrome'])
            out.append(hub)
    return out


def cone_down(name: str, loc, m, yaw: float = 0.0) -> list:
    """A traffic cone knocked over on its side, tip pointing along local +X."""
    c = cylinder(f'{name}.Cone', 0.15, 0.4, loc=_yawed(loc, yaw, (0.12, 0, 0.15)), axis='X', segments=14,
                 radius2=0.04, rot=(0, 0, yaw))
    assign(c, m['cone'])
    base = box(f'{name}.Base', (0.04, 0.32, 0.32), loc=_yawed(loc, yaw, (-0.1, 0, 0.16)), rot=(0, 0, yaw))
    assign(base, m['dark'])
    band = cylinder(f'{name}.Band', 0.115, 0.08, loc=_yawed(loc, yaw, (0.18, 0, 0.15)), axis='X', segments=14,
                    radius2=0.09, rot=(0, 0, yaw))
    assign(band, m['white'])
    return [c, base, band]


def striped_bar(name: str, length: float, loc, m, rot=(0, 0, 0), r: float = 0.045, mats=None) -> list:
    """A red/white striped pole along local X."""
    a, b = mats or (m['red'], m['white'])
    n = max(2, int(length / 0.2))
    seg = length / n
    out = []
    for i in range(n):
        s = cylinder(f'{name}.Seg', r, seg + 0.002, loc=loc, axis='X', segments=10, rot=rot)
        _shift(s, (-length / 2 + seg * (i + 0.5), 0, 0))
        assign(s, a if i % 2 == 0 else b)
        out.append(s)
    return out


def rock(name: str, loc, r: float, m, seed: int = 0, mat=None) -> list:
    rnd = random.Random(seed)
    k = icosphere(f'{name}.Rock', r, loc=loc, subdivisions=1,
                  scale=(rnd.uniform(0.8, 1.3), rnd.uniform(0.8, 1.2), rnd.uniform(0.6, 0.9)))
    rotate(k, rnd.uniform(0, 60), rnd.uniform(0, 60), rnd.uniform(0, 180))
    assign(k, mat or m['rock'])
    return [k]


def smoke_puffs(name: str, loc, m, count: int = 3, r0: float = 0.09) -> list:
    out = []
    rnd = random.Random(3)
    for i in range(count):
        r = r0 * (1 + 0.45 * i)
        p = sphere(f'{name}{i}', r, loc=(loc[0] + rnd.uniform(-0.05, 0.05) + 0.06 * i, loc[1] + rnd.uniform(-0.04, 0.04),
                                       loc[2] + 0.08 + sum(r0 * (1 + 0.45 * j) * 1.5 for j in range(i))), segments=14, rings=8)
        assign(p, m['smoke'])
        out.append(p)
    return out


def dirt_lot(sx: float, sz: float, m, h: float = 0.08, mat=None) -> list:
    """A packed-earth slab in place of the tier-2 plinth."""
    p = box('Lot', (sx + 0.06, sz + 0.06, h), loc=(0, 0, h / 2))
    bevel(p, 0.035, 2)
    assign(p, mat or m['dirt'])
    return [p]


# ----------------------------------------------------------- builders ---

def build_driving_center(sx, sz, ex, xx, m):
    """Learner's Lot: dirt, a plywood booth with an L plate, a wreck on a brick, cones, tyres, a wobbly barrier."""
    parts = dirt_lot(sx, sz, m)
    # Booth at the back-left: plywood walls, corrugated lean-to roof, service hatch, hand-painted L plate.
    bx, by = -0.5, -0.45
    bw, bd, bh = 0.95, 0.85, 1.6
    booth = B.block('Booth', bw, bd, bh, 0.08, m, radius=0.05, loc_xy=(bx, by))
    parts.append(booth)
    parts += plank_lines('Booth.F', bw - 0.06, bh - 0.25, (bx, by + bd / 2 + 0.005, 0.08 + bh / 2), m, gap=0.32)
    parts += plank_lines('Booth.R', bd - 0.06, bh - 0.25, (bx + bw / 2 + 0.005, by, 0.08 + bh / 2), m, yaw=90, gap=0.32)
    parts += plank_lines('Booth.L', bd - 0.06, bh - 0.25, (bx - bw / 2 - 0.005, by, 0.08 + bh / 2), m, yaw=-90, gap=0.32)
    hatch = box('Booth.Hatch', (0.5, 0.05, 0.36), loc=(bx, by + bd / 2 + 0.02, 0.08 + 1.1))
    assign(hatch, m['dark'])
    counter = box('Booth.Counter', (0.62, 0.16, 0.05), loc=(bx, by + bd / 2 + 0.08, 0.08 + 0.9))
    bevel(counter, 0.015, 2)
    assign(counter, m['plank'])
    parts += [hatch, counter]
    parts += tin_sheet('Booth.Roof', bw + 0.35, bd + 0.35, (bx + 0.05, by, 0.08 + bh + 0.08), m, rot=(6, -10, 0))
    # L plate on the front of the booth.
    plate = box('Plate', (0.34, 0.04, 0.4), loc=(bx + 0.02, by + bd / 2 + 0.035, 0.08 + 0.42), rot=(0, 0, 0))
    plate.rotation_euler = (0, math.radians(-7), 0)
    bevel(plate, 0.01, 2)
    assign(plate, m['white'])
    parts.append(plate)
    parts += text('Plate.L', 'L', (bx + 0.02, by + bd / 2 + 0.065, 0.08 + 0.42), 0.28, m['red'], weight=0.3)
    # Front gate line: plank rail with the two doors set in it.
    yf = sz / 2 - 0.12
    rail = box('Rail', (sx - 0.1, 0.06, 0.07), loc=(0, yf, 0.55))
    assign(rail, m['plank'])
    rail2 = box('Rail.Low', (sx - 0.1, 0.06, 0.07), loc=(0, yf, 0.28))
    assign(rail2, m['plank'])
    parts += [rail, rail2]
    for px in (-sx / 2 + 0.08, 0, sx / 2 - 0.08):
        post = box('Rail.Post', (0.08, 0.08, 0.72), loc=(px, yf, 0.08 + 0.36))
        assign(post, m['plank2'])
        parts.append(post)
    parts += swing_door('Entry', ex, yf, 0.08, m, m['entry'], swing=0, hinge=-1)
    parts += swing_door('Exit', xx, yf, 0.08, m, m['exit'], swing=35, hinge=1)
    # The wreck: nose toward the front-right, one wheel gone, up on bricks, radiator steaming.
    cyaw = -32
    car = (0.42, -0.05, 0.08)
    parts += wreck_car('Wreck', car, m, yaw=cyaw, missing=(-1, 1), hood=0.0)
    parts += smoke_puffs('Steam', _yawed(car, cyaw, (0.62, 0.1, 0.5)), m, count=3, r0=0.06)
    lp = box('Wreck.LPlate', (0.04, 0.16, 0.16), loc=_yawed(car, cyaw, (-0.77, 0.12, 0.34)), rot=(0, 0, cyaw))
    assign(lp, m['white'])
    parts.append(lp)
    parts += text('Wreck.L', 'L', _yawed(car, cyaw, (-0.8, 0.12, 0.34)), 0.11, m['red'], yaw=cyaw + 90, weight=0.3)
    # Skid marks swerving in behind it, from the gate to the crash.
    for i, (back, side, extra) in enumerate(((-0.95, 0.3, 0), (-0.95, -0.3, 0), (-1.35, 0.5, -30), (-1.35, -0.05, -30))):
        sk = box(f'Skid{i}', (0.45, 0.07, 0.012), loc=_yawed(car, cyaw, (back, side, 0.006)), rot=(0, 0, cyaw + extra))
        assign(sk, m['plank2'])
        parts.append(sk)
    # Knocked-over cones and one still standing.
    parts += cone_down('Cone1', (-0.75, 0.25, 0.08), m, yaw=150)
    parts += cone_down('Cone2', (-0.35, 0.5, 0.08), m, yaw=40)
    parts += B.cone_prop('Cone3', (sx / 2 + 0.35, sz / 2 - 0.2, 0), m)
    parts += tyre_stack('Tyres', (sx / 2 + 0.3, -sz / 2 + 0.35, 0), m, count=3, lean=4)
    parts += tyre('Tyre.Loose', (-sx / 2 - 0.25, -0.3, 0.1), m, r=0.24, rot=(0, 0, 0))
    # Wobbly striped barrier, one leg shorter than the other.
    bxx, byy = -sx / 2 - 0.3, sz / 2 - 0.55
    parts += striped_bar('Barrier', 1.1, (bxx, byy, 0.68), m, rot=(0, -9, 100))
    for i, (yy, hh) in enumerate(((byy + 0.5, 0.75), (byy - 0.5, 0.58))):
        for dx in (-0.08, 0.08):
            leg = cylinder(f'Barrier.Leg{i}', 0.035, hh, loc=(bxx + dx, yy, 0.08 + hh / 2), segments=8,
                           rot=(0, 10 if dx > 0 else -10, 0))
            assign(leg, m['steel'])
            parts.append(leg)
    pivot('Body', (0, 0, 0), parts)


def build_blasting_academy(sx, sz, ex, xx, m):
    """Boom Shack: a plank shack, back roof panel blown up on its hinge, scorched window, dynamite bench, KA-BOOM board."""
    parts = dirt_lot(sx, sz, m)
    w, d, h = 1.8, 1.4, 1.35
    cy = -0.2
    yf = cy + d / 2
    z0 = 0.08
    parts.append(B.block('Walls', w, d, h, z0, m, radius=0.06, loc_xy=(0, cy)))
    top = z0 + h
    for face, (px, py, yaw, length) in {'F': (0, yf, 0, w), 'B': (0, cy - d / 2, 180, w),
                                         'L': (-w / 2, cy, -90, d), 'R': (w / 2, cy, 90, d)}.items():
        parts += plank_lines(f'Planks{face}', length - 0.08, h - 0.3, (px, py, z0 + h / 2 - 0.05), m, yaw=yaw, gap=0.27)
    # Doors: entry sound, exit hanging open.
    parts += swing_door('Entry', ex, yf, z0, m, m['entry'])
    parts += swing_door('Exit', xx, yf, z0, m, m['exit'], swing=40, hinge=1)
    # Roof: ridge along X. Front slope in place, back slope blown up on its ridge hinge, corner charred.
    rise = 0.36
    half = d / 2 + 0.12
    slope = math.hypot(half, rise)
    ang = math.degrees(math.atan2(rise, half))
    ridge = box('Ridge', (w + 0.3, 0.1, 0.1), loc=(0, cy, top + rise))
    bevel(ridge, 0.03, 2)
    assign(ridge, m['plank2'])
    parts.append(ridge)
    front = tin_sheet('RoofF', w + 0.3, slope, (0, cy, top + rise), m, rot=(-ang, 0, 0), mat=m['tin'])
    for ob in front:
        _shift(ob, (0, slope / 2, -0.03))
    parts += front
    blown = 58
    back = tin_sheet('RoofB', w + 0.3, slope, (0, cy, top + rise), m, rot=(-(ang + blown), 0, 0), mat=m['tin2'])
    for ob in back:
        _shift(ob, (0, -slope / 2, -0.03))
    parts += back
    charred = box('RoofB.Char', (0.55, 0.42, 0.075), loc=(0, cy, top + rise), rot=(-(ang + blown), 0, 0))
    _shift(charred, (w / 2 - 0.12, -slope + 0.18, -0.03))
    assign(charred, m['char'])
    parts.append(charred)
    # The hole where the back panel was: dark interior inside the wall line, two snapped rafters across it,
    # a jagged scorch hanging down the top of the back wall.
    hole = box('Hole', (w - 0.3, d / 2 - 0.2, 0.05), loc=(0, cy - d / 4 - 0.02, top - 0.03))
    assign(hole, m['char'])
    parts.append(hole)
    for i, (xx_, yaw_, tilt_) in enumerate(((-0.4, 20, 18), (0.35, -35, -12))):
        raf = box(f'Rafter{i}', (0.07, 0.75, 0.06), loc=(xx_, cy - d / 4, top + 0.12), rot=(tilt_, 0, yaw_))
        assign(raf, m['plank2'])
        parts.append(raf)
    for i, (xx_, ww) in enumerate(((-0.55, 0.3), (-0.1, 0.42), (0.4, 0.26))):
        sc = box(f'WallChar{i}', (ww, 0.04, 0.18 + 0.06 * i), loc=(xx_, cy - d / 2 - 0.005, top - 0.08))
        assign(sc, m['char'])
        parts.append(sc)
    # Blown-out window on the left face: dark opening, askew frame slats, black scorch rays.
    wx, wz = -w / 2, z0 + 0.92
    opening = box('Window', (0.05, 0.4, 0.36), loc=(wx - 0.01, cy + 0.1, wz))
    assign(opening, m['char'])
    parts.append(opening)
    for k, (dy, dz, tilt) in enumerate(((0.26, 0.05, 20), (-0.24, -0.04, -15))):
        slat = box(f'Window.Slat{k}', (0.04, 0.08, 0.46), loc=(wx - 0.035, cy + 0.1 + dy, wz + dz), rot=(tilt, 0, 0))
        assign(slat, m['plank'])
        parts.append(slat)
    for k in range(8):
        a = k * 360 / 8 + 12
        ray = box(f'Scorch{k}', (0.03, 0.4 + 0.08 * (k % 2), 0.11), loc=(wx - 0.02, cy + 0.1, wz), rot=(a, 0, 0))
        _shift(ray, (0, 0.36, 0))
        assign(ray, m['char'])
        parts.append(ray)
    # Dynamite crate bench right of the exit, sticks lying on it.
    bench = (sx / 2 + 0.15, sz / 2 - 0.25, 0.08)
    parts += B.crate('Bench', bench, 0.44, m, rot_z=-8)
    for k, (dx, dy) in enumerate(((-0.1, -0.08), (0.02, 0.06), (0.14, -0.02))):
        parts += dynamite(f'BenchStick{k}', (bench[0] + dx, bench[1] + dy, bench[2] + 0.44 + 0.055), m, length=0.34,
                          rot=(90, 0, 15 + 10 * k))
    # Bucket of fuses at the left wall.
    bk = (-sx / 2 - 0.35, 0.15, 0.08)
    bucket = cylinder('Bucket', 0.15, 0.28, loc=(bk[0], bk[1], bk[2] + 0.14), segments=14, radius2=0.12)
    bevel(bucket, 0.02, 2, angle=60)
    assign(bucket, m['steel'])
    parts.append(bucket)
    for k in range(4):
        loop = torus(f'Fuse{k}', 0.1, 0.014, loc=(bk[0] + 0.04 * (k % 2), bk[1] + 0.03 * (k - 1.5), bk[2] + 0.34 + 0.03 * k),
                     rot=(70 + 15 * k, 0, 30 * k), major_segments=14, minor_segments=5)
        assign(loop, m['dark'])
        parts.append(loop)
    # Bent stovepipe through the front slope, smoke on top — on the left so the door view sees it.
    px, py = -0.5, cy + 0.3
    pz = top + rise - (py - cy) * rise / half
    pipe = cylinder('Pipe', 0.07, 0.5, loc=(px, py, pz + 0.15), segments=12)
    assign(pipe, m['dark'])
    elbow = sphere('Pipe.Elbow', 0.075, loc=(px, py, pz + 0.4), segments=12, rings=8)
    assign(elbow, m['dark'])
    bent = cylinder('Pipe.Bent', 0.07, 0.3, loc=(px, py, pz + 0.4), segments=12, rot=(0, -40, 0))
    _shift(bent, (0, 0, 0.15))
    assign(bent, m['dark'])
    parts += [pipe, elbow, bent]
    parts += smoke_puffs('Smoke', (px - 0.22, py, pz + 0.56), m, count=3, r0=0.06)
    # Chalkboard leaning on the left wall.
    bx, by, bz = -w / 2 - 0.13, cy - 0.35, z0
    lean = 14
    frame = box('Board.Frame', (0.05, 1.04, 0.72), loc=(bx, by, bz + 0.39), rot=(0, lean, 0))
    bevel(frame, 0.015, 2)
    assign(frame, m['plank'])
    face = box('Board.Face', (0.03, 0.96, 0.64), loc=(bx - 0.03, by, bz + 0.39), rot=(0, lean, 0))
    assign(face, m['board'])
    parts += [frame, face]
    parts += text('Board.Text', 'KA-BOOM', (bx - 0.05 + 0.03, by, bz + 0.52), 0.2, m['white'], yaw=-90, tilt=lean, weight=0.26)
    parts += text('Board.Text2', '= FUN', (bx - 0.05 - 0.02, by + 0.05, bz + 0.25), 0.15, m['white'], yaw=-90, tilt=lean, weight=0.26)
    # Debris shards on the ground.
    rnd = random.Random(7)
    for k in range(5):
        sh = box(f'Shard{k}', (rnd.uniform(0.1, 0.22), rnd.uniform(0.06, 0.12), 0.03),
                 loc=(rnd.uniform(-1.1, -0.5), rnd.uniform(-0.9, 0.9), 0.095), rot=(0, 0, rnd.uniform(0, 180)))
        assign(sh, m['char'] if k % 2 else m['plank2'])
        parts.append(sh)
    pivot('Body', (0, 0, 0), parts)


def build_management_office(sx, sz, ex, xx, m):
    """The Cupboard: an oversized wardrobe on a rug; exit door ajar on shelves of paperwork, MANAGER sign taped on."""
    parts = []
    w, d, h = 1.8, 0.9, 2.0
    cy = -0.35
    yf = cy + d / 2
    z0 = 0.12
    # Rug, feet, carcass, cornice.
    rug = box('Rug', (1.7, 1.15, 0.03), loc=(0.05, 0.25, 0.015), rot=(0, 0, -6))
    bevel(rug, 0.01, 1)
    assign(rug, m['roof_red'])
    parts.append(rug)
    for fx in (-1, 1):
        for fy in (-1, 1):
            foot = sphere('Foot', 0.08, loc=(fx * (w / 2 - 0.12), cy + fy * (d / 2 - 0.12), 0.07), segments=12, rings=8)
            foot.scale = (1, 1, 0.9)
            assign(foot, m['plank2'])
            parts.append(foot)
    parts.append(B.block('Carcass', w, d, h, z0, m, radius=0.05, loc_xy=(0, cy)))
    top = z0 + h
    cornice = box('Cornice', (w + 0.16, d + 0.14, 0.1), loc=(0, cy, top + 0.05))
    bevel(cornice, 0.03, 2)
    assign(cornice, m['plank2'])
    parts.append(cornice)
    crown = box('Crown', (w + 0.06, d + 0.04, 0.06), loc=(0, cy, top + 0.13))
    bevel(crown, 0.02, 2)
    assign(crown, m['plank2'])
    parts.append(crown)
    plinth_ = box('Skirt', (w + 0.1, d + 0.1, 0.12), loc=(0, cy, z0 + 0.06))
    bevel(plinth_, 0.02, 2)
    assign(plinth_, m['plank2'])
    parts.append(plinth_)
    # Plywood back and sides: two battens across each, so the rear is not a blank slab.
    for k, zz in enumerate((z0 + 0.6, z0 + 1.45)):
        bat = box(f'BattenB{k}', (w - 0.1, 0.05, 0.1), loc=(0, cy - d / 2 - 0.02, zz))
        assign(bat, m['plank2'])
        parts.append(bat)
        for sxn in (-1, 1):
            bat = box(f'BattenS{k}', (0.05, d - 0.1, 0.1), loc=(sxn * (w / 2 + 0.02), cy, zz))
            assign(bat, m['plank2'])
            parts.append(bat)
    parts += plank_lines('BackPly', w - 0.2, h - 0.4, (0, cy - d / 2 - 0.005, z0 + h / 2), m, yaw=180, gap=0.45, vertical=True)
    # Doors: full-height cupboard doors with the entry/exit frames. Panel mouldings on both.
    dh, dw = 1.62, 0.66
    parts += swing_door('Entry', ex, yf, z0 + 0.14, m, m['entry'], width=dw, height=dh)
    parts += swing_door('Exit', xx, yf, z0 + 0.14, m, m['exit'], width=dw, height=dh, swing=62, hinge=1)
    for k in range(2):
        mould = box(f'Entry.Panel{k}', (dw - 0.16, 0.02, 0.5), loc=(ex, yf + 0.09, z0 + 0.14 + 0.42 + 0.72 * k))
        assign(mould, m['plank2'])
        parts.append(mould)
        inner = box(f'Entry.PanelIn{k}', (dw - 0.24, 0.02, 0.42), loc=(ex, yf + 0.095, z0 + 0.14 + 0.42 + 0.72 * k))
        assign(inner, m['door'])
        parts.append(inner)
    # Interior behind the open door: dark cavity, three shelves with paper stacks and folders.
    cav = box('Cavity', (dw + 0.04, 0.03, dh), loc=(xx, yf + 0.01, z0 + 0.14 + dh / 2))
    assign(cav, m['char'])
    parts.append(cav)
    rnd = random.Random(21)
    for k in range(3):
        sz_ = z0 + 0.14 + 0.16 + 0.5 * k
        shelf = box(f'Shelf{k}', (dw - 0.02, 0.26, 0.03), loc=(xx, yf + 0.14, sz_))
        assign(shelf, m['plank'])
        parts.append(shelf)
        n = 2 + k % 2
        for i in range(n):
            px = xx - 0.2 + i * 0.2
            stack_h = rnd.uniform(0.08, 0.22)
            st = box(f'Paper{k}{i}', (0.16, 0.2, stack_h), loc=(px, yf + 0.14, sz_ + 0.015 + stack_h / 2),
                     rot=(0, 0, rnd.uniform(-12, 12)))
            assign(st, m['white'])
            parts.append(st)
            if i == 1:
                fold = box(f'Folder{k}', (0.17, 0.21, 0.03), loc=(px, yf + 0.14, sz_ + 0.03 + stack_h),
                           rot=(0, 0, rnd.uniform(-15, 15)))
                assign(fold, m['red'] if k % 2 else m['blue'])
                parts.append(fold)
    # Paper falling out of the bottom shelf.
    for i in range(3):
        sheet = box(f'Loose{i}', (0.18, 0.22, 0.01), loc=(xx + 0.3 + 0.12 * i, yf + 0.45 + 0.1 * i, 0.005 + 0.01 * i),
                    rot=(0, 0, 20 * i - 15))
        assign(sheet, m['white'])
        parts.append(sheet)
    # MANAGER sign taped on the entry door.
    sign = box('Sign', (0.42, 0.015, 0.2), loc=(ex, yf + 0.1, z0 + 0.14 + 1.22), rot=(0, 3, 0))
    assign(sign, m['white'])
    parts.append(sign)
    parts += text('Sign.Text', 'MANAGER', (ex, yf + 0.12, z0 + 0.14 + 1.22), 0.09, m['dark'], weight=0.22)
    for k, tx in enumerate((-0.17, 0.17)):
        tape = box(f'Tape{k}', (0.1, 0.01, 0.04), loc=(ex + tx, yf + 0.115, z0 + 0.14 + 1.31), rot=(0, 0, 0))
        tape.rotation_euler = (0, math.radians(35 if k else -40), 0)
        assign(tape, m['sandbag'])
        parts.append(tape)
    # Desk lamp clamped to the cornice, craning out over the exit door.
    lx, ly = 0.55, yf - 0.15
    clamp = box('Lamp.Clamp', (0.12, 0.16, 0.14), loc=(lx, ly, top + 0.19))
    bevel(clamp, 0.02, 2)
    assign(clamp, m['dark'])
    parts.append(clamp)
    arm1 = cylinder('Lamp.Arm1', 0.022, 0.42, loc=(lx, ly, top + 0.26), segments=8, rot=(-48, 0, 0))
    _shift(arm1, (0, 0, 0.21))
    assign(arm1, m['steel'])
    parts.append(arm1)
    e1 = (lx, ly + 0.42 * math.sin(math.radians(48)), top + 0.26 + 0.42 * math.cos(math.radians(48)))
    joint = sphere('Lamp.Joint', 0.035, loc=e1, segments=10, rings=6)
    assign(joint, m['dark'])
    parts.append(joint)
    arm2 = cylinder('Lamp.Arm2', 0.022, 0.32, loc=e1, segments=8, rot=(-115, 0, 0))
    _shift(arm2, (0, 0, 0.16))
    assign(arm2, m['steel'])
    parts.append(arm2)
    e2 = (lx, ly + 0.32 * math.sin(math.radians(115)) + e1[1] - ly, e1[2] + 0.32 * math.cos(math.radians(115)))
    shade = cylinder('Lamp.Shade', 0.06, 0.2, loc=e2, segments=14, radius2=0.14, rot=(-135, 0, 0))
    _shift(shade, (0, 0, 0.1))
    assign(shade, m['red'])
    parts.append(shade)
    bulb = sphere('Lamp.Bulb', 0.06, loc=(e2[0], e2[1] + 0.16, e2[2] - 0.16), segments=12, rings=8)
    assign(bulb, m['glow'])
    parts.append(bulb)
    # Coffee mug on top, with a ring stain.
    mx, my = -0.6, cy - 0.05
    mug = cylinder('Mug', 0.09, 0.15, loc=(mx, my, top + 0.16 + 0.075), segments=16)
    bevel(mug, 0.015, 2, angle=60)
    assign(mug, m['white'])
    coffee = cylinder('Mug.Coffee', 0.075, 0.01, loc=(mx, my, top + 0.16 + 0.15), segments=16)
    assign(coffee, m['plank2'])
    handle = torus('Mug.Handle', 0.055, 0.016, loc=(mx + 0.11, my, top + 0.16 + 0.075), rot=(90, 0, 90),
                   major_segments=14, minor_segments=6)
    assign(handle, m['white'])
    stain = torus('Mug.Stain', 0.09, 0.008, loc=(mx + 0.22, my + 0.12, top + 0.16), major_segments=16, minor_segments=4)
    assign(stain, m['plank2'])
    parts += [mug, coffee, handle, stain]
    parts += smoke_puffs('Mug.Steam', (mx, my, top + 0.3), m, count=2, r0=0.035)
    # Filing cabinet on the right, one drawer hanging out.
    fx, fy = sx / 2 + 0.28, cy + 0.05
    cab = box('Cabinet', (0.46, 0.56, 1.15), loc=(fx, fy, 0.575))
    bevel(cab, 0.03, 2)
    assign(cab, m['steel'])
    parts.append(cab)
    for k in range(3):
        zc = 0.22 + 0.36 * k
        if k == 1:
            drawer = box('Cabinet.Drawer', (0.4, 0.5, 0.3), loc=(fx, fy + 0.34, zc))
            bevel(drawer, 0.02, 2)
            assign(drawer, m['steel'])
            parts.append(drawer)
            files = box('Cabinet.Files', (0.34, 0.4, 0.14), loc=(fx, fy + 0.34, zc + 0.2))
            assign(files, m['white'])
            parts.append(files)
            tab = box('Cabinet.Tab', (0.12, 0.02, 0.05), loc=(fx - 0.05, fy + 0.3, zc + 0.29))
            assign(tab, m['red'])
            parts.append(tab)
            front_y = fy + 0.6
        else:
            front_y = fy + 0.29
        front = box(f'Cabinet.Front{k}', (0.42, 0.03, 0.3), loc=(fx, front_y, zc))
        bevel(front, 0.015, 2)
        assign(front, m['tin2'])
        parts.append(front)
        hdl = box(f'Cabinet.Handle{k}', (0.14, 0.03, 0.03), loc=(fx, front_y + 0.025, zc + 0.05))
        assign(hdl, m['chrome'])
        parts.append(hdl)
    # Rotary phone on a stool at the left.
    px, py = -sx / 2 - 0.3, 0.35
    seat = cylinder('Stool.Seat', 0.19, 0.04, loc=(px, py, 0.5), segments=16)
    bevel(seat, 0.01, 2, angle=60)
    assign(seat, m['plank'])
    parts.append(seat)
    for k in range(3):
        a = math.radians(90 + 120 * k)
        leg = cylinder(f'Stool.Leg{k}', 0.025, 0.5, loc=(px + 0.13 * math.cos(a), py + 0.13 * math.sin(a), 0.25),
                       segments=8, rot=(-12 * math.sin(a), 12 * math.cos(a), 0))
        assign(leg, m['plank2'])
        parts.append(leg)
    phone = box('Phone', (0.24, 0.22, 0.1), loc=(px, py, 0.57))
    bevel(phone, 0.03, 3)
    assign(phone, m['dark'])
    parts.append(phone)
    dial = torus('Phone.Dial', 0.055, 0.018, loc=(px, py + 0.04, 0.625), rot=(35, 0, 0), major_segments=16, minor_segments=6)
    assign(dial, m['white'])
    parts.append(dial)
    hs = capsule('Phone.Handset', 0.03, 0.18, loc=(px, py - 0.03, 0.66), axis='X', segments=10, rings=5)
    assign(hs, m['dark'])
    parts.append(hs)
    for k in (-1, 1):
        cup = sphere(f'Phone.Cup{k}', 0.04, loc=(px + k * 0.12, py - 0.03, 0.65), segments=10, rings=6)
        assign(cup, m['dark'])
        parts.append(cup)
    for k in range(4):
        coil = torus(f'Phone.Cord{k}', 0.03, 0.008, loc=(px + 0.13, py - 0.1 - 0.05 * k, 0.56 - 0.02 * k), rot=(90, 0, 15 * k),
                     major_segments=10, minor_segments=4)
        assign(coil, m['dark'])
        parts.append(coil)
    pivot('Body', (0, 0, 0), parts)


def build_geology_lab(sx, sz, ex, xx, m):
    """Rock Shed: a garden shed on gravel, rock shelf on the wall, a giant magnifying glass leaning on it,
    wheelbarrow of rocks, patched tin roof with a hole, ROCKS sign in the gable."""
    parts = dirt_lot(sx, sz, m, mat=m['rubble'])
    w, d, h = 1.8, 1.3, 1.3
    cy = -0.25
    yf = cy + d / 2
    z0 = 0.08
    parts.append(B.block('Walls', w, d, h, z0, m, radius=0.05, loc_xy=(0, cy)))
    top = z0 + h
    for face, (px, py, yaw, length) in {'F': (0, yf, 0, w), 'B': (0, cy - d / 2, 180, w),
                                         'L': (-w / 2, cy, -90, d), 'R': (w / 2, cy, 90, d)}.items():
        parts += plank_lines(f'Planks{face}', length - 0.1, h - 0.16, (px, py, z0 + h / 2), m, yaw=yaw, gap=0.22,
                             vertical=True)
    rise = 0.5
    parts.append(gable_attic('Attic', w, d, rise, (0, cy), top, m, along='Y'))
    ridge = (0, cy, top + rise)
    roof, slope, ang = gable_tin('Roof', d + 0.3, w / 2, rise, ridge, m, along='Y', mats=(m['tin'], m['tin2']))
    parts += roof
    # Patch on the visible (-X) slope, ragged hole on the other.
    patch = box('Patch', (0.42, 0.36, 0.045), loc=on_slope(ridge, ang, slope * 0.55, -1, along='Y', lift=0.06), rot=(-ang, 0, 90))
    assign(patch, m['plank'])
    parts.append(patch)
    for k, (du, dv) in enumerate(((-0.15, -0.12), (0.15, -0.12), (-0.15, 0.12), (0.15, 0.12))):
        bolt = sphere(f'Patch.Bolt{k}', 0.022, loc=on_slope((ridge[0], ridge[1] + du, ridge[2]), ang, slope * 0.55 + dv, -1,
                                                            along='Y', lift=0.09), segments=8, rings=4)
        assign(bolt, m['dark'])
        parts.append(bolt)
    hole = box('Hole', (0.34, 0.3, 0.06), loc=on_slope(ridge, ang, slope * 0.5, 1, along='Y', lift=0.05), rot=(ang, 0, 90))
    assign(hole, m['char'])
    parts.append(hole)
    for k, (du, dv, rz) in enumerate(((0.2, 0.05, 25), (-0.18, -0.08, -30), (0.05, 0.19, 60))):
        jag = box(f'Hole.Jag{k}', (0.14, 0.1, 0.06), loc=on_slope((ridge[0], ridge[1] + du, ridge[2]), ang, slope * 0.5 + dv, 1,
                                                               along='Y', lift=0.05), rot=(ang, 0, 90 + rz))
        assign(jag, m['char'])
        parts.append(jag)
    # Doors, and the ROCKS board in the front gable.
    parts += swing_door('Entry', ex, yf, z0, m, m['entry'])
    parts += swing_door('Exit', xx, yf, z0, m, m['exit'], swing=20, hinge=1)
    board = box('Sign', (0.86, 0.05, 0.22), loc=(0, yf + 0.03, top + 0.15), rot=(0, 0, 0))
    board.rotation_euler = (0, math.radians(-3), 0)
    bevel(board, 0.01, 2)
    assign(board, m['white'])
    parts.append(board)
    parts += text('Sign.Text', 'ROCKS', (0, yf + 0.065, top + 0.15), 0.15, m['red'], weight=0.26)
    # Giant magnifying glass leaning against the left wall.
    lean = 20
    hx, hy = -w / 2 - 0.44, cy + 0.2
    handle = cylinder('Lens.Handle', 0.045, 0.55, loc=(hx, hy, 0.03), segments=12, rot=(0, lean, 0))
    _shift(handle, (0, 0, 0.275))
    bevel(handle, 0.02, 2, angle=60)
    assign(handle, m['plank2'])
    parts.append(handle)
    dirn = (math.sin(math.radians(lean)), 0, math.cos(math.radians(lean)))
    cx = (hx + 0.86 * dirn[0], hy, 0.03 + 0.86 * dirn[2])
    ring = torus('Lens.Ring', 0.3, 0.045, loc=cx, rot=(0, 90 + lean, 0), major_segments=28, minor_segments=10)
    assign(ring, m['stripe_y'])
    parts.append(ring)
    glass = cylinder('Lens.Glass', 0.28, 0.025, loc=cx, segments=28, rot=(0, 90 + lean, 0))
    assign(glass, m['glass'])
    parts.append(glass)
    glint = box('Lens.Glint', (0.03, 0.05, 0.22), loc=(cx[0] - 0.03, cx[1] - 0.12, cx[2] + 0.1), rot=(0, lean, 0))
    assign(glint, m['white'])
    parts.append(glint)
    # Rickety rock shelf on the left wall, brackets askew, a nugget under a bell jar.
    sxw = -w / 2
    rnd = random.Random(4)
    for k, (zz, droop) in enumerate(((0.62, -5), (1.02, -3))):
        shelf = box(f'Shelf{k}', (0.32, 0.85, 0.035), loc=(sxw - 0.16, cy - 0.05, z0 + zz), rot=(0, droop, 0))
        assign(shelf, m['plank'])
        parts.append(shelf)
        for by in (-0.3, 0.25):
            br = box(f'Shelf{k}.Bracket', (0.25, 0.04, 0.04), loc=(sxw - 0.12, cy - 0.05 + by, z0 + zz - 0.12), rot=(0, 42, 0))
            assign(br, m['plank2'])
            parts.append(br)
        for i in range(4):
            r = rnd.uniform(0.06, 0.1)
            mat = (m['rock'], m['rubble2'], m['white'], m['rust'])[(i + k) % 4]
            parts += rock(f'Sample{k}{i}', (sxw - 0.16 + rnd.uniform(-0.05, 0.05), cy - 0.38 + i * 0.22 + rnd.uniform(-0.03, 0.03),
                                          z0 + zz + r * 0.7 + 0.02), r, m, seed=10 * k + i, mat=mat)
    jar = cylinder('Jar', 0.085, 0.2, loc=(sxw - 0.16, cy + 0.35, z0 + 1.02 + 0.12), segments=14)
    assign(jar, m['glass'])
    parts.append(jar)
    parts += rock('Nugget', (sxw - 0.16, cy + 0.35, z0 + 1.02 + 0.08), 0.05, m, seed=99, mat=m['stripe_y'])
    # Rock hammer leaning by the exit door.
    hmx, hmy = xx + 0.36, yf + 0.14
    hh = cylinder('Hammer.Handle', 0.025, 0.56, loc=(hmx, hmy, z0 + 0.02), segments=8, rot=(-14, 0, 0))
    _shift(hh, (0, 0, 0.28))
    assign(hh, m['plank'])
    parts.append(hh)
    head_z = z0 + 0.02 + 0.55 * math.cos(math.radians(14))
    head = box('Hammer.Head', (0.18, 0.06, 0.06), loc=(hmx, hmy - 0.55 * math.sin(math.radians(14)), head_z), rot=(-14, 0, 0))
    bevel(head, 0.012, 2)
    assign(head, m['steel'])
    parts.append(head)
    pick = cylinder('Hammer.Pick', 0.03, 0.14, loc=(hmx - 0.14, hmy - 0.55 * math.sin(math.radians(14)), head_z), axis='X',
                    segments=8, radius2=0.005, rot=(0, 180, 0))
    assign(pick, m['steel'])
    parts.append(pick)
    # Wheelbarrow of rocks at the front-right.
    wbx, wby, wyaw = sx / 2 + 0.05, sz / 2 + 0.25, -35

    def P(local):
        return _yawed((wbx, wby, 0), wyaw, local)

    tub = box('Barrow.Tub', (0.62, 0.44, 0.3), loc=P((0, 0, 0.36)), rot=(0, -10, wyaw))
    bevel(tub, 0.07, 3)
    assign(tub, m['green'])
    parts.append(tub)
    inner = box('Barrow.Inner', (0.5, 0.34, 0.06), loc=P((0, 0, 0.5)), rot=(0, -10, wyaw))
    assign(inner, m['dark'])
    parts.append(inner)
    parts += tyre('Barrow.Wheel', P((0.34, 0, 0.14)), m, r=0.1, rot=(90, 0, wyaw))
    for side in (-1, 1):
        hd = cylinder(f'Barrow.Handle{side}', 0.025, 0.55, loc=P((-0.35, side * 0.17, 0.42)), axis='X', segments=8, rot=(0, -18, wyaw))
        assign(hd, m['plank'])
        parts.append(hd)
        leg = cylinder(f'Barrow.Leg{side}', 0.025, 0.24, loc=P((-0.2, side * 0.17, 0.12)), segments=8, rot=(0, 0, wyaw))
        assign(leg, m['steel'])
        parts.append(leg)
    for i, (dx, dy, r) in enumerate(((-0.12, 0.06, 0.11), (0.1, -0.05, 0.1), (0.02, 0.1, 0.08), (0.12, 0.1, 0.07))):
        parts += rock(f'Load{i}', P((dx, dy, 0.52 + r * 0.5)), r, m, seed=30 + i, mat=(m['rock'], m['rubble'])[i % 2])
    pivot('Body', (0, 0, 0), parts)


def build_research_center(sx, sz, ex, xx, m):
    """Think Tank Tent: a patched canvas wall tent on a muddy pitch, guy ropes to pegs, a bare bulb on a
    crooked pole for the big idea, a whiteboard of scribbles, a lawn chair and a smouldering campfire."""
    parts = dirt_lot(sx, sz, m)
    w, d, h = 1.6, 2.0, 1.0
    cy = -0.2
    yf = cy + d / 2
    z0 = 0.08
    # Canvas walls, low and saggy, with the ridge running front-to-back so the door is in the gable end.
    parts.append(B.block('Walls', w, d, h, z0, m, radius=0.06, loc_xy=(0, cy)))
    top = z0 + h
    rise = 0.62
    parts.append(gable_attic('Attic', w, d, rise, (0, cy), top, m, along='Y'))
    ridge = (0, cy, top + rise)
    roof, slope, ang = gable_tin('Roof', d + 0.28, w / 2, rise, ridge, m, along='Y',
                                 mats=(m['body'], m['body']), ridge_mat=m['plank2'])
    parts += roof
    # Mismatched patches stitched over both slopes.
    for k, (side, s_down, du, size, mat) in enumerate((
            (-1, slope * 0.45, -0.35, (0.4, 0.34), m['tarp']), (-1, slope * 0.7, 0.42, (0.3, 0.26), m['plank']),
            (1, slope * 0.5, 0.2, (0.36, 0.3), m['tarp']))):
        loc = on_slope((ridge[0], ridge[1] + du, ridge[2]), ang, s_down, side, along='Y', lift=0.05)
        patch = box(f'Patch{k}', (size[0], size[1], 0.04), loc=loc, rot=(ang * side, 0, 90))
        assign(patch, mat)
        parts.append(patch)
    # Guy ropes from the eaves to pegs in the dirt.
    for side in (-1, 1):
        for dy in (-0.62, 0.62):
            eave = (side * (w / 2 + 0.12), cy + dy, top - 0.04)
            peg = (side * (w / 2 + 0.62), cy + dy * 1.16, 0.1)
            mid = ((eave[0] + peg[0]) / 2, (eave[1] + peg[1]) / 2, (eave[2] + peg[2]) / 2)
            dx, dyy, dz = peg[0] - eave[0], peg[1] - eave[1], peg[2] - eave[2]
            rope = cylinder(f'Rope{side}{dy:.0f}', 0.016, math.hypot(math.hypot(dx, dyy), dz), loc=mid, segments=6,
                            rot=(math.degrees(math.atan2(math.hypot(dx, dyy), -dz)), 0,
                                 math.degrees(math.atan2(dyy, dx)) - 90))
            assign(rope, m['canvas'])
            pin = cylinder(f'Peg{side}{dy:.0f}', 0.03, 0.2, loc=(peg[0], peg[1], 0.1), segments=6, rot=(0, 12, 0))
            assign(pin, m['plank2'])
            parts += [rope, pin]
    # Doors: canvas flaps in the front gable, still framed green and orange so the pins read.
    parts += swing_door('Entry', ex, yf, z0, m, m['entry'], leaf_mat=m['canvas'], swing=22, lamp=False)
    parts += swing_door('Exit', xx, yf, z0, m, m['exit'], leaf_mat=m['canvas'], hinge=1, lamp=False)
    # A skirt of grubby canvas round the foot, so the tinted tent still reads as cloth.
    skirt = box('Skirt', (w + 0.1, d + 0.1, 0.22), loc=(0, cy, z0 + 0.11))
    bevel(skirt, 0.03, 2)
    assign(skirt, m['canvas'])
    parts.append(skirt)
    # The big idea: a bare bulb on a leaning pole.
    pole = cylinder('Idea.Pole', 0.04, 1.5, loc=(-w / 2 - 0.42, cy - 0.5, 0.75), segments=8, rot=(0, 9, 0))
    assign(pole, m['plank2'])
    holder = cylinder('Idea.Holder', 0.05, 0.12, loc=(-w / 2 - 0.55, cy - 0.5, 1.52), segments=8)
    assign(holder, m['dark'])
    bulb = sphere('Idea.Bulb', 0.15, loc=(-w / 2 - 0.55, cy - 0.5, 1.68), scale=(1, 1, 1.15), segments=12, rings=8)
    assign(bulb, m['glow'])
    parts += [pole, holder, bulb]
    # Whiteboard of scribbles leaning on the tent, and a lawn chair beside it.
    bd = box('Board', (0.8, 0.05, 0.6), loc=(0.62, yf + 0.3, 0.42), rot=(-12, 0, 0))
    bevel(bd, 0.02, 2)
    assign(bd, m['white'])
    parts.append(bd)
    for k, (bx, bz, bw) in enumerate(((-0.2, 0.12, 0.34), (0.06, -0.02, 0.24), (-0.1, -0.14, 0.4))):
        line = box(f'Board.Scribble{k}', (bw, 0.03, 0.035), loc=(0.62 + bx, yf + 0.28, 0.42 + bz), rot=(-12, 0, 0))
        assign(line, m['dark'])
        parts.append(line)
    for k, lx in enumerate((-0.36, 0.36)):
        leg = cylinder(f'Board.Leg{k}', 0.022, 0.45, loc=(0.62 + lx, yf + 0.36, 0.2), segments=6, rot=(14, 0, 0))
        assign(leg, m['steel'])
        parts.append(leg)
    seat = box('Chair.Seat', (0.4, 0.4, 0.05), loc=(-0.55, yf + 0.42, 0.32))
    assign(seat, m['tarp'])
    back = box('Chair.Back', (0.4, 0.05, 0.34), loc=(-0.55, yf + 0.6, 0.5), rot=(-16, 0, 0))
    assign(back, m['tarp'])
    parts += [seat, back]
    for k, (lx, ly) in enumerate(((-0.17, -0.17), (0.17, -0.17), (-0.17, 0.17), (0.17, 0.17))):
        leg = cylinder(f'Chair.Leg{k}', 0.018, 0.32, loc=(-0.55 + lx, yf + 0.42 + ly, 0.16), segments=6)
        assign(leg, m['steel'])
        parts.append(leg)
    # Campfire: stones, spent logs, a lick of flame.
    fx, fy = 0.72, cy - 0.95
    for k in range(6):
        a = k * 60
        parts += rock(f'Fire.Stone{k}', (fx + math.cos(math.radians(a)) * 0.26, fy + math.sin(math.radians(a)) * 0.26, 0.06),
                      0.08, m, seed=40 + k, mat=m['rubble'])
    for k, a in enumerate((20, 100)):
        log = cylinder(f'Fire.Log{k}', 0.05, 0.44, loc=(fx, fy, 0.11), axis='X', segments=8, rot=(0, 0, a))
        assign(log, m['char'])
        parts.append(log)
    flame = cylinder('Fire.Flame', 0.12, 0.26, loc=(fx, fy, 0.24), radius2=0.0, segments=8)
    assign(flame, m['spark'])
    parts.append(flame)
    pivot('Body', (0, 0, 0), parts)


def build_living_quarters(sx, sz, ex, xx, m):
    """The Cells: an open-topped cage of cheap galvanized bars on a low welded kick plate — no solid walls
    and no roof, so the mattress and the open steel toilet inside are visible from the game camera. The
    middle cell is a rusty welded plate instead of a bar wall. A scavenged watchtower with a pyramidal
    cap and a cold spotlight beam aimed at the entry stands over the yard."""
    parts = dirt_lot(sx, sz, m, mat=m['concrete'])
    w, d = 2.7, 2.5
    cy = -0.1
    yf = cy + d / 2
    back_y = cy - d / 2
    z0 = 0.08
    kick_h = 0.22
    bar_h = 1.55
    top = z0 + kick_h + bar_h
    # Shared per-face layout: front, back, left, right — position, outward yaw, edge length.
    edges = {'F': (0, yf, 0, w), 'B': (0, back_y, 180, w),
             'L': (-w / 2, cy, -90, d), 'R': (w / 2, cy, 90, d)}

    def cage_wall(name, cx, cy_, yaw, length):
        """A row of round vertical bars plus low/high rails, spanning `length` centred at (cx, cy_) with
        outward normal `yaw`. Every 6th bar is rust-patched — cheap, mismatched scrap metal."""
        out = []
        n = max(4, round(length / 0.16))
        for k in range(n + 1):
            t = (k / n) - 0.5
            bx, by = _yawed((cx, cy_, 0), yaw, (t * length, 0, 0))[:2]
            bar = cylinder(f'{name}.Bar{k}', 0.025, bar_h, loc=(bx, by, z0 + kick_h + bar_h / 2), axis='Z',
                          segments=6)
            assign(bar, m['rust'] if k % 6 == 0 else m['body'])
            out.append(bar)
        for rz, suf in ((z0 + kick_h + 0.06, 'RailLo'), (top - 0.06, 'RailHi')):
            rail = box(f'{name}.{suf}', (length, 0.05, 0.05), loc=(cx, cy_, rz), rot=(0, 0, yaw))
            assign(rail, m['body'])
            out.append(rail)
        return out

    # Low welded kick plate around the base on three sides, then open bars above it.
    for face, (px, py, yaw, length) in edges.items():
        if face == 'F':
            continue
        plate = box(f'Kick{face}', (length, 0.06, kick_h), loc=(px, py, z0 + kick_h / 2), rot=(0, 0, yaw))
        bevel(plate, 0.015, 2)
        assign(plate, m['body'])
        parts.append(plate)
        parts += cage_wall(face, px, py, yaw, length)

    # Front: two barred doors and a welded-shut middle plate, with bar fill between them.
    door_half, plate_half = 0.32, 0.4
    for i, (x0, x1) in enumerate(((-w / 2, ex - door_half), (ex + door_half, -plate_half),
                                   (plate_half, xx - door_half), (xx + door_half, w / 2))):
        length = x1 - x0
        if length <= 0.05:
            continue
        parts += cage_wall(f'F{i}', (x0 + x1) / 2, yf, 0, length)
    parts += swing_door('Entry', ex, yf, z0, m, m['entry'], leaf_mat=m['steel'], height=1.1, lamp=False)
    parts += swing_door('Exit', xx, yf, z0, m, m['exit'], leaf_mat=m['steel'], height=1.1, hinge=1, lamp=False)
    plate = box('Cell2.Plate', (plate_half * 2 - 0.1, 0.08, 1.3), loc=(0, yf + 0.03, z0 + kick_h + 0.75))
    bevel(plate, 0.02, 2)
    assign(plate, m['rust'])
    parts.append(plate)
    for ang in (32, -32):
        strap = box('Cell2.Strap', (1.5, 0.06, 0.09), loc=(0, yf + 0.09, z0 + kick_h + 0.75), rot=(0, ang, 0))
        assign(strap, m['steel'])
        parts.append(strap)

    # Corner posts, thicker than the bars, each capped with a single accent spike — a cage frame, not a
    # crown, so nothing blocks the view straight down into the cage.
    for name, (px, py) in {'FL': (-w / 2, yf), 'FR': (w / 2, yf), 'BL': (-w / 2, back_y),
                            'BR': (w / 2, back_y)}.items():
        post = cylinder(f'Post{name}', 0.045, top - z0, loc=(px, py, (top + z0) / 2), axis='Z', segments=8)
        assign(post, m['body'])
        parts.append(post)
        spike = cylinder(f'Post{name}.Spike', 0.05, 0.16, loc=(px, py, top + 0.08), axis='Z', segments=6,
                         radius2=0.01)
        assign(spike, m['dark'])
        parts.append(spike)

    # One bold stencilled digit per real door, stamped on the steel leaf itself.
    for nx, num in ((ex, '1'), (xx, '3')):
        plaque = box(f'Num{num}.Plaque', (0.5, 0.04, 0.5), loc=(nx, yf + 0.07, z0 + 0.55))
        assign(plaque, m['char'])
        parts.append(plaque)
        parts += text(f'Num{num}', num, (nx, yf + 0.1, z0 + 0.55), 0.36, m['white'], yaw=180)

    # Inside the cage: one thin mattress and one open steel toilet — enough squalor for one cell, visible
    # straight down through the open top. Both are sized and placed to sit clear of every wall, with a
    # margin at least as wide as their own bevel, so nothing pokes through the bars.
    mx, my = ex * 0.55, back_y + 0.6
    mattress = box('Mattress', (0.6, 1.0, 0.1), loc=(mx, my, z0 + kick_h + 0.05))
    bevel(mattress, 0.03, 2)
    assign(mattress, m['mattress'])
    parts.append(mattress)
    pillow = box('Pillow', (0.46, 0.22, 0.06), loc=(mx, back_y + 0.24, z0 + kick_h + 0.13))
    bevel(pillow, 0.02, 2)
    assign(pillow, m['white'])
    parts.append(pillow)
    # The toilet faces out into the cage with its tank flush against the back wall behind it, like a real
    # fixture rather than a bowl floating in the middle of the room; the bowl flares wider toward the
    # rim (radius2), narrower at the floor, instead of the tapered-bucket shape a flipped radius gives.
    wx, wy = xx * 0.55, back_y + 0.55
    bowl = cylinder('WC.Bowl', 0.12, 0.34, loc=(wx, wy, z0 + kick_h + 0.17), axis='Z', segments=14, radius2=0.19)
    bevel(bowl, 0.02, 2)
    assign(bowl, m['steel'])
    parts.append(bowl)
    seat = torus('WC.Seat', 0.17, 0.03, loc=(wx, wy, z0 + kick_h + 0.35), major_segments=16, minor_segments=6)
    assign(seat, m['dark'])
    parts.append(seat)
    tank = box('WC.Tank', (0.26, 0.14, 0.32), loc=(wx, wy - 0.24, z0 + kick_h + 0.5))
    bevel(tank, 0.02, 2)
    assign(tank, m['steel'])
    parts.append(tank)

    # Guard tower on the back-left corner: scavenged scaffold legs, a dark cabin and a pyramidal cap.
    tx, ty = -w / 2 + 0.3, back_y + 0.3
    leg_h = top + 0.35
    for k, (px, py) in enumerate(((-0.16, -0.16), (0.16, -0.16), (-0.16, 0.16), (0.16, 0.16))):
        leg = box(f'Tower.Leg{k}', (0.1, 0.1, leg_h), loc=(tx + px, ty + py, leg_h / 2))
        assign(leg, m['rust'] if k == 1 else m['char'])
        parts.append(leg)
    cab = box('Tower.Cab', (0.55, 0.55, 0.25), loc=(tx, ty, leg_h + 0.125))
    bevel(cab, 0.03, 2)
    assign(cab, m['char'])
    parts.append(cab)
    socket = box('Tower.Glass', (0.6, 0.6, 0.12), loc=(tx, ty, leg_h + 0.19))
    assign(socket, m['char'])
    parts.append(socket)
    cap = cylinder('Tower.Cap', 0.42, 0.22, loc=(tx, ty, leg_h + 0.36), axis='Z', segments=4, radius2=0.01,
                   rot=(0, 0, 45))
    assign(cap, m['dark'])
    parts.append(cap)
    # Cold searchlight on the cabin's front face, pitched down toward the entry — housing, lens and a
    # solid beam wedge all sharing one downward-tilted local +Y direction, no compound yaw to hand-chain.
    lampbox = cylinder('Tower.Light', 0.1, 0.16, loc=(tx, ty + 0.35, leg_h + 0.1), axis='Y', segments=10,
                       rot=(-25, 0, 0))
    assign(lampbox, m['steel'])
    lens = cylinder('Tower.Lens', 0.09, 0.04, loc=(tx, ty + 0.44, leg_h + 0.04), axis='Y', segments=10,
                    rot=(-25, 0, 0))
    assign(lens, m['spot'])
    beam = cylinder('Tower.Beam', 0.06, 0.55, loc=(tx, ty + 0.68, leg_h - 0.18), axis='Y', segments=10,
                    radius2=0.16, rot=(-25, 0, 0))
    assign(beam, m['spot'])
    parts += [lampbox, lens, beam]
    pivot('Body', (0, 0, 0), parts)


def build_explosive_warehouse(sx, sz, ex, xx, m):
    """Boom Closet: a two-seat outhouse with crescent vents, packed so full of dynamite that sticks poke out
    of the roof, a lit fuse curling off the back, TNT stencilled on the side and sandbags round the base."""
    parts = dirt_lot(sx, sz, m)
    w, d, h = 1.5, 1.05, 1.5
    cy = -0.1
    yf = cy + d / 2
    z0 = 0.08
    parts.append(B.block('Walls', w, d, h, z0, m, radius=0.04, loc_xy=(0, cy)))
    top = z0 + h
    for face, (px, py, yaw, length) in {'F': (0, yf, 0, w), 'B': (0, cy - d / 2, 180, w),
                                         'L': (-w / 2, cy, -90, d), 'R': (w / 2, cy, 90, d)}.items():
        parts += plank_lines(f'Planks{face}', length - 0.08, h - 0.12, (px, py, z0 + h / 2), m, yaw=yaw, gap=0.24,
                             vertical=True)
    # A tin lean-to roof, tipped back, with dynamite bursting out of the ridge gap.
    roof = tin_sheet('Roof', w + 0.34, d + 0.34, (0, cy - 0.05, top + 0.12), m, rot=(-11, 0, 0), mat=m['tin2'])
    parts += roof
    for k, (dx, dyy, rx, ry) in enumerate(((-0.3, 0.05, 16, -22), (-0.02, -0.12, -12, 14), (0.28, 0.08, 8, 26),
                                            (0.12, 0.14, -18, -8))):
        parts += dynamite(f'Roof.Stick{k}', (dx, cy + dyy, top + 0.34), m, rot=(rx, ry, 0), lit=(k == 2))
    # The two seats: entry and exit doors side by side, each with a crescent vent.
    parts += swing_door('Entry', ex, yf, z0, m, m['entry'], width=0.5, height=1.15, leaf_mat=m['plank2'], lamp=False)
    parts += swing_door('Exit', xx, yf, z0, m, m['exit'], width=0.5, height=1.15, hinge=1, leaf_mat=m['plank2'],
                        swing=16, lamp=False)
    for k, dx in enumerate((ex, xx)):
        outer_c = cylinder(f'Vent{k}.Outer', 0.11, 0.09, loc=(dx, yf + 0.06, z0 + 0.95), axis='Y', segments=14)
        assign(outer_c, m['char'])
        inner_c = cylinder(f'Vent{k}.Inner', 0.085, 0.11, loc=(dx + 0.05, yf + 0.06, z0 + 0.97), axis='Y', segments=14)
        assign(inner_c, m['plank2'])
        parts += [outer_c, inner_c]
    # TNT stencilled on the flank, a DANGER board leaning out front.
    parts += text('TNT', 'TNT', (w / 2 + 0.03, cy, z0 + 0.95), 0.34, m['red'], yaw=90)
    board = box('Danger.Board', (0.62, 0.05, 0.3), loc=(-w / 2 - 0.3, yf + 0.14, 0.62), rot=(0, 0, 24))
    bevel(board, 0.02, 2)
    assign(board, m['stripe_y'])
    parts.append(board)
    parts += text('Danger', '!', _yawed((-w / 2 - 0.3, yf + 0.11, 0.62), 24, (0, 0, 0)), 0.2, m['stripe_k'], yaw=24)
    post = cylinder('Danger.Post', 0.03, 0.62, loc=(-w / 2 - 0.3, yf + 0.16, 0.31), segments=6)
    assign(post, m['plank2'])
    parts.append(post)
    # A fuse snaking away from the back corner, and sandbags heaped round the base.
    for k in range(7):
        t = k / 6
        seg = capsule(f'Fuse{k}', 0.022, 0.16, loc=(-w / 2 - 0.1 - t * 0.55, cy - d / 2 - 0.12 - math.sin(t * 3) * 0.14, 0.06),
                      axis='X', segments=6, rings=4, rot=(0, 0, 20 * math.cos(t * 3)))
        assign(seg, m['dark'])
        parts.append(seg)
    parts += sandbag_wall('Bags', [(-w / 2 - 0.1, cy - d / 2 - 0.05), (w / 2 + 0.1, cy - d / 2 - 0.05)], m, rows=2)
    parts += sandbag_wall('BagsR', [(w / 2 + 0.16, cy - d / 2 - 0.05), (w / 2 + 0.16, cy + 0.2)], m, rows=1)
    pivot('Body', (0, 0, 0), parts)


def build_freight_warehouse(sx, sz, ex, xx, m):
    """The Pile: no warehouse at all — a heap of junk under a blue tarp slung on crooked poles, with a
    bathtub, a bent bicycle wheel, a rusted scale, spilling crates and a hand-painted STUFF sign."""
    parts = dirt_lot(sx, sz, m)
    z0 = 0.08
    # Four crooked poles holding a sagging tarp over the heap.
    poles = ((-1.5, -1.35, 2.05, 5), (1.5, -1.4, 1.95, -6), (-1.45, 1.1, 1.75, 7), (1.55, 1.15, 1.85, -4))
    for k, (px, py, ph, lean) in enumerate(poles):
        pole = cylinder(f'Pole{k}', 0.06, ph, loc=(px, py, ph / 2), segments=8, rot=(lean, lean * 0.6, 0))
        assign(pole, m['plank2'])
        parts.append(pole)
    tarp = box('Tarp', (3.3, 2.9, 0.05), loc=(0, -0.1, 1.86), rot=(4, -3, 0))
    bevel(tarp, 0.03, 2)
    assign(tarp, m['body'])
    parts.append(tarp)
    for k, (dx, dy) in enumerate(((-1.2, -0.9), (1.2, -0.95), (-1.15, 0.7), (1.25, 0.75))):
        sag = sphere(f'Tarp.Sag{k}', 0.34, loc=(dx, dy, 1.78), scale=(1.5, 1.5, 0.35), segments=12, rings=6)
        assign(sag, m['body'])
        parts.append(sag)
    # The heap: crates, barrels, a bathtub, sacks and loose rock, piled higher toward the middle.
    for k, (cx, cy_, cz, s, rz, mat) in enumerate((
            (-0.9, -0.6, 0.0, 0.62, 12, m['cardboard']), (-0.15, -0.75, 0.0, 0.54, -8, m['plank']),
            (0.7, -0.5, 0.0, 0.6, 20, m['cardboard']), (-0.5, 0.15, 0.62, 0.5, 30, m['plank']),
            (0.35, 0.3, 0.56, 0.58, -14, m['cardboard']), (-0.05, -0.2, 1.1, 0.44, 8, m['plank']))):
        crate = box(f'Crate{k}', (s, s * 0.9, s * 0.8), loc=(cx, cy_, z0 + cz + s * 0.4), rot=(0, 0, rz))
        bevel(crate, 0.02, 2)
        assign(crate, mat)
        parts.append(crate)
        for edge in (-1, 1):
            band = box(f'Crate{k}.Band', (s * 1.02, 0.03, 0.05), loc=(cx, cy_ + edge * s * 0.45, z0 + cz + s * 0.4),
                       rot=(0, 0, rz))
            assign(band, m['plank2'])
            parts.append(band)
    # Bathtub tipped on the near-right of the pile.
    tub = capsule('Tub', 0.34, 0.8, loc=(1.15, 0.55, z0 + 0.36), axis='X', segments=14, rings=8, rot=(0, 0, -18))
    tub.scale = (1, 1, 0.8)
    assign(tub, m['white'])
    hollow = capsule('Tub.Hollow', 0.27, 0.74, loc=(1.15, 0.55, z0 + 0.46), axis='X', segments=14, rings=8, rot=(0, 0, -18))
    hollow.scale = (1, 1, 0.8)
    assign(hollow, m['char'])
    parts += [tub, hollow]
    for k, dx in enumerate((-0.42, 0.42)):
        foot = cylinder(f'Tub.Foot{k}', 0.05, 0.14, loc=(1.15 + dx * 0.95, 0.55 + dx * 0.3, z0 + 0.07), segments=6)
        assign(foot, m['chrome'])
        parts.append(foot)
    # Bent bicycle wheel leaning against a pole, a rusted scale, a barrel.
    wheel = torus('Bike.Wheel', 0.33, 0.035, loc=(-1.45, -0.15, z0 + 0.34), rot=(74, 0, 14), major_segments=22, minor_segments=6)
    wheel.scale = (1, 0.86, 1)
    assign(wheel, m['rust'])
    parts.append(wheel)
    for k in range(6):
        spoke = cylinder(f'Bike.Spoke{k}', 0.012, 0.62, loc=(-1.45, -0.15, z0 + 0.34), segments=4,
                         rot=(74, 0, 14 + k * 30))
        assign(spoke, m['steel'])
        parts.append(spoke)
    barrel_ = cylinder('Barrel', 0.26, 0.62, loc=(1.35, -1.0, z0 + 0.31), segments=16)
    bevel(barrel_, 0.03, 2)
    assign(barrel_, m['rust'])
    parts.append(barrel_)
    plate = cylinder('Scale.Plate', 0.28, 0.05, loc=(-1.05, 1.15, z0 + 0.2), segments=16)
    assign(plate, m['steel'])
    stem = cylinder('Scale.Stem', 0.05, 0.2, loc=(-1.05, 1.15, z0 + 0.1), segments=8)
    assign(stem, m['steel'])
    dial = cylinder('Scale.Dial', 0.16, 0.06, loc=(-1.05, 1.15, z0 + 0.3), axis='Y', segments=16)
    assign(dial, m['white'])
    parts += [plate, stem, dial]
    # Entry and exit: a bare doorframe standing in front of the heap, with a tarp flap in each.
    yf = 1.55
    for name, dx, mat, swing in (('Entry', ex, m['entry'], 0.0), ('Exit', xx, m['exit'], 18.0)):
        parts += swing_door(name, dx, yf, z0, m, mat, height=1.2, leaf_mat=m['tarp'], swing=swing,
                            hinge=(1 if name == 'Exit' else -1), lamp=False)
    # STUFF, hand-painted on a board nailed across two poles.
    sign = box('Sign', (1.5, 0.06, 0.34), loc=(0, -1.45, 1.35), rot=(0, -3, 0))
    bevel(sign, 0.02, 2)
    assign(sign, m['plank'])
    parts.append(sign)
    parts += text('SignText', 'STUFF', (0, -1.5, 1.35), 0.22, m['red'])
    pivot('Body', (0, 0, 0), parts)


def build_vehicle_depot(sx, sz, ex, xx, m):
    """Rusty Garage: a rusted tin lean-to open at the front, a car up on bricks with its hood raised and a
    puddle of oil under it, an oil drum, a work lamp on a stand, and a GAR GE sign missing a letter."""
    parts = dirt_lot(sx, sz, m)
    z0 = 0.08
    w, d = 3.4, 2.2
    cy = -0.3
    back_h, front_h = 1.35, 1.95
    # Back and side walls of corrugated tin on a light frame; the front is open.
    parts += tin_sheet('WallB', w, back_h, (0, cy - d / 2, z0 + back_h / 2), m, rot=(90, 0, 0), mat=m['body'])
    for side in (-1, 1):
        pts = [(-d / 2, 0.0), (d / 2, 0.0), (d / 2, front_h), (-d / 2, back_h)]
        panel = prism(f'WallS{side}', pts, 0.06, loc=(side * w / 2, cy, z0), axis='X')
        assign(panel, m['body'] if side < 0 else m['tin2'])
        parts.append(panel)
    for k, (px, py) in enumerate(((-w / 2, cy + d / 2), (w / 2, cy + d / 2))):
        post = box(f'Post{k}', (0.11, 0.11, front_h), loc=(px, py, z0 + front_h / 2))
        bevel(post, 0.02, 2)
        assign(post, m['plank2'])
        parts.append(post)
    # Sloping tin roof from the low back to the open front, with a sagging corner.
    ang = math.degrees(math.atan2(front_h - back_h, d))
    roof_len = math.hypot(d + 0.3, front_h - back_h)
    parts += tin_sheet('Roof', w + 0.3, roof_len, (0, cy + 0.02, z0 + (back_h + front_h) / 2 + 0.05), m,
                       rot=(-ang, 0, 0), mat=m['tin2'])
    lip = box('Roof.Lip', (w + 0.3, 0.1, 0.12), loc=(0, cy + d / 2 + 0.16, z0 + front_h + 0.02), rot=(-ang, 0, 0))
    bevel(lip, 0.02, 2)
    assign(lip, m['rust'])
    parts.append(lip)
    # Rust runs bleeding down the back wall.
    for k, (rx, rw, rh) in enumerate(((-1.1, 0.2, 0.7), (-0.3, 0.14, 0.5), (0.75, 0.24, 0.85), (1.25, 0.12, 0.4))):
        streak = box(f'Streak{k}', (rw, 0.03, rh), loc=(rx, cy - d / 2 - 0.04, z0 + back_h - rh / 2))
        assign(streak, m['char'])
        parts.append(streak)
    # The patient: a car up on bricks, hood open, one wheel gone, oil pooled beneath.
    parts += wreck_car('Car', (0.15, cy + 0.05, 0.0), m, yaw=-96, body_mat=m['blue'], missing=(1, -1), hood=62)
    puddle = cylinder('Oil', 0.42, 0.02, loc=(0.1, cy - 0.15, z0 + 0.01), segments=18)
    puddle.scale = (1.35, 1, 1)
    assign(puddle, m['char'])
    parts.append(puddle)
    # Oil drum, a toolbox and a trolley jack against the back wall.
    drum = cylinder('Drum', 0.24, 0.62, loc=(-1.28, cy - d / 2 + 0.35, z0 + 0.31), segments=16)
    bevel(drum, 0.03, 2)
    assign(drum, m['rust'])
    for k, dz in enumerate((-0.14, 0.14)):
        hoop = cylinder(f'Drum.Hoop{k}', 0.25, 0.05, loc=(-1.28, cy - d / 2 + 0.35, z0 + 0.31 + dz), segments=16)
        assign(hoop, m['tin2'])
        parts.append(hoop)
    parts.append(drum)
    tbox = box('Toolbox', (0.44, 0.24, 0.2), loc=(1.35, cy - d / 2 + 0.3, z0 + 0.1))
    bevel(tbox, 0.02, 2)
    assign(tbox, m['red'])
    lid = box('Toolbox.Lid', (0.46, 0.26, 0.05), loc=(1.35, cy - d / 2 + 0.3, z0 + 0.22))
    assign(lid, m['dark'])
    parts += [tbox, lid]
    # Work lamp on a stand, throwing light on the engine bay.
    stand = cylinder('Lamp.Stand', 0.03, 1.25, loc=(-1.0, cy + 0.5, z0 + 0.62), segments=8, rot=(0, 6, 0))
    assign(stand, m['steel'])
    foot = cylinder('Lamp.Foot', 0.16, 0.04, loc=(-1.0, cy + 0.5, z0 + 0.02), segments=12)
    assign(foot, m['dark'])
    shade = cylinder('Lamp.Shade', 0.16, 0.18, loc=(-0.92, cy + 0.5, z0 + 1.3), radius2=0.09, segments=14, rot=(0, 34, 0))
    assign(shade, m['tin'])
    glow = sphere('Lamp.Glow', 0.09, loc=(-0.84, cy + 0.5, z0 + 1.24), segments=10, rings=6)
    assign(glow, m['glow'])
    parts += [stand, foot, shade, glow]
    # Doors on the open front, and the sign with its missing A.
    yf = cy + d / 2
    parts += swing_door('Entry', ex, yf, z0, m, m['entry'], height=1.15, leaf_mat=m['tin'], swing=26, lamp=False)
    parts += swing_door('Exit', xx, yf, z0, m, m['exit'], height=1.15, leaf_mat=m['tin'], hinge=1, lamp=False)
    board = box('Sign', (1.9, 0.07, 0.42), loc=(0, yf + 0.12, z0 + front_h + 0.24), rot=(0, 2, 0))
    bevel(board, 0.02, 2)
    assign(board, m['tin2'])
    parts.append(board)
    parts += text('SignText', 'GAR GE', (0, yf + 0.17, z0 + front_h + 0.24), 0.26, m['stripe_y'], yaw=180)
    # The fallen A, face down in the dirt below.
    fallen = box('Sign.FallenA', (0.24, 0.24, 0.05), loc=(0.55, yf + 0.45, z0 + 0.03), rot=(0, 0, 28))
    assign(fallen, m['stripe_y'])
    parts.append(fallen)
    pivot('Body', (0, 0, 0), parts)


BUILDERS = {
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


def build_building(btype: str) -> None:
    d = B._load_defs()[btype]['1']
    sx, sz = d['sizeX'], d['sizeZ']
    ex = d['entry'][0] + 0.5 - sx / 2
    xx = d['exit'][0] + 0.5 - sx / 2
    m = _t1_materials(btype, B._materials(btype))
    BUILDERS[btype](sx, sz, ex, xx, m)
