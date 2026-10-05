#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source core.lock
if [[ ! -d .build/core/.git ]]; then
  mkdir -p .build
  git clone --no-checkout "https://github.com/${repository}.git" .build/core
fi
git -C .build/core fetch --depth 1 origin "refs/tags/$ref"
resolved=$(git -C .build/core rev-parse 'FETCH_HEAD^{commit}')
[[ "$resolved" == "$sha" ]] || { echo 'Core tag does not match core.lock' >&2; exit 1; }
# --force: брэндийн хуулбар (доор) өмнөх ажиллуулалтаас үлдсэн байж болно.
git -C .build/core checkout --force --detach "$sha"
mkdir -p .build/core/frontend/public/brand
cp brand/*.svg .build/core/frontend/public/brand/
# Mobile brand overlay (docs/mobile-app-prompt.mn.md): iOS reads Brand.local.xcconfig,
# Android takes -PbrandFile=$PWD/mobile-brand/brand.properties; icons replace the core's.
mobile=.build/core/native-apps/mobile
cp mobile-brand/Brand.local.xcconfig "$mobile/ios/"
cp mobile-brand/ios/AppIcon.appiconset/icon-1024.png "$mobile/ios/Assets.xcassets/AppIcon.appiconset/"
cp -R mobile-brand/android/res/. "$mobile/android/app/src/main/res/"
