"""Tier-3 vehicles — overpowered corporate monsters, one caricature per VehicleRole.

* debris_hauler  — Mega Mover XL: six-wheeled monster hauler, chrome grille with a gold XL
                   badge, twin flame-tipped stacks, neon under-glow, a tiny sky-high cab with a
                   satellite dish, and a rock mountain crowned by a golden nugget.
* rock_digger    — Rock Reaper: black-and-red excavator with a skull cab, glowing red eyes,
                   spiked tracks, chrome horns, flame decals and a scythe on the boom.
* drill_rig      — Helldriller: horned demon-red rig, lava-glowing screw bit on a huge mast,
                   spiked wheels, a pitchfork antenna and a devil tail.
* building_destroyer — Obliterator Supreme: tank-tracked dozer with a gold face-painted blade,
                   a spiked wrecking ball on a crane, a green laser turret and corporate flags.
* rock_fragmenter — The Atomizer: sci-fi crusher with a glowing reactor dome, particle-accelerator
                   ring flywheel, funnel hopper, warning lights and twin conveyors.

Same conventions as vehicles.py: +X forward, +Y left, ground at z = 0, `TintBody` is
the per-instance paint, emissive materials stay on their own meshes.
"""
from __future__ import annotations

import math
import random

import bpy
from mathutils import Vector

from common import (
    apply_transform, array, assign, bevel, box, cylinder, icosphere, material, pivot, prism, rotate, sphere, torus,
)
from vehicles import _materials, cab, fender, headlights, hydraulic, rock_pile, track

ROLES = ['debris_hauler', 'rock_digger', 'drill_rig', 'building_destroyer', 'rock_fragmenter']


def _materials_t3(body_color: int = 0x1E1E24) -> dict[str, bpy.types.Material]:
    """Tier-2 palette with the luxury additions. Materials sharing a tier-2 name are created first so the
    cached lookup in `material()` hands the tier-2 helpers our colours."""
    overrides = {
        'body': material('TintBody', body_color, roughness=0.45),  # default paint, recoloured per instance
        'hub': material('ChromeHub', 0xE6EAF0, roughness=0.2, metallic=0.7),
        'chrome': material('Chrome', 0xDCE1E8, roughness=0.25, metallic=0.6),
        'red': material('Red', 0xD8322B, roughness=0.55),
        'gold': material('Gold', 0xE8B923, roughness=0.3, metallic=0.6),
        'black': material('Black', 0x121216, roughness=0.7),
        'crimson': material('Crimson', 0x9B1015, roughness=0.55),
        'bone': material('Bone', 0xE9E2CF, roughness=0.6),
        'white': material('White', 0xF2F4F7, roughness=0.5),
        'blue': material('Blue', 0x2A63C9, roughness=0.5),
        'orange': material('Orange', 0xFF8C1A, roughness=0.55),
        'hazard': material('Hazard', 0xF5C518, roughness=0.6),
        'glow_flame': material('GlowFlame', 0xFF8A20, emission=0xFF6A10, emission_strength=1.5),
        'glow_neon': material('GlowNeon', 0xFF30C8, emission=0xFF20C0, emission_strength=1.5),
        'glow_cyan': material('GlowCyan', 0x40E8FF, emission=0x20D8FF, emission_strength=1.5),
        'glow_red': material('GlowRed', 0xFF3020, emission=0xFF2010, emission_strength=1.5),
        'glow_lava': material('GlowLava', 0xFF7A18, emission=0xFF5A08, emission_strength=1.6),
        'glow_green': material('GlowGreen', 0x60FF40, emission=0x40FF20, emission_strength=1.5),
        'glow_blue': material('GlowBlue', 0x50A8FF, emission=0x2C90FF, emission_strength=1.5),
        'glow_warn': material('GlowWarn', 0xFFB020, emission=0xFF9A10, emission_strength=1.3),
    }
    m = _materials()
    m.update(overrides)
    return m


# --------------------------------------------------------------- parts ---

def _wheel_t3(name: str, radius: float, width: float, loc, m, hub_ratio: float = 0.6) -> bpy.types.Object:
    """A fat tyre with a chrome hub and a gold cap, lighter than vehicles.wheel (tier 3 has six of them)."""
    tyre = cylinder(f'{name}.Tyre', radius, width, loc=loc, axis='Y', segments=24)
    bevel(tyre, radius * 0.26, 3, angle=60)
    assign(tyre, m['rubber'])
    hub = cylinder(f'{name}.Hub', radius * hub_ratio, width * 1.06, loc=loc, axis='Y', segments=20)
    bevel(hub, radius * 0.08, 2, angle=60)
    assign(hub, m['hub'])
    cap = cylinder(f'{name}.Cap', radius * 0.2, width * 1.16, loc=loc, axis='Y', segments=12)
    assign(cap, m['gold'])
    parts = [tyre, hub, cap]
    for i in range(6):
        a = i * math.pi / 3
        r = radius * hub_ratio * 0.64
        bolt = cylinder(f'{name}.Bolt', radius * 0.05, width * 1.12,
                        loc=(loc[0] + math.cos(a) * r, loc[1], loc[2] + math.sin(a) * r), axis='Y', segments=6)
        assign(bolt, m['black'])
        parts.append(bolt)
    return pivot(name, loc, parts)


def _flame(name: str, loc, radius: float, height: float, m) -> list[bpy.types.Object]:
    """A stylised flame tongue: an emissive cone with a smaller inner tongue leaning off-axis."""
    outer = cylinder(f'{name}.Flame', radius, height, loc=(loc[0], loc[1], loc[2] + height / 2), segments=12,
                     radius2=0.01)
    assign(outer, m['glow_flame'])
    inner = cylinder(f'{name}.Flame2', radius * 0.55, height * 0.7, loc=(loc[0] + radius * 0.3, loc[1], loc[2] + height * 0.55),
                     segments=10, radius2=0.01)
    rotate(inner, y=18)
    assign(inner, m['glow_flame'])
    return [outer, inner]


def _stack(name: str, loc, height: float, radius: float, m, flame: float = 0.45) -> list[bpy.types.Object]:
    """Chrome exhaust stack with a gold collar and a flame tip."""
    pipe = cylinder(f'{name}.Pipe', radius, height, loc=(loc[0], loc[1], loc[2] + height / 2), segments=12)
    assign(pipe, m['chrome'])
    collar = cylinder(f'{name}.Collar', radius * 1.35, radius * 1.2, loc=(loc[0], loc[1], loc[2] + height * 0.92), segments=12)
    bevel(collar, radius * 0.3, 2, angle=60)
    assign(collar, m['gold'])
    base = cylinder(f'{name}.Base', radius * 1.5, radius * 1.2, loc=(loc[0], loc[1], loc[2] + radius * 0.5), segments=12)
    bevel(base, radius * 0.3, 2, angle=60)
    assign(base, m['dark'])
    return [pipe, collar, base] + _flame(name, (loc[0], loc[1], loc[2] + height), radius * 1.1, flame, m)


def _gold_line(name: str, size, loc, m, rot=None) -> bpy.types.Object:
    line = box(name, size, loc=loc, rot=rot)
    bevel(line, min(size) * 0.3, 2)
    assign(line, m['gold'])
    return line


def _rock_mountain(name: str, center, spread, m, count: int = 14, seed: int = 5, tiers: int = 3) -> list[bpy.types.Object]:
    """A heap of boulders stacked into a peak — the over-loaded tier-3 haul."""
    rnd = random.Random(seed)
    out = []
    cx, cy, cz = center
    sx, sy = spread
    per = max(1, count // tiers)
    for i in range(count):
        tier = min(tiers - 1, i // per)
        shrink = 1.0 - tier * 0.3
        r = rnd.uniform(0.27, 0.4) * (1.0 - tier * 0.15)
        loc = (cx + rnd.uniform(-sx, sx) * shrink, cy + rnd.uniform(-sy, sy) * shrink, cz + tier * 0.36 + rnd.uniform(0, 0.08))
        rock = sphere(f'{name}.Rock', r, loc=loc, scale=(rnd.uniform(0.85, 1.35), rnd.uniform(0.85, 1.3), rnd.uniform(0.6, 0.85)),
                      segments=10, rings=6)
        rotate(rock, rnd.uniform(0, 40), rnd.uniform(0, 40), rnd.uniform(0, 180))
        assign(rock, m['rock'] if i % 3 else m['rock2'])
        out.append(rock)
    return out


def _nugget(name: str, loc, radius: float, m) -> bpy.types.Object:
    """A faceted golden nugget."""
    nug = icosphere(name, radius, loc=loc, subdivisions=1, scale=(1.25, 1.0, 0.85))
    nug.data.shade_flat()
    rotate(nug, 12, 20, 30)
    assign(nug, m['gold'])
    return nug


def _dish(name: str, loc, m, radius: float = 0.32) -> list[bpy.types.Object]:
    """Satellite dish on a stem, aimed forward-up."""
    x, y, z = loc
    stem = cylinder(f'{name}.Stem', 0.03, 0.18, loc=(x, y, z + 0.09), segments=8)
    assign(stem, m['chrome'])
    dish = cylinder(f'{name}.Dish', radius, 0.09, loc=(x + 0.04, y, z + 0.24), segments=20, radius2=radius * 0.3)
    rotate(dish, y=-50)
    assign(dish, m['white'])
    rim = torus(f'{name}.Rim', radius, 0.025, loc=(x + 0.07, y, z + 0.27), rot=(0, -50, 0), major_segments=20, minor_segments=6)
    assign(rim, m['chrome'])
    feed = cylinder(f'{name}.Feed', 0.015, radius * 0.8, loc=(x + 0.2, y, z + 0.38), segments=6)
    rotate(feed, y=-50)
    assign(feed, m['dark'])
    knob = sphere(f'{name}.Knob', 0.035, loc=(x + 0.3, y, z + 0.47), segments=8, rings=6)
    assign(knob, m['red'])
    return [stem, dish, rim, feed, knob]


def _crescent(center, radius: float, a0: float, a1: float, width: float, n: int = 10) -> list[tuple[float, float]]:
    """2D scythe-blade outline: an arc of `radius` from `a0` to `a1` degrees, `width` thick at the base, sharp at the tip."""
    pts = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        pts.append((center[0] + math.cos(a) * radius, center[1] + math.sin(a) * radius))
    for i in range(n - 1, -1, -1):
        t = i / n
        a = math.radians(a0 + (a1 - a0) * t)
        r = radius - width * (1 - t) ** 0.7
        pts.append((center[0] + math.cos(a) * r, center[1] + math.sin(a) * r))
    return pts


FLAME_DECAL = [(0.55, -0.38), (0.55, 0.32), (0.2, 0.2), (-0.05, 0.38), (-0.25, 0.15), (-0.6, 0.3), (-0.7, 0.05),
               (-1.2, 0.15), (-0.85, -0.1), (-1.0, -0.3), (-0.55, -0.22), (-0.35, -0.38)]


def _flame_decal(name: str, loc, side: int, m, scale: float = 1.0) -> list[bpy.types.Object]:
    """Hot-rod flame licks as two flat inset shapes (red, orange core) standing proud of a side panel at `loc`."""
    x, y, z = loc
    out = []
    for layer, (mat, k, off) in enumerate(((m['red'], 1.0, 0.0), (m['orange'], 0.6, 0.012))):
        pts = [(0.55 + (px - 0.55) * k * scale, -0.03 + (pz + 0.03) * k * scale) for px, pz in FLAME_DECAL]
        deco = prism(f'{name}.Lick{layer}', pts, 0.02, loc=(x, y + side * off, z), axis='Y')
        assign(deco, mat)
        out.append(deco)
    return out


def _skull(name: str, center, r: float, m) -> list[bpy.types.Object]:
    """A grinning skull facing +X: cranium, jaw with teeth, glowing red eye sockets, angry brows."""
    cx, cy, cz = center
    cranium = sphere(f'{name}.Cranium', r, loc=(cx, cy, cz), scale=(1.0, 0.95, 1.0), segments=20, rings=12)
    assign(cranium, m['bone'])
    jaw = box(f'{name}.Jaw', (r * 1.2, r * 1.45, r * 0.55), loc=(cx + r * 0.15, cy, cz - r * 0.75))
    bevel(jaw, r * 0.15, 3)
    assign(jaw, m['bone'])
    mouth = box(f'{name}.Mouth', (0.06, r * 1.05, r * 0.3), loc=(cx + r * 0.75, cy, cz - r * 0.7))
    assign(mouth, m['black'])
    parts = [cranium, jaw, mouth]
    for i in range(5):
        tooth = box(f'{name}.Tooth', (0.07, r * 0.14, r * 0.26), loc=(cx + r * 0.8, cy + (i - 2) * r * 0.22, cz - r * 0.7))
        bevel(tooth, 0.008, 1)
        assign(tooth, m['bone'])
        parts.append(tooth)
    for side in (-1, 1):
        socket = sphere(f'{name}.Socket', r * 0.32, loc=(cx + r * 0.8, cy + side * r * 0.4, cz + r * 0.1), segments=14, rings=8)
        assign(socket, m['black'])
        eye = sphere(f'{name}.Eye', r * 0.2, loc=(cx + r * 0.98, cy + side * r * 0.4, cz + r * 0.1), segments=12, rings=8)
        assign(eye, m['glow_red'])
        brow = box(f'{name}.Brow', (r * 0.2, r * 0.55, r * 0.12), loc=(cx + r * 0.9, cy + side * r * 0.42, cz + r * 0.42))
        rotate(brow, x=side * 25)
        bevel(brow, 0.01, 1)
        assign(brow, m['black'])
        parts += [socket, eye, brow]
    nose = prism(f'{name}.Nose', [(-r * 0.12, -r * 0.14), (r * 0.12, -r * 0.14), (0, r * 0.1)], 0.05,
                 loc=(cx + r * 0.98, cy, cz - r * 0.22), axis='X')
    assign(nose, m['black'])
    parts.append(nose)
    return parts


def _pitchfork(name: str, loc, height: float, m) -> list[bpy.types.Object]:
    """A chrome pitchfork standing on its shaft — the demon rig's radio antenna."""
    x, y, z = loc
    shaft = cylinder(f'{name}.Shaft', 0.03, height, loc=(x, y, z + height / 2), segments=8)
    assign(shaft, m['chrome'])
    bar = box(f'{name}.Bar', (0.05, 0.42, 0.05), loc=(x, y, z + height - 0.36))
    assign(bar, m['chrome'])
    parts = [shaft, bar]
    for dy in (-0.185, 0.0, 0.185):
        tine = cylinder(f'{name}.Tine', 0.03, 0.42, loc=(x, y + dy, z + height - 0.15), segments=8, radius2=0.003)
        assign(tine, m['chrome'])
        parts.append(tine)
    return parts


def _devil_tail(name: str, center, radius: float, a0: float, a1: float, m, segs: int = 7) -> list[bpy.types.Object]:
    """A tapering tail curling along an arc in the XZ plane (angles in degrees from +X), ending in an arrowhead."""
    pts = []
    for i in range(segs + 1):
        a = math.radians(a0 + (a1 - a0) * i / segs)
        pts.append(Vector((center[0] + math.cos(a) * radius, center[1], center[2] + math.sin(a) * radius)))
    parts = []
    for i in range(segs):
        a, b = pts[i], pts[i + 1]
        d = b - a
        seg = cylinder(f'{name}.Seg', 0.075 * (1 - 0.5 * i / segs), d.length * 1.2, loc=(a + b) / 2, segments=8)
        seg.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
        assign(seg, m['crimson'])
        parts.append(seg)
    d = pts[-1] - pts[-2]
    head = cylinder(f'{name}.Head', 0.16, 0.34, loc=pts[-1] + d.normalized() * 0.14, segments=3, radius2=0.004)
    head.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    assign(head, m['crimson'])
    parts.append(head)
    return parts


def _horn(name: str, loc, length: float, radius: float, m, tilt_x: float = 0.0, tilt_y: float = 0.0) -> bpy.types.Object:
    """A chrome horn (cone) standing on `loc`, tilted by the given degrees."""
    d = Vector((0, 0, 1))
    horn = cylinder(name, radius, length, loc=loc, segments=10, radius2=0.01)
    rotate(horn, x=tilt_x, y=tilt_y)
    # Shift so the base sits on loc after the tilt.
    horn.location = Vector(loc) + (horn.rotation_euler.to_matrix() @ d) * (length / 2)
    assign(horn, m['chrome'])
    return horn


def _hazard(name: str, loc, width: float, height: float, m, count: int = 3) -> list[bpy.types.Object]:
    """Diagonal yellow-on-black hazard stripes on a face perpendicular to +X, centred on `loc`."""
    x, y, z = loc
    base = box(f'{name}.Base', (0.03, width, height), loc=(x, y, z))
    assign(base, m['black'])
    parts = [base]
    step = width / (count * 2)
    skew = min(step, height * 0.6)
    lo, hi = -width / 2, width / 2
    for i in range(count):
        y0 = lo + step * (2 * i)
        pts = [(y0, -height / 2), (y0 + step, -height / 2), (min(hi, y0 + step + skew), height / 2), (min(hi, y0 + skew), height / 2)]
        stripe = prism(f'{name}.Stripe', pts, 0.02, loc=(x + 0.02, y, z), axis='X')
        assign(stripe, m['hazard'])
        parts.append(stripe)
    return parts


def _pennant(name: str, loc, length: float, height: float, mat, m, side: int = 1) -> list[bpy.types.Object]:
    """A pole at `loc` (base) with a triangular corporate pennant trailing backward from its top."""
    x, y, z = loc
    pole = cylinder(f'{name}.Pole', 0.022, height, loc=(x, y, z + height / 2), segments=8)
    assign(pole, m['chrome'])
    knob = sphere(f'{name}.Knob', 0.05, loc=(x, y, z + height + 0.03), segments=8, rings=6)
    assign(knob, m['gold'])
    flag = prism(f'{name}.Flag', [(0, 0), (-length, 0.15), (0, 0.3)], 0.025, loc=(x, y, z + height - 0.32), axis='Y')
    assign(flag, mat)
    logo = box(f'{name}.Logo', (0.14, 0.045, 0.1), loc=(x - length * 0.3, y, z + height - 0.17))
    assign(logo, m['black'] if mat is not m['black'] else m['gold'])
    return [pole, knob, flag, logo]


def _morning_star(name: str, center, radius: float, m) -> list[bpy.types.Object]:
    """A spiked iron wrecking ball."""
    ball = sphere(f'{name}.Ball', radius, loc=center, segments=18, rings=10)
    assign(ball, m['dark'])
    parts = [ball]
    parts += _spikes(name, center, radius * 0.9, 8, radius * 0.5, m, axis='Y', width=radius * 0.16, phase=0.3)
    parts += _spikes(name, center, radius * 0.9, 6, radius * 0.5, m, axis='X', width=radius * 0.16, phase=0.8)
    parts += _spikes(name, center, radius * 0.9, 4, radius * 0.5, m, axis='Z', width=radius * 0.16, phase=0.785)
    return parts


def _beam(name: str, a: Vector, b: Vector, size: tuple[float, float], m, mat=None) -> bpy.types.Object:
    """A rectangular bar of cross-section `size` (x, y) running from `a` to `b`."""
    d = b - a
    bar = box(name, (size[0], size[1], d.length), loc=(a + b) / 2)
    bar.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    bevel(bar, min(size) * 0.2, 2)
    assign(bar, mat or m['body'])
    return bar


def _spikes(name: str, center, radius: float, count: int, length: float, m, axis: str = 'Y', width: float = 0.06,
            phase: float = 0.0) -> list[bpy.types.Object]:
    """Cones radiating from `center` in the plane perpendicular to `axis`."""
    out = []
    for i in range(count):
        a = phase + i * 2 * math.pi / count
        if axis == 'Y':
            d = Vector((math.cos(a), 0, math.sin(a)))
        elif axis == 'X':
            d = Vector((0, math.cos(a), math.sin(a)))
        else:
            d = Vector((math.cos(a), math.sin(a), 0))
        loc = Vector(center) + d * (radius + length / 2)
        spike = cylinder(f'{name}.Spike', width, length, loc=loc, segments=8, radius2=0.005)
        spike.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
        assign(spike, m['chrome'])
        out.append(spike)
    return out


# ------------------------------------------------------------ vehicles ---

def build_debris_hauler(m) -> None:
    """Mega Mover XL: six-wheeled monster hauler with a rock mountain and a golden nugget."""
    body = []
    chassis = box('Chassis', (3.7, 1.4, 0.32), loc=(0, 0, 0.8))
    bevel(chassis, 0.05, 3)
    assign(chassis, m['dark'])
    body.append(chassis)
    # Neon under-glow: a magenta slab under the chassis plus a strip on each side skirt.
    glow = box('Underglow', (3.3, 1.55, 0.05), loc=(0, 0, 0.62))
    assign(glow, m['glow_neon'])
    body.append(glow)
    for side in (-1, 1):
        skirt = box('Skirt', (1.0, 0.08, 0.3), loc=(-0.3, side * 0.98, 0.9))
        bevel(skirt, 0.03, 2)
        assign(skirt, m['dark'])
        body.append(skirt)
        strip = box('Skirt.Neon', (0.9, 0.03, 0.05), loc=(-0.3, side * 1.03, 0.78))
        assign(strip, m['glow_neon'])
        body.append(strip)
    # Engine hood: a huge slab with a chrome air scoop, gold trim lines and a chrome grille.
    hood = box('Hood', (1.2, 1.9, 0.95), loc=(1.25, 0, 1.43))
    bevel(hood, 0.13, 4)
    assign(hood, m['body'])
    body.append(hood)
    scoop = box('Hood.Scoop', (0.62, 0.55, 0.26), loc=(1.3, 0, 2.0))
    bevel(scoop, 0.08, 3)
    assign(scoop, m['chrome'])
    body.append(scoop)
    mouth = box('Hood.ScoopMouth', (0.04, 0.42, 0.16), loc=(1.62, 0, 2.02))
    assign(mouth, m['black'])
    body.append(mouth)
    for side in (-1, 1):
        body.append(_gold_line('Hood.Trim', (1.05, 0.035, 0.07), (1.25, side * 0.955, 1.5), m))
        body.append(_gold_line('Hood.TrimTop', (1.05, 0.07, 0.035), (1.25, side * 0.8, 1.915), m))
    grille = box('Grille', (0.1, 1.4, 0.64), loc=(1.86, 0, 1.4))
    bevel(grille, 0.035, 3)
    assign(grille, m['chrome'])
    body.append(grille)
    slat = box('Grille.Slat', (0.03, 1.24, 0.055), loc=(1.92, 0, 1.17))
    array(slat, 5, (0, 0, 0.115))
    assign(slat, m['black'])
    body.append(slat)
    # Gold "XL" badge sitting proud of the grille.
    for rot in (40, -40):
        bar = box('Badge.X', (0.05, 0.1, 0.5), loc=(1.96, 0.3, 1.42))
        rotate(bar, x=rot)
        bevel(bar, 0.015, 2)
        assign(bar, m['gold'])
        body.append(bar)
    lv = box('Badge.L', (0.05, 0.1, 0.5), loc=(1.96, -0.1, 1.42))
    bevel(lv, 0.015, 2)
    assign(lv, m['gold'])
    body.append(lv)
    lh = box('Badge.L', (0.05, 0.34, 0.1), loc=(1.96, -0.22, 1.22))
    bevel(lh, 0.015, 2)
    assign(lh, m['gold'])
    body.append(lh)
    # Chrome bumper with a gold lip and stacked quad headlights.
    bumper = box('Bumper', (0.22, 2.05, 0.3), loc=(1.88, 0, 0.92))
    bevel(bumper, 0.09, 3)
    assign(bumper, m['chrome'])
    body.append(bumper)
    body.append(_gold_line('Bumper.Lip', (0.25, 1.9, 0.05), (1.88, 0, 1.09), m))
    front_neon = box('Bumper.Neon', (0.06, 1.9, 0.04), loc=(1.9, 0, 0.75))
    assign(front_neon, m['glow_neon'])
    body.append(front_neon)
    rear_neon = box('Rear.Neon', (0.06, 1.5, 0.04), loc=(-1.86, 0, 0.62))
    assign(rear_neon, m['glow_neon'])
    body.append(rear_neon)
    body += headlights('HeadHi', 1.86, (-0.72, 0.72), 1.66, m, radius=0.11)
    body += headlights('HeadLo', 1.86, (-0.72, 0.72), 1.36, m, radius=0.09)
    # Cab tower: the operator sits in a tiny box on top, off to the left, with a railed deck beside it.
    tower = box('Tower', (0.75, 1.8, 1.35), loc=(0.25, 0, 1.6))
    bevel(tower, 0.1, 4)
    assign(tower, m['body'])
    body.append(tower)
    body.append(_gold_line('Tower.Trim', (0.8, 1.86, 0.05), (0.25, 0, 2.05), m))
    body += cab('Cab', (0.72, 0.8, 0.66), (0.25, 0.45, 2.6), m)
    deck = box('Deck', (0.75, 0.75, 0.06), loc=(0.25, -0.5, 2.3))
    bevel(deck, 0.02, 2)
    assign(deck, m['steel'])
    body.append(deck)
    for (dx, dy) in ((-0.32, -0.82), (0.32, -0.82), (0.32, -0.2)):
        post = cylinder('Deck.Post', 0.02, 0.45, loc=(0.25 + dx, dy, 2.55), segments=6)
        assign(post, m['chrome'])
        body.append(post)
    rail = box('Deck.Rail', (0.68, 0.03, 0.03), loc=(0.25, -0.82, 2.77))
    assign(rail, m['chrome'])
    body.append(rail)
    rail2 = box('Deck.Rail', (0.03, 0.62, 0.03), loc=(0.57, -0.51, 2.77))
    assign(rail2, m['chrome'])
    body.append(rail2)
    # Mirrors on chrome stalks either side of the cab.
    for side in (-1, 1):
        y = 0.45 + side * 0.5
        stalk = cylinder('Mirror.Stalk', 0.015, 0.22, loc=(0.6, y, 2.7), axis='Y', segments=6)
        assign(stalk, m['chrome'])
        mirror = box('Mirror.Glass', (0.04, 0.1, 0.16), loc=(0.6, y + side * 0.1, 2.7))
        bevel(mirror, 0.012, 2)
        assign(mirror, m['chrome'])
        body += [stalk, mirror]
    body += _dish('Dish', (0.2, 0.45, 2.96), m)
    # Twin chrome stacks with flame tips on the tower's rear corners.
    for side in (-1, 1):
        body += _stack('Stack', (0.0, side * 0.72, 2.28), 0.8, 0.1, m, flame=0.45)
    # Fenders over the front wheels, mud-flaps behind them.
    for side in (-1, 1):
        body.append(fender('Fender', 0.72, 0.56, (1.25, side * 0.78, 0.6), m))
        flap = box('Flap', (0.06, 0.5, 0.45), loc=(0.55, side * 0.78, 0.48))
        assign(flap, m['rubber'])
        body.append(flap)
    # Steps up to the deck.
    step = box('Step', (0.35, 0.06, 0.06), loc=(0.25, -0.95, 1.0))
    array(step, 4, (0, 0, 0.35))
    assign(step, m['chrome'])
    body.append(step)
    pivot('Body', (0, 0, 0), body)

    # Bed: a deep box hinged at the rear, gold-trimmed, with a spoiler on the tailgate and a rock mountain.
    bed = []
    floor = box('Bed.Floor', (1.85, 1.9, 0.15), loc=(-1.0, 0, 1.33))
    bevel(floor, 0.03, 2)
    assign(floor, m['body'])
    bed.append(floor)
    for side in (-1, 1):
        wall = box('Bed.Side', (1.85, 0.1, 0.9), loc=(-1.0, side * 0.9, 1.85))
        bevel(wall, 0.035, 3)
        assign(wall, m['body'])
        bed.append(wall)
        bed.append(_gold_line('Bed.Trim', (1.87, 0.14, 0.06), (-1.0, side * 0.9, 2.32), m))
        rib = box('Bed.Rib', (0.08, 0.06, 0.85), loc=(-1.6, side * 0.97, 1.85))
        array(rib, 4, (0.42, 0, 0))
        bevel(rib, 0.015, 2)
        assign(rib, m['dark'])
        bed.append(rib)
    head = box('Bed.Headboard', (0.1, 1.9, 1.2), loc=(-0.1, 0, 1.98))
    bevel(head, 0.035, 3)
    assign(head, m['body'])
    bed.append(head)
    bed.append(_gold_line('Bed.HeadTrim', (0.14, 1.92, 0.06), (-0.1, 0, 2.58), m))
    gate = box('Bed.Tailgate', (0.1, 1.9, 0.9), loc=(-1.9, 0, 1.85))
    bevel(gate, 0.035, 3)
    assign(gate, m['body'])
    bed.append(gate)
    bed.append(_gold_line('Bed.GateTrim', (0.14, 1.92, 0.06), (-1.9, 0, 2.32), m))
    # Rear spoiler on the tailgate.
    for side in (-1, 1):
        up = box('Bed.SpoilerPost', (0.1, 0.1, 0.4), loc=(-1.92, side * 0.7, 2.5))
        rotate(up, y=15)
        bevel(up, 0.02, 2)
        assign(up, m['chrome'])
        bed.append(up)
        plate = box('Bed.SpoilerEnd', (0.4, 0.04, 0.22), loc=(-1.95, side * 0.98, 2.74))
        bevel(plate, 0.012, 2)
        assign(plate, m['gold'])
        bed.append(plate)
    wing = box('Bed.Spoiler', (0.4, 1.95, 0.09), loc=(-1.95, 0, 2.72))
    rotate(wing, y=-14)
    bevel(wing, 0.035, 3)
    assign(wing, m['body'])
    bed.append(wing)
    bed.append(_gold_line('Bed.SpoilerTrim', (0.08, 1.96, 0.1), (-2.12, 0, 2.77), m))
    # Rock mountain crowned by the golden nugget.
    bed += _rock_mountain('Bed.Load', (-1.0, 0, 2.1), (0.55, 0.5), m, count=15, seed=11)
    bed.append(_nugget('Bed.Nugget', (-1.0, 0.05, 3.0), 0.3, m))
    pivot('Bed', (-1.95, 0, 1.3), bed)

    for name, x in (('WheelF', 1.25), ('WheelM', -0.3), ('WheelR', -1.4)):
        for suffix, side in (('L', 1), ('R', -1)):
            _wheel_t3(f'{name}{suffix}', 0.6, 0.5, (x, side * 0.78, 0.6), m)


def build_rock_digger(m) -> None:
    """Rock Reaper: black-and-red excavator with a skull cab, spiked tracks, horn exhausts and a scythe on the boom."""
    body = []
    for side in (-1, 1):
        body += track('Track', 3.0, 0.7, 0.44, (0, side * 0.74, 0.385), m, pads=16)
        spike = cylinder('Track.Spike', 0.05, 0.22, loc=(-1.2, side * 1.03, 0.785), segments=8, radius2=0.006)
        rotate(spike, x=-side * 40)
        apply_transform(spike)
        array(spike, 7, (0.4, 0, 0))
        assign(spike, m['chrome'])
        body.append(spike)
    carriage = box('Carriage', (1.7, 1.3, 0.4), loc=(0, 0, 0.55))
    bevel(carriage, 0.05, 3)
    assign(carriage, m['dark'])
    body.append(carriage)
    ring = cylinder('Slew', 0.72, 0.16, loc=(0, 0, 0.83), segments=28)
    bevel(ring, 0.03, 2, angle=60)
    assign(ring, m['chrome'])
    body.append(ring)
    house = box('House', (2.1, 1.6, 0.95), loc=(-0.35, 0, 1.38))
    bevel(house, 0.11, 4)
    assign(house, m['body'])
    body.append(house)
    for z, h in ((1.8, 0.07), (0.96, 0.05)):
        band = box('House.Band', (2.12, 1.62, h), loc=(-0.35, 0, z))
        bevel(band, 0.015, 2)
        assign(band, m['red'])
        body.append(band)
    counter = box('Counterweight', (0.6, 1.5, 0.85), loc=(-1.6, 0, 1.33))
    bevel(counter, 0.12, 4)
    assign(counter, m['dark'])
    body.append(counter)
    for side in (-1, 1):
        vent = box('Vent', (0.1, 0.05, 0.5), loc=(-1.2, side * 0.81, 1.35))
        array(vent, 3, (0.18, 0, 0))
        assign(vent, m['red'])
        body.append(vent)
        body += _flame_decal('Flame', (0.05, side * 0.812, 1.38), side, m)
        # Chrome exhaust horns splayed off the counterweight like a bull's.
        horn = cylinder('Horn', 0.1, 0.8, loc=(-1.55, side * 0.5, 2.1), segments=12, radius2=0.025)
        rotate(horn, x=-side * 35, y=-15)
        assign(horn, m['chrome'])
        base = cylinder('Horn.Base', 0.14, 0.1, loc=(-1.47, side * 0.27, 1.78), segments=12)
        assign(base, m['dark'])
        body += [horn, base]
    body += _skull('Skull', (0.3, 0.42, 2.28), 0.47, m)
    # Roof furniture: chrome ribs, a red light bar and a whip antenna so the house top is not a bare slab.
    rib = box('House.Rib', (0.06, 1.3, 0.05), loc=(-1.1, 0, 1.87))
    array(rib, 3, (0.3, 0, 0))
    assign(rib, m['chrome'])
    body.append(rib)
    bar = box('House.LightBar', (0.12, 0.8, 0.08), loc=(-0.2, -0.3, 1.9))
    assign(bar, m['dark'])
    body.append(bar)
    lamp = box('House.LightBarLamp', (0.06, 0.7, 0.05), loc=(-0.14, -0.3, 1.91))
    assign(lamp, m['glow_red'])
    body.append(lamp)
    whip = cylinder('House.Whip', 0.02, 0.9, loc=(-1.3, -0.6, 2.3), segments=6)
    assign(whip, m['chrome'])
    body.append(whip)
    for side in (-1, 1):
        body.append(_horn('Skull.Horn', (0.2, 0.42 + side * 0.3, 2.62), 0.4, 0.07, m, tilt_x=-side * 40, tilt_y=-10))
    tail = box('Counterweight.Glow', (0.05, 1.1, 0.08), loc=(-1.9, 0, 1.2))
    assign(tail, m['glow_red'])
    body.append(tail)
    pivot('Body', (0, 0, 0), body)

    # Boom: the reaper's snath, black with a chrome scythe blade sweeping back over the house.
    boom_pivot = Vector((0.55, -0.25, 1.5))
    bp = [(0.0, -0.2), (0.69, 0.69), (1.44, 1.19), (1.69, 1.06), (1.31, 0.69), (0.44, -0.06), (0.19, -0.25)]
    boom = prism('Boom.Beam', bp, 0.4, loc=boom_pivot, axis='Y')
    bevel(boom, 0.045, 3)
    assign(boom, m['body'])
    stripe = prism('Boom.Stripe', [(0.12, -0.1), (0.62, 0.5), (1.3, 0.96), (1.36, 0.86), (0.7, 0.42), (0.25, -0.15)], 0.42,
                   loc=boom_pivot, axis='Y')
    assign(stripe, m['red'])
    pin = cylinder('Boom.Pin', 0.11, 0.5, loc=boom_pivot, axis='Y', segments=16)
    assign(pin, m['chrome'])
    blade = prism('Boom.Scythe', _crescent((0.7, 0.3), 1.12, 28, 168, 0.34), 0.09, loc=boom_pivot, axis='Y')
    bevel(blade, 0.02, 2)
    assign(blade, m['chrome'])
    blade_edge = prism('Boom.ScytheEdge', _crescent((0.7, 0.3), 1.145, 28, 168, 0.08), 0.05, loc=boom_pivot, axis='Y')
    assign(blade_edge, m['red'])
    mount = box('Boom.ScytheMount', (0.34, 0.46, 0.24), loc=boom_pivot + Vector((1.5, 0, 1.0)))
    bevel(mount, 0.03, 2)
    assign(mount, m['dark'])
    boom_parts = [boom, stripe, pin, blade, blade_edge, mount]
    boom_parts += hydraulic('Boom.Lift', Vector((0.9, -0.25, 1.1)), boom_pivot + Vector((0.8, 0, 0.68)), 0.085, m)
    pivot('Boom', boom_pivot, boom_parts)

    stick_pivot = boom_pivot + Vector((1.56, 0, 1.12))
    sp = [(-0.12, 0.15), (0.15, 0.15), (1.31, -1.25), (1.19, -1.44), (0.94, -1.37), (-0.15, -0.06)]
    stick = prism('Stick.Beam', sp, 0.3, loc=stick_pivot, axis='Y')
    bevel(stick, 0.035, 3)
    assign(stick, m['body'])
    spin = cylinder('Stick.Pin', 0.085, 0.42, loc=stick_pivot, axis='Y', segments=16)
    assign(spin, m['chrome'])
    stick_parts = [stick, spin]
    stick_parts += hydraulic('Stick.Cyl', boom_pivot + Vector((0.75, 0, 0.95)), stick_pivot + Vector((0.55, 0, -0.45)), 0.07, m)
    pivot('Stick', stick_pivot, stick_parts)

    bucket_pivot = stick_pivot + Vector((1.12, 0, -1.31))
    bkp = [(0.0, 0.12), (0.44, 0.06), (0.62, -0.25), (0.5, -0.62), (0.06, -0.69), (-0.25, -0.44), (-0.19, 0.0)]
    bucket = prism('Bucket.Shell', bkp, 0.85, loc=bucket_pivot, axis='Y')
    bevel(bucket, 0.035, 2)
    assign(bucket, m['black'])
    lip = box('Bucket.Lip', (0.1, 0.87, 0.08), loc=bucket_pivot + Vector((0.6, 0, -0.26)))
    rotate(lip, y=-30)
    assign(lip, m['red'])
    bucket_parts = [bucket, lip]
    for i in range(5):
        y = -0.32 + i * 0.16
        tooth = cylinder('Bucket.Tooth', 0.055, 0.5, loc=bucket_pivot + Vector((0.78, y, -0.45)), segments=8, radius2=0.005)
        rotate(tooth, y=112 + (i % 2) * 8)
        assign(tooth, m['chrome'])
        bucket_parts.append(tooth)
    bucket_parts += hydraulic('Bucket.Cyl', stick_pivot + Vector((0.38, 0, -0.12)), bucket_pivot + Vector((-0.12, 0, 0.06)), 0.06, m)
    pivot('Bucket', bucket_pivot, bucket_parts)


def build_drill_rig(m) -> None:
    """Helldriller: demon-red wheeled rig with cab horns, a lava screw bit on a huge mast, flame stacks, a pitchfork and a tail."""
    body = []
    chassis = box('Chassis', (2.6, 1.15, 0.35), loc=(0, 0, 0.775))
    bevel(chassis, 0.05, 3)
    assign(chassis, m['dark'])
    body.append(chassis)
    frame = box('Frame', (2.3, 1.0, 0.22), loc=(0, 0, 1.03))
    assign(frame, m['dark'])
    body.append(frame)
    deck = box('Deck', (2.5, 1.55, 0.3), loc=(0, 0, 1.27))
    bevel(deck, 0.06, 3)
    assign(deck, m['body'])
    body.append(deck)
    for side in (-1, 1):
        body.append(_gold_line('Deck.Trim', (2.45, 0.04, 0.05), (0, side * 0.775, 1.4), m))
        for x in (-1.0, 1.0):
            body.append(fender('Fender', 0.7, 0.5, (x, side * 0.8, 0.71), m))
    # Engine block behind the cab with twin flame stacks.
    engine = box('Engine', (1.1, 1.4, 0.8), loc=(-0.55, 0, 1.82))
    bevel(engine, 0.11, 4)
    assign(engine, m['body'])
    body.append(engine)
    grille = box('Engine.Vent', (0.06, 0.05, 0.5), loc=(-0.95, 0.71, 1.82))
    array(grille, 4, (0.2, 0, 0))
    assign(grille, m['black'])
    body.append(grille)
    grille2 = box('Engine.Vent', (0.06, 0.05, 0.5), loc=(-0.95, -0.71, 1.82))
    array(grille2, 4, (0.2, 0, 0))
    assign(grille2, m['black'])
    body.append(grille2)
    for side in (-1, 1):
        body += _stack('Stack', (-0.8, side * 0.42, 2.2), 0.85, 0.11, m, flame=0.55)
    body += _pitchfork('Pitchfork', (-0.2, -0.5, 2.22), 1.25, m)
    body += _devil_tail('Tail', (-1.35, 0.3, 1.45), 0.68, 250, 55, m)
    # Cab with horns on the roof.
    body += cab('Cab', (0.8, 0.78, 0.85), (0.5, 0.4, 1.85), m)
    for side in (-1, 1):
        body.append(_horn('Cab.Horn', (0.45, 0.4 + side * 0.3, 2.33), 0.7, 0.1, m, tilt_x=-side * 28, tilt_y=-15))
    # Front: black grille with glowing eyes and a chrome bumper.
    grille_f = box('Grille', (0.06, 0.9, 0.34), loc=(1.26, 0.15, 1.27))
    assign(grille_f, m['black'])
    body.append(grille_f)
    for y in (-0.15, 0.45):
        eye = sphere('Grille.Eye', 0.09, loc=(1.28, y, 1.3), segments=12, rings=8)
        assign(eye, m['glow_red'])
        body.append(eye)
    bumper = box('Bumper', (0.14, 1.5, 0.22), loc=(1.33, 0, 0.85))
    bevel(bumper, 0.05, 3)
    assign(bumper, m['chrome'])
    body.append(bumper)
    # Mast foot plate and the dust hood the bit drills through.
    foot = Vector((1.15, -0.25, 0.95))
    plate = box('MastFoot', (0.7, 0.9, 0.2), loc=foot + Vector((0.2, 0, -0.1)))
    bevel(plate, 0.04, 2)
    assign(plate, m['dark'])
    body.append(plate)
    hood = box('DustHood', (0.55, 0.55, 0.3), loc=foot + Vector((0.75, 0, -0.8)))
    bevel(hood, 0.05, 3)
    assign(hood, m['black'])
    body.append(hood)
    pivot('Body', (0, 0, 0), body)

    # Mast: a solid demon-red column hinged at its foot, horns at the crown, lava screw bit in front.
    h = 4.6
    mast = []
    column = box('Mast.Column', (0.5, 0.75, h), loc=foot + Vector((0.3, 0, h / 2)))
    bevel(column, 0.07, 3)
    assign(column, m['body'])
    mast.append(column)
    for dx, dy in ((0.05, -0.375), (0.05, 0.375), (0.55, -0.375), (0.55, 0.375)):
        mast.append(_gold_line('Mast.Trim', (0.05, 0.05, h - 0.2), foot + Vector((dx, dy, h / 2)), m))
    for z in (1.2, 2.4, 3.6):
        vent = box('Mast.Vent', (0.06, 0.45, 0.28), loc=foot + Vector((0.03, 0, z)))
        assign(vent, m['black'])
        mast.append(vent)
        slot = box('Mast.VentGlow', (0.05, 0.3, 0.06), loc=foot + Vector((0.02, 0, z)))
        array(slot, 2, (0, 0, 0.12))
        slot.location.z -= 0.06
        assign(slot, m['glow_lava'])
        mast.append(slot)
        for side in (-1, 1):
            svent = box('Mast.SideVent', (0.28, 0.06, 0.28), loc=foot + Vector((0.3, side * 0.37, z)))
            assign(svent, m['black'])
            mast.append(svent)
            sslot = box('Mast.SideVentGlow', (0.2, 0.05, 0.05), loc=foot + Vector((0.3, side * 0.38, z - 0.06)))
            array(sslot, 2, (0, 0, 0.12))
            assign(sslot, m['glow_lava'])
            mast.append(sslot)
    rail = box('Mast.Rail', (0.12, 0.5, h - 0.5), loc=foot + Vector((0.58, 0, h / 2 - 0.1)))
    bevel(rail, 0.02, 2)
    assign(rail, m['black'])
    mast.append(rail)
    crown = box('Mast.Crown', (0.75, 1.0, 0.3), loc=foot + Vector((0.3, 0, h + 0.15)))
    bevel(crown, 0.06, 3)
    assign(crown, m['body'])
    mast.append(crown)
    mast.append(_gold_line('Mast.CrownTrim', (0.8, 1.04, 0.06), foot + Vector((0.3, 0, h + 0.05)), m))
    for side in (-1, 1):
        mast.append(_horn('Mast.Horn', foot + Vector((0.3, side * 0.35, h + 0.3)), 0.6, 0.09, m, tilt_x=-side * 30))
    eye = box('Mast.CrownEye', (0.08, 0.5, 0.14), loc=foot + Vector((0.68, 0, h + 0.15)))
    assign(eye, m['glow_lava'])
    mast.append(eye)
    # Rotary head riding the rail, the rod and the glowing screw bit below it.
    head = box('Mast.RotaryHead', (0.55, 0.7, 0.55), loc=foot + Vector((0.72, 0, 3.4)))
    bevel(head, 0.06, 3)
    assign(head, m['dark'])
    mast.append(head)
    motor = cylinder('Mast.Motor', 0.2, 0.5, loc=foot + Vector((0.72, 0, 3.9)), segments=16)
    assign(motor, m['chrome'])
    mast.append(motor)
    rod = cylinder('Mast.Rod', 0.08, 1.9, loc=foot + Vector((0.75, 0, 2.15)), segments=12)
    assign(rod, m['chrome'])
    mast.append(rod)
    core = cylinder('Mast.BitCore', 0.11, 1.3, loc=foot + Vector((0.75, 0, 0.55)), segments=12)
    assign(core, m['glow_lava'])
    mast.append(core)
    thread = torus('Mast.BitThread', 0.16, 0.05, loc=foot + Vector((0.75, 0, 0.05)), major_segments=16, minor_segments=6)
    array(thread, 6, (0, 0, 0.2))
    assign(thread, m['glow_lava'])
    mast.append(thread)
    tip = cylinder('Mast.BitTip', 0.2, 0.4, loc=foot + Vector((0.75, 0, -0.65)), segments=12, radius2=0.01)
    rotate(tip, x=180)
    assign(tip, m['glow_lava'])
    mast.append(tip)
    mast += hydraulic('Mast.Stay', Vector((-0.3, -0.25, 1.45)), foot + Vector((0.05, 0, 2.3)), 0.075, m)
    pivot('Mast', foot, mast)

    for name, x in (('WheelF', 1.0), ('WheelR', -1.0)):
        for suffix, side in (('L', 1), ('R', -1)):
            loc = (x, side * 0.8, 0.71)
            node = _wheel_t3(f'{name}{suffix}', 0.55, 0.42, loc, m)
            spikes = _spikes(f'{name}{suffix}', loc, 0.55, 8, 0.16, m, axis='Y', width=0.06, phase=0.2)
            for sp in spikes:
                sp.parent = node
                sp.matrix_parent_inverse = node.matrix_basis.inverted()


def build_building_destroyer(m) -> None:
    """Obliterator Supreme: tank-tracked dozer with a gold angry-face blade, a morning-star crane, a laser turret and flags."""
    body = []
    for side in (-1, 1):
        body += track('Track', 3.0, 0.75, 0.55, (0, side * 0.78, 0.41), m, pads=16)
        skirt = box('Skirt', (2.7, 0.62, 0.3), loc=(0, side * 0.78, 0.93))
        bevel(skirt, 0.06, 3)
        assign(skirt, m['body'])
        body.append(skirt)
        body += _hazard('Skirt.Hazard', (1.36, side * 0.78, 0.93), 0.56, 0.24, m, count=3)
        body += _hazard('Skirt.HazardRear', (-1.36, side * 0.78, 0.93), 0.56, 0.24, m, count=3)
        body.append(_gold_line('Skirt.Trim', (2.72, 0.04, 0.05), (0, side * (0.78 + 0.31), 1.05), m))
    hull = box('Hull', (2.6, 1.56, 0.45), loc=(0, 0, 1.0))
    bevel(hull, 0.06, 3)
    assign(hull, m['dark'])
    body.append(hull)
    upper = box('Hull.Upper', (2.0, 1.5, 0.75), loc=(-0.15, 0, 1.6))
    bevel(upper, 0.12, 4)
    assign(upper, m['body'])
    body.append(upper)
    for side in (-1, 1):
        body.append(_gold_line('Hull.Trim', (2.02, 0.05, 0.06), (-0.15, side * 0.75, 1.93), m))
    glacis = prism('Hull.Glacis', [(0.85, 1.23), (1.3, 1.23), (1.3, 1.4), (0.85, 1.95)], 1.4, loc=(0, 0, 0), axis='Y')
    bevel(glacis, 0.04, 2)
    assign(glacis, m['body'])
    body.append(glacis)
    body += headlights('Head', 1.3, (-0.5, 0.5), 1.32, m, radius=0.1)
    grille = box('Hull.Grille', (0.05, 0.6, 0.14), loc=(1.31, 0, 1.32))
    assign(grille, m['black'])
    body.append(grille)
    # Cab, and the laser turret on its roof: chrome barrel wrapped in glowing coils.
    body += cab('Cab', (0.95, 1.05, 0.7), (-0.35, 0, 2.33), m)
    tbase = cylinder('Laser.Base', 0.28, 0.16, loc=(-0.35, 0, 2.8), segments=20)
    bevel(tbase, 0.03, 2, angle=60)
    assign(tbase, m['chrome'])
    body.append(tbase)
    tblock = box('Laser.Block', (0.36, 0.34, 0.28), loc=(-0.35, 0, 2.98))
    bevel(tblock, 0.04, 3)
    assign(tblock, m['dark'])
    body.append(tblock)
    barrel = cylinder('Laser.Barrel', 0.075, 1.1, loc=(0.2, 0, 3.02), axis='X', segments=14)
    assign(barrel, m['chrome'])
    body.append(barrel)
    coil = torus('Laser.Coil', 0.14, 0.03, loc=(-0.05, 0, 3.02), rot=(0, 90, 0), major_segments=14, minor_segments=6)
    apply_transform(coil)
    array(coil, 4, (0.17, 0, 0))
    assign(coil, m['glow_green'])
    body.append(coil)
    lens = cylinder('Laser.Lens', 0.12, 0.08, loc=(0.78, 0, 3.02), axis='X', segments=14)
    assign(lens, m['glow_green'])
    body.append(lens)
    # Chrome exhausts with black tips, twin pennants on chrome poles.
    for side in (-1, 1):
        pipe = cylinder('Exhaust.Pipe', 0.075, 0.75, loc=(-1.0, side * 0.45, 2.33), segments=12)
        assign(pipe, m['chrome'])
        tip = cylinder('Exhaust.Tip', 0.1, 0.14, loc=(-1.0, side * 0.45, 2.68), segments=12)
        assign(tip, m['black'])
        body += [pipe, tip]
        body += _pennant('Flag', (-1.1, side * 0.68, 1.95), 0.55, 1.5, m['gold'] if side > 0 else m['black'], m)
    # Crane arm rising off the rear right of the hull with the morning star on a chain.
    crane_base = Vector((-0.75, -0.4, 2.0))
    crane_tip = Vector((-1.75, -0.4, 3.2))
    cbase = box('Crane.Base', (0.45, 0.45, 0.25), loc=crane_base + Vector((0, 0, -0.05)))
    bevel(cbase, 0.04, 2)
    assign(cbase, m['dark'])
    body.append(cbase)
    body.append(_beam('Crane.Arm', crane_base, crane_tip, (0.22, 0.2), m))
    body.append(_beam('Crane.ArmTrim', crane_base + Vector((0, 0, 0.02)), crane_tip + Vector((0, 0, 0.02)), (0.24, 0.06), m, m['gold']))
    body += hydraulic('Crane.Cyl', Vector((-0.3, -0.5, 2.0)), crane_base + (crane_tip - crane_base) * 0.55, 0.06, m)
    ball_c = Vector((-1.78, -0.4, 1.55))
    chain = cylinder('Crane.Chain', 0.035, (crane_tip - ball_c).length - 0.3, loc=(crane_tip + ball_c) / 2 + Vector((0, 0, 0.1)), segments=8)
    assign(chain, m['dark'])
    body.append(chain)
    link = torus('Crane.Link', 0.07, 0.02, loc=crane_tip + Vector((0, 0, -0.25)), rot=(90, 0, 0), major_segments=10, minor_segments=6)
    apply_transform(link)
    array(link, 6, (0, 0, -0.2))
    assign(link, m['chrome'])
    body.append(link)
    body += _morning_star('Crane.Star', ball_c, 0.34, m)
    # Push arms to the blade.
    for side in (-1, 1):
        arm = box('PushArm', (1.4, 0.14, 0.16), loc=(0.9, side * 0.88, 0.72))
        bevel(arm, 0.03, 2)
        assign(arm, m['chrome'])
        body.append(arm)
    pivot('Body', (0, 0, 0), body)

    # Blade: gold-plated, flat face carrying an angry painted grin, chrome cutting edge and wings.
    blade_pivot = Vector((1.5, 0, 0.6))
    profile = [(-0.15, -0.55), (0.1, -0.55), (0.22, -0.32), (0.22, 0.62), (0.08, 0.78), (-0.15, 0.78), (-0.02, 0.62), (-0.02, -0.32)]
    blade = prism('Blade.Shell', profile, 2.1, loc=blade_pivot, axis='Y')
    bevel(blade, 0.03, 2)
    assign(blade, m['gold'])
    edge = box('Blade.Edge', (0.08, 2.14, 0.12), loc=blade_pivot + Vector((0.06, 0, -0.52)))
    assign(edge, m['chrome'])
    rail = box('Blade.Rail', (0.3, 2.14, 0.08), loc=blade_pivot + Vector((-0.02, 0, 0.8)))
    bevel(rail, 0.02, 2)
    assign(rail, m['black'])
    blade_parts = [blade, edge, rail]
    for side in (-1, 1):
        wing = box('Blade.Wing', (0.22, 0.08, 1.3), loc=blade_pivot + Vector((0.04, side * 1.07, 0.12)))
        bevel(wing, 0.02, 2)
        assign(wing, m['chrome'])
        blade_parts.append(wing)
        # Eyes: white disc, inward-looking pupil, angry brow.
        eye = cylinder('Blade.Eye', 0.2, 0.03, loc=blade_pivot + Vector((0.245, side * 0.5, 0.3)), axis='X', segments=16)
        assign(eye, m['white'])
        pupil = cylinder('Blade.Pupil', 0.09, 0.03, loc=blade_pivot + Vector((0.265, side * 0.43, 0.27)), axis='X', segments=12)
        assign(pupil, m['black'])
        brow = box('Blade.Brow', (0.03, 0.55, 0.13), loc=blade_pivot + Vector((0.245, side * 0.52, 0.58)))
        rotate(brow, x=side * 28)
        assign(brow, m['black'])
        blade_parts += [eye, pupil, brow]
        blade_parts += hydraulic('Blade.Lift', Vector((0.7, side * 0.55, 1.75)), blade_pivot + Vector((-0.05, side * 0.6, 0.55)), 0.065, m)
    mouth = box('Blade.Mouth', (0.03, 1.75, 0.3), loc=blade_pivot + Vector((0.245, 0, -0.05)))
    assign(mouth, m['black'])
    blade_parts.append(mouth)
    for i in range(7):
        yc = -0.72 + i * 0.24
        tooth = prism('Blade.Tooth', [(yc - 0.1, 0.1), (yc + 0.1, 0.1), (yc, -0.17)], 0.03, loc=blade_pivot + Vector((0.265, 0, 0)), axis='X')
        assign(tooth, m['white'])
        blade_parts.append(tooth)
    pivot('Blade', blade_pivot, blade_parts)

    # Ripper: three chrome-tipped claws on a beam behind the hull.
    ripper_pivot = Vector((-1.55, 0, 0.8))
    beam = box('Ripper.Beam', (0.5, 1.5, 0.22), loc=ripper_pivot + Vector((0.05, 0, 0.1)))
    bevel(beam, 0.03, 2)
    assign(beam, m['body'])
    ripper_parts = [beam]
    for y in (-0.45, 0.0, 0.45):
        shank = box('Ripper.Shank', (0.18, 0.16, 1.0), loc=ripper_pivot + Vector((-0.25, y, -0.2)))
        bevel(shank, 0.03, 2)
        rotate(shank, y=22)
        assign(shank, m['dark'])
        tip = cylinder('Ripper.Claw', 0.09, 0.42, loc=ripper_pivot + Vector((-0.3, y, -0.55)), segments=10, radius2=0.01)
        rotate(tip, y=200)
        assign(tip, m['chrome'])
        ripper_parts += [shank, tip]
    pivot('Ripper', ripper_pivot, ripper_parts)


def _atom_logo(name: str, loc, m, radius: float = 0.3, axis: str = 'Y') -> list[bpy.types.Object]:
    """Atom emblem: a nucleus disc with three elliptical orbits, lying flat against a face perpendicular to `axis`."""
    x, y, z = loc
    nucleus = cylinder(f'{name}.Nucleus', radius * 0.22, 0.03, loc=loc, axis=axis, segments=12)
    assign(nucleus, m['blue'])
    parts = [nucleus]
    for k in range(3):
        orbit = torus(f'{name}.Orbit', radius, 0.02, loc=loc, major_segments=24, minor_segments=6)
        orbit.scale = (1.0, 0.38, 1.0)
        if axis == 'Y':
            orbit.rotation_euler = (math.radians(90), math.radians(60 * k), 0)
        else:
            orbit.rotation_euler = (0, math.radians(90), math.radians(60 * k))
        assign(orbit, m['blue'])
        parts.append(orbit)
    return parts


def _conveyor(name: str, start: Vector, length: float, rise: float, width: float, m, yaw: float = 0.0,
              rollers: int = 5) -> list[bpy.types.Object]:
    """A belt conveyor rising from `start` by `rise` over `length`, turned `yaw` degrees from +X."""
    ang = math.degrees(math.atan2(rise, length))
    run = math.hypot(length, rise)
    parts = []
    belt = box(f'{name}.Belt', (run, width, 0.08), loc=(length / 2, 0, rise / 2))
    rotate(belt, y=-ang)
    apply_transform(belt)
    assign(belt, m['rubber'])
    parts.append(belt)
    for side in (-1, 1):
        rail = box(f'{name}.Rail', (run, 0.06, 0.16), loc=(length / 2, side * (width / 2 + 0.03), rise / 2 + 0.06))
        rotate(rail, y=-ang)
        apply_transform(rail)
        bevel(rail, 0.015, 2)
        assign(rail, m['blue'])
        parts.append(rail)
    roller = cylinder(f'{name}.Roller', 0.05, width - 0.06, loc=(0.15, 0, -0.07), axis='Y', segments=10)
    array(roller, rollers, ((length - 0.3) / (rollers - 1), 0, (length - 0.3) / (rollers - 1) * rise / length))
    assign(roller, m['chrome'])
    parts.append(roller)
    pulley = cylinder(f'{name}.Pulley', 0.12, width + 0.08, loc=(length, 0, rise), axis='Y', segments=16)
    assign(pulley, m['dark'])
    parts.append(pulley)
    leg = box(f'{name}.Leg', (0.06, 0.06, rise * 0.75 + 0.1), loc=(length * 0.72, width / 2 - 0.05, rise * 0.72 - rise * 0.375 - 0.1))
    array(leg, 2, (0, -(width - 0.1), 0))
    assign(leg, m['chrome'])
    parts.append(leg)
    for ob in parts:
        ob.location = Vector(start) + Vector((ob.location.x * math.cos(math.radians(yaw)), ob.location.x * math.sin(math.radians(yaw)), ob.location.z)) \
            + Vector((-ob.location.y * math.sin(math.radians(yaw)), ob.location.y * math.cos(math.radians(yaw)), 0))
        ob.rotation_euler.z = math.radians(yaw)
    return parts


def build_rock_fragmenter(m) -> None:
    """The Atomizer: sci-fi crusher with a glowing reactor dome, a funnel hopper, an accelerator-ring flywheel and twin conveyors."""
    body = []
    for side in (-1, 1):
        body += track('Track', 3.1, 0.7, 0.5, (0, side * 0.8, 0.385), m, pads=16)
    frame = box('Frame', (2.9, 1.5, 0.4), loc=(-0.2, 0, 0.9))
    bevel(frame, 0.05, 3)
    assign(frame, m['dark'])
    body.append(frame)
    for x in (-1.5, 1.1):
        for side in (-1, 1):
            beacon = cylinder('Frame.Beacon', 0.07, 0.12, loc=(x, side * 0.68, 1.15), segments=10)
            assign(beacon, m['glow_warn'])
            body.append(beacon)
    # Main crusher block with blue trim, atom emblems and a control panel.
    block = box('Crusher', (1.6, 1.5, 0.9), loc=(0.3, 0, 1.4))
    bevel(block, 0.1, 4)
    assign(block, m['body'])
    body.append(block)
    for side in (-1, 1):
        trim = box('Crusher.Trim', (1.62, 0.05, 0.06), loc=(0.3, side * 0.75, 1.82))
        bevel(trim, 0.015, 2)
        assign(trim, m['blue'])
        body.append(trim)
    body += _atom_logo('Logo', (0.3, 0.765, 1.42), m, radius=0.32)
    body += _atom_logo('Logo.Front', (1.115, 0.0, 1.4), m, radius=0.28, axis='X')
    panel = box('Panel', (0.3, 0.45, 0.5), loc=(1.05, -0.55, 1.15))
    bevel(panel, 0.03, 2)
    assign(panel, m['steel'])
    body.append(panel)
    screen = box('Panel.Screen', (0.03, 0.34, 0.24), loc=(1.21, -0.55, 1.22))
    assign(screen, m['glow_cyan'])
    body.append(screen)
    # Reactor dome with glowing rings, chrome collar and a spire.
    collar = cylinder('Reactor.Collar', 0.8, 0.25, loc=(0.1, 0, 1.97), segments=28)
    bevel(collar, 0.04, 2, angle=60)
    assign(collar, m['chrome'])
    body.append(collar)
    dome = sphere('Reactor.Dome', 0.72, loc=(0.1, 0, 2.1), segments=28, rings=14)
    assign(dome, m['body'])
    body.append(dome)
    for dz in (0.15, 0.38, 0.58):
        r = math.sqrt(0.72 ** 2 - dz ** 2)
        ring = torus('Reactor.Ring', r, 0.045, loc=(0.1, 0, 2.1 + dz), major_segments=28, minor_segments=8)
        assign(ring, m['glow_blue'])
        body.append(ring)
    spire = cylinder('Reactor.Spire', 0.03, 0.5, loc=(0.1, 0, 3.05), segments=8)
    assign(spire, m['chrome'])
    body.append(spire)
    orb = sphere('Reactor.Orb', 0.1, loc=(0.1, 0, 3.32), segments=12, rings=8)
    assign(orb, m['glow_blue'])
    body.append(orb)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        lamp = cylinder('Reactor.Lamp', 0.06, 0.1, loc=(0.1 + math.cos(a) * 0.72, math.sin(a) * 0.72, 2.12), segments=8)
        assign(lamp, m['glow_warn'])
        body.append(lamp)
    # Giant funnel hopper behind the reactor.
    funnel = cylinder('Hopper.Funnel', 0.32, 1.0, loc=(-1.35, 0, 1.95), segments=28, radius2=0.8)
    assign(funnel, m['body'])
    body.append(funnel)
    rim = torus('Hopper.Rim', 0.8, 0.05, loc=(-1.35, 0, 2.45), major_segments=28, minor_segments=8)
    assign(rim, m['blue'])
    body.append(rim)
    opening = cylinder('Hopper.Opening', 0.74, 0.03, loc=(-1.35, 0, 2.44), segments=28)
    assign(opening, m['black'])
    body.append(opening)
    throat = cylinder('Hopper.Throat', 0.34, 0.6, loc=(-1.35, 0, 1.2), segments=16)
    assign(throat, m['dark'])
    body.append(throat)
    band = box('Hopper.Band', (0.05, 0.3, 0.7), loc=(-1.35 - 0.58, 0, 1.95))
    rotate(band, y=-28)
    assign(band, m['blue'])
    body.append(band)
    for k in range(3):
        a = math.radians(90 + k * 120)
        lamp = sphere('Hopper.Lamp', 0.07, loc=(-1.35 + math.cos(a) * 0.81, math.sin(a) * 0.81, 2.5), segments=8, rings=6)
        assign(lamp, m['glow_warn'])
        body.append(lamp)
    body += rock_pile('Hopper.Load', (-1.35, 0, 2.38), (0.28, 0.28), m, count=5, seed=9)
    pipe = cylinder('Reactor.Pipe', 0.07, 1.0, loc=(-0.65, 0.45, 2.35), axis='X', segments=10)
    rotate(pipe, y=15)
    assign(pipe, m['chrome'])
    body.append(pipe)
    # Flywheel axle stub, then the side discharge conveyor on the left front.
    axle = cylinder('Flywheel.Axle', 0.08, 0.3, loc=(0.3, -0.85, 1.55), axis='Y', segments=10)
    assign(axle, m['chrome'])
    body.append(axle)
    body += _conveyor('SideConveyor', Vector((0.8, 0.5, 0.95)), 1.2, 0.35, 0.42, m, yaw=12, rollers=3)
    pivot('Body', (0, 0, 0), body)

    # Flywheel: the particle-accelerator ring, spun on Y.
    fw_loc = Vector((0.3, -0.95, 1.55))
    ring = torus('Flywheel.Ring', 0.62, 0.1, loc=fw_loc, rot=(90, 0, 0), major_segments=32, minor_segments=10)
    assign(ring, m['chrome'])
    hub = cylinder('Flywheel.Hub', 0.16, 0.2, loc=fw_loc, axis='Y', segments=16)
    assign(hub, m['dark'])
    core = cylinder('Flywheel.Core', 0.09, 0.24, loc=fw_loc, axis='Y', segments=12)
    assign(core, m['glow_cyan'])
    fw_parts = [ring, hub, core]
    for i in range(8):
        a = i * math.pi / 4
        mag = box('Flywheel.Magnet', (0.18, 0.26, 0.14), loc=fw_loc + Vector((math.cos(a) * 0.62, 0, math.sin(a) * 0.62)))
        rotate(mag, y=-math.degrees(a))
        bevel(mag, 0.02, 2)
        assign(mag, m['glow_cyan'] if i % 2 else m['blue'])
        fw_parts.append(mag)
    for i in range(3):
        a = i * 2 * math.pi / 3
        spoke = box('Flywheel.Spoke', (0.07, 0.06, 0.56), loc=fw_loc + Vector((math.cos(a) * 0.3, 0, math.sin(a) * 0.3)))
        rotate(spoke, y=-math.degrees(a) + 90)
        assign(spoke, m['chrome'])
        fw_parts.append(spoke)
    pivot('Flywheel', fw_loc, fw_parts)

    # Main discharge conveyor rising forward.
    cp = Vector((0.75, 0, 1.05))
    parts = _conveyor('Conveyor', cp, 1.45, 0.7, 0.8, m, rollers=5)
    scanner = box('Conveyor.Scanner', (0.06, 0.9, 0.12), loc=cp + Vector((0.7, 0, 0.6)))
    assign(scanner, m['glow_cyan'])
    arch = box('Conveyor.Arch', (0.1, 1.0, 0.06), loc=cp + Vector((0.7, 0, 0.68)))
    assign(arch, m['chrome'])
    parts += [scanner, arch]
    pivot('Conveyor', cp, parts)


BODY_COLORS = {
    'debris_hauler': 0x1E1E24,
    'rock_digger': 0x141416,
    'drill_rig': 0xB01818,
    'building_destroyer': 0x2A2A30,
    'rock_fragmenter': 0xEEF0F4,
}

BUILDERS = {
    'debris_hauler': build_debris_hauler,
    'rock_digger': build_rock_digger,
    'drill_rig': build_drill_rig,
    'building_destroyer': build_building_destroyer,
    'rock_fragmenter': build_rock_fragmenter,
}


def build_vehicle(role: str) -> None:
    BUILDERS[role](_materials_t3(BODY_COLORS[role]))
