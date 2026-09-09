---
paths:
  - "assets/models/**"
  - "public/models/**"
  - "src/renderer/models/**/*.ts"
---

# 3D Model Changes

Models are generated, not hand-modelled. The Python builders under `assets/models/blender/` are the source of truth; `assets/models/blend/*.blend` and `public/models/*.glb` are outputs, and the next `npm run models:build` overwrites both.

## ▶ PROCEDURE

1. Edit the Python builder, never the `.glb`.
2. Rebuild the ids you touched: `npm run models:build -- <id>` (needs `pip install bpy`).
3. `npm run test -- ModelAssets` — it parses the committed `.glb`, so an unbuilt source change proves nothing.
4. `npm run dev &` then `npm run models:preview -- <id>`, and **open every PNG with the Read tool**.
5. Commit the `.py`, the `.blend` and the `.glb` together.

A hand edit made in a `.blend` is ported back into its Python builder before the change is done.

## Invariants

- 1 Blender unit = 1 game unit. Z-up in Blender, exported +Y up. Origin at the ground contact point.
- Workers and vehicles face +X; buildings are centred on their footprint with the door row at +Y.
- Only direct children of the scene root are animation nodes (`Head`, `Torso`, `ArmL`, `ArmR`, `LegL`, `LegR`, `Wheel*`, `Flywheel`, `Body`). Build them with `pivot()`.
- Materials named `Tint*` are recoloured per instance; emissive materials stay separate and glow; every other colour is baked to vertex colours. No UVs, no textures, no animations in the export.
- Each tier is its own model — tier 1 improvised junk, tier 2 the plain machine, tier 3 corporate excess — and a building is taller than the tier below it.
- Instanced props (trees, grass, bushes, rocks, houses) are a single `Body` node with the base at the origin.

Art direction, per-family triangle and file budgets, the full node and material contract, and the `common.py` helper catalog: `dev-3d-models` skill.
