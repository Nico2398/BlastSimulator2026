# BlastSimulator2026

## Identity
You are developing **BlastSimulator2026**, a satirical open-pit mine management game. You are working autonomously — the human supervises occasionally but expects you to make progress independently on ALL technical matters.

## Creative Direction — WHEN TO ASK THE HUMAN
The human is the **creative director** of this game. You must ask for their input ONLY for creative decisions, and handle everything else autonomously. Here is the boundary:

**ASK the human (pause and request feedback) for:**
- Event content: before mass-generating events (tasks 6.3–6.7), propose 3-5 example events with their full structure (text, tone, decision options, consequences) and ask the human to validate the tone, humor level, and structure before generating the remaining 50-100 per category
- Naming: fictional names for rocks, explosives, ores, levels, characters — propose options, let the human pick
- Tone calibration: if unsure whether something is too dark, too silly, or off-brand, ask
- Game feel decisions: if a design choice affects how the game "feels" to play (e.g., how fast time passes, how punishing failures are), flag it

**DO NOT ask the human for:**
- Technical architecture, code structure, algorithms
- Test design, debugging, build issues
- Data structure choices (pick the best one, the human trusts your judgment)
- Numerical balancing (research and use plausible values — see section below)
- i18n translations (generate both EN and FR yourself)
- Any implementation detail

When you need creative input, clearly state what you need validated and propose concrete options. Do not send vague questions — send examples.

## Numerical Values and Balancing
For all game constants (rock fracture thresholds, explosive energy per kg, contract prices, salary ranges, score formulas, event timer intervals, etc.):
1. **Research real-world equivalents** where applicable (real blasting uses ANFO at ~3.4 MJ/kg, dynamite at ~7.5 MJ/kg, real drill holes are 75-150mm diameter, etc.)
2. **Scale to gameplay** — real values are a starting point, then adjust for fun. A blast shouldn't take 3 real-time hours.
3. **Store ALL constants in a centralized config** (`src/core/config/` or similar), never hardcode in logic
4. **Document your reasoning** in code comments: `// Real ANFO: 3.4 MJ/kg, scaled to game units (x100)`
5. The human will fine-tune values during polishing — your job is to get them in the right ballpark

## Before Every Task
1. Read the task list in `README.md` — find the **next unchecked task** (`- [ ]`)
2. Read its acceptance criteria carefully
3. Read any `.agent/*.md` files referenced (GAME_DESIGN.md, ARCHITECTURE.md, BLAST_SYSTEM.md, TESTING.md, WORKFLOW.md)
4. Do NOT skip tasks. Do NOT work on multiple tasks at once.

## During Every Task
- Write tests BEFORE or ALONGSIDE implementation
- All `src/core/` code must be **pure TypeScript** — no DOM, no WebGL, no `window`, no side effects
- All user-facing strings go through the i18n system (`t('key')`) — always add both `en.json` and `fr.json`
- No file should exceed 300 lines — split into sub-modules
- Use the seeded PRNG (`src/core/math/Random.ts`) for all randomness so tests are deterministic

## After Every Task
Run validation — this is mandatory, no exceptions:
```bash
bash scripts/validate.sh
```
This runs: TypeScript check → Tests → Build → Task consistency check.
The task consistency checker (`scripts/check-tasks.sh`) verifies that no tasks were skipped, that expected files exist for completed tasks, and that i18n keys are in sync between en.json and fr.json.

If validation fails, fix the issue before moving on. Then:
- Mark the task `[x]` in README.md
- Update the "Completed" count in the Progress Summary table

## Architecture Rules (never violate these)
- `src/core/` → pure logic, testable in Node.js, no imports from `renderer/`, `physics/`, `ui/`, `audio/`, `persistence/`
- `src/persistence/` → platform-specific save backends (IndexedDB, File, Download), imports only from `core/`
- `src/renderer/` → Three.js visuals, depends on core, never the reverse
- `src/physics/` → Cannon-es, only active during blasts
- `src/console/` → CLI mode, calls same core logic as the UI
- `src/ui/` → HTML overlay, reads from GameState
- State flows one way: Input → Core → State mutation → Event emitted → Renderer/UI/Audio

## Console↔Browser Bridge
When working on rendering (Phase 9+), `src/main.ts` must expose a `window.__gameConsole(cmd: string)` function that routes commands to the same ConsoleRunner used in CLI mode. This is required for the screenshot script (`scripts/screenshot.ts`) to work. Add this when implementing task 9.1 (Scene Manager).

## Console Mode
Every gameplay feature must work in console mode (`npx tsx src/console.ts`) before any UI/rendering work. This is how you test without a browser.

## Campaign Structure
The game has 3 levels of progressive difficulty on a world map. Level completion unlocks the next. Game-over conditions fail the current level only, not the campaign. See `.agent/GAME_DESIGN.md` §15.

## Save System
Three persistence backends: FilePersistence (local), IndexedDBPersistence (web), DownloadPersistence (fallback). Auto-detect environment. The `SaveBackend` interface lives in `src/core/state/SaveBackend.ts` (pure type). The implementations live in `src/persistence/` (NOT in core, since they use platform APIs). See task 1.3 in README.

## When Stuck
- Re-read the task description and `.agent/` docs
- Check if a prerequisite task was missed
- Implement the minimum viable version that satisfies acceptance criteria
- If truly blocked, add `<!-- BLOCKED: reason -->` next to the task and move to the next independent task

## Critical Reminder
The blast system is the CENTRAL mechanic. See `.agent/BLAST_SYSTEM.md` for the full algorithm. Every formula must be a pure function in `BlastCalc.ts` with unit tests. Do not cut corners on this.
