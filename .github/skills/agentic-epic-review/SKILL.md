---
name: agentic-epic-review
description: Review an epic — the `epic`-labelled parent of a batch of sub-issues — once its sub-issues are closed. Checks the behaviour the epic promised end to end, then closes the epic, lands a small fix in a direct pull request, or files the missing work as new sub-issues. Use when asked to check or close an epic, or when a session starts on an issue labelled `epic`.
---

# Epic review

An epic is a parent issue whose sub-issues are the tasks; `agentic-issue-creation` holds how one is filed. Each sub-issue proved its own slice. The review proves the slices add up to what the epic promised. Nothing starts a review on its own: a human asks for one, in any session.

## ▶ PROCEDURE — EXECUTE IN ORDER

1. **Read the epic.** Its `## Goal` and `## Epic verification` sections are the bar the review holds the code to.
2. **List its sub-issues** with their state and close reason:
   ```bash
   REPO=Nico2398/BlastSimulator2026
   gh api "repos/$REPO/issues/<E>/sub_issues" --paginate --jq '.[] | "\(.number) \(.state) \(.state_reason)"'
   ```
   With no `gh` CLI, the same endpoint through `curl` with `$GITHUB_TOKEN`, or the GitHub MCP's `issue_read` (method `get_sub_issues`).
3. **Every sub-issue closed, or stop.** One still open means the epic is not ready: comment which ones, and end the review there.
4. **Read how each one closed.** Closed as completed → its slice landed. Closed as not planned → its slice was dropped, and step 5 judges whether the epic's verification still holds without it.
5. **Verify the epic's behaviour on `main`**, through every channel its `## Epic verification` names and every Verification Gate channel the behaviour belongs to. For a player-facing epic, `visual`'s interaction mode is the channel that proves a player can reach it.
6. **Settle it** by what step 5 showed:

| Finding | Do |
|---------|----|
| Every criterion holds | Close the epic as completed, with a comment giving each criterion and its evidence — channel, scenario, screenshot |
| A gap a small fix closes — one area, a few lines, no new mechanic | Fix it on a branch this session owns and open a pull request carrying `Closes #<E>` on a line of its own, marked per `agentic-pipeline-pr-management`. This session owns it to merged — channels, CI, a red CI — per `dev-finishing-work`: nothing automatic hands a pull request outside the queue back to an agent. The merge closes the epic |
| A gap that needs its own task | File it as a new sub-issue of the epic (`agentic-issue-creation`), `ready` by that skill's rules, and comment on the epic naming it. The epic stays open and is reviewed again once the new sub-issues close |
| A question only a human can answer | Comment on the epic with the question and what changes with each answer. The epic stays open |

## ▶ The epic's labels

`epic`, and nothing else, through every outcome above — never `agent-task`, `ready`, `scope:*`, `in-progress`, `blocked`, `paused` or `done`. The assigner refuses any issue carrying `epic`, and the merge chain closes an epic its fix pull request names without labelling it.

History: docs/context-history/agentic-epic-review.md
