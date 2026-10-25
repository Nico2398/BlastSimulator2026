# History — agentic-pipeline-tdd

This file records why the rules in the `agentic-pipeline-tdd` skill exist.

## ▶ PROCEDURE — EXECUTE IN ORDER

The script steps (`tdd start`, `split`, `join`) replace the branch-sanity, verify-commit, cherry-pick and git-verify steps the cycle used to spend model turns on.

## The blind phase

Shaping the implementation and the tests by the Contract alone is the separation the old cycle bought with a separate implementer agent, kept here without one.

## Branch naming

`<label>` is `<issue>-<runId>`, never the issue number alone, because of issue #554: run 166 rebuilt `pipeline/feature-554` from `main` while run 160's abandoned branch held the name on the remote, and six hours of finished work died on `! [rejected] (non-fast-forward)`.

## ▶ Volumetric work goes out in parallel batches

Issue #554's run 166 edited 94 files one at a time and was cancelled at 360 minutes with nothing pushed.
