#!/bin/bash
# Gallery images for each project, drawn by the 3D viewer itself: the orbit renders and the
# 360° panoramas listed in landing/3d/data/projects.json (written by demo_projects.py).
# usage: bash tools/cad/renders.sh [slug]     needs Google Chrome and cwebp (brew install webp)
set -euo pipefail
cd "$(dirname "$0")/../../landing"
C=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
PORT=8767
python3 -m http.server $PORT >/dev/null 2>&1 & server=$!
tmp=$(mktemp -d); trap 'kill $server; rm -rf "$tmp"' EXIT
sleep 1
ONLY=${1:-} python3 - <<'PY' > "$tmp/list"
import json, os
for p in json.load(open("3d/data/projects.json")):
    if os.environ["ONLY"] not in ("", p["slug"]):
        continue
    for r in p.get("renders", []):
        print(p["slug"], f"view={r['view']}", "1600,1000", r["file"])
    for r in p.get("panoramas", []):
        unit = f"&unit={r['unit']}" if "unit" in r else ""
        print(p["slug"], f"pano={r['stop']}{unit}", "2048,1024", r["file"])
PY
while read -r slug query size file; do
  out="3d/data/$slug/$file"; mkdir -p "$(dirname "$out")"
  # swiftshader: headless Chrome has no GPU; the budget covers model, satellite tiles and shadows
  "$C" --headless=new --hide-scrollbars --enable-unsafe-swiftshader --use-angle=swiftshader \
    --virtual-time-budget=30000 --window-size="$size" --screenshot="$tmp/shot.png" \
    "http://localhost:$PORT/3d/?project=$slug&$query&shot=1" >/dev/null 2>&1
  cwebp -quiet -q 82 "$tmp/shot.png" -o "$out"
  echo "$out"
done < "$tmp/list"
