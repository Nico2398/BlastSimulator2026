# History — agentic-pipeline-ci-fix

This file records why the rules in the `agentic-pipeline-ci-fix` skill exist.

## Conflict variant — what `verify` checks after the merge (Nov 2026)

The step said `verify` "reads the merged diff, so it runs the channels both sides' changes owe". That held while `logic` ran the whole suite. Once `verify` became a focused pre-flight (the timed-out runs of #2142, #2143, #2148, #2154 and #2199 were mostly local whole-suite runs), it diffs the branch against the `main` it now contains: this branch's side only. Main's side is checked by CI on the pushed head, which the run waits for anyway. The conflict handback comment in `agentic-ci-failure.yml` asked for `npm run test` in the same breath; a review caught the two contradicting each other in one prompt.
