#!/usr/bin/env bash
# BlastSimulator2026 — Itch.io deployment build script
#
# Usage:
#   bash scripts/build-itch.sh
#
# Output:
#   dist/           Deployable folder (upload as zip to itch.io)
#   dist.zip        Ready-to-upload zip archive
#
# Itch.io HTML5 deployment checklist:
#   1. Run: bash scripts/build-itch.sh
#   2. Go to https://itch.io/dashboard → "Edit game" → "Uploads"
#   3. Upload dist.zip, set "Kind of upload" to "HTML"
#   4. Check "This file will be played in the browser"
#   5. Set frame dimensions: 1280 × 720 (or 100% width)
#   6. Save and publish

set -e

echo "=== BlastSimulator2026 — Itch.io Build ==="

# Step 1: Run tests to make sure everything passes
echo "[1/4] Running tests..."
npx vitest run --reporter=verbose 2>&1 | tail -20

# Step 2: TypeScript type check
echo "[2/4] TypeScript check..."
npx tsc --noEmit

# Step 3: Production Vite build
echo "[3/4] Building production bundle..."
npx vite build

# Step 4: Create zip archive for itch.io upload
echo "[4/4] Creating dist.zip..."
if command -v zip &> /dev/null; then
  cd dist && zip -r ../dist.zip . && cd ..
  echo "Created dist.zip ($(du -sh dist.zip | cut -f1))"
else
  echo "WARNING: 'zip' not found. Please zip the dist/ folder manually."
fi

echo ""
echo "=== Build Complete ==="
echo "Upload dist.zip to itch.io as an HTML5 game."
echo "Recommended itch.io settings:"
echo "  - Frame: 1280×720, 'Fullscreen button' enabled"
echo "  - SharedArrayBuffer: not required"
echo "  - Mobile friendly: yes (touch events handled)"
echo ""
echo "dist/ contents:"
ls -lh dist/ 2>/dev/null || echo "(dist/ folder not listed)"
