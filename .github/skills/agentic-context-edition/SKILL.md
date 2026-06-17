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

**Rule:** Body content word-for-word identical. Only frontmatter differs (model, mode, allowed-tools, tools, name). OpenCode agents are the reference — sync Claude Code and Copilot to match.

### Slash Commands

| Agent | Directory | File format |
|-------|-----------|-------------|
| Copilot | `.github/prompts/` | `<name>.prompt.md` |
| Claude Code | `.claude/commands/` | `<name>.md` |
| OpenCode | `.opencode/commands/` | `<name>.md` |

**Rule:** Same body content. Frontmatter fields differ per solution.

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

Always forward slashes: `reference/guide.md`. Never backslashes.

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
