---
applyTo: "assets/models/**,public/models/**,src/renderer/models/**/*.ts"
---

# 3D Model Changes

Models are generated, not hand-modelled. The Python builders under `assets/models/blender/` are the source of truth; `assets/models/blend/*.blend` and `public/models/*.glb` are outputs, and the next `npm run models:build` overwrites both.

## ▶ PROCEDURE

1. Read the model's entry in `assets/models/manifest.json` — nodes, parts, materials, size, triangles — before reading its generator.
2. Edit the Python builder, never the `.glb`. Express repeats, symmetry, cuts, thickness and scatter with a modifier or a Geometry Nodes tree rather than hand-placed copies.
3. Rebuild the ids you touched: `npm run models:build -- <id>` (needs `pip install bpy`), then `npm run models:manifest`.
4. `npm run test -- ModelAssets ModelManifest` — they parse the committed `.glb`, so an unbuilt source change proves nothing.
5. `npm run dev &` then `npm run models:preview -- <id>`, and **open every PNG with the Read tool**.
6. Fix what the image showed and go back to step 2. The first render is a draft, and one capture is not the loop.
7. Commit the `.py`, the `.blend`, the `.glb` and the manifest together.

A hand edit made in a `.blend` is ported back into its Python builder before the change is done.

## Invariants

- 1 Blender unit = 1 game unit. Z-up in Blender, exported +Y up. Origin at the ground contact point.
- Workers and vehicles face +X; buildings are centred on their footprint with the door row at +Y.
- Only direct children of the scene root are animation nodes (`Head`, `Torso`, `ArmL`, `ArmR`, `LegL`, `LegR`, `Wheel*`, `Flywheel`, `Body`). Build them with `pivot()`.
- Materials named `Tint*` are recoloured per instance; emissive materials stay separate and glow; every other colour is baked to vertex colours. No UVs, no textures, no animations in the export.
- Each tier is its own model — tier 1 improvised junk, tier 2 the plain machine, tier 3 corporate excess — and a building is taller than the tier below it.
- Instanced props (trees, grass, bushes, rocks, houses) are a single `Body` node with the base at the origin.
- `assets/models/manifest.json` is generated, never hand-edited, and a module docstring naming a model's nodes and caricature stays true when the model changes.
- A model is done when an inspected image shows what was intended, not when the build succeeds. Clipping, backwards parts and shapes a reader cannot name are found in the image or not at all — the checklist is in the skill.

Art direction, per-family triangle and file budgets, the full node and material contract, and the `common.py` helper catalog: `dev-3d-models` skill.
