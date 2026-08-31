---
applyTo: ".github/workflows/*.yml,.github/actions/**/action.yml,.github/scripts/*.cjs"
---

# Pipeline Actions Layer

This is the part of the pipeline with no agent in it. It runs unattended, and every failure in it is silent by default.

- **No timer.** No verdict is decided on a duration — not "stuck after N minutes", not a cooldown, not a sleep-until-probably-done. Decide on an event, on identity (a run id, a SHA), on state you can read, or on a counter with a brake. Five clocks in this tree are allowed and each is a cadence, a backoff, an ordering comparison, the runner's own job budget, or a clamped last-resort floor — never a verdict. `autonomy-loop.test.ts` fails on a sixth.
- **The token decides whether anything happens next.** `PAT_TOKEN_COPILOT_AUTOMATION` for anything that must raise an event or wake a runner; `GITHUB_TOKEN` only where raising nothing is the point, and say so in the step comment.
- **Fail closed and fail loud.** A fact you could not read blocks. An absence of evidence is never a pass. A state that must not persist fails the step rather than warning into a log nobody reads, and every terminal outcome leaves the issue released.
- **Every workflow can fire twice.** Make the second run a no-op by construction — a marker carrying the identity of what was answered, not a timestamp.
- Comment the incident, not the code: name the PR or issue the mechanism was added for.

Full standards, the allowed-clock table, token matrix, and how a change here is proven: `agentic-workflow-edition` skill. What the mechanisms actually do: `agentic-autonomous-pipeline`.

## Verify a workflow change

There is no runtime to drive, so the channel is `logic`: pin the trigger, the token and every guard in `tests/unit/config/autonomy-loop.test.ts`, reading the shipped source rather than a copy of it. Parse-check the YAML before pushing.
