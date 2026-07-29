---
name: agentic-context-edition
description: >
  Create and edit agentic context files (skills, agent definitions, slash commands, data files)
  across all agent standards (Copilot, Claude Code, OpenCode). Covers file structure,
  duplication rules, progressive disclosure, and content hygiene.
  Use when writing or editing any file under .opencode/, .claude/, or .github/ agent directories.
---

# Context Edition

Create or edit agentic context files duplicated across all agent standard directories.

## Multi-Agent Duplication

All context files — skills, agent definitions, and slash commands — duplicate with identical body content across all agent directories. Only frontmatter differs between solutions.

### Skills

| Agent | Directory |
|-------|----------|
| Copilot | `.github/skills/` |
| Claude Code | `.claude/skills/` |
| OpenCode | `.opencode/skills/` |

**Rule:** All copies same wording. Never update one directory only.

### Agent Definitions

| Agent | Directory | File format |
|-------|-----------|-------------|
| Copilot | `.github/agents/` | `<name>.agent.md` |
| Claude Code | `.claude/agents/` | `<name>.md` |
| OpenCode | `.opencode/agents/` | `<name>.md` |

**Rule:** Body content word-for-word identical. Frontmatter is per-runtime and never copied between directories.

### Slash Commands

| Agent | Directory | File format |
|-------|-----------|-------------|
| Copilot | `.github/prompts/` | `<name>.prompt.md` |
| Claude Code | `.claude/commands/` | `<name>.md` |
| OpenCode | `.opencode/commands/` | `<name>.md` |

**Rule:** Same body content. Frontmatter fields differ per solution.

### Path-Scoped Rules (Claude Code)

`.claude/rules/*.md` holds hard invariants for one area of the tree. A `paths` frontmatter list makes a rule load only when files matching those globs are touched; a rule with no `paths` loads every session.

Choose the layer by lifetime and scope:

| Content | Goes in |
|---------|---------|
| Always-true project facts, verification gate | `.claude/CLAUDE.md` |
| Invariants for one directory | `.claude/rules/` with `paths` |
| Procedures and domain specs loaded on demand | `.claude/skills/` |
| Role, tool budget, preloaded skills for one agent | `.claude/agents/` |

Rules state the invariant and name the skill that details it. They never restate the skill.

## Frontmatter Schemas Are Not Interchangeable

An unrecognised frontmatter field raises no error — it is ignored. A tool restriction written with the wrong field name silently grants full access. Never copy one runtime's frontmatter into another's directory.

### Claude Code agent (`.claude/agents/*.md`)

`name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color`, `initialPrompt`.

- `tools` is an allowlist, comma-separated, using exact Claude Code tool names (`Read, Edit, Write, Grep, Glob, Bash, Skill, TodoWrite, WebFetch`). `disallowedTools` is a denylist applied first.
- `allowed-tools` is **not** an agent field. Using it leaves the agent with every tool.
- `skills` preloads full skill content at startup — this is how a specialist gets its domain knowledge without spending turns discovering it.
- Subagents cannot spawn subagents unless `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` is set in `.claude/settings.json`. An orchestrator that delegates depends on it.

### Claude Code skill and command (`.claude/skills/*/SKILL.md`, `.claude/commands/*.md`)

`name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `background`, `hooks`, `paths`, `shell`.

- Here `allowed-tools` **is** correct — it pre-approves tools for the invoking turn.
- `disable-model-invocation: true` also blocks the skill from being preloaded into an agent's `skills` list.
- Directory name sets the command; frontmatter `name` is the display label and must match the directory.

### Claude Code rule (`.claude/rules/*.md`)

`paths` only.

## Verify a Context Change

```bash
npm run validate:context
```

Checks frontmatter fields against the schema for each file type, resolves tool names and preloaded skills, confirms hook commands exist and are executable, confirms every bundled skill file is named by its SKILL.md, and diffs bodies across the three runtime directories. Run it after any context edit — these failures are invisible at runtime.

## Communication Standards

### Minimal, Complete

Every token earns its place. Omit filler, hedging, pleasantries. Completeness takes priority over brevity — never truncate or omit critical information.

### Positive Instructions

State what the agent does, not what it avoids. Positive phrasing reduces cognitive load and clarifies expected behavior.

Do: "Keep skills under 500 lines. Split when a concept exceeds this limit."
Not: "Don't write skills longer than 500 lines."
Short negative example after positive only when contrast clarifies intent.

### No User Input in Non-Interactive Sessions

Never prompt the user for input, confirmation, or decisions. Pipelines running in CI cannot respond. All decisions must be deterministic or delegated to agents.

## Progressive Disclosure

Agents build context gradually as they work. Monolithic context files overload agents with irrelevant information, degrading efficiency. Structure context to support selective loading — the agent fetches only what it needs for each step.

### Single Responsibility Per File

One concept per file. When a skill or agent description covers multiple concepts, split into dedicated files that can be referenced independently.

Short skills enforce clean separation. A skill exceeding 500 lines likely mixes concerns — split it.

### Bundled Reference Files

A skill directory holds its SKILL.md plus any files it splits detail into:

```
skills/<name>/
  SKILL.md                  loaded whole, every time the skill loads
  references/<subject>.md    read on demand, when a step needs that subject
```

SKILL.md carries what a reader needs *to act* and an index naming each reference file and what it answers. Reference files carry what a reader needs *sometimes*: design rationale, per-runtime configuration, post-mortems, long tables. The split matters most for a skill preloaded through an agent's `skills:` frontmatter — that content is paid for on every single run of that agent, whether the run needs it or not.

Rules:
- Every bundled file is named by its SKILL.md. A file nothing points at is context no agent reaches.
- Reference paths are relative to the skill directory, forward slashes: `references/github-loop.md`.
- Bundled files mirror across all three runtime directories exactly like SKILL.md does.

### Reference, Don't Duplicate

Information lives in one place. Different context files refer to each other rather than duplicating content. This creates a single source of truth and prevents conflicting instructions across files.

This applies to all content types: rules, requirements, specifications, validation criteria, checklists, and examples. If a concept is defined or specified in one file, other files reference it by name — they never restate its content.

Example: two skills needing the same rule — put the rule in a dedicated reference file, both skills reference it. A validation agent checking context file quality references the `agentic-context-edition` skill rather than re-listing its requirements.

### No Tight Coupling

Context files stay independent. Never reference another file by step number, section label, or procedural detail that may change.

Accepted: "Validates per `dev-testing-strategy` skill."
Not accepted: "See step 5 of dev-testing-strategy." (step numbers change)
Not accepted: "Used by the full pipeline." (becomes outdated or incomplete)

Updating one skill must never break the meaning of another.

### Agents Load Skills, Not Vice Versa

Agent definitions reference skills. Skills describe procedures and knowledge independent of who invokes them. Skills never reference agents — this decouples procedure from executor.

### Right File Type for Purpose

| File type | Purpose | Content |
|-----------|---------|---------|
| Agent definition | Agent instructions | Identity, mode, tools, allowed operations |
| Skill | Procedures & knowledge | Domain rules, causal relations, step sequences |
| Data file | Pure data | Tables, catalogs, mappings, constants |

Pure data belongs in dedicated data files (MD, CSV, JSON), not embedded in skills or agent definitions.

## Structure

### YAML Frontmatter

```yaml
---
name: skill-name          # lowercase + hyphens, max 64 chars
description: >            # third person, what + when, max 1024 chars
---
```

Rules:
- `name`: no XML tags, no reserved words
- `description`: non-empty, third person, no XML tags
- Description is critical for skill selection — agents read this against task context

### Naming

Gerund form preferred: `processing-pdfs`, `analyzing-spreadsheets`.

Prefix per project convention:
- `gameplay-*` — game mechanics
- `dev-*` — software development
- `agentic-*` — agentic workflow automation

### File Paths

Always forward slashes: `references/guide.md`. Never backslashes.

## Workflows & Feedback Loops

Complex multi-step tasks: numbered steps with checklist progress markers. Include validation step at end.

```
Progress:
- [ ] Step 1: ...
- [ ] Step 2: ...

**Step 1:** ...
**Step 2:** ...
```

For feedback loops: define loop body, exit condition, and iteration cap.

## Templates & Examples

Match instruction strictness to task fragility:
- **Low freedom** (exact commands): fragile operations, precise sequence required
- **Medium freedom** (pseudocode or params): preferred patterns, some variation allowed
- **High freedom** (text instructions): multiple valid approaches

Keep examples generic — domain-specific references lose meaning outside original context. Provide input/output pairs for quality-sensitive skills.

## Checklist

- [ ] Single subject per file
- [ ] No overlap with adjacent files
- [ ] Description: third person, what + when
- [ ] No time-sensitive info (dates, version cutoffs)
- [ ] Consistent terminology
- [ ] References one level deep (max)
- [ ] Under 500 lines
- [ ] Forward slashes only
- [ ] Concise: every token earns its place
- [ ] Positive phrasing: describes what agent does
- [ ] No cross-file tight coupling (no step numbers, no "used by")
- [ ] No user-input instructions
- [ ] Correct file type for purpose
- [ ] Frontmatter fields belong to that runtime's schema
- [ ] Detail an agent needs only sometimes sits in `references/`, named by the SKILL.md
- [ ] All 3 solution folders in sync (`.opencode`, `.claude`, `.github`) — same body content, bundled files included
- [ ] `npm run validate:context` passes
