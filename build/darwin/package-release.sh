#!/usr/bin/env bash
set -e

# Build and verify DMG
mkdir -p release dmg
cp -R bin/OhneGuessr.app dmg/
ln -s /Applications dmg/Applications
hdiutil create -volname OhneGuessr -srcfolder dmg -format UDZO -ov "release/$DMG_NAME"

mount_point="$RUNNER_TEMP/ohneguessr-dmg"
mkdir -p "$mount_point"
hdiutil attach "release/$DMG_NAME" -mountpoint "$mount_point" -nobrowse -readonly
trap 'hdiutil detach "$mount_point" || true' EXIT
test -d "$mount_point/OhneGuessr.app"
lipo "$mount_point/OhneGuessr.app/Contents/MacOS/OhneGuessr" -verify_arch x86_64 arm64
hdiutil detach "$mount_point"
trap - EXIT

# Build and verify updater archive
COPYFILE_DISABLE=1 tar -czf "release/$UPDATE_NAME" -C bin OhneGuessr.app
update_dir="$RUNNER_TEMP/ohneguessr-update"
mkdir -p "$update_dir"
tar -xzf "release/$UPDATE_NAME" -C "$update_dir"
test -x "$update_dir/OhneGuessr.app/Contents/MacOS/OhneGuessr"
lipo "$update_dir/OhneGuessr.app/Contents/MacOS/OhneGuessr" -verify_arch x86_64 arm64
codesign --verify --deep --strict --verbose=2 "$update_dir/OhneGuessr.app"
