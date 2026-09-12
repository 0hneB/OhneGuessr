#!/usr/bin/env bash
set -e

# Validate release files
expected=(
  "OhneGuessr-$RELEASE_VERSION-linux-x64.AppImage"
  "OhneGuessr-$RELEASE_VERSION-linux-x64.deb"
  "OhneGuessr-$RELEASE_VERSION-macos.dmg"
  "OhneGuessr-$RELEASE_VERSION-macos-universal.app.tar.gz"
  "OhneGuessr-$RELEASE_VERSION-windows-x64-setup.exe"
  "OhneGuessr-$RELEASE_VERSION-windows-x64.exe"
  "SHA256SUMS.txt"
  "latest.json"
)
mapfile -t actual < <(find release -maxdepth 1 -type f -printf '%f\n' | sort)
if ! diff -u <(printf '%s\n' "${expected[@]}" | sort) <(printf '%s\n' "${actual[@]}"); then
  echo "Release files do not match the expected set" >&2
  exit 1
fi
jq -e --arg filename "OhneGuessr-$RELEASE_VERSION-linux-x64.deb" '
  .artifacts | any(
    .platform == "linux" and
    .arch == "amd64" and
    .filename == $filename and
    .digestAlgo == "sha256" and
    .signatureAlgo == "ed25519" and
    (.digest | length) > 0 and
    (.signature | length) > 0
  )
' release/latest.json > /dev/null
