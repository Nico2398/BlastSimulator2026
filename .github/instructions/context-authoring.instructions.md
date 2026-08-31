---
applyTo: ".claude/**/*.md,.claude/**/*.json,.claude/hooks/**,.github/agents/**,.github/skills/**,.github/prompts/**,.github/instructions/**,.github/copilot-instructions.md,.opencode/**/*.md,.opencode/**/*.json,.opencode/plugin/**"
---

# Context File Authoring

Skill, agent, command, and rule files are the project's instruction surface. Editing them changes how every future session behaves.

- Body content stays word-for-word identical across `.claude/`, `.github/`, and `.opencode/`. Frontmatter differs per runtime — never copy one runtime's frontmatter schema into another.
- **Rules mirror three ways like everything else.** A rule lives in `.claude/rules/<name>.md` (`paths` list), `.github/instructions/<name>.instructions.md` (`applyTo` string, same globs in the same order), and `.opencode/rules/<name>.md` (body only, no frontmatter). `validate:context` diffs all three bodies and compares the globs.
- **Entry points are the exception.** `.claude/CLAUDE.md`, `.github/copilot-instructions.md` and `.opencode/AGENTS.md` are each written for their own runtime, and `validate:context` only checks that all three name the same gates and channels. A section that applies to one runtime only — because it describes how that harness executes — stays in that entry point. Open it with a bold line naming the runtime and stating that its absence elsewhere is intentional, so the next editor does not "fix" the divergence. Anything true of the project rather than the harness belongs in a skill or rule, where it *is* synced.
- Claude Code frontmatter is not interchangeable with OpenCode's. Agents use `tools` / `disallowedTools` / `skills`; skills and commands use `allowed-tools`. A field from the wrong schema is silently ignored, which quietly removes the restriction you thought you set.
- One concept per file. Reference other files by name, never by step number or section label.
- Path-scoped rules hold invariants for one area of the tree, stated in a page an agent reads whole. Keep them short and name the skill that details them. Always-on project facts belong in the entry point. Procedures belong in skills.

Full authoring conventions, duplication rules, and the pre-commit checklist: `agentic-context-edition` skill.

## Verify a context change

Frontmatter errors do not raise exceptions — they degrade silently. After editing agent, skill, or rule frontmatter, confirm the file still parses and that restrictions took effect: `npm run validate:context`.
