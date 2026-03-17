#!/usr/bin/env bash
# BlastSimulator2026 — Visual Test Helper
#
# Usage:
#   bash scripts/visual-test.sh --name "terrain" --commands "new_game mine_type:desert seed:42"
#
# Kills any process on port 5173, starts the dev server in background,
# waits for it to be ready, takes a screenshot, then cleans up on exit.

set -euo pipefail

NAME="screenshot"
COMMANDS=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)    NAME="$2";     shift 2 ;;
    --commands) COMMANDS="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

DEV_SERVER_PID=""

# Cleanup on exit
cleanup() {
  if [[ -n "$DEV_SERVER_PID" ]]; then
    echo "Stopping dev server (pid $DEV_SERVER_PID)..."
    kill "$DEV_SERVER_PID" 2>/dev/null || true
    wait "$DEV_SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Kill any existing process on port 5173
if lsof -ti :5173 &>/dev/null; then
  echo "Killing existing process on port 5173..."
  lsof -ti :5173 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# Start dev server in background
echo "Starting dev server..."
npm run dev &>/tmp/blast-dev.log &
DEV_SERVER_PID=$!

# Wait for server to be ready (up to 30 seconds)
echo "Waiting for server on http://localhost:5173..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:5173 &>/dev/null; then
    echo "Server ready."
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "ERROR: Server did not start after 30 seconds."
    cat /tmp/blast-dev.log
    exit 1
  fi
  sleep 1
done

# Build screenshot command
SCREENSHOT_ARGS=(--name "$NAME")
if [[ -n "$COMMANDS" ]]; then
  SCREENSHOT_ARGS+=(--commands "$COMMANDS")
fi

# Run screenshot
SCREENSHOT_PATH=$(npx tsx scripts/screenshot.ts "${SCREENSHOT_ARGS[@]}" 2>&1 | grep "Screenshot saved:" | sed 's/Screenshot saved: //')

if [[ -n "$SCREENSHOT_PATH" ]]; then
  echo "Screenshot: $SCREENSHOT_PATH"
else
  echo "WARNING: Could not parse screenshot path from output."
  npx tsx scripts/screenshot.ts "${SCREENSHOT_ARGS[@]}"
fi
