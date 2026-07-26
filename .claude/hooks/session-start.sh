#!/usr/bin/env bash
# SessionStart hook — make the verification channels usable before work begins.
#
# A fresh container has no node_modules, so every verification channel
# (typecheck, tests, scenarios, screenshots) fails until dependencies exist.
# This installs them once, then reports which channels are live.
#
# Output on stdout is added to the session context.

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

if [ ! -d node_modules/vitest ]; then
    echo "Installing dependencies (node_modules absent)..."
    if ! npm ci --no-audit --no-fund 2>&1 | tail -5; then
        echo "npm ci failed — run it manually before relying on any verification channel."
        exit 0
    fi
fi

npx --no-install tsx scripts/verify-env.ts 2>/dev/null || true

exit 0
