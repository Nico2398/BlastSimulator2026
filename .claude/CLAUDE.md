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
| Rules | `.claude/rules/*.md` | Path-scoped rules load when you touch matching files; unscoped ones every session | Hard invariants per area of the tree |
| Skills | `.claude/skills/*/SKILL.md` | On demand, by task relevance or `/name` | Domain specs, procedures, conventions |
| Agent definitions | `.claude/agents/*.md` | When that agent runs | Role, procedure, tool budget, preloaded skills |

Never restate content across layers. Reference it by name.

## Skills

Prefix categories:
- `gameplay-*` — game mechanics specs (blast, buildings, navmesh, survey, vehicles, employee skills/needs, game design)
- `dev-*` — architecture, coding conventions, testing strategy, visual testing
- `agentic-*` — pipeline orchestration, decision autonomy, context authoring, issue creation

**Skills-First:** before any task, load related skill(s) for domain rules, procedures, and constraints.

## ▶ Autonomous pipeline sessions

The project takes one human input: a GitHub issue. Filing one starts nothing, and neither does labelling it. `ready` means the issue is **eligible** — it joins the queue and waits there. A run starts in exactly two ways, and no others: a human dispatching `agentic-trigger.yml`, or a merged pipeline pull request chaining to the next `ready` issue. Nothing on a schedule and no issue event ever starts a session. Once started, a run carries its issue to a merged pull request or to a stated blocker, and always leaves it in a terminal state; an issue left holding `in-progress` stalls every assignment behind it.

A session started by the autonomous pipeline — a GitHub Actions run woken by the `@claude` mention in a pipeline assignment comment — is not an ordinary session. Its first action is to hand the task to the `orchestrator` agent, which classifies it and delegates every step to specialists. Never implement a pipeline-assigned task in the main session, and never explore the codebase before the orchestrator has classified it. The `/agentic-run` command carries that mandate; the system around it is described in `agentic-autonomous-pipeline`.

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

**The other three channels can all pass on an unplayable game.** They drive the simulation through `src/console/`, which has commands no button exposes — so a feature can be fully correct in the model and completely unreachable by a player. `visual`'s interaction-mode scenarios are the only channel that plays the game: a `role: 'player'` scenario step can never fall back to a console command (`checkStepActionAllowed`, `scripts/shared/interaction-executor.ts`), so a click that cannot complete fails the scenario and names the blocking control. Procedures live in the `dev-visual-testing` skill; step roles in `.claude/rules/scenario-defs.md`.

**You have vision.** Screenshots are readable evidence: capture the PNG, then open it with the Read tool and describe what is actually on screen. A rendering change is unverified until an image has been inspected — a green test suite proves the logic, not the picture. Procedures live in the `dev-visual-testing` skill.

**When a channel is genuinely unavailable** (no browser, dev server unreachable, screenshots never written), say so explicitly and mark the work unverified for that channel. Never substitute a state JSON dump for an image you were unable to inspect, and never report PASS for a channel you did not run.

## ▶ Claude Code only — some channels belong to CI, not to your session

**Deliberately not mirrored into `.github/copilot-instructions.md` or `.opencode/AGENTS.md`.** Entry points are the one layer whose bodies are allowed to diverge — each runtime holds its own, and `validate:context` checks only that all three name the same gates and channels, not that they read alike. This section describes how *this* runtime executes: long-running processes it starts in the background and watches across turns. The other two runtimes drive their harnesses differently, so their authors decide their own wording. Its absence there is intentional; do not sync it.

Without a GPU the terrain material costs ~6 s **per frame** in software rasterisation (#475). Loading a level is cheap — a `new_game` is ~4 s and a campaign start ~16 s. What is expensive is *waiting on frames*: the browser harnesses poll the page over CDP, and every such call waits a full frame, so a single player action costs tens of seconds and an interaction-mode scenario beat costs minutes. That is long enough that a session watching one concludes it hung, kills it, and reports a stall that never happened.

The game's own simulation is not the cost — turning ticking off changes the frame by 1.7%. Do not go looking for it in world size, navgrid rebuilds, or terrain generation.

| Run | Where |
|-----|-------|
| `typecheck`, `test`, `scenarios` (command mode) | Either. CI runs all three on every push and PR. |
| `screenshot`, one named scenario in interaction mode | Your session — this is the visual channel's working loop. |
| `build` (production bundle) | CI job `Production build` on push/schedule/dispatch, or PRs labeled `build-check` or `full-ci`. |
| All scenarios in interaction mode | CI job `Scenarios (interaction mode)` (label the PR `full-ci`). |

The interaction-mode job is gated behind the `full-ci` label because the terrain material costs ~6.4 s/frame without a GPU (#475): the harness waits on the render loop for every probe, so one beat costs minutes. It adds ~30 minutes to the merge path, so the label goes on a PR whose change an interaction-mode scenario actually drives, or which touches machinery every scenario runs through — not on every diff that a player can see. `agentic-pipeline-pr-management` holds the test and the cost.

The `Production build` job is gated behind `build-check` (or `full-ci`, which already implies it) because it doesn't need proving on every diff — `typecheck` already catches what would break the bundle far more often than a Vite-specific build failure does. Apply `build-check` when a change touches build config (`vite.config.ts`, `tsconfig*.json`, `package.json`'s dependencies) or anything about bundling/chunking itself.

Push, then read the CI job — its result *is* the channel's result, and its artifacts carry the FAIL screenshots. Locally, run one named definition you are actively debugging, never the whole suite.

A channel that belongs to CI is **covered**, never pending: an autonomous run marks its PR `READY TO MERGE` and the merge machinery waits for the job and decides on its result. Handing a channel to CI is not a reason to withhold the marker — `agentic-pipeline-pr-management` again.

**While any browser-driven run is in flight: change no file** (Vite reloads the page and kills the run with `Execution context was destroyed`, which looks like a game bug and is not), **start no second browser harness**, and **wait for the run's own terminal line**. Slow is not stuck. A run you interrupted produced no result — report the channel as pending CI, never as passed.

## ▶ Capability Gate

Before acting, check whether the task needs a capability you lack (audio playback, binary analysis, a network the sandbox blocks) or asks you to write outside allowed directories. If so, state the gap and the agent or tool that covers it instead of improvising a workaround. Vision, browser automation, and shell are available — those are not gaps.

## Validation Commands

```bash
npm run verify:env      # which verification channels are live
npm run validate        # TypeScript → coverage → integration → scenario defs → build
npm run test            # Vitest unit + integration
npm run scenarios       # all scenarios, command mode, no browser
npm run dev             # dev server on :5173, required by the visual channel
npm run console         # interactive gameplay REPL, no browser
```

Full command reference: `dev-testing-strategy` and `dev-visual-testing` skills.
