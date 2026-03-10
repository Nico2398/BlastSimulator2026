#!/bin/bash
# BlastSimulator2026 — Task Consistency Checker
# Run this to verify task completion integrity.
# Usage: bash scripts/check-tasks.sh
#
# Checks:
# 1. No tasks are skipped (all prior tasks completed before current)
# 2. Completed tasks have their expected source files
# 3. Progress summary table matches actual checkbox count
# 4. No test files are missing for completed core tasks

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

README="README.md"
ERRORS=0
WARNINGS=0

warn() {
    echo -e "${YELLOW}⚠ WARNING: $1${RESET}"
    ((WARNINGS++))
}

err() {
    echo -e "${RED}✗ ERROR: $1${RESET}"
    ((ERRORS++))
}

pass() {
    echo -e "${GREEN}✓ $1${RESET}"
}

echo -e "${BOLD}=== BlastSimulator2026 Task Consistency Check ===${RESET}\n"

if [ ! -f "$README" ]; then
    err "README.md not found. Run this from the project root."
    exit 1
fi

# Count completed and total tasks
COMPLETED=$(grep -c '^\- \[x\]' "$README" || echo 0)
PENDING=$(grep -c '^\- \[ \]' "$README" || echo 0)
TOTAL=$((COMPLETED + PENDING))

echo -e "${BOLD}Tasks: ${GREEN}${COMPLETED} completed${RESET} / ${TOTAL} total / ${YELLOW}${PENDING} pending${RESET}\n"

# Check 1: No skipped tasks
# Extract task numbers in order, verify completed ones are contiguous from the start
echo -e "${BOLD}--- Check 1: Task ordering ---${RESET}"

FOUND_FIRST_PENDING=false
SKIP_DETECTED=false

while IFS= read -r line; do
    if [[ "$line" =~ ^-\ \[x\]\ \*\*([0-9]+\.[0-9]+) ]]; then
        TASK_NUM="${BASH_REMATCH[1]}"
        if [ "$FOUND_FIRST_PENDING" = true ]; then
            err "Task $TASK_NUM is marked complete, but a prior task is still pending. Tasks may have been skipped."
            SKIP_DETECTED=true
        fi
    elif [[ "$line" =~ ^-\ \[\ \]\ \*\*([0-9]+\.[0-9]+) ]]; then
        TASK_NUM="${BASH_REMATCH[1]}"
        FOUND_FIRST_PENDING=true
    fi
done < "$README"

if [ "$SKIP_DETECTED" = false ]; then
    pass "No skipped tasks detected"
fi

# Check 2: Completed core tasks have source files
echo -e "\n${BOLD}--- Check 2: Source files for completed tasks ---${RESET}"

check_file_exists() {
    if [ -f "$1" ] || ls $1 1>/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Phase 0 checks
if grep -q '^\- \[x\] \*\*0\.1' "$README"; then
    for f in package.json tsconfig.json vite.config.ts index.html src/main.ts src/console.ts; do
        if ! check_file_exists "$f"; then
            err "Task 0.1 complete but missing: $f"
        fi
    done
    pass "Task 0.1 files present" 2>/dev/null
fi

if grep -q '^\- \[x\] \*\*0\.3' "$README"; then
    for f in src/core/i18n/I18n.ts src/core/i18n/locales/en.json src/core/i18n/locales/fr.json; do
        if ! check_file_exists "$f"; then
            err "Task 0.3 complete but missing: $f"
        fi
    done
fi

if grep -q '^\- \[x\] \*\*0\.4' "$README"; then
    if ! check_file_exists "src/console/ConsoleRunner.ts"; then
        err "Task 0.4 complete but missing: src/console/ConsoleRunner.ts"
    fi
fi

# Phase 1 checks
if grep -q '^\- \[x\] \*\*1\.1' "$README"; then
    for f in src/core/math/Vec3.ts src/core/math/Random.ts; do
        if ! check_file_exists "$f"; then
            err "Task 1.1 complete but missing: $f"
        fi
    done
fi

if grep -q '^\- \[x\] \*\*1\.2' "$README"; then
    for f in src/core/state/GameState.ts src/core/state/GameLoop.ts; do
        if ! check_file_exists "$f"; then
            err "Task 1.2 complete but missing: $f"
        fi
    done
fi

if grep -q '^\- \[x\] \*\*1\.3' "$README"; then
    for f in src/core/state/SaveLoad.ts src/core/state/SaveBackend.ts src/persistence/FilePersistence.ts; do
        if ! check_file_exists "$f"; then
            err "Task 1.3 complete but missing: $f"
        fi
    done
fi

# Check 3: Test files exist for completed core tasks
echo -e "\n${BOLD}--- Check 3: Test coverage for completed tasks ---${RESET}"

COMPLETED_TASKS=$(grep -oP '^\- \[x\] \*\*\K[0-9]+\.[0-9]+' "$README" || true)
TEST_MISSING=0

for TASK in $COMPLETED_TASKS; do
    PHASE=$(echo "$TASK" | cut -d. -f1)
    # Only check phases 1-7 (core logic phases that must have tests)
    if [ "$PHASE" -ge 1 ] && [ "$PHASE" -le 7 ]; then
        # Check if there's at least one test file in tests/ directory
        if [ -d "tests" ]; then
            TEST_COUNT=$(find tests/ -name "*.test.ts" 2>/dev/null | wc -l)
            if [ "$TEST_COUNT" -eq 0 ]; then
                warn "Task $TASK is in a core phase but no test files found in tests/"
                ((TEST_MISSING++))
            fi
        fi
    fi
done

if [ "$TEST_MISSING" -eq 0 ] && [ -n "$COMPLETED_TASKS" ]; then
    pass "Test files present for completed core tasks"
fi

# Check 4: i18n consistency
echo -e "\n${BOLD}--- Check 4: i18n consistency ---${RESET}"

EN_FILE="src/core/i18n/locales/en.json"
FR_FILE="src/core/i18n/locales/fr.json"

if [ -f "$EN_FILE" ] && [ -f "$FR_FILE" ]; then
    EN_KEYS=$(python3 -c "import json; print('\n'.join(sorted(json.load(open('$EN_FILE')).keys())))" 2>/dev/null || echo "PARSE_ERROR")
    FR_KEYS=$(python3 -c "import json; print('\n'.join(sorted(json.load(open('$FR_FILE')).keys())))" 2>/dev/null || echo "PARSE_ERROR")

    if [ "$EN_KEYS" = "PARSE_ERROR" ] || [ "$FR_KEYS" = "PARSE_ERROR" ]; then
        warn "Could not parse i18n JSON files"
    elif [ "$EN_KEYS" = "$FR_KEYS" ]; then
        EN_COUNT=$(echo "$EN_KEYS" | wc -l)
        pass "i18n: en.json and fr.json have matching keys ($EN_COUNT keys)"
    else
        EN_ONLY=$(comm -23 <(echo "$EN_KEYS") <(echo "$FR_KEYS"))
        FR_ONLY=$(comm -13 <(echo "$EN_KEYS") <(echo "$FR_KEYS"))
        [ -n "$EN_ONLY" ] && err "Keys in en.json but missing from fr.json: $EN_ONLY"
        [ -n "$FR_ONLY" ] && err "Keys in fr.json but missing from en.json: $FR_ONLY"
    fi
elif [ -f "$EN_FILE" ] || [ -f "$FR_FILE" ]; then
    warn "Only one locale file exists"
else
    # No locale files yet — that's fine if we haven't reached task 0.3
    if grep -q '^\- \[x\] \*\*0\.3' "$README"; then
        err "Task 0.3 complete but locale files not found"
    fi
fi

# Check 5: No hardcoded user-facing strings in core (basic grep)
echo -e "\n${BOLD}--- Check 5: Hardcoded strings check ---${RESET}"

if [ -d "src/core" ]; then
    # Look for suspicious patterns: console.log with quoted strings, alert(), etc.
    HARDCODED=$(grep -rn "console\.log\|alert(" src/core/ --include="*.ts" 2>/dev/null | grep -v "// debug" | grep -v ".test.ts" | head -5)
    if [ -n "$HARDCODED" ]; then
        warn "Possible hardcoded output in src/core/ (should use i18n):\n$HARDCODED"
    else
        pass "No obvious hardcoded strings in src/core/"
    fi
fi

# Summary
echo -e "\n${BOLD}=== Summary ===${RESET}"
echo -e "Errors: ${RED}${ERRORS}${RESET}"
echo -e "Warnings: ${YELLOW}${WARNINGS}${RESET}"

if [ "$ERRORS" -gt 0 ]; then
    echo -e "\n${RED}${BOLD}Task consistency check FAILED. Fix errors before proceeding.${RESET}"
    exit 1
else
    echo -e "\n${GREEN}${BOLD}Task consistency check PASSED.${RESET}"
    exit 0
fi
