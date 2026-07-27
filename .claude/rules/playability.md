---
paths:
  - "src/ui/**/*.ts"
  - "src/core/entities/Employee*.ts"
  - "src/core/campaign/**/*.ts"
  - "scripts/playtests/**/*.json"
  - "scripts/playtest.ts"
  - "scripts/shared/playtest-*.ts"
---

# Playability

A feature that works in `src/core/` and has no button is not a feature. The console can do things the UI cannot, so `logic`, `scenario`, and `static` all pass on a game no player can play. Changes here require the `playability` channel.

## ▶ PROCEDURE

1. Start the dev server: `npm run dev &`
2. Run the harness: `npm run playtest -- tutorial --screenshots`
3. On a blocked beat, read the printed reason and hint, then **open the `FAIL-NN.png` with the Read tool**.
4. Fix the game. Change the playtest definition only when it described the wrong player behaviour.
5. Re-run until every beat passes, and report `N/N beats reached`.

Diagnosis order, the probe bridges, and the definition format: `dev-playability-testing` skill.

## Invariants

- **A playtest may only run `new_game`, `campaign`, `tutorial_start`, `tick`, `time`.** Every other action must be clicked. A console command standing in for a player action turns "no player can do this" into PASS — which is exactly how an unobtainable qualification survived four green channels.
- Never widen the allowlist to get a playtest green. A step that needs a command is a missing button, and the missing button is the finding.
- Every action a skill gate requires must be obtainable in game. If a qualification, licence, or proficiency level has no button and no in-game path, say so — an unreachable gate is a dead end, not a difficulty setting.
- Panels that own a `TileSelectOverlay` scope element lookups to their own root. Ids are reused across pickers, so `document.getElementById` can resolve to a closed one.
- A tutorial step advances only on genuine completion. The tutorial never runs the player's commands for them; `autoCommands` is for scripted demonstrations only.
