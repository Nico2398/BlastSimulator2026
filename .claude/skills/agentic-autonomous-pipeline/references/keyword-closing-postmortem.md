# Postmortem: GitHub's closing-keyword parser and prose

| Exhibit | PR | Issue | What happened |
|---|---|---|---|
| 1 | 750 | 707 | Body explained, correctly, that the PR did not resolve the issue — using the closing-keyword phrase to say so. Merged; issue ended anyway. |
| 2 | 753 | 707 | Written specifically to document exhibit 1. Quoted exhibit 1's own disclaiming sentence as evidence, in plain prose. Merged; same issue ended a second time. |
| 3 | 641 | 572 | Wrote a genuine, correctly-parsed closing reference. The fix behind it answered a tangent (why the issue's own pipeline run had gone missing) rather than the issue's original report (an unbounded loop, still unguarded in the codebase after this PR merged). |
| 4 | 754 | 707 | Opened specifically to correct exhibits 1 and 2, with its own new commits and PR body checked clean beforehand. Still ended the same issue a third time — see below. |

## Why exhibits 1 and 2 matter more than they look

GitHub's merge-time parser scans PR bodies and commit messages for a fixed set of keywords — close/closes/closed/fix/fixes/fixed/resolve/resolves/resolved — immediately followed by `#` and a number. It has no concept of negation, quotation, or tense. A sentence can be entirely honest and entirely correct in a human reader's eyes and still trigger a close, because the parser reads five words and a number, nothing else.

Exhibit 2 is the sharper lesson: a session writing *about* exhibit 1's failure, explaining the exact mechanism, reproduced it in the same PR body — by quoting exhibit 1's own sentence as evidence, without noticing the quotation itself carried the trigger. Explaining the bug is not protection against repeating it.

## Why exhibit 4 is the sharpest lesson of the three

Exhibit 4's own new commits and its own PR body were checked clean before it was opened — no adjacent keyword-and-number anywhere in either. It still closed the same issue, because the trigger was neither: it was a commit already merged once before, in exhibit 2's own squash-merge.

Squash-merging a pull request does not discard its constituent commit messages — it concatenates them into the new squash commit's message, verbatim, keyword-shaped text included. Exhibit 2's squash commit therefore carries its original commit's disclaiming sentence forward into the base branch permanently, as part of that squash commit's own message.

The branch that produced exhibit 2 was then updated for exhibit 4 with a merge of the base branch back in, specifically to avoid a force-push. That choice is what let the same original commit reappear: merging preserves the branch's own prior commits by their original SHA, so the pre-squash commit — content already landed, message unchanged — stayed reachable from the branch tip and rode into exhibit 4's own commit range as if it were new. Exhibit 4's squash commit concatenated it in turn, carrying the same disclaiming sentence into the base branch a second time, and that is what closed the issue again on merge.

## What did protect against it

Exhibit 2's PR body also referenced exhibit 3's issue number, written as inline code — a closing-keyword phrase inside backticks. That issue was unaffected. The parser skips code spans and fenced code blocks entirely; that is the one reliable boundary, in a commit message exactly as in a PR body.

## The rule

Never let a closing keyword sit immediately before a bare `#<number>` anywhere it could end up in the base branch's history — a PR body, a commit message, or a squash-merge message that concatenates one — regardless of grammar:

- Rephrase so the keyword and the number are not adjacent, in every commit message as much as the PR body.
- If the literal phrase must appear — quoting another PR, demonstrating the pattern — wrap the whole keyword-plus-number phrase in one code span or fenced block, in the commit message too, not only where it is later quoted.
- After a squash merge, reset the working branch to the new base rather than merging the base back in. A merge keeps the branch's own pre-squash commits reachable by their original SHA, and anything already landed can ride into the next PR's commit range as if it were new — carrying a stale, already-corrected commit message right back into the next squash commit.

Before submitting a PR that discusses any numbered issue, reread every commit message in its range and the PR body once, hunting for the literal shape — keyword, then `#`, then digits — the same way the parser will, not for what the sentence means.
