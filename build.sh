#!/bin/bash
set -e

echo "Building computer-control..."

rm -rf dist

echo "  Bundling CLI..."
bun build src/cli.ts --target=node --outfile=dist/cli.js

echo "  Bundling native host..."
bun build src/native-host-entry.ts --target=node --outfile=dist/native-host-entry.js

for f in dist/cli.js dist/native-host-entry.js; do
  if ! head -1 "$f" | grep -q '^#!'; then
    tmp=$(mktemp)
    printf '#!/usr/bin/env node\n' > "$tmp"
    cat "$f" >> "$tmp"
    mv "$tmp" "$f"
  fi
  chmod +x "$f"
done

echo "Done — dist/cli.js ($(du -h dist/cli.js | cut -f1)), dist/native-host-entry.js ($(du -h dist/native-host-entry.js | cut -f1))"
