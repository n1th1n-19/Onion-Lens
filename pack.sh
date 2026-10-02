#!/usr/bin/env sh
# Build store-ready zips from the shared manifest.json:
#   dist/onion-lens-<version>-chrome.zip   Chrome, Edge, Opera, Brave, Vivaldi (no Firefox-only keys)
#   dist/onion-lens-<version>-firefox.zip  Firefox AMO (no service_worker key)
set -eu
cd "$(dirname "$0")"
version=$(node -p "require('./manifest.json').version")
files="background.js colors.js db.js picker.js shot.js popup.js editor.js
  popup.html editor.html theme.css popup.css editor.css LICENSE fonts icons logo/logo.svg"
mkdir -p dist

build() { # build <target>
  stage=$(mktemp -d)
  # shellcheck disable=SC2086
  tar cf - $files | (cd "$stage" && tar xf -)
  node -e '
    const fs = require("fs"), m = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
    if (process.argv[1] === "chrome") { delete m.background.scripts; delete m.browser_specific_settings; }
    else delete m.background.service_worker;
    fs.writeFileSync(process.argv[2] + "/manifest.json", JSON.stringify(m, null, 2) + "\n");
  ' "$1" "$stage"
  out="$PWD/dist/onion-lens-$version-$1.zip"
  rm -f "$out"
  (cd "$stage" && zip -qr "$out" .)
  rm -rf "$stage"
  echo "dist/onion-lens-$version-$1.zip"
}

build chrome
build firefox
