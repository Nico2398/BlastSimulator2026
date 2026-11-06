"""Worker crew — one skinned character per EmployeeRole, posed at runtime.

Each worker is one continuous body on a skeleton, not rigid parts on pivots:
a lofted torso, limbs that bend at the elbow and the knee, mitten hands,
chunky work boots, and a big expressive head under the role's hard hat
(worker_face.py), carrying the role's tool and gear (worker_props.py).
Bodies differ by role so the crew reads as people, not clones:

* driller  — the muscle. Barrel chest, Popeye forearms, square bearded jaw,
             denim overalls over a grey tee, work gloves, a headlamp on the
             standard ridged hard hat and ear defenders on arms clipped to it,
             a cartoon pneumatic jackhammer.
* blaster  — the lunatic. Wiry and stooped, narrow head, singed hair puffing
             up past the brim of a dented hat worn askew, goggles up, soot on
             his cheeks and nose, a scorched ash-khaki coverall, dynamite on a
             bandolier and on his back, a plunger detonator.
* driver   — the slab. Door-wide shoulders, no neck, an open hi-vis vest with
             reflective stripes over a tee, a bump cap with a long trucker
             peak, gold-rimmed shades low on the nose, a chinstrap of stubble,
             a smirk and a toothpick, an oversize wrench.
* surveyor — the nerd. Tall, narrow, long neck, egg head under a pith helmet,
             round glasses, buck teeth, a teal sweater vest over a white
             shirt, a pocket protector, dark field-olive trousers, survey
             staff on his back, clipboard and pencil.
* manager  — the fat cat. Short legs and a belly, jowls, a charcoal-navy suit
             with a white shirt V and lapels, red tie, one gold button
             straining over the belly and a gold watch chain, a bowler-shaped
             hard hat with a tall gold band, waxed handlebar moustache, a
             cigar, a coffee mug and a pointing finger.

Materials recoloured per instance: `TintRole` (the hat and role accents, in
the role colour), `TintGarment` (the clothes; red on injury), `TintSkin`
(every bit of skin — tones vary per employee) and `TintHair` (hair, brows,
beards, moustaches). Parts named `Face*` are drawn without the outline hull.

Skeleton (all deform bones; Blender axes, +X the character's front, +Y its left):
Hips → Spine → Chest → Neck → Head → {Hat, Mouth, Gasp, LidL, LidR, BrowL, BrowR};
Chest → ShoulderL/R → UpperArmL/R → ForearmL/R → HandL/R;
Hips → ThighL/R → ShinL/R → FootL/R → ToeL/R; `Tool` under the tool hand, and
the manager's `Finger` under his free hand. No clips are exported: the bind
pose is a relaxed A-pose with knees and elbows slightly bent, the tool in the
fist, and src/renderer/character/ poses every bone each frame.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, replace

import bpy
from mathutils import Matrix, Vector

from character import (
    BoneSpec, Section, Skeleton, assign_faces, bind_by, bind_chain, bind_rigid, ellipsoid, lathe, loft, smoothstep,
)
from common import assign, material

ROLES = ['driller', 'blaster', 'driver', 'surveyor', 'manager']

# Placeholder tints; the game recolours `TintRole` per role / injury, `TintSkin` and `TintHair` per employee.
ROLE_COLORS = {
    'driller': 0x2266FF,
    'blaster': 0xFF4422,
    'driver': 0xFFCC00,
    'surveyor': 0x22CC88,
    'manager': 0xAA55DD,
}
# The garment's own designed colour (`TintGarment`), kept apart in value from the role-coloured hat.
GARMENT_COLORS = {
    'driller': 0x34507E,   # denim
    'blaster': 0x9A8F80,   # scorched ash khaki
    'driver': 0xFF7A1A,    # hi-vis orange
    'surveyor': 0x2FA58C,  # field teal
    'manager': 0x343A52,   # charcoal-navy suit
}
DEFAULT_SKIN = 0xE8B48A
DEFAULT_HAIR = 0x4A2F1F


# =========================================================== body types ===

@dataclass(frozen=True)
class Build:
    """Proportions of one body type. Lengths in metres; radii are half-widths."""
    leg: float = 1.0           # scales hip, knee and ankle heights
    torso: float = 1.0         # scales torso length
    hip_w: float = 0.085       # hip joint offset from the midline
    pelvis: tuple[float, float] = (0.165, 0.125)
    belly: tuple[float, float, float] = (0.175, 0.135, 0.01)   # w, d, forward offset
    chest: tuple[float, float] = (0.18, 0.13)
    shoulder_y: float = 0.175
    upper_arm: float = 0.19
    forearm: float = 0.17
    arm_r: tuple[float, float, float, float] = (0.064, 0.05, 0.057, 0.042)  # deltoid, elbow, forearm, wrist
    leg_r: tuple[float, float, float, float] = (0.078, 0.06, 0.062, 0.056)    # thigh, knee, calf, ankle
    neck: tuple[float, float] = (0.08, 0.062)   # length, radius
    head: tuple[float, float, float] = (0.195, 0.2, 0.212)  # front-back, side, up radii
    jaw: float = 1.0           # >1 widens the lower face
    chin: float = 0.0          # pushes the chin forward
    hand: float = 1.15
    boot: float = 1.0
    hunch: float = 0.0         # forward lean of the upper torso, metres at the shoulders
    jowl: float = 0.0          # a double chin hanging under the jaw, metres


BUILDS: dict[str, Build] = {
    # The muscle: barrel chest, Popeye forearms, square jaw, work gloves (not boxing gloves).
    'driller': Build(chest=(0.218, 0.152), pelvis=(0.168, 0.128), belly=(0.182, 0.142, 0.012), shoulder_y=0.2,
                     arm_r=(0.082, 0.06, 0.086, 0.054), leg_r=(0.085, 0.064, 0.068, 0.059), neck=(0.055, 0.082),
                     head=(0.198, 0.214, 0.205), jaw=1.24, chin=0.018, hand=1.2, boot=1.1),
    # The lunatic: wiry, stooped, long arms, narrow head and a pointed chin.
    'blaster': Build(leg=1.1, torso=1.06, chest=(0.15, 0.106), pelvis=(0.136, 0.106), belly=(0.141, 0.106, 0.0),
                     shoulder_y=0.155, upper_arm=0.222, forearm=0.2, arm_r=(0.05, 0.04, 0.045, 0.035),
                     leg_r=(0.062, 0.049, 0.052, 0.046), neck=(0.1, 0.05), head=(0.182, 0.172, 0.222),
                     jaw=0.8, chin=0.02, hunch=0.06, hand=1.12),
    # The slab: shoulders like a door, no neck, a wide flat head.
    'driver': Build(chest=(0.238, 0.162), pelvis=(0.19, 0.15), belly=(0.226, 0.2, 0.04), shoulder_y=0.222,
                    arm_r=(0.084, 0.064, 0.074, 0.054), leg_r=(0.09, 0.07, 0.072, 0.061), neck=(0.03, 0.098),
                    head=(0.19, 0.226, 0.19), jaw=1.12, hand=1.2, boot=1.08),
    # The nerd: tall and narrow, a long craning neck under an egg-shaped head.
    'surveyor': Build(leg=1.18, torso=1.05, chest=(0.142, 0.105), pelvis=(0.136, 0.105), belly=(0.14, 0.108, 0.0),
                      shoulder_y=0.155, upper_arm=0.215, forearm=0.195, arm_r=(0.05, 0.04, 0.044, 0.035),
                      leg_r=(0.062, 0.048, 0.052, 0.046), neck=(0.135, 0.046), head=(0.172, 0.17, 0.235),
                      jaw=0.84, chin=0.006, hunch=0.03, hand=1.06),
    # The fat cat: short legs, a belly out front, jowls, dainty feet.
    'manager': Build(leg=0.74, torso=0.98, chest=(0.2, 0.166), pelvis=(0.212, 0.172), belly=(0.27, 0.25, 0.072),
                     shoulder_y=0.186, upper_arm=0.162, forearm=0.146, arm_r=(0.066, 0.054, 0.058, 0.045),
                     leg_r=(0.088, 0.07, 0.066, 0.056), neck=(0.04, 0.075), head=(0.2, 0.212, 0.2),
                     jaw=1.2, jowl=0.024, hand=1.06, boot=0.88),
}


@dataclass(frozen=True)
class Joints:
    """Rest-pose joint positions derived from a Build (armature space)."""
    ankle_z: float
    knee_z: float
    hip_z: float
    spine_z: float
    chest_z: float
    neck_z: float
    head_z: float      # head bone base (top of the neck)
    head_c: Vector     # centre of the skull
    shoulder: Vector   # left shoulder joint
    elbow: Vector
    wrist: Vector
    hand_tip: Vector
    hand_dir: Vector


ARM_SPREAD = 24.0   # degrees the bind pose's arms hang out from the body
ARM_FORWARD = 6.0   # degrees forward
ELBOW_BEND = 14.0   # degrees the forearm bends forward at rest


def joints(b: Build) -> Joints:
    ankle = 0.095
    knee = 0.255 * b.leg
    hip = 0.43 * b.leg
    t = b.torso
    spine = hip + 0.1 * t
    chest = hip + 0.22 * t
    neck = hip + 0.38 * t
    head_base = neck + b.neck[0]
    head_c = Vector((0.012, 0.0, head_base + b.head[2] * 0.72))
    shoulder = Vector((-0.005 + b.hunch, b.shoulder_y, neck - 0.065 * t))
    spread, fwd, bend = math.radians(ARM_SPREAD), math.radians(ARM_FORWARD), math.radians(ELBOW_BEND)
    up_dir = Vector((math.sin(fwd), math.sin(spread), -math.cos(spread) * math.cos(fwd))).normalized()
    fore_dir = (Matrix.Rotation(-bend, 3, Vector((0, 1, 0))) @ up_dir).normalized()
    elbow = shoulder + up_dir * b.upper_arm
    wrist = elbow + fore_dir * b.forearm
    return Joints(ankle, knee, hip, spine, chest, neck, head_base, head_c, shoulder, elbow, wrist,
                  wrist + fore_dir * 0.08 * b.hand, fore_dir)


def _side(v: Vector, side: int) -> Vector:
    return Vector((v.x, v.y * side, v.z))


def skeleton(b: Build, role: str) -> tuple[Skeleton, Joints]:
    j = joints(b)
    tool_hand = TOOL_HAND.get(role)
    from worker_face import FACE, eye_center, eye_yaw, hat_pivot, lid_open_angle, mouth_center
    hc = j.head_c
    mouth = mouth_center(j, b)
    hat = hat_pivot(j, role)
    specs = [
        BoneSpec('Hips', (0, 0, j.hip_z), (0, 0, j.spine_z)),
        BoneSpec('Spine', (0, 0, j.spine_z), (0, 0, j.chest_z), 'Hips'),
        BoneSpec('Chest', (0, 0, j.chest_z), (b.hunch * 0.6, 0, j.neck_z), 'Spine'),
        BoneSpec('Neck', (b.hunch * 0.6, 0, j.neck_z), (hc.x * 0.5, 0, j.head_z), 'Chest'),
        BoneSpec('Head', (hc.x * 0.5, 0, j.head_z), (hc.x, 0, hc.z + b.head[2]), 'Neck'),
        BoneSpec('Hat', tuple(hat), tuple(hat + Vector((0, 0, 0.12))), 'Head'),
        BoneSpec('Mouth', tuple(mouth), tuple(mouth + Vector((0.04, 0, 0))), 'Head'),
        BoneSpec('Gasp', tuple(mouth), tuple(mouth + Vector((0.04, 0, 0))), 'Head'),
    ]
    # A lid bone points along its lid's resting front edge, yawed out with its eye: the
    # animator reads that elevation to know how far down to turn the lid to shut the eye,
    # and turns it about the side axis square to it.
    lid_dir = Vector((math.cos(lid_open_angle(role)), 0, math.sin(lid_open_angle(role))))
    for s, sfx in ((1, 'L'), (-1, 'R')):
        eye = eye_center(j, s, b.head, role)
        brow = eye + Vector((0.03, 0, FACE[role].brow_h))
        edge = Matrix.Rotation(eye_yaw(b.head, s), 3, 'Z') @ lid_dir
        specs += [
            BoneSpec(f'Lid{sfx}', tuple(eye), tuple(eye + edge * 0.06), 'Head'),
            BoneSpec(f'Brow{sfx}', tuple(brow), tuple(brow + Vector((0.05, 0, 0))), 'Head'),
        ]
        sh = _side(j.shoulder, s)
        specs += [
            BoneSpec(f'Shoulder{sfx}', (b.hunch * 0.5, s * 0.04, sh.z + 0.02), tuple(sh), 'Chest'),
            BoneSpec(f'UpperArm{sfx}', tuple(sh), tuple(_side(j.elbow, s)), f'Shoulder{sfx}'),
            BoneSpec(f'Forearm{sfx}', tuple(_side(j.elbow, s)), tuple(_side(j.wrist, s)), f'UpperArm{sfx}'),
            BoneSpec(f'Hand{sfx}', tuple(_side(j.wrist, s)), tuple(_side(j.hand_tip, s)), f'Forearm{sfx}'),
        ]
        hy = s * b.hip_w
        ball_x = 0.085 * b.boot
        specs += [
            BoneSpec(f'Thigh{sfx}', (0, hy, j.hip_z), (0.012, hy, j.knee_z), 'Hips'),
            BoneSpec(f'Shin{sfx}', (0.012, hy, j.knee_z), (0, hy, j.ankle_z), f'Thigh{sfx}'),
            BoneSpec(f'Foot{sfx}', (0, hy, j.ankle_z), (ball_x, hy, 0.03), f'Shin{sfx}'),
            BoneSpec(f'Toe{sfx}', (ball_x, hy, 0.03), (ball_x + 0.07 * b.boot, hy, 0.03), f'Foot{sfx}'),
        ]
    if tool_hand:
        hand = f'Hand{tool_hand}'
        s = 1 if tool_hand == 'L' else -1
        grip = hand_frame(j, s) @ Vector(GRIP)
        specs.append(BoneSpec('Tool', tuple(grip), tuple(grip + Vector((0.08, 0, 0))), hand))
    if role == 'manager':
        # The boss's pointing finger has a bone of its own, so it curls into the fist except to point.
        k = b.hand
        frame = hand_frame(j, 1)
        base = frame @ Vector((FINGER_BASE[0] * k, FINGER_BASE[1], FINGER_BASE[2] * k))
        tip = frame @ Vector((0.026 * k, 0.012, -0.115 * k))
        specs.append(BoneSpec('Finger', tuple(base), tuple(tip), 'HandL'))
    return Skeleton('Rig', specs), j


# Grip centre inside a loose fist, in canonical right-hand space (see hand_frame).
GRIP = (0.0, 0.045, -0.052)
# Where the manager's pointing finger leaves the fist (canonical hand space, before the hand scale).
FINGER_BASE = (0.024, 0.02, -0.05)


def to_hand(ob: bpy.types.Object, frame: Matrix) -> bpy.types.Object:
    """Carry a part built in canonical hand space (its object transform included) onto a hand."""
    ob.data.transform(frame @ ob.matrix_basis)
    ob.location = (0, 0, 0)
    ob.rotation_mode = 'XYZ'
    ob.rotation_quaternion = (1, 0, 0, 0)
    ob.rotation_euler = (0, 0, 0)
    ob.scale = (1, 1, 1)
    if frame.determinant() < 0:
        ob.data.flip_normals()
    return ob


def hand_frame(j: Joints, side: int) -> Matrix:
    """Canonical hand space → armature space for the hand on `side` (+1 left, -1 right).

    Canonical space is a right hand: origin at the wrist, fingers along -Z,
    thumb along +X, palm facing +Y (toward the body). For the left hand the
    matrix includes a mirror in Y, so its determinant is negative — geometry
    taken through it needs its normals flipped.
    """
    wrist = _side(j.wrist, side)
    z = -_side(j.hand_dir, side).normalized()
    fwd = Vector((1, 0, 0))
    x = (fwd - z * fwd.dot(z)).normalized()
    y = z.cross(x).normalized()
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = wrist
    if side == 1:
        m = m @ Matrix.Scale(-1, 4, Vector((0, 1, 0)))
    return m


# ============================================================ materials ===

def materials(role: str) -> dict[str, bpy.types.Material]:
    m = {
        'tint': material('TintRole', ROLE_COLORS[role], roughness=0.8),
        'garment': material('TintGarment', GARMENT_COLORS[role], roughness=0.85),
        'skin': material('TintSkin', DEFAULT_SKIN, roughness=0.85),
        'hair': material('TintHair', DEFAULT_HAIR, roughness=0.9),
        'white': material('EyeWhite', 0xFFFFFF, roughness=0.4),
        'iris': material('Iris', 0x2B1D16, roughness=0.3),
        'mouth': material('Mouth', 0x5B1F24, roughness=0.8),
        'teeth': material('Teeth', 0xFBF7EE, roughness=0.5),
        'tongue': material('Tongue', 0xD8606A, roughness=0.8),
        'boot': material('Boot', 0x6B4A2F, roughness=0.9),
        'boot_toe': material('BootToe', 0x8A6A4A, roughness=0.8),
        'sole': material('Sole', 0x2B2422, roughness=0.9),
        'lace': material('Lace', 0xD9C9A0, roughness=0.9),
        'glove': material('Glove', 0xC9A15A, roughness=0.9),
        'dark': material('Dark', 0x2A2A33, roughness=0.8),
        'metal': material('Metal', 0xC3C8D0, roughness=0.45, metallic=0.2),
        'steel': material('Steel', 0x6E7480, roughness=0.5, metallic=0.3),
        'belt': material('Belt', 0x5A3D22, roughness=0.9),
        'stripe': material('Reflective', 0xE8EEF2, roughness=0.4),
        'soot': material('Soot', 0x26201C, roughness=0.95),
    }
    m.update(OUTFITS[role](role))
    return m


def _outfit_driller(_r):
    # Denim overalls over a heather-grey tee.
    return {'shirt': material('Shirt', 0xB9BCC2, roughness=0.9), 'legs': material('TintGarment', 0), 'cuff': material('Shirt', 0)}


def _outfit_blaster(_r):
    # Scorched ash-khaki coverall, the role colour on the rolled cuffs.
    return {'shirt': material('TintGarment', 0), 'legs': material('TintGarment', 0), 'cuff': material('TintRole', 0)}


def _outfit_driver(_r):
    # An open orange hi-vis vest over a slate tee, jeans.
    return {'shirt': material('Shirt', 0x5C6B7E, roughness=0.9), 'legs': material('Jeans', 0x3A4F78, roughness=0.9),
            'cuff': material('Shirt', 0)}


def _outfit_surveyor(_r):
    # A teal sweater vest over a white collared shirt, dark field-olive trousers (khaki vanished into the sand).
    white = material('ShirtWhite', 0xF6F4EE, roughness=0.8)
    return {'shirt': material('TintGarment', 0), 'legs': material('FieldOlive', 0x5A5638, roughness=0.9),
            'sleeve': white, 'cuff': white, 'collar': white}


def _outfit_manager(_r):
    # A charcoal-navy suit; the role colour is his hard hat (gold-banded) and pocket square.
    return {'shirt': material('TintGarment', 0), 'legs': material('TintGarment', 0), 'cuff': material('TintGarment', 0),
            'collar': material('ShirtWhite', 0xF6F4EE, roughness=0.8), 'tie': material('Tie', 0xC0203A, roughness=0.7)}


OUTFITS = {
    'driller': _outfit_driller, 'blaster': _outfit_blaster, 'driver': _outfit_driver,
    'surveyor': _outfit_surveyor, 'manager': _outfit_manager,
}

# Where the sleeve ends, as a fraction of the arm loft (0 shoulder .. 1 wrist).
SLEEVE_END = {'driller': 0.32, 'blaster': 0.62, 'driver': 0.36, 'surveyor': 0.93, 'manager': 0.93}
GLOVED = {'driller': True, 'blaster': False, 'driver': True, 'surveyor': False, 'manager': False}
# A work glove's gauntlet reaches this far up the forearm from the wrist, metres.
GLOVE_UP = 0.045


# ================================================================= body ===

def torso(skel: Skeleton, b: Build, j: Joints, m, role: str) -> None:
    t = b.torso
    hz = j.hip_z
    pw, pd = b.pelvis
    bw, bd, bf = b.belly
    cw, cd = b.chest
    h = b.hunch
    secs = [
        Section((0.0, 0, hz - 0.07), pw * 0.55, pd * 0.6),
        Section((0.0, 0, hz - 0.02), pw * 0.95, pd * 0.95),
        Section((0.005, 0, hz + 0.05 * t), pw, pd),
        Section((0.01 + bf * 0.8, 0, hz + 0.12 * t), bw, bd),
        Section((0.008 + bf * 0.5 + h * 0.4, 0, hz + 0.2 * t), (bw + cw) / 2, (bd + cd) / 2),
        Section((0.0 + h * 0.7, 0, hz + 0.28 * t), cw, cd, 2.2),
        Section((-0.005 + h, 0, hz + 0.34 * t), cw * 0.86, cd * 0.85, 2.2),
        Section((-0.01 + h, 0, j.neck_z + 0.01), b.neck[1] * 1.25, b.neck[1] * 1.15),
    ]
    tor = loft('Torso', secs, segments=22, rings=16, cap_start=0.8, cap_end=0.0)
    ob = tor.ob
    assign(ob, m['shirt'])
    rz = tor.ring_z
    bib_top = hz + 0.3 * t

    def band(height: float):
        # The one ring row nearest `height` — a stripe that runs along an edge loop.
        k = min(range(len(tor.centers)), key=lambda i: abs(tor.centers[i].z - height))
        # Two ring rows: a stripe a single row tall breaks up as the spine bends.
        return lambda i, c: tor.face_ring[i] in (k, k + 1) and 0 < tor.face_u[i] < 1
    col = tor.face_seg
    if role == 'driller':
        # Overall bib in front, waist-high at the back; the tee shows above.
        assign_faces(ob, m['garment'], lambda i, c: rz(i) < hz + 0.14 * t or
                     (c.x > 0 and rz(i) < bib_top and abs(c.y) < cw * 0.55))
    elif role == 'driver':
        # Hi-vis vest from the belt to the shoulders, hanging open down the front so a strip of
        # the tee shows; reflective stripes up the front, over the shoulders and down the back,
        # and one round the waist (not across the opening). Jeans below.
        vest = lambda i: hz + 0.04 <= rz(i) and col[i] != VEST_OPEN
        assign_faces(ob, m['garment'], lambda i, c: vest(i) and rz(i) < j.neck_z - 0.04)
        assign_faces(ob, m['legs'], lambda i, c: rz(i) < hz + 0.04)
        assign_faces(ob, m['stripe'], lambda i, c: vest(i) and col[i] in VEST_STRIPES)
        k_waist = min(range(len(tor.centers)), key=lambda i: abs(tor.centers[i].z - (hz + 0.1 * t)))
        assign_faces(ob, m['stripe'], lambda i, c: tor.face_ring[i] == k_waist and 0 < tor.face_u[i] < 1 and
                     col[i] != VEST_OPEN)
    elif role == 'surveyor':
        # A sweater vest over the shirt: its collar shows at the neck (the V is a prop).
        assign_faces(ob, m['legs'], lambda i, c: rz(i) < hz + 0.02)
        assign_faces(ob, m['collar'], lambda i, c: rz(i) > j.neck_z - 0.025)
    elif role == 'manager':
        # A white shirt collar shows above the suit.
        assign_faces(ob, m['collar'], lambda i, c: rz(i) > j.neck_z - 0.025)
    skel.attach(ob)
    bind_by(ob, lambda p: _torso_weights(p, j))


# The torso loft's columns (22 round it, column k from 360°·k/22 on, 0 at the left side, 5.5 the front):
# where the driver's vest hangs open, and where its reflective stripes run up and over the shoulders.
VEST_OPEN = 5
VEST_STRIPES = (3, 7, 14, 18)


def _torso_weights(p: Vector, j: Joints) -> dict[str, float]:
    s = smoothstep(j.spine_z - 0.05, j.spine_z + 0.05, p.z)
    c = smoothstep(j.chest_z - 0.06, j.chest_z + 0.06, p.z)
    n = smoothstep(j.neck_z - 0.025, j.neck_z + 0.02, p.z)
    w = {'Hips': 1 - s, 'Spine': s * (1 - c), 'Chest': c * (1 - n), 'Neck': n}
    # Shoulder tops follow the clavicles a little, so a shrug lifts the cloth.
    for sfx, sy in (('L', 1), ('R', -1)):
        k = smoothstep(0.06, 0.15, p.y * sy) * smoothstep(j.chest_z, j.neck_z - 0.02, p.z) * 0.6
        if k > 0:
            w = {b: v * (1 - k) for b, v in w.items()}
            w[f'Shoulder{sfx}'] = k
    return w


def legs(skel: Skeleton, b: Build, j: Joints, m, role: str) -> None:
    rt, rk, rc, ra = b.leg_r
    for s, sfx in ((1, 'L'), (-1, 'R')):
        y = s * b.hip_w
        # The leg starts well inside the pelvis, so no crease opens at the back when the hips turn.
        top = j.hip_z + 0.085
        secs = [
            Section((0.0, y * 0.55, top), rt * 0.95, rt * 0.95),
            Section((0.0, y, j.hip_z - 0.02), rt, rt * 0.95),
            Section((0.01, y, (j.hip_z + j.knee_z) / 2), rt * 0.92, rt * 0.88),
            Section((0.016, y, j.knee_z), rk, rk),
            Section((0.006, y, (j.knee_z + j.ankle_z) / 2 + 0.02), rc, rc),
            Section((0.0, y, j.ankle_z + 0.04), ra, ra),
            Section((0.0, y, j.ankle_z + 0.012), ra * 1.16, ra * 1.16),   # trouser hem flares over the boot
        ]
        lf = loft(f'Leg{sfx}', secs, segments=14, rings=13, cap_start=0.4, cap_end=0.3)
        assign(lf.ob, m['legs'])
        skel.attach(lf.ob)
        total = top - (j.ankle_z + 0.012)
        u_hip = (top - j.hip_z) / total
        u_knee = (top - j.knee_z) / total
        bind_chain(lf.ob, lf.u, [(0.0, 'Hips'), (u_hip, f'Thigh{sfx}'), (u_knee, f'Shin{sfx}')], blend=0.07)
        boot(skel, b, j, m, s, sfx)


def boot(skel: Skeleton, b: Build, j: Joints, m, s: int, sfx: str) -> None:
    k = b.boot
    y = s * b.hip_w
    # Foot: lofted heel to toe, a rounded toe cap that rises a little.
    secs = [
        Section((-0.062 * k, y, 0.058), 0.05 * k, 0.05),
        Section((-0.02 * k, y, 0.066), 0.056 * k, 0.062),
        Section((0.04 * k, y, 0.052), 0.06 * k, 0.046, 2.4),
        Section((0.1 * k, y, 0.045), 0.058 * k, 0.04, 2.4),
        Section((0.142 * k, y, 0.045), 0.05 * k, 0.036, 2.2),
    ]
    foot = loft(f'Boot{sfx}', secs, segments=14, rings=10, cap_start=0.7, cap_end=0.9, front=(0, 0, 1))
    assign(foot.ob, m['boot'])
    ball = 0.085 * k
    assign_faces(foot.ob, m['boot_toe'], lambda i, c: c.x > ball + 0.02 and c.z > 0.03)
    skel.attach(foot.ob)
    bind_by(foot.ob, lambda p: {f'Foot{sfx}': 1 - smoothstep(ball - 0.02, ball + 0.02, p.x),
                                f'Toe{sfx}': smoothstep(ball - 0.02, ball + 0.02, p.x)})
    # Shaft round the ankle, tucked under the trouser hem. It rides the shin alone, as the hem
    # does, so a rolling foot can never push the shaft out through the cloth.
    shaft = loft(f'BootShaft{sfx}', [Section((-0.012, y, 0.06), 0.047 * k, 0.051), Section((-0.005, y, 0.128), 0.047, 0.049)],
                 segments=14, rings=3, cap_start=0.0, cap_end=0.3, cap_rings=2)
    assign(shaft.ob, m['boot'])
    skel.attach(shaft.ob)
    bind_rigid(shaft.ob, f'Shin{sfx}')
    # Sole: a dark slab a touch wider than the upper, flat on the ground.
    sole = loft(f'Sole{sfx}', [Section((-0.07 * k, y, 0.014), 0.053 * k, 0.014, 3.0),
                               Section((0.0, y, 0.014), 0.06 * k, 0.014, 3.0),
                               Section((0.15 * k, y, 0.014), 0.054 * k, 0.014, 3.0)],
                segments=12, rings=6, cap_start=0.8, cap_end=0.9, cap_rings=3, front=(0, 0, 1))
    for v in sole.ob.data.vertices:
        v.co.z = max(0.0, v.co.z)
    assign(sole.ob, m['sole'])
    skel.attach(sole.ob)
    bind_by(sole.ob, lambda p: {f'Foot{sfx}': 1 - smoothstep(ball - 0.02, ball + 0.02, p.x),
                                f'Toe{sfx}': smoothstep(ball - 0.02, ball + 0.02, p.x)})


def arms(skel: Skeleton, b: Build, j: Joints, m, role: str) -> None:
    rd, re, rf, rw = b.arm_r
    sleeve_end = SLEEVE_END[role]
    for s, sfx in ((1, 'L'), (-1, 'R')):
        sh, el, wr = _side(j.shoulder, s), _side(j.elbow, s), _side(j.wrist, s)
        up = (el - sh).normalized()
        fo = (wr - el).normalized()
        # The arm starts deep inside the torso and thin, so the shoulder blends rather than pops.
        start = sh - up * 0.06 + Vector((0, -s * 0.03, 0.0))
        secs = [
            Section(tuple(start), rd * 0.75, rd * 0.75),
            Section(tuple(sh + up * 0.01), rd, rd),
            Section(tuple(sh + up * b.upper_arm * 0.5), rd * 0.9, rd * 0.92),
            Section(tuple(el), re, re),
            Section(tuple(el + fo * b.forearm * 0.35), rf, rf * 0.92),
            Section(tuple(wr - fo * 0.01), rw, rw * 0.9),
            Section(tuple(wr + fo * 0.01), rw * 0.95, rw * 0.85),
        ]
        rings = 15
        lf = loft(f'Arm{sfx}', secs, segments=12, rings=rings, cap_start=0.8, cap_end=0.5)
        ob = lf.ob
        assign(ob, m['skin'])
        sleeve = m.get('sleeve', m['shirt'])
        total = b.upper_arm + b.forearm + 0.055
        # Sleeve and glove edges sit on rings, so each boundary is a clean loop.
        k_sleeve = max(1, round(sleeve_end * (rings - 1)))
        assign_faces(ob, sleeve, lambda i, c, fr=lf.face_ring, fu=lf.face_u: fr[i] < k_sleeve and fu[i] < 1)
        k_glove = round((0.045 + b.upper_arm + b.forearm - GLOVE_UP) / total * (rings - 1))
        if GLOVED[role]:
            assign_faces(ob, m['glove'], lambda i, c, fr=lf.face_ring, fu=lf.face_u: fr[i] >= k_glove or fu[i] >= 1)
        skel.attach(ob)
        u_sh = 0.05 / total
        u_el = (0.045 + b.upper_arm) / total
        u_wr = (0.045 + b.upper_arm + b.forearm) / total
        bind_chain(ob, lf.u, [(0.0, f'Shoulder{sfx}'), (u_sh, f'UpperArm{sfx}'), (u_el, f'Forearm{sfx}'),
                              (u_wr + 0.02, f'Hand{sfx}')], blend=0.06)
        # A rolled cuff closes the sleeve on the very ring its edge runs along.
        c = lf.centers[k_sleeve]
        on_upper = (c - sh).dot(up) < b.upper_arm
        axis = up if on_upper else fo
        r = (rd * 0.92 + (re - rd * 0.92) * min(1.0, (c - sh).dot(up) / b.upper_arm)) if on_upper else rf
        bone_w = {f'UpperArm{sfx}': 1.0} if on_upper else {f'Forearm{sfx}': 1.0}
        cuff = loft(f'Cuff{sfx}', [Section(tuple(c - axis * 0.014), r * 1.13, r * 1.13),
                                   Section(tuple(c + axis * 0.014), r * 1.16, r * 1.16)],
                    segments=12, rings=2, cap_start=0.35, cap_end=0.35, cap_rings=2)
        assign(cuff.ob, m['cuff'])
        skel.attach(cuff.ob)
        bind_by(cuff.ob, lambda p, w=bone_w: w)
        if GLOVED[role]:
            gc = lf.centers[k_glove]
            gr = rw + (rf - rw) * 0.4
            glove_cuff = loft(f'GloveCuff{sfx}', [Section(tuple(gc - fo * 0.012), gr * 1.16, gr * 1.1),
                                                  Section(tuple(gc + fo * 0.012), gr * 1.2, gr * 1.12)],
                              segments=12, rings=2, cap_start=0.35, cap_end=0.35, cap_rings=2)
            assign(glove_cuff.ob, m['glove'])
            skel.attach(glove_cuff.ob)
            bind_rigid(glove_cuff.ob, f'Forearm{sfx}')
        hand(skel, b, j, m, role, s, sfx)


def hand(skel: Skeleton, b: Build, j: Joints, m, role: str, s: int, sfx: str) -> None:
    """A chunky mitten with a thumb, curled into a loose fist round the grip."""
    k = b.hand
    mat = m['glove'] if GLOVED[role] else m['skin']
    frame = hand_frame(j, s)
    palm = loft(f'Hand{sfx}', [
        Section((0, 0.0, 0.012), 0.024 * k, 0.034 * k),
        Section((0, 0.002, -0.024 * k), 0.029 * k, 0.044 * k),
        Section((0, 0.012, -0.052 * k), 0.027 * k, 0.045 * k),
        Section((0, 0.034 * k, -0.072 * k), 0.024 * k, 0.042 * k),
        Section((0, 0.058 * k, -0.068 * k), 0.021 * k, 0.039 * k),
        Section((0, 0.07 * k, -0.048 * k), 0.019 * k, 0.035 * k),
    ], segments=10, rings=10, cap_start=0.6, cap_end=1.0, cap_rings=3, front=(1, 0, 0))
    # An oversized thumb, so the fist reads as a hand gripping something.
    thumb = loft(f'Thumb{sfx}', [
        Section((0.03 * k, 0.012, -0.012 * k), 0.02 * k, 0.02 * k),
        Section((0.054 * k, 0.034 * k, -0.032 * k), 0.017 * k, 0.017 * k),
        Section((0.04 * k, 0.06 * k, -0.046 * k), 0.016 * k, 0.016 * k),
    ], segments=8, rings=5, cap_start=0.5, cap_end=1.0, cap_rings=3, front=(0, 1, 0))
    parts = [palm.ob, thumb.ob]
    if role == 'manager' and s == 1:
        # The boss's pointing finger, always out.
        finger = loft('HandFingerL', [
            Section((FINGER_BASE[0] * k, FINGER_BASE[1], FINGER_BASE[2] * k), 0.012 * k, 0.012 * k),
            Section((0.026 * k, 0.012, -0.09 * k), 0.011 * k, 0.011 * k),
            Section((0.026 * k, 0.012, -0.115 * k), 0.01 * k, 0.01 * k),
        ], segments=8, rings=5, cap_start=0.5, cap_end=1.0, cap_rings=3, front=(1, 0, 0))
        parts.append(finger.ob)
    for ob in parts:
        to_hand(ob, frame)
        assign(ob, mat)
        skel.attach(ob)
        bind_rigid(ob, 'Finger' if ob.name == 'HandFingerL' else f'Hand{sfx}')


def neck_and_head(skel: Skeleton, b: Build, j: Joints, m, role: str) -> None:
    hc = j.head_c
    # Flared into the collar below and the jaw above, so there is no crease ring at either end.
    neck = loft('Neck', [Section((0.0 + b.hunch * 0.6, 0, j.neck_z - 0.03), b.neck[1] * 1.3, b.neck[1] * 1.2),
                         Section((hc.x * 0.3, 0, (j.neck_z + j.head_z) / 2), b.neck[1], b.neck[1] * 0.95),
                         Section((hc.x * 0.5, 0, j.head_z), b.neck[1] * 0.95, b.neck[1] * 0.92),
                         Section((hc.x * 0.6, 0, j.head_z + 0.06), b.neck[1] * 1.15, b.neck[1] * 1.05)],
                segments=12, rings=6, cap_start=0.3, cap_end=0.5, cap_rings=2)
    assign(neck.ob, m['skin'])
    skel.attach(neck.ob)
    bind_by(neck.ob, lambda p: {'Chest': 1 - smoothstep(j.neck_z - 0.03, j.neck_z + 0.01, p.z),
                                'Neck': smoothstep(j.neck_z - 0.03, j.neck_z + 0.01, p.z) *
                                (1 - smoothstep(j.head_z, j.head_z + 0.05, p.z)),
                                'Head': smoothstep(j.head_z, j.head_z + 0.05, p.z)})
    import worker_face
    worker_face.build_head(skel, b, j, m, role)


# ================================================================ build ===

TOOL_HAND = {'driller': 'R', 'blaster': 'L', 'driver': 'R', 'surveyor': 'L', 'manager': 'R'}


def build_worker(role: str) -> None:
    import worker_props
    b = BUILDS[role]
    m = materials(role)
    skel, j = skeleton(b, role)
    torso(skel, b, j, m, role)
    legs(skel, b, j, m, role)
    arms(skel, b, j, m, role)
    neck_and_head(skel, b, j, m, role)
    worker_props.build_props(skel, b, j, m, role)
