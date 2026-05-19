# LangGraph Pipeline — Session Notes (2026-05-19)

## Current State

Issue: #116 — Render survey confidence overlay in TerrainMesh.ts  
Pipeline branch: `copilot/replace-openswe-agent-with-langgraph`  
Work branch: `langgraph/tests-116`

### Commits on `langgraph/tests-116`
```
test(integration): integration tests for #116     ← integration_test_writer ✅
fix(pipeline): extract_ok false-negative          ← pipeline fix (cherry-picked to main branch)
test(unit): unit tests for #116                   ← unit_test_writer ✅
chore(skeleton): empty stubs for #116             ← skeleton_writer ✅
```

### Commits on `copilot/replace-openswe-agent-with-langgraph`
All Windows tool fixes + extract_ok fix are present.

---

## Fixes Applied This Session

| Commit | Fix |
|--------|-----|
| `18d5cdf` | `shell_tools.py` — utf-8 decode with `errors="replace"` (Vitest ✓/✕ chars) |
| `18d5cdf` | `fs_tools.py` — `read_file` dir guard + PermissionError handler |
| `3076ede` | `fs_tools.py` — `_py_grep()` pure-Python fallback (no `rg`/`grep` on Windows) |
| `3076ede` | `fs_tools.py` / `shell_tools.py` — `_REPO_ROOT = Path(__file__).parent.parent.parent` |
| `dfcadeb` | `git_tools.py` — same `_REPO_ROOT` fix + `search_parent_directories=True` |
| `4a46b74` | `_base.py` — `extract_ok(allow_expected_failures=True)` to avoid false-negative on Red-phase output |
| `4a46b74` | `unit_test_writer.py`, `integration_test_writer.py`, `scenario_test_writer.py` — pass flag |

---

## Remaining Issues

### 1. Pipeline crashes after `integration_test_writer` (exit code 1)

**Status:** Unknown root cause — pipeline ran but exited with code 1 after integration tests committed.

**How to diagnose:** On next session, run:
```powershell
Push-Location "C:\Users\Nicolas\Documents\Nico2398\BlastSimulator2026"
git branch -D langgraph/tests-116 langgraph/impl-116 2>$null
git push origin --delete langgraph/tests-116 langgraph/impl-116 2>$null
git checkout copilot/replace-openswe-agent-with-langgraph
Push-Location ".langgraph"
uv run python runner.py 2>&1 | Tee-Object -FilePath pipeline.log
```
Then check `pipeline.log` for the exact crash line.

**Likely suspects:**
- `scenario_test_writer` fails because scenario JSON files don't have a `#116` entry
- `implementer` triggers a TypeScript compile error (TS6133 unused params in stubs)
- `open_pr` missing `Closes #116` check causing a crash
- `cherry_pick` node tries to merge branches that don't exist yet

### 2. `scenario_test_writer` — no scenario def for #116

**Status:** The issue is a renderer feature (TerrainMesh overlay). There is no scenario JSON for it in `scripts/scenario-defs/`.

**Fix needed:** Either:
- Create a minimal scenario def `scripts/scenario-defs/survey-overlay.json` that verifies the overlay renders
- Or add `skip_scenario_tests: true` to the pipeline state for renderer-only tasks

For now the simpler fix is to skip: in `.langgraph/graph.py` the `route_from_integration_test_writer` checks `state.get("skip_scenario_tests")`. The `skeleton_writer` can set this flag when the issue is renderer-only.

### 3. `tail` / `grep` not on Windows PATH

**Status:** The `_py_grep` fallback handles `grep`. But agents still sometimes call `tail` in shell commands.

**Fix needed:** Add a PowerShell-friendly fallback in `shell_tools.py` or document in the agent prompt not to use `tail`/`grep` in shell commands.

```python
# In run_shell(), translate tail/grep to PowerShell equivalents:
cmd = cmd.replace(" | tail -", " | Select-Object -Last ")
cmd = cmd.replace(" | grep ", ' | Select-String -Pattern ')
```

### 4. `unit_test_writer` ran twice (retry loop)

**Cause:** `extract_ok` matched "tests fail" in the Red-phase summary before the fix.
**Fix:** Applied (`4a46b74`). On next run the agent should exit ✅ on first pass.

---

## How to Resume

```powershell
# 1. Clean up work branches from aborted run
Push-Location "C:\Users\Nicolas\Documents\Nico2398\BlastSimulator2026"
git checkout copilot/replace-openswe-agent-with-langgraph
git branch -D langgraph/tests-116 langgraph/impl-116 2>$null
git push origin --delete langgraph/tests-116 langgraph/impl-116 2>$null

# 2. Run pipeline
Push-Location ".langgraph"
uv run python runner.py
```

The pipeline should now proceed cleanly through:
`skeleton_writer` → `unit_test_writer` ✅ → `integration_test_writer` ✅ → `scenario_test_writer` → `implementer` → `cherry_pick` → `test_runner` → `qualimetry` → `code_review` → `refactorer` → `validator` → `open_pr`

---

## Test Branch State (if you want to reuse existing tests)

The tests written on the aborted run are good. If you don't want to regenerate:

```powershell
# Cherry-pick test commits onto a fresh branch
git checkout copilot/replace-openswe-agent-with-langgraph
git checkout -b langgraph/tests-116
git cherry-pick eb2c722  # skeleton stubs
git cherry-pick bc163a5  # unit tests
git cherry-pick 743a83a  # integration tests
git push -u origin langgraph/tests-116
```

Then modify `runner.py` to skip the test-writing phases and jump straight to `implementer`.
