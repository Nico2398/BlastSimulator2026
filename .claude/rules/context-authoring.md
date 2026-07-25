---
paths:
  - ".claude/**/*.md"
  - ".claude/**/*.json"
  - ".github/agents/**"
  - ".github/skills/**"
  - ".github/prompts/**"
  - ".opencode/**/*.md"
  - ".opencode/**/*.json"
---

# Context File Authoring

Skill, agent, command, and rule files are the project's instruction surface. Editing them changes how every future session behaves.

- Body content stays word-for-word identical across `.claude/`, `.github/`, and `.opencode/`. Frontmatter differs per runtime — never copy one runtime's frontmatter schema into another.
- Claude Code frontmatter is not interchangeable with OpenCode's. Agents use `tools` / `disallowedTools` / `skills`; skills and commands use `allowed-tools`. A field from the wrong schema is silently ignored, which quietly removes the restriction you thought you set.
- One concept per file. Reference other files by name, never by step number or section label.
- Path-scoped rules belong in `.claude/rules/` with a `paths` list. Always-on project facts belong in `.claude/CLAUDE.md`. Procedures belong in skills.

Full authoring conventions, duplication rules, and the pre-commit checklist: `agentic-context-edition` skill.

## Verify a context change

Frontmatter errors do not raise exceptions — they degrade silently. After editing agent or skill frontmatter, confirm the file still parses and that restrictions took effect: `npm run validate:context`.
