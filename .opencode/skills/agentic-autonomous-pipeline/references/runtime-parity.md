# Runtime parity

The pipeline is a **generic agentic system**: the same skills, agent definitions, prompts, and commands run under three coding solutions. Every context file is duplicated with **identical wording** in each solution's directory.

| Solution | Config directory | Format |
|----------|-----------------|--------|
| GitHub Copilot | `.github/agents/`, `.github/skills/` | Markdown `.agent.md`, `SKILL.md` |
| Claude Code | `.claude/agents/`, `.claude/skills/` | Markdown (same format) |
| OpenCode | `.opencode/agents/`, `.opencode/skills/` | Markdown (same format) |

Bodies stay word-for-word identical; frontmatter is per-runtime and never copied across. Authoring conventions and the schema for each runtime: `agentic-context-edition`. Verify with `npm run validate:context`.

## Where a shared instruction stops being enough

Both runners must land in the orchestrator on their first action, and they get there differently:

- **OpenCode** sets `default_agent: orchestrator` in `.opencode/opencode.json`, so the session *is* the orchestrator from turn one.
- **Claude Code** has no equivalent setting. `claude-runner.yml` prefixes the task with `/agentic-run`, a command whose `agent: orchestrator` + `context: fork` frontmatter forks the session into the orchestrator before the first tool call. No main-session hop, and no chance of the default agent starting the work itself.

Delegation splits the same way. The rule — parallel means several delegations in one message, all awaited in that same turn — is uniform. What it costs to enforce is not:

| Runtime | Delegation | Default | Enforced by |
|---------|-----------|---------|-------------|
| OpenCode | `task` | Synchronous — a turn cannot end while a sub-agent runs | The mechanism itself. Nothing to configure. |
| Copilot | `@agent-name` | Synchronous | The mechanism itself. |
| Claude Code | `Agent` tool | **Backgrounded**, reporting through a notification delivered on a *later* turn | A `PreToolUse` hook registered in `.claude/settings.json` |

So "invoke the reviewers in parallel" reads as *fan out and await* under OpenCode and as *launch and come back later* under Claude Code. It is the same sentence producing opposite behaviour, which is why the rule cannot rest on wording alone. Issue #404 died on that gap: the orchestrator ended its turn with `Waiting for completion notifications`, the process exited, and 2h08 of finished work went with the runner — TDD complete, validation complete, `pipeline/feature-404` never pushed, no PR.

**Where a hook is registered decides whether it exists.** The guard above first shipped declared in the orchestrator's own frontmatter, and it never fired once. Frontmatter hooks are registered per session by the code that starts a sub-agent through the `Agent` tool — which is how every specialist gets `block-git-gh.sh`, and it works there. The orchestrator is not started that way: `/agentic-run` carries `agent: orchestrator` plus `context: fork`, so the session forks into the orchestrator without any `Agent` call and the frontmatter block is never read. Issue #406 then repeated #404 exactly — planner launched in the background, turn ended, `num_turns: 0`, nothing on the remote — 58 seconds into a run, with the guard sitting inert in a file that passed `validate:context`. A hook the orchestrator must obey belongs in `settings.json`, which is registered for the whole session tree however the session was entered; `validate:context` now checks the registration, not only the file.

**The principle generalises past that one parameter. Where runtimes differ, the shared context states the invariant and each runtime's own configuration layer enforces it.** A body that names one runtime's parameters is a body that is wrong for the other two.

## Claude Code prerequisites

Delegation depends on configuration that is off by default:

- **Nested spawning.** A subagent cannot spawn subagents unless `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` is set in `.claude/settings.json`. Without it the orchestrator does every step itself, collapsing branch isolation and the whole TDD guarantee.
- **Foreground delegation.** The `Agent` tool's `run_in_background` defaults to `true`, which under a single-turn runner discards the run. `.claude/hooks/require-foreground-agents.sh`, registered as a `PreToolUse` hook in `.claude/settings.json`, rejects any delegation that is not explicitly foreground and tells the caller to re-issue it. It blocks by default so a runner cannot lose a run to an environment variable that failed to arrive; an interactive session opts out with `AGENTIC_ALLOW_BACKGROUND_AGENTS=1`, which no workflow sets. It states the same rule the shared bodies state in runtime-neutral terms, enforced here because this is the runtime whose default breaks it.
- **Tool budgets.** Each agent's `tools` / `disallowedTools` frontmatter is the enforcement layer. The orchestrator is denied `Edit` and `Write`; read-only reviewers get no write tools at all.
- **Preloaded skills.** Each specialist declares its domain skills in `skills:` frontmatter, so it starts with the spec already in context. Preloading costs context on every run of that agent — preload what the agent needs to act, and leave what it needs only sometimes to be read on demand.

Verify all of it with `npm run validate:context`.

## Model

Claude runs on `claude-sonnet-5`, set through `claude_args` in `claude-runner.yml`. OpenCode's model is set in `.opencode/opencode.json` and in the runner's environment. Every agent inherits the session model; no agent definition pins a model of its own.
