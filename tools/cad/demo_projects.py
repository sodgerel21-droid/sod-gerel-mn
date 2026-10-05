"""Build three demo projects end to end: DXF plan -> GLB + units.json with sales data -> projects.json.

usage: python demo_projects.py [out]   (default: landing/3d/data, served at e-property.mn/3d/)

Everything here is invented for demonstration and is labelled "Жишээ" in the viewer. Price levels
follow the February 2026 new-apartment averages per м² (Global Property Guide): Khan-Uul 4.64M ₮,
Sukhbaatar 6.25M ₮, Ulaanbaatar 4.76M ₮ (used for Bayanzurkh, which had no published figure).
"""
import json
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

import dxf2glb
from sample_dxf import CORE as SLAB_CORE, UNITS as SLAB_UNITS, write_plan


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def area_of(pts):
    return round(abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))) / 2, 1)


def tower_units():
    """26 m square tower, 10 m core: two L-shaped units wrap the north corners, the south side
    splits into two family flats and two studios."""
    quads = {
        "01": (rect(18, 0, 26, 13), None),
        "02": ([(18, 13), (26, 13), (26, 26), (13, 26), (13, 18), (18, 18)], (22, 22)),
        "03": ([(0, 13), (8, 13), (8, 18), (13, 18), (13, 26), (0, 26)], (4, 22)),
        "04": (rect(0, 0, 8, 13), None),
        "05": (rect(8, 0, 13, 8), None),
        "06": (rect(13, 0, 18, 8), None),
    }
    return [(sfx, pts, area_of(pts), at) for sfx, (pts, at) in quads.items()], [rect(8, 8, 18, 18)]


def l_block_units():
    """L-shaped mid-rise: an east-west wing and a north-south wing joined at a stair core."""
    plan = {
        "01": rect(7, 0, 17, 7), "02": rect(17, 0, 28, 7), "03": rect(28, 0, 40, 7),
        "04": rect(0, 9, 7, 16), "05": rect(9, 9, 20, 16), "06": rect(20, 9, 30, 16), "07": rect(30, 9, 40, 16),
        "08": rect(0, 16, 7, 28), "09": rect(0, 28, 7, 40), "10": rect(9, 16, 16, 27), "11": rect(9, 27, 16, 40),
    }
    core = [rect(0, 0, 7, 7), rect(0, 7, 40, 9), rect(7, 9, 9, 40)]
    return [(sfx, pts, area_of(pts), None) for sfx, pts in plan.items()], core


# lat/lon: illustrative demo sites for the satellite ground in the 3D viewer, not real plots
PROJECTS = [
    {
        "slug": "tuul-river", "lat": 47.8935, "lon": 106.915, "name": "Туулын Эрэг", "block": "B", "district": "Хан-Уул дүүрэг, 11-р хороо",
        "developer": "Жишээ Девелопмент ХХК", "floors": "3-16", "height": 3.0, "base_price": 4_640_000,
        "progress": 62, "completion": "2027 оны III улирал", "seed": 11,
        # the slab plan keeps unit 06's deliberate area discrepancy, so one project shows the flag
        "plan": lambda: ([(s, p, a, (13, 2.5) if s == "05" else None) for s, p, a in SLAB_UNITS], SLAB_CORE),
    },
    {
        "slug": "central-tower", "lat": 47.91888, "lon": 106.91756, "name": "Төв Цамхаг", "block": "A", "district": "Сүхбаатар дүүрэг, 1-р хороо",
        "developer": "Жишээ Барилга ХХК", "floors": "3-22", "height": 3.3, "base_price": 6_250_000,
        "progress": 35, "completion": "2028 оны II улирал", "seed": 22, "plan": tower_units,
    },
    {
        "slug": "morning-light", "lat": 47.9095, "lon": 106.989, "name": "Өглөөний Гэгээ", "block": "C", "district": "Баянзүрх дүүрэг, 26-р хороо",
        "developer": "Жишээ Хотхон ХХК", "floors": "2-9", "height": 3.0, "base_price": 4_760_000,
        "progress": 88, "completion": "2026 оны IV улирал", "seed": 33, "plan": l_block_units,
    },
]
# Gallery images, made from the 3D viewer by renders.sh (view = orbit preset, stop = 360° tour stop).
RENDERS = [("aerial", "Агаараас"), ("close", "Ойроос"), ("top", "Дээрээс"), ("night", "Оройн гэрэлтэй")]
PANORAMAS = [("street", "Орцны өмнөөс"), ("yard", "Хашаанаас"), ("roof", "Дээврээс")]
NOW = datetime(2026, 9, 30, 14, 0)  # the demo's "today", Ulaanbaatar time


def rooms(area):
    return 1 if area < 55 else 2 if area < 75 else 3 if area < 110 else 4


def sales(unit, project, rng):
    """Status, price and hold expiry for one unit. Higher floors cost more; the finished-sooner project sold more."""
    price_m2 = project["base_price"] * (1 + 0.006 * (unit["floor"] - 3))
    area = unit["area_declared"] or unit["area_measured"]
    sold_share = project["progress"] / 100 * 0.6
    roll = rng.random()
    status = "sold" if roll < sold_share else "reserved" if roll < sold_share + 0.12 else "available"
    hold = NOW + timedelta(hours=rng.randrange(6, 72)) if status == "reserved" else None
    return {
        "rooms": rooms(area),
        "price": round(area * price_m2, -5),
        "price_per_m2": round(price_m2, -4),
        "status": status,
        "hold_until": hold.strftime("%Y-%m-%dT%H:%M+08:00") if hold else None,
    }


def window_pano(rows):
    """The 360° view from a middle-floor unit's window."""
    floors = sorted({u["floor"] for u in rows})
    u = next(u for u in rows if u["floor"] == floors[len(floors) // 2])
    return {"file": "pano/window.webp", "title": f"{u['floor']}-р давхрын цонхноос ({u['unit_id']})", "stop": "window", "unit": u["unit_id"]}


def build(out):
    out = Path(out)
    index = []
    for p in PROJECTS:
        folder = out / p["slug"]
        folder.mkdir(parents=True, exist_ok=True)
        units, core = p["plan"]()
        write_plan(folder / "plan.dxf", units, core)
        meshes, rows, problems = dxf2glb.convert(folder / "plan.dxf", p["block"], dxf2glb.floor_range(p["floors"]), p["height"], 2.0)
        assert not problems, (p["slug"], problems)
        rng = random.Random(p["seed"])
        rows = [{**u, **sales(u, p, rng)} for u in rows]
        dxf2glb.write_glb(folder / "building.glb", meshes)
        (folder / "units.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))
        count = lambda s: sum(u["status"] == s for u in rows)
        meta = {k: v for k, v in p.items() if k not in ("plan", "seed", "base_price")}
        index.append({
            **meta,
            "units": len(rows),
            "available": count("available"), "reserved": count("reserved"), "sold": count("sold"),
            "price_from": min(u["price"] for u in rows), "price_to": max(u["price"] for u in rows),
            "updated": NOW.strftime("%Y-%m-%d"),
            "renders": [{"file": f"renders/{v}.webp", "title": t, "view": v} for v, t in RENDERS],
            "panoramas": [{"file": f"pano/{v}.webp", "title": t, "stop": v} for v, t in PANORAMAS] + [window_pano(rows)],
        })
        print(f"{p['name']}: {len(rows)} units, {count('available')} available -> {folder}")
    (out / "projects.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
    return index


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parents[2] / "landing/3d/data")
