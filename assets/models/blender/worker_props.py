"""Worker tools and accessories — the part of each role that does the job.

Tools are modelled in *canonical right-hand space* (see `workers.hand_frame`:
wrist at the origin, fingers along -Z, thumb along +X, palm facing +Y) around
the fist's grip, then carried onto the tool hand and bound to the `Tool`
bone, so the animator can move the tool against the hand (the blaster's detonator
box stays on the ground while the plunger goes down; a collapsing worker
drops what he holds). Everything worn is bound to the bone it rides on: hat
gear to `Hat` (built in the hat's own frame, `hat_frame`), glasses to
`Head`, the bandolier and the tie to the torso. The pieces that ride
together are merged into one object per group (`character.merge`) — a tool,
a bundle, a pair of glasses — which is the same picture for a fraction of
the file.

* driller  — a cartoon pneumatic jackhammer: a T-handle on top, the fist on
             one side of the T, a fat yellow body hanging below along the
             fingers and a chisel bit at the bottom (`JACK_*` give the
             animator its geometry). Headlamp (it glows) on the hat, red ear
             defenders on arms clipped to the hat's sides, overall straps.
* blaster  — a red plunger detonator with white warning labels, carried by
             its own T-handle (he would); goggles pushed up on the hat; a tan
             belt of dynamite across the chest and a fat bundle on his back;
             singed hair puffing up and out past the brim, the outer puff of
             each clump ash-grey.
* driver   — an oversize steel open-end wrench, most of its fat handle in an
             orange rubber grip, a ring end; teardrop aviator shades in gold
             rims, worn low so his eyes peek over them from above. Glasses
             and shades are named `Face*`, so they draw without an outline.
* surveyor — a big clipboard, paper side out, and a pencil in the other hand;
             thick round glasses over magnified eyes; the white shirt's V under
             his sweater vest, a pocket protector with two pens; a red-and-white
             survey staff slung across his back, clear of it all along.
* manager  — a coffee mug held by the handle; a cigar with a glowing tip in
             the far corner of the mouth (it rides the Mouth bone); a white
             shirt V between the lapels of his suit, the red tie in it, one
             gold button straining over the belly and a gold watch chain
             across it, a pocket square.
"""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from character import Section, Skeleton, assign_faces, bind_by, bind_rigid, ellipsoid, lathe, loft, merge, smoothstep
from common import assign, bevel, boolean, box, cylinder, material, torus
from worker_face import HAT_BRIM, HAT_DOME, HAT_PEAK, HATS, _conform, _decal_loft, eye_center, eye_radii, hat_frame

GRIP = (0.0, 0.045, -0.052)   # the fist's grip centre, canonical hand space (workers.GRIP)


# ------------------------------------------------------------ helpers ---

def _tree(name: str) -> BVHTree:
    ob = bpy.data.objects[name]
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.transform(ob.matrix_basis)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def _onto(tree: BVHTree, p: Vector, toward: Vector, lift: float) -> Vector:
    """`p` dropped onto the surface along `toward`, then lifted off it by `lift`."""
    d = toward.normalized()
    hit, n, _, _ = tree.ray_cast(p - d * 0.4, d)
    return p if hit is None else hit + n * lift


def _tool(skel: Skeleton, name: str, parts, frame: Matrix, bone: str = 'Tool') -> None:
    """Carry a tool built in canonical hand space onto the hand, as one object on `bone`."""
    from workers import to_hand
    for ob in parts:
        to_hand(ob, frame)
    ob = merge(name, parts)
    skel.attach(ob)
    bind_rigid(ob, bone)


def _worn(skel: Skeleton, name: str, parts, bone: str, frame: Matrix | None = None) -> None:
    """Gear riding one bone rigidly, as one object; `frame` carries parts built in a local frame (the hat's)."""
    for ob in parts:
        if frame is not None:
            ob.data.transform(frame @ ob.matrix_basis)
            ob.location, ob.rotation_euler, ob.scale = (0, 0, 0), (0, 0, 0), (1, 1, 1)
            ob.rotation_mode = 'XYZ'
    ob = merge(name, parts)
    skel.attach(ob)
    bind_rigid(ob, bone)


def _torso_bound(skel: Skeleton, name: str, parts, j) -> None:
    """Gear on the torso, as one object weighted like the cloth under it."""
    from workers import _torso_weights
    ob = merge(name, parts)
    skel.attach(ob)
    bind_by(ob, lambda p: _torso_weights(p, j))


def _upright(tree: BVHTree, p: Vector) -> tuple[Vector, Vector, Vector]:
    """(nearest surface point, its outward normal, world up laid flat against it) at `p`."""
    near, normal, _, _ = tree.find_nearest(p)
    normal = normal.normalized()
    return near, normal, (Vector((0, 0, 1)) - normal * normal.z).normalized()


def _on_torso(tree: BVHTree, y: float, z: float, lift: float) -> Vector:
    return _onto(tree, Vector((0.4, y, z)), Vector((-1, 0, 0)), lift)


def _temples(skel: Skeleton, b, j, role: str, mat, drop: float, front_drop: float = 0.0,
             fronts: dict[int, Vector] | None = None, ear_lift: float = 0.0, bow: float = 0.012) -> list:
    """Glasses arms from the lens edge back to the ear, hugging the side of the head.

    `fronts` (per side, +1 left) starts each arm at a given point — a frame's outer edge —
    instead of the default just outside the eye; `ear_lift` raises where it meets the ear and
    `bow` how far its middle bows out, so it clears a cheek.
    """
    hc = j.head_c
    parts = []
    for s, sfx in ((1, 'L'), (-1, 'R')):
        ec = eye_center(j, s, b.head, role)
        front = fronts[s] if fronts else Vector((ec.x + 0.012, s * (abs(ec.y) + 0.05), ec.z + 0.004 + front_drop))
        ear = Vector((hc.x + 0.012, s * (b.head[1] * 0.99 + 0.008), hc.z - 0.004 + drop + ear_lift))
        mid = (front + ear) / 2 + Vector((0, s * bow, 0))
        arm = loft(f'FaceGlassesArm{sfx}', [Section(tuple(front), 0.005, 0.004), Section(tuple(mid), 0.005, 0.004),
                                            Section(tuple(ear), 0.004, 0.004)],
                   segments=5, rings=6, cap_start=1.0, cap_end=1.0, cap_rings=1, front=(0, 0, 1))
        assign(arm.ob, mat)
        parts.append(arm.ob)
    return parts


# ------------------------------------------------------------- driller ---

JACK_REACH = 0.12   # from the grip along the thumb to the T-handle's middle, where the body hangs
JACK_BODY = 0.19    # from the grip down the fingers to the body's centre
JACK_BIT = 0.48     # from the grip down the fingers to the chisel's tip
"""The jackhammer, in canonical hand space from the fist's grip: the bit tip is at
(JACK_REACH, 0, -JACK_BIT), the body's centre at (JACK_REACH, 0, -JACK_BODY) and the T's
other handle at (2·JACK_REACH, 0, 0). As long as the bind pose allows: the arm hangs with the
grip 0.36 m up, so a longer tool would put the bit through the ground."""


def _jackhammer(m) -> list:
    """A cartoon pneumatic jackhammer: T-handle in the fist, fat body hanging below along the fingers, chisel bit."""
    gx, gy, gz = GRIP
    cx = gx + JACK_REACH
    yellow = material('DrillYellow', 0xF2B705, roughness=0.55)
    bar = cylinder('ToolBar', 0.019, 2 * JACK_REACH + 0.15, loc=(cx, gy, gz), axis='X', segments=10)
    assign(bar, m['steel'])
    grips = []
    for k, x in enumerate((gx, gx + 2 * JACK_REACH)):
        g = cylinder(f'ToolHandle{k}', 0.026, 0.12, loc=(x, gy, gz), axis='X', segments=12)
        bevel(g, 0.008, 2)
        assign(g, m['dark'])
        grips.append(g)
    stem = cylinder('ToolStem', 0.028, 0.09, loc=(cx, gy, gz - 0.035), segments=12)
    assign(stem, m['steel'])
    body = cylinder('ToolBody', 0.075, 0.23, loc=(cx, gy, gz - JACK_BODY), segments=18)
    bevel(body, 0.022, 2)
    assign(body, yellow)
    collar = cylinder('ToolCollar', 0.079, 0.03, loc=(cx, gy, gz - 0.092), segments=18)
    bevel(collar, 0.008, 2)
    assign(collar, m['dark'])
    head = cylinder('ToolHead', 0.028, 0.05, loc=(cx, gy, gz - 0.325), radius2=0.05, segments=14)   # narrowing down to the bit
    assign(head, m['steel'])
    shank = cylinder('ToolBitShaft', 0.016, 0.105, loc=(cx, gy, gz - 0.4), segments=10)
    assign(shank, m['metal'])
    chisel = cylinder('ToolChisel', 0.004, 0.03, loc=(cx, gy, gz - JACK_BIT + 0.015), radius2=0.016, segments=10)
    chisel.scale = (1.0, 0.5, 1.0)
    assign(chisel, m['metal'])
    return [bar, stem, body, collar, head, shank, chisel] + grips


def _driller_gear(skel: Skeleton, b, j, m) -> None:
    hc = j.head_c
    hat = HATS['driller']
    dome = HAT_DOME * hat.scale
    frame = hat_frame(j, 'driller')
    # The headlamp, a quarter bigger than a real one, its back sunk into the crown.
    lamp = cylinder('HatLamp', 0.0575, 0.0625, loc=(dome + 0.008, 0, 0.09), axis='X', segments=18)
    bevel(lamp, 0.0125, 2)
    assign(lamp, m['steel'])
    lens = cylinder('HatLampLens', 0.044, 0.015, loc=(dome + 0.043, 0, 0.09), axis='X', segments=18)
    assign(lens, material('Lamp', 0xFFF2A8, roughness=0.3, emission=0xFFE080, emission_strength=0.6))
    for ob in (lamp, lens):
        ob.data.transform(frame @ ob.matrix_basis)
        ob.location = (0, 0, 0)
    # Ear defenders on arms clipped into the hat's sides: they ride the Hat bone and leave with the hat.
    defender = material('EarDefender', 0xE23A2A, roughness=0.6)
    gear = [lamp, lens]
    for s, sfx in ((1, 'L'), (-1, 'R')):
        y = s * (b.head[1] + 0.034)
        cup = cylinder(f'HatMuff{sfx}', 0.058, 0.05, loc=(hc.x + 0.004, y, hc.z - 0.01), axis='Y', segments=18)
        bevel(cup, 0.015, 2)
        assign(cup, defender)
        clip = frame @ Vector((0.0, s * (dome - 0.004), 0.055 * hat.scale))
        path = [clip, Vector((hc.x, s * 0.215, hc.z + 0.16)), Vector((hc.x + 0.002, y * 0.99, hc.z + 0.1)),
                Vector((hc.x + 0.004, y, hc.z + 0.04))]
        arm = loft(f'HatMuffArm{sfx}', [Section(tuple(p), 0.007, 0.014, 3.0) for p in path], segments=8, rings=10,
                   cap_start=0.4, cap_end=0.4, cap_rings=2)
        assign(arm.ob, m['dark'])
        gear += [cup, arm.ob]
    _worn(skel, 'HatGear', gear, 'Hat')
    # Overall straps: bib corners over the shoulders to the back of the waist.
    tree = _tree('Torso')
    t = b.torso
    straps = []
    for s, sfx in ((1, 'L'), (-1, 'R')):
        ctrl = [
            (Vector((0.3, s * 0.075, j.hip_z + 0.3 * t)), Vector((-1, 0, 0))),
            (Vector((0.2, s * 0.095, j.neck_z - 0.01)), Vector((-1, 0, -0.6))),
            (Vector((0.0, s * 0.105, j.neck_z + 0.2)), Vector((0, 0, -1))),
            (Vector((-0.2, s * 0.095, j.neck_z - 0.02)), Vector((1, 0, -0.6))),
            (Vector((-0.3, s * 0.07, j.hip_z + 0.16 * t)), Vector((1, 0, 0))),
        ]
        pts = [_onto(tree, p, d, 0.009) for p, d in ctrl]
        strap = loft(f'TorsoStrap{sfx}', [Section(tuple(p), 0.024, 0.008) for p in pts], segments=6, rings=14,
                     cap_start=0.3, cap_end=0.3, front=(0, 0, 1))
        assign(strap.ob, m['garment'])
        button = cylinder(f'TorsoButton{sfx}', 0.016, 0.012, loc=tuple(pts[0] + Vector((0.006, 0, -0.012))), axis='X',
                          segments=12)
        assign(button, m['metal'])
        straps += [strap.ob, button]
    _torso_bound(skel, 'TorsoStraps', straps, j)


# ------------------------------------------------------------- blaster ---

DETONATOR_ROD = 0.24   # plunger rod length: the T-bar can travel almost all of DETONATOR_TOP into the box
DETONATOR_TOP = 0.17   # T-bar (the grip) above the box lid, plunger up
DETONATOR_BOX = 0.13   # box height: the box's floor is DETONATOR_TOP + DETONATOR_BOX below the grip


def _detonator(m) -> tuple[list, list]:
    """(parts that ride the hand, parts that ride the box). The fist holds the plunger's T-bar."""
    gx, gy, gz = GRIP
    handle = cylinder('ToolPlungerBar', 0.02, 0.17, loc=(gx, gy, gz), axis='X', segments=12)
    assign(handle, m['dark'])
    knobs = [cylinder(f'ToolPlungerKnob{k}', 0.026, 0.03, loc=(gx + dx, gy, gz), axis='X', segments=12)
             for k, dx in enumerate((-0.085, 0.085))]
    for kn in knobs:
        assign(kn, m['dark'])
    rod = cylinder('ToolPlungerRod', 0.012, DETONATOR_ROD, loc=(gx, gy, gz - DETONATOR_ROD / 2), segments=10)
    assign(rod, m['metal'])
    red = material('DetonatorRed', 0xC8352B, roughness=0.6)
    top = gz - DETONATOR_TOP
    box_ob = box('ToolBox', (0.19, 0.16, DETONATOR_BOX), loc=(gx, gy, top - DETONATOR_BOX / 2))
    bevel(box_ob, 0.018, 2)
    assign(box_ob, red)
    lid = box('ToolBoxLid', (0.2, 0.17, 0.024), loc=(gx, gy, top))
    bevel(lid, 0.008, 2)
    assign(lid, m['dark'])
    # A white warning label on each face that turns to the camera.
    label_mat = material('DetonatorLabel', 0xF4F1EA, roughness=0.7)
    labels = []
    for k, (dx, dy, sx, sy) in enumerate(((0.097, 0, 0.004, 0.1), (-0.097, 0, 0.004, 0.1), (0, 0.082, 0.12, 0.004), (0, -0.082, 0.12, 0.004))):
        lb = box(f'ToolBoxLabel{k}', (sx, sy, 0.06), loc=(gx + dx, gy + dy, top - DETONATOR_BOX / 2))
        assign(lb, label_mat)
        labels.append(lb)
    terminals = []
    for k, dy in enumerate((-0.05, 0.05)):
        t = cylinder(f'ToolBoxTerminal{k}', 0.013, 0.025, loc=(gx - 0.06, gy + dy, top + 0.02), segments=10)
        assign(t, m['metal'])
        terminals.append(t)
    # Two wires curling off the back of the box.
    wires = []
    for k, (dy, col) in enumerate(((-0.05, 0xD8322B), (0.05, 0x222228))):
        pts = [(gx - 0.06, gy + dy, top + 0.03), (gx - 0.12, gy + dy * 1.4, top + 0.02), (gx - 0.15, gy + dy * 1.8, top - 0.06),
               (gx - 0.12, gy + dy * 2.2, top - 0.14)]
        w = loft(f'ToolWire{k}', [Section(p, 0.006, 0.006) for p in pts], segments=4, rings=7, cap_start=1.0, cap_end=1.0,
                 cap_rings=1)
        assign(w.ob, material(f'Wire{k}', col, roughness=0.6))
        wires.append(w.ob)
    return [handle, rod] + knobs, [box_ob, lid] + labels + terminals + wires


def _paper_end(stick: bpy.types.Object, paper, half: float) -> None:
    """The paper-wrapped end of a dynamite stick: its top cap in paper (local Z is the stick's axis)."""
    assign_faces(stick, paper, lambda i, c: c.z > half - 1e-4)


TUFT_LEN = 0.046   # half-length of each singed tuft, along the way it sticks out (m)


def _blaster_gear(skel: Skeleton, b, j, m) -> None:
    hc = j.head_c
    dome = HAT_DOME * HATS['blaster'].scale
    goggles = []
    for s, sfx in ((1, 'L'), (-1, 'R')):
        ang = s * 0.36
        x, y = math.cos(ang) * (dome + 0.012), math.sin(ang) * (dome + 0.012)
        g = cylinder(f'HatGoggle{sfx}', 0.046, 0.04, loc=(x, y, 0.05), axis='X', segments=18)
        g.rotation_euler = (0, 0, ang)
        assign(g, m['dark'])
        lens = cylinder(f'HatGoggleLens{sfx}', 0.035, 0.01, loc=(x + math.cos(ang) * 0.022, y + math.sin(ang) * 0.022, 0.05),
                        axis='X', segments=18)
        lens.rotation_euler = (0, 0, ang)
        assign(lens, material('GoggleLens', 0x7FD3F2, roughness=0.2))
        goggles += [g, lens]
    _worn(skel, 'HatGoggles', goggles, 'Hat', hat_frame(j, 'blaster'))
    # Singed hair: frizzy clumps bursting out from under the brim at the temples, over the ears and
    # round the back. Each clump is a big puff tucked under the brim and a smaller one pointing up and
    # out past the brim's edge — what you see of it from above — its far half burnt ash-grey.
    singed = material('Singed', 0x33261F, roughness=0.95)
    ash = material('Ash', 0x8E8880, roughness=0.95)
    hat = HATS['blaster']
    frame = hat_frame(j, 'blaster')
    k = hat.scale
    puffs = []
    a, bw = b.head[0], b.head[1]
    for n, ang in enumerate((62, 105, 150, 210, 255, 298)):
        az = math.radians(ang)
        out = Vector((math.cos(az), math.sin(az), 0))
        head_r = 1 / math.sqrt((math.cos(az) / a) ** 2 + (math.sin(az) / bw) ** 2)
        # The brim's edge above this clump, and the hat's base just inside it (armature space).
        reach = HAT_DOME * k + HAT_BRIM * k + HAT_PEAK['dented'] * k * max(0.0, math.cos(az)) ** 1.5
        edge = frame @ Vector((reach * math.cos(az), reach * math.sin(az), 0.0))
        edge_r = (edge - Vector((hc.x, 0, edge.z))).length
        inner_r = 0.046
        # The big puff pushes out from under the brim to just past its edge, its top clear of the brim.
        rho = edge_r - 0.004
        under = min((frame @ Vector((r * math.cos(az), r * math.sin(az), 0.0))).z for r in (rho - inner_r, rho + inner_r))
        c_in = Vector((hc.x, 0, 0)) + out * rho + Vector((0, 0, min(hc.z + 0.05, under - inner_r * 0.9 - 0.008)))
        puff = ellipsoid(f'HeadPuff{n}_0', (inner_r * 1.1, inner_r, inner_r * 0.9), loc=tuple(c_in), segments=7, rings=5,
                         deform=lambda p, kk=n: p * (1 + 0.12 * math.sin(p.x * 140 + kk) * math.sin(p.z * 120)))
        assign(puff, singed)
        puffs.append(puff)
        # The tuft: a lumpy teardrop growing out of its own puff, up and out past the brim's edge,
        # its tip ash. Its base sits inside the puff, so the two read as one clump.
        tip = (out + Vector((0, 0, 1.2))).normalized()
        c_tuft = c_in + tip * (inner_r * 0.6 + TUFT_LEN * 0.6)
        def lumpy_teardrop(p: Vector, kk=n) -> Vector:
            lump = 1 + 0.14 * math.sin(p.x * 150 + kk) * math.cos(p.y * 130 - kk)
            return p * lump * (1 - 0.3 * max(0.0, p.x / 0.046))   # narrowing to its tip along +X
        tuft = ellipsoid(f'HeadPuff{n}_1', (TUFT_LEN, 0.027, 0.027), segments=8, rings=6, deform=lumpy_teardrop)
        assign(tuft, singed)
        assign_faces(tuft, ash, lambda i, c: c.x > 0.012)
        tuft.data.transform(Vector((1, 0, 0)).rotation_difference(tip).to_matrix().to_4x4())
        tuft.location = c_tuft
        puffs.append(tuft)
    _worn(skel, 'HeadPuffs', puffs, 'Head')
    # Dynamite on a tan leather belt, left shoulder to right hip, straight round the back.
    tree = _tree('Torso')
    t = b.torso
    ctrl = [
        (Vector((0.0, 0.1, j.neck_z + 0.2)), Vector((0, 0, -1))),
        (Vector((0.3, 0.07, j.hip_z + 0.27 * t)), Vector((-1, 0, 0))),
        (Vector((0.3, -0.02, j.hip_z + 0.18 * t)), Vector((-1, 0, 0))),
        (Vector((0.3, -0.1, j.hip_z + 0.1 * t)), Vector((-1, 0.4, 0))),
        (Vector((0.0, -0.3, j.hip_z + 0.07 * t)), Vector((0, 1, 0))),
        (Vector((-0.3, -0.06, j.hip_z + 0.16 * t)), Vector((1, 0, 0))),
        (Vector((-0.3, 0.06, j.hip_z + 0.28 * t)), Vector((1, 0, 0))),
        (Vector((0.0, 0.1, j.neck_z + 0.2)), Vector((0, 0, -1))),
    ]
    pts = [_onto(tree, p, d, 0.007) for p, d in ctrl]
    leather = material('Leather', 0xA87B4F, roughness=0.85)
    belt = loft('TorsoBandolier', [Section(tuple(p), 0.022, 0.007) for p in pts], segments=6, rings=20,
                cap_start=0.0, cap_end=0.0, front=(0, 0, 1))
    assign(belt.ob, leather)
    sticks = []
    red = material('Dynamite', 0xC81E1E, roughness=0.7)
    paper = material('DynamitePaper', 0xEDE3C8, roughness=0.9)
    fuse_mat = material('Fuse', 0xF4F0E6, roughness=0.9)
    run = pts[1:4]
    for k in range(5):
        u = (k + 0.5) / 5 * (len(run) - 1)
        i = min(int(u), len(run) - 2)
        p = run[i].lerp(run[i + 1], u - i)
        near, normal, _, _ = tree.find_nearest(p)
        normal = normal.normalized()
        # Sticks stand upright in their loops: world up, laid flat against the chest.
        up = (Vector((0, 0, 1)) - normal * normal.z).normalized()
        rot = Vector((0, 0, 1)).rotation_difference(up)
        center = near + normal * 0.04
        # 10 sides, not 8: under 40° a side stays smooth-shaded, so it costs fewer vertices, not more.
        stick = cylinder(f'TorsoDynamite{k}', 0.02, 0.09, loc=tuple(center), segments=10)
        fuse = cylinder(f'TorsoFuse{k}', 0.004, 0.03, loc=tuple(center + up * 0.06), segments=6)
        for ob, mat in ((stick, red), (fuse, fuse_mat)):
            ob.rotation_mode = 'QUATERNION'
            ob.rotation_quaternion = rot
            assign(ob, mat)
        _paper_end(stick, paper, 0.045)
        sticks += [stick, fuse]
    # And a fat bundle of it strapped on his back, fuse up: what you see of him from above.
    bundle = []
    back = _onto(tree, Vector((-0.4, 0.0, j.hip_z + 0.24 * t)), Vector((1, 0, 0)), 0.0)
    for k, (dy, dz) in enumerate(((-0.045, 0), (0.0, 0.006), (0.045, 0), (0.0, 0.045))):
        c = back + Vector((-0.045 - (0.03 if dz else 0), dy, 0.1 + dz))
        stick = cylinder(f'TorsoBundle{k}', 0.027, 0.24, loc=tuple(c), segments=10)
        assign(stick, red)
        _paper_end(stick, paper, 0.12)
        bundle.append(stick)
    tie_band = torus('TorsoBundleTie', 0.075, 0.009, loc=tuple(back + Vector((-0.06, 0, 0.1))), major_segments=16, minor_segments=4)
    tie_band.scale = (0.75, 1.15, 1.0)
    assign(tie_band, leather)
    fuse = loft('TorsoBundleFuse', [Section(tuple(back + Vector((-0.06, 0, 0.24))), 0.005, 0.005),
                                    Section(tuple(back + Vector((-0.09, 0.04, 0.32))), 0.004, 0.004),
                                    Section(tuple(back + Vector((-0.13, 0.02, 0.36))), 0.004, 0.004)],
                segments=5, rings=6, cap_start=1.0, cap_end=1.0, cap_rings=1)
    assign(fuse.ob, fuse_mat)
    _torso_bound(skel, 'TorsoDynamite', [belt.ob] + sticks + bundle + [tie_band, fuse.ob], j)


# -------------------------------------------------------------- driver ---

WRENCH_REACH = 0.37   # from the fist's grip along the thumb to the centre of the wrench's jaw
"""Canonical hand space: the jaw is at (WRENCH_REACH, 0, 0) from the grip, the ring at (-0.19, 0, 0)."""


def _wrench(m) -> list:
    """An oversize steel open-end wrench: fat handle mostly in an orange rubber grip, C-jaw out past the thumb, ring at the heel.

    Cartoon-big — a third longer and twice as fat as a real one — so it reads at game distance.
    """
    gx, gy, gz = GRIP
    steel = material('WrenchSteel', 0x8A9099, roughness=0.4, metallic=0.4)
    handle = box('ToolWrenchHandle', (0.5, 0.034, 0.054), loc=(gx + 0.09, gy, gz))
    bevel(handle, 0.012, 2)
    assign(handle, steel)
    head = cylinder('ToolWrenchHead', 0.095, 0.04, loc=(gx + WRENCH_REACH, gy, gz), axis='Y', segments=22)
    notch = box('ToolWrenchNotch', (0.13, 0.08, 0.076), loc=(gx + WRENCH_REACH + 0.046, gy, gz))
    notch.rotation_euler = (0, math.radians(15), 0)
    boolean(head, notch)
    bevel(head, 0.009, 2)
    assign(head, steel)
    ring = torus('ToolWrenchRing', 0.044, 0.019, loc=(gx - 0.19, gy, gz), rot=(90, 0, 0), major_segments=16, minor_segments=6)
    assign(ring, steel)
    # The grip is as fat as the fist's hole allows: 3 cm either side of the grip point, clear of the wrist.
    grip = box('ToolWrenchGrip', (0.27, 0.05, 0.06), loc=(gx, gy, gz))
    bevel(grip, 0.016, 3)
    assign(grip, material('Rubber', 0xE8622A, roughness=0.8))
    return [handle, head, ring, grip]


SHADES_DROP = 0.026   # the shades sit this far down his nose
SHADES_W = 0.054      # each lens's half-width, turned out SHADES_TURN degrees with the face
SHADES_TURN = 14
SHADES_H = 0.032      # and are this shallow (half-height), so the frames' top runs a centimetre under his
                      # resting lid's edge and the tops of his irises peek over them


def _driver_gear(skel: Skeleton, b, j, m) -> None:
    lens = material('ShadeLens', 0x1E2A3A, roughness=0.15)
    glint = material('ShadeGlint', 0x8FB4D8, roughness=0.2)
    frame = material('ShadeFrame', 0xD6B25A, roughness=0.4, metallic=0.4)
    parts = []
    er = eye_radii('driver')
    drop = Vector((0, 0, -SHADES_DROP))
    lenses: dict[int, Vector] = {}
    for s, sfx in ((1, 'L'), (-1, 'R')):
        ec = eye_center(j, s, b.head, 'driver')

        def teardrop(p: Vector, side=s) -> Vector:
            # Wide at the top outside corner, tapering down and in.
            if p.z < 0:
                p.y -= side * 0.3 * (-p.z / SHADES_H) * abs(p.y) * (1 if p.y * side > 0 else -1) * 0.5
                p.y *= 1 - 0.22 * (-p.z / SHADES_H)
            return p

        g = ellipsoid(f'FaceShade{sfx}', (0.011, SHADES_W, SHADES_H), segments=16, rings=10, deform=teardrop)
        g.data.transform(Matrix.Rotation(math.radians(s * SHADES_TURN), 4, 'Z'))
        g.location = ec + Vector((er[0] + 0.02, s * 0.006, -0.002)) + drop
        lenses[s] = g.location.copy()
        assign(g, lens)
        streak = ellipsoid(f'FaceShadeGlint{sfx}', (0.004, 0.028, 0.006), segments=8, rings=4)
        streak.data.transform(Matrix.Rotation(math.radians(-25 * s), 4, 'X'))
        streak.data.transform(Matrix.Rotation(math.radians(s * 14), 4, 'Z'))
        streak.location = g.location + Vector((0.01, s * 0.004, 0.01))
        assign(streak, glint)
        rim = torus(f'FaceShadeRim{sfx}', 0.05, 0.0045, loc=tuple(g.location), rot=(0, 90, s * SHADES_TURN), major_segments=20, minor_segments=4)
        rim.scale = (SHADES_H / 0.05, 1.0, 1.0)   # local X is up once turned to face front: the rim hugs the lens
        assign(rim, frame)
        parts += [g, streak, rim]
    # Two bars across the nose at the lenses' own height, each long enough to reach into both
    # rims: from the inner edge of one lens, at that height, to the other's.
    turn = math.radians(SHADES_TURN)
    centre = lenses[1]
    for k, up in enumerate((0.2, 0.5)):
        half_w = SHADES_W * math.sqrt(max(0.0, 1 - up * up))
        inner = abs(centre.y) - half_w * math.cos(turn)
        bridge = cylinder(f'FaceShadeBridge{k}', 0.0035, 2 * inner + 0.008, loc=(centre.x + half_w * math.sin(turn), 0, centre.z + up * SHADES_H),
                          axis='Y', segments=6)
        assign(bridge, frame)
        parts.append(bridge)
    # The arms leave each frame at its outer edge (where the turned lens ends) and run back
    # over the cheek, bowed clear of it, to a point above the ear.
    outer = {s: lenses[s] + Vector((-SHADES_W * math.sin(turn), s * SHADES_W * math.cos(turn), 0.004)) for s in (1, -1)}
    parts += _temples(skel, b, j, 'driver', frame, 0.0, -SHADES_DROP, fronts=outer, ear_lift=0.014, bow=0.02)
    _worn(skel, 'FaceShades', parts, 'Head')


# ------------------------------------------------------------ surveyor ---

def _clipboard(m) -> list:
    """A big clipboard, gripped at its top edge, paper facing out of the palm."""
    gx, gy, gz = GRIP
    board = box('ToolClipboard', (0.23, 0.014, 0.3), loc=(gx + 0.01, gy, gz - 0.13))
    bevel(board, 0.008, 2)
    assign(board, m['belt'])
    paper = box('ToolPaper', (0.2, 0.004, 0.25), loc=(gx + 0.01, gy - 0.009, gz - 0.14))
    assign(paper, material('Paper', 0xF7F3E6, roughness=0.9))
    lines = [box(f'ToolPaperLine{k}', (0.15, 0.002, 0.006), loc=(gx + 0.01, gy - 0.012, gz - 0.08 - k * 0.04))
             for k in range(4)]
    for ln in lines:
        assign(ln, m['dark'])
    clip = box('ToolClip', (0.09, 0.02, 0.035), loc=(gx + 0.01, gy - 0.008, gz + 0.004))
    bevel(clip, 0.006, 2)
    assign(clip, m['metal'])
    return [board, paper, clip] + lines


def _pencil(m) -> list:
    gx, gy, gz = GRIP
    body = cylinder('HandPencil', 0.009, 0.15, loc=(gx + 0.02, gy, gz), axis='X', segments=6)
    assign(body, material('PencilYellow', 0xF2C230, roughness=0.6))
    tip = cylinder('HandPencilTip', 0.009, 0.028, loc=(gx + 0.109, gy, gz), axis='X', radius2=0.001, segments=6)
    assign(tip, material('PencilWood', 0xE8C99A, roughness=0.8))
    return [body, tip]


STAFF_R = 0.026        # the survey staff: thick enough to read from the game camera
STAFF_LENGTH = 1.0
STAFF_LIFT = 0.042     # its axis off his back at the two anchors
STAFF_CLEAR = 0.006    # what the staff keeps between itself and the cloth, all along it


def _shirt_v(tree: BVHTree, name: str, top: float, bottom: float, half_w: float, mat) -> bpy.types.Object:
    """A shirt's V showing in the neck of a jacket or a vest, laid onto the torso: `half_w` wide at `top`, a point at `bottom`."""
    pts, widths = [], []
    for k in range(6):
        u = k / 5
        pts.append((0.0, top + (bottom - top) * u))
        widths.append(_v_half(half_w, u))
    ob = _decal_loft(name, pts, widths, 0.003, segments=8, rings=10).ob
    ob.data.transform(Matrix.Translation((0.0005, 0, 0)))
    _conform(ob, tree, Vector((0, 0, 0)))
    assign(ob, mat)
    return ob


def _v_half(half_w: float, u: float) -> float:
    """Half-width of a shirt V a fraction `u` of the way down it."""
    return max(0.003, half_w * (1 - u))


def _surveyor_gear(skel: Skeleton, b, j, m) -> None:
    rims = material('GlassesRim', 0x3A2A22, roughness=0.5)
    glint = material('GlassesGlint', 0xFFFFFF, roughness=0.2)
    parts = []
    er = eye_radii('surveyor')
    ring_r = er[1] + 0.008
    turn = math.radians(26)
    outer: dict[int, Vector] = {}
    for s, sfx in ((1, 'L'), (-1, 'R')):
        ec = eye_center(j, s, b.head, 'surveyor')
        at = ec + Vector((er[0] + 0.022, 0, 0.002))   # clear of the eye's yawed outer edge, and of the lid's lash as it blinks
        outer[s] = at + Vector((-ring_r * math.sin(turn), s * ring_r * math.cos(turn), 0.0))
        # Thick round rims, no glass: the big magnified eyes show straight through.
        ring = torus(f'FaceGlasses{sfx}', ring_r, 0.005, loc=tuple(at), rot=(0, 90, s * 26), major_segments=24, minor_segments=4)
        assign(ring, rims)
        shine = ellipsoid(f'FaceGlassesGlint{sfx}', (0.002, 0.016, 0.005), segments=8, rings=4)
        shine.data.transform(Matrix.Rotation(math.radians(30 * s), 4, 'X'))
        shine.location = at + Vector((0.004, s * 0.018, 0.028))
        assign(shine, glint)
        parts += [ring, shine]
    hc = j.head_c
    bridge = cylinder('FaceGlassesBridge', 0.0045, 0.05, loc=(hc.x + b.head[0] + 0.018, 0, hc.z + 0.034), axis='Y', segments=6)
    assign(bridge, rims)
    # The arms leave each rim at its turned outer edge, wide of the big eyes.
    parts += [bridge] + _temples(skel, b, j, 'surveyor', rims, -0.002, fronts=outer, bow=0.016)
    _worn(skel, 'FaceGlasses', parts, 'Head')
    tree = _tree('Torso')
    t = b.torso
    red = material('StaffRed', 0xD8322B, roughness=0.6)
    white = material('StaffWhite', 0xF4F1EA, roughness=0.6)
    # The white shirt under the sweater vest: its V at the neck, under the collar (workers.torso).
    gear = [_shirt_v(tree, 'TorsoShirtV', j.neck_z - 0.004, j.hip_z + 0.29 * t, 0.045, m['collar'])]
    # A pocket protector on the left breast, two pens in it.
    near, normal, up = _upright(tree, _on_torso(tree, 0.072, j.hip_z + 0.27 * t, 0.0))
    side = up.cross(normal)
    orient = Matrix((normal, side, up)).transposed().to_4x4()
    pocket = box('TorsoPocket', (0.012, 0.046, 0.058))
    bevel(pocket, 0.003, 2)
    pocket.matrix_basis = Matrix.Translation(near + normal * 0.009) @ orient
    assign(pocket, material('PocketProtector', 0xF4F4F0, roughness=0.5))
    gear.append(pocket)
    for k, (dy, col) in enumerate(((-0.011, red), (0.011, material('PenBlue', 0x2E5BD8, roughness=0.5)))):
        pen = cylinder(f'TorsoPen{k}', 0.0065, 0.075, segments=10)
        pen.matrix_basis = Matrix.Translation(near + normal * 0.008 + side * dy + up * (0.03 - 0.004 * k)) @ orient
        assign(pen, col)
        gear.append(pen)
    # A red-and-white survey staff slung across his back, sticking up past his shoulder.
    low = _onto(tree, Vector((-0.4, 0.09, j.hip_z + 0.02 * t)), Vector((1, 0, 0)), STAFF_LIFT)
    high = _onto(tree, Vector((-0.4, -0.07, j.hip_z + 0.34 * t)), Vector((1, 0, 0)), STAFF_LIFT)
    axis = (high - low).normalized()
    start = low - axis * 0.13
    # The back bulges between the two anchors: push the whole staff back until its thinnest
    # clearance anywhere along it holds the staff's radius plus a margin off the cloth.
    for _ in range(3):
        nearest = min((tree.find_nearest(start + axis * (STAFF_LENGTH * k / 40))[3] for k in range(41)), default=1.0)
        short = STAFF_R + STAFF_CLEAR - nearest
        if short <= 0:
            break
        low, high, start = (v + Vector((-short, 0, 0)) for v in (low, high, start))
    staff = []
    seg = STAFF_LENGTH / 7
    for k in range(7):
        c = start + axis * (seg * (k + 0.5))
        piece = cylinder(f'TorsoStaff{k}', STAFF_R, seg, loc=tuple(c), segments=10)
        piece.rotation_mode = 'QUATERNION'
        piece.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(axis)
        assign(piece, red if k % 2 else white)
        staff.append(piece)
    sling = loft('TorsoStaffSling', [Section(tuple(_onto(tree, Vector((0.4, 0.06, j.neck_z - 0.02)), Vector((-1, 0, 0)), 0.008)), 0.012, 0.004),
                                     Section(tuple(_onto(tree, Vector((0.0, 0.1, j.neck_z + 0.3)), Vector((0, 0, -1)), 0.022)), 0.012, 0.004),
                                     Section(tuple(high), 0.012, 0.004)],
                 segments=5, rings=8, cap_start=0.3, cap_end=0.3, front=(0, 0, 1))
    assign(sling.ob, m['belt'])
    _torso_bound(skel, 'TorsoGear', gear + staff + [sling.ob], j)


# ------------------------------------------------------------- manager ---

def _mug(m) -> list:
    """A big diner mug held by its handle: the body sits past the curled fingers, its axis along the thumb."""
    gx, gy, gz = GRIP
    mug_mat = material('Mug', 0xF4F2EC, roughness=0.5)
    cx, cz = gx + 0.005, gz - 0.085
    body = lathe('ToolMug', [(0.0, -0.058), (0.044, -0.058), (0.051, -0.052), (0.052, 0.05), (0.047, 0.056),
                             (0.04, 0.05), (0.0, 0.046)], segments=20)
    body.rotation_euler = (0, math.radians(90), 0)
    body.location = (cx, gy, cz)
    assign(body, mug_mat)
    coffee = cylinder('ToolCoffee', 0.04, 0.004, loc=(cx + 0.049, gy, cz), axis='X', segments=16)
    assign(coffee, material('Coffee', 0x3B2416, roughness=0.4))
    handle = torus('ToolMugHandle', 0.036, 0.011, loc=(cx, gy, cz + 0.05), rot=(90, 0, 0),
                   major_segments=16, minor_segments=6)
    assign(handle, mug_mat)
    band = cylinder('ToolMugBand', 0.0525, 0.026, loc=(cx, gy, cz), axis='X', segments=20)
    assign(band, m['tie'])
    return [body, coffee, handle, band]


def _manager_gear(skel: Skeleton, b, j, m) -> None:
    hc = j.head_c
    # The cigar sits in the corner away from the mug hand, so a sip never meets it.
    mouth = Vector((hc.x + b.head[0] * 0.86, 0.045, hc.z - 0.09))
    out = Vector((0.75, 0.45, 0.32)).normalized()
    rot = Vector((0, 0, 1)).rotation_difference(out)
    cigar = cylinder('HeadCigar', 0.016, 0.14, loc=tuple(mouth + out * 0.07), segments=10)
    tip = cylinder('HeadCigarTip', 0.0165, 0.014, loc=tuple(mouth + out * 0.143), segments=10)
    band = cylinder('HeadCigarBand', 0.0175, 0.014, loc=tuple(mouth + out * 0.032), segments=10)
    for ob in (cigar, tip, band):
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = rot
    assign(cigar, material('Cigar', 0x6B4126, roughness=0.8))
    assign(tip, material('Ember', 0xFF7A2A, roughness=0.5, emission=0xFF6A1A, emission_strength=1.0))
    gold = material('Gold', 0xE0B040, roughness=0.35, metallic=0.5)
    assign(band, gold)
    _worn(skel, 'HeadCigar', [cigar, tip, band], 'Mouth')
    # The suit: a white shirt V from the collar to mid-chest between two lapels, the red tie in it
    # (tucked under the lapels where the V closes), one gold button straining over the belly with a
    # gold watch chain drooping from it to a pocket, a role-coloured pocket square.
    tree = _tree('Torso')
    t = b.torso
    top = j.neck_z - 0.018   # under his jowls
    bottom = j.hip_z + 0.2 * t
    half_w = 0.058
    suit = [_shirt_v(tree, 'TorsoShirtV', top, bottom, half_w, m['collar'])]
    for s, sfx in ((1, 'L'), (-1, 'R')):
        pts, widths = [], []
        for k in range(6):
            u = k / 5
            lw = 0.016 * (1 - u) + 0.006
            pts.append((s * (_v_half(half_w, u) + 0.6 * lw), top + (bottom - top) * u))
            widths.append(lw)
        lapel = _decal_loft(f'TorsoLapel{sfx}', pts, widths, 0.005, segments=8, rings=10).ob
        lapel.data.transform(Matrix.Translation((0.008, 0, 0)))
        _conform(lapel, tree, Vector((0, 0, 0)))
        assign(lapel, m['garment'])
        suit.append(lapel)
    tie_pts = []
    for k in range(7):
        u = k / 6
        z = top - 0.001 + (bottom + 0.004 - top) * u
        p = _on_torso(tree, 0.0, z, 0.007)
        v = (top - z) / (top - bottom)
        tie_pts.append(Section(tuple(p), min(0.02 + 0.012 * smoothstep(0.1, 0.9, u), _v_half(half_w, v) - 0.004), 0.004))
    tie = loft('TorsoTie', tie_pts, segments=8, rings=16, cap_start=0.4, cap_end=0.9)
    assign(tie.ob, m['tie'])
    knot = ellipsoid('TorsoTieKnot', (0.014, 0.024, 0.02), loc=tuple(_on_torso(tree, 0.0, top + 0.004, 0.012)),
                     segments=12, rings=8)
    assign(knot, m['tie'])
    belly = j.hip_z + 0.12 * t
    button = cylinder('TorsoButton', 0.019, 0.012, loc=tuple(_on_torso(tree, 0.0, belly, 0.006)), axis='X', segments=12)
    bevel(button, 0.004, 2)
    assign(button, gold)
    # The watch chain: 1.3 cm thick, so it survives the outline at game distance.
    chain = []
    for k in range(9):
        u = k / 8
        y = -0.012 - 0.128 * u
        z = belly - 0.006 - 0.036 * math.sin(math.pi * u) + 0.016 * u
        chain.append(Section(tuple(_on_torso(tree, y, z, 0.0085)), 0.0065, 0.0065))
    watch_chain = loft('TorsoWatchChain', chain, segments=6, rings=16, cap_start=1.0, cap_end=1.0, cap_rings=2)
    assign(watch_chain.ob, gold)
    sq = _on_torso(tree, 0.11, j.hip_z + 0.27 * t, 0.008)
    square = box('TorsoPocketSquare', (0.016, 0.05, 0.03), loc=tuple(sq))
    bevel(square, 0.006, 2)
    assign(square, m['tint'])
    _torso_bound(skel, 'TorsoSuit', suit + [tie.ob, knot, button, watch_chain.ob, square], j)


# ---------------------------------------------------------------- entry ---

def build_props(skel: Skeleton, b, j, m, role: str) -> None:
    from workers import TOOL_HAND, hand_frame
    side = 1 if TOOL_HAND[role] == 'L' else -1
    frame = hand_frame(j, side)
    other = hand_frame(j, -side)
    if role == 'driller':
        _tool(skel, 'ToolJackhammer', _jackhammer(m), frame)
        _driller_gear(skel, b, j, m)
    elif role == 'blaster':
        held, box_parts = _detonator(m)
        _tool(skel, 'ToolPlunger', held, frame, bone=f'Hand{TOOL_HAND[role]}')
        _tool(skel, 'ToolBox', box_parts, frame)
        _blaster_gear(skel, b, j, m)
    elif role == 'driver':
        _tool(skel, 'ToolWrench', _wrench(m), frame)
        _driver_gear(skel, b, j, m)
    elif role == 'surveyor':
        _tool(skel, 'ToolClipboard', _clipboard(m), frame)
        _tool(skel, 'HandPencil', _pencil(m), other, bone='HandR')
        _surveyor_gear(skel, b, j, m)
    elif role == 'manager':
        _tool(skel, 'ToolMug', _mug(m), frame)
        _manager_gear(skel, b, j, m)
