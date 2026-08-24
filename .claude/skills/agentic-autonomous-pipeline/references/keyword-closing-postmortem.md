# Postmortem: GitHub's closing-keyword parser and prose

| Exhibit | PR | Issue | What happened |
|---|---|---|---|
| 1 | 750 | 707 | Body explained, correctly, that the PR did not resolve the issue — using the closing-keyword phrase to say so. Merged; issue ended anyway. |
| 2 | 753 | 707 | Written specifically to document exhibit 1. Quoted exhibit 1's own disclaiming sentence as evidence, in plain prose. Merged; same issue ended a second time. |
| 3 | 641 | 572 | Wrote a genuine, correctly-parsed closing reference. The fix behind it answered a tangent (why the issue's own pipeline run had gone missing) rather than the issue's original report (an unbounded loop, still unguarded in the codebase after this PR merged). |

## Why exhibits 1 and 2 matter more than they look

GitHub's merge-time parser scans PR bodies (and commit messages) for a fixed set of keywords — close/closes/closed/fix/fixes/fixed/resolve/resolves/resolved — immediately followed by `#` and a number. It has no concept of negation, quotation, or tense. A sentence can be entirely honest and entirely correct in a human reader's eyes and still trigger a close, because the parser reads five words and a number, nothing else.

Exhibit 2 is the sharper lesson: a session writing *about* exhibit 1's failure, explaining the exact mechanism, reproduced it in the same PR body — by quoting exhibit 1's own sentence as evidence, without noticing the quotation itself carried the trigger. Explaining the bug is not protection against repeating it.

## What did protect against it

The same PR body (exhibit 2) also referenced exhibit 3's issue number, written as inline code — a closing-keyword phrase inside backticks. That issue was unaffected. The parser skips code spans and fenced code blocks entirely; that is the one reliable boundary.

## The rule

Never let a closing keyword sit immediately before a bare `#<number>` anywhere in a PR body's prose, regardless of grammar:

- Rephrase so the keyword and the number are not adjacent.
- If the literal phrase must appear — quoting another PR, demonstrating the pattern — wrap the whole keyword-plus-number phrase in one code span or fenced block.

Before submitting a PR body that discusses any numbered issue, reread it once hunting for the literal shape — keyword, then `#`, then digits — the same way the parser will, not for what the sentence means.
