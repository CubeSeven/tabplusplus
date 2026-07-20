#!/bin/bash
# Build zip for Chrome Web Store submission

VERSION=$(grep '"version"' manifest.json | sed 's/.*"\(.*\)".*/\1/')
OUTPUT="tabs-plus-plus-${VERSION}.zip"

rm -f "$OUTPUT"

7z a -tzip "$OUTPUT" . \
  -xr'!.git' \
  -xr'!.github' \
  -xr'!node_modules' \
  -xr'!.opencode' \
  -xr'!.hermes' \
  -xr'!.codebuddy' \
  -xr'!*.zip' \
  -xr'!assets/store' \
  -xr'!build-zip.sh' \
  -xr'!docs' \
  -xr'!tabs-plus-plus-*'

echo "Created $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
