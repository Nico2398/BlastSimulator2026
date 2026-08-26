# Postmortem: GitHub's closing-keyword parser and prose

| Exhibit | PR | Issue | What happened |
|---|---|---|---|
| 1 | 750 | 707 | Body explained, correctly, that the PR did not resolve the issue — using the closing-keyword phrase to say so. Merged; issue ended anyway. |
| 2 | 753 | 707 | Written specifically to document exhibit 1. Quoted exhibit 1's own disclaiming sentence as evidence, in plain prose. Merged; same issue ended a second time. |
| 3 | 641 | 572 | Wrote a genuine, correctly-parsed closing reference. The fix behind it answered a tangent (why the issue's own pipeline run had gone missing) rather than the issue's original report (an unbounded loop, still unguarded in the codebase after this PR merged). |
| 4 | 754 | 707 | Opened specifically to correct exhibits 1 and 2, with its own new commits and PR body checked clean beforehand. Still ended the same issue a third time — see below. |
| 5 | (this PR) | 755 | Reproduced exhibit 1's shape deliberately against a throwaway test issue and confirmed the mechanical guard below catches it before merge, rather than documenting the rule a fourth time. |

## Why exhibits 1 and 2 matter more than they look

GitHub's merge-time parser scans PR bodies and commit messages for a fixed set of keywords — close/closes/closed/fix/fixes/fixed/resolve/resolves/resolved — immediately followed by `#` and a number. It has no concept of negation, quotation, or tense. A sentence can be entirely honest and entirely correct in a human reader's eyes and still trigger a close, because the parser reads five words and a number, nothing else.

Exhibit 2 is the sharper lesson: a session writing *about* exhibit 1's failure, explaining the exact mechanism, reproduced it in the same PR body — by quoting exhibit 1's own sentence as evidence, without noticing the quotation itself carried the trigger. Explaining the bug is not protection against repeating it.

## Why exhibit 4 is the sharpest lesson of the three

Exhibit 4's own new commits and its own PR body were checked clean before it was opened — no adjacent keyword-and-number anywhere in either. It still closed the same issue, because the trigger was neither: it was a commit already merged once before, in exhibit 2's own squash-merge.

Squash-merging a pull request does not discard its constituent commit messages — it concatenates them into the new squash commit's message, verbatim, keyword-shaped text included. Exhibit 2's squash commit therefore carries its original commit's disclaiming sentence forward into the base branch permanently, as part of that squash commit's own message.

The branch that produced exhibit 2 was then updated for exhibit 4 with a merge of the base branch back in, specifically to avoid a force-push. That choice is what let the same original commit reappear: merging preserves the branch's own prior commits by their original SHA, so the pre-squash commit — content already landed, message unchanged — stayed reachable from the branch tip and rode into exhibit 4's own commit range as if it were new. Exhibit 4's squash commit concatenated it in turn, carrying the same disclaiming sentence into the base branch a second time, and that is what closed the issue again on merge.

## What did protect against it

Exhibit 2's PR body also referenced exhibit 3's issue number, written as inline code — a closing-keyword phrase inside backticks. That issue was unaffected. The parser skips code spans and fenced code blocks entirely; that is the one reliable boundary, in a commit message exactly as in a PR body.

## What makes it unnecessary to write around now (issue #755)

Exhibits 1, 2 and 4 all happened because the only defense was a human or agent
re-reading their own prose and catching a pattern shaped like the one they had
just been warned about — and each of the three sessions that tried that,
failed at it. That is not a reliability gap prose can close by being written
more carefully; it needs a machine reading the text the same way GitHub's
parser does, before the merge happens rather than after.

Two changes, evaluated together per issue #755's own instructions:

- **A repo setting alone does not cover it.** GitHub has no setting that
  disables closing-keyword parsing — Settings → General → Pull Requests has no
  such toggle, confirmed by both a search of GitHub's own documentation and the
  absence of any matching field on the repository API resource. What the repo
  *does* control is which text becomes a squash commit's message:
  `squash_merge_commit_message` is `COMMIT_MESSAGES` (concatenates every
  constituent commit message verbatim — exactly the mechanism exhibit 4 used to
  carry a stale commit message forward). Switching it to `PR_BODY` would close
  exhibit 4's specific vector for a squash merge — recorded as a decision under
  `## Decisions taken` on the PR for #755, not applied by that run itself,
  because a repository-settings write needs the `Administration` permission and
  the pipeline's token carries only `contents`/`pull-requests`/`issues` write.
  Even applied, it would not be complete: this repo still allows merge-commit
  and rebase-merge, both of which land every constituent commit message on
  `main` verbatim regardless of this setting, and exhibits 1 and 2 were never a
  commit-message problem in the first place — they were the PR body itself. The
  setting narrows the surface; it does not obsolete a check on the text.
- **A required CI check reads the PR the same way the parser does.**
  `.github/workflows/agentic-closing-keyword-guard.yml` runs
  `.github/scripts/check-closing-keywords.cjs` against the PR title, the PR
  body, and every commit message in the PR's range on every open/edit/push —
  matching `close[sd]?/fix(es|ed)?/resolve[sd]?\s+#\d+` outside fenced and
  inline code spans, exempting only a line whose entire content is a
  standalone closing directive — `Closes #<N>`, the pipeline's body convention,
  optionally behind a conventional-commit type, which is the PR title
  `agentic-pipeline-finalization` mandates (`fix: Resolve #<N>`). A match
  anywhere else fails the check — including a correct reference to the right
  issue, if it is not written as one of those two shapes, because the incidents
  were never about the wrong number, they were about the phrase appearing where
  a reader parses it as prose rather than as a deliberate directive.

  **The title shape had to be admitted, and the omission cost a pull request.**
  The guard shipped while `open-pr` was already required to write exactly that
  title, so the two landed in direct contradiction: PR #773 — the first pipeline
  PR opened after the guard merged — failed this check on its own mandated
  title, and every pipeline PR after it would have failed the same way. A guard
  that rejects the convention it ships beside does not harden the pipeline, it
  stops it.

  No branch protection rule was added for this check, on the grounds that
  `agentic-auto-merge` and `scripts/await-pr-ci.ts` already read every workflow
  run on a PR's head and treat any reported failure as red. **Half of that was
  untrue when it was written.** `await-pr-ci` excluded merge machinery by a
  `^agentic-` filename prefix, so this guard — named
  `agentic-closing-keyword-guard.yml` — exempted itself from the verdict by its
  own name, and #773's session read GREEN over a failing check. Both readers now
  decide by a named list rather than a prefix, and an unrecognised workflow
  counts as a channel. See "A red CI is nobody's report" in `github-loop.md`.

## Manual defense in depth

The guard above is what actually stops a fifth exhibit; the checklist below is
what to do by hand in the rare case something reaches the base branch outside
a pull request the guard could see (a direct push, a squash performed outside
the pipeline's own tooling). Never let a closing keyword sit immediately
before a bare `#<number>` anywhere it could end up in the base branch's
history — a PR body, a commit message, or a squash-merge message that
concatenates one — regardless of grammar:

- Rephrase so the keyword and the number are not adjacent, in every commit message as much as the PR body.
- If the literal phrase must appear — quoting another PR, demonstrating the pattern — wrap the whole keyword-plus-number phrase in one code span or fenced block, in the commit message too, not only where it is later quoted.
- After a squash merge, reset the working branch to the new base rather than merging the base back in. A merge keeps the branch's own pre-squash commits reachable by their original SHA, and anything already landed can ride into the next PR's commit range as if it were new — carrying a stale, already-corrected commit message right back into the next squash commit.

Before submitting a PR that discusses any numbered issue, reread every commit message in its range and the PR body once, hunting for the literal shape — keyword, then `#`, then digits — the same way the parser will, not for what the sentence means.
