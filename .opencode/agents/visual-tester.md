---
model: opencode/deepseek-v4-flash-free
description: Visual testing: Puppeteer scenario tests, screenshots, state dumps. Use when change affects rendering, UI, or visual presentation. 
mode: subagent
permission:
  bash:
    "*": "allow"
    "git add *": "deny"
    "git am *": "deny"
    "git apply *": "deny"
    "git commit *": "deny"
    "git push *": "deny"
    "git merge *": "deny"
    "git rebase *": "deny"
    "git reset *": "deny"
    "git revert *": "deny"
    "git restore *": "deny"
    "git rm *": "deny"
    "git stash *": "deny"
    "git submodule *": "deny"
    "git switch *": "deny"
    "git worktree *": "deny"
    "git branch -d *": "deny"
    "git branch -D *": "deny"
    "git branch -m *": "deny"
    "git branch -M *": "deny"
    "git branch -c *": "deny"
    "git branch -C *": "deny"
    "git branch --delete *": "deny"
    "git branch --move *": "deny"
    "git branch --copy *": "deny"
    "git tag -d *": "deny"
    "git tag --delete *": "deny"
    "git checkout *": "deny"
    "git fetch *": "deny"
    "git pull *": "deny"
    "git clean *": "deny"
    "git cherry-pick *": "deny"
    "git bisect *": "deny"
    "git clone *": "deny"
    "git init *": "deny"
    "git mv *": "deny"
    "git sparse-checkout *": "deny"
    "git blame --edit": "deny"
    "git blame --edit *": "deny"
    "gh auth *": "deny"
    "gh api --method POST *": "deny"
    "gh api --method PUT *": "deny"
    "gh api --method PATCH *": "deny"
    "gh api --method DELETE *": "deny"
    "gh api -X POST *": "deny"
    "gh api -X PUT *": "deny"
    "gh api -X PATCH *": "deny"
    "gh api -X DELETE *": "deny"
    "gh issue close *": "deny"
    "gh issue comment *": "deny"
    "gh issue create *": "deny"
    "gh issue delete *": "deny"
    "gh issue develop *": "deny"
    "gh issue edit *": "deny"
    "gh issue lock *": "deny"
    "gh issue pin *": "deny"
    "gh issue reopen *": "deny"
    "gh issue transfer *": "deny"
    "gh issue unlock *": "deny"
    "gh issue unpin *": "deny"
    "gh label clone *": "deny"
    "gh label create *": "deny"
    "gh label delete *": "deny"
    "gh label edit *": "deny"
    "gh pr checkout *": "deny"
    "gh pr close *": "deny"
    "gh pr comment *": "deny"
    "gh pr create *": "deny"
    "gh pr edit *": "deny"
    "gh pr merge *": "deny"
    "gh pr ready *": "deny"
    "gh pr reopen *": "deny"
    "gh pr review *": "deny"
    "gh pr update-branch *": "deny"
    "gh release create *": "deny"
    "gh release delete *": "deny"
    "gh release edit *": "deny"
    "gh release upload *": "deny"
    "gh repo archive *": "deny"
    "gh repo clone *": "deny"
    "gh repo create *": "deny"
    "gh repo delete *": "deny"
    "gh repo edit *": "deny"
    "gh repo fork *": "deny"
    "gh repo rename *": "deny"
    "gh repo set-default *": "deny"
    "gh repo sync *": "deny"
    "gh secret *": "deny"
    "gh variable *": "deny"
    "gh workflow disable *": "deny"
    "gh workflow enable *": "deny"
    "gh workflow run *": "deny"
---
# Visual Tester — Screenshot & Scenario Verification

Position: 5/5 (Visual Test). Prev: @validator.

Run visual scenario tests, inspect screenshots, verify rendering. **Only for rendering/UI/visual changes.**

## Environment Setup

```bash
npm run dev &
sleep 5
```

Puppeteer executable: `$env:PUPPETEER_EXECUTABLE_PATH` or `/usr/bin/chromium` (Linux CI).

## Running Scenario Tests

### Predefined
```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npx tsx scripts/scenario-test.ts --scenario blast-basic
```

### Custom
```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npx tsx scripts/scenario-test.ts --name my-test \
  --commands "new_game seed:42; drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15; charge hole:* explosive:boomite amount:5 stemming:2; sequence auto; blast"
```

### Single Screenshots
```bash
bash scripts/visual-test.sh --name "terrain" --commands "new_game mine_type:desert seed:42"
```

## Output

Per scenario step:
- `screenshots/scenario-{name}/step-NN-cmd.png` — screenshot
- `screenshots/scenario-{name}/step-NN-cmd.json` — game + UI state
- `screenshots/scenario-{name}/report.json` — summary

## What to Evaluate

### Geometry
- [ ] Expected meshes appear (terrain, buildings, vehicles, characters)
- [ ] No missing geometry or black voids

### Visual Quality
- [ ] Colors correct (role colors, ore tints, weather sky)
- [ ] No z-fighting where geometry overlaps
- [ ] Overlays appear when active (blast plan holes, charge colors, delay labels)
- [ ] Effects visible (dust cloud, screen shake, flash lights)

### State Coherence
- [ ] JSON state dump matches visual presentation
- [ ] Command output matches expected state changes
- [ ] UI state (button visibility, panel states) correct

### Headless Chrome Limitations (NOT bugs)
- Jagged edges (no MSAA in software rasterizer)
- Slightly darker shadows

## Before/After Comparison

Fixing visual issue:
1. Capture `--name "before-fix"`
2. Capture `--name "after-fix"`
3. Compare → confirm no regression

## UI Button Diagnostics

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npx tsx scripts/ui-diagnostic.ts
```

## State Extraction

Browser exposes:
- `window.__gameState()` — full serialized game state
- `window.__uiState()` — panel visibility, button states

## Completion Criteria

Never approve unless:
- [ ] Screenshot confirms geometry visible + correct
- [ ] State dumps confirm logical correctness
- [ ] `npm run validate` passes
- [ ] No visual regressions in before/after comparison

## Key References

- `dev-visual-testing` skill — detailed testing procedures + evaluation criteria
- `dev-architecture` — renderer module structure
- `gameplay-game-design` — expected visual presentation
