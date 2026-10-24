---
name: agentic-pipeline-tdd
description: >
  The TDD cycle every code-producing pipeline runs: the lead plans and writes the
  skeleton, a test-writer writes RED tests from the plan's Contract in a separate
  worktree while the lead is blind to them, the lead implements, and `tdd join`
  assembles the feature branch. Covers the plan format, the blind phase, the fix
  loop, branch naming and volumetric fan-out.
---

## ▶ PROCEDURE — EXECUTE IN ORDER

```
[ ] = a step the lead runs itself  |  @agent = a delegation

 1. [plan]       Read the issue; locate the code it reaches (grep, then read the ranges).
                 Write the plan to `.agentic/plan/<label>.md` in the format below.
 2. [start]      npm run pipeline -- tdd start --label <label> [--base <branch>] [--feature <branch>]
                 → you are on pipeline/impl-<label>
 3. [skeleton]   The public API only: new types, signatures, stubs that throw
                 `not implemented`, config constants, registrations. No logic, no tests.
                 Commit: `skeleton: <what> (#<issue>)`.
 4. [split]      npm run pipeline -- tdd split --label <label>
                 → prints the tests worktree; the blind phase opens
 5. @test-writer Brief: issue, label, worktree path, the plan's Contract section verbatim.
                 Returns `RED: PROVEN` and a commit. `NOT PROVEN` → re-delegate once with
                 the problems it named; still not proven → escalate.
 6. [implement]  Blind, on pipeline/impl-<label>: implement the Contract. Keep the existing
                 suite green — `npm run pipeline -- verify --only static` and the single test
                 files your change reaches. Commit: `implement: <what> (#<issue>)`.
 7. [join]       npm run pipeline -- tdd join --label <label>
                 → pipeline/feature-<label> = base + skeleton + tests + implementation;
                 the blind phase closes
 8. [green]      npm run long -- start verify -- npm run pipeline -- verify
                 npm run long -- wait verify        (repeat while it exits 75)
                 VERIFY: FAIL → the fix loop below
```

The script refuses every step out of order — no skeleton commit, a skeleton that writes tests, a join before RED or before an implementation commit, a dirty tree — and says what is missing.

### The plan

```markdown
# Plan — #<issue> (<label>)

## Contract
- Criteria: C1 <checkable statement>, C2 … — from the issue's acceptance criteria and Verification list
- API: <file>: <signature> — every symbol, console command and state field the skeleton declares
- Edge cases and rejections: …
- Tests go in: <paths> (mirroring the source path); scenario definitions when a player-facing flow changes

## Approach
- Files to change and why; the existing unit reused or generalized (`dev-design-principles`)
- Decisions taken (`agentic-decision-autonomy`)
- Channels owed

## Progress
- <step> done — <commit sha> — next: <step> — open: <failures, decisions pending> | none
```

`## Progress` is written by `npm run pipeline -- step`, one line per finished step, and is what `restore-after-compact.mjs` hands back after a compaction. The test-writer receives the Contract and nothing else. The Contract says **what** the change must do, never how: an implementation detail in it reaches the tests and pins them to one design. The reviewer receives the whole plan.

### The blind phase

From `split` until `join` the lead does not see the tests: `blind-to-tests.mjs` refuses every file and shell tool call that reaches the tests worktree or branch, from every session but the test-writer's, and the test-writer's report names files and criteria, never test content. The implementation is therefore shaped by the Contract alone, and the tests by the Contract alone.

The test-writer works in its own worktree, so the two sides never share a working directory or an index.

### The fix loop — after the join

The lead now sees both sides. A RED test failing after the join means the implementation is wrong until shown otherwise: fix the implementation. Edit a RED test only when it contradicts the Contract as written, in its own commit `test-fix: <file> — <criterion> (#<issue>)`. `review-brief` lists every RED test edited after RED, and the reviewer rejects any edit the Contract does not support — this is the step where a test bent to fit the code would otherwise get in.

Iterate on the single failing file (`npx vitest run <path>`), then re-run `verify` once over the whole change. At most seven fix iterations, and none starts once the loop budget is closed (`agentic-autonomous-pipeline`).

### Branch naming

Caller provides a `<label>` and optionally a base branch (default `main`):

- `pipeline/impl-<label>` — skeleton + implementation, cut from the base
- `pipeline/tests-<label>` — skeleton + tests, cut from the skeleton commit, in its own worktree
- `pipeline/feature-<label>` — the deliverable and the PR head

**`<label>` is `<issue>-<runId>`, never the issue number alone.** In GitHub Actions the runner states the three branch names in the trigger prompt — use exactly those; in a CLI session pick `local-$(openssl rand -hex 4)` once for the run.

- **Never reuse a branch from an earlier run, and never force-push over one.** `tdd start` refuses an existing label or branch.
- Commit messages cite the **issue**, not the label: `<role>: <what> (#<issue>)`.
- Everything that matches a branch — assignment, watchdog, rescue, auto-merge — accepts `pipeline/feature-<issue>` and `pipeline/feature-<issue>-<anything>` alike.

A multi-pipeline section uses `<run-label>-s<K>` with `--feature pipeline/feature-<run-label>`, and `--base pipeline/feature-<run-label>` from the second section on: every section joins onto the one shared feature branch.

### ▶ Volumetric work goes out in parallel batches

A step is **volumetric** when it is the same transformation applied to N independent files — scenario definitions to adapt to a new pacing, locale keys to add, call sites to migrate, screenshots to read back.

**At N ≥ 5 independent items, fan out. Do not iterate.**

1. **Split** the items into batches of 5–10, disjoint by file. A file appears in exactly one batch.
2. **Delegate every batch in a single message**, foreground, and await them all in that same turn — a result that arrives after the turn ends is never delivered. At most 8 batches in flight; send the next message when they return.
3. **Each batch agent edits its own files and commits nothing.** Two agents committing in one worktree race over the index. The lead commits once, after the wave.
4. **Shared files are never batched.** `balance.ts`, `GameState.ts`, an i18n locale — the lead edits those first and tells each batch the new shape.
5. **Verify once over the whole set** — one `verify` after the wave.
6. **Report what each batch did**, so a failed batch is re-sent rather than the wave repeated.

| Work | Batch agent |
|------|-------------|
| Tests and scenario definitions, during step 5 | @test-writer in batch mode — it stops before `tdd red`, and the lead runs `npm run pipeline -- tdd red --label <label>` once for the wave (its output names files, counts and error codes only; a `RED NOT PROVEN` goes back to the batch that owns the named file) |
| Production call sites, during step 6 | @batch-worker — blind like the lead |
| Screenshots to capture and read back | @visual-tester |

**Sequential is still right for a dependent chain.** Skeleton → tests → implementation is ordered by construction; it is the inside of one step that parallelises.

### Failure handling

| Failure | Next |
|---------|------|
| A script step refuses | Do what it names, re-run it |
| RED not proven twice | Escalate: comment the problems, `ESCALATED: RED could not be proven` |
| Join conflict | Resolve so both sides survive, `git add`, `git cherry-pick --continue`, re-run `tdd join` |
| `VERIFY: FAIL` | The fix loop |
| Seven failures of one step | Comment the history on the issue, stop with `ESCALATED: human intervention required` |

History: docs/context-history/agentic-pipeline-tdd.md
