#!/usr/bin/env sh
# Build packages from the shared manifest.json, per browser target:
#   dist/onion-lens-<v>-chrome/              unpacked folder, ready for "Load unpacked"
#   dist/onion-lens-<v>-chrome.zip           store upload (Chrome, Edge, Opera; manifest at zip root)
#   dist/onion-lens-<v>-chrome-unpacked.zip  the unpacked folder, zipped for download
# ...and the same three for firefox (Firefox AMO / about:debugging).
set -eu
cd "$(dirname "$0")"
version=$(node -p "require('./manifest.json').version")
files="background.js colors.js db.js picker.js shot.js popup.js editor.js
  popup.html editor.html theme.css popup.css editor.css LICENSE fonts icons logo/logo.svg"
mkdir -p dist

build() { # build <target>
  name="onion-lens-$version-$1"
  rm -rf "dist/$name" "dist/$name.zip" "dist/$name-unpacked.zip"
  mkdir "dist/$name"
  # shellcheck disable=SC2086
  tar cf - $files | (cd "dist/$name" && tar xf -)
  # Chrome flags Firefox-only keys as unrecognized; Firefox ignores (and warns on) service_worker.
  node -e '
    const fs = require("fs"), m = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
    if (process.argv[1] === "chrome") { delete m.background.scripts; delete m.browser_specific_settings; }
    else delete m.background.service_worker;
    fs.writeFileSync(process.argv[2] + "/manifest.json", JSON.stringify(m, null, 2) + "\n");
  ' "$1" "dist/$name"
  (cd "dist/$name" && zip -qr "../$name.zip" .)
  (cd dist && zip -qr "$name-unpacked.zip" "$name")
  echo "dist/$name.zip"
  echo "dist/$name-unpacked.zip"
}

build chrome
build firefox
