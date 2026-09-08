"""Tier-1 vehicles — improvised junk that barely works. Same node layout as the tier-2 fleet,
60–85 % of its footprint, cartoon-chunky and readable.

* debris_hauler    — "Dumpster on Wheels": a municipal skip bolted to a rusty go-kart, kitchen-chair seat.
* rock_digger      — "The Scratch": a swivel stool under a beach umbrella, broom-handle boom, frying-pan bucket.
* drill_rig        — "Pokey McPoke": a shopping cart carrying a ladder mast, egg-beater drill, pencil bit.
* building_destroyer — "Wrecking Rascal": a ride-on mower with a plank-and-nails blade, bowling-ball crane, rake ripper.
* rock_fragmenter  — "Cracky": a wheelbarrow-cart with a see-saw sledgehammer, crate hopper, pedal-crank flywheel.
"""
from __future__ import annotations

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from common import (
    _finish, apply_transform, array, assign, assign_by, bevel, box, capsule, cylinder, material, pivot,
    prism, rotate, sphere, torus,
)
from vehicles import _materials, rock_pile, wheel

Vec = Vector


# ----------------------------------------------------------- materials ---

def _materials_t1(body_color: int = 0x5C7A3A) -> dict[str, bpy.types.Material]:
    """Tier-2 palette plus the junkyard: rust, wood, tape, plastic. `TintBody` defaults to a dull, tired paint."""
    body = material('TintBody', body_color, roughness=0.8)
    m = _materials()
    m['body'] = body
    m['rust'] = material('Rust', 0x8B4A1F, roughness=0.95)
    m['rust2'] = material('RustDark', 0x5E3214, roughness=0.95)
    m['wood'] = material('Wood', 0xC9995A, roughness=0.9)
    m['wood2'] = material('WoodDark', 0x8A6236, roughness=0.9)
    m['tape'] = material('DuctTape', 0xA7A9AD, roughness=0.6)
    m['plastic'] = material('Plastic', 0x26262B, roughness=0.7)
    m['cream'] = material('Cream', 0xEADFC4, roughness=0.8)
    m['rope'] = material('Rope', 0xC8A468, roughness=0.95)
    m['white'] = material('White', 0xF2F0EA, roughness=0.8)
    m['pencil'] = material('Pencil', 0xF2B62B, roughness=0.6)
    m['pink'] = material('Eraser', 0xF08A9B, roughness=0.8)
    m['bandaid'] = material('BandAid', 0xE8C39E, roughness=0.9)
    m['bag'] = material('Canvas', 0x6E7A4E, roughness=0.95)
    m['straw'] = material('Straw', 0xD9B65A, roughness=0.95)
    return m


# --------------------------------------------------------------- parts ---

def tape_band(name: str, radius: float, loc, axis: str = 'Z', width: float = 0.06, m=None, rot=None) -> bpy.types.Object:
    """A flat grey duct-tape wrap around a pole of `radius`."""
    band = cylinder(name, radius * 1.18, width, loc=loc, axis=axis, segments=14, rot=rot)
    assign(band, m['tape'])
    return band


def pole(name: str, a: Vector, b: Vector, radius: float, mat, segments: int = 12) -> bpy.types.Object:
    """A straight rod from `a` to `b`."""
    d = b - a
    rod = cylinder(name, radius, d.length, loc=a + d / 2, segments=segments)
    rod.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    assign(rod, mat)
    return rod


def helix(name: str, radius: float, tube: float, turns: float, height: float, loc, m,
          steps_per_turn: int = 12, segments: int = 8) -> bpy.types.Object:
    """A coil spring: a small circle spun around Z while climbing `height`."""
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=False, segments=segments, radius=tube)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((radius, 0, -height / 2)), verts=bm.verts)
    steps = int(turns * steps_per_turn)
    bmesh.ops.spin(bm, geom=bm.verts[:] + bm.edges[:], cent=(0, 0, 0), axis=(0, 0, 1),
                   dvec=(0, 0, height / steps), angle=math.radians(360 * turns), steps=steps, use_merge=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _finish(name, bm, loc, None, None, True, None)
    assign(ob, m['steel'])
    return ob


def bicycle_wheel(name: str, radius: float, loc, m, spokes: int = 8) -> list[bpy.types.Object]:
    """A skinny spoked wheel, axle along Y. Returns parts (not the pivot)."""
    tyre = torus(f'{name}.Tyre', radius - 0.035, 0.035, loc=loc, rot=(90, 0, 0), major_segments=28, minor_segments=8)
    assign(tyre, m['rubber'])
    rim = torus(f'{name}.Rim', radius - 0.065, 0.014, loc=loc, rot=(90, 0, 0), major_segments=28, minor_segments=6)
    assign(rim, m['chrome'])
    hub = cylinder(f'{name}.Hub', 0.05, 0.09, loc=loc, axis='Y', segments=12)
    assign(hub, m['rust'])
    parts = [tyre, rim, hub]
    for i in range(spokes):
        sp = cylinder(f'{name}.Spoke', 0.006, (radius - 0.07) * 2, loc=loc, segments=4, smooth=False)
        rotate(sp, y=180 * i / spokes)
        assign(sp, m['chrome'])
        parts.append(sp)
    return parts


def barrow_wheel(name: str, radius: float, width: float, loc, m) -> list[bpy.types.Object]:
    """A solid-dish wheelbarrow wheel, axle along Y."""
    tyre = cylinder(f'{name}.Tyre', radius, width, loc=loc, axis='Y', segments=24)
    bevel(tyre, radius * 0.25, 3, angle=60)
    assign(tyre, m['rubber'])
    dish = cylinder(f'{name}.Dish', radius * 0.6, width * 1.1, loc=loc, axis='Y', segments=20)
    bevel(dish, radius * 0.1, 2, angle=60)
    assign(dish, m['rust'])
    cap = cylinder(f'{name}.Cap', radius * 0.18, width * 1.3, loc=loc, axis='Y', segments=10)
    assign(cap, m['dark'])
    return [tyre, dish, cap]


def bolt_heads(name: str, locs, m, radius: float = 0.03, axis: str = 'Y') -> list[bpy.types.Object]:
    out = []
    for loc in locs:
        b = cylinder(f'{name}.Bolt', radius, radius * 1.4, loc=loc, axis=axis, segments=6, smooth=False)
        assign(b, m['dark'])
        out.append(b)
    return out


def rust_patch(name: str, size, loc, m, rot=None) -> bpy.types.Object:
    """A flat inset rust panel standing 5 mm proud of a painted surface."""
    p = box(name, size, loc=loc, rot=rot)
    bevel(p, min(size) * 0.45, 2, angle=40)
    assign(p, m['rust'])
    return p


def kitchen_chair(name: str, loc, m, facing: float = 0.0) -> list[bpy.types.Object]:
    """A wooden kitchen chair, seat centre at `loc`, back towards -X (rotated by `facing`)."""
    x, y, z = loc
    parts = []
    seat = box(f'{name}.Seat', (0.42, 0.42, 0.05), loc=(x, y, z))
    bevel(seat, 0.02, 3)
    assign(seat, m['cream'])
    parts.append(seat)
    for dx in (-0.17, 0.17):
        for dy in (-0.17, 0.17):
            leg = cylinder(f'{name}.Leg', 0.025, z - 0.02, loc=(x + dx, y + dy, (z - 0.02) / 2 + 0.0), segments=8)
            assign(leg, m['wood2'])
            parts.append(leg)
    for dy in (-0.17, 0.17):
        post = cylinder(f'{name}.Post', 0.025, 0.55, loc=(x - 0.19, y + dy, z + 0.28), segments=8)
        assign(post, m['wood2'])
        parts.append(post)
    for dz in (0.22, 0.4, 0.55):
        slat = box(f'{name}.Slat', (0.04, 0.36, 0.06), loc=(x - 0.19, y, z + dz))
        bevel(slat, 0.015, 2)
        assign(slat, m['cream'])
        parts.append(slat)
    return parts


def mower_engine(name: str, loc, m, size: float = 1.0) -> list[bpy.types.Object]:
    """A lawn-mower engine block with a pull-start reel and a bent exhaust."""
    x, y, z = loc
    s = size
    block = box(f'{name}.Block', (0.34 * s, 0.3 * s, 0.28 * s), loc=(x, y, z))
    bevel(block, 0.05 * s, 3)
    assign(block, m['rust'])
    fins = box(f'{name}.Fin', (0.36 * s, 0.32 * s, 0.02 * s), loc=(x, y, z + 0.05 * s))
    array(fins, 3, (0, 0, 0.06 * s))
    assign(fins, m['dark'])
    reel = cylinder(f'{name}.Reel', 0.11 * s, 0.05 * s, loc=(x, y, z + 0.18 * s), segments=16)
    bevel(reel, 0.015 * s, 2, angle=60)
    assign(reel, m['plastic'])
    handle = box(f'{name}.PullHandle', (0.1 * s, 0.04 * s, 0.03 * s), loc=(x + 0.16 * s, y, z + 0.2 * s))
    bevel(handle, 0.01 * s, 2)
    assign(handle, m['red'])
    tank = capsule(f'{name}.Tank', 0.07 * s, 0.12 * s, loc=(x - 0.12 * s, y, z + 0.22 * s), axis='X', segments=12, rings=6)
    assign(tank, m['red'])
    cap = cylinder(f'{name}.TankCap', 0.03 * s, 0.03 * s, loc=(x - 0.12 * s, y, z + 0.3 * s), segments=8)
    assign(cap, m['dark'])
    p0 = Vector((x - 0.15 * s, y + 0.08 * s, z - 0.02 * s))
    p1 = p0 + Vector((-0.1 * s, 0.0, 0.0))
    p2 = p1 + Vector((-0.03 * s, 0.02 * s, 0.55 * s))
    pipe1 = pole(f'{name}.Pipe', p0, p1, 0.028 * s, m['dark'])
    pipe2 = pole(f'{name}.Pipe', p1, p2, 0.028 * s, m['dark'])
    elbow = sphere(f'{name}.Elbow', 0.03 * s, loc=p1, segments=10, rings=6)
    assign(elbow, m['dark'])
    tip = cylinder(f'{name}.Tip', 0.04 * s, 0.09 * s, loc=p2 + Vector((-0.005 * s, 0, 0.02 * s)), segments=12)
    assign(tip, m['chrome'])
    return [block, fins, reel, handle, tank, cap, pipe1, pipe2, elbow, tip]


def handlebars(name: str, loc, m, width: float = 0.55, stem: float = 0.35) -> list[bpy.types.Object]:
    """Bicycle handlebars: a stem rising to `loc` and a bar along Y with grips."""
    x, y, z = loc
    parts = []
    st = cylinder(f'{name}.Stem', 0.025, stem, loc=(x, y, z - stem / 2), segments=10)
    assign(st, m['chrome'])
    parts.append(st)
    bar = capsule(f'{name}.Bar', 0.02, width - 0.04, loc=(x, y, z), axis='Y', segments=10, rings=6)
    assign(bar, m['chrome'])
    parts.append(bar)
    for side in (-1, 1):
        grip = cylinder(f'{name}.Grip', 0.03, 0.12, loc=(x, y + side * (width / 2 - 0.06), z), axis='Y', segments=10)
        bevel(grip, 0.008, 2, angle=60)
        assign(grip, m['plastic'])
        parts.append(grip)
    bell = sphere(f'{name}.Bell', 0.03, loc=(x, y - 0.12, z + 0.035), segments=10, rings=6)
    assign(bell, m['chrome'])
    parts.append(bell)
    return parts


def flashlight(name: str, loc, m) -> list[bpy.types.Object]:
    """A torch taped on as a headlight, pointing +X."""
    x, y, z = loc
    body_ = cylinder(f'{name}.Body', 0.035, 0.2, loc=(x, y, z), axis='X', segments=12)
    assign(body_, m['dark'])
    head = cylinder(f'{name}.Head', 0.05, 0.06, loc=(x + 0.12, y, z), axis='X', segments=12, radius2=0.035)
    rotate(head, y=180)
    assign(head, m['dark'])
    lens = cylinder(f'{name}.Lens', 0.043, 0.015, loc=(x + 0.152, y, z), axis='X', segments=12)
    assign(lens, m['lamp'])
    tape = tape_band(f'{name}.Tape', 0.035, (x - 0.03, y, z), axis='X', width=0.05, m=m)
    return [body_, head, lens, tape]


# ------------------------------------------------------------ vehicles ---

def fat_wheel(name: str, radius: float, width: float, loc, m) -> bpy.types.Object:
    """A lighter fat tyre than vehicles.wheel(): 24 segments, five lug bolts. Returns the pivot node."""
    tyre = cylinder(f'{name}.Tyre', radius, width, loc=loc, axis='Y', segments=24)
    bevel(tyre, radius * 0.3, 3, angle=60)
    assign(tyre, m['rubber'])
    hub = cylinder(f'{name}.Hub', radius * 0.5, width * 1.06, loc=loc, axis='Y', segments=16)
    bevel(hub, radius * 0.08, 2, angle=60)
    assign(hub, m['rust'])
    cap = cylinder(f'{name}.Cap', radius * 0.2, width * 1.16, loc=loc, axis='Y', segments=10)
    assign(cap, m['dark'])
    parts = [tyre, hub, cap]
    for i in range(5):
        a = i * 2 * math.pi / 5
        r = radius * 0.32
        parts += bolt_heads(name, [(loc[0] + math.cos(a) * r, loc[1], loc[2] + math.sin(a) * r)], m, radius=radius * 0.06)
    for b in parts[3:]:
        b.scale = (1, width * 1.12 / (radius * 0.06 * 1.4), 1)
    return pivot(name, loc, parts)


def build_debris_hauler(m) -> None:
    """Dumpster on Wheels: a ribbed municipal skip on a rusty go-kart frame, chair + handlebars up front,
    mower engine at the back, four wheels that never met before."""
    body = []
    rail_z = 0.36
    track = 0.47
    wheels = {'WheelFL': (0.78, track, 0.34, 'fat'), 'WheelFR': (0.78, -track, 0.40, 'bike'),
              'WheelRL': (-0.68, track, 0.28, 'barrow'), 'WheelRR': (-0.68, -track, 0.36, 'fat')}
    # Go-kart tube frame: two rails, cross members, a nose loop, a rear engine shelf.
    for side in (-1, 1):
        rail = capsule('Frame.Rail', 0.04, 2.15, loc=(-0.05, side * 0.3, rail_z), axis='X', segments=10, rings=6)
        assign(rail, m['rust'])
        body.append(rail)
    for x in (-1.15, -0.55, 0.1, 0.6, 0.95):
        cross = cylinder('Frame.Cross', 0.035, 0.66, loc=(x, 0, rail_z), axis='Y', segments=10)
        assign(cross, m['rust'])
        body.append(cross)
    nose = torus('Frame.Nose', 0.3, 0.04, loc=(1.02, 0, rail_z), major_segments=20, minor_segments=6)
    nose.scale = (0.5, 1.0, 1.0)
    assign(nose, m['rust'])
    body.append(nose)
    floor = box('Frame.Floor', (0.9, 0.56, 0.03), loc=(0.55, 0, rail_z + 0.03))
    bevel(floor, 0.01, 2)
    assign(floor, m['rust2'])
    body.append(floor)
    shelf = box('Frame.Shelf', (0.42, 0.5, 0.03), loc=(-1.04, 0, rail_z + 0.03))
    bevel(shelf, 0.01, 2)
    assign(shelf, m['rust2'])
    body.append(shelf)
    # Axle stubs and drop brackets out to each mismatched wheel.
    for name, (x, y, r, kind) in wheels.items():
        sgn = 1 if y > 0 else -1
        stub = cylinder('Frame.Axle', 0.03, abs(y) - 0.26, loc=(x, sgn * (abs(y) + 0.26) / 2, r), axis='Y', segments=8)
        assign(stub, m['dark'])
        body.append(stub)
        drop = box('Frame.Drop', (0.14, 0.06, abs(r - rail_z) + 0.1), loc=(x, sgn * 0.3, (r + rail_z) / 2))
        bevel(drop, 0.015, 2)
        assign(drop, m['rust'])
        body.append(drop)
    # Driver's kitchen chair, bicycle handlebars, a flashlight taped on for a headlight.
    body += kitchen_chair('Chair', (0.6, 0, 0.76), m)
    body += handlebars('Bars', (0.98, 0, 1.02), m, width=0.6, stem=0.62)
    body += flashlight('Torch', (1.02, 0, 0.62), m)
    bracket = box('Torch.Bracket', (0.05, 0.05, 0.22), loc=(1.02, 0, 0.5))
    assign(bracket, m['rust'])
    body.append(bracket)
    # Lawn-mower engine on the rear shelf, exhaust bent up past the skip.
    body += mower_engine('Engine', (-1.04, 0.02, rail_z + 0.2), m, size=0.95)
    pivot('Body', (0, 0, 0), body)

    # The skip is the tipping bed: a trapezoid tub, ribbed, hinged at its rear edge.
    bed = []
    z0 = rail_z + 0.06
    skip_w, skip_h = 1.0, 0.9
    outline = [(-0.56, 0.0), (0.56, 0.0), (0.7, skip_h), (-0.7, skip_h)]
    cx = -0.3
    tub = prism('Skip.Tub', outline, skip_w, loc=(cx, 0, z0), axis='Y')
    bevel(tub, 0.04, 3)
    assign(tub, m['body'])
    bed.append(tub)
    # Dent: a flat dark scrape oval on the left flank.
    dent = sphere('Skip.Dent', 0.16, loc=(cx + 0.28, skip_w / 2 + 0.004, z0 + 0.34), scale=(1.3, 0.06, 0.8), segments=14, rings=8)
    assign(dent, m['rust2'])
    bed.append(dent)
    # Top rim lip (four bars), vertical ribs on both flanks, a bottom rail, fork pockets.
    for side in (-1, 1):
        lip = box('Skip.Lip', (1.44, 0.09, 0.07), loc=(cx, side * (skip_w / 2 + 0.005), z0 + skip_h))
        bevel(lip, 0.025, 2)
        assign(lip, m['body'])
        bed.append(lip)
        lip2 = box('Skip.Lip', (0.09, skip_w + 0.08, 0.07), loc=(cx + side * 0.675, 0, z0 + skip_h))
        bevel(lip2, 0.025, 2)
        assign(lip2, m['body'])
        bed.append(lip2)
        rib = box('Skip.Rib', (0.07, 0.04, skip_h - 0.12), loc=(cx - 0.44, side * (skip_w / 2 + 0.02), z0 + skip_h / 2 - 0.03))
        array(rib, 5, (0.22, 0, 0))
        bevel(rib, 0.012, 1)
        assign(rib, m['rust2'])
        bed.append(rib)
        rail = box('Skip.Rail', (1.16, 0.05, 0.07), loc=(cx, side * (skip_w / 2 + 0.02), z0 + 0.12))
        bevel(rail, 0.015, 2)
        assign(rail, m['rust2'])
        bed.append(rail)
        pocket = box('Skip.ForkPocket', (0.16, skip_w + 0.12, 0.13), loc=(cx + side * 0.32, 0, z0 + 0.16))
        bevel(pocket, 0.02, 2)
        assign(pocket, m['rust'])
        bed.append(pocket)
    # Rust: flat inset panels on the flanks and the back.
    bed.append(rust_patch('Skip.Rust', (0.3, 0.012, 0.2), (cx - 0.2, -(skip_w / 2 + 0.006), z0 + 0.55), m))
    bed.append(rust_patch('Skip.Rust', (0.14, 0.012, 0.11), (cx + 0.4, -(skip_w / 2 + 0.006), z0 + 0.3), m))
    bed.append(rust_patch('Skip.Rust', (0.014, 0.24, 0.2), (cx - 0.635, 0.12, z0 + 0.45), m, rot=(0, -9, 0)))
    bed.append(rust_patch('Skip.Rust', (0.012, 0.18, 0.13), (cx - 0.08, skip_w / 2 + 0.006, z0 + 0.66), m))
    plate = box('Skip.Plate', (0.3, 0.012, 0.15), loc=(cx + 0.24, skip_w / 2 + 0.006, z0 + 0.64))
    bevel(plate, 0.01, 2)
    assign(plate, m['white'])
    bed.append(plate)
    # Two black plastic lids, each hinged on its own long edge and meeting in the middle;
    # the left one propped open on a broom stick, rocks spilling over.
    hinge_z = z0 + skip_h + 0.06
    lid_w = skip_w / 2 + 0.08
    for side, ang in ((-1, 0.0), (1, 76.0)):
        hinge_y = side * (skip_w / 2 + 0.04)
        lid = box('Skip.Lid', (1.5, lid_w, 0.07), loc=(cx, hinge_y - side * lid_w / 2, hinge_z + 0.035))
        bevel(lid, 0.03, 3)
        assign(lid, m['plastic'])
        grip = box('Skip.LidGrip', (0.3, 0.06, 0.05), loc=(cx, hinge_y - side * (lid_w - 0.04), hinge_z + 0.09))
        bevel(grip, 0.015, 2)
        assign(grip, m['plastic'])
        rib = box('Skip.LidRib', (0.05, lid_w - 0.12, 0.03), loc=(cx - 0.5, hinge_y - side * lid_w / 2, hinge_z + 0.08))
        array(rib, 5, (0.25, 0, 0))
        assign(rib, m['plastic'])
        hinge = cylinder('Skip.Hinge', 0.035, 1.4, loc=(cx, hinge_y, hinge_z), axis='X', segments=10)
        assign(hinge, m['dark'])
        for ob in (lid, grip, rib):
            if ang:
                # Lift the free edge: rotate about the hinge line (parallel to X).
                h = Vector((ob.location.x, hinge_y, hinge_z))
                ob.location = h + Matrix.Rotation(math.radians(-side * ang), 3, 'X') @ (ob.location - h)
                rotate(ob, x=-side * ang)
        bed += [lid, grip, rib, hinge]
        if ang:
            # Broom stick wedged between the far rim and the lid's underside.
            under = Vector((cx + 0.35, hinge_y, hinge_z)) + Matrix.Rotation(math.radians(-side * ang), 3, 'X') @ Vector((0, -side * 0.42, -0.04))
            foot = Vector((cx + 0.35, -side * (skip_w / 2 - 0.08), z0 + skip_h + 0.02))
            bed.append(pole('Skip.Prop', foot, under, 0.022, m['wood'], segments=8))
            bed.append(tape_band('Skip.PropTape', 0.022, under - (under - foot).normalized() * 0.08, m=m,
                                 rot=[math.degrees(a) for a in (under - foot).to_track_quat('Z', 'Y').to_euler()]))
    # Rock load: a heap under the open lid, a few tumbling over the rim.
    bed += rock_pile('Skip.Load', (cx - 0.05, 0.1, z0 + skip_h - 0.02), (0.4, 0.2), m, count=7, seed=11)
    rnd = random.Random(5)
    for i, (dx, dy, dz) in enumerate(((-0.5, 0.44, 0.1), (0.05, 0.47, 0.12), (-0.62, 0.15, 0.12), (-0.25, 0.1, 0.24), (0.3, 0.32, 0.14))):
        r = rnd.uniform(0.11, 0.16)
        rock = sphere('Skip.Spill', r, loc=(cx + dx, dy, z0 + skip_h + dz), scale=(1.2, 0.9, 0.75), segments=12, rings=7)
        rotate(rock, rnd.uniform(0, 40), rnd.uniform(0, 40), rnd.uniform(0, 180))
        assign(rock, m['rock'] if i % 2 else m['rock2'])
        bed.append(rock)
    pivot('Bed', (cx - 0.62, 0, z0), bed)

    # Four mismatched wheels.
    for name, (x, y, r, kind) in wheels.items():
        if kind == 'fat':
            fat_wheel(name, r, 0.28, (x, y, r), m)
        elif kind == 'bike':
            pivot(name, (x, y, r), bicycle_wheel(name, r, (x, y, r), m))
        else:
            pivot(name, (x, y, r), barrow_wheel(name, r, 0.15, (x, y, r), m))


def umbrella(name: str, base: Vector, top: Vector, radius: float, m) -> list[bpy.types.Object]:
    """A beach umbrella: a leaning pole, an eight-panel red/white cone canopy with a chunky rim and a finial."""
    parts = [pole(f'{name}.Pole', base, top, 0.03, m['steel'], segments=10)]
    canopy = cylinder(f'{name}.Canopy', radius, 0.36, loc=top - Vector((0, 0, 0.18)), segments=8, radius2=0.03)
    assign(canopy, m['white'])
    assign_by(canopy, m['red'], lambda c: c.z > -0.17 and int((math.atan2(c.y, c.x) + math.pi) / (math.pi / 4)) % 2 == 0)
    parts.append(canopy)
    rim = torus(f'{name}.Rim', radius - 0.02, 0.04, loc=top - Vector((0, 0, 0.36)), major_segments=24, minor_segments=8)
    assign(rim, m['white'])
    parts.append(rim)
    finial = sphere(f'{name}.Finial', 0.05, loc=top + Vector((0, 0, 0.03)), segments=10, rings=6)
    assign(finial, m['red'])
    parts.append(finial)
    return parts


def build_rock_digger(m) -> None:
    """The Scratch: a swivel stool in a wheelbarrow under a beach umbrella; broom-handle boom, mop-handle stick,
    a frying pan for a bucket, all held with duct tape."""
    body = []
    tray_z, tray_h, tray_w = 0.36, 0.44, 0.84
    outline = [(-0.5, 0.0), (0.42, 0.0), (0.58, 0.16), (0.6, tray_h), (-0.6, tray_h)]
    tray = prism('Tray.Tub', outline, tray_w, loc=(0, 0, tray_z), axis='Y')
    bevel(tray, 0.04, 3)
    assign(tray, m['body'])
    body.append(tray)
    floor = box('Tray.Floor', (1.0, tray_w - 0.12, 0.03), loc=(0, 0, tray_z + tray_h - 0.06))
    assign(floor, m['rust2'])
    body.append(floor)
    for side in (-1, 1):
        lip = box('Tray.Lip', (1.24, 0.07, 0.06), loc=(0, side * (tray_w / 2 + 0.005), tray_z + tray_h))
        bevel(lip, 0.02, 2)
        assign(lip, m['body'])
        body.append(lip)
    body.append(rust_patch('Tray.Rust', (0.26, 0.012, 0.16), (0.1, -(tray_w / 2 + 0.006), tray_z + 0.22), m))
    body.append(rust_patch('Tray.Rust', (0.16, 0.012, 0.1), (-0.32, tray_w / 2 + 0.006, tray_z + 0.3), m))
    body.append(rust_patch('Tray.Rust', (0.012, 0.2, 0.14), (0.61, 0.12, tray_z + 0.3), m, rot=(0, -6, 0)))
    # Wheelbarrow running gear: one dish wheel up front on a fork, two stubby legs behind, two wooden handles.
    wheel_loc = (0.62, 0, 0.3)
    body += barrow_wheel('Wheel', 0.3, 0.16, wheel_loc, m)
    for side in (-1, 1):
        fork = box('Fork', (0.5, 0.05, 0.08), loc=(0.42, side * 0.14, 0.34))
        rotate(fork, y=-8)
        bevel(fork, 0.015, 2)
        assign(fork, m['rust'])
        body.append(fork)
        leg = box('Leg', (0.07, 0.07, 0.38), loc=(-0.38, side * 0.3, 0.19))
        bevel(leg, 0.015, 2)
        assign(leg, m['rust'])
        body.append(leg)
        foot = box('Foot', (0.16, 0.1, 0.04), loc=(-0.38, side * 0.3, 0.02))
        bevel(foot, 0.012, 2)
        assign(foot, m['dark'])
        body.append(foot)
        handle = capsule('Handle', 0.035, 0.9, loc=(-0.72, side * 0.34, tray_z + 0.1), axis='X', segments=10, rings=6)
        rotate(handle, y=-8)
        assign(handle, m['wood'])
        body.append(handle)
        grip = cylinder('Handle.Grip', 0.045, 0.16, loc=(-1.1, side * 0.34, tray_z + 0.15), axis='X', segments=10)
        rotate(grip, y=-8)
        assign(grip, m['plastic'])
        body.append(grip)
    # Swivel stool with a rusty tractor seat, planted in the tray.
    base = cylinder('Stool.Base', 0.18, 0.04, loc=(-0.18, -0.02, tray_z + tray_h - 0.03), segments=16)
    assign(base, m['steel'])
    body.append(base)
    post = cylinder('Stool.Post', 0.035, 0.34, loc=(-0.18, -0.02, tray_z + tray_h + 0.12), segments=10)
    assign(post, m['chrome'])
    body.append(post)
    seat = cylinder('Stool.Seat', 0.24, 0.06, loc=(-0.18, -0.02, tray_z + tray_h + 0.32), segments=18)
    bevel(seat, 0.025, 3, angle=60)
    assign(seat, m['rust'])
    body.append(seat)
    back = box('Stool.Back', (0.05, 0.36, 0.22), loc=(-0.38, -0.02, tray_z + tray_h + 0.46))
    bevel(back, 0.02, 2)
    rotate(back, y=-12)
    assign(back, m['rust'])
    body.append(back)
    # Control lever: a stick with a doorknob, and a cinder block counterweight behind the seat.
    lever_a = Vector((0.15, -0.16, tray_z + tray_h - 0.02))
    lever_b = lever_a + Vector((0.12, 0, 0.55))
    body.append(pole('Lever', lever_a, lever_b, 0.02, m['wood2'], segments=8))
    knob = sphere('Lever.Knob', 0.05, loc=lever_b, segments=10, rings=6)
    assign(knob, m['chrome'])
    body.append(knob)
    block = box('Counterweight', (0.2, 0.4, 0.2), loc=(-0.44, -0.1, tray_z + tray_h + 0.05))
    bevel(block, 0.01, 1)
    assign(block, m['rock'])
    body.append(block)
    for dy in (-0.08, 0.08):
        hole = box('Counterweight.Hole', (0.21, 0.1, 0.12), loc=(-0.44, -0.1 + dy, tray_z + tray_h + 0.09))
        assign(hole, m['rock2'])
        body.append(hole)
    # Beach umbrella, leaning, taped to the tray's back-left corner.
    ub = Vector((-0.44, 0.34, tray_z + 0.05))
    ut = Vector((-0.22, 0.26, 2.2))
    body += umbrella('Umbrella', ub, ut, 0.72, m)
    body.append(tape_band('Umbrella.Tape', 0.03, ub + (ut - ub).normalized() * 0.45, m=m, width=0.08,
                          rot=[math.degrees(a) for a in (ut - ub).to_track_quat('Z', 'Y').to_euler()]))
    pivot('Body', (0, 0, 0), body)

    # Boom: a broom handle, brush still on as a counterweight, hinged on a bracket at the tray's front lip.
    boom_pivot = Vector((0.5, -0.2, tray_z + tray_h + 0.12))
    bracket = box('Boom.Bracket', (0.12, 0.08, 0.2), loc=(0.5, -0.2, tray_z + tray_h + 0.02))
    bevel(bracket, 0.015, 2)
    assign(bracket, m['rust'])
    boom_dir = Vector((math.cos(math.radians(48)), 0, math.sin(math.radians(48))))
    boom_len = 1.05
    boom_tip = boom_pivot + boom_dir * boom_len
    boom = pole('Boom.Handle', boom_pivot - boom_dir * 0.35, boom_tip, 0.052, m['wood'], segments=12)
    pin = cylinder('Boom.Pin', 0.05, 0.14, loc=boom_pivot, axis='Y', segments=10)
    assign(pin, m['dark'])
    brush_c = boom_pivot - boom_dir * 0.42
    brush = box('Boom.BrushBlock', (0.1, 0.34, 0.08), loc=brush_c)
    bevel(brush, 0.015, 2)
    rotate(brush, y=-48)
    assign(brush, m['wood2'])
    bristles = box('Boom.Bristles', (0.14, 0.32, 0.18), loc=brush_c - boom_dir * 0.1 + Vector((0.0, 0, -0.04)))
    bevel(bristles, 0.02, 2)
    rotate(bristles, y=-48)
    assign(bristles, m['straw'])
    boom_parts = [bracket, boom, pin, brush, bristles]
    boom_parts.append(tape_band('Boom.Tape', 0.045, boom_pivot + boom_dir * 0.08, m=m, width=0.09,
                                rot=[math.degrees(a) for a in boom_dir.to_track_quat('Z', 'Y').to_euler()]))
    boom_parts.append(tape_band('Boom.Tape', 0.045, boom_pivot + boom_dir * 0.2, m=m, width=0.07,
                                rot=[math.degrees(a) for a in boom_dir.to_track_quat('Z', 'Y').to_euler()]))
    # Pull rope from the lever knob to the boom.
    boom_parts.append(pole('Boom.Rope', lever_b + Vector((0.02, -0.02, 0)), boom_pivot + boom_dir * 0.5, 0.012, m['rope'], segments=6))
    pivot('Boom', boom_pivot, boom_parts)

    # Stick: a mop handle lashed to the broom tip, hanging down-forward.
    stick_pivot = boom_tip
    stick_dir = Vector((math.cos(math.radians(-58)), 0, math.sin(math.radians(-58))))
    stick_len = 0.95
    stick_tip = stick_pivot + stick_dir * stick_len
    stick = pole('Stick.Handle', stick_pivot - stick_dir * 0.12, stick_tip, 0.046, m['wood2'], segments=12)
    knot = sphere('Stick.Knot', 0.09, loc=stick_pivot, segments=12, rings=8)
    assign(knot, m['tape'])
    stick_parts = [stick, knot]
    for t in (0.28, 0.62):
        stick_parts.append(tape_band('Stick.Tape', 0.04, stick_pivot + stick_dir * t, m=m, width=0.07,
                                     rot=[math.degrees(a) for a in stick_dir.to_track_quat('Z', 'Y').to_euler()]))
    pivot('Stick', stick_pivot, stick_parts)

    # Bucket: a frying pan, handle taped up the stick, dish tilted to scoop forward.
    bucket_pivot = stick_tip
    pan_dir = Vector((math.cos(math.radians(-25)), 0, math.sin(math.radians(-25))))  # dish normal
    pan_c = bucket_pivot + Vector((0.2, 0, -0.16))
    pan_rot = [math.degrees(a) for a in pan_dir.to_track_quat('Z', 'Y').to_euler()]
    disc = cylinder('Bucket.Pan', 0.3, 0.035, loc=pan_c, segments=24, rot=pan_rot)
    bevel(disc, 0.012, 2, angle=60)
    assign(disc, m['dark'])
    rimt = torus('Bucket.Rim', 0.29, 0.03, loc=pan_c + pan_dir * 0.05, rot=pan_rot, major_segments=24, minor_segments=8)
    assign(rimt, m['dark'])
    wall = cylinder('Bucket.Wall', 0.31, 0.1, loc=pan_c + pan_dir * 0.03, segments=24, rot=pan_rot)
    assign(wall, m['dark'])
    handle = box('Bucket.Handle', (0.08, 0.06, 0.4), loc=bucket_pivot + Vector((0.02, 0, 0.02)))
    bevel(handle, 0.015, 2)
    rotate(handle, y=-32)
    assign(handle, m['plastic'])
    bucket_parts = [disc, rimt, wall, handle]
    bucket_parts.append(tape_band('Bucket.Tape', 0.05, bucket_pivot + Vector((0.0, 0, 0.06)), m=m, width=0.08, rot=(0, -32, 0)))
    bucket_parts += rock_pile('Bucket.Scoop', pan_c + pan_dir * 0.12, (0.1, 0.1), m, count=3, seed=4)
    pivot('Bucket', bucket_pivot, bucket_parts)


def hex_pencil(name: str, top: Vector, bottom: Vector, radius: float, m) -> list[bpy.types.Object]:
    """A giant chewed pencil pointing from `top` (eraser) to `bottom` (graphite tip)."""
    d = bottom - top
    n = d.normalized()
    rot = (-n).to_track_quat('Z', 'Y').to_euler()
    length = d.length
    tip_len = radius * 3.2
    body_len = length - tip_len - radius * 1.6
    body_c = top + n * (radius * 1.6 + body_len / 2)
    shaft = cylinder(f'{name}.Shaft', radius, body_len, loc=body_c, segments=6, smooth=False)
    shaft.rotation_euler = rot
    assign(shaft, m['pencil'])
    ferrule = cylinder(f'{name}.Ferrule', radius * 1.06, radius * 0.9, loc=top + n * (radius * 1.15), segments=12)
    ferrule.rotation_euler = rot
    assign(ferrule, m['chrome'])
    eraser = cylinder(f'{name}.Eraser', radius * 1.0, radius * 0.8, loc=top + n * (radius * 0.4), segments=12)
    bevel(eraser, radius * 0.25, 2, angle=60)
    eraser.rotation_euler = rot
    assign(eraser, m['pink'])
    cone_c = top + n * (length - tip_len / 2)
    cone = cylinder(f'{name}.Cone', radius, tip_len, loc=cone_c, segments=12, radius2=radius * 0.3)
    cone.rotation_euler = rot
    assign(cone, m['cream'])
    point = cylinder(f'{name}.Point', radius * 0.3, radius * 0.9, loc=top + n * (length - radius * 0.45), segments=8, radius2=0.005)
    point.rotation_euler = rot
    assign(point, m['dark'])
    parts = [shaft, ferrule, eraser, cone, point]
    # Bite marks: flat dark dents on the shaft.
    rnd = random.Random(9)
    for i in range(6):
        t = radius * 3 + body_len * (0.12 + 0.14 * i)
        a = rnd.uniform(0, 2 * math.pi)
        side = Vector((math.cos(a), math.sin(a), 0))
        if abs(n.z) < 0.99:
            side = n.cross(Vector((0, 0, 1))).normalized() * math.cos(a) + n.cross(n.cross(Vector((0, 0, 1)))).normalized() * math.sin(a)
        c = top + n * t + side * radius * 0.86
        dent = sphere(f'{name}.Bite', radius * 0.55, loc=c, scale=(1, 1.3, 0.5), segments=10, rings=5)
        dent.rotation_euler = side.to_track_quat('Z', 'Y').to_euler()
        assign(dent, m['wood2'])
        parts.append(dent)
    return parts


def build_drill_rig(m) -> None:
    """Pokey McPoke: a rusty shopping cart carrying a wooden-ladder mast, an egg-beater drill on top
    and a giant chewed pencil for a bit; rope and duct tape hold it all together."""
    body = []
    # Cart basket: a flared tub with a wire grid drawn on, a chrome rim, handle at the back.
    bz, bh = 0.42, 0.6
    outline = [(-0.48, 0.0), (0.46, 0.0), (0.6, bh), (-0.56, bh)]
    tub = prism('Basket.Tub', outline, 0.68, loc=(0.05, 0, bz), axis='Y')
    bevel(tub, 0.03, 2)
    assign(tub, m['body'])
    body.append(tub)
    for side in (-1, 1):
        wire = box('Basket.Wire', (0.016, 0.02, bh - 0.06), loc=(-0.44, side * 0.35, bz + bh / 2))
        rotate(wire, x=-side * 6)
        array(wire, 9, (0.11, 0, 0))
        assign(wire, m['chrome'])
        body.append(wire)
        for zz in (0.16, 0.38):
            hw = box('Basket.WireH', (1.0, 0.02, 0.016), loc=(0.05, side * (0.34 + zz * 0.04), bz + zz))
            assign(hw, m['chrome'])
            body.append(hw)
        rim = capsule('Basket.Rim', 0.025, 1.12, loc=(0.05, side * 0.36, bz + bh), axis='X', segments=10, rings=6)
        assign(rim, m['chrome'])
        body.append(rim)
    for x, w in ((0.66, 0.7), (-0.56, 0.7)):
        rim = capsule('Basket.Rim', 0.025, w, loc=(x, 0, bz + bh), axis='Y', segments=10, rings=6)
        assign(rim, m['chrome'])
        body.append(rim)
    front_wire = box('Basket.WireF', (0.02, 0.016, bh - 0.06), loc=(0.54, -0.27, bz + bh / 2))
    rotate(front_wire, y=12)
    array(front_wire, 6, (0, 0.108, 0))
    assign(front_wire, m['chrome'])
    body.append(front_wire)
    body.append(rust_patch('Basket.Rust', (0.22, 0.012, 0.16), (0.2, -0.36, bz + 0.25), m, rot=(6, 0, 0)))
    body.append(rust_patch('Basket.Rust', (0.012, 0.18, 0.12), (-0.545, 0.1, bz + 0.3), m, rot=(0, -7, 0)))
    # Chrome chassis: two rails, a lower shelf, four little casters on forks.
    for side in (-1, 1):
        rail = capsule('Chassis.Rail', 0.022, 1.05, loc=(0.02, side * 0.27, 0.26), axis='X', segments=10, rings=6)
        assign(rail, m['chrome'])
        body.append(rail)
        upright = cylinder('Chassis.Upright', 0.02, 0.16, loc=(0.4, side * 0.27, 0.34), segments=8)
        assign(upright, m['chrome'])
        body.append(upright)
    shelf = box('Chassis.Shelf', (0.9, 0.5, 0.025), loc=(0.0, 0, 0.26))
    assign(shelf, m['rust2'])
    body.append(shelf)
    for x in (-0.42, 0.48):
        for side in (-1, 1):
            cz = 0.09
            fork = box('Caster.Fork', (0.05, 0.11, 0.16), loc=(x, side * 0.27, cz + 0.08))
            bevel(fork, 0.012, 2)
            assign(fork, m['chrome'])
            body.append(fork)
            cw = cylinder('Caster.Wheel', cz, 0.05, loc=(x, side * 0.27, cz), axis='Y', segments=14)
            bevel(cw, 0.02, 2, angle=60)
            assign(cw, m['plastic'])
            body.append(cw)
    # Handle at the back with a red grip, and a coffee mug parked on it.
    for side in (-1, 1):
        post = pole('Handle.Post', Vector((-0.56, side * 0.3, bz + bh)), Vector((-0.76, side * 0.3, bz + bh + 0.24)), 0.022, m['chrome'], segments=8)
        body.append(post)
    grip = capsule('Handle.Grip', 0.04, 0.6, loc=(-0.76, 0, bz + bh + 0.24), axis='Y', segments=12, rings=6)
    assign(grip, m['red'])
    body.append(grip)
    # Bucket of spare bits hanging off the left rim: a hooked bucket with pencil stubs.
    bkt = Vector((0.15, 0.52, bz + 0.34))
    bucket = cylinder('Bucket.Body', 0.15, 0.26, loc=bkt, segments=16, radius2=0.12)
    bevel(bucket, 0.01, 1, angle=60)
    assign(bucket, m['steel'])
    body.append(bucket)
    hoop = torus('Bucket.Hoop', 0.15, 0.012, loc=bkt + Vector((0, 0, 0.16)), rot=(90, 0, 0), major_segments=20, minor_segments=6)
    hoop.scale = (1.0, 1.0, 0.7)
    assign(hoop, m['dark'])
    body.append(hoop)
    hook = torus('Bucket.Hook', 0.05, 0.012, loc=(0.15, 0.4, bz + bh + 0.02), rot=(0, 90, 0), major_segments=12, minor_segments=6)
    assign(hook, m['dark'])
    body.append(hook)
    for i, (dx, dy) in enumerate(((-0.05, 0.03), (0.04, -0.04), (0.0, 0.06))):
        stub = cylinder('Bucket.Stub', 0.03, 0.3, loc=bkt + Vector((dx, dy, 0.18)), segments=6, smooth=False)
        rotate(stub, x=(i - 1) * 12, y=(i - 1) * 8)
        assign(stub, m['pencil'])
        body.append(stub)
        pt = cylinder('Bucket.StubTip', 0.03, 0.07, loc=bkt + Vector((dx, dy, 0.02)), segments=6, radius2=0.005, smooth=False)
        rotate(pt, x=180 + (i - 1) * 12, y=(i - 1) * 8)
        assign(pt, m['cream'])
        body.append(pt)
    pivot('Body', (0, 0, 0), body)

    # Mast: a wooden ladder standing in the basket, hinged at its foot, leaning a touch.
    foot = Vector((-0.15, 0, bz + 0.02))
    lean = Matrix.Rotation(math.radians(5), 3, 'Y') @ Matrix.Rotation(math.radians(2), 3, 'X')
    up = lean @ Vector((0, 0, 1))
    h = 3.1
    mast = []
    rot = [math.degrees(a) for a in up.to_track_quat('Z', 'Y').to_euler()]
    for side in (-1, 1):
        rc = foot + lean @ Vector((0, side * 0.2, h / 2))
        rail = box('Mast.Rail', (0.06, 0.08, h), loc=rc, rot=rot)
        bevel(rail, 0.015, 2)
        assign(rail, m['wood'])
        mast.append(rail)
    rung = box('Mast.Rung', (0.05, 0.42, 0.05), loc=foot + lean @ Vector((0, 0, 0.3)), rot=rot)
    rung.rotation_euler = up.to_track_quat('Z', 'Y').to_euler()
    apply_transform(rung)
    array(rung, 8, (0, 0, 0.36))
    rung.rotation_euler = up.to_track_quat('Z', 'Y').to_euler()
    apply_transform(rung)
    assign(rung, m['wood2'])
    mast.append(rung)
    # Rope lashing at the basket rim and tape higher up.
    lash = torus('Mast.Rope', 0.3, 0.02, loc=foot + lean @ Vector((0, 0, bh - 0.02)), rot=rot, major_segments=20, minor_segments=6)
    lash.scale = (0.45, 1.0, 1.0)
    assign(lash, m['rope'])
    mast.append(lash)
    for zz in (1.2, 2.1):
        for side in (-1, 1):
            mast.append(tape_band('Mast.Tape', 0.05, foot + lean @ Vector((0, side * 0.2, zz)), m=m, width=0.1, rot=rot))
    # Egg-beater drill head on the ladder top: housing, big crank gear, crank, small pinion, forward arm to the chuck.
    top = foot + lean @ Vector((0, 0, h))
    housing = box('Mast.Housing', (0.34, 0.3, 0.34), loc=top + Vector((0.05, 0, 0.12)))
    bevel(housing, 0.05, 3)
    assign(housing, m['rust'])
    mast.append(housing)
    clamp = box('Mast.Clamp', (0.4, 0.52, 0.08), loc=top + Vector((0.0, 0, -0.04)))
    bevel(clamp, 0.02, 2)
    assign(clamp, m['dark'])
    mast.append(clamp)
    gear_c = top + Vector((0.05, -0.2, 0.14))
    gear = cylinder('Mast.Gear', 0.28, 0.04, loc=gear_c, axis='Y', segments=24)
    bevel(gear, 0.012, 2, angle=60)
    assign(gear, m['chrome'])
    mast.append(gear)
    for i in range(6):
        a = i * math.pi / 3
        hole = cylinder('Mast.GearHole', 0.05, 0.05, loc=gear_c + Vector((math.cos(a) * 0.17, 0, math.sin(a) * 0.17)), axis='Y', segments=10)
        assign(hole, m['dark'])
        mast.append(hole)
    crank_c = gear_c + Vector((0.2, -0.05, 0.0))
    crank = box('Mast.Crank', (0.06, 0.04, 0.28), loc=crank_c + Vector((-0.1, 0, 0.08)))
    rotate(crank, y=45)
    assign(crank, m['chrome'])
    mast.append(crank)
    knob = capsule('Mast.CrankKnob', 0.035, 0.08, loc=crank_c + Vector((0.0, -0.08, 0.18)), axis='Y', segments=10, rings=6)
    assign(knob, m['wood2'])
    mast.append(knob)
    pinion = cylinder('Mast.Pinion', 0.09, 0.06, loc=top + Vector((0.05, 0, 0.36)), segments=14)
    assign(pinion, m['chrome'])
    mast.append(pinion)
    arm = box('Mast.Arm', (0.8, 0.12, 0.12), loc=top + Vector((0.4, 0, 0.0)))
    bevel(arm, 0.02, 2)
    assign(arm, m['rust'])
    mast.append(arm)
    chuck_top = top + Vector((0.78, 0, -0.04))
    chuck = cylinder('Mast.Chuck', 0.13, 0.24, loc=chuck_top + Vector((0, 0, -0.12)), segments=12, radius2=0.1)
    assign(chuck, m['dark'])
    mast.append(chuck)
    mast.append(pole('Mast.Shaft', top + Vector((0.05, 0, 0.3)), top + Vector((0.05, 0, -0.0)), 0.03, m['chrome'], segments=8))
    mast.append(pole('Mast.Belt', top + Vector((0.05, 0, 0.3)), chuck_top + Vector((0, 0, 0.08)), 0.03, m['chrome'], segments=8))
    # The bit: a giant chewed pencil from the chuck down to the ground.
    mast += hex_pencil('Mast.Pencil', chuck_top + Vector((0, 0, -0.2)), Vector((chuck_top.x, 0, 0.08)), 0.09, m)
    # Rope loop tying the pencil back to the basket's front rim.
    loop = torus('Mast.PencilRope', 0.13, 0.018, loc=(chuck_top.x - 0.06, 0, bz + bh + 0.01), major_segments=16, minor_segments=6)
    loop.scale = (1.4, 1.0, 1.0)
    assign(loop, m['rope'])
    mast.append(loop)
    pivot('Mast', foot, mast)


def bowling_ball(name: str, loc, radius: float, m) -> list[bpy.types.Object]:
    ball = sphere(f'{name}.Ball', radius, loc=loc, segments=20, rings=12)
    assign(ball, m['plastic'])
    parts = [ball]
    for dx, dy in ((-0.35, 0.0), (0.25, -0.3), (0.25, 0.3)):
        d = Vector((dx * radius, dy * radius, radius * 0.9)).normalized()
        hole = cylinder(f'{name}.Hole', radius * 0.16, radius * 0.3, loc=Vector(loc) + d * radius * 0.95, segments=8)
        hole.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
        assign(hole, m['dark'])
        parts.append(hole)
    return parts


def chain(name: str, a: Vector, b: Vector, links: int, m, size: float = 0.045) -> list[bpy.types.Object]:
    """A chain of alternating torus links from `a` to `b`."""
    d = b - a
    n = d.normalized()
    rot = n.to_track_quat('Z', 'Y').to_euler()
    out = []
    for i in range(links):
        c = a + d * ((i + 0.5) / links)
        link = torus(f'{name}.Link', size, size * 0.28, loc=c, major_segments=12, minor_segments=6)
        link.scale = (1.0, 0.6, 1.0)
        link.rotation_euler = rot
        link.rotation_euler.rotate_axis('Z', math.radians(90 * (i % 2)))
        link.rotation_euler.rotate_axis('X', math.radians(90))
        assign(link, m['steel'])
        out.append(link)
    return out


def plank(name: str, size, loc, m, rot=None, mat=None) -> bpy.types.Object:
    p = box(name, size, loc=loc, rot=rot)
    bevel(p, min(size) * 0.3, 2)
    assign(p, mat or m['wood'])
    return p


def build_building_destroyer(m) -> None:
    """Wrecking Rascal: a ride-on mower with a grass bag, a plank-and-nails blade up front, a bowling ball
    on a chain swinging from a bent coat rack, and a garden rake for a ripper."""
    body = []
    # Mower: deck, body tub, hood, seat, steering wheel, bag on the back.
    deck = box('Deck', (1.1, 0.86, 0.14), loc=(0.15, 0, 0.24))
    bevel(deck, 0.06, 3)
    assign(deck, m['dark'])
    body.append(deck)
    skirt = box('Deck.Skirt', (0.5, 0.92, 0.1), loc=(0.15, 0, 0.3))
    bevel(skirt, 0.04, 2)
    assign(skirt, m['body'])
    body.append(skirt)
    tub = box('Tub', (1.5, 0.74, 0.32), loc=(-0.05, 0, 0.5))
    bevel(tub, 0.07, 4)
    assign(tub, m['body'])
    body.append(tub)
    hood = box('Hood', (0.62, 0.62, 0.36), loc=(0.62, 0, 0.78))
    bevel(hood, 0.1, 4)
    assign(hood, m['body'])
    body.append(hood)
    grille = box('Grille', (0.03, 0.4, 0.2), loc=(0.93, 0, 0.74))
    bevel(grille, 0.01, 2)
    assign(grille, m['stripe'])
    body.append(grille)
    for side in (-1, 1):
        lamp = cylinder('Lamp', 0.055, 0.03, loc=(0.94, side * 0.22, 0.86), axis='X', segments=12)
        assign(lamp, m['lamp'])
        body.append(lamp)
    body.append(rust_patch('Hood.Rust', (0.18, 0.012, 0.12), (0.55, -0.31, 0.8), m))
    body.append(rust_patch('Tub.Rust', (0.26, 0.012, 0.14), (-0.3, 0.37, 0.5), m))
    body += exhaust_stub('Exhaust', (0.4, 0.3, 0.96), m)
    seat = box('Seat.Pan', (0.42, 0.44, 0.1), loc=(-0.3, 0, 0.72))
    bevel(seat, 0.04, 3)
    assign(seat, m['plastic'])
    body.append(seat)
    back = box('Seat.Back', (0.1, 0.42, 0.42), loc=(-0.52, 0, 0.94))
    bevel(back, 0.04, 3)
    rotate(back, y=-8)
    assign(back, m['plastic'])
    body.append(back)
    col = pole('Steering.Column', Vector((0.25, 0, 0.66)), Vector((0.05, 0, 1.05)), 0.025, m['dark'], segments=8)
    body.append(col)
    sw = torus('Steering.Wheel', 0.17, 0.025, loc=(0.05, 0, 1.06), rot=(0, -27, 0), major_segments=20, minor_segments=8)
    assign(sw, m['plastic'])
    body.append(sw)
    for a in (0, 120, 240):
        spoke = box('Steering.Spoke', (0.3, 0.03, 0.02), loc=(0.05, 0, 1.06))
        spoke.rotation_euler = (0, math.radians(-27), 0)
        spoke.rotation_euler.rotate_axis('Z', math.radians(a))
        assign(spoke, m['plastic'])
        body.append(spoke)
    # Grass-catcher bag: two canvas sacks on a frame behind the seat.
    for side in (-1, 1):
        sack = box('Bag.Sack', (0.36, 0.3, 0.5), loc=(-0.98, side * 0.18, 0.62))
        bevel(sack, 0.09, 4)
        assign(sack, m['bag'])
        body.append(sack)
    bagtop = box('Bag.Frame', (0.42, 0.7, 0.05), loc=(-0.98, 0, 0.9))
    bevel(bagtop, 0.02, 2)
    assign(bagtop, m['dark'])
    body.append(bagtop)
    chute = box('Bag.Chute', (0.3, 0.2, 0.14), loc=(-0.72, 0, 0.72))
    bevel(chute, 0.03, 2)
    rotate(chute, y=-20)
    assign(chute, m['body'])
    body.append(chute)
    # Bent coat-rack crane on the rear-left corner, bowling ball on a chain.
    rack_base = Vector((-0.8, 0.28, 0.66))
    rack_mid = Vector((-0.9, 0.3, 1.6))
    rack_top = Vector((-1.35, 0.32, 1.95))
    body.append(pole('Crane.Pole', rack_base, rack_mid, 0.03, m['chrome'], segments=10))
    body.append(pole('Crane.Pole', rack_mid, rack_top, 0.03, m['chrome'], segments=10))
    elbow = sphere('Crane.Elbow', 0.034, loc=rack_mid, segments=10, rings=6)
    assign(elbow, m['chrome'])
    body.append(elbow)
    rfoot = cylinder('Crane.Foot', 0.16, 0.04, loc=rack_base - Vector((0, 0, 0.02)), segments=14)
    assign(rfoot, m['chrome'])
    body.append(rfoot)
    body.append(tape_band('Crane.Tape', 0.03, rack_base + Vector((0, 0, 0.12)), m=m, width=0.1))
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        hd = Vector((math.cos(a) * 0.09, math.sin(a) * 0.09, 0.05))
        hook = pole('Crane.Hook', rack_top, rack_top + hd, 0.015, m['chrome'], segments=6)
        body.append(hook)
        tipb = sphere('Crane.HookTip', 0.022, loc=rack_top + hd, segments=8, rings=5)
        assign(tipb, m['chrome'])
        body.append(tipb)
    ball_c = Vector((-1.42, 0.32, 0.42))
    body += chain('Crane.Chain', rack_top + Vector((0.02, 0, -0.04)), ball_c + Vector((0, 0, 0.2)), 15, m, size=0.05)
    body += bowling_ball('Crane', ball_c, 0.22, m)
    pivot('Body', (0, 0, 0), body)
    # Mower wheels: small up front, big at the back.
    for side, name in ((1, 'WheelFL'), (-1, 'WheelFR')):
        fat_wheel(name, 0.25, 0.18, (0.62, side * 0.55, 0.25), m)
    for side, name in ((1, 'WheelRL'), (-1, 'WheelRR')):
        fat_wheel(name, 0.36, 0.24, (-0.45, side * 0.55, 0.36), m)

    # Blade: two rusty arms hinged on the deck skirt, carrying two planks studded with nails.
    hinge = Vector((0.45, 0, 0.42))
    parts = []
    for side in (-1, 1):
        arm = box('Blade.Arm', (0.9, 0.08, 0.1), loc=hinge + Vector((0.45, side * 0.5, 0.0)))
        bevel(arm, 0.02, 2)
        assign(arm, m['rust'])
        parts.append(arm)
        parts.append(tape_band('Blade.Tape', 0.06, hinge + Vector((0.82, side * 0.5, 0.0)), axis='X', m=m, width=0.1))
    px = hinge.x + 0.92
    for i, (z, w) in enumerate(((0.22, 1.5), (0.5, 1.42))):
        parts.append(plank('Blade.Plank', (0.07, w, 0.26), (px, 0.02 * (i - 0.5), z), m, rot=(0, -8, 0)))
        nails = cylinder('Blade.Nail', 0.014, 0.18, loc=(px + 0.08, -w / 2 + 0.12, z + 0.04), axis='X', segments=6, smooth=False)
        array(nails, 7, (0, (w - 0.24) / 6, 0))
        assign(nails, m['chrome'])
        parts.append(nails)
        nails2 = cylinder('Blade.Nail', 0.014, 0.18, loc=(px + 0.08, -w / 2 + 0.22, z - 0.06), axis='X', segments=6, smooth=False)
        array(nails2, 6, (0, (w - 0.24) / 6, 0))
        assign(nails2, m['chrome'])
        parts.append(nails2)
    brace = box('Blade.Brace', (0.06, 0.08, 0.6), loc=(px - 0.02, 0, 0.36))
    rotate(brace, y=-8)
    assign(brace, m['wood2'])
    parts.append(brace)
    pivot('Blade', hinge, parts)

    # Ripper: a garden rake lashed to the rear-right corner, tines on the ground.
    rp = Vector((-0.75, -0.3, 0.7))
    rake_head = Vector((-1.45, -0.3, 0.05))
    rparts = [pole('Ripper.Handle', rp + (rp - rake_head).normalized() * 0.25, rake_head + Vector((0, 0, 0.06)), 0.025, m['wood'], segments=10)]
    head = box('Ripper.Head', (0.07, 0.56, 0.06), loc=rake_head + Vector((0, 0, 0.07)))
    bevel(head, 0.01, 2)
    assign(head, m['rust'])
    rparts.append(head)
    tine = box('Ripper.Tine', (0.035, 0.025, 0.14), loc=rake_head + Vector((-0.04, -0.25, 0.03)))
    rotate(tine, y=-30)
    apply_transform(tine)
    array(tine, 11, (0, 0.05, 0))
    assign(tine, m['rust'])
    rparts.append(tine)
    rparts.append(tape_band('Ripper.Tape', 0.03, rp, m=m, width=0.1, rot=[math.degrees(a) for a in (rp - rake_head).to_track_quat('Z', 'Y').to_euler()]))
    pivot('Ripper', rp, rparts)


def exhaust_stub(name: str, loc, m) -> list[bpy.types.Object]:
    x, y, z = loc
    pipe = cylinder(f'{name}.Pipe', 0.035, 0.22, loc=(x, y, z + 0.11), segments=10)
    assign(pipe, m['dark'])
    tip = cylinder(f'{name}.Tip', 0.045, 0.06, loc=(x, y, z + 0.22), segments=10)
    assign(tip, m['chrome'])
    return [pipe, tip]


def build_rock_fragmenter(m) -> None:
    """Cracky: a two-wheel cart with a see-saw sledgehammer bouncing on a coil spring over a crate hopper;
    a bicycle pedal crank for a flywheel and a plank slide for a conveyor. Rocks everywhere."""
    body = []
    tz, th, tw = 0.42, 0.34, 0.9
    tray = box('Tray', (1.6, tw, th), loc=(-0.05, 0, tz + th / 2))
    bevel(tray, 0.05, 3)
    assign(tray, m['body'])
    body.append(tray)
    for side in (-1, 1):
        rail = box('Tray.Rail', (1.66, 0.06, 0.07), loc=(-0.05, side * (tw / 2 + 0.005), tz + th))
        bevel(rail, 0.02, 2)
        assign(rail, m['wood2'])
        body.append(rail)
        stake = box('Tray.Stake', (0.07, 0.05, th + 0.1), loc=(-0.65, side * (tw / 2 + 0.02), tz + th / 2))
        array(stake, 4, (0.4, 0, 0))
        bevel(stake, 0.012, 1)
        assign(stake, m['wood2'])
        body.append(stake)
        handle = capsule('Handle', 0.035, 0.55, loc=(-0.98, side * 0.32, tz + 0.2), axis='X', segments=10, rings=6)
        rotate(handle, y=-10)
        assign(handle, m['wood'])
        body.append(handle)
        grip = cylinder('Handle.Grip', 0.045, 0.16, loc=(-1.22, side * 0.32, tz + 0.25), axis='X', segments=10)
        rotate(grip, y=-10)
        assign(grip, m['plastic'])
        body.append(grip)
    body.append(rust_patch('Tray.Rust', (0.3, 0.012, 0.16), (0.2, -(tw / 2 + 0.006), tz + 0.16), m))
    body.append(rust_patch('Tray.Rust', (0.16, 0.012, 0.1), (-0.5, tw / 2 + 0.006, tz + 0.2), m))
    # Cart wheels (static) on a wooden axle, plus a front prop leg.
    axle = cylinder('Axle', 0.04, 1.3, loc=(-0.1, 0, 0.36), axis='Y', segments=10)
    assign(axle, m['wood2'])
    body.append(axle)
    for side in (-1, 1):
        wl = (-0.1, side * 0.6, 0.36)
        body += barrow_wheel('CartWheel', 0.36, 0.14, wl, m)
    leg = box('PropLeg', (0.08, 0.08, 0.44), loc=(0.6, 0, 0.22))
    bevel(leg, 0.015, 2)
    assign(leg, m['rust'])
    body.append(leg)
    foot = box('PropFoot', (0.2, 0.2, 0.04), loc=(0.6, 0, 0.02))
    bevel(foot, 0.012, 2)
    assign(foot, m['dark'])
    body.append(foot)
    # Crate hopper at the front of the tray, rocks in it.
    cx, cz = 0.62, tz + th
    crate = box('Crate', (0.5, 0.56, 0.42), loc=(cx, 0, cz + 0.21))
    bevel(crate, 0.02, 2)
    assign(crate, m['wood2'])
    body.append(crate)
    for side in (-1, 1):
        slat = box('Crate.Slat', (0.52, 0.02, 0.09), loc=(cx, side * 0.285, cz + 0.08))
        array(slat, 3, (0, 0, 0.14))
        assign(slat, m['wood'])
        body.append(slat)
        slat2 = box('Crate.Slat', (0.02, 0.58, 0.09), loc=(cx + side * 0.255, 0, cz + 0.08))
        array(slat2, 3, (0, 0, 0.14))
        assign(slat2, m['wood'])
        body.append(slat2)
    rnd = random.Random(21)
    for i in range(7):
        r = rnd.uniform(0.07, 0.11)
        rk = sphere('Crate.Load', r, loc=(cx + rnd.uniform(-0.14, 0.14), rnd.uniform(-0.16, 0.16), cz + 0.4 + rnd.uniform(0, 0.06)),
                    scale=(rnd.uniform(0.9, 1.3), rnd.uniform(0.9, 1.3), rnd.uniform(0.6, 0.9)), segments=10, rings=6)
        rotate(rk, rnd.uniform(0, 40), rnd.uniform(0, 40), rnd.uniform(0, 180))
        assign(rk, m['rock'] if i % 3 else m['rock2'])
        body.append(rk)
    # See-saw fulcrum: an A-frame on the tray, the hammer handle across it, a coil spring under the tail.
    fx, fz = -0.1, cz
    for side in (-1, 1):
        for dx in (-0.22, 0.22):
            legp = pole('Fulcrum.Leg', Vector((fx + dx, side * 0.3, fz)), Vector((fx, side * 0.12, fz + 0.7)), 0.03, m['rust'], segments=8)
            body.append(legp)
    xbar = cylinder('Fulcrum.Pin', 0.05, 0.36, loc=(fx, 0, fz + 0.7), axis='Y', segments=12)
    assign(xbar, m['dark'])
    body.append(xbar)
    tilt = -7.0
    hd = Vector((math.cos(math.radians(tilt)), 0, math.sin(math.radians(tilt))))
    piv = Vector((fx, 0, fz + 0.7))
    handle = pole('Hammer.Handle', piv - hd * 0.8, piv + hd * 0.85, 0.045, m['wood'], segments=12)
    body.append(handle)
    head_c = piv + hd * 0.8
    head = box('Hammer.Head', (0.3, 0.3, 0.5), loc=head_c)
    bevel(head, 0.04, 3)
    rotate(head, y=-tilt)
    assign(head, m['dark'])
    body.append(head)
    crack = prism('Hammer.Crack', [(-0.14, 0.02), (-0.04, -0.04), (0.03, 0.08), (0.12, -0.03), (0.15, 0.0), (0.04, 0.12), (-0.03, 0.0), (-0.12, 0.06)], 0.32, loc=head_c + Vector((0.0, 0.0, 0.12)), axis='Y')
    crack.rotation_euler = (0, math.radians(-tilt), 0)
    assign(crack, m['stripe'])
    body.append(crack)
    bandaid = box('Hammer.BandAid', (0.11, 0.33, 0.28), loc=head_c + hd * 0.02 + Vector((0, 0, -0.04)))
    bevel(bandaid, 0.03, 2)
    rotate(bandaid, y=-tilt)
    assign(bandaid, m['bandaid'])
    body.append(bandaid)
    pad = box('Hammer.BandAidPad', (0.09, 0.34, 0.11), loc=head_c + hd * 0.02 + Vector((0, 0, -0.04)))
    rotate(pad, y=-tilt)
    assign(pad, m['cream'])
    body.append(pad)
    tail = piv - hd * 0.7
    spring = helix('Spring', 0.11, 0.028, 5, tail.z - fz - 0.06, (tail.x, 0, (tail.z + fz) / 2 - 0.02), m)
    body.append(spring)
    sp_top = cylinder('Spring.Cap', 0.14, 0.04, loc=(tail.x, 0, tail.z - 0.06), segments=14)
    assign(sp_top, m['dark'])
    body.append(sp_top)
    sp_bot = cylinder('Spring.Base', 0.15, 0.04, loc=(tail.x, 0, fz + 0.02), segments=14)
    assign(sp_bot, m['dark'])
    body.append(sp_bot)
    body.append(tape_band('Hammer.Tape', 0.045, head_c - hd * 0.18, m=m, width=0.1, rot=[math.degrees(a) for a in hd.to_track_quat('Z', 'Y').to_euler()]))
    # Loose rocks on the tray and one bouncing off the crate.
    body += rock_pile('Tray.Rocks', (-0.7, 0.2, cz), (0.15, 0.18), m, count=3, seed=8)
    pivot('Body', (0, 0, 0), body)

    # Flywheel: a bicycle crank set on the right flank, spinning on Y.
    fw = Vector((-0.1, -(tw / 2 + 0.12), tz + th - 0.05))
    ring = cylinder('Flywheel.Ring', 0.24, 0.03, loc=fw, axis='Y', segments=24)
    bevel(ring, 0.01, 2, angle=60)
    assign(ring, m['chrome'])
    hub = cylinder('Flywheel.Hub', 0.06, 0.16, loc=fw, axis='Y', segments=12)
    assign(hub, m['dark'])
    parts = [ring, hub]
    for i in range(5):
        a = i * 2 * math.pi / 5
        cut = cylinder('Flywheel.Cutout', 0.055, 0.035, loc=fw + Vector((math.cos(a) * 0.15, 0, math.sin(a) * 0.15)), axis='Y', segments=10)
        assign(cut, m['plastic'])
        parts.append(cut)
    for sgn in (1, -1):
        arm = box('Flywheel.CrankArm', (0.06, 0.03, 0.22), loc=fw + Vector((0, -sgn * 0.09, sgn * 0.11)))
        bevel(arm, 0.01, 2)
        assign(arm, m['chrome'])
        parts.append(arm)
        pedal = box('Flywheel.Pedal', (0.1, 0.09, 0.03), loc=fw + Vector((0, -sgn * 0.09 - 0.06, sgn * 0.22)))
        bevel(pedal, 0.01, 2)
        assign(pedal, m['plastic'])
        parts.append(pedal)
    pivot('Flywheel', fw, parts)

    # Conveyor: a plank slide from the tray's front lip down to the ground, rocks tumbling off.
    cp = Vector((0.75, 0, tz + th + 0.02))
    length, drop = 1.2, tz + th - 0.1
    ang = math.degrees(math.atan2(drop, length))
    mid = cp + Vector((length / 2, 0, -drop / 2))
    slide = plank('Conveyor.Plank', (math.hypot(length, drop), 0.5, 0.05), mid, m, rot=(0, ang, 0))
    cparts = [slide]
    for side in (-1, 1):
        rail = plank('Conveyor.Rail', (math.hypot(length, drop) - 0.1, 0.05, 0.12), mid + Vector((0, side * 0.26, 0.05)), m, rot=(0, ang, 0), mat=m['wood2'])
        cparts.append(rail)
    prop = box('Conveyor.Prop', (0.06, 0.06, cp.z - 0.5), loc=(cp.x + 0.5, 0.15, (cp.z - 0.5) / 2))
    array(prop, 2, (0, -0.3, 0))
    assign(prop, m['rust'])
    cparts.append(prop)
    for i, t in enumerate((0.25, 0.55, 0.8)):
        rc = cp + Vector((length * t, (i - 1) * 0.1, -drop * t + 0.1))
        rock = sphere('Conveyor.Rock', 0.1 + 0.02 * i, loc=rc, scale=(1.2, 1.0, 0.8), segments=10, rings=6)
        rotate(rock, 20 * i, 10, 40 * i)
        assign(rock, m['rock'] if i % 2 else m['rock2'])
        cparts.append(rock)
    cparts += rock_pile('Conveyor.Heap', Vector((cp.x + length + 0.1, 0, 0.27)), (0.1, 0.16), m, count=5, seed=13)
    pivot('Conveyor', cp, cparts)


BUILDERS = {
    'debris_hauler': build_debris_hauler,
    'rock_digger': build_rock_digger,
    'drill_rig': build_drill_rig,
    'building_destroyer': build_building_destroyer,
    'rock_fragmenter': build_rock_fragmenter,
}


BODY_PAINT = {
    'debris_hauler': 0x5C7A3A,       # municipal-skip green
    'rock_digger': 0x5C7B9A,         # faded wheelbarrow blue
    'drill_rig': 0x8A8F96,           # shopping-cart zinc
    'building_destroyer': 0xB8452E,  # ride-on mower red
    'rock_fragmenter': 0xB07A3A,     # dull cart orange
}


def build_vehicle(role: str) -> None:
    BUILDERS[role](_materials_t1(BODY_PAINT[role]))
