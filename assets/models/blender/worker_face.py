"""Worker heads — skull, face, hair and hard hat, per role.

The face is where a worker stops being a mannequin, so it carries the most
care per triangle:

* **Skulls differ by role**: the driller's square jaw, the blaster's narrow
  head and pointed chin, the driver's wide flat pan, the surveyor's egg, the
  manager's jowls. Noses differ too, from button to potato.
* **Eyes** are big white bulbs seated in sockets carved into the skull, a
  thin dark iris painted onto the white looking a touch up toward the game
  camera, and a highlight. Face parts are named `Face*` so the runtime leaves
  them out of the outline: lined, every eyeball wears a black ring. Each upper lid is a hemisphere of skin on its
  own bone (`LidL/R`) with a dark lash along its edge: its resting angle sets
  the personality (wide for the blaster, heavy and smug for the manager) and
  is written into the lid bone's direction, so the animator knows how far to
  turn it to shut the eye completely.
* **Two mouths**: the role's everyday mouth on bone `Mouth`, and a gaping
  "O" on bone `Gasp`, parked inside the skull until panic or a collapse
  swaps them.
* **Decals** — mouths, brows, moustaches — are shaped flat and then
  *conformed* to the skull by ray-casting onto it, so they hug the face
  instead of floating on or sinking into it.
* **Hair and beards** are shells of the skull pushed out where a mask says
  hair grows and pulled under the skin everywhere else; the nape edge is
  scalloped into clumps.
* **Hard hat** is a lathed crown with its ridge raised out of the same
  surface, a narrow brim and a peak over the eyes, worn per role — level,
  askew, perched — on its own bone (`Hat`) so it can be knocked off.

Coordinates are armature space (Blender Z up, +X the face's front).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from character import Section, Skeleton, assign_faces, bind_rigid, ellipsoid, lathe, loft, prune, smoothstep
from common import assign, material


@dataclass(frozen=True)
class Face:
    """Per-role face: lids, brows, mouth, nose, eyes."""
    lid: float            # how open the eye rests: 1 shows the whole white, 0.5 is half-lidded
    brow_tilt: tuple[float, float]   # degrees, left and right; + lifts the outer end
    brow_h: float         # brow height above the eyes, metres
    brow_thick: float     # brow half-height, metres
    mouth: str
    nose: tuple[float, float, float]   # nose radii: depth, width, height
    nose_droop: float = 0.0            # degrees the nose tips down (the blaster's long one); negative turns it up
    eye: float = 1.0                   # eye size scale
    ear: float = 1.0                   # ear size scale


FACE = {
    # A broad, flat boxer's nose; a long hooked beak; a squashed bulb; a button; an upturned snout.
    'driller': Face(0.74, (-4, -4), 0.07, 0.016, 'grin', (0.038, 0.066, 0.04)),
    'blaster': Face(0.97, (26, -14), 0.075, 0.012, 'manic', (0.064, 0.03, 0.03), nose_droop=16, eye=1.15),
    'driver': Face(0.64, (-10, -10), 0.064, 0.016, 'flat', (0.036, 0.056, 0.032)),
    'surveyor': Face(0.8, (-16, -16), 0.074, 0.01, 'nerd', (0.03, 0.026, 0.026), eye=1.25, ear=1.3),
    'manager': Face(0.52, (22, 22), 0.08, 0.012, 'smirk', (0.056, 0.062, 0.046), nose_droop=-14),
}


@dataclass(frozen=True)
class Hat:
    """How each role wears the hard hat."""
    line: float      # hat base above the skull centre, metres
    tilt: float      # degrees tipped back
    roll: float      # degrees askew (+ toward the left)
    scale: float
    band: str        # 'dark' or 'gold': the band round the crown


HATS = {
    'driller': Hat(0.112, 5, 0, 1.0, 'dark'),
    'blaster': Hat(0.128, 9, 13, 0.98, 'dark'),
    'driver': Hat(0.118, 8, 0, 1.0, 'dark'),
    'surveyor': Hat(0.15, 15, 0, 0.88, 'dark'),   # perched high and back: the egg forehead shows
    'manager': Hat(0.142, 12, 0, 0.9, 'gold'),
}

EYE_Y = 0.073      # lateral offset of each eye from the midline (for a 0.2 m wide head)
EYE_Z = 0.028      # height of the eyes above the skull centre
EYE_R = (0.036, 0.045, 0.052)   # eye white radii: depth, width, height
LID_TUCK = 0.09      # the lid shell is inside the eye this far (fraction of its height) below its edge
SOCKET_GAP = 0.004   # how far behind the eye white the socket floor sits (m)
SOCKET_RIM = 0.3     # the socket's rim, as a fraction of the eye's radius past its outline
SKULL_SEGMENTS, SKULL_RINGS = 32, 20
SKULL_FRONT_BIAS = (0.35, 0.3)   # skull vertices drawn toward the face (ellipsoid front_bias)
HAT_DOME = 0.184   # crown radius at the brim
HAT_BRIM = 0.02    # how far the brim reaches past the crown at the sides
HAT_PEAK = 0.05    # and how much further at the front
GASP_HIDE = 0.04
"""How far inside the skull the gasp mouth waits; the animator moves the Gasp bone forward by this to show it."""


def eye_radii(role: str) -> tuple[float, float, float]:
    k = FACE[role].eye
    return (EYE_R[0] * k, EYE_R[1] * k, EYE_R[2] * k)


def eye_center(j, side: int, head, role: str) -> Vector:
    hc = j.head_c
    a, bw, c = head
    y, z = EYE_Y * side * (bw / 0.2), EYE_Z
    x = a * math.sqrt(max(0.0, 1 - (y / bw) ** 2 - (z / c) ** 2))
    return Vector((hc.x + x - eye_radii(role)[0] * 0.62, y, hc.z + z))


def eye_yaw(head, side: int) -> float:
    """Each eye turns out a little, following the curve of the face (radians about Z)."""
    return math.atan2(side * EYE_Y * 1.6, head[0])


def lid_open_angle(role: str) -> float:
    """Elevation (radians) of the lid's front edge when the eye rests open."""
    cut = 2 * FACE[role].lid - 1
    return math.asin(max(-0.95, min(0.95, cut)))


def hat_pivot(j, role: str) -> Vector:
    return Vector((j.head_c.x + 0.006, 0, j.head_c.z + HATS[role].line))


def hat_frame(j, role: str) -> Matrix:
    """Hat-local → armature space: what the hat and its gear (lamp, goggles) are built in."""
    spec = HATS[role]
    return (Matrix.Translation(hat_pivot(j, role)) @ Matrix.Rotation(math.radians(spec.roll), 4, 'X') @
            Matrix.Rotation(math.radians(-spec.tilt), 4, 'Y'))


def mouth_center(j, b) -> Vector:
    return Vector((j.head_c.x + b.head[0] * 0.9, 0, j.head_c.z - 0.088))


# ------------------------------------------------------------------ skull

def _skull(b, j, m, role: str) -> bpy.types.Object:
    hc = j.head_c
    a, bw, c = b.head

    def deform(p: Vector) -> Vector:
        low = smoothstep(0.1, -0.75, p.z / c)            # 0 above the cheekbones, 1 at the jaw
        p.y *= 1 + (b.jaw - 1) * low
        if p.x > 0:
            p.x += b.chin * low * smoothstep(0.0, 0.8, p.x / a)
            # Cheeks: a little fullness under the eyes; a flatter face front.
            p.x += 0.008 * smoothstep(-0.7, -0.2, p.z / c) * (1 - smoothstep(-0.2, 0.15, p.z / c)) * (p.x / a)
            p.x -= 0.012 * smoothstep(0.4, 0.9, p.x / a) * (1 - abs(p.z / c))
        if b.jowl > 0:
            # A double chin hanging under the jaw, front and sides.
            under = smoothstep(-0.55, -0.95, p.z / c) * smoothstep(-0.6, 0.3, p.x / a)
            p.z -= b.jowl * under
            p.x += b.jowl * 0.5 * under
        # Flatten the crown slightly so the hat sits.
        if p.z > 0.6 * c:
            p.z -= (p.z - 0.6 * c) * 0.15
        return p

    # Eye sockets: wherever the skull lies under an eye, seen from the front, it is
    # pushed back behind that eye's white — the exact (yawed) ellipsoid, not its
    # footprint — then rises back to the face over a short rim outside it.
    sockets = [(eye_center(j, s, b.head, role) - hc, eye_radii(role), eye_yaw(b.head, s)) for s in (1, -1)]
    base_deform = deform

    def socketed(p: Vector) -> Vector:
        p = base_deform(p)
        if p.x <= 0:
            return p
        for ec, er, yaw in sockets:
            # Ray along -X through (p.y, p.z), in the eye's frame: A·u² + B·u + C0 = k²
            # where u is the offset from the eye centre along X and k the ellipsoid scale hit.
            cy, sy = math.cos(yaw), math.sin(yaw)
            v, w = p.y - ec.y, p.z - ec.z
            ia, ib, ic = 1 / er[0] ** 2, 1 / er[1] ** 2, 1 / er[2] ** 2
            A = cy * cy * ia + sy * sy * ib
            B = 2 * v * sy * cy * (ia - ib)
            C0 = v * v * (sy * sy * ia + cy * cy * ib) + w * w * ic
            k2 = C0 - B * B / (4 * A)            # squared scale of the eye ellipsoid this ray just grazes
            k = math.sqrt(max(0.0, k2))
            if k >= 1 + SOCKET_RIM:
                continue
            if k < 1:
                u = (-B + math.sqrt(B * B - 4 * A * (C0 - 1))) / (2 * A)   # front of the white
            else:
                u = -B / (2 * A)                                         # the eye's widest line
            target = ec.x + u - SOCKET_GAP
            p.x = min(p.x, target + (p.x - target) * smoothstep(1.0, 1 + SOCKET_RIM, k))
        return p

    ob = ellipsoid('HeadSkull', (a, bw, c), loc=tuple(hc), segments=SKULL_SEGMENTS, rings=SKULL_RINGS,
                   deform=socketed, front_bias=SKULL_FRONT_BIAS)
    assign(ob, m['skin'])
    return ob


def _bvh(ob: bpy.types.Object) -> BVHTree:
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.transform(ob.matrix_basis)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def _conform(ob: bpy.types.Object, tree: BVHTree, origin: Vector) -> None:
    """Project a decal onto the skull: each vertex's local X is its height above the surface.

    The vertex's (y, z) picks where on the face it lands — a ray from in front
    of the face straight back along -X — and the decal is lifted along the
    surface normal there, so it follows the face's curve round to the cheeks.
    """
    for v in ob.data.vertices:
        lift = v.co.x
        hit, normal, _, _ = tree.ray_cast(Vector((origin.x + 1.0, v.co.y, v.co.z)), Vector((-1, 0, 0)))
        if hit is None:
            continue
        v.co = hit + normal * lift
    ob.data.update()


def _shell(name: str, skull: bpy.types.Object, mask, thick: float, sink: float = 0.012, noise=None) -> bpy.types.Object:
    """A copy of the skull pushed out by `thick` where mask(p) is 1 and under the skin where it is 0.

    Faces whose every corner is under the skin can never be seen and are
    dropped; the open border that leaves stays buried inside the skull.
    """
    me = skull.data.copy()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = skull.location
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    ks = {}
    for v in bm.verts:
        p = v.co.copy()
        k = mask(p)
        ks[v.index] = k
        extra = noise(p) if noise else 0.0
        v.co = p + v.normal * (k * (thick + extra) - (1 - k) * sink)
    hidden = [f for f in bm.faces if all(ks[v.index] < 0.02 for v in f.verts)]
    bmesh.ops.delete(bm, geom=hidden, context='FACES')
    bm.to_mesh(me)
    bm.free()
    ob.data.shade_smooth()
    return ob


# ------------------------------------------------------------------- eyes

def _eyes(skel: Skeleton, b, j, m, role: str) -> None:
    er = eye_radii(role)
    open_angle = lid_open_angle(role)
    lash = material('Lash', 0x2A1C18, roughness=0.8)
    for s, sfx in ((1, 'L'), (-1, 'R')):
        ec = eye_center(j, s, b.head, role)
        rot = Matrix.Rotation(eye_yaw(b.head, s), 4, 'Z')
        white = ellipsoid(f'FaceEye{sfx}', er, segments=16, rings=10)
        prune(white, lambda p, rx=er[0]: p.x > -0.3 * rx)   # the back half sits inside the skull
        white.data.transform(rot)
        white.location = ec
        assign(white, m['white'])
        # Iris + pupil: a thin dark disc painted onto the white, a touch up toward the camera.
        iris_k = 0.82 if role == 'blaster' else 1.0
        iris = ellipsoid(f'FaceIris{sfx}', (0.004, 0.023 * iris_k, 0.027 * iris_k), segments=12, rings=7)
        iris.data.transform(Matrix.Translation((er[0] - 0.0015, -s * 0.002, 0.006)))
        iris.data.transform(rot)
        iris.location = ec
        assign(iris, m['iris'])
        shine = ellipsoid(f'FaceShine{sfx}', (0.003, 0.0085, 0.0085), segments=8, rings=5)
        shine.data.transform(Matrix.Translation((er[0] + 0.0025, s * 0.008, 0.018)))
        shine.data.transform(rot)
        shine.location = ec
        assign(shine, m['white'])
        for ob in (white, iris, shine):
            skel.attach(ob)
            bind_rigid(ob, 'Head')
        # Upper lid: the top half of a skin shell a little larger than the eye, its edge
        # turned up to the resting lid line. Turning it down far enough brings the edge
        # under the eye: shut, with no white left showing.
        lr = (er[0] * 1.22, er[1] * 1.16, er[2] * 1.14)
        # Below its edge the shell tucks inside the eye. It crosses the white within
        # LID_TUCK of the edge, under the lash, so no skin shows through the white.
        lid = ellipsoid(f'FaceLid{sfx}', lr, segments=16, rings=12,
                        deform=lambda p, rz=lr[2]: p * (0.72 + 0.28 * smoothstep(-LID_TUCK, 0.0, p.z / rz)))
        prune(lid, lambda p, rz=lr[2] * 0.8: p.z > -0.45 * rz)   # the tucked-in lower shell never shows
        # The lid's edge drawn as one flat, even line — no flick at the corner.
        edge = []
        for k in range(9):
            az = math.radians(-62 + 124 * k / 8)
            edge.append(Section((math.cos(az) * lr[0] * 1.02, math.sin(az) * lr[1] * 1.02, -0.004), 0.0055, 0.0035))
        lash_ob = loft(f'FaceLash{sfx}', edge, segments=4, rings=12, cap_start=0.6, cap_end=0.6, cap_rings=1,
                       front=(0, 0, 1)).ob
        tip_back = Matrix.Rotation(-open_angle, 4, 'Y')
        for ob in (lid, lash_ob):
            ob.data.transform(tip_back)
            ob.data.transform(rot)
            ob.location = ec
        assign(lid, m['skin'])
        assign(lash_ob, lash)
        for ob in (lid, lash_ob):
            skel.attach(ob)
            bind_rigid(ob, f'Lid{sfx}')


# ------------------------------------------------------------------ decals

def _decal_loft(name: str, points, width, depth, segments=6, rings=8):
    """A flattened tube whose local X is height above the face: (y, z) points, then conformed."""
    secs = [Section((depth * 0.5, y, z), w, depth) for (y, z), w in zip(points, width)]
    return loft(name, secs, segments=segments, rings=rings, cap_start=1.0, cap_end=1.0, cap_rings=2, front=(1, 0, 0))


def _brows(skel, b, j, m, role, tree) -> None:
    f = FACE[role]
    hc = j.head_c
    wscale = b.head[1] / 0.2
    for s, sfx in ((1, 'L'), (-1, 'R')):
        tilt = math.radians(f.brow_tilt[0 if s == 1 else 1])
        bz = hc.z + EYE_Z + f.brow_h
        inner, outer = 0.024 * wscale, 0.13 * wscale
        pts = []
        for k in range(5):
            t = k / 4
            y = inner + (outer - inner) * t
            z = bz + math.sin(t * math.pi) * 0.01 + (t - 0.4) * math.tan(tilt) * (outer - inner)
            pts.append((s * y, z))
        th = f.brow_thick
        ob = _decal_loft(f'HeadBrow{sfx}', pts, [th * 0.8, th * 1.05, th, th * 0.9, th * 0.6], 0.011).ob
        _conform(ob, tree, hc)
        assign(ob, m['hair'])
        skel.attach(ob)
        bind_rigid(ob, f'Brow{sfx}')


def _nose(skel, b, j, m, role, tree) -> None:
    f = FACE[role]
    hc = j.head_c
    hit, normal, _, _ = tree.ray_cast(Vector((hc.x + 1, 0, hc.z - 0.018)), Vector((-1, 0, 0)))
    ob = ellipsoid('HeadNose', f.nose, segments=12, rings=8)
    if f.nose_droop:
        ob.data.transform(Matrix.Rotation(math.radians(f.nose_droop), 4, 'Y'))
    ob.location = hit + Vector((f.nose[0] * 0.45, 0, -0.004))
    assign(ob, m['skin'])
    skel.attach(ob)
    bind_rigid(ob, 'Head')


def _mouth(skel, b, j, m, role, tree) -> None:
    style = FACE[role].mouth
    hc = j.head_c
    mz = hc.z - 0.088
    if style in ('small', 'nerd'):
        w, h = 0.03, 0.016
    elif style == 'manic':
        w, h = 0.058, 0.03
    elif style == 'flat':
        w, h = 0.04, 0.012
    else:
        w, h = 0.05, 0.024
    tilt = 0.012 if style == 'smirk' else 0.0

    def smile(p: Vector) -> Vector:
        # Flat top, round bottom: a D on its back. Upper corners lift for a smile.
        if p.z > 0:
            p.z *= 0.18
        p.z += (p.y / w) ** 2 * h * 0.55 + tilt * (p.y / w)
        return p

    mouth = ellipsoid('FaceMouth', (0.005, w, h), segments=14, rings=7, deform=smile)
    mouth.data.transform(Matrix.Translation((0.004, 0, mz)))
    _conform(mouth, tree, hc)
    assign(mouth, m['mouth'] if style != 'nerd' else material('FaceMouthSoft', 0x8A4A44, roughness=0.8))
    parts = [mouth]
    if style == 'nerd':
        # Two buck teeth over the lip.
        for k, dy in enumerate((-0.0075, 0.0075)):
            tooth = ellipsoid(f'FaceBuckTooth{k}', (0.004, 0.0068, 0.009), segments=8, rings=5)
            tooth.data.transform(Matrix.Translation((0.006, dy, mz - 0.004)))
            _conform(tooth, tree, hc)
            assign(tooth, m['teeth'])
            parts.append(tooth)
    if style in ('grin', 'manic', 'smirk'):
        teeth = ellipsoid('FaceTeeth', (0.004, w * 0.78, h * 0.28), segments=12, rings=4,
                          deform=lambda p: p + Vector((0, 0, (p.y / w) ** 2 * h * 0.5 + tilt * (p.y / w))))
        teeth.data.transform(Matrix.Translation((0.007, 0, mz + h * 0.05)))
        _conform(teeth, tree, hc)
        assign(teeth, m['teeth'])
        parts.append(teeth)
    if style in ('grin', 'manic'):
        tongue = ellipsoid('FaceTongue', (0.003, w * 0.45, h * 0.35), segments=8, rings=4)
        tongue.data.transform(Matrix.Translation((0.007, 0, mz - h * 0.55)))
        _conform(tongue, tree, hc)
        assign(tongue, m['tongue'])
        parts.append(tongue)
    for ob in parts:
        skel.attach(ob)
        bind_rigid(ob, 'Mouth')
    # The gasp: a round open mouth, parked GASP_HIDE inside the skull until the animator pulls it out.
    gasp = ellipsoid('FaceGasp', (0.006, 0.026, 0.03), segments=10, rings=6)
    gasp.data.transform(Matrix.Translation((0.006, 0, mz - 0.004)))
    _conform(gasp, tree, hc)
    gasp.data.transform(Matrix.Translation((-GASP_HIDE, 0, 0)))
    assign(gasp, m['mouth'])
    skel.attach(gasp)
    bind_rigid(gasp, 'Gasp')


def _ears(skel, b, j, m, role: str) -> None:
    hc = j.head_c
    k = FACE[role].ear
    for s, sfx in ((1, 'L'), (-1, 'R')):
        def cup(p: Vector, side=s) -> Vector:
            # A C-shaped ear: the outward face dished in, a rim left round the edge, the lobe curling under.
            if p.y * side > 0:
                r = math.hypot(p.x / (0.042 * k), p.z / (0.06 * k))
                p.y -= side * 0.014 * k * max(0.0, 1 - r * 1.25)
            if p.z < -0.03 * k:
                p.x += 0.008 * k
            return p
        ear = ellipsoid(f'HeadEar{sfx}', (0.042 * k, 0.02 * k, 0.06 * k), segments=12, rings=8, deform=cup)
        ear.data.transform(Matrix.Rotation(math.radians(s * -14), 4, 'Z'))
        ear.location = (hc.x + 0.004, s * (b.head[1] * 0.97 + 0.012), hc.z - 0.012)
        assign(ear, m['skin'])
        skel.attach(ear)
        bind_rigid(ear, 'Head')


def _hair(skel, b, j, m, role, skull) -> None:
    a, bw, c = b.head

    def wobble(p: Vector) -> float:
        return 0.004 * math.sin(p.y * 80) * math.sin(p.z * 60 + p.x * 40)

    def scalp(p: Vector) -> float:
        # Back and sides below the hat, ending in scalloped clumps at the nape;
        # tapered sideburns come forward in front of the ears.
        az = math.atan2(p.y, p.x)
        hem = -0.36 + 0.1 * abs(math.sin(az * 2.5))
        back = 1 - smoothstep(0.02, 0.45, p.x / a)
        burn = (smoothstep(0.65, 0.9, abs(p.y) / bw) * (1 - smoothstep(0.35, 0.6, p.x / a))
                * smoothstep(-0.45, -0.1, p.z / c))
        band = smoothstep(hem - 0.06, hem + 0.04, p.z / c)
        return max(back * band, burn)

    thick = {'blaster': 0.012, 'driller': 0.012, 'driver': 0.01, 'surveyor': 0.014, 'manager': 0.006}[role]
    hair = _shell('HeadHair', skull, scalp, thick, noise=wobble)
    assign(hair, m['hair'])
    parts = [hair]
    if role == 'driller':
        def beard(p: Vector) -> float:
            jaw = 1 - smoothstep(-0.5, -0.28, p.z / c)
            front = smoothstep(-0.5, -0.05, p.x / a)
            # Keep the mouth clear.
            mouth = smoothstep(0.03, 0.05, abs(p.y)) if p.x > 0 and -0.62 < p.z / c < -0.22 else 1.0
            return jaw * front * max(mouth, 1 - smoothstep(-0.62, -0.5, p.z / c))
        beard_ob = _shell('HeadBeard', skull, beard, 0.026,
                          noise=lambda p: 0.008 * smoothstep(-0.5, -0.95, p.z / c) + 0.003 * math.sin(p.y * 90))
        assign(beard_ob, m['hair'])
        parts.append(beard_ob)
    for ob in parts:
        skel.attach(ob)
        bind_rigid(ob, 'Head')


def _moustache(skel, b, j, m, role, tree) -> None:
    hc = j.head_c
    if role in ('driver', 'driller'):
        # Walrus: thick, drooping over the mouth.
        k = 1.3 if role == 'driver' else 1.1
        pts = [(-0.068 * k, hc.z - 0.092), (-0.034 * k, hc.z - 0.062), (0.0, hc.z - 0.058), (0.034 * k, hc.z - 0.062),
               (0.068 * k, hc.z - 0.092)]
        width = [0.009, 0.022, 0.024, 0.022, 0.009]
        depth = 0.016
    elif role == 'manager':
        # Waxed handlebar: straight out under the nose, then a tight curl up at each tip.
        pts = []
        for side in (-1, 1):
            curl = [(0.118, hc.z - 0.034), (0.124, hc.z - 0.05), (0.112, hc.z - 0.062)]
            run = [(0.085, hc.z - 0.064), (0.045, hc.z - 0.064)]
            seq = curl + run if side == -1 else list(reversed(run)) + list(reversed(curl))
            pts += [(side * y, z) for y, z in seq]
            if side == -1:
                pts.append((0.0, hc.z - 0.058))
        width = [0.005, 0.007, 0.01, 0.014, 0.017, 0.016, 0.017, 0.014, 0.01, 0.007, 0.005]
        depth = 0.012
    else:
        return
    ob = _decal_loft('HeadMoustache', pts, width, depth, segments=6, rings=12).ob
    _conform(ob, tree, hc)
    assign(ob, m['hair'])
    skel.attach(ob)
    bind_rigid(ob, 'Head')


# -------------------------------------------------------------------- hat

def _hat(skel, b, j, m, role) -> None:
    """The role's hard hat: an egg-shaped crown with a raised ridge, a narrow brim, a peak over the eyes."""
    spec = HATS[role]
    mat = m.get('hat', m['tint'])
    k = spec.scale
    dome = HAT_DOME * k
    brim = HAT_BRIM * k
    profile = [
        (0.0, 0.03), (0.15 * k, 0.03), (dome - 0.006, 0.008), (dome + brim * 0.6, 0.0), (dome + brim, 0.006),
        (dome + brim * 0.95, 0.016), (dome + brim * 0.5, 0.022), (dome + 0.003, 0.03), (dome, 0.07 * k),
        (dome * 0.955, 0.118 * k), (dome * 0.86, 0.163 * k), (dome * 0.7, 0.2 * k), (dome * 0.47, 0.226 * k),
        (dome * 0.22, 0.238 * k), (0.0, 0.241 * k),
    ]

    def shape(p: Vector) -> Vector:
        r = math.hypot(p.x, p.y)
        th = math.atan2(p.y, p.x)
        if r > dome + 0.002 and p.z < 0.027:
            # The peak: the brim reaches further at the front, dipping toward the eyes.
            front = max(0.0, math.cos(th)) ** 1.5
            reach = (r - dome) + HAT_PEAK * k * front * smoothstep(dome, dome + brim, r)
            nr = dome + reach
            p.x, p.y = p.x * nr / r, p.y * nr / r
            p.z -= 0.016 * front * smoothstep(dome, dome + brim + HAT_PEAK, nr)
        elif p.z > 0.05 * k and r > 1e-4:
            # The ridge: raised out of the crown along the front-to-back midline.
            ridge = 0.013 * k * math.exp(-(p.y / (0.022 * k)) ** 2) * smoothstep(0.05 * k, 0.12 * k, p.z)
            p.x, p.y = p.x * (r + ridge) / r, p.y * (r + ridge) / r
            p.z += ridge * 0.8 * smoothstep(0.15 * k, 0.24 * k, p.z)
        return p

    hat = lathe('HatShell', profile, segments=32, deform=shape)
    assign(hat, mat)
    # A band round the base of the crown (and the driver's orange tape over the ridge).
    band_mat = material('HatBandGold', 0xE0B040, roughness=0.35, metallic=0.5) if spec.band == 'gold' else m['dark']
    assign_faces(hat, band_mat, lambda i, c: 0.034 < c.z < 0.058 * k and math.hypot(c.x, c.y) < dome + 0.004)
    hat.data.transform(hat_frame(j, role))
    skel.attach(hat)
    bind_rigid(hat, 'Hat')


def build_head(skel: Skeleton, b, j, m, role: str) -> None:
    skull = _skull(b, j, m, role)
    tree = _bvh(skull)
    _eyes(skel, b, j, m, role)
    _brows(skel, b, j, m, role, tree)
    _nose(skel, b, j, m, role, tree)
    _mouth(skel, b, j, m, role, tree)
    _moustache(skel, b, j, m, role, tree)
    _ears(skel, b, j, m, role)
    _hair(skel, b, j, m, role, skull)
    _hat(skel, b, j, m, role)
    skel.attach(skull)
    bind_rigid(skull, 'Head')
