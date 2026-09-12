#!/usr/bin/env bash
set -e

# Upgrade and inspect DEB
sudo apt-get update
mkdir old-package
dpkg-deb --raw-extract "release/$DEB_NAME" old-package
sed -i 's/^Version:.*/Version: 0~update-smoke/' old-package/DEBIAN/control
dpkg-deb --root-owner-group --build old-package old.deb
sudo apt-get install --yes dbus-x11 xvfb ./old.deb
sudo apt-get --assume-yes --only-upgrade --no-remove install "$GITHUB_WORKSPACE/release/$DEB_NAME"
test "$(dpkg-query --show --showformat='${Status}' ohneguessr)" = "install ok installed"
test "$(dpkg-query --show --showformat='${Version}' ohneguessr)" = "$RELEASE_VERSION"
test -x /usr/bin/ohneguessr
test -x /usr/bin/pkexec
test -f /usr/share/applications/ohneguessr.desktop

# Launch AppImage
chmod +x "release/$APPIMAGE_NAME"
set +e
timeout 15s dbus-run-session -- xvfb-run -a \
  env APPIMAGE_EXTRACT_AND_RUN=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
  "release/$APPIMAGE_NAME" > appimage.log 2>&1
status=$?
set -e
cat appimage.log
if [ "$status" -ne 124 ]; then
  echo "AppImage exited before the smoke-test timeout (status $status)" >&2
  exit 1
fi
