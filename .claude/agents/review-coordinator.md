---
name: review-coordinator
description: DEPRECATED — Orchestrator now handles merging reviewer findings directly. Kept for reference only. 
allowed-tools: Read Search
user-invocable: false
disable-model-invocation: true
---
# Review Coordinator (DEPRECATED)

This role has been absorbed by the **pipeline orchestrator**. A dedicated coordinator agent is unnecessary because the orchestrator already holds all sub-reviewer outputs in context after fan-out. Merging them inline removes an extra LLM call and avoids re-transmitting findings.

## Previous Role (for reference)

Positioned after parallel sub-reviewers, before refactorer. Read-only.

The coordinator merged findings from security, quality, i18n, and duplication reviewers into one coherent review. Steps were:

1. **Deduplicate** — same issue flagged by multiple reviewers → keep once in best category
2. **Re-categorize** — performance issue in quality section → move to correct category
3. **Filter false positives** — speculative issues, nitpicks, convention-contradicted findings → drop
4. **Verify uncertain items** — if a finding is [medium] confidence, read source to confirm
5. **Check issue alignment** — every acceptance criterion from the issue is implemented
6. **Assess cross-file impact** — does this change break callers in other files?

The orchestrator now performs these steps directly after receiving all 4 reviewer outputs.
