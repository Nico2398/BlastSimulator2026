"""Worker tools and accessories — the part of each role that does the job.

Tools are modelled in *canonical right-hand space* (see `workers.hand_frame`:
wrist at the origin, fingers along -Z, thumb along +X, palm facing +Y) around
the fist's grip, then carried onto the tool hand and bound to the `Tool`
bone, so the animator can move the tool against the hand (the blaster's detonator
box stays on the ground while the plunger goes down; a collapsing worker
drops what he holds). Everything worn is bound to the bone it rides on: hat
gear to `Hat`, glasses to `Head`, the bandolier and the tie to the torso.

* driller  — a chunky cordless rock drill: pistol grip in the fist, battery
             pack under it, an auger bit out along the fingers. Headlamp (it
             glows) on the hat, red ear defenders, overall straps.
* blaster  — a red plunger detonator with white warning labels, carried by
             its own T-handle (he would); goggles pushed up on the hat; a tan
             belt of dynamite across the chest and a fat bundle on his back;
             singed hair puffing out under the brim.
* driver   — a steel open-end wrench with an orange rubber grip and a ring
             end; teardrop aviator shades in gold rims. Glasses and shades are
             named `Face*`, so they draw without an outline.
* surveyor — a big clipboard, paper side out, and a pencil in the other hand;
             thick round glasses over magnified eyes; a red-and-white survey
             staff slung across his back.
* manager  — a coffee mug held by the handle; a cigar with a glowing tip in
             the far corner of the mouth (it rides the Mouth bone); a red tie,
             gold buttons and a pocket square on the suit.
"""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from character import Section, Skeleton, bind_by, bind_rigid, ellipsoid, lathe, loft, smoothstep
from common import assign, bevel, boolean, box, cylinder, material, torus
from worker_face import HAT_DOME, HATS, eye_center, eye_radii, hat_frame

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


def _tool(skel: Skeleton, parts, frame: Matrix, bone: str = 'Tool') -> None:
    from workers import to_hand
    for ob in parts:
        to_hand(ob, frame)
        skel.attach(ob)
        bind_rigid(ob, bone)


def _worn(skel: Skeleton, parts, bone: str, frame: Matrix | None = None) -> None:
    for ob in parts:
        if frame is not None:
            ob.data.transform(frame @ ob.matrix_basis)
            ob.location, ob.rotation_euler, ob.scale = (0, 0, 0), (0, 0, 0), (1, 1, 1)
            ob.rotation_mode = 'XYZ'
        skel.attach(ob)
        bind_rigid(ob, bone)


def _torso_bound(skel: Skeleton, parts, j) -> None:
    from workers import _torso_weights
    for ob in parts:
        skel.attach(ob)
        bind_by(ob, lambda p: _torso_weights(p, j))


def _temples(skel: Skeleton, b, j, role: str, mat, drop: float) -> list:
    """Glasses arms from the lens edge back to the ear, hugging the side of the head."""
    hc = j.head_c
    parts = []
    for s, sfx in ((1, 'L'), (-1, 'R')):
        ec = eye_center(j, s, b.head, role)
        front = Vector((ec.x + 0.012, s * (abs(ec.y) + 0.05), ec.z + 0.004))
        ear = Vector((hc.x + 0.012, s * (b.head[1] * 0.99 + 0.008), hc.z - 0.004 + drop))
        mid = (front + ear) / 2 + Vector((0, s * 0.012, 0))
        arm = loft(f'FaceGlassesArm{sfx}', [Section(tuple(front), 0.005, 0.004), Section(tuple(mid), 0.005, 0.004),
                                            Section(tuple(ear), 0.004, 0.004)],
                   segments=5, rings=6, cap_start=1.0, cap_end=1.0, cap_rings=1, front=(0, 0, 1))
        assign(arm.ob, mat)
        parts.append(arm.ob)
    return parts


# ------------------------------------------------------------- driller ---

def _drill(m) -> list:
    """Chunky rather than long: the bit tip stays above the soles with the arm hanging."""
    gx, gy, gz = GRIP
    yellow = material('DrillYellow', 0xF2B705, roughness=0.55)
    parts = []
    grip = cylinder('ToolGrip', 0.024, 0.13, loc=(gx - 0.005, gy, gz), axis='X', segments=14)
    bevel(grip, 0.007, 2)
    assign(grip, m['dark'])
    parts.append(grip)
    battery = box('ToolBattery', (0.07, 0.09, 0.11), loc=(gx - 0.1, gy, gz - 0.012))
    bevel(battery, 0.015, 2)
    assign(battery, m['tint'])
    parts.append(battery)
    body = cylinder('ToolBody', 0.058, 0.2, loc=(gx + 0.095, gy, gz - 0.02), segments=18)
    bevel(body, 0.018, 2)
    assign(body, yellow)
    parts.append(body)
    motor = cylinder('ToolMotor', 0.064, 0.07, loc=(gx + 0.095, gy, gz + 0.09), segments=18)
    bevel(motor, 0.02, 2)
    assign(motor, m['dark'])
    parts.append(motor)
    chuck = cylinder('ToolChuck', 0.034, 0.06, loc=(gx + 0.095, gy, gz - 0.15), radius2=0.022, segments=14)
    bevel(chuck, 0.007, 2)
    assign(chuck, m['steel'])
    parts.append(chuck)
    # Auger bit: a twisted flight round a shaft, pointing out along the fingers.
    shaft = cylinder('ToolBitShaft', 0.009, 0.12, loc=(gx + 0.095, gy, gz - 0.235), segments=8)
    assign(shaft, m['metal'])
    parts.append(shaft)
    flight = []
    turns, steps = 3, 30
    for k in range(steps + 1):
        t = k / steps
        ang = t * turns * 2 * math.pi
        r = 0.022 * (1 - 0.5 * t)
        flight.append(Section((gx + 0.095 + math.cos(ang) * r * 0.55, gy + math.sin(ang) * r * 0.55, gz - 0.18 - 0.11 * t),
                              0.014 * (1 - 0.4 * t), 0.007))
    helix = loft('ToolBitFlight', flight, segments=4, rings=30, cap_start=1.0, cap_end=1.0, cap_rings=1)
    assign(helix.ob, m['metal'])
    parts.append(helix.ob)
    return parts


def _driller_gear(skel: Skeleton, b, j, m) -> None:
    hc = j.head_c
    dome = HAT_DOME * HATS['driller'].scale
    lamp = cylinder('HatLamp', 0.046, 0.05, loc=(dome + 0.012, 0, 0.07), axis='X', segments=18)
    bevel(lamp, 0.01, 2)
    assign(lamp, m['steel'])
    lens = cylinder('HatLampLens', 0.035, 0.012, loc=(dome + 0.04, 0, 0.07), axis='X', segments=18)
    assign(lens, material('Lamp', 0xFFF2A8, roughness=0.3, emission=0xFFE080, emission_strength=0.6))
    _worn(skel, [lamp, lens], 'Hat', hat_frame(j, 'driller'))
    muffs = []
    defender = material('EarDefender', 0xE23A2A, roughness=0.6)
    for s, sfx in ((1, 'L'), (-1, 'R')):
        cup = cylinder(f'HeadMuff{sfx}', 0.058, 0.05, loc=(hc.x + 0.004, s * (b.head[1] + 0.034), hc.z - 0.01), axis='Y',
                       segments=18)
        bevel(cup, 0.015, 2)
        assign(cup, defender)
        muffs.append(cup)
    _worn(skel, muffs, 'Head')
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
    _torso_bound(skel, straps, j)


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
    rod = cylinder('ToolPlungerRod', 0.012, DETONATOR_ROD, loc=(gx, gy, gz - DETONATOR_ROD / 2), segments=8)
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
        t = cylinder(f'ToolBoxTerminal{k}', 0.013, 0.025, loc=(gx - 0.06, gy + dy, top + 0.02), segments=8)
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
    _worn(skel, goggles, 'Hat', hat_frame(j, 'blaster'))
    # Singed hair: frizzy puffs bursting out from under the brim at the temples, over the ears and
    # round the back — lumpy clusters, big enough to bulge past the brim from above.
    singed = material('Singed', 0x33261F, roughness=0.95)
    puffs = []
    a, bw = b.head[0], b.head[1]
    for k, ang in enumerate((62, 105, 150, 210, 255, 298)):
        az = math.radians(ang)
        root = Vector((hc.x + math.cos(az) * a * 0.97, math.sin(az) * bw * 0.99, hc.z + 0.035))
        out = Vector((math.cos(az), math.sin(az), -0.3)).normalized()
        for n, (fwd, up, r) in enumerate(((0.028, 0.0, 0.046), (0.052, -0.032, 0.032))):
            side = Vector((-math.sin(az), math.cos(az), 0)) * (0.024 * (n - 0.5))
            c = root + out * fwd + Vector((0, 0, up)) + side
            puff = ellipsoid(f'HeadPuff{k}_{n}', (r * 1.1, r, r * 0.9), loc=tuple(c), segments=7, rings=5,
                             deform=lambda p, kk=k + n: p * (1 + 0.12 * math.sin(p.x * 140 + kk) * math.sin(p.z * 120)))
            assign(puff, singed)
            puffs.append(puff)
    _worn(skel, puffs, 'Head')
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
        stick = cylinder(f'TorsoDynamite{k}', 0.02, 0.09, loc=tuple(center), segments=8)
        cap = cylinder(f'TorsoDynamiteCap{k}', 0.021, 0.014, loc=tuple(center + up * 0.04), segments=8)
        fuse = cylinder(f'TorsoFuse{k}', 0.004, 0.03, loc=tuple(center + up * 0.06), segments=6)
        for ob, mat in ((stick, red), (cap, paper), (fuse, fuse_mat)):
            ob.rotation_mode = 'QUATERNION'
            ob.rotation_quaternion = rot
            assign(ob, mat)
        sticks += [stick, cap, fuse]
    # And a fat bundle of it strapped on his back, fuse up: what you see of him from above.
    bundle = []
    back = _onto(tree, Vector((-0.4, 0.0, j.hip_z + 0.24 * t)), Vector((1, 0, 0)), 0.0)
    for k, (dy, dz) in enumerate(((-0.045, 0), (0.0, 0.006), (0.045, 0), (0.0, 0.045))):
        c = back + Vector((-0.045 - (0.03 if dz else 0), dy, 0.1 + dz))
        stick = cylinder(f'TorsoBundle{k}', 0.027, 0.24, loc=tuple(c), segments=8)
        assign(stick, red)
        cap = cylinder(f'TorsoBundleCap{k}', 0.028, 0.016, loc=tuple(c + Vector((0, 0, 0.12))), segments=8)
        assign(cap, paper)
        bundle += [stick, cap]
    tie_band = torus('TorsoBundleTie', 0.075, 0.009, loc=tuple(back + Vector((-0.06, 0, 0.1))), major_segments=16, minor_segments=4)
    tie_band.scale = (0.75, 1.15, 1.0)
    assign(tie_band, leather)
    fuse = loft('TorsoBundleFuse', [Section(tuple(back + Vector((-0.06, 0, 0.24))), 0.005, 0.005),
                                    Section(tuple(back + Vector((-0.09, 0.04, 0.32))), 0.004, 0.004),
                                    Section(tuple(back + Vector((-0.13, 0.02, 0.36))), 0.004, 0.004)],
                segments=5, rings=6, cap_start=1.0, cap_end=1.0, cap_rings=1)
    assign(fuse.ob, fuse_mat)
    _torso_bound(skel, [belt.ob] + sticks + bundle + [tie_band, fuse.ob], j)


# -------------------------------------------------------------- driver ---

def _wrench(m) -> list:
    """A flat steel open-end wrench, orange rubber grip in the fist, open C-jaw out past the thumb, ring at the heel."""
    gx, gy, gz = GRIP
    steel = material('WrenchSteel', 0x8A9099, roughness=0.4, metallic=0.4)
    handle = box('ToolWrenchHandle', (0.38, 0.018, 0.05), loc=(gx + 0.07, gy, gz))
    bevel(handle, 0.008, 2)
    assign(handle, steel)
    head = cylinder('ToolWrenchHead', 0.072, 0.022, loc=(gx + 0.285, gy, gz), axis='Y', segments=22)
    notch = box('ToolWrenchNotch', (0.1, 0.06, 0.058), loc=(gx + 0.32, gy, gz))
    notch.rotation_euler = (0, math.radians(15), 0)
    boolean(head, notch)
    bevel(head, 0.007, 2)
    assign(head, steel)
    ring = torus('ToolWrenchRing', 0.034, 0.014, loc=(gx - 0.14, gy, gz), rot=(90, 0, 0), major_segments=16, minor_segments=6)
    assign(ring, steel)
    grip = box('ToolWrenchGrip', (0.12, 0.03, 0.06), loc=(gx - 0.005, gy, gz))
    bevel(grip, 0.012, 2)
    assign(grip, material('Rubber', 0xE8622A, roughness=0.8))
    return [handle, head, ring, grip]


def _driver_gear(skel: Skeleton, b, j, m) -> None:
    lens = material('ShadeLens', 0x1E2A3A, roughness=0.15)
    glint = material('ShadeGlint', 0x8FB4D8, roughness=0.2)
    frame = material('ShadeFrame', 0xD6B25A, roughness=0.4, metallic=0.4)
    parts = []
    er = eye_radii('driver')
    for s, sfx in ((1, 'L'), (-1, 'R')):
        ec = eye_center(j, s, b.head, 'driver')

        def teardrop(p: Vector, side=s) -> Vector:
            # Wide at the top outside corner, tapering down and in.
            if p.z < 0:
                p.y -= side * 0.3 * (-p.z / 0.05) * abs(p.y) * (1 if p.y * side > 0 else -1) * 0.5
                p.y *= 1 - 0.22 * (-p.z / 0.05)
            return p

        g = ellipsoid(f'FaceShade{sfx}', (0.011, 0.054, 0.046), segments=16, rings=10, deform=teardrop)
        g.data.transform(Matrix.Rotation(math.radians(s * 14), 4, 'Z'))
        g.location = ec + Vector((er[0] + 0.012, s * 0.006, -0.002))
        assign(g, lens)
        streak = ellipsoid(f'FaceShadeGlint{sfx}', (0.004, 0.03, 0.007), segments=8, rings=4)
        streak.data.transform(Matrix.Rotation(math.radians(-25 * s), 4, 'X'))
        streak.data.transform(Matrix.Rotation(math.radians(s * 14), 4, 'Z'))
        streak.location = ec + Vector((er[0] + 0.022, s * 0.01, 0.014))
        assign(streak, glint)
        rim = torus(f'FaceShadeRim{sfx}', 0.05, 0.0045, loc=tuple(g.location), rot=(0, 90, s * 14), major_segments=20, minor_segments=4)
        rim.scale = (1.0, 1.0, 0.9)
        assign(rim, frame)
        parts += [g, streak, rim]
    hc = j.head_c
    for k, dz in enumerate((0.044, 0.056)):
        bridge = cylinder(f'FaceShadeBridge{k}', 0.0035, 0.05, loc=(hc.x + b.head[0] + 0.016, 0, hc.z + dz), axis='Y', segments=6)
        assign(bridge, frame)
        parts.append(bridge)
    parts += _temples(skel, b, j, 'driver', frame, 0.0)
    _worn(skel, parts, 'Head')


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


def _surveyor_gear(skel: Skeleton, b, j, m) -> None:
    rims = material('GlassesRim', 0x3A2A22, roughness=0.5)
    glint = material('GlassesGlint', 0xFFFFFF, roughness=0.2)
    parts = []
    er = eye_radii('surveyor')
    for s, sfx in ((1, 'L'), (-1, 'R')):
        ec = eye_center(j, s, b.head, 'surveyor')
        at = ec + Vector((er[0] + 0.012, 0, 0.002))
        # Thick round rims, no glass: the big magnified eyes show straight through.
        ring = torus(f'FaceGlasses{sfx}', er[1] + 0.008, 0.005, loc=tuple(at), rot=(0, 90, s * 26), major_segments=24, minor_segments=4)
        assign(ring, rims)
        shine = ellipsoid(f'FaceGlassesGlint{sfx}', (0.002, 0.016, 0.005), segments=8, rings=4)
        shine.data.transform(Matrix.Rotation(math.radians(30 * s), 4, 'X'))
        shine.location = at + Vector((0.004, s * 0.018, 0.028))
        assign(shine, glint)
        parts += [ring, shine]
    hc = j.head_c
    bridge = cylinder('FaceGlassesBridge', 0.0045, 0.05, loc=(hc.x + b.head[0] + 0.012, 0, hc.z + 0.034), axis='Y', segments=6)
    assign(bridge, rims)
    parts += [bridge] + _temples(skel, b, j, 'surveyor', rims, -0.002)
    _worn(skel, parts, 'Head')
    # A red-and-white survey staff slung across his back, sticking up past the hat.
    tree = _tree('Torso')
    t = b.torso
    low = _onto(tree, Vector((-0.4, 0.09, j.hip_z + 0.02 * t)), Vector((1, 0, 0)), 0.035)
    high = _onto(tree, Vector((-0.4, -0.07, j.hip_z + 0.34 * t)), Vector((1, 0, 0)), 0.035)
    axis = (high - low).normalized()
    start = low - axis * 0.12
    red = material('StaffRed', 0xD8322B, roughness=0.6)
    white = material('StaffWhite', 0xF4F1EA, roughness=0.6)
    staff = []
    seg = 0.13
    for k in range(7):
        c = start + axis * (seg * (k + 0.5))
        piece = cylinder(f'TorsoStaff{k}', 0.016, seg, loc=tuple(c), segments=8)
        piece.rotation_mode = 'QUATERNION'
        piece.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(axis)
        assign(piece, red if k % 2 else white)
        staff.append(piece)
    sling = loft('TorsoStaffSling', [Section(tuple(_onto(tree, Vector((0.4, 0.06, j.neck_z - 0.02)), Vector((-1, 0, 0)), 0.008)), 0.012, 0.004),
                                     Section(tuple(_onto(tree, Vector((0.0, 0.1, j.neck_z + 0.3)), Vector((0, 0, -1)), 0.008)), 0.012, 0.004),
                                     Section(tuple(high), 0.012, 0.004)],
                 segments=5, rings=8, cap_start=0.3, cap_end=0.3, front=(0, 0, 1))
    assign(sling.ob, m['belt'])
    _torso_bound(skel, staff + [sling.ob], j)


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
    _worn(skel, [cigar, tip, band], 'Mouth')
    # Tie, gold buttons and a role-coloured pocket square on the suit.
    tree = _tree('Torso')
    t = b.torso
    top = j.neck_z - 0.005
    bottom = j.hip_z + 0.11 * t
    tie_pts = []
    for k in range(7):
        u = k / 6
        z = top + (bottom - top) * u
        p = _onto(tree, Vector((0.4, 0, z)), Vector((-1, 0, 0)), 0.014)
        tie_pts.append(Section(tuple(p), 0.02 + 0.017 * smoothstep(0.1, 0.85, u) * (1 - smoothstep(0.85, 1.0, u)), 0.01))
    tie = loft('TorsoTie', tie_pts, segments=8, rings=16, cap_start=0.4, cap_end=0.9)
    assign(tie.ob, m['tie'])
    knot = ellipsoid('TorsoTieKnot', (0.018, 0.026, 0.022), loc=tuple(_onto(tree, Vector((0.4, 0, top + 0.005)), Vector((-1, 0, 0)), 0.016)))
    assign(knot, m['tie'])
    buttons = []
    for k, z in enumerate((j.hip_z + 0.16 * t, j.hip_z + 0.08 * t)):
        for s in (1, -1):
            p = _onto(tree, Vector((0.4, s * 0.085, z)), Vector((-1, 0, 0)), 0.006)
            btn = cylinder(f'TorsoButton{k}{s}', 0.013, 0.01, loc=tuple(p), axis='X', segments=10)
            assign(btn, gold)
            buttons.append(btn)
    sq = _onto(tree, Vector((0.4, 0.11, j.hip_z + 0.27 * t)), Vector((-1, 0, 0)), 0.008)
    square = box('TorsoPocketSquare', (0.016, 0.05, 0.03), loc=tuple(sq))
    bevel(square, 0.006, 2)
    assign(square, m['tint'])
    _torso_bound(skel, [tie.ob, knot, square] + buttons, j)


# ---------------------------------------------------------------- entry ---

def build_props(skel: Skeleton, b, j, m, role: str) -> None:
    from workers import TOOL_HAND, hand_frame
    side = 1 if TOOL_HAND[role] == 'L' else -1
    frame = hand_frame(j, side)
    other = hand_frame(j, -side)
    if role == 'driller':
        _tool(skel, _drill(m), frame)
        _driller_gear(skel, b, j, m)
    elif role == 'blaster':
        held, box_parts = _detonator(m)
        _tool(skel, held, frame, bone=f'Hand{TOOL_HAND[role]}')
        _tool(skel, box_parts, frame)
        _blaster_gear(skel, b, j, m)
    elif role == 'driver':
        _tool(skel, _wrench(m), frame)
        _driver_gear(skel, b, j, m)
    elif role == 'surveyor':
        _tool(skel, _clipboard(m), frame)
        _tool(skel, _pencil(m), other, bone='HandR')
        _surveyor_gear(skel, b, j, m)
    elif role == 'manager':
        _tool(skel, _mug(m), frame)
        _manager_gear(skel, b, j, m)
