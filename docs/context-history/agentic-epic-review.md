# History — agentic-epic-review

This file records why the rules in the `agentic-epic-review` skill exist.

## Why an epic is reviewed at all

Added on 2026-11-09 at the owner's request, together with the epic system in `agentic-issue-creation`. Each sub-issue proves its own slice through its own Verification, and nothing proved the slices added up to the behaviour the batch was filed for. The review is that proof, run by whichever session a human asks — never by the queue: watching epics is deliberately not the pipeline's job.

## Why a small fix is a direct pull request

The owner's distinction: a gap filed as a new sub-issue goes through the autonomous pipeline in full (assignment, TDD, independent review, CI handback); a fix landed directly from the review is the reviewing session's own pull request, and nothing automatic drives it — that session, or the human behind it, takes it to merged.

## Why the epic carries `epic` alone, even closed

The owner's rule. The merge chain applies `done` to every issue a merged pull request names, so `auto-assign-next.yml` skips an `epic`-labelled issue explicitly.
