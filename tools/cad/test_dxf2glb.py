"""Self-check: python test_dxf2glb.py (needs ezdxf). Builds the sample plan and checks the output."""
import json
import struct
import tempfile
from pathlib import Path

import dxf2glb
import sample_dxf

with tempfile.TemporaryDirectory() as tmp:
    plan = Path(tmp, "plan.dxf")
    sample_dxf.main(plan)
    meshes, units, problems = dxf2glb.convert(plan, "B", dxf2glb.floor_range("3-5"), 3.0, 2.0)
    assert not problems, problems
    by_id = {u["unit_id"]: u for u in units}
    assert len(units) == 18 and set(by_id) >= {"B-0301", "B-0506"}
    assert by_id["B-0405"]["area_measured"] == 78.0, "L-shaped unit area"
    assert [u for u in units if u["area_flag"]] == [by_id[f"B-0{f}06"] for f in (3, 4, 5)]
    assert by_id["B-0306"]["area_diff_pct"] == 5.62
    glb = Path(tmp, "b.glb")
    dxf2glb.write_glb(glb, meshes)
    magic, version, length = struct.unpack("<III", glb.read_bytes()[:12])
    assert (magic, version, length) == (0x46546C67, 2, glb.stat().st_size)
    js_len = struct.unpack("<I", glb.read_bytes()[12:16])[0]
    gltf = json.loads(glb.read_bytes()[20 : 20 + js_len])
    assert [n["name"] for n in gltf["nodes"]][:6] == [f"B-03{i:02d}" for i in range(1, 7)]
    # every triangle of a prism uses only that prism's vertices
    for m in meshes:
        assert max(m[2]) < len(m[1]) and len(m[2]) % 3 == 0
import demo_projects

with tempfile.TemporaryDirectory() as tmp:
    index = demo_projects.build(tmp)
    assert [p["slug"] for p in index] == ["tuul-river", "central-tower", "morning-light"]
    for p in index:
        rows = json.loads(Path(tmp, p["slug"], "units.json").read_text())
        assert p["available"] + p["reserved"] + p["sold"] == p["units"] == len(rows)
        assert all((u["status"] == "reserved") == bool(u["hold_until"]) for u in rows)
        assert all(u["price"] % 100_000 == 0 and u["price"] > 0 for u in rows)
    tuul = json.loads(Path(tmp, "tuul-river", "units.json").read_text())
    assert sum(u["area_flag"] for u in tuul) == 14  # unit 06 on each of floors 3-16
print("dxf2glb self-check passed")
