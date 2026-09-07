# 3D models

Every entity the player sees — the five worker minions, the five vehicles,
the nine building types at three tiers, the rubble a destroyed building
turns into, and the scenery around the site (trees for each biome, bushes,
boulders, village houses) — is a `.glb` under `public/models/`, generated
by Blender from the Python sources in `blender/`. Nothing is hand-modelled:
re-running the generator reproduces every asset, and the saved `.blend`
files are there for hand edits on top.

```
assets/models/
├── blender/          Generators (bpy). common.py = shared helpers; workers.py,
│                     vehicles.py, buildings.py, props.py = one builder per model family;
│                     build.py = CLI; sheet.py = contact sheet of previews;
│                     building-defs.json = footprints dumped from the game.
├── blend/            Editable sources, one .blend per model, modifiers live.
└── README.md
public/models/        Exports the game loads, one .glb per model id.
```

## Rebuilding

```bash
pip install bpy                     # Blender as a Python module (once)
npm run models:build                # dumps building-defs.json, builds every model
python3 assets/models/blender/build.py worker_driller     # one model
python3 assets/models/blender/build.py vehicles buildings # categories
```

Model ids are derived in `src/renderer/models/ModelIds.ts` from the core
catalogs (`EmployeeRole`, `VehicleRole`, `BuildingDefs`): `worker_<role>`,
`vehicle_<role>`, `building_<type>_t<tier>`, `building_ruin`. A new role
or tier needs a builder here and nothing else.

## Previewing

The game's own scene pipeline (toon ramp, outline, cascaded shadows, tone
mapping) is what a model has to look good in, so previews go through it:

```bash
npm run dev &                                   # Vite on :5173
npm run models:preview                          # every model, three angles → screenshots/models/
npm run models:preview -- worker_driller --views "face:90:8" --zoom 1.5
python3 assets/models/blender/sheet.py --cols 4 worker   # tile captures into sheet.png
```

`/model-viewer.html?model=<id>&yaw=<deg>&pitch=<deg>&zoom=<f>` is the page
behind it, usable in a browser too. Yaw 90 looks at a model's front (+X in
Blender, the direction workers and vehicles face); yaw 180 looks at a
building's front, the row with the entry and exit doors.

## Conventions the runtime relies on

- 1 Blender unit = 1 game unit (one voxel). Z is up in Blender; the
  exporter converts to glTF's Y-up. The origin is the ground contact point.
- Workers and vehicles face **+X**; the renderer yaws the root toward the
  direction of travel. Buildings are centred on their footprint with the
  entry/exit row at **+Y** (game −Z).
- **Top-level objects are animation nodes.** `pivot(name, location, parts)`
  parents parts under an Empty whose location is the pivot. The renderer
  swings `ArmL/ArmR/LegL/LegR`, wobbles `Head`, spins `Wheel*` and
  `Flywheel`. Everything else lives under `Body`.
- **Materials named `Tint*` are recoloured per instance** (`TintRole` for
  a worker's overalls and hat, `TintBody` for vehicle paint and building
  walls). Every other material is baked into vertex colours and merged, so
  keep colour in material slots, not textures — the exporter writes no
  UVs or images.
- A material with an emission colour stays a separate mesh and glows.
- Budget: ≤ 400 KB per `.glb`, ≤ 8 MB in total (`tests/unit/renderer/models/ModelAssets.test.ts`).

### Props

Scenery is drawn instanced — one draw call per model, thousands of copies —
so a prop is a single static mesh with no animation nodes, and only its
materials matter:

- `prop_tree_<family>_<v>`: three variants each of `deciduous`, `conifer`,
  `tropical`, `desert` and `volcanic`. Which family a biome plants is
  `TREE_FAMILY_BY_BIOME` in `src/renderer/ambient/VegetationSway.ts`. The
  canopy sways in the wind through a vertex shader that bends by height, so
  keep the trunk's base at the origin and the canopy above it.
- Every tree also exports a `_far` copy (`finish_far`, a Decimate at 12 %)
  drawn beyond `TREE_DETAIL_DISTANCE` without an outline. Rebuild both when
  editing a tree.
- `prop_bush_<v>`, `prop_rock_<v>`: scattered on the rim outside the
  playable site. Rocks carry a `TintRock` material recoloured per biome
  (`ROCK_COLOR_BY_BIOME` in `src/renderer/ambient/Scenery.ts`).
- `prop_house_<v>`: a unit box — walls 1×1 on the ground, ridge at y = 1 —
  that the renderer scales to each village house's `w × h × d`. The chimney
  sits at the house's (+0.25, −0.25) corner so `ChimneySmoke` puffs from it.

## Editing a .blend by hand

Open `blend/<id>.blend`, edit, then export with **File → Export → glTF 2.0**
to `public/models/<id>.glb` using: format glb, +Y up, apply modifiers,
no UVs/images/animations. Keep the node and material naming above, or
regenerate from the Python source and port your change there so the next
`models:build` does not overwrite it.
