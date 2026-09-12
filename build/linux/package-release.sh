#!/usr/bin/env bash
set -e

# Stage Linux packages
mkdir -p release package/DEBIAN AppDir
printf '%s\n' \
  '[Desktop Entry]' \
  'Type=Application' \
  'Name=OhneGuessr' \
  'Comment=A free, lean, local GeoGuessr alternative.' \
  'Exec=ohneguessr' \
  'Icon=ohneguessr' \
  'Terminal=false' \
  'Categories=Game;' \
  'StartupWMClass=OhneGuessr' > ohneguessr.desktop
desktop-file-validate ohneguessr.desktop
convert build/appicon.png -resize 512x512 ohneguessr.png

install -Dm755 bin/OhneGuessr package/usr/bin/ohneguessr
install -Dm644 ohneguessr.desktop package/usr/share/applications/ohneguessr.desktop
install -Dm644 ohneguessr.png package/usr/share/icons/hicolor/512x512/apps/ohneguessr.png
printf '%s\n' \
  'Package: ohneguessr' \
  "Version: $RELEASE_VERSION" \
  'Section: games' \
  'Priority: optional' \
  'Architecture: amd64' \
  'Maintainer: OhneB' \
  'Depends: libwebkitgtk-6.0-4, pkexec' \
  'Description: A free, lean, local GeoGuessr alternative.' > package/DEBIAN/control
dpkg-deb --root-owner-group --build package "release/$DEB_NAME"

install -Dm755 bin/OhneGuessr AppDir/usr/bin/ohneguessr
install -Dm644 ohneguessr.desktop AppDir/usr/share/applications/ohneguessr.desktop
install -Dm644 ohneguessr.png AppDir/usr/share/icons/hicolor/512x512/apps/ohneguessr.png

# Build AppImage
curl --fail --location --output linuxdeploy \
  https://github.com/linuxdeploy/linuxdeploy/releases/download/1-alpha-20240109-1/linuxdeploy-x86_64.AppImage
echo "$LINUXDEPLOY_SHA256  linuxdeploy" | sha256sum --check
chmod +x linuxdeploy
ARCH=x86_64 OUTPUT="$GITHUB_WORKSPACE/release/$APPIMAGE_NAME" ./linuxdeploy \
  --appdir AppDir \
  --executable AppDir/usr/bin/ohneguessr \
  --desktop-file AppDir/usr/share/applications/ohneguessr.desktop \
  --icon-file AppDir/usr/share/icons/hicolor/512x512/apps/ohneguessr.png \
  --exclude-library 'libgdk_pixbuf-2.0.so*' \
  --exclude-library 'libgio-2.0.so*' \
  --exclude-library 'libglib-2.0.so*' \
  --exclude-library 'libgmodule-2.0.so*' \
  --exclude-library 'libgobject-2.0.so*' \
  --exclude-library 'libgtk-4.so*' \
  --exclude-library 'libjavascriptcoregtk-6.0.so*' \
  --exclude-library 'libsoup-3.0.so*' \
  --exclude-library 'libwebkitgtk-6.0.so*' \
  --output appimage

# Verify Linux packages
test -s "release/$APPIMAGE_NAME"
test -s "release/$DEB_NAME"
dpkg-deb --info "release/$DEB_NAME"
dpkg-deb --contents "release/$DEB_NAME"
