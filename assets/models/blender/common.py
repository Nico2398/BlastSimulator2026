"""Shared Blender helpers for BlastSimulator2026's model generators.

Every model in the game is built procedurally here with bpy, saved as an
editable .blend (modifiers left live) and exported as a .glb with modifiers
applied. Conventions the runtime relies on:

* 1 Blender unit = 1 game unit (one voxel). Blender is Z-up; the exporter
  converts to glTF's Y-up. Blender +X is a vehicle's forward direction and
  a worker's facing direction; the game rotates the root group around Y.
* The mesh origin is the ground contact point (z = 0 is the ground).
* Direct children of the scene root become the nodes the renderer can
  animate. A part that must pivot (an arm, a wheel) is parented under an
  Empty whose location is the pivot; the Empty's name is the node name.
* A material whose name starts with ``Tint`` is cloned per game instance
  and recoloured at runtime (role colour, injury, tier). Every other
  material is shared between instances.
"""
from __future__ import annotations

import math
import os
from typing import Iterable, Sequence

import bpy  # noqa: F401 — must precede bmesh, which bpy registers
import bmesh
from mathutils import Euler, Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
BLEND_DIR = os.path.join(ROOT, 'assets', 'models', 'blend')
GLB_DIR = os.path.join(ROOT, 'public', 'models')

Vec3 = Sequence[float]


# ---------------------------------------------------------------- scene ---

def reset_scene() -> None:
    """Fresh, empty file. Called once per model so every .blend is self-contained."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0


def collection(name: str) -> bpy.types.Collection:
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


def link(ob: bpy.types.Object, col: bpy.types.Collection | None = None) -> bpy.types.Object:
    (col or bpy.context.scene.collection).objects.link(ob)
    return ob


# ------------------------------------------------------------- colours ---

def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(value: int) -> tuple[float, float, float]:
    return (((value >> 16) & 0xFF) / 255.0, ((value >> 8) & 0xFF) / 255.0, (value & 0xFF) / 255.0)


def material(name: str, color: int, roughness: float = 0.7, metallic: float = 0.0,
             emission: int | None = None, emission_strength: float = 1.0) -> bpy.types.Material:
    """Principled material. `color` is an sRGB hex like a CSS colour; stored linear.

    Same-named materials are reused so a model shares one slot per colour.
    """
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    r, g, b = hex_rgb(color)
    bsdf.inputs['Base Color'].default_value = (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if emission is not None:
        er, eg, eb = hex_rgb(emission)
        bsdf.inputs['Emission Color'].default_value = (srgb_to_linear(er), srgb_to_linear(eg), srgb_to_linear(eb), 1.0)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    mat.diffuse_color = (r, g, b, 1.0)
    return mat


def assign(ob: bpy.types.Object, mat: bpy.types.Material, faces: Iterable[int] | None = None) -> None:
    """Assign `mat` to every face (or to `faces` by index) of `ob`."""
    mats = ob.data.materials
    idx = next((i for i, m in enumerate(mats) if m == mat), None)
    if idx is None:
        mats.append(mat)
        idx = len(mats) - 1
    if faces is None:
        for p in ob.data.polygons:
            p.material_index = idx
    else:
        for f in faces:
            ob.data.polygons[f].material_index = idx


def assign_by(ob: bpy.types.Object, mat: bpy.types.Material, predicate) -> None:
    """Assign `mat` to faces whose centre (local) satisfies `predicate(Vector)`."""
    assign(ob, mat, [p.index for p in ob.data.polygons if predicate(p.center)])


# ---------------------------------------------------------- primitives ---

def _finish(name: str, bm: bmesh.types.BMesh, loc: Vec3, rot: Vec3 | None,
            col: bpy.types.Collection | None, smooth: bool, sharp_angle: float | None) -> bpy.types.Object:
    if sharp_angle is not None:
        mark_sharp(bm, sharp_angle)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = Vector(loc)
    if rot is not None:
        ob.rotation_euler = Euler([math.radians(a) for a in rot], 'XYZ')
    link(ob, col)
    if smooth:
        me.shade_smooth()
    return ob


def box(name: str, size: Vec3, loc: Vec3 = (0, 0, 0), rot: Vec3 | None = None,
        col: bpy.types.Collection | None = None, smooth: bool = True) -> bpy.types.Object:
    """Axis-aligned box of `size`, centred on `loc`."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    return _finish(name, bm, loc, rot, col, smooth, 45.0)


def sphere(name: str, radius: float, loc: Vec3 = (0, 0, 0), scale: Vec3 = (1, 1, 1),
           segments: int = 32, rings: int = 16, col: bpy.types.Collection | None = None) -> bpy.types.Object:
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    return _finish(name, bm, loc, None, col, True, None)


def cylinder(name: str, radius: float, depth: float, loc: Vec3 = (0, 0, 0), axis: str = 'Z',
             segments: int = 32, radius2: float | None = None, rot: Vec3 | None = None,
             col: bpy.types.Collection | None = None, smooth: bool = True) -> bpy.types.Object:
    """Cylinder (or cone when radius2 differs) along `axis`, centred on `loc`."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=radius, radius2=radius if radius2 is None else radius2, depth=depth)
    if axis == 'X':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'), verts=bm.verts)
    elif axis == 'Y':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, 'X'), verts=bm.verts)
    return _finish(name, bm, loc, rot, col, smooth, 40.0)


def capsule(name: str, radius: float, length: float, loc: Vec3 = (0, 0, 0), axis: str = 'Z',
            segments: int = 24, rings: int = 12, rot: Vec3 | None = None,
            col: bpy.types.Collection | None = None) -> bpy.types.Object:
    """Seamless capsule: a UV sphere stretched by `length` along `axis`, centred on `loc`."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    half = length / 2.0
    for v in bm.verts:
        v.co.z += half if v.co.z > 1e-6 else (-half if v.co.z < -1e-6 else 0.0)
    if axis == 'X':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'), verts=bm.verts)
    elif axis == 'Y':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, 'X'), verts=bm.verts)
    return _finish(name, bm, loc, rot, col, True, None)


def torus(name: str, major: float, minor: float, loc: Vec3 = (0, 0, 0), rot: Vec3 | None = None,
          major_segments: int = 32, minor_segments: int = 12,
          col: bpy.types.Collection | None = None) -> bpy.types.Object:
    bm = bmesh.new()
    # Spin a minor circle around Z to make a torus — bmesh has no torus op.
    ring = bmesh.ops.create_circle(bm, cap_ends=False, segments=minor_segments, radius=minor)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((major, 0, 0)), verts=bm.verts)
    bmesh.ops.spin(bm, geom=bm.verts[:] + bm.edges[:], cent=(0, 0, 0), axis=(0, 0, 1),
                   angle=math.radians(360), steps=major_segments, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(name, bm, loc, rot, col, True, None)


def prism(name: str, points: Sequence[tuple[float, float]], depth: float, loc: Vec3 = (0, 0, 0),
          axis: str = 'Y', rot: Vec3 | None = None, col: bpy.types.Collection | None = None,
          smooth: bool = True) -> bpy.types.Object:
    """Extrude a 2D polygon (in the plane perpendicular to `axis`) by `depth`, centred on `loc`.

    Points are (u, v): for axis 'Y' that is (x, z); for 'X' it is (y, z); for 'Z' it is (x, y).
    """
    bm = bmesh.new()
    verts = []
    for u, v in points:
        if axis == 'Y':
            verts.append(bm.verts.new((u, -depth / 2, v)))
        elif axis == 'X':
            verts.append(bm.verts.new((-depth / 2, u, v)))
        else:
            verts.append(bm.verts.new((u, v, -depth / 2)))
    face = bm.faces.new(verts)
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    extruded = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
    vec = {'Y': (0, depth, 0), 'X': (depth, 0, 0), 'Z': (0, 0, depth)}[axis]
    bmesh.ops.translate(bm, vec=Vector(vec), verts=extruded)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(name, bm, loc, rot, col, smooth, 40.0)


def mark_sharp(bm: bmesh.types.BMesh, angle_deg: float) -> None:
    """Flag edges sharper than `angle_deg` so smooth shading keeps hard creases."""
    limit = math.radians(angle_deg)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            try:
                e.smooth = e.calc_face_angle() <= limit
            except ValueError:
                e.smooth = True


# ----------------------------------------------------------- modifiers ---

def bevel(ob: bpy.types.Object, width: float = 0.04, segments: int = 3, angle: float = 30.0,
          profile: float = 0.5) -> bpy.types.BevelModifier:
    """Rounded edges. Hardened normals keep the flat faces flat under smooth shading."""
    m = ob.modifiers.new('Bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = True
    m.miter_outer = 'MITER_ARC'
    m.profile = profile
    return m


def subsurf(ob: bpy.types.Object, levels: int = 2) -> bpy.types.SubsurfModifier:
    m = ob.modifiers.new('Subdivision', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    return m


def mirror(ob: bpy.types.Object, x: bool = True, y: bool = False, z: bool = False) -> bpy.types.MirrorModifier:
    m = ob.modifiers.new('Mirror', 'MIRROR')
    m.use_axis[0], m.use_axis[1], m.use_axis[2] = x, y, z
    m.use_clip = True
    m.merge_threshold = 0.001
    return m


def array(ob: bpy.types.Object, count: int, offset: Vec3) -> bpy.types.ArrayModifier:
    m = ob.modifiers.new('Array', 'ARRAY')
    m.count = count
    m.use_relative_offset = False
    m.use_constant_offset = True
    m.constant_offset_displace = Vector(offset)
    return m


def solidify(ob: bpy.types.Object, thickness: float, offset: float = -1.0) -> bpy.types.SolidifyModifier:
    m = ob.modifiers.new('Solidify', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    m.use_even_offset = True
    return m


def taper(ob: bpy.types.Object, factor: float, axis: str = 'Z') -> bpy.types.SimpleDeformModifier:
    m = ob.modifiers.new('Taper', 'SIMPLE_DEFORM')
    m.deform_method = 'TAPER'
    m.factor = factor
    m.deform_axis = axis
    return m


def cast(ob: bpy.types.Object, factor: float = 0.5, shape: str = 'SPHERE') -> bpy.types.CastModifier:
    m = ob.modifiers.new('Cast', 'CAST')
    m.cast_type = shape
    m.factor = factor
    return m


def boolean(ob: bpy.types.Object, cutter: bpy.types.Object, op: str = 'DIFFERENCE') -> bpy.types.BooleanModifier:
    m = ob.modifiers.new('Boolean', 'BOOLEAN')
    m.operation = op
    m.object = cutter
    m.solver = 'EXACT'
    cutter.hide_render = True
    cutter.hide_viewport = True
    cutter.display_type = 'WIRE'
    return m


# ----------------------------------------------------------- hierarchy ---

def empty(name: str, loc: Vec3 = (0, 0, 0), col: bpy.types.Collection | None = None) -> bpy.types.Object:
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = 'PLAIN_AXES'
    ob.empty_display_size = 0.1
    ob.location = Vector(loc)
    return link(ob, col)


def parent(children: Iterable[bpy.types.Object], node: bpy.types.Object) -> bpy.types.Object:
    """Parent `children` under `node`, keeping their world placement.

    Uses the node's own basis matrix rather than matrix_world, which is only
    refreshed by a depsgraph update and reads as identity on a fresh Empty.
    """
    inv = node.matrix_basis.inverted()
    for ch in children:
        ch.parent = node
        ch.matrix_parent_inverse = inv
    return node


def pivot(name: str, loc: Vec3, children: Iterable[bpy.types.Object],
          col: bpy.types.Collection | None = None) -> bpy.types.Object:
    """An Empty at `loc` owning `children`: the runtime rotates this node to animate the part."""
    return parent(children, empty(name, loc, col))


def all_meshes() -> list[bpy.types.Object]:
    return [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.hide_render]


# ----------------------------------------------------------- transforms ---

def rotate(ob: bpy.types.Object, x: float = 0.0, y: float = 0.0, z: float = 0.0) -> bpy.types.Object:
    ob.rotation_euler = Euler((math.radians(x), math.radians(y), math.radians(z)), 'XYZ')
    return ob


def scale(ob: bpy.types.Object, x: float = 1.0, y: float = 1.0, z: float = 1.0) -> bpy.types.Object:
    ob.scale = (x, y, z)
    return ob


def apply_transform(ob: bpy.types.Object) -> bpy.types.Object:
    """Bake rotation/scale into the mesh (e.g. before an Array, whose offset is in local axes).

    Reads matrix_basis, which tracks location/rotation/scale immediately;
    matrix_world only refreshes on a depsgraph update.
    """
    me = ob.data
    basis = ob.matrix_basis.copy()
    rot_scale = basis.copy()
    rot_scale.translation = Vector((0, 0, 0))
    me.transform(rot_scale)
    ob.rotation_euler = Euler((0, 0, 0), 'XYZ')
    ob.scale = (1.0, 1.0, 1.0)
    return ob


# -------------------------------------------------------------- output ---

def save_blend(name: str) -> str:
    os.makedirs(BLEND_DIR, exist_ok=True)
    path = os.path.join(BLEND_DIR, f'{name}.blend')
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    return path


def export_glb(name: str) -> str:
    """Export the whole scene as one binary glTF with modifiers applied, Y-up, no textures."""
    os.makedirs(GLB_DIR, exist_ok=True)
    path = os.path.join(GLB_DIR, f'{name}.glb')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_texcoords=False,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='NONE',
        export_attributes=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_lights=False,
        export_cameras=False,
        export_extras=False,
        use_selection=False,
    )
    return path


def finish_far(name: str, ratio: float = 0.12) -> None:
    """Export a decimated copy of the current scene as `<name>_far` — the distant LOD an instanced forest draws.

    Runs after finish(): the .blend keeps the full-detail modifiers; only the
    export carries the Decimate.
    """
    for ob in all_meshes():
        m = ob.modifiers.new('Decimate', 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = ratio
    glb = export_glb(f'{name}_far')
    tris = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in all_meshes():
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
        ev.to_mesh_clear()
    print(f'[models] {name}_far: {tris} tris, {os.path.getsize(glb) // 1024} KB glb')


def finish(name: str) -> None:
    """Save the editable source and write the game asset, then report sizes."""
    bpy.context.view_layer.update()
    blend = save_blend(name)
    glb = export_glb(name)
    tris = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in all_meshes():
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
        ev.to_mesh_clear()
    print(f'[models] {name}: {tris} tris, {os.path.getsize(glb) // 1024} KB glb, {os.path.getsize(blend) // 1024} KB blend')


# ------------------------------------------------------- prop helpers ---

def icosphere(name: str, radius: float, loc: Vec3 = (0, 0, 0), subdivisions: int = 3,
              scale: Vec3 = (1, 1, 1), col: bpy.types.Collection | None = None) -> bpy.types.Object:
    """Evenly tessellated sphere — the right base for a displaced boulder."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    return _finish(name, bm, loc, None, col, True, None)


def displace(ob: bpy.types.Object, strength: float = 0.3, noise_scale: float = 0.6,
             seed: int = 0) -> bpy.types.DisplaceModifier:
    """Push vertices along their normals by a procedural cloud texture — lumpy rock, bumpy canopy."""
    tex = bpy.data.textures.new(f'{ob.name}.Noise', type='CLOUDS')
    tex.noise_scale = noise_scale
    tex.noise_depth = 1
    tex.noise_basis = 'ORIGINAL_PERLIN'
    m = ob.modifiers.new('Displace', 'DISPLACE')
    m.texture = tex
    m.strength = strength
    m.mid_level = 0.5
    # Global coordinates: two parts at different places sample different
    # noise, and no helper object is needed (an extra top-level object would
    # export as a stray node). `seed` shifts the texture's own noise field.
    m.texture_coords = 'GLOBAL'
    tex.noise_scale = noise_scale * (1.0 + (seed % 5) * 0.03)
    return m


def bend(ob: bpy.types.Object, angle_deg: float, axis: str = 'Y') -> bpy.types.SimpleDeformModifier:
    """Curve a straight part (a palm trunk) with a Simple Deform bend."""
    m = ob.modifiers.new('Bend', 'SIMPLE_DEFORM')
    m.deform_method = 'BEND'
    m.angle = math.radians(angle_deg)
    m.deform_axis = axis
    return m
