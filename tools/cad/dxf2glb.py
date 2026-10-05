"""Typical-floor DXF (E-Property layer standard) -> building.glb + units.json.

usage: python dxf2glb.py plan.dxf --block B --floors 3-16 --height 3.0 --out out/

Each unit becomes a glTF node named by its unit ID (B-0304 = block B, floor 3, unit 04)
so a viewer can colour it by status and open its passport. units.json carries what
UnitGeometry needs: floor polygon, height, measured vs declared area and a flag when
they disagree by more than --tolerance percent (docs/improvements-and-3d.mn.md §2.3, §6).
"""
import argparse
import json
import struct
from pathlib import Path

import ezdxf
from ezdxf.math import Vec2, area, is_point_in_polygon_2d
from ezdxf.math.triangulation import mapbox_earcut_2d

SLAB = 0.25  # gap between stacked units so floors read as separate


def read_plan(path):
    """Unit outlines with their ID/declared-area labels, plus core outlines."""
    msp = ezdxf.readfile(path).modelspace()
    outlines = lambda layer: [
        [Vec2(p) for p in e.get_points("xy")] for e in msp.query(f'LWPOLYLINE[layer=="{layer}"]') if e.closed
    ]
    labels = lambda layer: [(Vec2(t.dxf.insert), t.dxf.text.strip()) for t in msp.query(f'TEXT[layer=="{layer}"]')]
    ids, areas = labels("EP-UNIT-ID"), labels("EP-UNIT-AREA")

    def inside(pts, found):
        # is_point_in_polygon_2d: 1 inside, 0 on edge, -1 outside
        return [text for at, text in found if is_point_in_polygon_2d(at, pts) >= 0]

    units, problems = [], []
    for pts in outlines("EP-UNIT"):
        names, declared = inside(pts, ids), inside(pts, areas)
        if len(names) != 1:
            problems.append(f"unit outline near {pts[0]} has {len(names)} EP-UNIT-ID labels, expected 1")
            continue
        units.append({"suffix": names[0], "outline": pts, "declared": float(declared[0]) if declared else None})
    return units, outlines("EP-CORE"), problems


def floor_range(text):
    lo, _, hi = text.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def prism(pts, z0, z1):
    """Vertices and triangle indices of an extruded outline; glTF is Y-up, plan Y becomes -Z."""
    pts = pts if area(pts) > 0 else pts[::-1]  # counter-clockwise
    n, verts, idx = len(pts), [], []
    for z in (z0, z1):
        verts += [(p.x, z, -p.y) for p in pts]
    key = {(p.x, p.y): i for i, p in enumerate(pts)}
    for tri in mapbox_earcut_2d(pts):
        a, b, c = (key[(p.x, p.y)] for p in tri)
        idx += [a, c, b, n + a, n + b, n + c]  # floor faces down, ceiling up
    for i in range(n):
        j = (i + 1) % n
        idx += [i, j, n + j, i, n + j, n + i]
    return verts, idx


def write_glb(path, meshes):
    """meshes: [(node name, verts, indices, extras)] -> one binary glTF, one mesh per node."""
    blob, views, accessors, gl_meshes, nodes = b"", [], [], [], []
    for name, verts, idx, extras in meshes:
        for data, fmt, target, comp, kind in (
            (verts, "3f", 34962, 5126, "VEC3"),
            (idx, "I", 34963, 5125, "SCALAR"),
        ):
            flat = [c for v in data for c in v] if kind == "VEC3" else data
            chunk = struct.pack(f"<{len(flat)}{fmt[-1]}", *flat)
            views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(chunk), "target": target})
            acc = {"bufferView": len(views) - 1, "componentType": comp, "count": len(data), "type": kind}
            if kind == "VEC3":
                acc["min"] = [min(v[k] for v in verts) for k in range(3)]
                acc["max"] = [max(v[k] for v in verts) for k in range(3)]
            accessors.append(acc)
            blob += chunk + b"\0" * (-len(chunk) % 4)
        gl_meshes.append({"primitives": [{"attributes": {"POSITION": len(accessors) - 2}, "indices": len(accessors) - 1}]})
        nodes.append({"name": name, "mesh": len(gl_meshes) - 1, "extras": extras})
    gltf = {
        "asset": {"version": "2.0", "generator": "e-property dxf2glb"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": gl_meshes,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(gltf, ensure_ascii=False).encode()
    js += b" " * (-len(js) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(blob), 0x004E4942) + blob
    Path(path).write_bytes(struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body)


def convert(dxf, block, floors, height, tolerance):
    plan, core, problems = read_plan(dxf)
    meshes, units = [], []
    for floor in floors:
        z0 = (floor - 1) * height
        for u in plan:
            uid = f"{block}-{floor:02d}{u['suffix']}"
            measured = round(float(abs(area(u["outline"]))), 2)
            diff = None if u["declared"] is None else round((u["declared"] - measured) / measured * 100, 2)
            units.append({
                "unit_id": uid,
                "floor": floor,
                "floor_polygon": [[round(p.x, 3), round(p.y, 3)] for p in u["outline"]],
                "height": height,
                "area_measured": measured,
                "area_declared": u["declared"],
                "area_diff_pct": diff,
                "area_flag": diff is not None and abs(diff) > tolerance,
            })
            meshes.append((uid, *prism(u["outline"], z0, z0 + height - SLAB), {"unit_id": uid, "floor": floor}))
        for i, pts in enumerate(core):
            meshes.append((f"core-{floor:02d}-{i}", *prism(pts, z0, z0 + height - SLAB), {"core": True, "floor": floor}))
    return meshes, units, problems


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dxf")
    ap.add_argument("--block", required=True)
    ap.add_argument("--floors", required=True, help="e.g. 3-16")
    ap.add_argument("--height", type=float, default=3.0, help="floor-to-floor, metres")
    # ponytail: one tolerance for every unit; the real figure belongs in the sales contract.
    ap.add_argument("--tolerance", type=float, default=2.0, help="area discrepancy flag, percent")
    ap.add_argument("--out", default="out")
    a = ap.parse_args()
    meshes, units, problems = convert(a.dxf, a.block, floor_range(a.floors), a.height, a.tolerance)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    write_glb(out / "building.glb", meshes)
    (out / "units.json").write_text(json.dumps(units, ensure_ascii=False, indent=1))
    flagged = sorted({u["unit_id"][-2:] for u in units if u["area_flag"]})
    print(f"{len(units)} units on {len(set(u['floor'] for u in units))} floors -> {out}/building.glb, units.json")
    for p in problems:
        print("PROBLEM:", p)
    if flagged:
        print(f"area outside ±{a.tolerance}% on unit(s) {', '.join(flagged)} (every floor)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
