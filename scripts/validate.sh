#!/bin/bash
# BlastSimulator2026 — Validation Script
# Run after every task to ensure nothing is broken.
# Usage: bash scripts/validate.sh
set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
RESET='\033[0m'

step() {
    echo -e "\n${BOLD}=== $1 ===${RESET}"
}

pass() {
    echo -e "${GREEN}✓ $1${RESET}"
}

fail() {
    echo -e "${RED}✗ $1${RESET}"
    exit 1
}

# Step 1: TypeScript type checking
step "TypeScript Compilation Check"
if npx tsc --noEmit 2>&1; then
    pass "TypeScript compilation OK"
else
    fail "TypeScript compilation failed. Fix type errors before proceeding."
fi

# Step 2: Linting (if eslint configured)
if [ -f ".eslintrc.json" ] || [ -f ".eslintrc.js" ] || [ -f "eslint.config.js" ]; then
    step "Lint Check"
    if npx eslint src/ --ext .ts,.tsx 2>&1; then
        pass "Linting OK"
    else
        fail "Lint errors found. Fix them before proceeding."
    fi
fi

# Step 3: Unit and integration tests
step "Running Tests"
if npx vitest run --reporter=verbose 2>&1; then
    pass "All tests passed"
else
    fail "Tests failed. Fix failing tests before proceeding."
fi

# Step 4: Build check
step "Build Check"
if npx vite build 2>&1; then
    pass "Build successful"
else
    fail "Build failed. Fix build errors before proceeding."
fi

# Summary
echo -e "\n${GREEN}${BOLD}=== ALL VALIDATIONS PASSED ===${RESET}"
