# BlastSimulator2026

Satirical open-pit mine management game (Theme Hospital meets capitalism). Cartoon 3D visuals, blast physics, union strikes, mafia, lawsuits.

TypeScript strict + Three.js + cannon-es, Vite, Vitest. `src/core/` holds side-effect-free simulation; `src/renderer/` and `src/ui/` draw it; `src/console/` drives the same core headlessly. Architecture detail lives in the `dev-architecture` skill.

## How to read all context files

CLAUDE.md, rules, agent definitions, and skills all use this convention. Two kinds of content. Obey their rules:

### ▶ INSTRUCTION blocks
- Marked by: `▶` prefix, numbered step lists, or the word "PROCEDURE" in a header
- **Meaning:** execute immediately, in order, without deviation
- **Failure to follow = agent failure.** Not optional. Not background.
- Examples: pipeline steps, operating procedures, verification gate checks

### KNOWLEDGE blocks
- Everything else: descriptions, reference tables, conventions, domain explanations
- **Meaning:** understand, internalize, apply when making decisions
- Not directly executable — informs judgment, does not override INSTRUCTION blocks

**When in doubt between the two:** if the block contains verbs directed at YOU ("delegate", "run", "check", "verify"), treat it as INSTRUCTION.

## Context layers

Context loads progressively. Reach for the narrowest layer that answers the question.

| Layer | Location | When it loads | Holds |
|-------|----------|---------------|-------|
| This file | `.claude/CLAUDE.md` | Every session | Project identity, verification gate, layer map |
| Rules | `.claude/rules/*.md` | Path-scoped rules load when you touch matching files; unscoped ones every session | Hard invariants per area of the tree, mirrored to `.github/instructions/` and `.opencode/rules/` |
| Skills | `.claude/skills/*/SKILL.md` | On demand, by task relevance or `/name` | Domain specs, procedures, conventions |
| Agent definitions | `.claude/agents/*.md` | When that agent runs | Role, procedure, tool budget, preloaded skills |

Never restate content across layers. Reference it by name.

## Skills

Prefix categories:
- `gameplay-*` — game mechanics specs (blast, buildings, navmesh, survey, vehicles, employee skills/needs, game design)
- `dev-*` — architecture, design principles, coding conventions, testing strategy, visual testing, scenario authoring
- `agentic-*` — pipeline orchestration, decision autonomy, context authoring, workflow authoring, issue creation

**Skills-First:** before any task, load related skill(s) for domain rules, procedures, and constraints.

## ▶ Autonomous pipeline sessions

The project takes one human input: a GitHub issue. Filing one starts nothing, and neither does labelling it `ready` — that marks the issue **eligible**, and it waits in the queue. A run starts in exactly four ways, and no others: a human dispatching `agentic-trigger.yml`, a merged pipeline pull request chaining to the next `ready` issue, a run that halted chaining past itself through `handle-failure.yml`, or a run that closed its own issue chaining through `agentic-chain-on-close.yml`. Nothing on a schedule starts a session, and the only issue events that do are the `blocked` and `paused` labels and an `agent-task` issue closing. Once started, a run always leaves its issue in a terminal state, and there are four: a merged pull request, `paused` behind a dependency it filed (the issue returns to `ready` and the queue comes back to it once that dependency lands), `blocked` on a question only a human can answer, or closed and `done` when the deliverable was an answer rather than a diff — that last one releases the queue through the close, not through a merge that never happens. An issue left holding `in-progress` stalls every assignment behind it.

What may be assigned is decided in one place, `.github/scripts/assignability.cjs`, and every rule in it fails closed: an issue is skipped when it already has an open pull request, when a declared dependency is open, abandoned, or closed with its pull request still unmerged, and when a dependency cannot be read at all. One open pull request does not skip it: a draft labelled `paused` is a halted run's deliberate handover, and the next run is told to continue that branch rather than build its own. Dependencies come from GitHub's own `blocked_by` relationships, which are the authority, unioned with the issue body's `Blocked by` section, which is read strictly so that quoting an issue does not block on it. Chaining from a halt is bounded by a cascade brake — `AGENTIC_BLOCKED_CHAIN_LIMIT` runs ending `blocked` or `paused` since the last pipeline merge parks the queue instead of working through the backlog. Details in `agentic-autonomous-pipeline`.

A session started by the autonomous pipeline — a GitHub Actions run woken by the `@claude` mention in a pipeline assignment comment — is not an ordinary session. Its first action is to hand the task to the `orchestrator` agent, which classifies it and delegates every step to specialists. Never implement a pipeline-assigned task in the main session, and never explore the codebase before the orchestrator has classified it. The `/agentic-run` command carries that mandate; the system around it is described in `agentic-autonomous-pipeline`.

That mandate is for a pipeline-dispatched run specifically. Any session that touches a numbered issue — including one opened directly against it, with no `/agentic-run` in sight — still owns getting its branch, PR and labels right before ending, whether or not it ever enters the orchestrator: `agentic-autonomous-pipeline`'s before-ending checklist binds regardless of entry point, including a hard-won rule about how GitHub's own merge-time parser reads a PR body — load that skill before your last message whenever your work discusses an issue you are not closing.

## ▶ Verification Gate — RUN BEFORE CLAIMING ANY WORK DONE

Four independent channels prove a change works. Each catches what the others miss. Never report a task complete on a single channel when a second one applies.

| Channel | Command | Proves | Required when |
|---------|---------|--------|---------------|
| `static` | `npm run typecheck` | Types line up across `src/` and `scripts/` | Every code change |
| `logic` | `npm run test` | Unit + integration behaviour matches expectations | Every code change |
| `scenario` | `npm run scenarios` | Full command sequences produce the expected game state | Gameplay, console, economy, campaign changes |
| `visual` | `npm run screenshot`, `npm run scenario -- --mode interaction --screenshots` | The game renders correctly, the UI responds to real clicks, and a player can actually reach the goal by clicking — no console command stands in for a player action | Any change to `src/renderer/`, `src/ui/`, or anything a player sees; any change to a player-facing flow: tutorial, panels, hiring, skills, contracts, building, vehicles |

1. Run `npm run verify:env` when unsure a channel is usable. It reports each channel as READY or BLOCKED with the remedy.
2. Pick every channel the change touches, not the cheapest one.
3. When two channels disagree, neither result stands — investigate until they agree.
4. State which channels you ran and what each showed. "Tests pass" is not a verification report when the change was visual.
5. **"Already fixed" and "no change needed" are claims about the whole issue, not about a diff.** With no diff there is nothing to scope the channels down to, so run every channel the issue's own verification list names. A verdict of already-resolved reached on a subset of them is unproven.
6. **A channel already red before you arrived is a finding, not a precondition.** Never skip, downgrade, or discount a channel because it was failing on `main` when you started — that is how a red channel outlives the one session positioned to notice it. Fix it, or state plainly that it is red, what fails, and why you are not fixing it. Reporting work done while a required channel is red is a false report no matter who broke it.

**The other three channels can all pass on an unplayable game.** They drive the simulation through `src/console/`, which has commands no button exposes — so a feature can be fully correct in the model and completely unreachable by a player. `visual`'s interaction-mode scenarios are the only channel that plays the game: a `role: 'player'` scenario step can never fall back to a console command (`checkStepActionAllowed`, `scripts/shared/interaction-executor.ts`), so a click that cannot complete fails the scenario and names the blocking control. Procedures live in the `dev-visual-testing` skill; step roles in the `dev-scenario-authoring` skill.

**You have vision.** Screenshots are readable evidence: capture the PNG, then open it with the Read tool and describe what is actually on screen. A rendering change is unverified until an image has been inspected — a green test suite proves the logic, not the picture. Procedures live in the `dev-visual-testing` skill.

**When a channel is genuinely unavailable** (no browser, dev server unreachable, screenshots never written), say so explicitly and mark the work unverified for that channel. Never substitute a state JSON dump for an image you were unable to inspect, and never report PASS for a channel you did not run.

**▶ Passing the channels is not finishing.** Landing the work — pushing, opening the pull request, labelling it, and reading what CI says about the pushed head rather than assuming it — is its own procedure with its own failure modes. Load `dev-finishing-work` before claiming any coding task complete, and whenever a push, a pull request, or a CI result is involved.

## ▶ Claude Code only — running a command that outlives one Bash call

**Deliberately not mirrored into `.github/copilot-instructions.md` or `.opencode/AGENTS.md`.** Entry points are the one layer whose bodies are allowed to diverge — each runtime holds its own, and `validate:context` checks only that all three name the same gates and channels, not that they read alike. This section describes how *this* harness executes a long command. The other two runtimes drive their harnesses differently, so their authors decide their own wording. Its absence there is intentional; do not sync it. What is true of the project rather than the harness — which channels CI owns, how a pull request is labelled, how a CI result is read — lives in `dev-finishing-work`, where all three runtimes share it.

### ▶ There is no later turn

**A backgrounded command whose result you plan to collect later is a lost run.** The Bash tool caps one foreground call at 600 000 ms, and three of the commands this project requires sit at or past that ceiling, or close enough that a foreground call without an explicit matching timeout gets silently backgrounded by this harness's own shorter default before it ever gets near the cap — `npm run test` is ~500 s on a 2-core runner (it has grown as the suite has; do not re-classify it as "fits" from an old measurement), `npm run scenarios` is ~9 m 20 s in a sandbox and slower on a 2-core runner, `npm run ci:await` waits as long as CI takes. So they have to be detached. *How* you come back for the result is what decides whether the run survives.

An unattended session — a GitHub Actions runner, Claude Code on the web — gets **one turn**. When that turn ends the process exits. A background-task notification is delivered on a later turn, and there is no later turn, so it is never delivered at all. Everything not yet pushed dies with the VM. This is the same rule that already governs delegation (`require-foreground-agents.sh`, issues #404 and #406), arriving through the shell instead of through a sub-agent. It cost three runs in four days:

| PR | How the turn ended | Cost |
|----|--------------------|------|
| #604 | "Scenario verification is running in the background — pausing here until it reports back." | 3 h 11 m and $30.55 of finished TDD work, discarded. Its retry repeated it in 2 m 51 s. |
| #594 | "Waiting for the background vitest run — will be notified automatically." | Both attempts, same sentence. |
| #603 | Never ended the turn — hand-rolled `timeout 280 bash -c 'until ! ps -p <pid>…'` 40+ times instead. | The whole 360-minute job budget spent polling, then the job timeout, with no budget left to retry. |

**The rule.** Run it in the foreground when it fits — pass an explicit `timeout` up to 600000. When it does not fit, use the one wrapper that can be waited on inside this turn:

```bash
npm run long -- start scenarios -- npm run scenarios
npm run long -- wait scenarios      # blocks one bounded slice
```

**Pass an explicit `timeout` on every one of these calls, `wait` included — never rely on the tool's own default.** The harness backgrounds a foreground Bash call that outruns its default per-call timeout, which is shorter than 600000 ms and shorter than `wait`'s own internal ~540s polling budget: a `wait` call issued with no explicit `timeout` argument can itself be moved to the background before it ever gets to report FINISHED or `75`, which reproduces the exact failure this wrapper exists to prevent, one level up. Pass 600000 explicitly on every `start`/`wait` call.

`wait` exits `75` while the command is still going. **That is not a failure and not a verdict** — call `wait` again, in this same turn, as many times as it takes, until it prints `FINISHED` and the command's own exit code. Then act on that code.

Two hooks enforce this, because prose did not hold: `require-foreground-bash.sh` refuses a `run_in_background` Bash call or raw `nohup`/`setsid`/`disown`/trailing-`&` detach, and `require-settled-turn.sh` refuses to let a turn (or a sub-agent's turn) end while a `npm run long` handle is unfinished. A human at an interactive CLI, where a later turn genuinely exists, can set `AGENTIC_ALLOW_BACKGROUND_BASH=1`; no pipeline workflow sets it.

**Slow is not stuck.** Without a GPU a browser-driven run costs minutes per scenario beat (#475) — long enough that a session watching one concludes it hung, kills it, and reports a stall that never happened. Wait for the run's own terminal line, in this turn, through `npm run long -- wait`, never by ending the turn on it. `dev-finishing-work` holds the cost breakdown, the rules for a run in flight, and which channels CI owns.

## ▶ Capability Gate

Before acting, check whether the task needs a capability you lack (audio playback, binary analysis, a network the sandbox blocks) or asks you to write outside allowed directories. If so, state the gap and the agent or tool that covers it instead of improvising a workaround. Vision, browser automation, and shell are available — those are not gaps.

## ▶ Follow-up Gate — work you found that is not your task

Sort a finding by **size** and by **whether it is in your way**. Those two questions decide everything; the label on the finding does not.

| You found | You do |
|-----------|--------|
| Something small enough to fix where you stand — a wrong path, a stale comment, a one-line guard, a missing type | **Fix it.** No issue. A separate issue for a two-minute fix costs a whole run to deliver. |
| Duplication, a long file, a naming slip, a missing mirrored test — **in code this run wrote** | **Fix it here.** That is what the refactor phase is for. Filing it defers a five-minute fix into a whole run. |
| The same shape of finding, in code this run only read | **Record it.** It goes in the run's follow-up comment, where a human or a later run can promote it — `agentic-pipeline-finalization` holds the filing gate |
| An existing unit your change could reuse with a small generalizing edit | **Edit it here.** Behaviour-preserving for its current callers and covered by their tests, so it is part of your change — never pre-existing debt to record around while copying the logic — `dev-design-principles` |
| A defect — behaviour that is observably wrong, or a verification channel that fails to prove what it claims | File it — `agentic-issue-creation`. This is the finding the mechanism exists for. |
| Something in your way that you can **work around** | File it, then bypass it with a `TODO(#N)` naming that issue, and finish your task on the bypass. The filed issue removes the bypass when it lands. |
| Something in your way with **no way around it** — your task cannot be delivered at all | File it, then **pause**: your issue returns to `ready` with the new issue as its `Blocked by`, and any work already done goes on a draft PR labelled `paused` — `agentic-decision-autonomy` |
| A default you chose that a human may want to revisit | File the decision — `agentic-decision-autonomy` |
| That your own task is bigger than one run | File the scope you cut, so the remainder is not lost — `agentic-issue-creation` |

**Filing never halts you.** It does not hold your PR, downgrade it to draft, or leave your own issue non-terminal. Fix what your change exposes; file the rest. If your tools block `gh`, hand the finding to whoever invoked you.

**One issue per run.** The gate is a cap as well as a filter: a run files at most one issue for what it found, on top of whatever a bypass, a pause or a scope cut structurally requires — those carry a `TODO(#N)` or a named remainder, and dropping them leaves the codebase pointing at nothing. Everything else goes in the follow-up comment. A pipeline that files as fast as it merges spends its throughput on itself; the measured cost of doing so is in `agentic-pipeline-finalization`.

**A convention a machine can check is never issue material.** A convention worth holding is worth a lint test under `tests/unit/lint/` — enforce it there rather than re-discovering it once per pull request. File cohesion (single responsibility) is deliberately not one of these: no lint test owns it, so it is ordinary Follow-up Gate material like the table above, per `dev-coding-conventions`. What earns an issue is a defect — `agentic-issue-creation` holds the boundary.

**A blocker in your path is not automatically the end of your run.** Reach for the bypass before the pause: a `TODO(#N)` that keeps the rest of the task deliverable is worth far more than a run that stops with nothing landed. Pause only when there is genuinely nothing left to deliver. And `blocked` is narrower still — it is for a question only a human can answer, never for work another issue will do.

## Validation Commands

```bash
npm run verify:env      # which verification channels are live
npm run validate        # TypeScript → coverage (thresholds) → full suite → build
npm run test            # Vitest unit + integration
npm run scenarios       # all scenarios, command mode, no browser
npm run dev             # dev server on :5173, required by the visual channel
npm run console         # interactive gameplay REPL, no browser
npm run qualimetry      # jscpd duplication across src/, scripts/ — ceiling in .jscpd.json
npm run qualimetry:diff # duplication introduced by this branch's own diff (10% ceiling)
npm run test:coverage   # per-file coverage thresholds (vitest.coverage.config.ts)
npm run check:i18n      # en.json / fr.json parity
npm run check:dead-code # files and exports nothing imports
```

Full command reference: `dev-testing-strategy` and `dev-visual-testing` skills.
