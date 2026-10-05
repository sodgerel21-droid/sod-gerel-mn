/* Architectural shell pieces from a plan — consumed by both the 2D plan (plan2d.js) and the 3D
 * viewer (viewer3d.js), so the two can never disagree about where a wall or an opening is.
 *
 * Each wall is split along its length into solid stretches and openings. Openings keep the
 * plan's exact offsets; a wall end is extended by half its thickness only where it meets another
 * wall's centreline, which closes corners and T-junctions without moving any opening.
 */
import { wallFrame, wallSegments, wallQuad, segmentDistance, openingEndpoints, doorSwing } from "./plan-geometry.js";

const JOIN = 0.01;

function endExtensions(plan, w) {
  const meets = (p) => plan.walls.some((o) => o.id !== w.id && segmentDistance(p, o.a, o.b).d < JOIN);
  return { start: meets(w.a) ? w.thickness / 2 : 0, end: meets(w.b) ? w.thickness / 2 : 0 };
}

/**
 * pieces: horizontal stretches of wall body with their height band [z0, z1]
 *   { wall, kind: "solid" | "sill" | "lintel", s, e, z0, z1, quad }
 * openings: { opening, wall, s, e, z0, z1, a, b, angle, swing? }
 */
export function shellPieces(plan) {
  const pieces = [], openings = [];
  for (const w of plan.walls) {
    const { L, angle } = wallFrame(w), ext = endExtensions(plan, w), H = w.height;
    for (const seg of wallSegments(w, plan.openings)) {
      const xs = seg.s <= 1e-9 ? ext.start : 0, xe = seg.e >= L - 1e-9 ? ext.end : 0;
      const quad = wallQuad(w, seg.s, seg.e, xs, xe);
      if (seg.kind === "solid") { pieces.push({ wall: w.id, kind: "solid", s: seg.s, e: seg.e, z0: 0, z1: H, quad }); continue; }
      const o = seg.opening, sill = o.sill ?? 0, top = Math.min(H, sill + o.height);
      if (sill > 1e-9) pieces.push({ wall: w.id, kind: "sill", s: seg.s, e: seg.e, z0: 0, z1: sill, quad });
      if (top < H - 1e-9) pieces.push({ wall: w.id, kind: "lintel", s: seg.s, e: seg.e, z0: top, z1: H, quad });
      const [a, b] = openingEndpoints(w, o);
      openings.push({ opening: o, wall: w, s: seg.s, e: seg.e, z0: sill, z1: top, a, b, angle, quad, ...(o.type === "door" || o.type === "entrance" ? { swing: doorSwing(w, o) } : {}) });
    }
  }
  return { pieces, openings };
}
