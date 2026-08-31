# Why `AskUserQuestion` is denied

The rule is in the SKILL.md: an open choice is defaulted and recorded, never asked. This file is the enforcement and the reasoning behind it.

`AskUserQuestion` is blocked project-wide, in two layers, and `npm run validate:context` fails if either goes missing. The tool suspends the session waiting for an answer nobody is there to give — the issue holds `in-progress` for as long as it waits, and every assignment behind it waits too. That is the halt the whole skill exists to prevent, arriving through a tool call instead of through a decision.

| Layer | Where | Holds when |
|-------|-------|-----------|
| `permissions.deny` | `.claude/settings.json` | The permission system is consulted at all |
| `PreToolUse` hook | `.claude/hooks/no-ask-user-question.sh` | Always — a hook runs on the tool call whatever mode the session is in |

The second layer is not redundancy. A session running with permissions bypassed never consults a deny rule, and an unattended session — a GitHub Actions runner, Claude Code on the web — is both the one that bypasses prompts and the one whose question can never be answered. The deny rule states the intent; the hook is what holds where it matters.

The denial removes an escape hatch, not an option: **an open choice was never a question to ask.** Default it and record it. A genuine blocker goes onto the issue as a comment, which is where a human will actually find it — asynchronously, in the place that already holds the run's history — rather than into a prompt in a session that has since ended.

This binds an interactive session at a keyboard exactly as it binds a pipeline run, and deliberately: the same context files drive both, and a rule that applies only when nobody is watching is a rule the pipeline cannot rely on.
