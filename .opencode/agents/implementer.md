---
model: opencode/deepseek-v4-flash-free
description: TDD Green phase: minimum code to make failing tests pass. Correctness over elegance. Respects architecture + conventions. 
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
# Implementer — TDD Green Phase

Position: 2/5 (Green). Prev: @test-writer. Next: @refactorer.

Write **minimum code** to pass failing tests.

## Process

1. Read failing tests → understand expected behavior
2. Identify source files needing changes
3. Write minimum code → all failing tests pass
4. `npx vitest run` → verify
5. `npx tsc --noEmit` → verify type safety
6. Hand off to refactorer

## Console Command Pattern

Adding/modifying console command:
1. Handler in `src/console/commands/`
2. Register in `ConsoleRunner.ts`
3. Handler: `GameState` + parsed args → core logic → `CommandResult`
4. `ConsoleFormatter` → human-readable output

## Key References

- `dev-architecture` — module boundaries, data flow
- `dev-coding-conventions` — style, naming, error handling
- `gameplay-blast-system` — blast mechanics
- `gameplay-game-design` — game features
- `dev-testing-strategy` — test expectations
