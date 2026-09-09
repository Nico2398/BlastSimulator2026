# Model catalog

Ids come from `src/renderer/models/ModelIds.ts`, derived from the core
catalogs. The Blender registry in `build.py` writes the same names.

This page is the prose: what each family is and what its tiers joke about.
The per-id data — nodes, parts, materials, size, triangles, builder module —
is generated into `assets/models/manifest.json`; read that entry before
editing a model.

## Workers — `workers.py`

`worker_<role>` for `driller`, `blaster`, `driver`, `surveyor`, `manager`.

One model per role, no tiers. Big round head on an egg body, stubby capsule
limbs, oversized boots and hands, hard hat in the role colour, and the tool of
the trade in hand. Manager gets a tie and a coffee mug; surveyor a hi-vis
stripe.

Nodes: `Head`, `Torso`, `ArmL`, `ArmR`, `LegL`, `LegR`. Tint: `TintRole`
(overalls and hat, recoloured per role and injury). Height 1.1–1.6 m.

## Vehicles — `vehicles_t1.py` / `vehicles.py` / `vehicles_t3.py`

`vehicle_<role>_t<tier>` for `debris_hauler`, `rock_digger`, `drill_rig`,
`building_destroyer`, `rock_fragmenter` × tiers 1–3.

| Role | t1 — junk | t2 — the machine | t3 — excess |
|------|-----------|------------------|-------------|
| debris_hauler | Dumpster on Wheels: a municipal skip on a rusty go-kart, kitchen-chair seat, one bicycle wheel | Dump truck | Mega Mover XL: six wheels, chrome grille, gold XL badge, flame stacks, neon underglow, golden nugget on the load |
| rock_digger | The Scratch: swivel stool under a beach umbrella, broom-handle boom, frying-pan bucket | Excavator | Rock Reaper: skull cab with glowing eyes, spiked tracks, chrome horns, scythe bucket |
| drill_rig | Pokey McPoke: a shopping trolley carrying a ladder mast, egg-beater drill, chewed pencil bit | Drill rig | Helldriller: horns, lava-glowing screw bit, pitchfork antenna, devil tail |
| building_destroyer | Wrecking Rascal: ride-on mower, plank-and-nails blade, bowling-ball crane, rake ripper | Dozer | Obliterator Supreme: gold face-painted blade, spiked wrecking ball, laser turret, corporate flags |
| rock_fragmenter | Cracky: wheelbarrow cart, see-saw sledgehammer, crate hopper, pedal-crank flywheel | Crusher | The Atomizer: glowing reactor dome, particle-ring flywheel, twin conveyors |

Nodes: `Body` always; `Wheel*` (`WheelFL`, `WheelFR`, `WheelRL`, `WheelRR` on
haulers) as direct children of the root; `Flywheel` on the fragmenter; plus
role parts (`Bed`, `Boom`, `Stick`, `Bucket`, `Mast`, `Blade`, `Ripper`,
`Conveyor`). Tint: `TintBody` (paint). Ground contact at y = 0.

Tier 1 keeps the same node layout at 60–85 % of the tier-2 footprint.

## Buildings — `buildings_t1.py` / `buildings.py` / `buildings_t3.py`

`building_<type>_t<tier>` for the nine types × tiers 1–3, plus
`building_ruin` (shared rubble, stretched over any destroyed footprint).

| Type | t1 | t3 |
|------|----|----|
| driving_center | Learner's Lot: dirt lot, plywood booth, wrecked car on a brick | Turbo Campus: banked roof race loop, trophy, jumbotron, podium |
| blasting_academy | Boom Shack: roof blown half off, scorched window, KA-BOOM board | The Kaboom Institute: portico, mushroom-cloud dome, golden starburst, fountain |
| management_office | The Cupboard: an oversized wardrobe, door ajar on paper stacks | Corner Office Supreme: 8 m glass tower, gold penthouse, helipad, "$", limousine |
| geology_lab | Rock Shed: garden shed, rock shelf, magnifying-glass sign | Institute of Expensive Rocks: glass pyramid, glowing diamond, laser grid, price tag |
| research_center | Think Tank Tent: patched tent, bare-bulb sign, whiteboard, campfire | The Ivory Crater: ivory dish, spiral ramp, lightbulb dome, brain sculpture |
| living_quarters | The Cells: barred windows, barbed wire, watchtower, ball and chain | Unnecessarily Luxurious Hotel: rooftop infinity pool with slide, gold HOTEL sign, valet |
| explosive_warehouse | Boom Closet: a two-seat outhouse stuffed with dynamite, lit fuse | Fort Kaboom: crenellated castle, moat, drawbridge, cannons, giant lit bomb |
| freight_warehouse | The Pile: junk heap under a tarp, bathtub, bent bike, STUFF sign | Hoarder's Paradise: crate towers, gantry crane still adding more, MORE sign |
| vehicle_depot | Rusty Garage: rusted lean-to, car on bricks, oil puddle, GAR GE sign | Mecha Hangar: blast doors half open on a mech, cyan light strips, gantries |

Tier 2 is the plain building: a plinth, one storey per tier, window rows, a
green-framed entry door and an orange-framed exit door on the +Y face, and a
type-specific roof feature.

Sizing comes from `building-defs.json`; the model is centred on its footprint,
x spanning ±sizeX/2 and y spanning ±sizeZ/2. Tint: `TintBody` (walls, the type
colour). Heights must ascend with tier.

## Props — `props.py`

Instanced scenery. Single `Body` node, no animation nodes.

| Id | Count | Notes |
|----|-------|-------|
| `prop_tree_<family>_<0-2>` | 15 | Families `deciduous`, `conifer`, `tropical`, `desert`, `volcanic`; the biome picks one (`TREE_FAMILY_BY_BIOME`). Base at the origin, canopy above — the wind shader bends by height |
| `prop_tree_<family>_<v>_far` | 15 | Decimated LOD, exported automatically beside each tree. Rebuild both when editing a tree |
| `prop_bush_<0-1>`, `prop_rock_<0-2>` | 5 | Scattered on the rim outside the playable site. Rocks carry `TintRock`, recoloured per biome |
| `prop_house_<0-2>` | 3 | A unit box — walls 1 × 1 on the ground, ridge at y = 1 — stretched to each village house's w × h × d. Chimney at (+0.25, +0.25) so `ChimneySmoke` puffs from it |
| `prop_grass_<0-2>` | 3 | Fat cartoon tufts, thousands per level, `TintGrass` per biome, drawn without an outline |
| `prop_flower_<0-1>` | 2 | Wildflowers among the grass where `FLOWER_BIOMES` allows |
| `prop_twister` | 1 | The desert dust devil: a striped funnel on a dust cloud, 9 m tall, spun and wobbled per devil. Not instanced |
