---
name: agentic-pipeline-full
description: >
  Full pipeline for a new feature, a rendering or UI change, or a pipeline or
  documentation change: the TDD cycle (`agentic-pipeline-tdd`), the visual
  feedback loop for a player-facing change, then finalization
  (`agentic-pipeline-finalization`). A change that touches no executable code
  takes the docs-only path instead.
---

## ▶ PROCEDURE — EXECUTE IN ORDER

```
[ ] = a step the lead runs itself  |  @agent = a delegation

 1. TDD cycle            → `agentic-pipeline-tdd`, label = <issue>-<runId>.
                           Ends on pipeline/feature-<label> with `verify` green.
 2. [visual-loop]        → When `verify` prints `OWED visual`, or the issue's Verification
                           section asks for a screen to be looked at. Neither → skip it:
                           no @visual-tester. See "Visual feedback loop" below.
 3. [refactor]           → The lead cleans its own diff: duplication, long functions,
                           names, stale comments, a missing mirrored test — no behaviour
                           change. Commit `refactor: <what> (#<issue>)`, then `verify`.
                           Nothing to clean → skip.
 4. [context]            → The lead updates the skills, rules and README a change in
                           project logic made stale (`agentic-context-edition`), mirrored
                           to all three runtimes. No project logic changed → skip.
 5. Finalization         → `agentic-pipeline-finalization`.
```

Refactor and context upkeep run **before** review, so the reviewer reads the diff that ships.

### Docs-only path

A change that touches no executable code — skills, rules, agent definitions, README, docs — has no behaviour to test and no TDD cycle: `git checkout -b pipeline/feature-<label> main`, write `.agentic/plan/<label>.md` (its Contract and Approach, `agentic-pipeline-tdd`'s format — the reviewer reads it and `open-pr` posts it), make the change, commit, `npm run pipeline -- verify` (it runs the `context` channel), then finalization. The moment the change needs a script, hook or workflow edit it is code, and takes the TDD cycle.

### Visual feedback loop

```
LOOP:
  a. @visual-tester → Capture and inspect the frames that show the change.
                      Brief, per check: the scenario and the steps to capture
                      (`--screenshot-steps`), or the console setup of a screen
                      (`npm run screenshot`). Checks: what the issue's Verification
                      section calls for, the definitions under scripts/scenario-defs/
                      the diff adds or changes, and any screen the change alters.
                      Never every step of a scenario, never the whole suite — whether
                      each scenario still plays is CI's interaction run, on every
                      pull request. Returns VISUAL: PASS, VISUAL: FAIL, or VISUAL: BLOCKED.
                      BLOCKED → halt and escalate (the orchestrator's hard constraints).
                      PASS → exit the loop.
  b. [fix]          → The lead fixes ALL reported issues on pipeline/feature-<label>,
                      commits `visual: <what> (#<issue>)`.
  c. [verify]       → npm run pipeline -- verify
  d. goto (a)       → while fewer than 3 iterations have run and the loop budget is open.
```

- **Volumetric iterations fan out.** Five or more screenshots to capture and read back, or five or more scenario definitions to adapt, is a parallel batch wave — `agentic-pipeline-tdd`'s "Volumetric work goes out in parallel batches" holds the procedure.
- Each iteration re-captures the same steps and reports what remains. The visual-tester's report is words, never images: the screenshots stay in its context.
- Three iterations is the cap, and the loop budget closes the loop sooner. A failure still present after the last iteration goes on the PR the way any red channel does — `agentic-pipeline-pr-management`.

### Failure loops

| Failure at | Loops back to |
|------------|--------------|
| TDD cycle | `agentic-pipeline-tdd`'s failure handling |
| [visual-loop] VISUAL: FAIL | the lead fixes, next iteration |
| [visual-loop] VISUAL: BLOCKED | **halt** — escalate |
| [refactor] turns `verify` red | revert the refactor commit or fix it; never ship a red refactor |
| Finalization | `agentic-pipeline-finalization` |
| Any step × 7 | Comment the history on the issue, stop with `ESCALATED: human intervention required` |

History: docs/context-history/agentic-pipeline-full.md
