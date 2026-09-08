"""Tier-3 buildings — unnecessary luxury. Corporate excess, stacked vertically.

driving_center      Turbo Campus: glass-and-chrome academy, banked race loop on the roof with a race car,
                    golden trophy on a plinth, jumbotron, chequered-flag poles, tyre walls, 1-2-3 podium.
blasting_academy    The Kaboom Institute: neoclassical portico and staircase, red-and-yellow mushroom-cloud
                    dome crowned by a golden starburst, banners, a fountain frozen mid-splash.
management_office   Corner Office Supreme: 8 m glass tower, gold penthouse, helipad with helicopter, golden
                    "$" on the facade, gold manager statue with coffee mug, rooftop fountain, limousine.
geology_lab         Institute of Expensive Rocks: museum with a glass pyramid roof, a glowing diamond on a
                    pedestal, gold display cases, red laser grid, velvet rope, giant price tag.
research_center     The Ivory Crater: ivory dish with a central tower, spiral ramp, glowing lightbulb dome,
                    brain sculpture, telescope dishes on the rim, satellite on a stick.
living_quarters     Unnecessarily Luxurious Hotel: rooftop infinity pool with slide, diving board, palm and
                    parasol; balconies with striped awnings, gold HOTEL sign, red carpet, valet, fountain.
explosive_warehouse Fort Kaboom: crenellated castle, four cone-roofed towers, moat and drawbridge, cannons,
                    warning flags, searchlight, and a giant lit bomb on the keep.
freight_warehouse   Hoarder's Paradise: warehouse buried under crate towers (some gold), containers, a gantry
                    crane still adding more, MORE sign, conveyor loop, forklift, a leaning stack.
vehicle_depot       Mecha Hangar: sci-fi hangar with half-open blast doors revealing a mech, cyan light
                    strips, twin gantries, warning beacons, jet vent, pad number 01, landing-strip lights.
"""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from common import (
    array, assign, bend, bevel, box, capsule, cylinder, link, mark_sharp, material, pivot, prism, rotate,
    solidify, sphere, torus,
)
import buildings as B


# ----------------------------------------------------------- materials ---

def _extra(m):
    m.update({
        'gold': material('Gold', 0xF7C948, roughness=0.35, metallic=0.6),
        'ivory': material('Ivory', 0xF7F2E4, roughness=0.75),
        'water': material('Water', 0x3EC1F0, roughness=0.15),
        'pink': material('Pink', 0xF48FB1, roughness=0.8),
        'black': material('Black', 0x1B1B20, roughness=0.6),
        'silver': material('Silver', 0xC9CED6, roughness=0.3, metallic=0.5),
        'bronze': material('Bronze', 0xB5733C, roughness=0.5, metallic=0.4),
        'orange': material('Orange', 0xFF8C1A, roughness=0.7),
        'blue': material('Blue', 0x2F6FD6, roughness=0.7),
        'asphalt': material('Asphalt', 0x3B3B42, roughness=0.95),
        'carpet': material('Carpet', 0xB8102A, roughness=0.95),
        'glow_cyan': material('GlowCyan', 0xA8F4FF, roughness=0.3, emission=0x30E0FF, emission_strength=1.4),
        'glow_red': material('GlowRed', 0xFF6060, roughness=0.3, emission=0xFF1A1A, emission_strength=1.5),
        'glow_orange': material('GlowOrange', 0xFFA040, roughness=0.3, emission=0xFF7A10, emission_strength=1.4),
        'glow_warm': material('GlowWarm', 0xFFEFB0, roughness=0.3, emission=0xFFC850, emission_strength=1.3),
        'glow_screen': material('GlowScreen', 0x6FC8FF, roughness=0.3, emission=0x2A9CFF, emission_strength=1.2),
        'glow_white': material('GlowWhite', 0xFFFFFF, roughness=0.3, emission=0xE8F4FF, emission_strength=1.2),
    })
    return m


# ---------------------------------------------------------- primitives ---

def _bx(name, size, loc, mat, r=0.03, rot=None, seg=2):
    b = box(name, size, loc=loc, rot=rot)
    rr = min(r, min(size) * 0.3)
    if rr > 0.004:
        bevel(b, rr, seg)
    assign(b, mat)
    return b


def _cy(name, radius, depth, loc, mat, axis='Z', segments=16, radius2=None, rot=None, r=0.0):
    c = cylinder(name, radius, depth, loc=loc, axis=axis, segments=segments, radius2=radius2, rot=rot)
    if r > 0:
        bevel(c, r, 2, angle=60)
    assign(c, mat)
    return c


def _sp(name, radius, loc, mat, scale=(1, 1, 1), segments=16, rings=8):
    s = sphere(name, radius, loc=loc, scale=scale, segments=segments, rings=rings)
    assign(s, mat)
    return s


def _to(name, major, minor, loc, mat, rot=None, ms=24, ns=8):
    t = torus(name, major, minor, loc=loc, rot=rot, major_segments=ms, minor_segments=ns)
    assign(t, mat)
    return t


def _cap(name, radius, length, loc, mat, axis='Z', rot=None, segments=12, rings=6):
    c = capsule(name, radius, length, loc=loc, axis=axis, rot=rot, segments=segments, rings=rings)
    assign(c, mat)
    return c


def _rod(name, p0, p1, r, mat, segments=8):
    """Cylinder running from p0 to p1."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    c = cylinder(name, r, d.length, loc=(a + b) / 2, segments=segments)
    c.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    assign(c, mat)
    return c


def _mesh(name, bm, loc=(0, 0, 0), sharp=40.0, smooth=True):
    if sharp is not None:
        mark_sharp(bm, sharp)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = Vector(loc)
    link(ob)
    if smooth:
        me.shade_smooth()
    return ob


def _lathe(name, profile, loc, mat, segments=32):
    """Spin an (r, z) profile around Z into a solid of revolution."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.radians(360),
                   steps=segments, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _mesh(name, bm, loc)
    assign(ob, mat)
    return ob


def _helix(name, r_in, r_out, turns, height, loc, mat, steps_per_turn=24, thickness=0.1):
    """Helical ribbon (a spiral ramp) climbing `height` over `turns`, thickened by a Solidify."""
    bm = bmesh.new()
    v0 = bm.verts.new((r_in, 0, 0))
    v1 = bm.verts.new((r_out, 0, 0))
    e = bm.edges.new((v0, v1))
    steps = int(steps_per_turn * turns)
    bmesh.ops.spin(bm, geom=[v0, v1, e], cent=(0, 0, 0), axis=(0, 0, 1), dvec=(0, 0, height / steps),
                   angle=math.radians(360 * turns), steps=steps, use_merge=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _mesh(name, bm, loc, sharp=None)
    solidify(ob, thickness, offset=0.0)
    assign(ob, mat)
    return ob


def _helix_tube(name, radius, tube_r, turns, height, loc, mat, steps_per_turn=20, tube_segments=8):
    """Helical tube (a curly slide)."""
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=False, segments=tube_segments, radius=tube_r)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((radius, 0, 0)), verts=bm.verts)
    steps = int(steps_per_turn * turns)
    bmesh.ops.spin(bm, geom=bm.verts[:] + bm.edges[:], cent=(0, 0, 0), axis=(0, 0, 1), dvec=(0, 0, height / steps),
                   angle=math.radians(360 * turns), steps=steps, use_merge=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _mesh(name, bm, loc, sharp=None)
    assign(ob, mat)
    return ob


def _star(name, n, r_out, r_in, thickness, loc, mat, axis='Y', rot=None):
    pts = []
    for i in range(2 * n):
        a = math.pi / 2 + i * math.pi / n
        r = r_out if i % 2 == 0 else r_in
        pts.append((r * math.cos(a), r * math.sin(a)))
    p = prism(name, pts, thickness, loc=loc, axis=axis, rot=rot)
    assign(p, mat)
    return p


def _pyramid(name, half, h, loc, mat):
    """Square pyramid with its base centred on loc."""
    bm = bmesh.new()
    base = [bm.verts.new((sx * half, sy * half, 0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    apex = bm.verts.new((0, 0, h))
    bm.faces.new(base[::-1])
    for i in range(4):
        bm.faces.new((base[i], base[(i + 1) % 4], apex))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _mesh(name, bm, loc, sharp=20.0, smooth=False)
    assign(ob, mat)
    return ob


_STROKES = {
    'H': [((0, 0), (0, 1)), ((1, 0), (1, 1)), ((0, .5), (1, .5))],
    'O': [((0, 0), (0, 1)), ((1, 0), (1, 1)), ((0, 0), (1, 0)), ((0, 1), (1, 1))],
    'T': [((0, 1), (1, 1)), ((.5, 0), (.5, 1))],
    'E': [((0, 0), (0, 1)), ((0, 0), (1, 0)), ((0, .5), (.8, .5)), ((0, 1), (1, 1))],
    'L': [((0, 0), (0, 1)), ((0, 0), (1, 0))],
    'M': [((0, 0), (0, 1)), ((1, 0), (1, 1)), ((0, 1), (.5, .45)), ((.5, .45), (1, 1))],
    'R': [((0, 0), (0, 1)), ((0, 1), (.9, 1)), ((.9, 1), (.9, .5)), ((0, .5), (.9, .5)), ((.4, .5), (1, 0))],
    'S': [((0, 1), (1, 1)), ((0, 1), (0, .5)), ((0, .5), (1, .5)), ((1, .5), (1, 0)), ((0, 0), (1, 0))],
    '$': [((0, 1), (1, 1)), ((0, 1), (0, .5)), ((0, .5), (1, .5)), ((1, .5), (1, 0)), ((0, 0), (1, 0)),
          ((.5, -.15), (.5, 1.15))],
    '0': [((0, 0), (0, 1)), ((1, 0), (1, 1)), ((0, 0), (1, 0)), ((0, 1), (1, 1))],
    '1': [((.5, 0), (.5, 1)), ((.15, .7), (.5, 1)), ((.2, 0), (.8, 0))],
    'I': [((.5, 0), (.5, 1))],
    'P': [((0, 0), (0, 1)), ((0, 1), (.9, 1)), ((.9, 1), (.9, .5)), ((0, .5), (.9, .5))],
    'V': [((0, 1), (.5, 0)), ((.5, 0), (1, 1))],
    '!': [((.5, .3), (.5, 1)), ((.5, 0), (.5, .05))],
}


def _letters(prefix, text, x, y, z, h, mat, thick=0.08, spacing=1.35, facing: float = 1.0):
    """Block letters built from boxes on a ±Y face. `x` centres the run, `z` is the baseline.

    `facing` is the face's outward normal along Y. A camera looking at a +Y face sees world
    -X as screen-right, so the default run is laid out mirrored about `x`; pass facing=-1 for
    a sign on the back of the building, which is read from the other side.
    """
    w = h * 0.62
    t = h * 0.2
    run = len(text) * w * spacing - w * (spacing - 1)
    x0 = x - run / 2
    out = []
    for i, ch in enumerate(text):
        cx = x0 + i * w * spacing
        for (ax, az), (bx, bz) in _STROKES.get(ch, []):
            px, pz, qx, qz = ax * w, az * h, bx * w, bz * h
            mid = cx + (px + qx) / 2
            dx, dz = qx - px, qz - pz
            if facing > 0:
                mid, dx = 2 * x - mid, -dx
            b = box(f'{prefix}.{ch}', (math.hypot(dx, dz) + t, thick, t), loc=(mid, y, z + (pz + qz) / 2))
            rotate(b, y=-math.degrees(math.atan2(dz, dx)))
            assign(b, mat)
            out.append(b)
    return out


def _merlons(prefix, cx, cy, w, d, z, mat, size=0.24, gap=0.44, h=0.24):
    out = []
    for x0, y0, dx, dy, length in ((cx - w / 2, cy + d / 2, 1, 0, w), (cx - w / 2, cy - d / 2, 1, 0, w),
                                   (cx - w / 2, cy - d / 2, 0, 1, d), (cx + w / 2, cy - d / 2, 0, 1, d)):
        n = max(2, int(round(length / gap)) + 1)
        step = length / (n - 1)
        b = box(f'{prefix}.Merlon', (size, size, h), loc=(x0, y0, z + h / 2))
        array(b, n, (step * dx, step * dy, 0))
        assign(b, mat)
        out.append(b)
    return out


def _flag(prefix, loc, h, m, cloth_mat, pole_mat=None, w=0.4, fh=0.25, tri=False):
    pole = _cy(f'{prefix}.Pole', 0.03, h, (loc[0], loc[1], loc[2] + h / 2), pole_mat or m['steel'], segments=8)
    if tri:
        cloth = prism(f'{prefix}.Cloth', [(0, 0), (w, fh / 2), (0, fh)], 0.03,
                      loc=(loc[0] + 0.02, loc[1], loc[2] + h - fh - 0.03), axis='Y')
        assign(cloth, cloth_mat)
    else:
        cloth = _bx(f'{prefix}.Cloth', (w, 0.03, fh), (loc[0] + w / 2 + 0.02, loc[1], loc[2] + h - fh / 2 - 0.03),
                    cloth_mat, r=0.01)
    ball = _sp(f'{prefix}.Ball', 0.05, (loc[0], loc[1], loc[2] + h), m['gold'], segments=10, rings=5)
    return [pole, cloth, ball]


def _checker(prefix, loc, m, cell=0.13, cols=4, rows=3, direction=1):
    out = []
    for i in range(cols):
        for j in range(rows):
            out.append(_bx(f'{prefix}.Cell', (cell, 0.03, cell),
                           (loc[0] + direction * (cell / 2 + i * cell), loc[1], loc[2] - j * cell - cell / 2),
                           m['white'] if (i + j) % 2 == 0 else m['black'], r=0.0))
    return out


def _glass_band(prefix, cx, cy, z, w, h, m, axis='Y', sign=1, pitch=0.45):
    """Continuous glass strip with chrome rails and mullions on a ±Y (or ±X) face."""
    out = []
    n = max(1, int(round(w / pitch)))
    step = w / n
    if axis == 'Y':
        out.append(_bx(f'{prefix}.Glass', (w, 0.06, h), (cx, cy + sign * 0.03, z), m['glass'], r=0))
        rail = _bx(f'{prefix}.Rail', (w + 0.06, 0.08, 0.05), (cx, cy + sign * 0.03, z - h / 2), m['chrome'], r=0)
        array(rail, 2, (0, 0, h))
        mul = _bx(f'{prefix}.Mullion', (0.05, 0.08, h), (cx - w / 2, cy + sign * 0.03, z), m['chrome'], r=0)
        array(mul, n + 1, (step, 0, 0))
    else:
        out.append(_bx(f'{prefix}.Glass', (0.06, w, h), (cx + sign * 0.03, cy, z), m['glass'], r=0))
        rail = _bx(f'{prefix}.Rail', (0.08, w + 0.06, 0.05), (cx + sign * 0.03, cy, z - h / 2), m['chrome'], r=0)
        array(rail, 2, (0, 0, h))
        mul = _bx(f'{prefix}.Mullion', (0.08, 0.05, h), (cx + sign * 0.03, cy - w / 2, z), m['chrome'], r=0)
        array(mul, n + 1, (0, step, 0))
    out += [rail, mul]
    return out


def _grand_door(name, x, y_face, z0, m, frame_mat, width=0.6, height=1.15, canopy=None):
    out = B.door(name, x, y_face, z0, m, frame_mat, width=width, height=height)
    if canopy is not None:
        out.append(_bx(f'{name}.Canopy', (width + 0.5, 0.42, 0.06), (x, y_face + 0.22, z0 + height + 0.3), canopy, r=0.02))
    return out


def _fountain(prefix, loc, m, r=0.36, basin_mat=None, splash='water'):
    """Round basin with a centre jet; `splash='orange'` freezes it as a sculpture of orange balls."""
    out = [_cy(f'{prefix}.Basin', r, 0.26, (loc[0], loc[1], loc[2] + 0.13), basin_mat or m['ivory'], segments=20, r=0.03),
           _cy(f'{prefix}.Water', r - 0.06, 0.06, (loc[0], loc[1], loc[2] + 0.27), m['water'], segments=20),
           _cy(f'{prefix}.Stem', 0.07, 0.35, (loc[0], loc[1], loc[2] + 0.42), m['gold'], segments=10)]
    if splash == 'orange':
        out.append(_cy(f'{prefix}.Jet', 0.05, 0.5, (loc[0], loc[1], loc[2] + 0.8), m['orange'], segments=8, radius2=0.14))
        for i in range(6):
            a = i * math.pi / 3
            rr = 0.22 + (i % 2) * 0.06
            out.append(_sp(f'{prefix}.Ball', 0.07 + (i % 3) * 0.02,
                           (loc[0] + rr * math.cos(a), loc[1] + rr * math.sin(a), loc[2] + 0.95 + (i % 2) * 0.12),
                           m['orange'], segments=10, rings=5))
        out.append(_sp(f'{prefix}.Top', 0.12, (loc[0], loc[1], loc[2] + 1.12), m['orange'], segments=10, rings=5))
    else:
        out.append(_cap(f'{prefix}.Jet', 0.04, 0.45, (loc[0], loc[1], loc[2] + 0.85), m['water'], segments=8, rings=4))
        out.append(_sp(f'{prefix}.Top', 0.09, (loc[0], loc[1], loc[2] + 1.1), m['water'], segments=10, rings=5))
    return out


def _all_meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


# ------------------------------------------------------------ builders ---

def build_driving_center(sx, sz, ex, xx, m):
    """Turbo Campus."""
    P = []
    wsx, wsy = sx - 0.12, sz - 0.12
    front = wsy / 2
    P.append(B.plinth(sx, sz, m))
    h = 3.2
    P.append(B.block('Walls', wsx, wsy, h, 0.12, m))
    top = 0.12 + h
    # Curtain-wall glass bands, two storeys, all faces; the ground band stops short of the doors.
    for f, zc in enumerate((1.05, 2.45)):
        P += _glass_band(f'GF{f}', 0, front, zc, (xx - ex) - 1.1 if f == 0 else wsx - 0.5, 0.8, m)
        P += _glass_band(f'GB{f}', 0, -front, zc, wsx - 0.5, 0.8, m, sign=-1)
        P += _glass_band(f'GL{f}', -wsx / 2, 0, zc, wsy - 0.5, 0.8, m, axis='X', sign=-1)
        P += _glass_band(f'GR{f}', wsx / 2, 0, zc, wsy - 0.5, 0.8, m, axis='X', sign=1)
    P += _grand_door('Entry', ex, front, 0.14, m, m['entry'], canopy=m['chrome'])
    P += _grand_door('Exit', xx, front, 0.14, m, m['exit'], canopy=m['chrome'])
    P += B.flat_roof(wsx, wsy, top, m, mat=m['chrome'])
    deck = top + 0.25
    # Chequered band along the front and back parapets.
    for sgn in (-1, 1):
        n = int((wsx + 0.1) / 0.4)
        x0 = -(n * 0.4) / 2 + 0.1
        w_ = _bx('Parapet.White', (0.2, 0.05, 0.12), (x0, sgn * (front + 0.11), top + 0.2), m['white'], r=0)
        array(w_, n, (0.4, 0, 0))
        k_ = _bx('Parapet.Black', (0.2, 0.05, 0.12), (x0 + 0.2, sgn * (front + 0.11), top + 0.2), m['black'], r=0)
        array(k_, n, (0.4, 0, 0))
        P += [w_, k_]
    # Banked race loop.
    track = _to('Track', 1.0, 0.3, (0, 0, deck + 0.04), m['asphalt'], ms=32, ns=10)
    track.scale = (1.5, 1.0, 0.4)
    kerb = _to('Kerb', 1.27, 0.05, (0, 0, deck + 0.07), m['red'], ms=32, ns=6)
    kerb.scale = (1.5, 1.0, 0.4)
    kerb2 = _to('Kerb2', 0.73, 0.05, (0, 0, deck + 0.07), m['white'], ms=32, ns=6)
    kerb2.scale = (1.5, 1.0, 0.4)
    P += [track, kerb, kerb2]
    zt = deck + 0.16
    # Race car on the loop, front-right, following the tangent.
    phi = math.radians(-55)
    cx, cy = 1.5 * math.cos(phi), 1.0 * math.sin(phi)
    yaw = math.degrees(math.atan2(math.cos(phi), -1.5 * math.sin(phi)))
    ca, sa = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))

    def along(dx, dy, dz):
        return (cx + dx * ca - dy * sa, cy + dx * sa + dy * ca, zt + dz)
    P.append(_bx('Car.Body', (0.72, 0.34, 0.17), along(0, 0, 0.14), m['red'], r=0.04, rot=(0, 0, yaw)))
    P.append(_bx('Car.Nose', (0.3, 0.2, 0.1), along(0.45, 0, 0.1), m['red'], r=0.03, rot=(0, 0, yaw)))
    P.append(_bx('Car.Stripe', (0.7, 0.08, 0.02), along(0, 0, 0.23), m['white'], r=0, rot=(0, 0, yaw)))
    P.append(_cy('Car.Roundel', 0.11, 0.02, along(0.12, 0, 0.235), m['white'], segments=12))
    P.append(_bx('Car.Number', (0.05, 0.12, 0.02), along(0.12, 0, 0.25), m['black'], r=0, rot=(0, 0, yaw)))
    P.append(_sp('Car.Cockpit', 0.11, along(-0.12, 0, 0.25), m['glass'], segments=10, rings=5))
    P.append(_bx('Car.Wing', (0.1, 0.48, 0.06), along(-0.38, 0, 0.33), m['dark'], r=0.01, rot=(0, 0, yaw)))
    for s_ in (-1, 1):
        P.append(_bx('Car.WingPost', (0.04, 0.04, 0.16), along(-0.38, s_ * 0.18, 0.24), m['dark'], r=0, rot=(0, 0, yaw)))
    for i, (dx, dy) in enumerate(((0.24, 0.2), (0.24, -0.2), (-0.24, 0.2), (-0.24, -0.2))):
        P.append(_cy(f'Car.Wheel{i}', 0.09, 0.09, along(dx, dy, 0.09), m['dark'], axis='Y', segments=10, rot=(0, 0, yaw)))
    # Golden trophy in the middle of the loop.
    P.append(_cy('Trophy.Plinth', 0.42, 0.5, (0, 0, deck + 0.25), m['plinth'], segments=20, r=0.04))
    P.append(_cy('Trophy.Base', 0.34, 0.12, (0, 0, deck + 0.56), m['gold'], segments=20, r=0.03))
    P.append(_cy('Trophy.Stem', 0.09, 0.5, (0, 0, deck + 0.87), m['gold'], segments=12))
    P.append(_lathe('Trophy.Cup', [(0, 0), (0.24, 0), (0.3, 0.3), (0.42, 0.85), (0.5, 1.05), (0.42, 1.05), (0.36, 0.95), (0, 0.95)],
                    (0, 0, deck + 1.1), m['gold'], segments=24))
    for s in (-1, 1):
        P.append(_to('Trophy.Handle', 0.2, 0.05, (s * 0.5, 0, deck + 1.65), m['gold'], rot=(90, 0, 0), ms=20, ns=6))
    P.append(_star('Trophy.Star', 5, 0.28, 0.12, 0.08, (0, 0, deck + 2.42), m['gold']))
    # Jumbotron at the back of the roof.
    for s in (-1, 1):
        P.append(_cy(f'Jumbo.Post', 0.06, 2.4, (s * 1.0, -1.05, deck + 1.2), m['chrome'], segments=10))
    P.append(_bx('Jumbo.Frame', (2.6, 0.18, 1.2), (0, -1.05, deck + 2.75), m['dark'], r=0.04))
    P.append(_bx('Jumbo.Screen', (2.4, 0.06, 1.0), (0, -0.96, deck + 2.75), m['glow_screen'], r=0))
    P += _checker('Jumbo.Icon', (-0.55, -0.92, deck + 3.05), m, cell=0.14, cols=3, rows=3)
    P.append(_bx('Jumbo.Bar', (0.9, 0.04, 0.12), (0.55, -0.92, deck + 2.95), m['white'], r=0))
    P.append(_bx('Jumbo.Bar2', (0.6, 0.04, 0.12), (0.4, -0.92, deck + 2.65), m['white'], r=0))
    P.append(_bx('Jumbo.Trim', (2.7, 0.06, 0.08), (0, -1.05, deck + 3.38), m['chrome'], r=0))
    P.append(_bx('Jumbo.Trim2', (2.7, 0.06, 0.08), (0, -1.05, deck + 2.12), m['chrome'], r=0))
    P.append(_star('Jumbo.BackStar', 5, 0.42, 0.18, 0.06, (0, -1.17, deck + 2.75), m['gold']))
    # Chequered-flag poles at the front corners.
    for s in (-1, 1):
        P.append(_cy('Flag.Pole', 0.035, 2.7, (s * 1.85, 1.9, 1.35), m['chrome'], segments=8))
        P += _checker('Flag', (s * 1.85 + s * 0.02, 1.9, 2.68), m, cell=0.13, cols=4, rows=3, direction=s)
        P.append(_sp('Flag.Ball', 0.05, (s * 1.85, 1.9, 2.72), m['gold'], segments=8, rings=4))
    # Tyre-barrier walls along both sides, two high.
    for s in (-1, 1):
        for i in range(5):
            y = -1.1 + i * 0.55
            for j in range(2):
                P.append(_to('Tyre', 0.15, 0.07, (s * 2.32, y, 0.07 + j * 0.14), m['red'] if (i + j) % 2 else m['white'], ms=12, ns=5))
    # 1-2-3 podium between the doors.
    for x, hgt, mat in ((0, 0.5, m['gold']), (-0.5, 0.36, m['silver']), (0.5, 0.26, m['bronze'])):
        P.append(_bx('Podium', (0.48, 0.42, hgt), (x, 1.95, hgt / 2), m['dark'], r=0.03))
        P.append(_bx('Podium.Top', (0.5, 0.44, 0.05), (x, 1.95, hgt + 0.02), mat, r=0.01))
    P += _letters('Podium', '1', 0, 2.17, 0.16, 0.22, m['gold'], thick=0.03)
    pivot('Body', (0, 0, 0), _all_meshes())


def build_blasting_academy(sx, sz, ex, xx, m):
    """The Kaboom Institute."""
    P = []
    st = 0.45
    P.append(_bx('Stylobate', (sx + 0.1, sz + 0.1, st), (0, 0, st / 2), m['ivory'], r=0.04))
    # Staircase down the front, full width.
    for i in range(3):
        zt = st - 0.11 * (i + 1)
        depth = 0.17 * (i + 1)
        P.append(_bx(f'Step{i}', (sx - 0.1, depth, zt), (0, sz / 2 + 0.05 + depth / 2, zt / 2), m['ivory'], r=0.02))
    # Main block behind a portico.
    by = -0.2
    bh = 2.9
    P.append(B.block('Walls', sx - 0.5, sz - 0.7, bh, st, m, loc_xy=(0, by)))
    wall_front = by + (sz - 0.7) / 2
    P += B.door('Entry', ex, wall_front, st, m, m['entry'], width=0.55, height=1.1)
    P += B.door('Exit', xx, wall_front, st, m, m['exit'], width=0.55, height=1.1)
    P += B.windows_row('Win1', sx - 0.5, wall_front, st + 2.15, m, w=0.36, h=0.5, gap=0.6)
    P += B.windows_row('WinB', sx - 0.5, by - (sz - 0.7) / 2, st + 1.0, m, facing=-1)
    P += B.windows_row('WinB1', sx - 0.5, by - (sz - 0.7) / 2, st + 2.15, m, facing=-1)
    for s in (-1, 1):
        P += B.windows_side('WinS', sz - 0.7, s * (sx - 0.5) / 2, st + 1.0, m, facing=s)
        P += B.windows_side('WinS1', sz - 0.7, s * (sx - 0.5) / 2, st + 2.15, m, facing=s)
    # Banner with a "!" between the doors.
    P.append(_bx('Banner', (0.55, 0.05, 1.5), (0, wall_front + 0.04, st + 1.95), m['red'], r=0.01))
    P.append(_bx('Banner.Tail', (0.55, 0.05, 0.12), (0, wall_front + 0.04, st + 1.2), m['gold'], r=0.0))
    P += _letters('Banner', '!', 0, wall_front + 0.08, st + 1.45, 0.9, m['gold'], thick=0.04)
    # Columns, entablature and pediment.
    col_y = sz / 2 - 0.3
    col_h = 2.75
    for x in (-1.45, -0.5, 0.5, 1.45):
        P.append(_cy('Column', 0.13, col_h, (x, col_y, st + col_h / 2), m['ivory'], segments=14))
        P.append(_bx('Column.Cap', (0.36, 0.36, 0.1), (x, col_y, st + col_h + 0.03), m['ivory'], r=0.02))
        P.append(_bx('Column.Base', (0.34, 0.34, 0.08), (x, col_y, st + 0.04), m['ivory'], r=0.02))
    ent_z = st + col_h + 0.08
    P.append(_bx('Entablature', (sx + 0.1, 0.95, 0.36), (0, col_y - 0.2, ent_z + 0.18), m['ivory'], r=0.04))
    P.append(_bx('Entablature.Band', (sx + 0.14, 0.99, 0.08), (0, col_y - 0.2, ent_z + 0.12), m['gold'], r=0.01))
    ped = prism('Pediment', [(-(sx + 0.1) / 2, 0), ((sx + 0.1) / 2, 0), (0, 0.8)], 0.95, loc=(0, col_y - 0.2, ent_z + 0.36), axis='Y')
    bevel(ped, 0.03, 2)
    assign(ped, m['ivory'])
    P.append(ped)
    P.append(_star('Pediment.Star', 8, 0.3, 0.14, 0.06, (0, col_y + 0.29, ent_z + 0.66), m['gold']))
    # Roof over the main block.
    roof_z = st + bh
    P.append(_bx('Cornice', (sx - 0.36, sz - 0.56, 0.12), (0, by, roof_z - 0.04), m['gold'], r=0.02))
    P.append(_bx('Roof', (sx - 0.34, sz - 0.54, 0.16), (0, by, roof_z + 0.1), m['ivory'], r=0.04))
    P.append(_bx('Roof.Inner', (sx - 0.6, sz - 0.8, 0.06), (0, by, roof_z + 0.2), m['dark'], r=0))
    # Hazard band low on the walls, a gold crest on the back.
    bw, bd = sx - 0.5, sz - 0.7
    for face, cx_, cy_, dx, dy, length in (('F', 0, by + bd / 2 + 0.03, 1, 0, bw), ('B', 0, by - bd / 2 - 0.03, 1, 0, bw),
                                           ('L', -bw / 2 - 0.03, by, 0, 1, bd), ('R', bw / 2 + 0.03, by, 0, 1, bd)):
        n = int(length / 0.4)
        start = -(n * 0.4) / 2 + 0.1
        size = (0.2, 0.05, 0.18) if dx else (0.05, 0.2, 0.18)
        yb = _bx(f'Hazard{face}.Y', size, (cx_ + start * dx, cy_ + start * dy, st + 0.3), m['stripe_y'], r=0)
        array(yb, n, (0.4 * dx, 0.4 * dy, 0))
        kb = _bx(f'Hazard{face}.K', size, (cx_ + (start + 0.2) * dx, cy_ + (start + 0.2) * dy, st + 0.3), m['stripe_k'], r=0)
        array(kb, n, (0.4 * dx, 0.4 * dy, 0))
        P += [yb, kb]
    P.append(_cy('Crest.Disc', 0.45, 0.06, (0, by - bd / 2 - 0.03, st + 2.0), m['red'], axis='Y', segments=20))
    P.append(_star('Crest.Star', 8, 0.36, 0.16, 0.06, (0, by - bd / 2 - 0.08, st + 2.0), m['gold']))
    # Mushroom-cloud dome, red smoke over yellow fire.
    dz = roof_z + 0.2
    P.append(_cy('Cloud.Stem', 0.42, 1.1, (0, by, dz + 0.55), m['stripe_y'], segments=20, r=0.05))
    P.append(_sp('Cloud.Fire', 0.9, (0, by, dz + 1.1), m['stripe_y'], scale=(1, 1, 0.42), segments=20, rings=8))
    P.append(_to('Cloud.Ring', 0.75, 0.16, (0, by, dz + 1.05), m['orange'], ms=24, ns=8))
    cap = _sp('Cloud.Cap', 0.98, (0, by, dz + 1.5), m['roof_red'], scale=(1, 1, 0.72), segments=24, rings=12)
    P.append(cap)
    for i in range(5):
        a = i * 2 * math.pi / 5
        P.append(_sp('Cloud.Puff', 0.38, (0.72 * math.cos(a), by + 0.72 * math.sin(a), dz + 1.35), m['roof_red'], segments=14, rings=7))
    P.append(_sp('Cloud.TopPuff', 0.42, (0, by, dz + 1.95), m['roof_red'], segments=14, rings=7))
    # Golden starburst sculpture crowning the cloud.
    sz0 = dz + 2.25
    P.append(_cy('Boom.Post', 0.07, 0.6, (0, by, sz0 - 0.2), m['gold'], segments=8))
    P.append(_star('Boom.Burst', 12, 1.15, 0.55, 0.14, (0, by, sz0 + 0.85), m['gold'], rot=(0, 0, 0)))
    P.append(_star('Boom.Inner', 12, 0.66, 0.32, 0.16, (0, by - 0.02, sz0 + 0.85), m['stripe_y']))
    P.append(_star('Boom.InnerB', 12, 0.66, 0.32, 0.16, (0, by + 0.02, sz0 + 0.85), m['stripe_y']))
    P.append(_sp('Boom.Core', 0.24, (0, by, sz0 + 0.85), m['roof_red'], segments=14, rings=7))
    # Rooftop flags at the back corners.
    for s in (-1, 1):
        P += _flag('RoofFlag', (s * (sx / 2 - 0.45), by - (sz - 0.7) / 2 + 0.3, roof_z + 0.16), 1.2, m, m['red'], pole_mat=m['gold'], tri=True)
    # Frozen-splash fountain on the right flank, dynamite drums on the left.
    P += _fountain('Fountain', (sx / 2 + 0.4, 0.35, 0), m, r=0.38, splash='orange')
    P.append(_to('Fountain.Rim', 0.38, 0.05, (sx / 2 + 0.4, 0.35, 0.27), m['gold'], ms=20, ns=6))
    for s_ in (-1, 1):
        P.append(_sp('Pediment.Finial', 0.09, (s_ * (sx / 2 + 0.02), col_y - 0.2, ent_z + 0.4), m['gold'], segments=10, rings=5))
    P.append(_sp('Pediment.Apex', 0.1, (0, col_y - 0.2, ent_z + 1.18), m['gold'], segments=10, rings=5))
    P += B.barrel('Drum1', (-sx / 2 - 0.35, 0.5, 0), m)
    P += B.barrel('Drum2', (-sx / 2 - 0.35, 0.05, 0), m)
    P += B.barrel('Drum3', (-sx / 2 - 0.35, 0.28, 0.55), m, mat=m['gold'])
    pivot('Body', (0, 0, 0), _all_meshes())


def build_management_office(sx, sz, ex, xx, m):
    """Corner Office Supreme."""
    P = []
    P.append(B.plinth(sx, sz, m))
    tw = sx - 0.4
    th = 6.0
    P.append(B.block('Tower', tw, tw, th, 0.12, m, radius=0.1))
    front = tw / 2
    top = 0.12 + th
    # Glass strips up every face, above the lobby storey.
    for f, (x, y, ax, sg) in enumerate(((0, front, 'Y', 1), (0, -front, 'Y', -1), (-front, 0, 'X', -1), (front, 0, 'X', 1))):
        for i, off in enumerate((-0.8, 0, 0.8)):
            loc = (off, y, 0) if ax == 'Y' else (x, off, 0)
            g = _bx(f'Strip{f}{i}', (0.52, 0.06, 4.3) if ax == 'Y' else (0.06, 0.52, 4.3), (loc[0] + (sg * 0.03 if ax == 'X' else 0), loc[1] + (sg * 0.03 if ax == 'Y' else 0), 3.85),
                    m['glass'], r=0)
            P.append(g)
        for k in range(4):
            zc = 1.75 + k * 1.4
            rail = _bx(f'Rail{f}{k}', (tw, 0.08, 0.06) if ax == 'Y' else (0.08, tw, 0.06),
                       (x + (sg * 0.03 if ax == 'X' else 0), y + (sg * 0.03 if ax == 'Y' else 0), zc), m['chrome'], r=0.01)
            P.append(rail)
    # Lobby: doors and a glass wall between them, gold cornice above.
    P += _grand_door('Entry', ex, front, 0.14, m, m['entry'], canopy=m['gold'])
    P += _grand_door('Exit', xx, front, 0.14, m, m['exit'], canopy=m['gold'])
    P.append(_bx('Lobby.Glass', ((xx - ex) - 1.0, 0.06, 1.0), (0, front + 0.03, 0.75), m['glass'], r=0))
    P.append(_bx('Lobby.Frame', ((xx - ex) - 0.9, 0.08, 0.06), (0, front + 0.03, 1.28), m['gold'], r=0.01))
    P.append(_bx('Cornice', (tw + 0.2, tw + 0.2, 0.12), (0, 0, 1.5), m['gold'], r=0.03))
    # Giant golden dollar on the facade.
    P += _letters('Dollar', '$', 0, front + 0.1, 2.5, 2.0, m['gold'], thick=0.14)
    # Penthouse, gold, with a wraparound glass band.
    pw = 1.9
    P.append(_bx('Penthouse', (pw, pw, 0.95), (0, 0, top + 0.475), m['gold'], r=0.08))
    P.append(_bx('Penthouse.Glass', (pw + 0.06, pw + 0.06, 0.4), (0, 0, top + 0.5), m['dark'], r=0.02))
    P.append(_bx('Penthouse.Roof', (pw + 0.3, pw + 0.3, 0.12), (0, 0, top + 1.0), m['gold'], r=0.04))
    P.append(_bx('TowerRoof', (tw + 0.16, tw + 0.16, 0.14), (0, 0, top + 0.07), m['frame'], r=0.04))
    P.append(_bx('TowerRoof.Lip', (tw + 0.16, tw + 0.16, 0.16), (0, 0, top + 0.16), m['gold'], r=0.03))
    P.append(_bx('TowerRoof.Inner', (tw - 0.1, tw - 0.1, 0.12), (0, 0, top + 0.16), m['dark'], r=0))
    # Helipad on the penthouse.
    hz = top + 1.06
    P.append(_cy('Helipad', 0.95, 0.06, (0, 0, hz + 0.03), m['dark'], segments=28))
    P.append(_to('Helipad.Ring', 0.82, 0.03, (0, 0, hz + 0.06), m['white'], ms=28, ns=6))
    for x in (-0.28, 0.28):
        P.append(_bx('Helipad.H', (0.1, 0.55, 0.03), (x, 0, hz + 0.07), m['white'], r=0))
    P.append(_bx('Helipad.H', (0.5, 0.1, 0.03), (0, 0, hz + 0.07), m['white'], r=0))
    # Helicopter.
    hy = hz + 0.09
    for s in (-1, 1):
        P.append(_bx('Heli.Skid', (1.0, 0.05, 0.05), (0, s * 0.22, hy + 0.03), m['dark'], r=0.01))
        for x in (-0.25, 0.25):
            P.append(_cy('Heli.Strut', 0.02, 0.22, (x, s * 0.22, hy + 0.15), m['dark'], segments=6))
    P.append(_sp('Heli.Cabin', 0.3, (0.05, 0, hy + 0.45), m['red'], scale=(1.35, 0.9, 0.85), segments=18, rings=9))
    P.append(_sp('Heli.Glass', 0.22, (0.3, 0, hy + 0.5), m['glass'], scale=(0.9, 0.8, 0.75), segments=14, rings=7))
    P.append(_cap('Heli.Boom', 0.07, 0.9, (-0.7, 0, hy + 0.5), m['red'], axis='X', segments=10, rings=5))
    P.append(_bx('Heli.Fin', (0.2, 0.04, 0.32), (-1.15, 0, hy + 0.62), m['red'], r=0.01))
    P.append(_cy('Heli.TailRotor', 0.16, 0.03, (-1.15, 0.05, hy + 0.66), m['dark'], axis='Y', segments=12))
    P.append(_cy('Heli.Mast', 0.04, 0.2, (0.05, 0, hy + 0.78), m['dark'], segments=8))
    P.append(_cy('Heli.Hub', 0.08, 0.06, (0.05, 0, hy + 0.9), m['dark'], segments=10))
    P.append(_bx('Heli.Blade', (2.1, 0.09, 0.025), (0.05, 0, hy + 0.9), m['dark'], r=0.005, rot=(0, 0, 25)))
    P.append(_bx('Heli.Blade2', (2.1, 0.09, 0.025), (0.05, 0, hy + 0.91), m['dark'], r=0.005, rot=(0, 0, 115)))
    # Rooftop fountain in the tower-roof corner.
    P += _fountain('RoofFountain', (front - 0.36, front - 0.36, top + 0.22), m, r=0.28, basin_mat=m['gold'])
    # Gold statue of the boss with a coffee mug, by the entrance.
    sy = sz / 2 + 0.45
    P.append(_cy('Statue.Plinth', 0.3, 0.4, (0, sy, 0.2), m['plinth'], segments=16, r=0.03))
    P.append(_bx('Statue.Plaque', (0.3, 0.03, 0.12), (0, sy + 0.3, 0.2), m['gold'], r=0.01))
    P.append(_cap('Statue.Body', 0.17, 0.35, (0, sy, 0.78), m['gold'], segments=14, rings=7))
    P.append(_sp('Statue.Head', 0.15, (0, sy, 1.2), m['gold'], segments=14, rings=7))
    P.append(_bx('Statue.Tie', (0.06, 0.03, 0.22), (0, sy + 0.17, 0.85), m['red'], r=0.01))
    P.append(_cap('Statue.Arm', 0.05, 0.28, (0.2, sy + 0.12, 0.82), m['gold'], rot=(-60, 20, 0), segments=8, rings=4))
    P.append(_cap('Statue.ArmL', 0.05, 0.3, (-0.21, sy, 0.7), m['gold'], rot=(0, 15, 0), segments=8, rings=4))
    P.append(_cy('Statue.Mug', 0.06, 0.12, (0.24, sy + 0.3, 1.0), m['gold'], segments=10))
    P.append(_to('Statue.MugHandle', 0.05, 0.015, (0.31, sy + 0.3, 1.0), m['gold'], rot=(0, 90, 0), ms=10, ns=5))
    # Limousine parked along the right flank.
    lx = sx / 2 + 0.42
    P.append(_bx('Limo.Body', (0.6, 2.25, 0.3), (lx, 0, 0.3), m['black'], r=0.05))
    P.append(_bx('Limo.Cabin', (0.55, 1.3, 0.24), (lx, -0.05, 0.57), m['black'], r=0.06))
    P.append(_bx('Limo.Windows', (0.57, 1.1, 0.12), (lx, -0.05, 0.6), m['glass'], r=0.01))
    P.append(_bx('Limo.Trim', (0.62, 2.27, 0.03), (lx, 0, 0.33), m['gold'], r=0))
    for y in (-0.8, 0.8):
        for s in (-1, 1):
            P.append(_cy('Limo.Wheel', 0.13, 0.08, (lx + s * 0.27, y, 0.15), m['dark'], axis='X', segments=12))
    P.append(_bx('Limo.Lamp', (0.5, 0.04, 0.06), (lx, 1.12, 0.32), m['lamp'], r=0))
    pivot('Body', (0, 0, 0), _all_meshes())


def build_geology_lab(sx, sz, ex, xx, m):
    """Institute of Expensive Rocks."""
    P = []
    P.append(B.plinth(sx, sz, m))
    by = -0.1
    bw, bd, bh = sx - 0.2, sz - 0.4, 3.0
    P.append(B.block('Walls', bw, bd, bh, 0.12, m, loc_xy=(0, by)))
    front = by + bd / 2
    top = 0.12 + bh
    for sxn in (-1, 1):
        for syn in (-1, 1):
            P.append(_bx('Pilaster', (0.22, 0.22, bh), (sxn * (bw / 2 - 0.02), by + syn * (bd / 2 - 0.02), 0.12 + bh / 2), m['ivory'], r=0.03))
    P.append(_bx('Cornice', (bw + 0.2, bd + 0.2, 0.16), (0, by, top + 0.08), m['gold'], r=0.04))
    P.append(_bx('Roof', (bw - 0.1, bd - 0.1, 0.12), (0, by, top + 0.16), m['ivory'], r=0.02))
    P += _grand_door('Entry', ex, front, 0.14, m, m['entry'], width=0.55, height=1.1, canopy=m['gold'])
    P += _grand_door('Exit', xx, front, 0.14, m, m['exit'], width=0.55, height=1.1, canopy=m['gold'])
    P += B.windows_row('Win1', bw, front, 0.12 + 2.25, m, w=0.4, h=0.5, gap=0.65)
    P += B.windows_row('WinB', bw, by - bd / 2, 0.12 + 2.25, m, facing=-1)
    P += B.windows_row('WinB0', bw, by - bd / 2, 0.12 + 0.95, m, facing=-1)
    for s in (-1, 1):
        P += B.windows_side('WinS', bd, s * bw / 2, 0.12 + 2.25, m, facing=s)
    # Gold display cases with gems, between the doors.
    for i, (x, gem) in enumerate(((-0.35, m['red']), (0.35, m['green']))):
        P.append(_bx(f'Case{i}.Pedestal', (0.46, 0.34, 0.62), (x, front + 0.2, 0.14 + 0.31), m['plinth'], r=0.03))
        P.append(_bx(f'Case{i}.Top', (0.5, 0.38, 0.05), (x, front + 0.2, 0.14 + 0.64), m['gold'], r=0.01))
        for dx in (-0.21, 0.21):
            for dy in (-0.15, 0.15):
                P.append(_cy(f'Case{i}.Post', 0.02, 0.6, (x + dx, front + 0.2 + dy, 0.14 + 0.96), m['gold'], segments=6))
        P.append(_bx(f'Case{i}.Lid', (0.5, 0.38, 0.05), (x, front + 0.2, 0.14 + 1.28), m['gold'], r=0.01))
        P.append(_cy(f'Case{i}.GemLow', 0.03, 0.2, (x, front + 0.2, 0.14 + 0.77), gem, segments=6, radius2=0.14))
        P.append(_cy(f'Case{i}.GemHigh', 0.14, 0.14, (x, front + 0.2, 0.14 + 0.94), gem, segments=6, radius2=0.03))
    # Glass pyramid with gold ribs, the glowing diamond on a pedestal through its apex.
    pz = top + 0.22
    half, ph = 1.15, 1.7
    P.append(_pyramid('Pyramid', half, ph, (0, by, pz), m['glass']))
    for sxn in (-1, 1):
        for syn in (-1, 1):
            P.append(_rod('Pyramid.Rib', (sxn * half, by + syn * half, pz), (0, by, pz + ph), 0.035, m['gold']))
    P.append(_bx('Pyramid.Sill', (half * 2 + 0.2, half * 2 + 0.2, 0.1), (0, by, pz + 0.03), m['gold'], r=0.02))
    P.append(_cy('Pedestal', 0.13, 2.4, (0, by, pz + 1.2), m['gold'], segments=12))
    P.append(_cy('Pedestal.Cup', 0.3, 0.12, (0, by, pz + 2.4), m['gold'], segments=12, radius2=0.1))
    gz = pz + 2.45
    P.append(_cy('Diamond.Pavilion', 0.06, 0.62, (0, by, gz + 0.31), m['glow_cyan'], segments=8, radius2=0.78))
    P.append(_cy('Diamond.Crown', 0.78, 0.36, (0, by, gz + 0.8), m['glow_cyan'], segments=8, radius2=0.45))
    P.append(_to('Diamond.Girdle', 0.84, 0.05, (0, by, gz + 0.62), m['gold'], ms=16, ns=6))
    # Price tag hanging off the girdle.
    tag_c = (0.95, by + 1.05, pz + 1.15)
    P.append(_rod('Tag.String', (0.6, by + 0.6, gz + 0.62), (tag_c[0], tag_c[1] - 0.05, tag_c[2] + 0.45), 0.012, m['red'], segments=5))
    tag = prism('Tag', [(-0.55, -0.3), (0.35, -0.3), (0.55, 0), (0.35, 0.3), (-0.55, 0.3)], 0.08, loc=tag_c, axis='Y')
    bevel(tag, 0.02, 2)
    assign(tag, m['white'])
    P.append(tag)
    P.append(_to('Tag.Hole', 0.06, 0.02, (tag_c[0] + 0.35, tag_c[1], tag_c[2]), m['dark'], rot=(90, 0, 0), ms=10, ns=5))
    P += _letters('Tag', '$', tag_c[0] - 0.3, tag_c[1] + 0.06, tag_c[2] - 0.18, 0.36, m['gold'], thick=0.04)
    for i in range(3):
        P.append(_bx('Tag.Digit', (0.12, 0.03, 0.2), (tag_c[0] + 0.0 + i * 0.16 - 0.05, tag_c[1] + 0.06, tag_c[2] - 0.02), m['dark'], r=0))
    # Red laser grid across the plaza.
    ly = sz / 2 + 0.55
    for s in (-1, 1):
        P.append(_cy('Laser.Post', 0.05, 1.2, (s * (sx / 2 + 0.25), ly, 0.6), m['chrome'], segments=8))
        P.append(_sp('Laser.Cap', 0.06, (s * (sx / 2 + 0.25), ly, 1.2), m['glow_red'], segments=8, rings=4))
    for z in (0.3, 0.6, 0.9):
        P.append(_cy('Laser.Beam', 0.018, sx + 0.5, (0, ly, z), m['glow_red'], axis='X', segments=6))
    P.append(_rod('Laser.Diag', (-(sx / 2 + 0.25), ly, 0.15), (sx / 2 + 0.25, ly, 1.05), 0.018, m['glow_red'], segments=6))
    P.append(_rod('Laser.Diag', (sx / 2 + 0.25, ly, 0.15), (-(sx / 2 + 0.25), ly, 1.05), 0.018, m['glow_red'], segments=6))
    # Velvet rope between the doors.
    ry = front + 0.5
    for x in (-0.55, 0, 0.55):
        P.append(_cy('Rope.Post', 0.035, 0.85, (x, ry, 0.425), m['gold'], segments=8))
        P.append(_sp('Rope.Ball', 0.05, (x, ry, 0.87), m['gold'], segments=8, rings=4))
        P.append(_cy('Rope.Foot', 0.1, 0.03, (x, ry, 0.015), m['gold'], segments=10))
    for x in (-0.275, 0.275):
        P.append(_cap('Rope', 0.03, 0.42, (x, ry, 0.72), m['carpet'], axis='X', segments=8, rings=4))
    # Rock samples on gold pedestals at the flanks.
    for i, (x, y) in enumerate(((-(sx / 2 + 0.4), 0.4), (-(sx / 2 + 0.4), -0.5), (sx / 2 + 0.4, -0.2))):
        P.append(_cy(f'Sample{i}.Pedestal', 0.16, 0.5, (x, y, 0.25), m['gold'], segments=12, r=0.02))
        rock = _sp(f'Sample{i}.Rock', 0.2, (x, y, 0.66), m['rock'], scale=(1.2, 1.0, 0.8), segments=12, rings=6)
        rotate(rock, 20 * i, 15, 40 * i)
        P.append(rock)
    # Gold pennant mast at the back.
    P += _flag('Mast', (-(bw / 2 - 0.35), by - bd / 2 + 0.35, top + 0.22), 3.6, m, m['body'], pole_mat=m['gold'], w=0.6, fh=0.35, tri=True)
    pivot('Body', (0, 0, 0), _all_meshes())


def build_research_center(sx, sz, ex, xx, m):
    """The Ivory Crater."""
    P = []
    # The crater: a lathe with an open ivory dish and a type-coloured outer wall.
    bowl = _lathe('Crater', [(0, 0), (1.5, 0), (1.85, 0.6), (2.15, 1.6), (2.15, 1.78), (1.92, 1.78), (1.3, 0.95), (0.8, 0.82), (0, 0.82)],
                  (0, 0, 0), m['body'], segments=40)
    assign(bowl, m['ivory'], [p.index for p in bowl.data.polygons if p.normal.z > 0.35])
    P.append(bowl)
    P.append(_to('Crater.Rim', 2.03, 0.1, (0, 0, 1.78), m['gold'], ms=40, ns=8))
    # Gatehouse across the front carries the doors.
    gy = sz / 2 - 0.55
    P.append(B.block('Gatehouse', sx - 0.4, 1.0, 1.5, 0, m, loc_xy=(0, gy)))
    P.append(_bx('Gatehouse.Top', (sx - 0.3, 1.1, 0.12), (0, gy, 1.5), m['ivory'], r=0.03))
    gf = gy + 0.5
    P += _grand_door('Entry', ex, gf, 0.02, m, m['entry'], width=0.55, height=1.1)
    P += _grand_door('Exit', xx, gf, 0.02, m, m['exit'], width=0.55, height=1.1)
    P.append(_bx('Gatehouse.Glass', ((xx - ex) - 1.0, 0.06, 0.6), (0, gf + 0.03, 0.75), m['glass'], r=0))
    P.append(_bx('Gatehouse.Frame', ((xx - ex) - 0.9, 0.08, 0.05), (0, gf + 0.03, 1.08), m['ivory'], r=0.01))
    # Central tower with ivory bands and a spiral ramp.
    tz0, th = 0.8, 5.7
    P.append(_cy('Tower', 0.55, th, (0, 0, tz0 + th / 2), m['body'], segments=24, r=0.05))
    for z in (2.3, 3.8, 5.3):
        P.append(_to('Tower.Band', 0.55, 0.06, (0, 0, z), m['ivory'], ms=24, ns=6))
        for i in range(4):
            a = i * math.pi / 2 + math.pi / 4
            P.append(_bx('Tower.Win', (0.22, 0.22, 0.3), (0.5 * math.cos(a), 0.5 * math.sin(a), z + 0.5), m['glass'], r=0.01, rot=(0, 0, math.degrees(a))))
    P.append(_cy('Tower.Cap', 0.72, 0.22, (0, 0, tz0 + th + 0.1), m['ivory'], segments=24, r=0.04))
    P.append(_helix('Ramp', 0.5, 1.02, 2.0, 4.2, (0, 0, 1.0), m['ivory'], steps_per_turn=28, thickness=0.1))
    for i in range(3):
        a = math.radians(60 + i * 120)
        zt = 1.0 + 4.2 * ((60 + i * 120) / 720.0 + (0 if i < 2 else 0.0))
        P.append(_cy('Ramp.Post', 0.04, zt - 0.85, (0.95 * math.cos(a), 0.95 * math.sin(a), 0.85 + (zt - 0.85) / 2), m['ivory'], segments=8))
    # Lightbulb dome.
    bz = tz0 + th + 0.2
    P.append(_cy('Bulb.Screw', 0.4, 0.55, (0, 0, bz + 0.27), m['chrome'], segments=20))
    for z in (0.12, 0.3, 0.46):
        P.append(_to('Bulb.Thread', 0.4, 0.035, (0, 0, bz + z), m['dark'], ms=20, ns=6))
    P.append(_sp('Bulb.Glass', 0.88, (0, 0, bz + 1.2), m['glow_warm'], segments=24, rings=12))
    P.append(_cy('Bulb.Neck', 0.42, 0.3, (0, 0, bz + 0.6), m['glow_warm'], segments=20, radius2=0.6))
    # Satellite on a stick.
    sat = Vector((1.35, 0.9, bz + 2.0))
    P.append(_rod('Sat.Stick', (0.5, 0.35, bz + 0.5), sat, 0.03, m['chrome']))
    P.append(_bx('Sat.Body', (0.26, 0.26, 0.26), sat, m['chrome'], r=0.03))
    P.append(_bx('Sat.Panel', (1.1, 0.02, 0.28), sat, m['blue'], r=0, rot=(0, 0, 35)))
    P.append(_cy('Sat.Dish', 0.12, 0.05, (sat.x, sat.y, sat.z + 0.16), m['white'], segments=10, radius2=0.04))
    # Brain sculpture on a pedestal, back-left; telescope dishes on the rim.
    bx_, by_ = -1.62, -1.62
    P.append(_cy('Brain.Pedestal', 0.3, 1.3, (bx_, by_, 0.65), m['ivory'], segments=16, r=0.03))
    P.append(_bx('Brain.Plinth', (0.75, 0.75, 0.12), (bx_, by_, 0.06), m['gold'], r=0.02))
    P.append(_sp('Brain', 0.48, (bx_, by_, 1.65), m['pink'], scale=(1.1, 0.85, 0.75), segments=18, rings=9))
    P.append(_bx('Brain.Groove', (0.04, 0.9, 0.5), (bx_, by_, 1.75), m['carpet'], r=0))
    for i in range(4):
        a = math.radians(30 + i * 80)
        P.append(_cap('Brain.Fold', 0.07, 0.25, (bx_ + 0.4 * math.cos(a), by_ + 0.3 * math.sin(a), 1.8), m['pink'],
                      rot=(0, 90, math.degrees(a) + 30), segments=8, rings=4))
    P += B.dish('Dish1', (1.5, -1.4, 1.78), 0.45, m, yaw=40, tilt=45)
    P += B.dish('Dish2', (-0.4, -2.0, 1.78), 0.38, m, yaw=-160, tilt=50)
    P += B.dish('Dish3', (2.0, 0.4, 1.78), 0.32, m, yaw=100, tilt=55)
    pivot('Body', (0, 0, 0), _all_meshes())


def build_living_quarters(sx, sz, ex, xx, m):
    """Unnecessarily Luxurious Hotel."""
    parts, top, wsx, wsy = B._base(sx, sz, 3, m, floors=3, window_rows=False, entry_x=ex, exit_x=xx)
    P = parts
    front = wsy / 2
    # Gold cornices, balconies with striped awnings on the upper floors.
    for f in range(1, 3):
        zf = 0.12 + B.FLOOR_H * f
        P.append(_bx(f'Cornice{f}', (wsx + 0.12, wsy + 0.12, 0.08), (0, 0, zf), m['gold'], r=0.02))
        for x in (-1.65, -0.55, 0.55, 1.65):
            P.append(_bx('Balc.Win', (0.5, 0.05, 0.7), (x, front + 0.03, zf + 0.85), m['glass'], r=0))
            P.append(_bx('Balc.Frame', (0.58, 0.05, 0.78), (x, front + 0.02, zf + 0.85), m['frame'], r=0.01))
            P.append(_bx('Balc.Slab', (0.75, 0.32, 0.08), (x, front + 0.16, zf + 0.42), m['ivory'], r=0.02))
            P.append(_bx('Balc.Rail', (0.75, 0.04, 0.04), (x, front + 0.3, zf + 0.75), m['gold'], r=0.01))
            for dx in (-0.35, 0, 0.35):
                P.append(_bx('Balc.Post', (0.03, 0.03, 0.32), (x + dx, front + 0.3, zf + 0.6), m['gold'], r=0))
            for i in range(4):
                aw = _bx('Awning', (0.19, 0.4, 0.035), (x - 0.285 + i * 0.19, front + 0.2, zf + 1.28),
                         m['red'] if i % 2 == 0 else m['white'], r=0, rot=(22, 0, 0))
                P.append(aw)
    # Guest windows on the upper floors only: the ground floor is all lobby glass,
    # and dropping that row keeps the hotel inside the per-asset size budget.
    for f in range(1, 3):
        z = 0.12 + B.FLOOR_H * f + 0.85
        P += B.windows_row(f'WinB{f}', wsx, -front, z, m, facing=-1)
        P += B.windows_side(f'WinL{f}', wsy, -wsx / 2, z, m, facing=-1)
        P += B.windows_side(f'WinR{f}', wsy, wsx / 2, z, m, facing=1)
    # Lobby glass between the doors, canopies.
    P.append(_bx('Lobby.Glass', ((xx - ex) - 1.3, 0.06, 0.9), (0, front + 0.03, 0.72), m['glass'], r=0))
    P.append(_bx('Lobby.Frame', ((xx - ex) - 1.2, 0.08, 0.06), (0, front + 0.03, 1.2), m['gold'], r=0.01))
    P.append(_bx('Entry.Canopy', (1.1, 0.5, 0.06), (ex, front + 0.26, 1.42), m['gold'], r=0.02))
    P.append(_bx('Exit.Canopy', (1.1, 0.5, 0.06), (xx, front + 0.26, 1.42), m['gold'], r=0.02))
    # Red carpet down the entry steps.
    P.append(_bx('Step', (1.0, 0.36, 0.14), (ex, front + 0.2, 0.07), m['ivory'], r=0.02))
    P.append(_bx('Carpet', (0.6, 0.34, 0.02), (ex, front + 0.2, 0.15), m['carpet'], r=0))
    P.append(_bx('Carpet2', (0.6, 0.45, 0.02), (ex, front + 0.6, 0.01), m['carpet'], r=0))
    for dx in (-0.42, 0.42):
        P.append(_cy('Rope.Post', 0.03, 0.8, (ex + dx, front + 0.72, 0.4), m['gold'], segments=8))
        P.append(_sp('Rope.Ball', 0.045, (ex + dx, front + 0.72, 0.82), m['gold'], segments=8, rings=4))
    # Valet stand by the exit, fountain in the middle of the forecourt.
    P.append(_bx('Valet', (0.34, 0.3, 0.9), (xx + 0.6, front + 0.5, 0.45), m['dark'], r=0.03))
    P.append(_bx('Valet.Sign', (0.4, 0.04, 0.2), (xx + 0.6, front + 0.67, 0.95), m['gold'], r=0.01))
    P += _fountain('Fountain', (0, front + 0.5, 0), m, r=0.33, basin_mat=m['gold'])
    # Roof: gold parapet, ivory deck.
    P += B.flat_roof(wsx, wsy, top, m, mat=m['gold'])
    deck = top + 0.25
    P.append(_bx('Deck', (wsx - 0.2, wsy - 0.2, 0.04), (0, 0, deck), m['ivory'], r=0))
    # Infinity pool along the back edge with a glass lip.
    py = -front + 0.85
    P.append(_bx('Pool.Coping', (3.2, 1.8, 0.12), (0.2, py, deck + 0.06), m['ivory'], r=0.03))
    P.append(_bx('Pool.Water', (3.0, 1.62, 0.2), (0.2, py, deck + 0.12), m['water'], r=0.02))
    P.append(_bx('Pool.Edge', (3.2, 0.06, 0.55), (0.2, -front - 0.05, deck + 0.24), m['glass'], r=0))
    P.append(_bx('Pool.EdgeRail', (3.24, 0.08, 0.05), (0.2, -front - 0.05, deck + 0.5), m['gold'], r=0.01))
    # Diving board.
    P.append(_cy('Board.Leg', 0.035, 0.6, (-1.0, py + 0.95, deck + 0.3), m['chrome'], segments=8))
    P.append(_cy('Board.Leg2', 0.035, 0.6, (-1.0, py + 1.15, deck + 0.3), m['chrome'], segments=8))
    P.append(_bx('Board', (0.28, 1.1, 0.05), (-1.0, py + 0.6, deck + 0.62), m['white'], r=0.01))
    # Curly slide dropping into the pool.
    slx, sly = 1.85, py - 0.2
    P.append(_helix_tube('Slide', 0.5, 0.13, 1.5, 1.7, (slx, sly, deck + 0.35), m['stripe_y'], steps_per_turn=22))
    P.append(_cy('Slide.Post', 0.06, 2.0, (slx, sly, deck + 1.0), m['chrome'], segments=10))
    P.append(_bx('Slide.Platform', (0.6, 0.6, 0.06), (slx, sly, deck + 2.08), m['ivory'], r=0.02))
    P.append(_bx('Slide.Rail', (0.6, 0.04, 0.3), (slx, sly - 0.3, deck + 2.25), m['gold'], r=0.01))
    P.append(_bx('Slide.Rail2', (0.04, 0.6, 0.3), (slx + 0.3, sly, deck + 2.25), m['gold'], r=0.01))
    P.append(_sp('Slide.Cap', 0.13, (slx + 0.5, sly, deck + 2.05), m['stripe_y'], segments=10, rings=5))
    # Deck chairs, parasol, palm tree.
    for i, x in enumerate((-0.35, 0.3)):
        P.append(_bx(f'Chair{i}', (0.36, 0.7, 0.07), (x, 0.45, deck + 0.14), m['white'], r=0.01))
        P.append(_bx(f'Chair{i}.Back', (0.36, 0.4, 0.05), (x, 0.0, deck + 0.3), m['red' if i else 'blue'], r=0.01, rot=(-55, 0, 0)))
        P.append(_bx(f'Chair{i}.Stripe', (0.12, 0.7, 0.02), (x, 0.45, deck + 0.185), m['red' if i else 'blue'], r=0))
    P.append(_cy('Parasol.Pole', 0.03, 1.5, (1.05, 0.55, deck + 0.75), m['chrome'], segments=8))
    P.append(_cy('Parasol', 0.5, 0.28, (1.05, 0.55, deck + 1.55), m['red'], segments=16, radius2=0.03))
    P.append(_cy('Parasol.Band', 0.5, 0.04, (1.05, 0.55, deck + 1.43), m['white'], segments=16, radius2=0.42))
    trunk = _cy('Palm.Trunk', 0.1, 1.9, (-1.75, 0.65, deck + 0.95), m['wood'], segments=10, radius2=0.07)
    bend(trunk, 25, 'Z')
    P.append(trunk)
    for i in range(6):
        a = i * 60
        leaf = _bx('Palm.Leaf', (0.85, 0.2, 0.03), (-1.75 + 0.4 * math.cos(math.radians(a)), 0.65 + 0.4 * math.sin(math.radians(a)), deck + 1.95),
                   m['green'], r=0.01, rot=(0, 25, a))
        P.append(leaf)
    P.append(_sp('Palm.Coco', 0.08, (-1.7, 0.6, deck + 1.85), m['wood'], segments=8, rings=4))
    P.append(_sp('Palm.Coco2', 0.07, (-1.82, 0.72, deck + 1.83), m['wood'], segments=8, rings=4))
    # Golden HOTEL sign with stars on the front edge of the roof.
    sy_ = front - 0.25
    for x in (-1.2, 1.2):
        P.append(_cy('Sign.Post', 0.05, 0.9, (x, sy_, deck + 0.45), m['gold'], segments=8))
    P.append(_bx('Sign.Panel', (2.9, 0.12, 0.75), (0, sy_, deck + 1.25), m['dark'], r=0.03))
    P.append(_bx('Sign.Trim', (2.98, 0.08, 0.83), (0, sy_ - 0.02, deck + 1.25), m['gold'], r=0.02))
    P += _letters('Sign', 'HOTEL', 0, sy_ + 0.08, deck + 1.0, 0.48, m['gold'], thick=0.06)
    for i in range(5):
        P.append(_star('Sign.Star', 5, 0.15, 0.065, 0.06, (-1.0 + i * 0.5, sy_ + 0.02, deck + 1.82), m['gold']))
    pivot('Body', (0, 0, 0), _all_meshes())


def build_explosive_warehouse(sx, sz, ex, xx, m):
    """Fort Kaboom."""
    P = []
    # Moat ring.
    ox, oy = sx / 2 + 0.75, sz / 2 + 0.65
    ix, iy = sx / 2 + 0.2, sz / 2 + 0.1
    for s in (-1, 1):
        P.append(_bx('Moat', (ox * 2, oy - iy, 0.06), (0, s * (iy + oy) / 2, 0.03), m['water'], r=0))
        P.append(_bx('Moat', (ox - ix, iy * 2, 0.06), (s * (ix + ox) / 2, 0, 0.03), m['water'], r=0))
    # Curtain walls, keep, towers.
    ww, wd, wh = sx - 0.4, sz - 0.6, 2.2
    P.append(B.block('Walls', ww, wd, wh, 0, m, radius=0.06))
    P += _merlons('Wall', 0, 0, ww - 0.1, wd - 0.1, wh, m['body'])
    kw, kd, kh = 2.3, 1.7, 3.5
    P.append(B.block('Keep', kw, kd, kh, 0, m, radius=0.08))
    P += _merlons('Keep', 0, 0, kw - 0.1, kd - 0.1, kh, m['body'], size=0.22, gap=0.4)
    # Hazard band around the keep, a doorway arch on its front.
    P += B.hazard_band('Hazard', kw, kd, wh + 0.5, m, h=0.2)
    twr_y = sz / 2 - 0.45
    twr_h = 3.1
    for s in (-1, 1):
        # Square gate towers on the front carry the doors.
        gx = s * 1.65
        P.append(B.block('GateTower', 1.15, 1.1, twr_h, 0, m, loc_xy=(gx, twr_y), radius=0.06))
        P.append(_cy('GateTower.Roof', 0.85, 1.0, (gx, twr_y, twr_h + 0.5), m['roof'], segments=16, radius2=0.04))
        P += _flag('GateFlag', (gx, twr_y, twr_h + 0.95), 0.7, m, m['stripe_y'], w=0.32, fh=0.2)
        # Round towers at the back.
        rx, ry = s * 1.65, -twr_y
        P.append(_cy('Tower', 0.55, twr_h, (rx, ry, twr_h / 2), m['body'], segments=18, r=0.05))
        P.append(_cy('Tower.Roof', 0.7, 1.0, (rx, ry, twr_h + 0.5), m['roof'], segments=16, radius2=0.04))
        P.append(_to('Tower.Band', 0.55, 0.05, (rx, ry, twr_h - 0.4), m['dark'], ms=18, ns=6))
        P += _flag('TowerFlag', (rx, ry, twr_h + 0.95), 0.7, m, m['stripe_y'], w=0.32, fh=0.2)
    # Black "!" on each flag is a couple of boxes.
    for ob in list(bpy.context.scene.objects):
        if ob.name.startswith(('GateFlag.Cloth', 'TowerFlag.Cloth')):
            x, y, z = ob.location
            P.append(_bx('Flag.Mark', (0.05, 0.04, 0.09), (x, y, z + 0.03), m['black'], r=0))
            P.append(_bx('Flag.Dot', (0.05, 0.04, 0.03), (x, y, z - 0.06), m['black'], r=0))
    gate_face = twr_y + 0.55
    P += B.door('Entry', ex, gate_face, 0.06, m, m['entry'], width=0.6, height=1.25)
    P += B.door('Exit', xx, gate_face, 0.06, m, m['exit'], width=0.6, height=1.25)
    # Drawbridge over the moat from the entry; portcullis bars on the exit.
    plank = _bx('Drawbridge', (0.8, 0.78, 0.07), (ex, gate_face + 0.42, 0.12), m['wood'], r=0.01, rot=(-9, 0, 0))
    P.append(plank)
    for dx in (-0.3, 0.3):
        P.append(_rod('Drawbridge.Chain', (ex + dx, gate_face + 0.78, 0.2), (ex + dx, gate_face + 0.02, 2.0), 0.015, m['dark'], segments=5))
        P.append(_bx('Drawbridge.Band', (0.06, 0.8, 0.02), (ex + dx, gate_face + 0.42, 0.17), m['dark'], r=0, rot=(-9, 0, 0)))
    for dx in (-0.18, 0, 0.18):
        P.append(_bx('Portcullis', (0.04, 0.03, 1.2), (xx + dx, gate_face + 0.09, 0.66), m['steel'], r=0))
    for z in (0.4, 0.8):
        P.append(_bx('Portcullis.Bar', (0.56, 0.03, 0.04), (xx, gate_face + 0.09, z), m['steel'], r=0))
    # Cannons on the front wall.
    for x in (-0.75, 0, 0.75):
        P.append(_bx('Cannon.Carriage', (0.28, 0.36, 0.14), (x, wd / 2 - 0.35, wh + 0.07), m['wood'], r=0.02))
        P.append(_cy('Cannon.Barrel', 0.09, 0.62, (x, wd / 2 - 0.2, wh + 0.28), m['dark'], axis='Y', segments=12, radius2=0.075, rot=(20, 0, 0)))
        for s in (-1, 1):
            P.append(_cy('Cannon.Wheel', 0.1, 0.04, (x + s * 0.15, wd / 2 - 0.4, wh + 0.1), m['dark'], axis='X', segments=10))
    # Searchlight on the keep's back corner.
    P.append(_cy('Search.Base', 0.12, 0.3, (-0.85, -0.55, kh + 0.15), m['steel'], segments=10))
    P.append(_cy('Search.Head', 0.22, 0.4, (-0.85, -0.55, kh + 0.5), m['dark'], axis='Y', segments=14, rot=(-35, 0, 0)))
    P.append(_cy('Search.Lens', 0.19, 0.06, (-0.85, -0.37, kh + 0.62), m['glow_warm'], axis='Y', segments=14, rot=(-35, 0, 0)))
    # The bomb.
    bz = kh + 0.9
    P.append(_sp('Bomb', 1.0, (0, 0, bz), m['black'], segments=28, rings=14))
    P.append(_sp('Bomb.Shine', 0.22, (-0.4, -0.45, bz + 0.55), m['white'], scale=(1.4, 0.8, 0.6), segments=12, rings=6))
    P.append(_cy('Bomb.Cap', 0.25, 0.3, (0, 0, bz + 1.05), m['steel'], segments=14, r=0.03))
    fuse = _cap('Bomb.Fuse', 0.045, 0.75, (0.18, 0.12, bz + 1.55), m['wood'], rot=(-25, 25, 0), segments=8, rings=4)
    P.append(fuse)
    tip = (0.18 + 0.42 * math.sin(math.radians(25)), 0.12 + 0.42 * math.sin(math.radians(25)), bz + 1.55 + 0.42 * math.cos(math.radians(32)))
    P.append(_sp('Bomb.Spark', 0.2, tip, m['glow_orange'], segments=12, rings=6))
    P.append(_star('Bomb.SparkStar', 8, 0.36, 0.17, 0.05, (tip[0], tip[1] - 0.05, tip[2]), m['glow_warm']))
    P.append(_star('Bomb.SparkStar2', 8, 0.36, 0.17, 0.05, (tip[0] - 0.05, tip[1], tip[2]), m['glow_warm'], axis='X'))
    # Bollards and drums by the moat.
    for i in range(3):
        P += B.barrel(f'Drum{i}', (sx / 2 + 0.45, -0.7 + i * 0.5, 0.06), m)
    pivot('Body', (0, 0, 0), _all_meshes())


def build_freight_warehouse(sx, sz, ex, xx, m):
    """Hoarder's Paradise."""
    parts, top, wsx, wsy = B._base(sx, sz, 3, m, floors=2.0, window_rows=False, entry_x=ex, exit_x=xx)
    P = parts
    front = wsy / 2
    P += B.flat_roof(wsx, wsy, top, m)
    deck = top + 0.25
    P += B.hazard_band('Hazard', wsx, wsy, 0.45, m, h=0.18)
    # Big loading door with crates spilling out.
    P.append(_bx('BigDoor', (2.4, 0.06, 2.1), (0, front + 0.02, 0.12 + 1.05), m['dark'], r=0.02))
    P.append(_bx('BigDoor.Frame', (2.6, 0.05, 2.25), (0, front + 0.01, 0.12 + 1.1), m['stripe_y'], r=0.02))
    slat = _bx('BigDoor.Slat', (2.3, 0.03, 0.05), (0, front + 0.06, 0.9), m['steel'], r=0)
    array(slat, 6, (0, 0, 0.22))
    P.append(slat)
    P += B.crate('Spill1', (-0.6, front + 0.5, 0), 0.55, m, rot_z=15)
    P += B.crate('Spill2', (0.15, front + 0.45, 0), 0.5, m, rot_z=-10)
    P += B.crate('Spill3', (-0.25, front + 0.5, 0.55), 0.45, m, rot_z=30)
    P += B.crate('Spill4', (0.9, front + 0.42, 0), 0.4, m, rot_z=5)
    # Crate towers far above the roof, some gold.
    def stack(prefix, x, y, z0, sizes, gold=(), rot0=0, lean=(0.0, 0.0)):
        z = z0
        for i, s in enumerate(sizes):
            c = B.crate(f'{prefix}{i}', (x + lean[0] * i, y + lean[1] * i, z), s, m, rot_z=rot0 + ((i * 7) % 15) - 7)
            if i in gold:
                assign(c[0], m['gold'])
            P.extend(c)
            z += s
        return z
    stack('T1', 0.55, -0.35, deck, (0.72, 0.68, 0.7, 0.66, 0.68, 0.64, 0.6), gold=(3, 6))
    stack('T2', -1.7, 0.9, deck, (0.62, 0.6, 0.58, 0.55, 0.5), gold=(1,))
    stack('T3', 1.9, 1.25, deck, (0.55, 0.52, 0.5, 0.48))
    stack('T4', -1.4, -1.4, deck, (0.6, 0.55))
    stack('T5', -2.0, -0.5, deck, (0.5, 0.48, 0.45), gold=(2,))
    stack('T6', 2.2, -1.5, deck, (0.6,))
    # Leaning stack on the left flank, resting against the wall.
    lx = -sx / 2 - 0.22
    z = 0
    for i, s in enumerate((0.55, 0.55, 0.52, 0.5, 0.48, 0.45)):
        c = B.crate(f'Lean{i}', (lx - 0.045 * i, -0.4 + 0.02 * i, z), s, m, rot_z=8 * (i % 2))
        for ob in c:
            rotate(ob, 0, -4.5 * (i + 1), ob.rotation_euler.z and math.degrees(ob.rotation_euler.z))
        P.extend(c)
        z += s - 0.02
    # Shipping containers: two on the roof, one open with crates pouring out, one on the ground.
    P.append(_bx('Cont1', (1.7, 0.75, 0.75), (0.2, -1.75, deck + 0.375), m['blue'], r=0.03))
    P.append(_bx('Cont2', (1.7, 0.75, 0.75), (0.2, -1.75, deck + 1.125), m['orange'], r=0.03))
    P.append(_bx('Cont2.Lid', (0.7, 0.7, 0.05), (1.3, -1.75, deck + 1.35), m['orange'], r=0.01, rot=(0, -50, 0)))
    P += B.crate('Pour1', (1.35, -1.85, deck + 0.78), 0.3, m, rot_z=20)
    P += B.crate('Pour2', (1.6, -1.6, deck), 0.32, m, rot_z=40)
    for c in ('Cont1', 'Cont2'):
        rib = _bx(f'{c}.Rib', (0.06, 0.78, 0.7), (-0.55, -1.75, deck + (0.375 if c == 'Cont1' else 1.125)), m['dark'], r=0)
        array(rib, 4, (0.5, 0, 0))
        P.append(rib)
    P.append(_bx('Cont3', (0.75, 1.7, 0.75), (sx / 2 + 0.42, 0.3, 0.375), m['red'], r=0.03))
    rib = _bx('Cont3.Rib', (0.78, 0.06, 0.7), (sx / 2 + 0.42, -0.45, 0.375), m['dark'], r=0)
    array(rib, 4, (0, 0.5, 0))
    P.append(rib)
    # "MORE" sign with an arrow on the front parapet.
    P.append(_bx('Sign.Panel', (2.6, 0.12, 0.8), (0, front - 0.12, deck + 0.42), m['red'], r=0.03))
    for x in (-1.15, 1.15):
        P.append(_cy('Sign.Post', 0.05, 0.5, (x, front - 0.12, deck + 0.15), m['dark'], segments=8))
    P += _letters('Sign', 'MORE', -0.3, front - 0.04, deck + 0.18, 0.46, m['gold'], thick=0.06)
    P.append(_bx('Sign.ArrowStem', (0.12, 0.06, 0.32), (0.95, front - 0.04, deck + 0.3), m['gold'], r=0))
    arrow = prism('Sign.ArrowHead', [(-0.22, 0), (0.22, 0), (0, 0.28)], 0.06, loc=(0.95, front - 0.04, deck + 0.46), axis='Y')
    assign(arrow, m['gold'])
    P.append(arrow)
    # Conveyor loop around the main tower, with crates riding it.
    belt = _to('Belt', 1.2, 0.13, (0.55, -0.35, deck + 0.05), m['dark'], ms=32, ns=8)
    belt.scale = (1.0, 1.0, 0.35)
    P.append(belt)
    for a in (40, 150, 250):
        r = math.radians(a)
        P += B.crate('BeltCrate', (0.55 + 1.2 * math.cos(r), -0.35 + 1.2 * math.sin(r), deck + 0.09), 0.28, m, rot_z=a)
    # Gantry crane straddling the roof, still lowering one more crate.
    gz = deck + 4.35
    for x in (-wsx / 2 + 0.3, wsx / 2 - 0.3):
        P.append(_bx('Gantry.Leg', (0.2, 0.2, gz - deck), (x, 0.9, deck + (gz - deck) / 2), m['stripe_y'], r=0.02))
        P.append(_bx('Gantry.Foot', (0.5, 0.5, 0.1), (x, 0.9, deck + 0.05), m['dark'], r=0.02))
    P.append(_bx('Gantry.Beam', (wsx - 0.2, 0.24, 0.26), (0, 0.9, gz + 0.13), m['stripe_y'], r=0.03))
    P.append(_bx('Gantry.Trolley', (0.4, 0.34, 0.25), (1.2, 0.9, gz - 0.02), m['dark'], r=0.03))
    P.append(_cy('Gantry.Cable', 0.02, 1.3, (1.2, 0.9, gz - 0.8), m['dark'], segments=6))
    P.append(_cy('Gantry.Hook', 0.06, 0.12, (1.2, 0.9, gz - 1.5), m['steel'], segments=8))
    c = B.crate('Hanging', (1.2, 0.9, gz - 2.15), 0.58, m, rot_z=12)
    for ob in c:
        assign(ob, m['gold']) if ob.name.startswith('Hanging.Box') else None
    P += c
    # Forklift on the forecourt, nose to the loading door.
    fx, fy = 1.9, front + 0.45
    P.append(_bx('Fork.Body', (0.75, 0.55, 0.4), (fx, fy, 0.38), m['stripe_y'], r=0.04))
    P.append(_bx('Fork.Seat', (0.3, 0.3, 0.25), (fx + 0.1, fy, 0.7), m['dark'], r=0.03))
    for dx in (-0.25, 0.25):
        for s in (-1, 1):
            P.append(_cy('Fork.Wheel', 0.14, 0.1, (fx + dx, fy + s * 0.3, 0.14), m['dark'], axis='Y', segments=12))
    for s in (-1, 1):
        P.append(_bx('Fork.Post', (0.05, 0.05, 1.3), (fx - 0.3, fy + s * 0.22, 0.75), m['dark'], r=0))
        P.append(_bx('Fork.Mast', (0.05, 0.05, 1.5), (fx - 0.45, fy + s * 0.2, 0.75), m['dark'], r=0))
    P.append(_bx('Fork.Roof', (0.7, 0.55, 0.04), (fx - 0.05, fy, 1.4), m['stripe_y'], r=0.01))
    for s in (-1, 1):
        P.append(_bx('Fork.Tine', (0.6, 0.06, 0.03), (fx - 0.75, fy + s * 0.12, 0.08), m['steel'], r=0))
    P += B.crate('Fork.Load', (fx - 0.85, fy, 0.1), 0.42, m)
    pivot('Body', (0, 0, 0), _all_meshes())


def build_vehicle_depot(sx, sz, ex, xx, m):
    """Mecha Hangar."""
    P = []
    P.append(B.plinth(sx, sz, m))
    wsx, wsy = sx - 0.12, sz - 0.12
    wh = 3.4
    z0 = 0.12
    front = wsy / 2
    P.append(_bx('Floor', (wsx - 0.2, wsy - 0.2, 0.06), (0, 0, z0 + 0.03), m['dark'], r=0))
    # Walls: back, sides, and a front split by the bay opening.
    P.append(B.block('WallBack', wsx, 0.28, wh, z0, m, loc_xy=(0, -front + 0.14), radius=0.06))
    for s in (-1, 1):
        P.append(B.block('WallSide', 0.28, wsy, wh, z0, m, loc_xy=(s * (wsx / 2 - 0.14), 0), radius=0.06))
    ow = 3.4
    ph = (wsx - ow) / 2
    for s in (-1, 1):
        P.append(B.block('WallFront', ph, 0.28, wh, z0, m, loc_xy=(s * (ow / 2 + ph / 2), front - 0.14), radius=0.06))
    P.append(B.block('Lintel', ow + 0.2, 0.28, 0.75, z0 + 2.65, m, loc_xy=(0, front - 0.14), radius=0.05))
    P.append(_bx('Lintel.Stripe', (ow + 0.2, 0.05, 0.14), (0, front + 0.02, z0 + 2.72), m['stripe_y'], r=0))
    P += _letters('Pad', '01', 0, front + 0.03, z0 + 2.9, 0.42, m['white'], thick=0.05)
    P += B.door('Entry', ex, front, z0 + 0.02, m, m['entry'], width=0.55, height=1.1)
    P += B.door('Exit', xx, front, z0 + 0.02, m, m['exit'], width=0.55, height=1.1)
    # Blast doors, half open, hazard-striped.
    for s in (-1, 1):
        dx = s * (ow / 2 - 0.55)
        P.append(_bx('BlastDoor', (1.1, 0.14, 2.62), (dx, front + 0.1, z0 + 1.33), m['steel'], r=0.03))
        for i in range(3):
            P.append(_bx('BlastDoor.Stripe', (0.14, 0.03, 1.1), (dx - 0.35 + i * 0.35, front + 0.18, z0 + 0.7), m['stripe_y'], r=0, rot=(0, 40, 0)))
        P.append(_bx('BlastDoor.Bar', (1.0, 0.05, 0.1), (dx, front + 0.18, z0 + 2.0), m['dark'], r=0.01))
        P.append(_bx('BlastDoor.Bar2', (1.0, 0.05, 0.1), (dx, front + 0.18, z0 + 1.6), m['dark'], r=0.01))
    # Rails the doors slide on.
    P.append(_bx('Door.Rail', (ow + 1.0, 0.06, 0.06), (0, front + 0.12, z0 + 2.66), m['dark'], r=0))
    # The mech inside, one arm reaching out through the gap.
    my = -0.55
    P.append(_bx('Mech.Torso', (1.6, 0.9, 1.3), (0, my, z0 + 1.45), m['dark'], r=0.12, seg=3))
    P.append(_bx('Mech.Chest', (0.9, 0.12, 0.7), (0, my + 0.5, z0 + 1.55), m['chrome'], r=0.04))
    P.append(_sp('Mech.Core', 0.15, (0, my + 0.58, z0 + 1.55), m['glow_cyan'], segments=12, rings=6))
    P.append(_bx('Mech.Head', (0.6, 0.55, 0.5), (0, my, z0 + 2.35), m['steel'], r=0.06))
    P.append(_bx('Mech.Visor', (0.44, 0.05, 0.14), (0, my + 0.28, z0 + 2.4), m['glow_cyan'], r=0))
    for s in (-1, 1):
        P.append(_sp('Mech.Shoulder', 0.42, (s * 1.0, my, z0 + 2.05), m['steel'], segments=16, rings=8))
        P.append(_bx('Mech.Leg', (0.5, 0.6, 0.95), (s * 0.45, my, z0 + 0.5), m['steel'], r=0.06))
        P.append(_bx('Mech.Foot', (0.6, 0.75, 0.2), (s * 0.45, my + 0.1, z0 + 0.1), m['dark'], r=0.04))
    elbow = Vector((0.75, 0.55, z0 + 1.55))
    hand = Vector((0.55, front + 0.55, z0 + 1.0))
    P.append(_rod('Mech.UpperArm', (1.0, my, z0 + 2.05), elbow, 0.17, m['steel'], segments=12))
    P.append(_sp('Mech.Elbow', 0.22, elbow, m['dark'], segments=12, rings=6))
    P.append(_rod('Mech.Forearm', elbow, hand, 0.16, m['steel'], segments=12))
    P.append(_sp('Mech.Wrist', 0.2, hand, m['dark'], segments=12, rings=6))
    for a in (-40, 0, 40):
        r = math.radians(a)
        P.append(_bx('Mech.Claw', (0.08, 0.36, 0.1), (hand.x + 0.2 * math.sin(r), hand.y + 0.18, hand.z - 0.25 * math.cos(r) + 0.05), m['dark'], r=0.01, rot=(0, a, 0)))
    # Chamfered roof with cyan light strips.
    rz = z0 + wh
    roof = prism('Roof', [(-front - 0.12, 0), (front + 0.12, 0), (front + 0.12, 0.22), (front - 0.85, 0.95), (-front + 0.85, 0.95), (-front - 0.12, 0.22)],
                 wsx + 0.24, loc=(0, 0, rz), axis='X')
    bevel(roof, 0.04, 3)
    assign(roof, m['roof'])
    P.append(roof)
    for y, z in ((front - 0.85, 0.96), (-front + 0.85, 0.96), (front + 0.1, 0.24), (-front - 0.1, 0.24)):
        P.append(_bx('Roof.Strip', (wsx, 0.07, 0.07), (0, y, rz + z), m['glow_cyan'], r=0))
    for s in (-1, 1):
        P.append(_bx('Roof.Strip', (0.07, 2 * front, 0.07), (s * (wsx / 2 + 0.08), 0, rz + 0.24), m['glow_cyan'], r=0))
    P.append(_bx('Roof.Deck', (wsx - 1.0, 2 * front - 1.9, 0.05), (0, 0, rz + 0.95), m['dark'], r=0))
    # "01" flat on the roof deck.
    zero = _to('Deck.Zero', 0.32, 0.09, (-0.5, 0.2, rz + 0.98), m['white'], ms=20, ns=6)
    zero.scale = (1.0, 1.4, 0.3)
    P.append(zero)
    P.append(_bx('Deck.One', (0.16, 0.85, 0.05), (0.35, 0.2, rz + 0.99), m['white'], r=0))
    P.append(_bx('Deck.OneFoot', (0.16, 0.3, 0.05), (0.2, 0.55, rz + 0.99), m['white'], r=0, rot=(0, 0, 40)))
    # Twin gantry cranes over the roof.
    for x in (-1.7, 1.7):
        for s in (-1, 1):
            P.append(_bx('Gantry.Leg', (0.18, 0.18, 2.3), (x, s * 1.55, rz + 0.3 + 1.15), m['orange'], r=0.02))
        P.append(_bx('Gantry.Beam', (0.2, 3.5, 0.2), (x, 0, rz + 2.65), m['orange'], r=0.03))
        P.append(_bx('Gantry.Trolley', (0.34, 0.4, 0.22), (x, 0.4 * (1 if x > 0 else -1), rz + 2.45), m['dark'], r=0.03))
        P.append(_cy('Gantry.Cable', 0.02, 0.7, (x, 0.4 * (1 if x > 0 else -1), rz + 2.0), m['dark'], segments=6))
        P.append(_cy('Gantry.Hook', 0.06, 0.12, (x, 0.4 * (1 if x > 0 else -1), rz + 1.6), m['steel'], segments=8))
    # Jet-engine vent on the roof, warning beacons, mast.
    vx, vy = -2.1, -0.1
    P.append(_cy('Vent.Housing', 0.62, 0.35, (vx, vy, rz + 1.15), m['steel'], segments=20, r=0.03))
    P.append(_to('Vent.Ring', 0.62, 0.1, (vx, vy, rz + 1.35), m['dark'], ms=20, ns=8))
    P.append(_cy('Vent.Hub', 0.24, 0.45, (vx, vy, rz + 1.45), m['chrome'], segments=12, radius2=0.05))
    for i in range(6):
        P.append(_bx('Vent.Blade', (0.46, 0.09, 0.02), (vx + 0.32 * math.cos(math.radians(i * 60)), vy + 0.32 * math.sin(math.radians(i * 60)), rz + 1.34),
                     m['dark'], r=0, rot=(0, 30, i * 60)))
    for s in (-1, 1):
        P.append(_cy('Beacon.Base', 0.11, 0.2, (s * (wsx / 2 - 0.25), front - 0.25, rz + 0.32), m['dark'], segments=10))
        P.append(_sp('Beacon', 0.13, (s * (wsx / 2 - 0.25), front - 0.25, rz + 0.45), m['glow_orange'], segments=12, rings=6))
    P.append(_cy('Mast', 0.05, 3.2, (2.3, -1.4, rz + 0.5 + 1.6), m['chrome'], segments=8))
    P.append(_sp('Mast.Light', 0.1, (2.3, -1.4, rz + 3.72), m['glow_red'], segments=10, rings=5))
    P.append(_to('Mast.Ring', 0.2, 0.025, (2.3, -1.4, rz + 3.0), m['chrome'], ms=16, ns=6))
    # Landing-strip lights leading to the bay.
    for s in (-1, 1):
        for i in range(4):
            P.append(_cy('Strip.Light', 0.06, 0.06, (s * 1.3, front + 0.25 + i * 0.18, 0.03), m['glow_white'], segments=8))
    P.append(_bx('Strip.Chevron', (0.9, 0.12, 0.02), (-0.4, front + 0.5, 0.01), m['stripe_y'], r=0, rot=(0, 0, 25)))
    P.append(_bx('Strip.Chevron2', (0.9, 0.12, 0.02), (0.4, front + 0.5, 0.01), m['stripe_y'], r=0, rot=(0, 0, -25)))
    pivot('Body', (0, 0, 0), _all_meshes())


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
    d = B._load_defs()[btype]['3']
    sx, sz = d['sizeX'], d['sizeZ']
    ex = d['entry'][0] + 0.5 - sx / 2
    xx = d['exit'][0] + 0.5 - sx / 2
    m = _extra(B._materials(btype))
    BUILDERS[btype](sx, sz, ex, xx, m)
