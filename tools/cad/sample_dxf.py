"""Write a sample typical-floor plan that follows the E-Property layer standard (README.mn.md).

usage: python sample_dxf.py out/sample-floor.dxf
Not a real project: one L-shaped unit exercises concave outlines, and unit 06 declares an
area that disagrees with its outline on purpose so the discrepancy check has something to flag.
"""
import sys
import ezdxf

# (suffix, outline in metres, declared area м²)
UNITS = [
    ("01", [(0, 10), (12, 10), (12, 18), (0, 18)], 96.0),
    ("02", [(12, 10), (22, 10), (22, 18), (12, 18)], 80.0),
    ("03", [(26, 10), (36, 10), (36, 18), (26, 18)], 80.0),
    ("04", [(0, 0), (10, 0), (10, 8), (0, 8)], 80.0),
    ("05", [(10, 0), (22, 0), (22, 8), (16, 8), (16, 5), (10, 5)], 78.0),  # L-shaped
    ("06", [(26, 0), (36, 0), (36, 8), (26, 8)], 84.5),  # declared 84.5, drawn 80
]
CORE = [[(22, 0), (26, 0), (26, 18), (22, 18)], [(0, 8), (22, 8), (22, 10), (0, 10)], [(26, 8), (36, 8), (36, 10), (26, 10)]]


def centroid(pts):
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def write_plan(path, units, core):
    """units: (suffix, outline, declared м², label point or None for the vertex average)."""
    doc = ezdxf.new(units=ezdxf.units.M)
    for name, color in [("EP-UNIT", 5), ("EP-UNIT-ID", 1), ("EP-UNIT-AREA", 3), ("EP-CORE", 8)]:
        doc.layers.add(name, color=color)
    msp = doc.modelspace()
    for suffix, pts, declared, at in units:
        msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "EP-UNIT"})
        x, y = at or centroid(pts)
        msp.add_text(suffix, height=0.6, dxfattribs={"layer": "EP-UNIT-ID"}).set_placement((x, y + 0.5))
        msp.add_text(f"{declared}", height=0.4, dxfattribs={"layer": "EP-UNIT-AREA"}).set_placement((x, y - 0.5))
    for pts in core:
        msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "EP-CORE"})
    doc.saveas(path)


def main(path):
    # The L-shape's vertex average falls outside it, so its label goes at a point known to be inside.
    write_plan(path, [(sfx, pts, a, (13, 2.5) if sfx == "05" else None) for sfx, pts, a in UNITS], CORE)
    print(f"wrote {path}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out/sample-floor.dxf")
