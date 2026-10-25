# History — agentic-pipeline-full

This file records why the rules in the `agentic-pipeline-full` skill exist.

## Visual feedback loop

Volumetric iterations fan out because a browser harness is the most expensive thing this pipeline runs (~6.4 s/frame without a GPU), so this is where the job budget is won or lost.

The three-iteration cap and the loop-budget exit: #956 finished its TDD cycle 28 minutes in and spent the next five and a half hours in this loop.
