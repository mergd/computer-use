#!/bin/bash
set -e

cd "$(dirname "$0")"

# Clean and create dist
rm -rf dist
mkdir -p dist

# Compile TypeScript
npx tsc

# Copy static files
cp manifest.json dist/
cp *.html dist/
cp *.js dist/
cp *.png dist/ 2>/dev/null || true
cp *.svg dist/ 2>/dev/null || true

# Remove 'export {};' from content scripts (they're not modules)
# These files are injected into pages and can't use ES module syntax
sed -i '' 's/^export {};$//' dist/accessibility-tree.js dist/agent-visual-indicator.js 2>/dev/null || true

echo "Build complete: extension/dist/"
