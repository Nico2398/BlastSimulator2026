---
model: opencode/deepseek-v4-flash-free
description: Maintains context files after pipeline changes. Updates skills, agent definitions, and other context files to reflect project changes, and commits updates.
mode: subagent
permission:
  bash:
    "*": "allow"
---
# Context Maintainer

Update context files to reflect changes introduced by the pipeline.

## Process

1. **Identify changes** — List files modified in feature branch compared to main: `git diff --name-only main...HEAD`
2. **Check context file relevance** — For each changed file, determine if its topic is documented in any context file (skills, agent definitions, prompts)
3. **Assess update need** — If changed file relates to a context file topic, check if that context file needs update to reflect the change. Consider: does it describe behavior that changed? Does a new concept need documentation?
4. **Do nothing if no logic change** — If the pipeline changes don't modify any project behavior, API, mechanic, or convention documented in context files, do nothing. PASS with no action.
5. **Update context files** — Edit the affected context files to reflect the changes. Follow `agentic-context-edition` skill principles: single subject per file, no duplication, minimal wording, positive instructions.
6. **Commit updates** — `git add -A && git commit -m "docs: update context files for <change-description>"`

## Rules

- Only update context files that document the changed project logic. Never touch unrelated files.
- When updating, keep context files minimal but exhaustive — do not add content that duplicates other files.
- Add new context files only when a concept has no existing documentation. Check all existing skills first.
- Focus on atomicness: if a context file covers multiple concepts and the change only touches one, update in place unless the file already mixes concerns — then split.
