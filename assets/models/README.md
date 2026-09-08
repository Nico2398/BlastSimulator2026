# 3D models

Every entity the player sees — the five worker minions, the five vehicles
and nine building types at three tiers each, the rubble a destroyed
building turns into, and the scenery around the site (trees for each
biome, bushes, boulders, grass, wildflowers, village houses, the desert's
dust devils) — is a `.glb` under `public/models/`, generated
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
`vehicle_<role>_t<tier>`, `building_<type>_t<tier>`, `building_ruin`. A new
role or tier needs a builder here and nothing else.

### Tiers are the satire

Each tier is its own model, never a scaled or recoloured copy of another:

- **Tier 1 is junk.** `vehicles_t1.py` and `buildings_t1.py`: the Dumpster
  on Wheels is a dumpster on wheels, The Cells are cells, the Think Tank
  Tent is a tent. Improvised, patched, dented, the wrong tool for the job.
- **Tier 2 is the plain machine.** `vehicles.py` and `buildings.py`: what
  the equipment would honestly look like.
- **Tier 3 is corporate excess.** `vehicles_t3.py` and `buildings_t3.py`:
  gold trim, chrome, glowing bits, a rooftop pool on the Unnecessarily
  Luxurious Hotel, a helipad on the Corner Office Supreme.

`build.py`'s registry routes `vehicle_<role>_t1` to `vehicles_t1.py`,
`_t2` to `vehicles.py`, `_t3` to `vehicles_t3.py`, and a building tier to
`buildings_t1.py` / `buildings_t3.py` when the module defines it, else to
`buildings.py`. The runtime asks the same node names of every tier
(`Body`, `Wheel*`, `Bed`, `Boom`/`Stick`/`Bucket`, `Mast`, `Blade`/`Ripper`,
`Flywheel`/`Conveyor`; the green entry and orange exit door frames on a
building's front row), and measures each wheel's radius from the model, so
a bicycle wheel and a monster tyre both roll true. Tier 1 buildings must be
lower than tier 2 and tier 3 taller — the game checks it.

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
- `prop_grass_<v>`: fat cartoon tufts, thousands per level, swaying like
  the trees. Their `TintGrass` material is recoloured per biome
  (`GRASS_COLOR_BY_BIOME` in `VegetationSway.ts`); keep every blade cheap —
  a tuft is a few hundred triangles, and it is drawn with an outline hull.
- `prop_flower_<v>`: wildflowers sprinkled among the grass where
  `FLOWER_BIOMES` allows.
- `prop_twister`: the dust devil, a striped funnel on a dust cloud, 9 m
  tall. Not instanced — `DustDevils.ts` instantiates it per devil and spins,
  wobbles and breathes the whole `Body`, with grit chunks orbiting it.

## Editing a .blend by hand

Open `blend/<id>.blend`, edit, then export with **File → Export → glTF 2.0**
to `public/models/<id>.glb` using: format glb, +Y up, apply modifiers,
no UVs/images/animations. Keep the node and material naming above, or
regenerate from the Python source and port your change there so the next
`models:build` does not overwrite it.
