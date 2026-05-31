# BlastSimulator2026

**A wacky open-pit mine management game in the spirit of Theme Hospital.** Manage blasting, rubble recovery, contracts, employees, and corruption — all while navigating union strikes, mafia entanglements, and the ever-present risk of launching boulders into nearby villages. A satirical caricature of capitalism with cartoon 3D visuals. Progress through a world map of increasingly challenging mine sites, from a beginner's quarry to an endgame rare-earth nightmare.

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Language | TypeScript | 5.x (strict) | Type safety |
| Build tool | Vite | 5.x | Fast build, HMR, static HTML output for itch.io |
| 3D Rendering | Three.js | latest | Cartoon 3D graphics |
| Physics | cannon-es | latest | Rigid body simulation for blast fragments |
| Terrain | Marching Cubes | custom impl | Smooth surface from voxel grid |
| Noise | simplex-noise | 4.x | Procedural terrain and ore vein generation |
| Testing | Vitest | latest | Unit + integration tests, Node.js native |
| Visual testing | Puppeteer | latest | Headless Chrome screenshot capture |
| Console mode | Node.js + tsx | latest | CLI gameplay for testing without a browser |

---

## Install and Run

```bash
npm install
npm run dev        # Start dev server at http://localhost:5173
```

---

## Console Mode

Every gameplay feature is accessible without a browser via the interactive CLI:

```bash
npm run console    # Start interactive REPL
# e.g.: new_game seed:42 mine_type:desert
#       survey 25,30
#       drill_plan grid origin:20,25 rows:3 cols:4 spacing:3 depth:8
#       blast
#       finances
#       scores
```

---

## Tests and Validation

```bash
npm run test       # Run unit + integration tests (Vitest)
npm run validate   # Full validation: TypeScript check → tests → build
```

For visual regression testing (requires a running dev server):

```bash
bash scripts/visual-test.sh --name "scene" --commands "new_game seed:1"
# Screenshots saved to screenshots/
```

---

## Build for itch.io

```bash
npm run build
# Output: dist/
# Upload the entire dist/ folder to itch.io as an HTML5 game.
# The build produces a single index.html with bundled assets.
```

---

## Desktop App

There is currently no Electron wrapper. To add one:
1. `npm install --save-dev electron electron-builder`
2. Create a `src/electron/main.js` that loads `dist/index.html`
3. Add `"electron": "electron src/electron/main.js"` and `"package": "electron-builder"` scripts
4. The save system will auto-detect Node.js and use `FilePersistence` for saves

---

## Project Structure

```
src/
  core/         Pure TypeScript game logic — no DOM, no WebGL, fully testable in Node.js
  renderer/     Three.js visuals (depends on core, never the reverse)
  physics/      Cannon-es rigid body simulation (active only during blasts)
  ui/           HTML overlay panels (reads from GameState)
  audio/        Web Audio API sound system
  persistence/  Save backends: FilePersistence, IndexedDBPersistence, DownloadPersistence
  console/      CLI mode — same core logic as the browser UI
  main.ts       Browser entry point
  console.ts    CLI entry point

tests/
  unit/         Pure logic tests (run in Node.js, no browser)
  integration/  Full gameplay scenario tests

scripts/
  validate.sh         Full validation pipeline
  visual-test.sh      One-command screenshot capture helper
  screenshot.ts       Puppeteer-based screenshot script

.github/              Agent context (primary — edit here)
  copilot-instructions.md  Global instruction layer
  agents/             Agent role definitions (.agent.md)
  skills/             Domain-specific skill specs (SKILL.md)
  workflows/          GitHub Actions CI/CD

.claude/              Claude Code — derived copy of .github/
  CLAUDE.md           Project context
  agents/             Agent role definitions
  skills/             Domain-specific skill specs

.opencode/            OpenCode — derived copy of .github/
  AGENTS.md           Project context
  agents/             Agent role definitions
  skills/             Domain-specific skill specs

.langgraph/           LangGraph typed-state pipeline
  graph.py            StateGraph definition
  nodes/              Per-step node implementations
  tools/              Shared tool implementations
```

---

## Agentic pipeline setup (GitHub CLI + token)

If the pipeline reaches the PR creation step, `gh` must be authenticated with a token that can write branches and PR metadata.

1. Create a GitHub token on your GitHub instance:
   - GitHub menu path: **Profile photo → Settings → Developer settings → Personal access tokens** (choose **Tokens (classic)** or **Fine-grained tokens**).
   - Classic PAT: `repo`, `read:org`, `gist`
   - Fine-grained PAT (alternative): repository access with **Contents: Read/Write**, **Pull requests: Read/Write**, **Issues: Read/Write**, **Metadata: Read**
2. Export token for local agent runs:

   ```bash
   export GH_TOKEN="<your_token>"
   export GITHUB_TOKEN="$GH_TOKEN"
   ```

   ```powershell
   # Windows PowerShell
   $env:GH_TOKEN="<your_token>"
   $env:GITHUB_TOKEN="$env:GH_TOKEN"
   ```

   This is still needed for many non-interactive agent/tool invocations that read `GH_TOKEN`/`GITHUB_TOKEN` directly, even if `gh auth login` was already done.

   For one-time local setup, add these exports to your shell profile (`~/.bashrc` / `~/.zshrc` on Linux/macOS, or `$PROFILE` in Windows PowerShell).

3. Determine your GitHub hostname:

   Check your git remote to find the correct hostname:
   ```bash
   git remote -v
   # Example: origin  git@nico.github.com:Nico2398/BlastSimulator2026.git
   # Hostname is "nico.github.com" in this case
   ```

4. Authenticate GitHub CLI (for permanent credential storage):

   If `GH_TOKEN` is set, `gh` uses the env var and skips credential storage — you'll see a warning like *"The value of the GH_TOKEN environment variable is being used for authentication. To have GitHub CLI store credentials instead, first clear the value from the environment."* To store credentials permanently (no env var needed), clear it first:

   ```bash
   unset GH_TOKEN
   unset GITHUB_TOKEN
   gh auth login --hostname <hostname> --with-token <<< "<your_token>"
   gh auth status
   ```

   ```powershell
   # Windows PowerShell — must unset to avoid env-var override
   $env:GH_TOKEN = $null
   $env:GITHUB_TOKEN = $null
   "<your_token>" | gh auth login --hostname <hostname> --with-token
   gh auth status
   ```

   After permanent login succeeds, you can delete `GH_TOKEN`/`GITHUB_TOKEN` from your shell profile or keep them set — they won't interfere unless `gh` finds them at login time. Once stored, `gh` works across new terminals without any env vars.

5. Quick permission sanity check:

   ```bash
   gh issue view 1
   gh pr list --limit 5
   ```

If these commands fail with permission/auth errors, the agent will not be able to open or update PRs.

### Comment trigger migration

> **Status: TO BE ADDED**
>
> Planned trigger path: `@opencode` comment invocation (intended replacement for older `@langgraph` / `@open-swe` comment triggers).
