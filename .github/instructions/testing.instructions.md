---
applyTo: "tests/**/*.ts,vitest.config.ts"
---

# Test Authoring

Tests are the `logic` verification channel. They run in Node.js with no browser and no network.

- `tests/unit/` mirrors the source path: `src/core/nav/Pathfinding.ts` → `tests/unit/nav/Pathfinding.test.ts`.
- Every exported function gets a happy path, a boundary case, and a rejection case.
- Seed every PRNG (`{ seed: 42 }`). A test that calls `Math.random()` is a flaky test.
- `tests/integration/` exercises console command sequences through the real game loop. No DOM, no Three.js.
- A bug fix ships with a test that fails on the old code and passes on the fix.
- **Never sleep to wait.** Wait on the condition — a state field, a DOM property, an injected clock you advance yourself. A fixed delay encodes one machine's timing and fails on another. Where nothing is pollable, bound it and say why. Options per layer: `dev-testing-strategy`.

Suite inventory, coverage targets, and performance budgets: `dev-testing-strategy` skill.

## Reading a failure

Run the single failing file rather than the whole suite while iterating: `npx vitest run <path>`. When a test and the implementation disagree, decide which one is wrong before editing either — changing the assertion to match broken behaviour turns a red test into a silent regression.
