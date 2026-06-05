---
name: agentic-skill-edition
description: >
  Create and edit agentic context files (SKILL.md, agent definitions, slash command prompts)
  across all agent standards (Copilot, Claude Code, OpenCode). Enforces same-wording
  duplication rule: body content must be identical across solutions, only frontmatter differs.
  Use when writing or editing skills, agents, or prompts in any solution directory.
---

# Agentic Context File Edition

Create or edit agentic context files duplicated across all agent standard directories.

## Multi-Agent Duplication

**All agentic context files — skills, agent definitions, and slash command prompts — must be duplicated with identical body content across all agent directories. Only the frontmatter header differs between solutions.**

### Skills

Skills duplicated identically across all agent directories:

| Agent | Directory |
|-------|----------|
| Copilot | `.github/skills/` |
| Claude Code | `.claude/skills/` |
| OpenCode | `.opencode/skills/` |

**Rule:** All copies same wording. Never update one directory only.

### Agent Definitions

Agent definitions duplicated identically across all agent directories:

| Agent | Directory | File format |
|-------|-----------|-------------|
| Copilot | `.github/agents/` | `<name>.agent.md` |
| Claude Code | `.claude/agents/` | `<name>.md` |
| OpenCode | `.opencode/agents/` | `<name>.md` |

**Rule:** Body content (everything after frontmatter) must be word-for-word identical. Only frontmatter differs (solution-specific fields like `model:`, `mode:`, `allowed-tools:`, `tools:`, `name:`). OpenCode agents are the reference — sync Claude Code and Copilot to match.

### Slash Command Prompts

Slash command prompts duplicated across all command directories:

| Agent | Directory | File format |
|-------|-----------|-------------|
| Copilot | `.github/prompts/` | `<name>.prompt.md` |
| Claude Code | `.claude/commands/` | `<name>.md` |
| OpenCode | `.opencode/commands/` | `<name>.md` |

**Rule:** Same body content. Frontmatter fields differ per solution (`argument-hint`, `disable-model-invocation`, `context` are Claude Code-only; `tools` is Copilot-only; input syntax differs: `${input:var:hint}` for Copilot vs `$ARGUMENTS` for Claude Code/OpenCode).

## Principles (Embedded in This Skill)

### Concise
Minimal wording. Following communication style rules.

### Specific: One Subject Per Skill
Skill = single subject. If you need multiple subjects, create separate skills.

### No Overlap
Check existing skills before writing. If new skill overlaps, extend existing skill. Never duplicate.

### DRY
Information lives in one place. Reference other files instead of copying. Keep SKILL.md under 500 lines. Split content into separate files (progressive disclosure).

### Affirmative Instructions
State what the agent does, not what it does not do. Write "The agent includes `READY TO MERGE` in the PR body." not "The agent does not call `gh pr merge --auto`." Positive phrasing reduces cognitive load and clarifies expected behavior.

## Structure

### YAML Frontmatter
```yaml
---
name: skill-name          # lowercase + hyphens, max 64 chars
description: >            # third person, what + when, max 1024 chars
---
```

Rules:
- `name`: no XML tags, no reserved words (`anthropic`, `claude`)
- `description`: must be non-empty, third person, no XML tags
- Description is critical for skill selection — Claude reads this against task context

### Naming
Gerund form preferred: `processing-pdfs`, `analyzing-spreadsheets`.

Prefix per project convention (`copilot-instructions.md`):
- `gameplay-*` — game mechanics
- `dev-*` — software development
- `agentic-*` — agentic workflow automation

### File Paths
Always forward slashes: `reference/guide.md`. Never backslashes.

## Progressive Disclosure

SKILL.md = overview + navigation. Put detailed content in separate files, one level deep.

```
skill-name/
├── SKILL.md          # Main instructions (loaded when triggered)
├── reference.md      # Loaded on demand
└── examples.md       # Loaded on demand
```

Never nest references deeper than one level from SKILL.md. For reference files >100 lines, include table of contents at top.

## Workflows & Feedback Loops

Complex multi-step tasks: provide numbered steps + checklist.

````markdown
```
Progress:
- [ ] Step 1: ...
- [ ] Step 2: ...
```

**Step 1:** ...
**Step 2:** ...
````

Include validation step: run validator → fix → repeat.

## Templates & Examples

Match strictness to task fragility:
- **Low freedom** (exact scripts): fragile operations, precise sequence required
- **Medium freedom** (pseudocode/params): preferred patterns, some variation OK
- **High freedom** (text instructions): multiple valid approaches

Provide input/output pairs for quality-sensitive skills.

## Anti-Patterns

- Time-sensitive info (dates, version cutoffs)
- Windows-style paths
- Multiple tool/library options (pick one default)
- Vague skill names (`helper`, `utils`, `tools`)
- Offering too many approaches
- Deeply nested references (beyond one level)

## Checklist

- [ ] One subject only
- [ ] No overlap with adjacent skills
- [ ] Description: third person, what + when
- [ ] No time-sensitive info
- [ ] Consistent terminology
- [ ] References one level deep
- [ ] Under 500 lines
- [ ] Forward slashes only
- [ ] Concise: every token earns its place
