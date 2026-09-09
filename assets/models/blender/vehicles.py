"""Vehicles — one model per VehicleRole, facing +X, ground at z = 0.

Chunky machines with rounded bodies, oversized wheels/tracks and a cab with
real windows. `TintBody` is the Caterpillar-yellow paint the game recolours
per instance. Nodes the runtime animates: Wheel* (spin on the Y axis while
moving), plus role-specific ones (Bed, Boom, Mast, Blade…).
"""
from __future__ import annotations

import math

import bpy
from mathutils import Vector

from common import (
    apply_transform, array, assign, bevel, box, capsule, cylinder, material, pivot, prism, rotate, sphere, torus,
)

ROLES = ['debris_hauler', 'rock_digger', 'drill_rig', 'building_destroyer', 'rock_fragmenter']


def _materials() -> dict[str, bpy.types.Material]:
    return {
        'body': material('TintBody', 0xF5C518, roughness=0.55),
        'rubber': material('Rubber', 0x2B2B30, roughness=0.95),
        'hub': material('Hub', 0xB8BCC4, roughness=0.5, metallic=0.2),
        'dark': material('Dark', 0x3A3A42, roughness=0.8),
        'steel': material('Steel', 0x8D939E, roughness=0.5, metallic=0.3),
        'glass': material('Glass', 0x9FD8FF, roughness=0.15),
        'chrome': material('Chrome', 0xDCE1E8, roughness=0.3, metallic=0.5),
        'beacon': material('Beacon', 0xFF8A2A, roughness=0.3, emission=0xFF7A1A, emission_strength=0.8),
        'lamp': material('Lamp', 0xFFF2A8, roughness=0.3, emission=0xFFE080, emission_strength=0.5),
        'rock': material('Rock', 0x8A7F73, roughness=0.95),
        'rock2': material('RockDark', 0x6A6058, roughness=0.95),
        'stripe': material('Stripe', 0x1E1E24, roughness=0.8),
        'red': material('Red', 0xD8322B, roughness=0.6),
    }


# --------------------------------------------------------------- parts ---

def wheel(name: str, radius: float, width: float, loc, m, hub_ratio: float = 0.55) -> bpy.types.Object:
    """A fat tyre with a hub, axle along Y. Returns the pivot node (spin it on Y)."""
    tyre = cylinder(f'{name}.Tyre', radius, width, loc=loc, axis='Y', segments=32)
    bevel(tyre, radius * 0.28, 4, angle=60)
    assign(tyre, m['rubber'])
    hub = cylinder(f'{name}.Hub', radius * hub_ratio, width * 1.06, loc=loc, axis='Y', segments=24)
    bevel(hub, radius * 0.08, 2, angle=60)
    assign(hub, m['hub'])
    cap = cylinder(f'{name}.Cap', radius * 0.22, width * 1.16, loc=loc, axis='Y', segments=16)
    assign(cap, m['dark'])
    # Lug bolts around the hub.
    parts = [tyre, hub, cap]
    for i in range(6):
        a = i * math.pi / 3
        r = radius * hub_ratio * 0.62
        bolt = cylinder(f'{name}.Bolt', radius * 0.05, width * 1.12,
                        loc=(loc[0] + math.cos(a) * r, loc[1], loc[2] + math.sin(a) * r), axis='Y', segments=8)
        assign(bolt, m['dark'])
        parts.append(bolt)
    return pivot(name, loc, parts)


def fender(name: str, radius: float, width: float, loc, m) -> bpy.types.Object:
    """A mudguard arch over a wheel centred on `loc` (axle along Y)."""
    import bmesh
    f = torus(name, radius, 0.05, loc=loc, rot=(90, 0, 0), major_segments=32, minor_segments=8)
    bm = bmesh.new()
    bm.from_mesh(f.data)
    # Local Y is the axle after the 90° tilt; keep the upper half only.
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.02], context='VERTS')
    bm.to_mesh(f.data)
    bm.free()
    f.scale = (1.0, 1.0, width / 0.1)
    assign(f, m['body'])
    return f


def stadium(length: float, height: float, n: int = 8) -> list[tuple[float, float]]:
    """Rounded-end 2D outline (x, z) centred on the origin — a track's side profile."""
    r = height / 2
    half = length / 2 - r
    pts = []
    for i in range(n + 1):
        a = -math.pi / 2 + math.pi * i / n
        pts.append((half + math.cos(a) * r, math.sin(a) * r))
    for i in range(n + 1):
        a = math.pi / 2 + math.pi * i / n
        pts.append((-half + math.cos(a) * r, math.sin(a) * r))
    return pts


def track(name: str, length: float, height: float, width: float, loc, m, pads: int = 14) -> list[bpy.types.Object]:
    """A crawler track: rubber belt with pads, road wheels and a frame. Static (pads slide visually via the game later)."""
    x, y, z = loc
    belt = prism(f'{name}.Belt', stadium(length, height), width, loc=(x, y, z), axis='Y')
    belt.data.shade_smooth()
    assign(belt, m['rubber'])
    # Pads: small blocks arrayed along the top and bottom runs.
    parts = [belt]
    pad_len = (length - height) / pads * 0.62
    for zz, sign in ((z + height / 2, 1), (z - height / 2, -1)):
        pad = box(f'{name}.Pad', (pad_len, width * 1.08, 0.05), loc=(x - (length - height) / 2, y, zz + sign * 0.01))
        bevel(pad, 0.012, 2)
        array(pad, pads, ((length - height) / (pads - 1), 0, 0))
        assign(pad, m['dark'])
        parts.append(pad)
    # Frame between the runs and road wheels showing on the outer side.
    frame = box(f'{name}.Frame', (length - height * 0.9, width * 0.7, height * 0.55), loc=(x, y, z))
    bevel(frame, 0.03, 2)
    assign(frame, m['steel'])
    parts.append(frame)
    outer = 1 if y > 0 else -1
    n_road = max(3, int(length / (height * 0.9)))
    for i in range(n_road):
        rx = x - (length - height) / 2 + (length - height) * i / (n_road - 1)
        rw = cylinder(f'{name}.RoadWheel', height * 0.30, width * 0.35, loc=(rx, y + outer * width * 0.42, z - height * 0.08),
                      axis='Y', segments=16)
        assign(rw, m['hub'])
        parts.append(rw)
    return parts


def cab(name: str, size, loc, m, front_glass: bool = True, side_glass: bool = True,
        roof: bool = True) -> list[bpy.types.Object]:
    """Operator cab: a rounded box with glass panels sitting proud of its faces."""
    sx, sy, sz = size
    x, y, z = loc
    body = box(f'{name}.Shell', size, loc=loc)
    bevel(body, min(sx, sy, sz) * 0.16, 4)
    assign(body, m['body'])
    parts = [body]
    g = 0.02
    if front_glass:
        win = box(f'{name}.Windshield', (g, sy * 0.78, sz * 0.5), loc=(x + sx / 2, y, z + sz * 0.12))
        bevel(win, 0.02, 2)
        assign(win, m['glass'])
        parts.append(win)
    if side_glass:
        for side in (-1, 1):
            win = box(f'{name}.SideWindow', (sx * 0.62, g, sz * 0.46), loc=(x + sx * 0.05, y + side * sy / 2, z + sz * 0.12))
            bevel(win, 0.02, 2)
            assign(win, m['glass'])
            parts.append(win)
    if roof:
        rf = box(f'{name}.Roof', (sx * 1.1, sy * 1.1, sz * 0.12), loc=(x, y, z + sz / 2))
        bevel(rf, sz * 0.05, 3)
        assign(rf, m['dark'])
        parts.append(rf)
        beacon = cylinder(f'{name}.Beacon', 0.07, 0.09, loc=(x + sx * 0.25, y - sy * 0.3, z + sz / 2 + 0.09), segments=16)
        bevel(beacon, 0.02, 2, angle=60)
        assign(beacon, m['beacon'])
        parts.append(beacon)
    return parts


def exhaust(name: str, loc, height: float, m, radius: float = 0.06) -> list[bpy.types.Object]:
    pipe = cylinder(f'{name}.Pipe', radius, height, loc=(loc[0], loc[1], loc[2] + height / 2), segments=16)
    assign(pipe, m['dark'])
    tip = cylinder(f'{name}.Tip', radius * 1.35, height * 0.18, loc=(loc[0], loc[1], loc[2] + height * 0.95), segments=16)
    bevel(tip, radius * 0.3, 2, angle=60)
    assign(tip, m['chrome'])
    return [pipe, tip]


def headlights(name: str, x: float, ys, z: float, m, radius: float = 0.09) -> list[bpy.types.Object]:
    out = []
    for y in ys:
        rim = cylinder(f'{name}.Rim', radius, 0.05, loc=(x, y, z), axis='X', segments=16)
        assign(rim, m['dark'])
        lamp = cylinder(f'{name}.Lamp', radius * 0.75, 0.02, loc=(x + 0.03, y, z), axis='X', segments=16)
        assign(lamp, m['lamp'])
        out += [rim, lamp]
    return out


def rock_pile(name: str, center, spread, m, count: int = 9, seed: int = 3) -> list[bpy.types.Object]:
    """A heap of rounded boulders — a haul load."""
    import random
    rnd = random.Random(seed)
    out = []
    cx, cy, cz = center
    sx, sy = spread
    for i in range(count):
        r = rnd.uniform(0.16, 0.28)
        loc = (cx + rnd.uniform(-sx, sx), cy + rnd.uniform(-sy, sy), cz + rnd.uniform(0, 0.12))
        rock = sphere(f'{name}.Rock', r, loc=loc, scale=(rnd.uniform(0.8, 1.3), rnd.uniform(0.8, 1.3), rnd.uniform(0.6, 0.9)),
                      segments=12, rings=7)
        rotate(rock, rnd.uniform(0, 40), rnd.uniform(0, 40), rnd.uniform(0, 180))
        assign(rock, m['rock'] if i % 3 else m['rock2'])
        out.append(rock)
    return out


# ------------------------------------------------------------ vehicles ---

def build_debris_hauler(m) -> None:
    """Articulated dump truck: cab up front, a deep tipping bed behind, four fat wheels."""
    body = []
    # Chassis rails
    chassis = box('Chassis', (2.7, 1.0, 0.22), loc=(-0.05, 0, 0.52))
    bevel(chassis, 0.04, 2)
    assign(chassis, m['dark'])
    body.append(chassis)
    # Engine hood + cab on the front
    hood = box('Hood', (0.7, 1.25, 0.55), loc=(1.15, 0, 0.9))
    bevel(hood, 0.09, 4)
    assign(hood, m['body'])
    body.append(hood)
    grille = box('Grille', (0.04, 0.7, 0.3), loc=(1.51, 0, 0.9))
    bevel(grille, 0.015, 2)
    assign(grille, m['dark'])
    body.append(grille)
    body += headlights('Head', 1.5, (-0.45, 0.45), 1.0, m)
    bumper = box('Bumper', (0.12, 1.35, 0.16), loc=(1.5, 0, 0.62))
    bevel(bumper, 0.05, 3)
    assign(bumper, m['steel'])
    body.append(bumper)
    body += cab('Cab', (0.85, 1.25, 0.85), (0.5, 0, 1.55), m)
    body += exhaust('Exhaust', (0.1, 0.62, 1.2), 1.15, m)
    # Fenders arching over the front wheels
    for side in (-1, 1):
        body.append(fender('Fender', 0.54, 0.46, (0.95, side * 0.72, 0.42), m))
    # Tipping bed (floor, sides, headboard, tailgate) + cab canopy — its own node, hinged at the rear.
    bed = []
    floor = box('Bed.Floor', (1.7, 1.45, 0.12), loc=(-0.6, 0, 0.78))
    bevel(floor, 0.03, 2)
    assign(floor, m['body'])
    bed.append(floor)
    for side in (-1, 1):
        wall = box('Bed.Side', (1.7, 0.09, 0.62), loc=(-0.6, side * 0.68, 1.1))
        bevel(wall, 0.03, 3)
        assign(wall, m['body'])
        bed.append(wall)
        rib = box('Bed.Rib', (0.06, 0.05, 0.6), loc=(-0.6, side * 0.745, 1.1))
        array(rib, 3, (0.55, 0, 0))
        rib.location.x = -1.15
        bevel(rib, 0.012, 2)
        assign(rib, m['dark'])
        bed.append(rib)
    head = box('Bed.Headboard', (0.09, 1.45, 0.72), loc=(0.2, 0, 1.15))
    bevel(head, 0.03, 3)
    assign(head, m['body'])
    bed.append(head)
    canopy = box('Bed.Canopy', (0.95, 1.45, 0.08), loc=(0.62, 0, 2.05))
    bevel(canopy, 0.03, 3)
    assign(canopy, m['body'])
    bed.append(canopy)
    gate = box('Bed.Tailgate', (0.08, 1.45, 0.55), loc=(-1.45, 0, 1.08))
    bevel(gate, 0.03, 3)
    assign(gate, m['body'])
    bed.append(gate)
    bed += rock_pile('Bed.Load', (-0.6, 0, 1.3), (0.55, 0.42), m)
    pivot('Bed', (-1.4, 0, 0.75), bed)
    # Wheels
    wheel('WheelFL', 0.42, 0.36, (0.95, 0.72, 0.42), m)
    wheel('WheelFR', 0.42, 0.36, (0.95, -0.72, 0.42), m)
    wheel('WheelRL', 0.42, 0.36, (-0.75, 0.72, 0.42), m)
    wheel('WheelRR', 0.42, 0.36, (-0.75, -0.72, 0.42), m)
    pivot('Body', (0, 0, 0), body)


def build_rock_digger(m) -> None:
    """Tracked excavator: slewing house with a cab, a two-piece arm and a toothed bucket."""
    body = []
    for side in (-1, 1):
        body += track('Track', 2.4, 0.56, 0.44, (0, side * 0.72, 0.28), m)
    carriage = box('Carriage', (1.3, 1.2, 0.3), loc=(0, 0, 0.5))
    bevel(carriage, 0.05, 3)
    assign(carriage, m['dark'])
    body.append(carriage)
    ring = cylinder('Slew', 0.6, 0.14, loc=(0, 0, 0.7), segments=32)
    bevel(ring, 0.03, 2, angle=60)
    assign(ring, m['steel'])
    body.append(ring)
    house = box('House', (1.7, 1.35, 0.8), loc=(-0.25, 0, 1.17))
    bevel(house, 0.1, 4)
    assign(house, m['body'])
    body.append(house)
    counter = box('Counterweight', (0.5, 1.25, 0.7), loc=(-1.2, 0, 1.12))
    bevel(counter, 0.12, 4)
    assign(counter, m['dark'])
    body.append(counter)
    vent = box('Vent', (0.1, 0.04, 0.45), loc=(-0.95, 0.69, 1.2))
    array(vent, 4, (0.17, 0, 0))
    assign(vent, m['stripe'])
    body.append(vent)
    body += cab('Cab', (0.85, 0.72, 0.9), (0.4, 0.34, 1.62), m)
    body += exhaust('Exhaust', (-0.75, -0.35, 1.55), 0.55, m, radius=0.05)
    pivot('Body', (0, 0, 0), body)

    # Boom: a bent beam from the house up and forward; its own node.
    boom_pivot = Vector((0.45, -0.22, 1.35))
    bp = [(0.0, -0.16), (0.55, 0.55), (1.15, 0.95), (1.35, 0.85), (1.05, 0.55), (0.35, -0.05), (0.15, -0.2)]
    boom = prism('Boom.Beam', bp, 0.34, loc=boom_pivot, axis='Y')
    bevel(boom, 0.04, 3)
    assign(boom, m['body'])
    pin = cylinder('Boom.Pin', 0.09, 0.44, loc=boom_pivot, axis='Y', segments=16)
    assign(pin, m['steel'])
    # Lift cylinder from the house to mid-boom.
    cyl_a = Vector((0.75, -0.22, 1.0))
    cyl_b = boom_pivot + Vector((0.65, 0, 0.55))
    boom_parts = [boom, pin] + hydraulic('Boom.Lift', cyl_a, cyl_b, 0.07, m)
    pivot('Boom', boom_pivot, boom_parts)

    # Stick: hangs down-forward from the boom tip.
    stick_pivot = boom_pivot + Vector((1.25, 0, 0.9))
    sp = [(-0.1, 0.12), (0.12, 0.12), (1.05, -1.0), (0.95, -1.15), (0.75, -1.1), (-0.12, -0.05)]
    stick = prism('Stick.Beam', sp, 0.26, loc=stick_pivot, axis='Y')
    bevel(stick, 0.03, 3)
    assign(stick, m['body'])
    spin = cylinder('Stick.Pin', 0.07, 0.36, loc=stick_pivot, axis='Y', segments=16)
    assign(spin, m['steel'])
    stick_parts = [stick, spin] + hydraulic('Stick.Cyl', boom_pivot + Vector((0.6, 0, 0.75)), stick_pivot + Vector((0.45, 0, -0.35)), 0.06, m)
    pivot('Stick', stick_pivot, stick_parts)

    # Bucket at the stick tip, teeth forward.
    bucket_pivot = stick_pivot + Vector((0.9, 0, -1.05))
    bkp = [(0.0, 0.1), (0.35, 0.05), (0.5, -0.2), (0.4, -0.5), (0.05, -0.55), (-0.2, -0.35), (-0.15, 0.0)]
    bucket = prism('Bucket.Shell', bkp, 0.7, loc=bucket_pivot, axis='Y')
    bevel(bucket, 0.03, 2)
    assign(bucket, m['steel'])
    bucket_parts = [bucket]
    for i in range(4):
        y = -0.26 + i * 0.173
        tooth = box('Bucket.Tooth', (0.16, 0.07, 0.07), loc=bucket_pivot + Vector((0.55, y, -0.32)))
        bevel(tooth, 0.02, 2)
        rotate(tooth, y=-25)
        assign(tooth, m['dark'])
        bucket_parts.append(tooth)
    bucket_parts += hydraulic('Bucket.Cyl', stick_pivot + Vector((0.3, 0, -0.1)), bucket_pivot + Vector((-0.1, 0, 0.05)), 0.05, m)
    pivot('Bucket', bucket_pivot, bucket_parts)


def build_drill_rig(m) -> None:
    """Tracked blast-hole drill: a tall lattice mast on a compact carrier."""
    body = []
    for side in (-1, 1):
        body += track('Track', 2.2, 0.5, 0.4, (0, side * 0.62, 0.25), m, pads=12)
    deck = box('Deck', (2.0, 1.25, 0.3), loc=(0, 0, 0.55))
    bevel(deck, 0.05, 3)
    assign(deck, m['dark'])
    body.append(deck)
    engine = box('Engine', (1.1, 1.15, 0.7), loc=(-0.45, 0, 1.05))
    bevel(engine, 0.1, 4)
    assign(engine, m['body'])
    body.append(engine)
    body += exhaust('Exhaust', (-0.8, 0.35, 1.4), 0.6, m, radius=0.05)
    # Compressor tank and dust collector on the deck.
    tank = capsule('Tank', 0.22, 0.6, loc=(-0.3, -0.45, 1.6), axis='X', segments=20, rings=8)
    assign(tank, m['steel'])
    body.append(tank)
    body += cab('Cab', (0.75, 0.65, 0.85), (0.35, 0.32, 1.2), m)
    hood = box('DustHood', (0.5, 0.5, 0.35), loc=(1.15, -0.1, 0.2))
    bevel(hood, 0.05, 3)
    assign(hood, m['dark'])
    body.append(hood)
    pivot('Body', (0, 0, 0), body)

    # Mast: lattice tower, hinged at its foot so it can lay down for travel.
    foot = Vector((1.15, -0.1, 0.4))
    h = 4.6
    mast = []
    for y in (-0.24, 0.24):
        rail = box('Mast.Rail', (0.09, 0.09, h), loc=foot + Vector((0.28, y, h / 2)))
        bevel(rail, 0.015, 2)
        assign(rail, m['body'])
        mast.append(rail)
        back = box('Mast.Rail', (0.09, 0.09, h), loc=foot + Vector((0.62, y, h / 2)))
        bevel(back, 0.015, 2)
        assign(back, m['body'])
        mast.append(back)
    brace = box('Mast.Brace', (0.4, 0.05, 0.05), loc=foot + Vector((0.45, 0.24, 0.3)))
    rotate(brace, y=-40)
    apply_transform(brace)
    array(brace, 9, (0, 0, 0.5))
    assign(brace, m['dark'])
    mast.append(brace)
    brace2 = box('Mast.Brace', (0.4, 0.05, 0.05), loc=foot + Vector((0.45, -0.24, 0.3)))
    rotate(brace2, y=40)
    apply_transform(brace2)
    array(brace2, 9, (0, 0, 0.5))
    assign(brace2, m['dark'])
    mast.append(brace2)
    rung = box('Mast.Rung', (0.05, 0.48, 0.05), loc=foot + Vector((0.62, 0, 0.3)))
    array(rung, 9, (0, 0, 0.5))
    assign(rung, m['dark'])
    mast.append(rung)
    crown = box('Mast.Crown', (0.55, 0.65, 0.2), loc=foot + Vector((0.45, 0, h + 0.1)))
    bevel(crown, 0.04, 3)
    assign(crown, m['body'])
    mast.append(crown)
    # Rotary head riding the rails, drill rod down to the dust hood.
    head = box('Mast.RotaryHead', (0.42, 0.55, 0.5), loc=foot + Vector((0.28, 0, 2.8)))
    bevel(head, 0.05, 3)
    assign(head, m['steel'])
    mast.append(head)
    motor = cylinder('Mast.Motor', 0.16, 0.5, loc=foot + Vector((0.28, 0, 3.3)), segments=20)
    assign(motor, m['dark'])
    mast.append(motor)
    rod = cylinder('Mast.Rod', 0.055, 2.6, loc=foot + Vector((0.0, 0, 1.25)), segments=14)
    assign(rod, m['chrome'])
    mast.append(rod)
    bit = cylinder('Mast.Bit', 0.11, 0.25, loc=foot + Vector((0.0, 0, 0.0)), segments=14, radius2=0.06)
    assign(bit, m['dark'])
    mast.append(bit)
    # Back-stays from the deck to the mast.
    mast += hydraulic('Mast.Stay', Vector((-0.2, -0.1, 0.9)), foot + Vector((0.62, 0, 2.0)), 0.06, m)
    pivot('Mast', foot, mast)


def build_building_destroyer(m) -> None:
    """Crawler bulldozer: broad blade up front, roll cage over the cab, ripper behind."""
    body = []
    for side in (-1, 1):
        body += track('Track', 2.5, 0.62, 0.5, (0, side * 0.68, 0.31), m)
    frame = box('Frame', (1.9, 1.15, 0.3), loc=(0, 0, 0.6))
    bevel(frame, 0.05, 3)
    assign(frame, m['dark'])
    body.append(frame)
    hood = box('Hood', (1.25, 1.05, 0.72), loc=(0.35, 0, 1.1))
    bevel(hood, 0.11, 4)
    assign(hood, m['body'])
    body.append(hood)
    body += exhaust('Exhaust', (0.6, 0.3, 1.45), 0.7, m, radius=0.065)
    filt = capsule('AirFilter', 0.11, 0.25, loc=(0.35, -0.3, 1.6), axis='Z', segments=16, rings=8)
    assign(filt, m['dark'])
    body.append(filt)
    grille = box('Grille', (0.04, 0.6, 0.4), loc=(0.98, 0, 1.1))
    assign(grille, m['stripe'])
    body.append(grille)
    body += headlights('Head', 0.98, (-0.38, 0.38), 1.3, m, radius=0.07)
    body += cab('Cab', (0.85, 0.95, 0.85), (-0.55, 0, 1.45), m, roof=False)
    # ROPS roll cage.
    for dx in (-0.4, 0.4):
        for dy in (-0.5, 0.5):
            post = cylinder('Rops.Post', 0.045, 1.0, loc=(-0.55 + dx, dy, 1.6), segments=12)
            assign(post, m['dark'])
            body.append(post)
    canopy = box('Rops.Roof', (1.05, 1.15, 0.09), loc=(-0.55, 0, 2.12))
    bevel(canopy, 0.03, 3)
    assign(canopy, m['body'])
    body.append(canopy)
    beacon = cylinder('Rops.Beacon', 0.07, 0.09, loc=(-0.3, -0.35, 2.21), segments=16)
    assign(beacon, m['beacon'])
    body.append(beacon)
    # Push arms and lift cylinders run from the body to the blade.
    for side in (-1, 1):
        arm = box('PushArm', (1.3, 0.12, 0.14), loc=(0.85, side * 0.72, 0.62))
        bevel(arm, 0.03, 2)
        assign(arm, m['steel'])
        body.append(arm)
    pivot('Body', (0, 0, 0), body)

    blade_pivot = Vector((1.55, 0, 0.55))
    bpz = [(-0.1, -0.5), (0.05, -0.5), (0.2, -0.3), (0.26, 0.0), (0.2, 0.3), (0.05, 0.55), (-0.1, 0.55), (-0.02, 0.3), (0.02, 0.0), (-0.02, -0.3)]
    blade = prism('Blade.Shell', bpz, 1.95, loc=blade_pivot, axis='Y')
    bevel(blade, 0.025, 2)
    assign(blade, m['body'])
    edge = box('Blade.Edge', (0.06, 1.98, 0.12), loc=blade_pivot + Vector((0.02, 0, -0.5)))
    assign(edge, m['dark'])
    stripe = box('Blade.Stripe', (0.03, 0.13, 0.7), loc=blade_pivot + Vector((0.24, -0.8, 0.02)))
    rotate(stripe, x=35)
    apply_transform(stripe)
    array(stripe, 5, (0, 0.4, 0))
    assign(stripe, m['stripe'])
    blade_parts = [blade, edge, stripe]
    for side in (-1, 1):
        wing = box('Blade.Wing', (0.16, 0.08, 1.0), loc=blade_pivot + Vector((0.05, side * 0.99, 0.02)))
        bevel(wing, 0.02, 2)
        assign(wing, m['dark'])
        blade_parts.append(wing)
        blade_parts += hydraulic('Blade.Lift', Vector((0.55, side * 0.45, 1.5)), blade_pivot + Vector((-0.05, side * 0.55, 0.45)), 0.06, m)
    pivot('Blade', blade_pivot, blade_parts)

    ripper_pivot = Vector((-1.45, 0, 0.75))
    shank = box('Ripper.Shank', (0.18, 0.16, 1.1), loc=ripper_pivot + Vector((-0.25, 0, -0.15)))
    bevel(shank, 0.03, 2)
    rotate(shank, y=22)
    assign(shank, m['steel'])
    tip = box('Ripper.Tip', (0.45, 0.14, 0.16), loc=ripper_pivot + Vector((-0.2, 0, -0.62)))
    bevel(tip, 0.03, 2)
    rotate(tip, y=-25)
    assign(tip, m['dark'])
    beam = box('Ripper.Beam', (0.6, 1.0, 0.2), loc=ripper_pivot + Vector((0.1, 0, 0.3)))
    bevel(beam, 0.03, 2)
    assign(beam, m['body'])
    pivot('Ripper', ripper_pivot, [shank, tip, beam])


def build_rock_fragmenter(m) -> None:
    """Tracked mobile crusher: rear hopper feeds a jaw box; crushed rock leaves on a front conveyor."""
    body = []
    for side in (-1, 1):
        body += track('Track', 2.6, 0.56, 0.44, (0, side * 0.76, 0.28), m, pads=15)
    frame = box('Frame', (2.5, 1.3, 0.35), loc=(0, 0, 0.72))
    bevel(frame, 0.05, 3)
    assign(frame, m['dark'])
    body.append(frame)
    # Hopper: four flared walls.
    hx, hz = -0.95, 1.55
    for side in (-1, 1):
        wall = box('Hopper.Side', (1.0, 0.08, 0.85), loc=(hx, side * 0.62, hz))
        rotate(wall, x=-side * 18)
        bevel(wall, 0.02, 2)
        assign(wall, m['body'])
        body.append(wall)
    back = box('Hopper.Back', (0.08, 1.35, 0.85), loc=(hx - 0.5, 0, hz))
    rotate(back, y=-18)
    bevel(back, 0.02, 2)
    assign(back, m['body'])
    body.append(back)
    front = box('Hopper.Front', (0.08, 1.35, 0.85), loc=(hx + 0.5, 0, hz))
    rotate(front, y=18)
    bevel(front, 0.02, 2)
    assign(front, m['body'])
    body.append(front)
    grate = box('Hopper.Grate', (0.03, 1.0, 0.04), loc=(hx - 0.35, 0, hz + 0.44))
    array(grate, 6, (0.14, 0, 0))
    assign(grate, m['stripe'])
    body.append(grate)
    body += rock_pile('Hopper.Load', (hx, 0, hz + 0.1), (0.25, 0.3), m, count=6, seed=7)
    # Jaw crusher box with the flywheel outside.
    jaw = box('Crusher', (1.0, 1.2, 1.0), loc=(0.15, 0, 1.4))
    bevel(jaw, 0.08, 4)
    assign(jaw, m['body'])
    body.append(jaw)
    bolts = cylinder('Crusher.Bolt', 0.035, 0.06, loc=(0.15, 0.62, 1.05), axis='Y', segments=8)
    array(bolts, 5, (0.0, 0, 0.18))
    assign(bolts, m['dark'])
    body.append(bolts)
    engine = box('Engine', (0.7, 0.95, 0.7), loc=(1.05, 0.1, 1.2))
    bevel(engine, 0.08, 3)
    assign(engine, m['dark'])
    body.append(engine)
    body += exhaust('Exhaust', (1.1, 0.35, 1.55), 0.5, m, radius=0.05)
    panel = box('ControlPanel', (0.3, 0.5, 0.6), loc=(0.55, -0.7, 1.05))
    bevel(panel, 0.03, 2)
    assign(panel, m['steel'])
    body.append(panel)
    # Access ladder on the side.
    rail = box('Ladder.Rail', (0.04, 0.04, 0.9), loc=(-0.35, -0.7, 0.95))
    array(rail, 2, (0.3, 0, 0))
    assign(rail, m['dark'])
    body.append(rail)
    rung = box('Ladder.Rung', (0.34, 0.03, 0.03), loc=(-0.2, -0.7, 0.6))
    array(rung, 5, (0, 0, 0.18))
    assign(rung, m['dark'])
    body.append(rung)
    pivot('Body', (0, 0, 0), body)

    # Flywheel spins with the crusher.
    fw_loc = Vector((0.15, -0.68, 1.35))
    fw = cylinder('Flywheel.Disc', 0.42, 0.1, loc=fw_loc, axis='Y', segments=32)
    bevel(fw, 0.03, 2, angle=60)
    assign(fw, m['dark'])
    hub = cylinder('Flywheel.Hub', 0.12, 0.16, loc=fw_loc, axis='Y', segments=16)
    assign(hub, m['hub'])
    spokes = [fw, hub]
    for i in range(5):
        a = i * 2 * math.pi / 5
        sp = box('Flywheel.Spoke', (0.06, 0.05, 0.36), loc=fw_loc + Vector((math.cos(a) * 0.2, -0.06, math.sin(a) * 0.2)))
        rotate(sp, y=-math.degrees(a) + 90)
        assign(sp, m['hub'])
        spokes.append(sp)
    pivot('Flywheel', fw_loc, spokes)

    # Discharge conveyor rising forward.
    cp = Vector((0.7, 0, 0.95))
    length, rise = 2.1, 0.9
    ang = math.degrees(math.atan2(rise, length))
    mid = cp + Vector((length / 2, 0, rise / 2))
    belt = box('Conveyor.Belt', (math.hypot(length, rise), 0.7, 0.08), loc=mid)
    rotate(belt, y=-ang)
    assign(belt, m['rubber'])
    parts = [belt]
    for side in (-1, 1):
        rail = box('Conveyor.Rail', (math.hypot(length, rise), 0.06, 0.16), loc=mid + Vector((0, side * 0.38, 0.06)))
        rotate(rail, y=-ang)
        bevel(rail, 0.015, 2)
        assign(rail, m['body'])
        parts.append(rail)
    roller = cylinder('Conveyor.Roller', 0.05, 0.8, loc=cp + Vector((0.15, 0, -0.06)), axis='Y', segments=10)
    array(roller, 6, (0.36, 0, 0.36 * rise / length))
    assign(roller, m['steel'])
    parts.append(roller)
    pulley = cylinder('Conveyor.Pulley', 0.11, 0.8, loc=cp + Vector((length, 0, rise)), axis='Y', segments=16)
    assign(pulley, m['dark'])
    parts.append(pulley)
    legs = box('Conveyor.Leg', (0.06, 0.06, 0.9), loc=cp + Vector((1.5, 0.3, 0.05)))
    array(legs, 2, (0, -0.6, 0))
    assign(legs, m['steel'])
    parts.append(legs)
    pivot('Conveyor', cp, parts)


def hydraulic(name: str, a: Vector, b: Vector, radius: float, m) -> list[bpy.types.Object]:
    """A hydraulic cylinder from `a` (barrel end) to `b` (rod end)."""
    d = b - a
    length = d.length
    mid_barrel = a + d * 0.3
    mid_rod = a + d * 0.75
    # Orientation: align local Z to d.
    rot = d.to_track_quat('Z', 'Y').to_euler()
    barrel = cylinder(f'{name}.Barrel', radius, length * 0.55, loc=mid_barrel, segments=14)
    barrel.rotation_euler = rot
    assign(barrel, m['steel'])
    rod = cylinder(f'{name}.Rod', radius * 0.55, length * 0.5, loc=mid_rod, segments=10)
    rod.rotation_euler = rot
    assign(rod, m['chrome'])
    return [barrel, rod]


BUILDERS = {
    'debris_hauler': build_debris_hauler,
    'rock_digger': build_rock_digger,
    'drill_rig': build_drill_rig,
    'building_destroyer': build_building_destroyer,
    'rock_fragmenter': build_rock_fragmenter,
}


def build_vehicle(role: str) -> None:
    m = _materials()
    BUILDERS[role](m)
