# Core Purity

`src/core/` is the simulation. It runs in Node.js with no browser, which is what makes the `logic` and `scenario` verification channels possible.

- Zero side effects: no DOM, `window`, WebGL, file I/O, or timers.
- Never import from `src/renderer/`, `src/ui/`, `src/physics/`, `src/persistence/`, or `src/audio/`. Dependencies point one way, inward.
- Randomness comes from `src/core/math/Random.ts` with an explicit seed. `Math.random()` breaks determinism and every test that depends on it.
- Constants live in `src/core/config/`. No magic numbers in logic files.
- Functions return `Result<T>` rather than throwing.

Adding an exported function here means adding its unit test in the mirrored `tests/unit/` path. Module boundaries and data flow: `dev-architecture` skill. Style and error handling: `dev-coding-conventions` skill.
