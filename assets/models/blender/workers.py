"""Worker minions — one model per EmployeeRole.

Shape language: a big round head on a small egg body, stubby capsule limbs,
oversized boots and hands, hard hat in the role colour. Cute but working —
every role carries the tool of its trade. Nodes the runtime animates:
Head, Torso, ArmL, ArmR, LegL, LegR (pivots at neck, hips, shoulders, hips).
"""
from __future__ import annotations

import math

import bpy
from mathutils import Vector

from common import (
    assign, bevel, box, capsule, cylinder, empty, material, parent, pivot, rotate, sphere, subsurf, torus,
    mark_sharp,
)

ROLES = ['driller', 'blaster', 'driver', 'surveyor', 'manager']

# Placeholder tint; the game recolours `TintRole` per role / injury.
ROLE_COLORS = {
    'driller': 0x2266FF,
    'blaster': 0xFF4422,
    'driver': 0xFFCC00,
    'surveyor': 0x22CC88,
    'manager': 0xAA55DD,
}

# ---------------------------------------------------------------- scale ---
HEAD_R = 0.27
HEAD_Z = 0.96
TORSO_Z = 0.46
SHOULDER_Z = 0.58
HIP_Z = 0.27


def _materials(role: str) -> dict[str, bpy.types.Material]:
    return {
        'tint': material('TintRole', ROLE_COLORS[role], roughness=0.8),
        'skin': material('Skin', 0xFFD9A8, roughness=0.85),
        'skin_dark': material('SkinShade', 0xE8B98A, roughness=0.85),
        'white': material('EyeWhite', 0xFFFFFF, roughness=0.4),
        'pupil': material('Pupil', 0x1B1B24, roughness=0.3),
        'dark': material('Dark', 0x2A2A33, roughness=0.8),
        'boot': material('Boot', 0x4A3B2E, roughness=0.9),
        'glove': material('Glove', 0x3A3A44, roughness=0.9),
        'belt': material('Belt', 0x5A3D22, roughness=0.9),
        'metal': material('Metal', 0xB9BEC8, roughness=0.5, metallic=0.2),
        'steel': material('Steel', 0x6E7480, roughness=0.5, metallic=0.3),
        'lens': material('Lens', 0x9FD8FF, roughness=0.2),
        'lamp': material('Lamp', 0xFFF2A8, roughness=0.3, emission=0xFFE080, emission_strength=0.6),
        'paper': material('Paper', 0xF7F3E6, roughness=0.9),
        'red': material('Red', 0xD8322B, roughness=0.7),
        'pink': material('Cheek', 0xFFA394, roughness=0.9),
        'brow': material('Brow', 0x4A2E1E, roughness=0.9),
        'blue_dark': material('NavyBlue', 0x1F3A6E, roughness=0.8),
        'tie': material('Tie', 0xC0203A, roughness=0.8),
        'hat_white': material('HatWhite', 0xF4F1EA, roughness=0.6),
        'mug': material('Mug', 0xEDEDED, roughness=0.5),
        'coffee': material('Coffee', 0x3B2416, roughness=0.5),
    }


# ----------------------------------------------------------------- body ---

def _torso(m) -> list[bpy.types.Object]:
    parts = []
    body = sphere('Torso.Body', 0.215, loc=(0, 0, TORSO_Z), scale=(0.95, 1.0, 1.12), segments=28, rings=14)
    assign(body, m['tint'])
    parts.append(body)
    # Belt with a buckle
    belt = torus('Torso.Belt', 0.20, 0.028, loc=(0, 0, TORSO_Z - 0.12), major_segments=28, minor_segments=8)
    assign(belt, m['belt'])
    parts.append(belt)
    buckle = box('Torso.Buckle', (0.03, 0.07, 0.06), loc=(0.21, 0, TORSO_Z - 0.12))
    bevel(buckle, 0.008, 2)
    assign(buckle, m['metal'])
    parts.append(buckle)
    # Two overall buttons on the chest
    for y in (-0.06, 0.06):
        b = sphere('Torso.Button', 0.022, loc=(0.205, y, TORSO_Z + 0.08), segments=12, rings=6)
        assign(b, m['metal'])
        parts.append(b)
    # Tool pouch on the right hip
    pouch = box('Torso.Pouch', (0.10, 0.07, 0.10), loc=(0.08, -0.20, TORSO_Z - 0.14))
    bevel(pouch, 0.02, 3)
    assign(pouch, m['belt'])
    parts.append(pouch)
    return parts


def _head(m, role: str) -> list[bpy.types.Object]:
    parts = []
    head = sphere('Head.Skull', HEAD_R, loc=(0, 0, HEAD_Z), scale=(1.0, 1.04, 0.94), segments=36, rings=18)
    assign(head, m['skin'])
    parts.append(head)

    # Eyes: big whites sunk into the face, pupils as flat discs looking a touch
    # downward — the player's camera sits above the crew.
    for side in (-1, 1):
        ey = side * 0.105
        white = sphere('Head.Eye', 0.082, loc=(0.205, ey, HEAD_Z + 0.015), scale=(0.75, 1.0, 1.1),
                       segments=20, rings=10)
        assign(white, m['white'])
        parts.append(white)
        pupil = sphere('Head.Pupil', 0.034, loc=(0.262, ey * 0.97, HEAD_Z + 0.002), scale=(0.45, 1.0, 1.1),
                       segments=16, rings=8)
        assign(pupil, m['pupil'])
        parts.append(pupil)
        shine = sphere('Head.Shine', 0.011, loc=(0.279, ey * 0.97 + side * 0.011, HEAD_Z + 0.022),
                       segments=8, rings=5)
        assign(shine, m['white'])
        parts.append(shine)
        # Eyebrow: a short rounded bar, raised at the outer end — alert, not angry.
        brow = box('Head.Brow', (0.03, 0.08, 0.02), loc=(0.222, ey, HEAD_Z + 0.135))
        bevel(brow, 0.008, 2)
        rotate(brow, x=side * 12)
        assign(brow, m['brow'])
        parts.append(brow)
        # Rosy cheek
        cheek = sphere('Head.Cheek', 0.05, loc=(0.195, side * 0.185, HEAD_Z - 0.075), scale=(0.45, 1, 0.75),
                       segments=12, rings=6)
        assign(cheek, m['pink'])
        parts.append(cheek)

    # Small nose bump
    nose = sphere('Head.Nose', 0.032, loc=(0.27, 0, HEAD_Z - 0.03), scale=(1, 1, 0.85), segments=12, rings=6)
    assign(nose, m['skin_dark'])
    parts.append(nose)

    # Smile: a slim bent tube (torus arc), open upward.
    smile = torus('Head.Smile', 0.07, 0.015, loc=(0.255, 0, HEAD_Z - 0.085), rot=(0, 90, 0),
                  major_segments=24, minor_segments=8)
    # Keep only the lower half of the ring so it reads as a smile.
    me = smile.data
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    kill = [v for v in bm.verts if v.co.z > -0.015]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(me)
    bm.free()
    assign(smile, m['pupil'])
    parts.append(smile)

    parts += _hat(m, role)
    parts += _head_props(m, role)
    return parts


def _dome(name: str, radius: float, loc, cut_z: float, scale=(1, 1, 1), segments=32, rings=16):
    """Upper part of a sphere, cut flat below `cut_z` (relative to the sphere centre)."""
    import bmesh
    ob = sphere(name, radius, loc=loc, scale=scale, segments=segments, rings=rings)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, cut_z), plane_no=(0, 0, 1),
                                 clear_inner=True, clear_outer=False)
    cut_edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    if cut_edges:
        bmesh.ops.holes_fill(bm, edges=cut_edges, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mark_sharp(bm, 40.0)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.shade_smooth()
    return ob


def _hat(m, role: str) -> list[bpy.types.Object]:
    parts = []
    hat_mat = m['hat_white'] if role == 'manager' else m['tint']
    top_z = HEAD_Z + 0.06
    dome = _dome('Head.HatDome', 0.295, (0.01, 0, top_z), cut_z=0.05, scale=(1.0, 1.02, 0.92))
    assign(dome, hat_mat)
    parts.append(dome)
    # Ridge over the top, front to back
    ridge = box('Head.HatRidge', (0.30, 0.06, 0.04), loc=(0.01, 0, top_z + 0.27))
    bevel(ridge, 0.015, 3)
    assign(ridge, hat_mat)
    parts.append(ridge)
    # Brim: a flat ring, tilted a touch forward, with a longer visor in front.
    brim = cylinder('Head.HatBrim', 0.318, 0.036, loc=(0.02, 0, top_z + 0.05), segments=36)
    brim.scale = (1.06, 1.0, 1.0)
    rotate(brim, y=4)
    assign(brim, hat_mat)
    parts.append(brim)
    visor = box('Head.HatVisor', (0.12, 0.24, 0.03), loc=(0.34, 0, top_z + 0.035))
    bevel(visor, 0.012, 3)
    rotate(visor, y=8)
    assign(visor, hat_mat)
    parts.append(visor)
    return parts


def _head_props(m, role: str) -> list[bpy.types.Object]:
    parts = []
    top_z = HEAD_Z + 0.06
    if role == 'driller':
        # Headlamp on the hat front and ear muffs.
        lamp = cylinder('Head.Lamp', 0.05, 0.06, loc=(0.29, 0, top_z + 0.17), axis='X', segments=20)
        assign(lamp, m['steel'])
        parts.append(lamp)
        lens = cylinder('Head.LampLens', 0.038, 0.012, loc=(0.322, 0, top_z + 0.17), axis='X', segments=20)
        assign(lens, m['lamp'])
        parts.append(lens)
        for side in (-1, 1):
            muff = cylinder('Head.Muff', 0.085, 0.06, loc=(0.02, side * 0.275, HEAD_Z - 0.02), axis='Y', segments=20)
            assign(muff, m['dark'])
            parts.append(muff)
            pad = cylinder('Head.MuffPad', 0.062, 0.03, loc=(0.02, side * 0.245, HEAD_Z - 0.02), axis='Y', segments=20)
            assign(pad, m['steel'])
            parts.append(pad)
        band = torus('Head.MuffBand', 0.29, 0.014, loc=(0.02, 0, HEAD_Z - 0.02), rot=(90, 0, 90),
                     major_segments=32, minor_segments=8)
        assign(band, m['dark'])
        parts.append(band)
    elif role == 'blaster':
        # Goggles pushed up on the hat brim.
        for side in (-1, 1):
            g = cylinder('Head.Goggle', 0.055, 0.045, loc=(0.30, side * 0.10, top_z + 0.11), axis='X', segments=20)
            assign(g, m['dark'])
            parts.append(g)
            gl = cylinder('Head.GoggleLens', 0.042, 0.012, loc=(0.325, side * 0.10, top_z + 0.11), axis='X', segments=20)
            assign(gl, m['lens'])
            parts.append(gl)
        strap = torus('Head.GoggleStrap', 0.30, 0.012, loc=(0.02, 0, top_z + 0.11), rot=(0, 0, 0),
                      major_segments=32, minor_segments=8)
        strap.scale = (1.0, 1.0, 1.0)
        assign(strap, m['dark'])
        parts.append(strap)
        bridge = box('Head.GoggleBridge', (0.04, 0.10, 0.02), loc=(0.31, 0, top_z + 0.11))
        assign(bridge, m['dark'])
        parts.append(bridge)
    elif role == 'driver':
        # Aviator sunglasses resting on the nose.
        for side in (-1, 1):
            g = sphere('Head.Shade', 0.07, loc=(0.245, side * 0.105, HEAD_Z + 0.02), scale=(0.35, 1.05, 0.9),
                       segments=16, rings=8)
            assign(g, m['dark'])
            parts.append(g)
        bridge = box('Head.ShadeBridge', (0.02, 0.07, 0.014), loc=(0.262, 0, HEAD_Z + 0.04))
        assign(bridge, m['dark'])
        parts.append(bridge)
        for side in (-1, 1):
            arm = box('Head.ShadeArm', (0.24, 0.012, 0.012), loc=(0.14, side * 0.245, HEAD_Z + 0.04))
            assign(arm, m['dark'])
            parts.append(arm)
    elif role == 'surveyor':
        # Round spectacles.
        for side in (-1, 1):
            ring = torus('Head.SpecRing', 0.075, 0.012, loc=(0.262, side * 0.105, HEAD_Z + 0.02), rot=(0, 90, 0),
                         major_segments=24, minor_segments=8)
            assign(ring, m['metal'])
            parts.append(ring)
        bridge = box('Head.SpecBridge', (0.02, 0.06, 0.012), loc=(0.262, 0, HEAD_Z + 0.04))
        assign(bridge, m['metal'])
        parts.append(bridge)
        for side in (-1, 1):
            arm = box('Head.SpecArm', (0.24, 0.012, 0.012), loc=(0.14, side * 0.245, HEAD_Z + 0.04))
            assign(arm, m['metal'])
            parts.append(arm)
    elif role == 'manager':
        # Company badge on the white hat.
        badge = cylinder('Head.Badge', 0.055, 0.012, loc=(0.30, 0, top_z + 0.16), axis='X', segments=20)
        assign(badge, m['tint'])
        parts.append(badge)
    return parts


def _arm(m, role: str, side: int) -> tuple[Vector, list[bpy.types.Object]]:
    """One arm hanging from the shoulder, angled outward. Returns (pivot, parts)."""
    sy = side * 0.235
    shoulder = Vector((0.0, sy, SHOULDER_Z))
    out = math.radians(18)
    length = 0.20
    mid = shoulder + Vector((0, side * math.sin(out) * length / 2, -math.cos(out) * length / 2))
    fwd = math.radians(14)
    mid = mid + Vector((math.sin(fwd) * length / 2, 0, 0))
    arm = capsule('Arm.Upper', 0.062, length - 0.05, loc=mid, rot=(-side * 18, fwd_deg := 14, 0), segments=18, rings=8)
    assign(arm, m['tint'])
    hand_pos = shoulder + Vector((math.sin(fwd) * length, side * math.sin(out) * length, -math.cos(out) * length))
    hand = sphere('Arm.Hand', 0.08, loc=hand_pos, scale=(1, 1, 0.9), segments=18, rings=9)
    glove = m['glove'] if role in ('driller', 'blaster', 'driver') else m['skin']
    if role == 'driver':
        glove = material('DriverGlove', 0xF2C230, roughness=0.9)
    assign(hand, glove)
    parts = [arm, hand]
    # Rolled sleeve cuff
    cuff = torus('Arm.Cuff', 0.062, 0.016,
                 loc=shoulder + Vector((math.sin(fwd) * (length - 0.06), side * math.sin(out) * (length - 0.06), -math.cos(out) * (length - 0.06))),
                 rot=(-side * 18, fwd_deg, 0), major_segments=20, minor_segments=8)
    assign(cuff, m['skin'])
    parts.append(cuff)
    parts += _hand_props(m, role, side, hand_pos)
    return shoulder, parts


def _hand_props(m, role: str, side: int, hand: Vector) -> list[bpy.types.Object]:
    parts = []
    # Props hang from the right hand (side = -1 is the model's right when facing +X? Blender +Y is left).
    if role == 'driller' and side == -1:
        # A chunky hand drill pointing forward.
        body = box('Prop.DrillBody', (0.20, 0.09, 0.11), loc=hand + Vector((0.12, 0, 0.0)))
        bevel(body, 0.02, 3)
        assign(body, m['steel'])
        parts.append(body)
        bit = cylinder('Prop.DrillBit', 0.02, 0.18, loc=hand + Vector((0.30, 0, 0.0)), axis='X', segments=12)
        assign(bit, m['metal'])
        parts.append(bit)
        grip = box('Prop.DrillGrip', (0.05, 0.05, 0.10), loc=hand + Vector((0.06, 0, -0.09)))
        bevel(grip, 0.012, 2)
        assign(grip, m['tint'])
        parts.append(grip)
    elif role == 'blaster' and side == -1:
        # Detonator box with a plunger.
        bx = box('Prop.DetBox', (0.13, 0.11, 0.12), loc=hand + Vector((0.08, 0, -0.02)))
        bevel(bx, 0.015, 3)
        assign(bx, m['red'])
        parts.append(bx)
        rod = cylinder('Prop.Plunger', 0.014, 0.12, loc=hand + Vector((0.08, 0, 0.10)), segments=12)
        assign(rod, m['metal'])
        parts.append(rod)
        knob = cylinder('Prop.PlungerKnob', 0.04, 0.025, loc=hand + Vector((0.08, 0, 0.165)), segments=16)
        assign(knob, m['dark'])
        parts.append(knob)
    elif role == 'surveyor' and side == 1:
        # Clipboard held against the hip.
        board = box('Prop.Clipboard', (0.02, 0.15, 0.20), loc=hand + Vector((0.05, 0.03, 0.02)))
        bevel(board, 0.006, 2)
        assign(board, m['belt'])
        parts.append(board)
        paper = box('Prop.Paper', (0.006, 0.13, 0.17), loc=hand + Vector((0.063, 0.03, 0.01)))
        assign(paper, m['paper'])
        parts.append(paper)
        clip = box('Prop.Clip', (0.03, 0.06, 0.03), loc=hand + Vector((0.055, 0.03, 0.11)))
        bevel(clip, 0.006, 2)
        assign(clip, m['metal'])
        parts.append(clip)
    elif role == 'manager' and side == -1:
        mug = cylinder('Prop.Mug', 0.045, 0.08, loc=hand + Vector((0.06, 0, 0.03)), segments=20)
        assign(mug, m['mug'])
        parts.append(mug)
        coffee = cylinder('Prop.Coffee', 0.038, 0.01, loc=hand + Vector((0.06, 0, 0.072)), segments=20)
        assign(coffee, m['coffee'])
        parts.append(coffee)
        handle = torus('Prop.MugHandle', 0.03, 0.009, loc=hand + Vector((0.105, 0, 0.03)), rot=(90, 0, 0),
                       major_segments=16, minor_segments=6)
        assign(handle, m['mug'])
        parts.append(handle)
    elif role == 'driver' and side == 1:
        # A big wrench.
        shaft = box('Prop.Wrench', (0.03, 0.03, 0.22), loc=hand + Vector((0.02, 0.02, 0.04)))
        bevel(shaft, 0.008, 2)
        assign(shaft, m['metal'])
        parts.append(shaft)
        jaw = box('Prop.WrenchJaw', (0.03, 0.08, 0.06), loc=hand + Vector((0.02, 0.02, 0.17)))
        bevel(jaw, 0.008, 2)
        assign(jaw, m['metal'])
        parts.append(jaw)
    return parts


def _leg(m, side: int) -> tuple[Vector, list[bpy.types.Object]]:
    sy = side * 0.095
    hip = Vector((0.0, sy, HIP_Z))
    leg = capsule('Leg.Upper', 0.072, 0.09, loc=(0.0, sy, 0.17), segments=18, rings=8)
    assign(leg, m['tint'])
    boot = box('Leg.Boot', (0.19, 0.135, 0.095), loc=(0.03, sy, 0.05))
    bevel(boot, 0.03, 4)
    assign(boot, m['boot'])
    sole = box('Leg.Sole', (0.20, 0.145, 0.03), loc=(0.03, sy, 0.015))
    bevel(sole, 0.012, 3)
    assign(sole, m['dark'])
    return hip, [leg, boot, sole]


def _extras(m, role: str) -> list[bpy.types.Object]:
    parts = []
    if role == 'manager':
        tie = box('Torso.Tie', (0.02, 0.07, 0.20), loc=(0.215, 0, TORSO_Z + 0.02))
        bevel(tie, 0.008, 2)
        rotate(tie, y=-8)
        assign(tie, m['tie'])
        parts.append(tie)
        knot = box('Torso.TieKnot', (0.03, 0.07, 0.05), loc=(0.215, 0, TORSO_Z + 0.14))
        bevel(knot, 0.01, 2)
        assign(knot, m['tie'])
        parts.append(knot)
        collar = torus('Torso.Collar', 0.16, 0.02, loc=(0, 0, TORSO_Z + 0.17), major_segments=24, minor_segments=8)
        assign(collar, material('Shirt', 0xF4F1EA, roughness=0.8))
        parts.append(collar)
    if role == 'surveyor':
        # Hi-vis stripe across the chest.
        stripe = torus('Torso.HiVis', 0.215, 0.02, loc=(0, 0, TORSO_Z + 0.03), major_segments=28, minor_segments=8)
        stripe.scale = (0.95, 1.0, 0.5)
        assign(stripe, material('HiVis', 0xF6F1A0, roughness=0.8))
        parts.append(stripe)
    return parts


def build_worker(role: str) -> None:
    m = _materials(role)
    torso_parts = _torso(m) + _extras(m, role)
    pivot('Torso', (0, 0, HIP_Z), torso_parts)
    pivot('Head', (0, 0, HEAD_Z - HEAD_R + 0.02), _head(m, role))
    for side, name in ((1, 'ArmL'), (-1, 'ArmR')):
        shoulder, parts = _arm(m, role, side)
        pivot(name, shoulder, parts)
    for side, name in ((1, 'LegL'), (-1, 'LegR')):
        hip, parts = _leg(m, side)
        pivot(name, hip, parts)
