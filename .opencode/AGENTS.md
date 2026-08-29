# BlastSimulator2026

Satirical open-pit mine management game (Theme Hospital meets capitalism). Cartoon 3D visuals, blast physics, union strikes, mafia, lawsuits.

## How to read all context files

AGENTS.md, agent definitions, and skills all use this convention. Two kinds of content. Obey their rules:

### ▶ INSTRUCTION blocks
- Marked by: `▶` prefix, numbered step lists, or the word "PROCEDURE" in a header
- **Meaning:** execute immediately, in order, without deviation
- **Failure to follow = agent failure.** Not optional. Not background.
- Examples: pipeline steps, operating procedures, capability gate checks

### KNOWLEDGE blocks
- Everything else: descriptions, reference tables, conventions, domain explanations
- **Meaning:** understand, internalize, apply when making decisions
- Not directly executable — informs judgment, does not override INSTRUCTION blocks

**When in doubt between the two:** if the block contains verbs directed at YOU ("delegate", "run", "check", "verify"), treat it as INSTRUCTION.

## Skills

Skills in `.opencode/skills/` auto-load based on task relevance. Prefix categories:
- `gameplay-*` — Game mechanics
- `dev-*` — Software development
- `agentic-*` — Agentic workflow automation

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

## Skills-First

Before any task, load related skill(s) for domain rules, procedures, and constraints.

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

**The other three channels can all pass on an unplayable game.** They drive the simulation through `src/console/`, which has commands no button exposes — so a feature can be fully correct in the model and completely unreachable by a player. `visual`'s interaction-mode scenarios are the only channel that plays the game: a `role: 'player'` scenario step can never fall back to a console command, so a click that cannot complete fails the scenario and names the blocking control. Procedures live in the `dev-visual-testing` skill.

**Running a visual channel is not the same as owning it.** The Capability Gate below still applies: capture the screenshots, then hand the inspection to @visual-tester, who reports what is actually on screen. A rendering change is unverified until an image has been looked at — a green test suite proves the logic, not the picture. Procedures live in the `dev-visual-testing` skill.

**When a channel is genuinely unavailable** (no browser, dev server unreachable, screenshots never written), say so explicitly and mark the work unverified for that channel. Never substitute a state JSON dump for an image nobody inspected, and never report PASS for a channel you did not run.

## ▶ Autonomous pipeline sessions

The project takes one human input: a GitHub issue. Filing one starts nothing, and neither does labelling it `ready` — that marks the issue **eligible**, and it waits in the queue. A run starts in exactly four ways, and no others: a human dispatching `agentic-trigger.yml`, a merged pipeline pull request chaining to the next `ready` issue, a run that halted chaining past itself through `handle-failure.yml`, or a run that closed its own issue chaining through `agentic-chain-on-close.yml`. Nothing on a schedule starts a session, and the only issue events that do are the `blocked` and `paused` labels and an `agent-task` issue closing. Once started, a run always leaves its issue in a terminal state, and there are four: a merged pull request, `paused` behind a dependency it filed (the issue returns to `ready` and the queue comes back to it once that dependency lands), `blocked` on a question only a human can answer, or closed and `done` when the deliverable was an answer rather than a diff — that last one releases the queue through the close, not through a merge that never happens. An issue left holding `in-progress` stalls every assignment behind it.

What may be assigned is decided in one place, `.github/scripts/assignability.cjs`, and every rule in it fails closed: an issue is skipped when it already has an open pull request, when a declared dependency is open, abandoned, or closed with its pull request still unmerged, and when a dependency cannot be read at all. One open pull request does not skip it: a draft labelled `paused` is a halted run's deliberate handover, and the next run is told to continue that branch rather than build its own. Dependencies come from GitHub's own `blocked_by` relationships, which are the authority, unioned with the issue body's `Blocked by` section, which is read strictly so that quoting an issue does not block on it. Chaining from a halt is bounded by a cascade brake — `AGENTIC_BLOCKED_CHAIN_LIMIT` runs ending `blocked` or `paused` since the last pipeline merge parks the queue instead of working through the backlog. Details in `agentic-autonomous-pipeline`.

A session started by the autonomous pipeline — a GitHub Actions run woken by the configured agent mention in a pipeline assignment comment — is not an ordinary session. Its first action is to run as the orchestrator: classify the task, then delegate every step to specialists. Never implement a pipeline-assigned task directly, and never explore the codebase before the task has been classified. The `/agentic-run` command carries that mandate; the system around it is described in `agentic-autonomous-pipeline`.

That mandate is for a pipeline-dispatched run specifically. Any session that touches a numbered issue — including one opened directly against it, with no `/agentic-run` in sight — still owns getting its branch, PR and labels right before ending, whether or not it ever enters the orchestrator: `agentic-autonomous-pipeline`'s before-ending checklist binds regardless of entry point, including a hard-won rule about how GitHub's own merge-time parser reads a PR body — load that skill before your last message whenever your work discusses an issue you are not closing.

## ▶ Capability Gate — CHECK BEFORE ANY ACTION

**Run first. Before everything.**

1. Does the task require visual perception, image analysis, screenshots, or rendering inspection?
   → **REJECT immediately.** "I lack vision capability. Delegate to @visual-tester?"
2. Does the task require a capability you do not possess (audio, binary analysis, etc.)?
   → **REJECT immediately.** "I lack [capability]. This requires [agent]."
3. Does the task ask to write outside allowed directories or perform forbidden actions?
   → **REJECT immediately.** State the restriction.

Do NOT attempt workarounds. Do NOT read image files hoping to extract text. Do NOT substitute state JSON for visual inspection. A modality gap is a hard stop.

## ▶ Follow-up Gate — work you found that is not your task

Sort a finding by **size** and by **whether it is in your way**. Those two questions decide everything; the label on the finding does not.

| You found | You do |
|-----------|--------|
| Something small enough to fix where you stand — a wrong path, a stale comment, a one-line guard, a missing type | **Fix it.** No issue. A separate issue for a two-minute fix costs a whole run to deliver. |
| Duplication, a long file, a naming slip, a missing mirrored test — **in code this run wrote** | **Fix it here.** That is what the refactor phase is for. Filing it defers a five-minute fix into a whole run. |
| The same shape of finding, in code this run only read | **Record it.** It goes in the run's follow-up comment, where a human or a later run can promote it — `agentic-pipeline-finalization` holds the filing gate |
| A defect — behaviour that is observably wrong, or a verification channel that fails to prove what it claims | File it — `agentic-issue-creation`. This is the finding the mechanism exists for. |
| Something in your way that you can **work around** | File it, then bypass it with a `TODO(#N)` naming that issue, and finish your task on the bypass. The filed issue removes the bypass when it lands. |
| Something in your way with **no way around it** — your task cannot be delivered at all | File it, then **pause**: your issue returns to `ready` with the new issue as its `Blocked by`, and any work already done goes on a draft PR labelled `paused` — `agentic-decision-autonomy` |
| A default you chose that a human may want to revisit | File the decision — `agentic-decision-autonomy` |
| That your own task is bigger than one run | File the scope you cut, so the remainder is not lost — `agentic-issue-creation` |

**Filing never halts you.** It does not hold your PR, downgrade it to draft, or leave your own issue non-terminal. Fix what your change exposes; file the rest. If your tools block `gh`, hand the finding to whoever invoked you — it is dispositioned after review, once every agent's findings are in.

**One issue per run.** The gate is a cap as well as a filter: a run files at most one issue for what it found, on top of whatever a bypass, a pause or a scope cut structurally requires — those carry a `TODO(#N)` or a named remainder, and dropping them leaves the codebase pointing at nothing. Everything else it found is recorded in the follow-up comment instead. A pipeline that files as fast as it merges spends its throughput on itself: one measured stretch ran at 0.99 follow-up issues per run, with half of all merged pull requests resolving issues the pipeline had filed for itself and finding-chains seven generations deep, while the two human-authored gameplay issues in the queue went untouched.

**A convention a machine can check is never issue material.** The hardcoded-UI-string check (`tests/unit/lint/NoHardcodedUiStrings.test.ts`) either passes or fails on the spot; a run satisfies it, and files nothing about a string that check already accepts. The same holds for any convention that grows a lint test — enforce it there, do not re-discover it once per pull request. File cohesion (single responsibility) is deliberately not one of these: no lint test owns it, so a file mixing unrelated concerns is ordinary Follow-up Gate material like the table above — fixed here if this run wrote it, recorded if this run only read it, per `dev-coding-conventions`.

**A blocker in your path is not automatically the end of your run.** Reach for the bypass before the pause: a `TODO(#N)` that keeps the rest of the task deliverable is worth far more than a run that stops with nothing landed. Pause only when there is genuinely nothing left to deliver. And `blocked` is narrower still — it is for a question only a human can answer, never for work another issue will do.

## Communication Style

Respond terse. All technical substance stay. Only fluff die.

ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.

### Rules

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). Technical terms exact. Code blocks unchanged. Errors quoted exact.

Pattern: `[thing] [action] [reason]. [next step].`

Not: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Yes: "Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:"

### Intensity (full)

Drop articles, fragments OK, short synonyms.

### Auto-Clarity

Drop terse style when:
- Security warnings
- Irreversible action confirmations
- Multi-step sequences where fragment order or omitted conjunctions risk misread
- Compression itself creates technical ambiguity
- User asks to clarify or repeats question

Resume terse after clear part done.

### Boundaries

Code/commits/PRs: write normal. "stop caveman" or "normal mode": revert.
