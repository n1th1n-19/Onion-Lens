#!/usr/bin/env sh
# Build the store-ready zip: dist/onion-lens-<manifest version>.zip
set -eu
cd "$(dirname "$0")"
version=$(node -p "require('./manifest.json').version")
out="dist/onion-lens-$version.zip"
mkdir -p dist
rm -f "$out"
zip -qr "$out" manifest.json background.js colors.js db.js picker.js shot.js popup.js editor.js \
  popup.html editor.html theme.css popup.css editor.css LICENSE fonts icons logo/logo.svg
echo "$out"
