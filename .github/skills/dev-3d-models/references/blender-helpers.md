# Blender helpers (`assets/models/blender/common.py`)

Every builder is written against these. They exist so a model is described in
game units and shapes, never in raw bmesh calls.

## Scene

| Helper | Does |
|--------|------|
| `reset_scene()` | Factory-empty file, metric units. `build.py` calls it once per model, so every `.blend` is self-contained |
| `collection(name)` / `link(ob, col)` | Optional grouping; the exporter takes the whole scene either way |
| `all_meshes()` | Visible meshes — what `finish()` counts and exports |

## Primitives

All take `name`, a size, `loc` (centre), optional `rot` (degrees, XYZ) and return the object.

| Helper | Shape | Notes |
|--------|-------|-------|
| `box(name, size, loc, rot)` | Axis-aligned cube scaled to `size` | Smooth-shaded with 45° sharp-edge marking |
| `sphere(name, radius, loc, scale, segments=32, rings=16)` | UV sphere, optionally squashed by `scale` | Drop segments on small parts |
| `cylinder(name, radius, depth, loc, axis, segments=32, radius2)` | Cylinder, or a cone when `radius2` differs | `axis` is `'X'`, `'Y'` or `'Z'` |
| `capsule(name, radius, length, loc, axis)` | Seamless capsule — a sphere stretched along `axis` | Limbs, hoses, poles |
| `torus(name, major, minor, loc, rot)` | Spun ring | Belts, tyres' inner rings, collars |
| `prism(name, points, depth, loc, axis)` | 2D outline extruded by `depth` | The cheapest way to a curved silhouette: bake the curve into `points` |
| `icosphere(name, radius, loc, subdivisions)` | Evenly tessellated sphere | The right base for a displaced boulder |
| `mark_sharp(bm, angle_deg)` | Keeps creases sharp under smooth shading | Applied automatically by `box`, `cylinder`, `prism` |

## Modifiers

Left live in the `.blend`, applied on export.

| Helper | Use |
|--------|-----|
| `bevel(ob, width, segments, angle, profile)` | The house style. Hardened normals keep flat faces flat |
| `subsurf(ob, levels)` | Costly — quadruples faces per level. Prefer bevel |
| `mirror(ob, x, y, z)` | Symmetric parts, clipped and merged at the seam |
| `array(ob, count, offset)` | Repeats with a constant offset in local axes — `apply_transform()` first if the object is rotated |
| `solidify(ob, thickness, offset)` | Gives a surface walls (tarps, sheet metal, tent cloth) |
| `taper(ob, factor, axis)` / `bend(ob, angle_deg, axis)` | Simple Deform: cone a tower, curve a palm trunk |
| `cast(ob, factor, shape)` | Pulls a mesh toward a sphere/cylinder — softens a boxy blob |
| `boolean(ob, cutter, op)` | Exact-solver cut. The cutter is hidden from render and viewport so it never exports as a stray node |
| `displace(ob, strength, noise_scale, seed)` | Procedural cloud noise along normals — lumpy rock, bumpy canopy. Samples GLOBAL coordinates, so two parts in different places get different noise, and `seed` shifts the field |

## Hierarchy

| Helper | Does |
|--------|------|
| `empty(name, loc)` | Plain-axes Empty |
| `parent(children, node)` | Reparents keeping world placement |
| `pivot(name, loc, children)` | Empty at `loc` owning `children` — **this is how an animation node is made**. The Empty's name is the node name the renderer looks up, its location is the rotation pivot |

Only direct children of the scene root survive as nodes. A part parented under
another part is merged into that node's meshes.

## Materials and colour

```python
material(name, color, roughness=0.7, metallic=0.0, emission=None, emission_strength=1.0)
assign(ob, mat)                  # whole object
assign(ob, mat, faces=[3, 7])    # by polygon index
assign_by(ob, mat, lambda c: c.z > 1.2)   # by face-centre predicate
```

- `color` is an sRGB hex like a CSS colour; the helper converts to linear.
- **Same-named materials are reused.** A module builds its palette once in
  `_materials()` and passes the dict down. A tier module that wants its own
  colour under a shared name creates that material *first*, so the cached
  lookup hands the shared helpers its version — that is how `vehicles_t3.py`
  recolours parts built by `vehicles.py`.
- `Tint*` names are the per-instance recolour contract; every other material
  is baked to vertex colours at load.
- An `emission` colour keeps the material on its own mesh and makes it glow.

## Output

| Helper | Does |
|--------|------|
| `save_blend(name)` | Writes `assets/models/blend/<name>.blend`, compressed, modifiers live |
| `export_glb(name)` | Writes `public/models/<name>.glb`: modifiers applied, +Y up, no UVs, no images, no animations, no cameras or lights |
| `finish(name)` | Both of the above, then prints triangles, glb KB and blend KB |
| `finish_far(name, ratio=0.12)` | Adds a Decimate to every mesh and exports `<name>_far` — the distant tree LOD. Runs after `finish()`, so the `.blend` keeps full detail. `build.py` calls it for every `prop_tree_*` |

## Gotchas the generators were built around

- `matrix_world` only refreshes on a depsgraph update, so it reads as identity
  on a freshly created Empty. `parent()` and `apply_transform()` use
  `matrix_basis` instead. Do the same in new helpers.
- `apply_transform(ob)` bakes rotation and scale into the mesh. Required
  before an Array, whose offset is expressed in local axes.
- A Boolean cutter must stay hidden (`boolean()` does this) or it exports as a
  visible stray node.
- `bpy` must be imported before `bmesh`; `bpy` registers it.
- Randomness in a builder is seeded (`random.Random(100 + variant)`), so a
  rebuild is reproducible. Keep any new randomness seeded.
- A model is one scene. Reuse across models happens by importing the other
  module's builder functions, never by appending from a `.blend`.
