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
- `dev-*` — architecture, coding conventions, testing strategy, visual testing, playability testing
- `agentic-*` — pipeline orchestration, context authoring, issue creation

**Skills-First:** before any task, load related skill(s) for domain rules, procedures, and constraints.

## ▶ Autonomous pipeline sessions

A session started by the autonomous pipeline — a GitHub Actions run woken by the `@claude` mention in a pipeline assignment comment — is not an ordinary session. Its first action is to hand the task to the `orchestrator` agent, which classifies it and delegates every step to specialists. Never implement a pipeline-assigned task in the main session, and never explore the codebase before the orchestrator has classified it. The `/agentic-run` command carries that mandate; the system around it is described in `agentic-autonomous-pipeline`.

## ▶ Verification Gate — RUN BEFORE CLAIMING ANY WORK DONE

Five independent channels prove a change works. Each catches what the others miss. Never report a task complete on a single channel when a second one applies.

| Channel | Command | Proves | Required when |
|---------|---------|--------|---------------|
| `static` | `npm run typecheck` | Types line up across `src/` and `scripts/` | Every code change |
| `logic` | `npm run test` | Unit + integration behaviour matches expectations | Every code change |
| `scenario` | `npm run scenarios` | Full command sequences produce the expected game state | Gameplay, console, economy, campaign changes |
| `visual` | `npm run screenshot`, `npm run scenario -- --mode interaction --screenshots` | The game renders correctly and the UI responds to real clicks | Any change to `src/renderer/`, `src/ui/`, or anything a player sees |
| `playability` | `npm run playtest` | A player can actually reach the goal by clicking — no console command stands in for a player action | Any change to a player-facing flow: tutorial, panels, hiring, skills, contracts, building, vehicles |

1. Run `npm run verify:env` when unsure a channel is usable. It reports each channel as READY or BLOCKED with the remedy.
2. Pick every channel the change touches, not the cheapest one.
3. When two channels disagree, neither result stands — investigate until they agree.
4. State which channels you ran and what each showed. "Tests pass" is not a verification report when the change was visual.

**The other four channels can all pass on an unplayable game.** They drive the simulation through `src/console/`, which has commands no button exposes — so a feature can be fully correct in the model and completely unreachable by a player. `playability` is the only channel that plays the game. Procedures live in the `dev-playability-testing` skill.

**You have vision.** Screenshots are readable evidence: capture the PNG, then open it with the Read tool and describe what is actually on screen. A rendering change is unverified until an image has been inspected — a green test suite proves the logic, not the picture. Procedures live in the `dev-visual-testing` skill.

**When a channel is genuinely unavailable** (no browser, dev server unreachable, screenshots never written), say so explicitly and mark the work unverified for that channel. Never substitute a state JSON dump for an image you were unable to inspect, and never report PASS for a channel you did not run.

## ▶ Capability Gate

Before acting, check whether the task needs a capability you lack (audio playback, binary analysis, a network the sandbox blocks) or asks you to write outside allowed directories. If so, state the gap and the agent or tool that covers it instead of improvising a workaround. Vision, browser automation, and shell are available — those are not gaps.

## Validation Commands

```bash
npm run verify:env      # which verification channels are live
npm run validate        # TypeScript → coverage → integration → scenario defs → build
npm run test            # Vitest unit + integration
npm run scenarios       # all 99 scenarios, command mode, no browser
npm run playtest        # plays the game through its own UI, clicks only
npm run dev             # dev server on :5173, required by the visual and playability channels
npm run console         # interactive gameplay REPL, no browser
```

Full command reference: `dev-testing-strategy` and `dev-visual-testing` skills.
