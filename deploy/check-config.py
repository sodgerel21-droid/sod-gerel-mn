"""Check the release pin and branded assets before publishing images."""
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
lock = dict(line.split("=", 1) for line in (root / "core.lock").read_text().splitlines())
assert re.fullmatch(r"[0-9a-f]{40}", lock["sha"])
version = lock["ref"].removeprefix("backend/")
assert f"github.com/gerege-systems/nexus-gerege-private/backend {version}" in (root / "go.mod").read_text()
assert f"ARG VERSION={version.removeprefix('v')}" in (root / "deploy/Dockerfile").read_text()
copy = json.loads((root / "brand/copy.json").read_text())
assert all(set(value) >= {"mn", "en"} for value in copy.values())
for path in (root / "brand").glob("*.svg"):
    ET.parse(path)
print("Core version, brand copy and SVG assets verified")
