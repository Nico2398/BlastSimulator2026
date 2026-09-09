# How the runtime consumes a model

`src/renderer/models/` turns a Blender export into what the scene draws. Each
step explains one of the authoring rules.

## Load

`ModelLoader.preloadModels()` fetches every id in `allModelIds()` and parses
them with `GLTFLoader`, one at a time, yielding to the event loop after each
120 ms slice so the page keeps painting. A failed fetch or parse is recorded,
never thrown: the id renders as a stand-in box.

The byte source is injectable — the browser fetches `/models/<id>.glb`, and
Node tests read `public/models/` from disk through the same path, so unit
tests assert against the real exported asset.

## Merge (`ModelMerge.buildPrototype`)

Each **direct child of the glTF scene** becomes one node of the prototype,
keeping its name — that is why only top-level objects are animatable, and why
the renderer can ask for `ArmL` or `WheelFR`. Everything beneath a node is
collected and bucketed by material:

| Bucket | Result |
|--------|--------|
| `Tint*` material | Its own mesh, material cloned per instance and recoloured |
| Material with an emission colour | Its own mesh per emissive/base colour pair, glows |
| Everything else | One merged mesh, each part's colour baked into a vertex-colour attribute |

Then one inverted-hull outline mesh over the union of those surfaces. So a
node costs `1 + tints + emissive colours` draws plus its outline: a worker
drops from ~40 draws to ~14, a building to 3.

Merging requires identical attribute sets, which is why the export carries
position and normal only — no UVs, no textures, no vertex colours from
Blender.

## Instantiate (`ModelLibrary`)

`instantiate(id, fallback)` clones the prototype's scene graph (geometry
shared) and clones only the `Tint*` materials, returning them by their Blender
name. A model missing from the library returns a stand-in box of the caller's
`fallback.size`, flagged `isFallback`; `BuildingMesh`, `VehicleMesh` and
`CharacterMesh` swap it for the real model once the asset arrives.

The scene attaches its cascaded-shadow shader through
`setMaterialSetup()`, which also runs on every per-instance clone.

## Animate

- Root yaw: `headingFromDelta(dx, dz)` turns the model toward travel, which is
  why every worker and vehicle faces **+X** at rest.
- Workers swing `ArmL`/`ArmR`/`LegL`/`LegR` and wobble `Head` on the pivots
  the `pivot()` Empties define.
- Vehicles spin each `Wheel*` node by `distance / radius`, where the radius is
  **measured from the node's own bounds** — a bicycle wheel and a monster tyre
  both roll true, with no per-model constant. Axles run along the model's
  Z in three.js, which is Blender's Y.
- `Flywheel` turns while the vehicle is `working`.

## Instanced props (`InstancedProp`)

Trees, bushes, rocks, grass, flowers and houses are drawn as `InstancedMesh`
per surface of the prototype's single node, plus one for the outline hull, all
sharing one instance-matrix buffer. This is why a prop is a single static
`Body` node: a second node would need a second buffer and a second draw.

Options: a per-biome `tint` applied to `Tint*` surfaces, and `outline: false`
for props too small on screen for a screen-constant line to read as anything
but noise.

## Wind sway

Vegetation surfaces and their outlines share a vertex-shader bend that grows
with height up to `canopyHeight` and is phased by the instance's world X, so a
forest does not move in lockstep. It bends what is above the origin: a tree or
tuft modelled with its base at z = 0 sways correctly, one modelled off-origin
shears.

## Materials (`CartoonMaterial`)

- Toon ramp: three flat bands with a soft toe, shared by every material.
- Outline: the same geometry drawn back-face only, pushed along its normal by
  a screen-constant width (1.7 px, capped at 3.5 cm of world space). It costs
  one draw per node and no post pass.
- The outline is why fine detail vanishes: two surfaces closer than the line's
  width merge into it.
