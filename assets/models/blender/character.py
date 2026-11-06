"""Organic modelling, rigging and animation baking for skinned characters.

The worker crew is the one family that deforms: one continuous body on a
skeleton, not rigid parts swinging on pivots. This module holds the three
tools that makes possible, kept apart from the crew's art direction in
workers.py:

* **Surfaces.** `loft()` sweeps a smoothly interpolated chain of elliptical
  (or superelliptical) sections into one closed, round-capped tube — a torso,
  a limb, a boot. `lathe()` revolves a profile — a hard hat, a mug. A loft
  reports every vertex's position *along* the shape and every face's ring
  and column, which is what lets materials change on a clean edge loop
  (sleeve to forearm) or down a clean column (a vest's stripe) and skin
  weights blend smoothly across a joint. `merge()` joins the parts that ride
  together into one object: each exported mesh costs a node and an accessor
  per attribute, hundreds of bytes before its first vertex.
* **Rig.** `Skeleton` declares bones by head/tail in armature space;
  `bind_*` writes vertex groups — rigid for accessories, blended along a
  chain for the body — and every part gets an Armature modifier.
* **Motion.** `Poser` is a forward-kinematics evaluator over the rest pose
  plus analytic two-bone IK and world-orientation solves, so a clip can plant
  feet on the ground and keep a tool upright while the body moves.
  `bake_clip()` samples a pose function every frame into a linear-keyed
  action on its own NLA track; the glTF exporter writes one animation per
  action.

Axes as everywhere: Blender Z up, +X the character's front, +Y its left.
Angles handed to the Poser are degrees about *armature* axes, applied in the
parent's posed frame — `{'ThighL': (0, -30, 0)}` swings the left thigh 30°
forward whatever its bone roll.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Iterable, Sequence

import bpy  # noqa: F401 — must precede bmesh
import bmesh
from mathutils import Euler, Matrix, Quaternion, Vector

from common import link

FPS = 24
"""Frame rate clips are sampled at; three interpolates between samples."""


# ============================================================ surfaces ===

@dataclass
class Section:
    """One cross-section of a loft: centre, half-width (side axis), half-depth (front axis).

    `p` is the superellipse exponent: 2 is an ellipse, higher squares it off.
    """
    c: tuple[float, float, float]
    w: float
    d: float
    p: float = 2.0


def _catmull(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def _interp_sections(sections: Sequence[Section], rings: int) -> list[Section]:
    """Resample `sections` into `rings` sections evenly spaced by arc length on a Catmull-Rom spline."""
    n = len(sections)
    if n < 2:
        raise ValueError('a loft needs at least two sections')
    ext = [sections[0]] + list(sections) + [sections[-1]]

    def at(seg: int, t: float) -> Section:
        a, b, c, d = ext[seg], ext[seg + 1], ext[seg + 2], ext[seg + 3]
        return Section(
            tuple(_catmull(a.c[i], b.c[i], c.c[i], d.c[i], t) for i in range(3)),
            max(1e-4, _catmull(a.w, b.w, c.w, d.w, t)),
            max(1e-4, _catmull(a.d, b.d, c.d, d.d, t)),
            _catmull(a.p, b.p, c.p, d.p, t),
        )

    # Dense samples, then pick by cumulative length.
    dense: list[Section] = []
    steps = 24
    for seg in range(n - 1):
        for k in range(steps):
            dense.append(at(seg, k / steps))
    dense.append(sections[-1])
    lengths = [0.0]
    for i in range(1, len(dense)):
        lengths.append(lengths[-1] + (Vector(dense[i].c) - Vector(dense[i - 1].c)).length)
    total = lengths[-1] or 1.0
    out: list[Section] = []
    j = 0
    for r in range(rings):
        target = total * r / (rings - 1)
        while j < len(lengths) - 2 and lengths[j + 1] < target:
            j += 1
        span = lengths[j + 1] - lengths[j] or 1.0
        f = min(1.0, max(0.0, (target - lengths[j]) / span))
        a, b = dense[j], dense[j + 1]
        out.append(Section(
            tuple(a.c[i] + (b.c[i] - a.c[i]) * f for i in range(3)),
            a.w + (b.w - a.w) * f, a.d + (b.d - a.d) * f, a.p + (b.p - a.p) * f,
        ))
    return out


def _frame(tangent: Vector, front_hint: Vector) -> tuple[Vector, Vector]:
    """(side, front) unit axes perpendicular to `tangent`, front as close to `front_hint` as possible."""
    f = front_hint - tangent * front_hint.dot(tangent)
    if f.length < 1e-4:
        alt = Vector((0, 0, 1)) if abs(tangent.z) < 0.9 else Vector((1, 0, 0))
        f = alt - tangent * alt.dot(tangent)
    f.normalize()
    s = tangent.cross(f).normalized()
    return s, f


def _superellipse(theta: float, p: float) -> tuple[float, float]:
    c, s = math.cos(theta), math.sin(theta)
    e = 2.0 / p
    return (math.copysign(abs(c) ** e, c), math.copysign(abs(s) ** e, s))


@dataclass
class Loft:
    """A lofted part and where each vertex sits along it (0 at the first section, 1 at the last)."""
    ob: bpy.types.Object
    u: list[float]
    """Per-vertex position along the loft, normalised 0..1 (cap vertices clamp to the end they close)."""
    face_u: list[float]
    centers: list[Vector]
    """Centre of every ring, first to last."""
    face_ring: list[int]
    """Per face, the ring its band starts at (caps report their end ring) — colour by ring for clean edge loops."""
    face_seg: list[int]
    """Per face, the column (segment) it sits in round the loft; column k spans 360°·k/segments onward
    from the side axis toward the front — colour by column for clean lengthwise stripes."""

    def ring_z(self, face: int) -> float:
        """Height of the ring a face's band starts at: a material boundary by this value runs along an edge loop."""
        return self.centers[self.face_ring[face]].z


def loft(name: str, sections: Sequence[Section], segments: int = 16, rings: int = 16,
         cap_start: float = 1.0, cap_end: float = 1.0, cap_rings: int = 4,
         front: tuple[float, float, float] = (1, 0, 0), col: bpy.types.Collection | None = None) -> Loft:
    """Sweep `sections` into one closed tube with rounded caps.

    `cap_start` / `cap_end` scale how far each dome bulges past its end
    section (0 = flat cap, 1 = a hemisphere of the end's smaller radius).
    """
    secs = _interp_sections(sections, rings)
    hint = Vector(front)
    bm = bmesh.new()
    ring_verts: list[list[bmesh.types.BMVert]] = []
    us: list[float] = []

    def ring(center: Vector, side: Vector, fwd: Vector, w: float, d: float, p: float, u: float) -> list:
        vs = []
        for k in range(segments):
            th = 2 * math.pi * k / segments
            a, b = _superellipse(th, p)
            vs.append(bm.verts.new(center + side * (a * w) + fwd * (b * d)))
            us.append(u)
        return vs

    tangents: list[Vector] = []
    for i, s in enumerate(secs):
        prev = Vector(secs[max(0, i - 1)].c)
        nxt = Vector(secs[min(len(secs) - 1, i + 1)].c)
        t = (nxt - prev)
        tangents.append(t.normalized() if t.length > 1e-6 else Vector((0, 0, 1)))

    # Each ring's depth axis is the `front` hint projected off the tangent, so
    # every section faces the same way and the tube cannot twist — as long as
    # the path never turns into the hint itself (a boot lofted along X takes
    # an upward hint).
    frames = [_frame(t, hint) for t in tangents]

    n = len(secs)
    for i, s in enumerate(secs):
        sd, fw = frames[i]
        ring_verts.append(ring(Vector(s.c), sd, fw, s.w, s.d, s.p, i / (n - 1)))

    def cap(at_start: bool, bulge: float) -> None:
        idx = 0 if at_start else n - 1
        s = secs[idx]
        sd, fw = frames[idx]
        t = tangents[idx] * (-1 if at_start else 1)
        base = Vector(s.c)
        r = min(s.w, s.d) * bulge
        prev = ring_verts[idx]
        u = 0.0 if at_start else 1.0
        for k in range(1, cap_rings):
            phi = (math.pi / 2) * k / cap_rings
            sc = math.cos(phi)
            cur = ring(base + t * (r * math.sin(phi)), sd, fw, s.w * sc, s.d * sc, s.p, u)
            _bridge(bm, prev, cur, flip=at_start)
            prev = cur
        pole = bm.verts.new(base + t * r)
        us.append(u)
        for k in range(segments):
            a, b = prev[k], prev[(k + 1) % segments]
            try:
                bm.faces.new((b, a, pole) if at_start else (a, b, pole))
            except ValueError:
                pass

    for i in range(n - 1):
        _bridge(bm, ring_verts[i], ring_verts[i + 1], flip=False)
    cap(True, cap_start)
    cap(False, cap_end)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.verts.index_update()
    bm.faces.index_update()
    ring_of, seg_of = {}, {}
    for i, rv in enumerate(ring_verts):
        for k, v in enumerate(rv):
            ring_of[v.index] = i
            seg_of[v.index] = k
    face_u, face_ring, face_seg = [], [], []
    for f in bm.faces:
        face_u.append(sum(us[v.index] for v in f.verts) / len(f.verts))
        rings = [ring_of[v.index] for v in f.verts if v.index in ring_of]
        face_ring.append(min(rings) if rings else (0 if face_u[-1] < 0.5 else n - 1))
        segs = {seg_of[v.index] for v in f.verts if v.index in seg_of}
        face_seg.append(segments - 1 if {0, segments - 1} <= segs else min(segs, default=0))
    centers = [Vector(sec.c) for sec in secs]
    ob = _to_object(name, bm, col)
    return Loft(ob, us, face_u, centers, face_ring, face_seg)


def _bridge(bm: bmesh.types.BMesh, a: list, b: list, flip: bool) -> None:
    n = len(a)
    for k in range(n):
        quad = (a[k], a[(k + 1) % n], b[(k + 1) % n], b[k])
        try:
            bm.faces.new(tuple(reversed(quad)) if flip else quad)
        except ValueError:
            pass


def _to_object(name: str, bm: bmesh.types.BMesh, col) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob, col)
    me.shade_smooth()
    return ob


def lathe(name: str, profile: Sequence[tuple[float, float]], segments: int = 32,
          loc: tuple[float, float, float] = (0, 0, 0),
          deform: Callable[[Vector], Vector] | None = None,
          col: bpy.types.Collection | None = None) -> bpy.types.Object:
    """Revolve `profile` [(radius, z), …] about Z. A radius of 0 closes the end with a pole.

    `deform` (optional) maps each local vertex afterwards — a hat's peak pushed
    forward, a mug squashed.
    """
    bm = bmesh.new()
    rows: list[list[bmesh.types.BMVert] | bmesh.types.BMVert] = []
    for r, z in profile:
        if r <= 1e-6:
            rows.append(bm.verts.new((0, 0, z)))
        else:
            rows.append([bm.verts.new((r * math.cos(2 * math.pi * k / segments), r * math.sin(2 * math.pi * k / segments), z))
                         for k in range(segments)])
    for i in range(len(rows) - 1):
        a, b = rows[i], rows[i + 1]
        for k in range(segments):
            k2 = (k + 1) % segments
            try:
                if isinstance(a, list) and isinstance(b, list):
                    bm.faces.new((a[k], a[k2], b[k2], b[k]))
                elif isinstance(a, list):
                    bm.faces.new((a[k], a[k2], b))
                elif isinstance(b, list):
                    bm.faces.new((a, b[k2], b[k]))
            except ValueError:
                pass
    if deform:
        for v in bm.verts:
            v.co = deform(v.co.copy())
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _to_object(name, bm, col)
    ob.location = Vector(loc)
    return ob


def ellipsoid(name: str, radii: tuple[float, float, float], loc=(0, 0, 0), segments: int = 24, rings: int = 12,
              deform: Callable[[Vector], Vector] | None = None, col=None,
              front_bias: tuple[float, float] = (0.0, 0.0)) -> bpy.types.Object:
    """UV ellipsoid, optionally reshaped vertex by vertex (local coordinates, before `loc`).

    `front_bias` (longitude, latitude), each in [0, 1), moves the same vertices
    toward the +X front and the equator — a face gets the resolution the back of
    a head under hair and a hat does not need. At (a, b), segments near the front
    are 1 − a times as wide and near the back 1 + a; rings likewise by b.
    """
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    lon_bias, lat_bias = front_bias
    for v in bm.verts:
        u = v.co
        if lon_bias or lat_bias:
            lon = math.atan2(u.y, u.x)
            lat = math.asin(max(-1.0, min(1.0, u.z)))
            lon -= lon_bias * math.sin(lon)
            lat -= 0.5 * lat_bias * math.sin(2 * lat)
            u = Vector((math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)))
        p = Vector((u.x * radii[0], u.y * radii[1], u.z * radii[2]))
        v.co = deform(p) if deform else p
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _to_object(name, bm, col)
    ob.location = Vector(loc)
    return ob


def prune(ob: bpy.types.Object, keep: Callable[[Vector], bool]) -> bpy.types.Object:
    """Delete the faces none of whose corners pass `keep` (mesh-local coordinates).

    For surfaces partly buried inside another — the back of an eyeball in the
    skull — whose hidden side costs triangles and nothing else.
    """
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    gone = [f for f in bm.faces if not any(keep(v.co) for v in f.verts)]
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def bake_transform(ob: bpy.types.Object) -> bpy.types.Object:
    """Fold location, rotation and scale into the mesh so the object sits at the armature origin.

    A skinned part must carry its shape in mesh space: the skin binds to
    vertex positions, and a part left with its own transform would be
    re-offset by it once parented to the armature.
    """
    ob.data.transform(ob.matrix_basis)
    ob.location = (0, 0, 0)
    ob.rotation_mode = 'XYZ'
    ob.rotation_quaternion = (1, 0, 0, 0)
    ob.rotation_euler = Euler((0, 0, 0))
    ob.scale = (1, 1, 1)
    return ob


def merge(name: str, parts: Sequence[bpy.types.Object]) -> bpy.types.Object:
    """Join `parts` into one object called `name`: modifiers and transforms applied, materials kept.

    For parts that ride one bone (or one weight function) together — a tool's
    pieces, a bundle of dynamite, a puff of hair. In the export every mesh costs
    a node, a mesh and an accessor per attribute and material, hundreds of bytes
    of JSON before its first vertex; the renderer merges by material anyway, so
    one object per group is the same picture for a fraction of the file. Call it
    after the parts are placed (`to_hand`, a hat frame) and before they are
    attached to the skeleton. Never mix `Face*` parts with outlined ones: the
    name decides whether the merged object is drawn with the outline.
    """
    parts = list(parts)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in parts:
        if ob.modifiers:
            baked = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
            old = ob.data
            ob.modifiers.clear()
            ob.data = baked
            bpy.data.meshes.remove(old)
        bake_transform(ob)
    first = parts[0]
    if len(parts) > 1:
        with bpy.context.temp_override(active_object=first, object=first, selected_objects=parts,
                                       selected_editable_objects=parts):
            bpy.ops.object.join()
    first.name = name
    first.data.name = name
    return first


def assign_faces(ob: bpy.types.Object, mat: bpy.types.Material, predicate: Callable[[int, Vector], bool]) -> None:
    """Assign `mat` to faces for which `predicate(face_index, local_centre)` holds."""
    mats = ob.data.materials
    idx = next((i for i, m in enumerate(mats) if m == mat), None)
    if idx is None:
        mats.append(mat)
        idx = len(mats) - 1
    for p in ob.data.polygons:
        if predicate(p.index, p.center):
            p.material_index = idx


# ================================================================= rig ===

@dataclass
class BoneSpec:
    name: str
    head: tuple[float, float, float]
    tail: tuple[float, float, float]
    parent: str | None = None


class Skeleton:
    """An armature built from `BoneSpec`s, plus the rest data the Poser evaluates."""

    def __init__(self, name: str, specs: Sequence[BoneSpec]):
        data = bpy.data.armatures.new(name)
        ob = bpy.data.objects.new(name, data)
        link(ob)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.mode_set(mode='EDIT')
        for s in specs:
            eb = data.edit_bones.new(s.name)
            eb.head = Vector(s.head)
            eb.tail = Vector(s.tail)
            eb.roll = 0.0
            eb.use_deform = True
            if s.parent:
                eb.parent = data.edit_bones[s.parent]
                eb.use_connect = False
        bpy.ops.object.mode_set(mode='OBJECT')
        self.ob = ob
        self.specs = {s.name: s for s in specs}
        self.order = [s.name for s in specs]
        self.rest: dict[str, Matrix] = {b.name: b.matrix_local.copy() for b in data.bones}
        self.parent = {s.name: s.parent for s in specs}
        for pb in ob.pose.bones:
            pb.rotation_mode = 'QUATERNION'

    def head(self, name: str) -> Vector:
        return Vector(self.specs[name].head)

    def length(self, name: str) -> float:
        s = self.specs[name]
        return (Vector(s.tail) - Vector(s.head)).length

    def attach(self, ob: bpy.types.Object) -> None:
        """Parent a part to the armature with an Armature modifier (its vertex groups pick the bones)."""
        bake_transform(ob)
        ob.parent = self.ob
        ob.matrix_parent_inverse = Matrix.Identity(4)
        m = ob.modifiers.new('Armature', 'ARMATURE')
        m.object = self.ob


def bind_rigid(ob: bpy.types.Object, bone: str) -> None:
    """Every vertex follows `bone` alone — a hat, a tool, an eye."""
    vg = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')


def smoothstep(e0: float, e1: float, x: float) -> float:
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def bind_chain(ob: bpy.types.Object, u: Sequence[float], chain: Sequence[tuple[float, str]], blend: float = 0.06) -> None:
    """Blend weights along a loft: `chain` is [(u_start, bone), …] in order.

    Each bone owns the stretch from its `u_start` to the next one's; across
    every boundary the weight crossfades with a smoothstep `blend` wide on
    each side, so an elbow or a knee bends as one soft surface.
    """
    groups = {}
    for _, bone in chain:
        groups[bone] = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
    per_vertex: list[dict[str, float]] = []
    for uu in u:
        w = {chain[0][1]: 1.0}
        for i in range(1, len(chain)):
            b_u, bone = chain[i]
            t = smoothstep(b_u - blend, b_u + blend, uu)
            if t <= 0:
                break
            prev = dict(w)
            w = {k: v * (1 - t) for k, v in prev.items()}
            w[bone] = w.get(bone, 0.0) + t
        per_vertex.append(w)
    for vi, w in enumerate(per_vertex):
        for bone, val in w.items():
            if val > 1e-4:
                groups[bone].add([vi], val, 'REPLACE')


def bind_by(ob: bpy.types.Object, fn: Callable[[Vector], dict[str, float]]) -> None:
    """Weights from a function of each vertex's (armature-space) position."""
    groups: dict[str, bpy.types.VertexGroup] = {}
    for v in ob.data.vertices:
        w = fn(v.co.copy())
        total = sum(w.values()) or 1.0
        for bone, val in w.items():
            if val / total <= 1e-4:
                continue
            g = groups.get(bone)
            if g is None:
                g = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
                groups[bone] = g
            g.add([v.index], val / total, 'REPLACE')


# ============================================================== motion ===

def _q_axis(axis: Vector, deg: float) -> Quaternion:
    return Quaternion(axis, math.radians(deg))


def euler_q(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> Quaternion:
    """Rotation of x°, y°, z° about the armature's X, Y, Z (applied X, then Y, then Z)."""
    return Euler((math.radians(x), math.radians(y), math.radians(z)), 'XYZ').to_quaternion()


class Poser:
    """Forward kinematics over a Skeleton's rest pose, with IK and orientation solves.

    A pose is built bone by bone in hierarchy order: set a bone's rotation
    (`rot`), or solve it (`ik2`, `orient`), and every descendant evaluated
    afterwards sits in the posed frame. `local()` hands the result to
    `bake_clip()`.
    """

    def __init__(self, skel: Skeleton):
        self.skel = skel
        self.q: dict[str, Quaternion] = {b: Quaternion() for b in skel.order}
        self.loc: dict[str, Vector] = {b: Vector() for b in skel.order}
        self._posed: dict[str, Matrix] = {}

    # -- evaluation --------------------------------------------------------
    def _rel(self, b: str) -> Matrix:
        p = self.skel.parent[b]
        rest = self.skel.rest[b]
        return rest if p is None else self.skel.rest[p].inverted() @ rest

    def _parent_frame(self, b: str) -> Matrix:
        p = self.skel.parent[b]
        base = Matrix.Identity(4) if p is None else self.posed(p)
        return base @ self._rel(b)

    def posed(self, b: str) -> Matrix:
        if b not in self._posed:
            m = self._parent_frame(b) @ Matrix.Translation(self.loc[b]) @ self.q[b].to_matrix().to_4x4()
            self._posed[b] = m
        return self._posed[b]

    def _dirty(self, b: str) -> None:
        stack = [b]
        while stack:
            x = stack.pop()
            self._posed.pop(x, None)
            stack += [c for c, p in self.skel.parent.items() if p == x]

    def pos(self, b: str) -> Vector:
        """Posed head of `b` in armature space."""
        return self.posed(b).translation.copy()

    def tail(self, b: str) -> Vector:
        return (self.posed(b) @ Vector((0, self.skel.length(b), 0, 1))).to_3d()

    def point(self, b: str, rest_point: Vector) -> Vector:
        """Where a point given in rest armature space, carried by `b`, ends up posed."""
        local = self.skel.rest[b].inverted() @ rest_point
        return self.posed(b) @ local

    # -- setting -------------------------------------------------------------
    def rot(self, b: str, x: float = 0.0, y: float = 0.0, z: float = 0.0) -> 'Poser':
        """Rotate `b` by armature-axis degrees relative to its parent's posed frame."""
        rest_q = self.skel.rest[b].to_quaternion()
        self.q[b] = rest_q.inverted() @ euler_q(x, y, z) @ rest_q
        self._dirty(b)
        return self

    def rot_q(self, b: str, q_arm: Quaternion) -> 'Poser':
        rest_q = self.skel.rest[b].to_quaternion()
        self.q[b] = rest_q.inverted() @ q_arm @ rest_q
        self._dirty(b)
        return self

    def move(self, b: str, x: float = 0.0, y: float = 0.0, z: float = 0.0) -> 'Poser':
        """Translate `b` (the root) by an armature-space offset from its rest head."""
        rest_rot = self.skel.rest[b].to_3x3()
        self.loc[b] = rest_rot.inverted() @ Vector((x, y, z))
        self._dirty(b)
        return self

    def orient(self, b: str, q_abs: Quaternion) -> 'Poser':
        """Give `b` the absolute armature-space rotation `q_abs` (relative to its rest), whatever its parents do."""
        parent_rot = self._parent_frame(b).to_quaternion()
        rest_q = self.skel.rest[b].to_quaternion()
        self.q[b] = parent_rot.inverted() @ q_abs @ rest_q
        self._dirty(b)
        return self

    def ik2(self, upper: str, lower: str, target: Vector, pole: Vector, hinge_rest: Vector) -> 'Poser':
        """Two-bone IK: put `lower`'s tail on `target`, bending toward `pole`.

        `hinge_rest` is the joint's bend axis at rest (armature space) — the
        knee's and the elbow's lateral axis — and the twist of both bones is
        set so that axis stays perpendicular to the plane of the bend.
        """
        p0 = self.pos(upper)
        l1, l2 = self.skel.length(upper), self.skel.length(lower)
        to = target - p0
        dist = min(max(to.length, abs(l1 - l2) + 1e-4), (l1 + l2) * 0.9995)
        d = to.normalized()
        pl = pole - d * pole.dot(d)
        if pl.length < 1e-6:
            pl = hinge_rest.cross(d)
        pl.normalize()
        cos_a = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
        a = math.acos(max(-1.0, min(1.0, cos_a)))
        joint = p0 + (d * math.cos(a) + pl * math.sin(a)) * l1
        end = p0 + d * dist
        u_d = (joint - p0).normalized()
        l_d = (end - joint).normalized()
        h_d = d.cross(pl).normalized()

        def frame_rot(rest_dir: Vector, want_dir: Vector) -> Quaternion:
            hr = hinge_rest - rest_dir * hinge_rest.dot(rest_dir)
            hr.normalize()
            hw = h_d - want_dir * h_d.dot(want_dir)
            hw.normalize()
            fr = Matrix((rest_dir, hr, rest_dir.cross(hr))).transposed()
            fw = Matrix((want_dir, hw, want_dir.cross(hw))).transposed()
            return (fw @ fr.transposed()).to_quaternion()

        for bone, want in ((upper, u_d), (lower, l_d)):
            rest = self.skel.rest[bone]
            rest_dir = (rest.to_3x3() @ Vector((0, 1, 0))).normalized()
            self.orient(bone, frame_rot(rest_dir, want))
        return self

    def local(self) -> dict[str, tuple[Quaternion, Vector]]:
        return {b: (self.q[b].copy(), self.loc[b].copy()) for b in self.skel.order}

    def reset(self) -> 'Poser':
        for b in self.skel.order:
            self.q[b] = Quaternion()
            self.loc[b] = Vector()
        self._posed.clear()
        return self


def _channelbag(action: bpy.types.Action, slot):
    layer = action.layers[0] if len(action.layers) else action.layers.new('Layer')
    strip = layer.strips[0] if len(layer.strips) else layer.strips.new(type='KEYFRAME')
    cb = strip.channelbag(slot) if hasattr(strip, 'channelbag') else None
    return cb or strip.channelbags.new(slot)


def bake_clip(skel: Skeleton, name: str, duration: float, pose_at: Callable[[Poser, float], None],
              loop: bool = True) -> bpy.types.Action:
    """Sample `pose_at(poser, phase)` every frame of `duration` seconds into action `name`.

    `phase` runs 0..1 over the clip (inclusive at both ends, so a loop's last
    frame equals its first). Every bone is keyed every frame with linear
    interpolation — what the exporter samples is exactly what was posed.
    """
    frames = max(2, int(round(duration * FPS)))
    poser = Poser(skel)
    samples: list[dict[str, tuple[Quaternion, Vector]]] = []
    for f in range(frames + 1):
        poser.reset()
        pose_at(poser, f / frames)
        samples.append(poser.local())
    if loop:
        samples[-1] = samples[0]
    # Keep quaternion signs continuous so linear keys never spin the long way round.
    for b in skel.order:
        for i in range(1, len(samples)):
            q_prev, q = samples[i - 1][b][0], samples[i][b][0]
            if q_prev.dot(q) < 0:
                samples[i][b] = (-q, samples[i][b][1])

    action = bpy.data.actions.new(name)
    slot = action.slots.new(id_type='OBJECT', name=skel.ob.name)
    cb = _channelbag(action, slot)
    linear = bpy.types.Keyframe.bl_rna.properties['interpolation'].enum_items['LINEAR'].value
    count = len(samples)
    for b in skel.order:
        channels = [('rotation_quaternion', i, [s[b][0][i] for s in samples]) for i in range(4)]
        if any(s[b][1].length > 1e-6 for s in samples):
            channels += [('location', i, [s[b][1][i] for s in samples]) for i in range(3)]
        for path, index, values in channels:
            fc = cb.fcurves.new(f'pose.bones["{b}"].{path}', index=index, group_name=b)
            fc.keyframe_points.add(count)
            co = []
            for f, v in enumerate(values):
                co += [float(f), float(v)]
            fc.keyframe_points.foreach_set('co', co)
            fc.keyframe_points.foreach_set('interpolation', [linear] * count)
            fc.update()
    ad = skel.ob.animation_data or skel.ob.animation_data_create()
    track = ad.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, action)
    strip.action_slot = slot
    track.mute = True
    action.use_fake_user = True
    return action


def ease(t: float) -> float:
    """Smooth 0→1 over t in 0..1."""
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def wave(phase: float, cycles: float = 1.0, offset: float = 0.0) -> float:
    """sin over `cycles` full turns of a 0..1 phase, shifted by `offset` (fraction of a turn)."""
    return math.sin(2 * math.pi * (phase * cycles + offset))


def keys(phase: float, points: Sequence[tuple[float, float]]) -> float:
    """Smoothly interpolated value through (phase, value) keys — ease in/out between each pair."""
    if phase <= points[0][0]:
        return points[0][1]
    for (t0, v0), (t1, v1) in zip(points, points[1:]):
        if phase <= t1:
            return v0 + (v1 - v0) * ease((phase - t0) / (t1 - t0 or 1.0))
    return points[-1][1]


def lerp(a, b, t: float):
    return a + (b - a) * t


def mirror_name(name: str) -> str:
    if name.endswith('L'):
        return name[:-1] + 'R'
    if name.endswith('R'):
        return name[:-1] + 'L'
    return name


def vec(*xs: float) -> Vector:
    return Vector(xs)


def all_parts(skel: Skeleton) -> Iterable[bpy.types.Object]:
    return [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.parent == skel.ob]
