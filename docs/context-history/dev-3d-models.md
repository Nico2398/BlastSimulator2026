# History — dev-3d-models

This file records why the rules in the `dev-3d-models` skill (and its references) exist.

## ▶ The visual loop — the first render is a draft

**Budget at least two rebuilds.** Issue #1010 took three rounds, and every round was opened by
something only the image could say. Round 1's dark concrete bunker was the wrong idea outright.
Round 2 read as the cage it was meant to be, but its searchlight beam rendered as a white blob
swallowing the tower and its tower cap was so shallow it read as a mortarboard. Round 3 fixed a
mattress running 0.25 m out through the back wall, a toilet with its cistern facing into the room
and its bowl tapered like a bucket, and a ball-and-chain a reader could only describe as "a black
circle on the ground". None of that is visible in the Python, in the triangle count, or in a green
`ModelAssets` run.

### ▶ What to check, because "does it look good" fails nobody

- Name every shape: #1010's ball and chain read as "a black circle" — its chain was too thin to see, so the sphere explained nothing, and cutting it beat enlarging it.
- Say which way each part faces: #1010's toilet had its cistern toward the room and its bowl toward the wall, and an inverted taper (`radius` wider than `radius2`) made the bowl read as a bucket.

### ▶ Containment is arithmetic, not eyeballing

The `Mattress` placement that failed the containment check by 0.25 m turned up only in the render (#1010, round 3).

## Performance

File sizes were measured at 90 models, before the charging trucks and vanity projects were added.

## references/model-catalog.md

The vanity-project models came from #1948.

## Skinned workers

The crew used to be rigid parts on pivot Empties (`Head`, `Torso`, `ArmL`…) swung by `CharacterMesh`: a floating
head on an egg body, capsule limbs, no elbows or knees, which players read as robots. They were rebuilt as one
skinned body per role on a skeleton (`character.py`), posed procedurally at runtime (`src/renderer/character/`).
Motion is computed, not baked: baked clips for eight motions would have added 100–200 KB per worker and pushed every
worker past the 400 KB asset budget, and a fixed clip cannot match its stride to the mesh's actual speed. Float skin
weights alone took a worker to 480 KB, which is why `export_glb` rewrites them as normalized u8. `boolean()` now
applies and deletes its cutter because the Blender 5 glTF exporter shipped a hidden cutter as a stray box in the
driver's wrench. Two rounds of independent critique (design, modeling, animation, readability) drove the second
pass: smaller raised hats, a garment tint apart from the role tint, per-role heads and bodies, lids that shut fully,
a panic face, the dropped tool and knocked-off hat on collapse, and a thicker character outline.

## Rebuild determinism

The pipeline claimed byte-identical rebuilds and did not deliver them: under Blender 5's `bpy`, two builds of an
unchanged model produced the same vertices and triangles in a different face order, so every rebuild rewrote the
index buffers of every model, workers and vehicles alike. `finish()` now sorts faces before saving and exporting.
Only the workers were rebuilt with it; the rest of the set picks it up on its next rebuild.

## Eyes, lids and brows

Players saw the eyes flicker and the eyeball poke through the brow. Measured with a triangle-intersection pass over
every face part in ten face states: the lid was an ellipsoid cap hinged off-centre, so a blink swept it through the
white and the brow; the painted iris and highlight sat close enough to the white for their facets to cross it; the
brow ignored the lids. The fix made the eye round in side profile and the lid a shell of revolution about its own
hinge axis, so a blink is a symmetry of the shell and keeps its gap; stacked the painted layers with a measured
lift each; conformed the brow over the lids and pivoted it at its outer end.

## Verify a model change — the whole suite (Nov 2026)

The page told a session to detach the whole `npm run test` suite (~500 s then). The model contract is proven by the model test files run by name; the whole suite is CI's.

## Portraits follow their model (Nov 2026, #2241)

The UI started showing a picture of every worker role, vehicle role and tier, and building type and tier — the
inspector header and every card in the central windows. The pictures are rendered from the same `.glb` by
`npm run thumbs:build` (`thumbs.html`, `src/thumb-studio.ts`) and committed under `public/thumbs/`, so a model change
that skipped them would leave the card showing the old model. The change procedure gained the step that re-renders
the touched id's portrait and reads it, and the commit it closes on carries the portrait with the `.glb`.
