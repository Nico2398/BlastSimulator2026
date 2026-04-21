---
name: validator
description: >
  Validation specialist: runs the full test suite, type checking, and build
  verification. Detects regressions, type errors, and build failures.
  Reports pass/fail status with actionable diagnostics.
tools:
  - read
  - search
  - execute
---

# Validator — Full Suite Verification

**Pipeline position:** 4/5 (Validate). Previous: @refactorer. Next: @visual-tester (visual changes only).

Run complete validation suite. Report results.

## Validation Steps

Run in sequence. **All must pass.**

### Step 1: TypeScript Compilation
```bash
npx tsc --noEmit
```
Zero errors required.

### Step 2: Unit + Integration Tests
```bash
npx vitest run --reporter=verbose
```
Zero failures required.

### Step 3: Build Check
```bash
npx vite build
```
Output goes to `dist/`.

### Combined Command
```bash
npm run validate
```
Primary validation command. Runs all three steps.

## Report Format

### On Success
```
✅ VALIDATION PASSED
- TypeScript: 0 errors
- Tests: X passed, 0 failed
- Build: success
```

### On Failure
Report:
- Which step failed (tsc, vitest, build)
- Exact error message(s)
- File(s) + line number(s)
- Suggested action for implementer/refactorer

## Regression Detection

Check:
- Tests that previously passed but now fail?
- New compiler errors in unmodified files?
- Build output size reasonable?

## Interactive Verification (Optional)

For gameplay logic changes:
```bash
npx tsx src/console.ts
```

Key spot-check commands:
- `new_game seed:42` → `state summary`
- `drill_plan grid rows:2 cols:2 spacing:4 depth:6 start:15,15`
- `blast`
- `finances`
- `scores`

## Key References

- `testing-strategy` — test pyramid, coverage goals, validation workflow
- `architecture` — build system, project structure
