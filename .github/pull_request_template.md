<!--
Layout for a pull request opened by hand or from an interactive session.
A pipeline run uses .github/PULL_REQUEST_TEMPLATE/pipeline.md instead.
Rules behind each section: dev-finishing-work, and the before-ending
checklist in agentic-autonomous-pipeline. Delete this comment.
-->

## Summary

<What changed and why. Name the mechanism or the incident that motivated it.>

## Issue

<Closing an issue: `Closes #<N>` alone on its own line, and nothing else on that line.
Discussing an issue without closing it: name it in prose with no closing keyword in front of its number.
No issue: drop this section.>

## Verification

- static: <command> — <result>
- logic: <command> — <result>
- scenario: <command> — <result, or why the change does not touch it>
- visual: <what was captured and inspected> — <result, or why the change does not touch it>
- issue criteria: <the closed issue's own Verification list met, or the gap and the remainder issue it was cut to. No issue closed: drop this line.>

## Decisions taken

<Closing an issue that left a requirement open: the block `agentic-decision-autonomy` formats. Otherwise drop this section.>

## Pipeline impact

<Workflows, decision modules, context files or labels this changes, and whether `npm run validate:context` ran. No pipeline file touched: drop this section.>
