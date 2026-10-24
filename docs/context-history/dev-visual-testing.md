# History — dev-visual-testing

This file records why the rules in the `dev-visual-testing` skill exist.

## ▶ What to run here, and what to leave to CI

The ~6 s/frame software-rasterisation cost of the terrain material is tracked in #475 (open at the time of writing). Ticking was measured at 1.7% of a frame, which ruled the simulation out as the cost.

## ▶ Diagnosing an interaction-mode step that cannot complete

A real failure this diagnostic order was built to catch: `hireEmployee` created every employee with `qualifications: []`. Surveys require a `geology` qualification, so a hired surveyor could not survey. `logic` and `scenario` were both green — the unit tests granted the skill with `assignSkill`, and the console-mode scenarios did the same. The model was correct; the game was unplayable, and only a real click caught it.

## Supporting Checks

`npm run a11y` came from #1419.
