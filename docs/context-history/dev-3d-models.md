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
