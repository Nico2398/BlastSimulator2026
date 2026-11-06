"""Worker heads — skull, face, hair and hard hat, per role.

The face is where a worker stops being a mannequin, so it carries the most
care per triangle:

* **Skulls differ by role**: the driller's square jaw, the blaster's narrow
  head and pointed chin, the driver's wide flat pan, the surveyor's egg, the
  manager's jowls. Noses differ too, from button to potato.
* **Eyes** are big white bulbs seated in sockets carved into the skull, a
  thin dark iris painted onto the white (it hugs the eyeball) looking a touch
  up toward the game camera, and a highlight kept under the resting lid's
  edge. Face parts are named `Face*` so the runtime leaves them out of the
  outline: lined, every eyeball wears a black ring. Each upper lid is a
  shell of skin on its own bone (`LidL/R`) with a dark lash along its edge:
  its resting angle sets the personality (wide for the blaster, heavy and
  smug for the manager) and is written into the lid bone's direction, so the
  animator knows how far to turn it to shut the eye completely. Its radii
  (`lid_radii`) are sized along its own tipped axes so the eye stays inside
  it, clear of its facets, whatever the angle.
* **Two mouths**: the role's everyday mouth on bone `Mouth`, and a gaping
  "O" on bone `Gasp`, parked inside the skull until panic or a collapse
  swaps them. The driver's smirk works a toothpick, merged into his
  `FaceMouth` on the Mouth bone.
* **Decals** — mouths, brows, moustaches, the blaster's soot smudges
  (`FaceSoot`) — are shaped flat and then *conformed* to the skull by
  ray-casting onto it, so they hug the face instead of floating on or
  sinking into it.
* **Hair and beards** are shells of the skull pushed out where a mask says
  hair grows and pulled under the skin everywhere else; the nape edge is
  scalloped into clumps, and the hair reaches up under the hat (`HAIRLINE`)
  so no bare scalp shows below the brim. The driller wears a full beard,
  the driver a thin chinstrap of stubble.
* **Hard hat** is a lathed crown worn per role — level, askew, perched high
  and tipped back so the brim clears the eyes from the game camera — on its
  own bone (`Hat`) so it can be knocked off. Each role's hat has its own
  silhouette (`Hat.crown`): the driller's standard ridged dome; the
  blaster's dented one, worn askew; the driver's low bump cap with a long
  trucker peak; the surveyor's pith helmet, brimmed all round; the
  manager's bowler with a narrow curled brim and a tall gold band. A badge
  on the crown's front says whose hat it is from above — the driver's
  reflective plate, the surveyor's red-and-white target sticker, the
  manager's gold badge — and a peak's underside is dark.

Coordinates are armature space (Blender Z up, +X the face's front).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from character import Section, Skeleton, _to_object, assign_faces, bind_rigid, ellipsoid, lathe, loft, merge, prune, smoothstep
from common import assign, cylinder, material


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
    'driver': Face(0.7, (-10, -10), 0.072, 0.022, 'smirk', (0.036, 0.056, 0.032)),
    'surveyor': Face(0.8, (-16, -16), 0.074, 0.01, 'nerd', (0.03, 0.026, 0.026), eye=1.25, ear=1.3),
    'manager': Face(0.58, (22, 22), 0.08, 0.012, 'smirk', (0.056, 0.062, 0.046), nose_droop=-14),
}


@dataclass(frozen=True)
class Hat:
    """How each role wears the hard hat, and which hat it is."""
    line: float      # hat base above the skull centre, metres
    tilt: float      # degrees tipped back
    roll: float      # degrees askew (+ toward the left)
    scale: float
    band: str        # 'dark' or 'gold': the band round the crown
    crown: str = 'dome'   # the silhouette — see HAT_PEAK and _hat_profile
    band_top: float = 0.058   # top of the band above the hat's base (before `scale`), metres


# Every hat sits high and tipped back, so from the high game camera the brim
# clears the eyes (the face is what tells the crew apart) — the surveyor's the
# most, his egg forehead showing.
HATS = {
    'driller': Hat(0.126, 13, 0, 0.92, 'dark', 'dome'),        # the standard hard hat, ridge and lamp
    'blaster': Hat(0.142, 17, 13, 0.92, 'dark', 'dented'),     # knocked about and dented, worn askew
    'driver': Hat(0.13, 16, 0, 1.0, 'dark', 'cap'),           # low bump cap, long trucker peak
    'surveyor': Hat(0.15, 15, 0, 0.88, 'dark', 'safari'),      # pith helmet: a wide brim all round
    'manager': Hat(0.146, 16, 0, 0.88, 'gold', 'bowler', 0.088),   # a bowler, gold-banded
}

HAIRLINE = {'driller': (0.016, 0.04), 'blaster': (0.02, 0.045), 'driver': (0.014, 0.04), 'surveyor': (0.0, 0.035),
            'manager': (0.01, 0.035)}
"""How far under the hat's base the hair reaches down, over the forehead and at the sides (metres)."""

EYE_Y = 0.073      # lateral offset of each eye from the midline (for a 0.2 m wide head)
EYE_Z = 0.028      # height of the eyes above the skull centre
EYE_R = (0.052, 0.045, 0.052)   # eye white radii: depth, width, height (depth = height: see lid_radii)
EYE_INSET = 0.66   # how far behind the face the eye's centre sits, as a share of its depth radius
EYE_BACK = 0.3     # the white is kept in front of this share of its depth radius behind its centre
SOCKET_GAP = 0.006   # how far behind the eye white the socket floor sits (m)
SOCKET_RIM = 0.3     # the socket's rim, as a fraction of the eye's radius past its outline
SKULL_SEGMENTS, SKULL_RINGS = 32, 20
SKULL_FRONT_BIAS = (0.35, 0.3)   # skull vertices drawn toward the face (ellipsoid front_bias)
HAT_DOME = 0.184   # crown radius at the brim
BRIM_BAND = 0.015  # how far under the hat's base the hair is still drawn in under the brim (m)
HAT_HAIR_GAP = 0.007   # what the hair keeps inside the hat's shell, so the two never lie on each other (m)
HAT_BRIM = 0.02    # how far the brim reaches past the crown at the sides
HAT_PEAK = {'dome': 0.05, 'dented': 0.035, 'cap': 0.11, 'safari': 0.02, 'bowler': 0.0}
"""How much further than the brim each crown reaches at the front: a peak, the cap's long visor
(the safari brim reaches as far again at the back)."""
HAT_SAFARI_BRIM = 0.05   # the pith helmet's brim, all round past the crown
HAT_DENTS = ((52, 0.17, 0.05, 0.02), (-140, 0.13, 0.035, 0.013))
"""The blaster's crown: (azimuth°, height, radius, depth) of each dent knocked into it."""
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
    return Vector((hc.x + x - eye_radii(role)[0] * EYE_INSET, y, hc.z + z))


def eye_yaw(head, side: int) -> float:
    """Each eye turns out a little, following the curve of the face (radians about Z)."""
    return math.atan2(side * EYE_Y * 1.6, head[0])


def lid_open_angle(role: str) -> float:
    """Elevation (radians) of the lid's front edge when the eye rests open."""
    cut = 2 * FACE[role].lid - 1
    return math.asin(max(-0.95, min(0.95, cut)))


LID_GROW = 1.10   # the lid shell's radius over the eye's: it clears the white by this share, everywhere
LID_SHUT = 1.15
"""How far below the horizontal a shut lid's edge turns (rad) — mirrors WorkerMotion.LID_SHUT, which
turns the lids. The shell reaches far enough back over the eye to still cover it there."""
LID_MARGIN = 0.1  # extra sweep (rad) the shell keeps past what it must cover
LASH_SPAN = 54    # degrees either side of the lid's middle the lash runs along its edge
PAINT_IRIS = (0.0008, 0.0006)    # (lift off the white, thickness) of the painted iris, metres
PAINT_SHINE = (0.0019, 0.0006)   # and of the highlight on it — clear of the iris, under the lash


@lru_cache(maxsize=None)
def lid_radii(role: str, head: tuple[float, float, float]) -> tuple[float, float, float, float]:
    """The upper lid shell's radii along the eye's own axes: (front, side, up, back).

    The eye is as deep as it is tall, so seen from the side it is a circle about its own
    side axis — the axis the runtime turns the lid about (the lid bone carries the yaw). The
    lid is that shape grown by LID_GROW: a surface of revolution about the same axis, so
    however far it turns it slides over itself and keeps the same gap to the white. Nothing
    tucks into the eye and nothing swings out of it: open, blinking, drooping or wide.
    """
    er = eye_radii(role)
    return (er[0] * LID_GROW, er[1] * LID_GROW, er[2] * LID_GROW, er[0] * LID_GROW)


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


def _bvh_many(obs) -> BVHTree:
    """One BVH over several meshes, each in its own placement."""
    bm = bmesh.new()
    for ob in obs:
        part = bmesh.new()
        part.from_mesh(ob.data)
        part.transform(ob.matrix_basis)
        me = bpy.data.meshes.new('_bvh_tmp')
        part.to_mesh(me)
        part.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


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


SHELL_EDGE = (0.3, 0.7)   # the share of a hair mask over which a shell goes from under the skin to out


def _shell(name: str, skull: bpy.types.Object, mask, thick: float, sink: float = 0.012, noise=None,
           clamp=None) -> bpy.types.Object:
    """A copy of the skull pushed out by `thick` where mask(p) is 1 and under the skin where it is 0.

    Faces whose every corner is under the skin can never be seen and are
    dropped; the open border that leaves stays buried inside the skull.
    `clamp(new, skin)` (optional) moves each pushed-out vertex last, given the skull point it
    grew from — the hat squashing the hair.
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
        # Out or under, with the change made over the middle of the mask: where the shell
        # crosses the skin it does so steeply, rather than lying along it over a band — a
        # surface lying on another within a hair's breadth flickers between the two.
        out = smoothstep(SHELL_EDGE[0], SHELL_EDGE[1], k)
        v.co = p + v.normal * (out * (thick + extra) - (1 - out) * sink)
        if clamp:
            v.co = clamp(v.co, p)
    hidden = [f for f in bm.faces if all(ks[v.index] < 0.02 for v in f.verts)]
    bmesh.ops.delete(bm, geom=hidden, context='FACES')
    bm.to_mesh(me)
    bm.free()
    ob.data.shade_smooth()
    return ob


# ------------------------------------------------------------------- eyes

LID_PSI_STEP = math.radians(9)     # the lid shell's sweep is split this finely
LID_RINGS = 12                     # and its width into this many rings, pole to pole


def _lid_shell(name: str, radius: float, half_width: float, psi0: float, psi1: float) -> bpy.types.Object:
    """Part of an ellipsoid of revolution about Y — radius `radius` round Y, `half_width` along it —
    swept from angle `psi0` to `psi1` (from +X toward +Z, about Y), as one open shell facing out.

    The sweep's front edge is a clean column of vertices, so the lash laid along it covers it.
    """
    n = max(2, math.ceil((psi1 - psi0) / LID_PSI_STEP))
    psis = [psi0 + (psi1 - psi0) * i / n for i in range(n + 1)]
    bm = bmesh.new()
    rows = []
    for k in range(1, LID_RINGS):
        th = -math.pi / 2 + math.pi * k / LID_RINGS
        r, y = radius * math.cos(th), half_width * math.sin(th)
        rows.append([bm.verts.new((r * math.cos(p), y, r * math.sin(p))) for p in psis])
    south = bm.verts.new((0.0, -half_width, 0.0))
    north = bm.verts.new((0.0, half_width, 0.0))
    for a, b in zip(rows, rows[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    for i in range(n):
        bm.faces.new((south, rows[0][i + 1], rows[0][i]))
        bm.faces.new((north, rows[-1][i], rows[-1][i + 1]))
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    # Facing out: the middle face's normal points away from the axis.
    mid = bm.faces[len(bm.faces) // 2]
    if mid.normal.dot(mid.calc_center_median()) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return _to_object(name, bm, None)


def _eyes(skel: Skeleton, b, j, m, role: str) -> None:
    er = eye_radii(role)
    open_angle = lid_open_angle(role)
    lash = material('Lash', 0x2A1C18, roughness=0.8)
    for s, sfx in ((1, 'L'), (-1, 'R')):
        ec = eye_center(j, s, b.head, role)
        rot = Matrix.Rotation(eye_yaw(b.head, s), 4, 'Z')
        white = ellipsoid(f'FaceEye{sfx}', er, segments=16, rings=10)
        prune(white, lambda p, rx=er[0]: p.x > -EYE_BACK * rx)   # the back sits inside the skull
        white.data.transform(rot)
        white.location = ec
        assign(white, m['white'])
        def painted(at: tuple[float, float], lift: float, depth: float):
            # Laid onto the white: a vertex's local X is its height above the eye's surface,
            # so the iris and the highlight hug the eyeball instead of standing off it.
            def onto(p: Vector) -> Vector:
                y, z = p.y + at[0], p.z + at[1]
                surf = er[0] * math.sqrt(max(0.0, 1 - (y / er[1]) ** 2 - (z / er[2]) ** 2))
                return Vector((surf + lift + (p.x / depth + 1) * 0.5 * depth, y, z))
            return onto
        # Iris + pupil: a thin dark lens painted onto the white, a touch up toward the camera.
        iris_k = 0.82 if role == 'blaster' else 1.0
        # Painted layers stack in order, each clear of the last, all under the lash's reach:
        # iris PAINT_IRIS above the white, the highlight PAINT_SHINE above that.
        iris = ellipsoid(f'FaceIris{sfx}', (PAINT_IRIS[1], 0.023 * iris_k, 0.027 * iris_k), segments=12, rings=7,
                         deform=painted((-s * 0.002, 0.006), *PAINT_IRIS))
        iris.data.transform(rot)
        iris.location = ec
        assign(iris, m['iris'])
        # The highlight stays under the resting lid's edge (and a lash's width clear of it),
        # whatever the role's lid: above it the lid would cover it, or it would poke through.
        edge = er[2] * math.sin(open_angle)
        shine = ellipsoid(f'FaceShine{sfx}', (PAINT_SHINE[1], 0.0085, 0.0085), segments=8, rings=5,
                          deform=painted((s * 0.008, min(0.018, edge - 0.006 - 0.0085)), *PAINT_SHINE))
        shine.data.transform(rot)
        shine.location = ec
        assign(shine, m['white'])
        for ob in (white, iris, shine):
            skel.attach(ob)
            bind_rigid(ob, 'Head')
        # Upper lid: a shell of revolution about the eye's side axis, LID_GROW clear of the
        # white all round, from its resting edge up over the eye and back far enough that,
        # turned down to LID_SHUT, it still covers the eye's top; the part behind the eye sits
        # in the skull. It never reaches round under the eye, however far it is turned up
        # (WorkerMotion caps that at LID_WIDE).
        lr, ly, _, _ = lid_radii(role, b.head)
        back = min(open_angle + LID_SHUT + math.acos(-EYE_BACK) + LID_MARGIN,
                   2 * math.pi - math.acos(-EYE_BACK) - LID_MARGIN)
        lid = _lid_shell(f'FaceLid{sfx}', lr, ly, open_angle, back)
        # The lash runs along the shell's front rim, just proud of it, and hides the open edge.
        edge = []
        for k in range(9):
            az = math.radians(-LASH_SPAN + 2 * LASH_SPAN * k / 8)
            psi = open_angle - 0.002 / lr
            r = lr * math.cos(az) + 0.0015
            edge.append(Section((r * math.cos(psi), ly * math.sin(az), r * math.sin(psi)), 0.003, 0.0035))
        tangent = (-math.sin(open_angle), 0.0, math.cos(open_angle))
        lash_ob = loft(f'FaceLash{sfx}', edge, segments=4, rings=12, cap_start=0.6, cap_end=0.6, cap_rings=1,
                       front=tangent).ob
        for ob in (lid, lash_ob):
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


def _brow_points(b, j, role: str, s: int) -> list[tuple[float, float]]:
    """(y, z) along one brow, inner end first, before it is laid onto the face."""
    f = FACE[role]
    hc = j.head_c
    wscale = b.head[1] / 0.2
    tilt = math.radians(f.brow_tilt[0 if s == 1 else 1])
    bz = hc.z + EYE_Z + f.brow_h
    inner, outer = 0.024 * wscale, 0.13 * wscale
    pts = []
    for k in range(5):
        t = k / 4
        y = inner + (outer - inner) * t
        pts.append((s * y, bz + math.sin(t * math.pi) * 0.01 + (t - 0.4) * math.tan(tilt) * (outer - inner)))
    return pts


def brow_pivot(b, j, role: str, s: int) -> Vector:
    """Where a brow turns: its outer end, so a worried or wincing brow lifts its inner end
    and never drives the outer one down into the lid or the temple."""
    y, z = _brow_points(b, j, role, s)[-1]
    return Vector((eye_center(j, s, b.head, role).x + 0.03, y, z))


def _brows(skel, b, j, m, role, tree) -> None:
    """Brows laid onto the face — onto the lids where they bulge past the skull, so a brow
    never cuts into a lid (whose surface stays put as it blinks: see lid_radii)."""
    f = FACE[role]
    hc = j.head_c
    for s, sfx in ((1, 'L'), (-1, 'R')):
        th = f.brow_thick
        ob = _decal_loft(f'HeadBrow{sfx}', _brow_points(b, j, role, s), [th * 0.8, th * 1.05, th, th * 0.9, th * 0.6],
                         0.011).ob
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
    if role == 'blaster':
        # A sooty nose tip.
        tip = Matrix.Rotation(math.radians(f.nose_droop), 3, 'Y') @ Vector((1, 0, 0))
        assign_faces(ob, m['soot'], lambda i, c: c.dot(tip) > 0.72 * f.nose[0])
    skel.attach(ob)
    bind_rigid(ob, 'Head')


def _soot(skel, b, j, m, tree) -> None:
    """The blaster's blackened cheeks: ragged smudges laid onto the skull, under the eye sockets."""
    hc = j.head_c
    smudges = []
    for s, sfx in ((1, 'L'), (-1, 'R')):
        def ragged(p: Vector, side=s) -> Vector:
            ang = math.atan2(p.z, p.y)
            k = 1 + 0.22 * math.sin(3 * ang + side) + 0.12 * math.sin(5 * ang + 2 * side)
            return Vector((p.x, p.y * k, p.z * k))
        ob = ellipsoid(f'FaceSoot{sfx}', (0.003, 0.019, 0.017), segments=12, rings=6, deform=ragged)
        prune(ob, lambda p: p.x > 1e-5)
        # Under the socket's rim (it is carved back behind the eye) and clear of the grin's corners.
        ob.data.transform(Matrix.Translation((0.0012, s * 0.09, hc.z - 0.063)))
        _conform(ob, tree, hc)
        assign(ob, m['soot'])
        smudges.append(ob)
    ob = merge('FaceSoot', smudges)
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
    if role == 'driver':
        # A toothpick worked into the raised corner of the smirk, sticking out and down.
        y0 = w * 0.86
        z0 = mz + smile(Vector((0, y0, 0))).z - 0.004   # the corner's own line, just under its top
        hit, normal, _, _ = tree.ray_cast(Vector((hc.x + 1, y0, z0)), Vector((-1, 0, 0)))
        out = (normal.normalized() * 0.55 + Vector((0, 0.75, -0.3))).normalized()
        pick = cylinder('FaceToothpick', 0.0038, 0.07, loc=tuple(hit + out * 0.023), segments=6, radius2=0.0022)
        pick.rotation_mode = 'QUATERNION'
        pick.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(out)
        assign(pick, material('Toothpick', 0xEAD3A2, roughness=0.8))
        parts.append(pick)
    mouth = merge('FaceMouth', parts)
    skel.attach(mouth)
    bind_rigid(mouth, 'Mouth')
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


def _face_top(b, j, role: str) -> tuple[float, float]:
    """(Height above the skull centre of the highest brow or resting lid, and how far out the brows reach.)"""
    f = FACE[role]
    wscale = b.head[1] / 0.2
    inner, outer = 0.024 * wscale, 0.13 * wscale
    brow = max(EYE_Z + f.brow_h + math.sin(t * math.pi) * 0.01 + (t - 0.4) * math.tan(math.radians(tilt)) * (outer - inner)
               for tilt in f.brow_tilt for t in (k / 8 for k in range(9))) + f.brow_thick * 1.05
    _, _, lz, _ = lid_radii(role, b.head)
    lid = EYE_Z + lz   # the lid shell's crown: the eye's ellipsoid grown evenly, so its top is the up radius
    return max(brow, lid), outer


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

    # Up to the hat: everywhere above a hairline a little under the hat's base, so no bare band of
    # scalp shows between the hair and the brim however high the hat sits (and a knocked-off hat
    # leaves a head of hair). The hairline sits lower at the sides than over the forehead.
    frame = hat_frame(j, role)
    up = (frame.to_3x3() @ Vector((0, 0, 1))).normalized()
    base = frame.translation - j.head_c
    fringe_front, fringe_side = HAIRLINE[role]

    # Never down over the face, though: in front the hairline stays above the brows and the lids.
    floor, outer = _face_top(b, j, role)

    def under_hat(p: Vector) -> float:
        depth = fringe_side + (fringe_front - fringe_side) * smoothstep(0.45, 0.85, p.x / a)
        k = smoothstep(-depth - 0.012, -depth, (p - base).dot(up))
        face = smoothstep(0.15, 0.35, p.x / a) * (1 - smoothstep(outer, outer + 0.03, abs(p.y)))
        return k * (1 - face * (1 - smoothstep(floor + 0.008, floor + 0.02, p.z)))

    # The hat squashes the hair: none of it rises out past the crown or over the brim.
    to_hat = frame.inverted() @ Matrix.Translation(j.head_c)
    from_hat = to_hat.inverted()
    dome = HAT_DOME * HATS[role].scale
    rim = _brim_reach(HATS[role].crown, HATS[role].scale)

    def squash(p: Vector, skin: Vector) -> Vector:
        q = to_hat @ p
        r = math.hypot(q.x, q.y)
        if q.z <= -BRIM_BAND or r < 1e-6:
            return p
        if q.z <= 0.0:
            # Just under the hat's base the hair is drawn in under the brim's underside, so the
            # two never cross; below that band it is free again.
            r_cap = dome + 0.6 * rim - HAT_HAIR_GAP
            if r <= r_cap:
                return p
            s = to_hat @ skin
            r_new = max(r + (r_cap - r) * smoothstep(-BRIM_BAND, 0.0, q.z), math.hypot(s.x, s.y) + 0.002)
            q.x, q.y = q.x * r_new / r, q.y * r_new / r
            return from_hat @ q
        over = smoothstep(0.004, 0.02, q.z)
        # Inside the crown, or under the brim; never pressed under the skin (where the head is
        # wider than the hat's rim, the hair stays a whisker over it rather than leave it bald).
        s = to_hat @ skin
        r_max = max(dome + (rim - 0.006) * (1 - over) - HAT_HAIR_GAP * over, math.hypot(s.x, s.y) + 0.002)
        if r <= r_max:
            return p
        q.x, q.y = q.x * r_max / r, q.y * r_max / r
        return from_hat @ q

    thick = {'blaster': 0.012, 'driller': 0.012, 'driver': 0.01, 'surveyor': 0.014, 'manager': 0.006}[role]
    hair = _shell('HeadHair', skull, lambda p: max(scalp(p), under_hat(p)), thick, noise=wobble, clamp=squash)
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
    elif role == 'driver':
        def chinstrap(p: Vector) -> float:
            # A thin strap of stubble along the jaw, ear to ear under the chin, meeting the
            # sideburns at the sides and passing under the mouth at the front.
            line = -0.42 - 0.26 * smoothstep(0.3, 0.75, p.x / a)
            return (1 - smoothstep(line - 0.05, line + 0.03, p.z / c)) * smoothstep(-0.35, -0.1, p.x / a)
        strap = _shell('HeadBeard', skull, chinstrap, 0.005, noise=lambda p: 0.0015 * math.sin(p.y * 120 + p.z * 70))
        assign(strap, m['hair'])
        parts.append(strap)
    for ob in parts:
        skel.attach(ob)
        bind_rigid(ob, 'Head')


def _moustache(skel, b, j, m, role, tree) -> None:
    hc = j.head_c
    if role == 'driller':
        # Walrus: thick, drooping over the mouth.
        k = 1.1
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

def _hat_profile(crown: str, k: float) -> list[tuple[float, float]]:
    """A crown's lathe profile [(radius, z), …]: the underside, the brim, then up the crown to its pole."""
    dome, brim = HAT_DOME * k, HAT_BRIM * k
    under = [(0.0, 0.03), (0.15 * k, 0.03), (dome - 0.006, 0.008)]
    if crown == 'cap':
        # Hardly a brim at all: the visor is pulled out of this thin rim at the front.
        rim = [(dome + 0.004, 0.004), (dome + 0.008, 0.009), (dome + 0.006, 0.014), (dome + 0.002, 0.02)]
    elif crown == 'safari':
        wb = HAT_SAFARI_BRIM * k
        rim = [(dome + wb * 0.5, -0.006), (dome + wb, -0.02), (dome + wb + 0.003, -0.013), (dome + wb * 0.95, -0.007),
               (dome + wb * 0.5, 0.007), (dome + 0.003, 0.022)]
    elif crown == 'bowler':
        rim = [(dome + brim * 0.6, 0.0), (dome + brim, 0.008), (dome + brim * 0.9, 0.018), (dome + brim * 0.45, 0.02),
               (dome + 0.003, 0.026)]
    else:
        rim = [(dome + brim * 0.6, 0.0), (dome + brim, 0.006), (dome + brim * 0.95, 0.016), (dome + brim * 0.5, 0.022),
               (dome + 0.003, 0.03)]
    # The crown, as (fraction of the dome radius, height before `scale`).
    if crown == 'cap':
        top = [(1.0, 0.045), (0.965, 0.08), (0.87, 0.115), (0.7, 0.142), (0.45, 0.158), (0.22, 0.165), (0.0, 0.167)]
    elif crown == 'bowler':
        top = [(1.0, 0.06), (0.995, 0.08), (0.985, 0.105), (0.95, 0.142), (0.87, 0.178), (0.72, 0.21), (0.5, 0.232),
               (0.25, 0.243), (0.0, 0.246)]
    elif crown == 'dented':
        # The dome with extra rings, so the dents have faces to land on.
        top = [(1.0, 0.07), (0.98, 0.095), (0.955, 0.118), (0.912, 0.141), (0.86, 0.163), (0.79, 0.183), (0.7, 0.2),
               (0.59, 0.214), (0.47, 0.226), (0.22, 0.238), (0.0, 0.241)]
    else:
        top = [(1.0, 0.07), (0.955, 0.118), (0.86, 0.163), (0.7, 0.2), (0.47, 0.226), (0.22, 0.238), (0.0, 0.241)]
    return under + rim + [(dome * r, z * k) for r, z in top]


def _brim_reach(crown: str, k: float) -> float:
    """How far past the crown the profile's own brim reaches, before any peak is pulled out of it."""
    return {'cap': 0.008, 'safari': HAT_SAFARI_BRIM * k}.get(crown, HAT_BRIM * k)


def _hat_shape(crown: str, k: float):
    """The per-vertex deform that turns a revolved profile into the role's hat (hat-local, Z up, +X front)."""
    dome = HAT_DOME * k
    rim = _brim_reach(crown, k)
    peak = HAT_PEAK[crown] * k
    dip = {'cap': 0.022, 'dome': 0.016, 'dented': 0.016}.get(crown, 0.0)

    def shape(p: Vector) -> Vector:
        r = math.hypot(p.x, p.y)
        th = math.atan2(p.y, p.x)
        if r > dome + 0.002 and p.z < 0.027:
            # The brim: pulled out into a peak at the front (the visor of the cap, and the
            # safari brim front and back too), dipping toward the eyes.
            front = abs(math.cos(th)) ** 2 if crown == 'safari' else max(0.0, math.cos(th)) ** (1.0 if crown == 'cap' else 1.5)
            out = smoothstep(dome, dome + rim, r)
            nr = r + peak * front * out
            p.x, p.y = p.x * nr / r, p.y * nr / r
            p.z -= dip * front * smoothstep(dome, dome + rim + peak, nr)
            if crown == 'bowler':
                p.z += 0.014 * math.sin(th) ** 2 * out     # the narrow brim curls up at the sides
        elif p.z > 0.05 * k and r > 1e-4:
            nr = r
            if crown in ('dome', 'dented'):
                # The ridge: raised out of the crown along the front-to-back midline.
                ridge = 0.013 * k * math.exp(-(p.y / (0.022 * k)) ** 2) * smoothstep(0.05 * k, 0.12 * k, p.z)
                nr += ridge
                p.z += ridge * 0.8 * smoothstep(0.15 * k, 0.24 * k, p.z)
            if crown == 'dented':
                for az, zd, rd, depth in HAT_DENTS:
                    dth = (th - math.radians(az) + math.pi) % (2 * math.pi) - math.pi
                    d2 = (dth * r) ** 2 + (p.z - zd * k) ** 2
                    nr -= depth * k * math.exp(-d2 / (rd * k) ** 2)
            p.x, p.y = p.x * nr / r, p.y * nr / r
        return p
    return shape


def _hat_marker(spec: Hat, m, tree: BVHTree) -> bpy.types.Object | None:
    """The badge on the front of the crown that says whose hat it is, from above (hat-local, on the crown)."""
    crown, k = spec.crown, spec.scale
    if crown == 'cap':
        # A reflective plate: a flat rounded slab, bent round the crown.
        zc = 0.098 * k
        ob = loft('HatMarker', [Section((0.003, y, zc), 0.019, 0.003, 4.0) for y in (-0.034, -0.012, 0.012, 0.034)],
                  segments=8, rings=6, cap_start=0.6, cap_end=0.6, cap_rings=2, front=(1, 0, 0)).ob
        assign(ob, m['stripe'])
    elif crown in ('safari', 'bowler'):
        # A round disc, its pole out of the crown so its latitude rings are concentric.
        radius = 0.026 if crown == 'safari' else 0.019
        ob = ellipsoid('HatMarker', (radius, radius, 0.004), segments=16, rings=10)
        prune(ob, lambda p: p.z > 1e-5)
        if crown == 'safari':
            # A red-and-white target sticker: red bull's-eye, white, red, white rim.
            red = material('StaffRed', 0xD8322B, roughness=0.6)
            white = material('StaffWhite', 0xF4F1EA, roughness=0.6)
            assign(ob, white)
            assign_faces(ob, red, lambda i, c: math.hypot(c.x, c.y) < 0.31 * radius or
                         0.59 * radius < math.hypot(c.x, c.y) < 0.8 * radius)
            zc = 0.1 * k
        else:
            assign(ob, material('HatBandGold', 0xE0B040, roughness=0.35, metallic=0.5))
            zc = spec.band_top * k + 0.023
        ob.data.transform(Matrix.Translation((0.0008, 0, zc)) @ Matrix.Rotation(math.radians(90), 4, 'Y'))
    else:
        return None
    _conform(ob, tree, Vector((0, 0, 0)))
    return ob


def _hat(skel, b, j, m, role) -> None:
    """The role's hard hat: a lathed crown with its own silhouette per role, a band, a brim, a badge."""
    spec = HATS[role]
    crown = spec.crown
    mat = m.get('hat', m['tint'])
    k = spec.scale
    dome = HAT_DOME * k
    hat = lathe('HatShell', _hat_profile(crown, k), segments=32, deform=_hat_shape(crown, k))
    assign(hat, mat)
    band_mat = material('HatBandGold', 0xE0B040, roughness=0.35, metallic=0.5) if spec.band == 'gold' else m['dark']
    if crown != 'cap':
        assign_faces(hat, band_mat, lambda i, c: 0.034 < c.z < spec.band_top * k and math.hypot(c.x, c.y) < dome + 0.004)
    if HAT_PEAK[crown] > 0:
        # The peak's underside in the dark band colour, so from the front the peak reads as a peak.
        polys = hat.data.polygons
        assign_faces(hat, m['dark'], lambda i, c: polys[i].normal.z < -0.3 and math.hypot(c.x, c.y) > dome + 0.004 and
                     c.x > 0.35 * math.hypot(c.x, c.y))
    marker = _hat_marker(spec, m, _bvh(hat))
    parts = [hat] + ([marker] if marker else [])
    for ob in parts:
        ob.data.transform(hat_frame(j, role))
    hat = merge('HatShell', parts)
    skel.attach(hat)
    bind_rigid(hat, 'Hat')


def build_head(skel: Skeleton, b, j, m, role: str) -> None:
    skull = _skull(b, j, m, role)
    tree = _bvh(skull)
    _eyes(skel, b, j, m, role)
    _brows(skel, b, j, m, role, _bvh_many([skull, bpy.data.objects['FaceLidL'], bpy.data.objects['FaceLidR']]))
    _nose(skel, b, j, m, role, tree)
    _mouth(skel, b, j, m, role, tree)
    _moustache(skel, b, j, m, role, tree)
    if role == 'blaster':
        _soot(skel, b, j, m, tree)
    _ears(skel, b, j, m, role)
    _hair(skel, b, j, m, role, skull)
    _hat(skel, b, j, m, role)
    skel.attach(skull)
    bind_rigid(skull, 'Head')
