/* Inferred room split for units that have no structured plan yet.
 *
 * Ported unchanged from the original passport.js: the unit outline is real (units.json
 * floor_polygon from plan.dxf), the walls, doors, windows and rooms inside it are generated from
 * the outline and the room count. The result is converted to apartment-plan schema v1 with
 * status.verification = "inferred" so every view labels it as a demonstration, never as the
 * architect's plan. A structured plan (plans/index.json) always takes precedence.
 */
import { SCHEMA, VERSION } from "./plan-geometry.js";

const EXT = 0.3, INT = 0.15;
const r1 = (v) => Math.round(v * 10) / 10;
const area = (r) => (r[2] - r[0]) * (r[3] - r[1]);
const fmt = (v, d = 2) => v.toFixed(d);

/* ===== 1. Geometry from the outline ===== */

/** Axis-aligned polygon → main rectangle + optional wing (L-shapes), local coords from 0. */
function decompose(poly) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const ox = Math.min(...xs), oy = Math.min(...ys);
  const P = poly.map(([x, y]) => [x - ox, y - oy]); // full precision; only display rounds
  const W = Math.max(...P.map((p) => p[0])), H = Math.max(...P.map((p) => p[1]));
  if (P.length === 4) return { P, W, H, main: [0, 0, W, H], wing: null };
  // Inside test for an axis-aligned polygon (ray cast).
  const inside = (x, y) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, yi] = P[i], [xj, yj] = P[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  // Candidate cuts along every vertex line; keep the split whose two parts are both rectangles, main largest.
  let best = null;
  const full = (r) => [[.25, .25], [.75, .25], [.25, .75], [.75, .75], [.5, .5]]
    .every(([a, b]) => inside(r[0] + (r[2] - r[0]) * a, r[1] + (r[3] - r[1]) * b));
  for (const x of new Set(P.map((p) => p[0]))) for (const y of new Set(P.map((p) => p[1]))) {
    for (const [m, w] of [[[0, 0, W, y], [0, y, W, H]], [[0, y, W, H], [0, 0, W, y]], [[0, 0, x, H], [x, 0, W, H]], [[x, 0, W, H], [0, 0, x, H]]]) {
      if (area(m) <= 0 || area(w) <= 0) continue;
      // The wing is the part of `w` inside the polygon: shrink it to its filled sub-rectangle.
      const wing = [[w[0], w[1], x, w[3]], [x, w[1], w[2], w[3]], [w[0], w[1], w[2], y], [w[0], y, w[2], w[3]], w]
        .filter((r) => area(r) > 0 && r[0] >= w[0] && r[2] <= w[2] && r[1] >= w[1] && r[3] <= w[3] && full(r));
      if (!full(m)) continue;
      for (const g of wing) {
        if (Math.abs(area(m) + area(g) - areaPoly(P)) > 0.01) continue;
        if (!best || area(m) > area(best.main)) best = { main: m, wing: g };
      }
    }
  }
  return { P, W, H, ...(best ?? { main: [0, 0, W, H], wing: null }) };
}
function areaPoly(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) { const [a, b] = P[i], [c, d] = P[(i + 1) % P.length]; s += a * d - b * c; }
  return Math.abs(s) / 2;
}

/** The whole unit: walls (with openings), rooms, axes — all in metres, plan y down. */
function buildGeometry(u) {
  const { P, W, H, main, wing } = decompose(u.floor_polygon);
  const extEdges = P.map((a, i) => {
    const b = P[(i + 1) % P.length];
    return { a: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], b: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
  });
  const onExt = (h, c, s, e) => extEdges.filter((g) => (h ? g.a[1] === g.b[1] && g.a[1] === c : g.a[0] === g.b[0] && g.a[0] === c))
    .map((g) => [Math.max(s, h ? g.a[0] : g.a[1]), Math.min(e, h ? g.b[0] : g.b[1])]).filter(([p, q]) => q - p > 1e-6);

  // Canonical frame for the main rectangle: u along its long side, v from back (0) to front (Sm).
  const [X0, Y0, X1, Y1] = main;
  const swap = Y1 - Y0 > X1 - X0;
  const Lm = swap ? Y1 - Y0 : X1 - X0, Sm = swap ? X1 - X0 : Y1 - Y0;
  // Front (living, entrance) faces the wing when the wing lies along a long side, else the lower/right side.
  let flipV = false;
  if (wing) flipV = swap ? wing[2] <= X0 + 1e-6 : wing[3] <= Y0 + 1e-6;
  const T = (uu, vv) => {
    const v2 = flipV ? Sm - vv : vv;
    return swap ? [X0 + v2, Y0 + uu] : [X0 + uu, Y0 + v2];
  };
  const TR = (r) => { const a = T(r[0], r[1]), b = T(r[2], r[3]); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; };

  const bedrooms = Math.max(0, u.rooms - 1);
  const wingBed = wing && bedrooms > 0;
  const n = Math.max(0, bedrooms - (wingBed ? 1 : 0));
  const bathW = Math.min(2.6, Math.max(1.8, r1(Lm * 0.22)));

  // Rooms keep their canonical rectangle (`cr`) so furniture can be placed against the walls the
  // layout knows are free; `c` is the same rectangle in plan coordinates.
  const rooms = [];
  const room = (name, kind, cr, floor, hint = {}) => rooms.push({ name, kind, cr, c: cr && TR(cr), floor, ...hint });
  const walls = [];
  const wallC = (a, b, doors = []) => {
    const A = T(...a), B = T(...b);
    const w = { a: [Math.min(A[0], B[0]), Math.min(A[1], B[1])], b: [Math.max(A[0], B[0]), Math.max(A[1], B[1])], t: INT, op: [] };
    const h = w.a[1] === w.b[1];
    for (const d of doors) {
      const p = T(...d.p), q = T(...d.q), s = h ? Math.min(p[0], q[0]) - w.a[0] : Math.min(p[1], q[1]) - w.a[1];
      w.op.push({ k: "door", f: s, to: s + (h ? Math.abs(q[0] - p[0]) : Math.abs(q[1] - p[1])), into: T(...d.into) });
    }
    walls.push(w);
  };
  const vDoor = (u, v, intoU) => ({ p: [u, v - 0.43], q: [u, v + 0.43], into: [intoU, v] });
  const livingName = n > 0 ? "Зочны өрөө, гал тогоо" : "Зочны өрөө, гал тогоо, унтлагын хэсэг";

  // Shallow units, or a back row that would make bedrooms corridor-long, become columns running
  // the full depth: [bedroom] wet (bath over hall) living [bedroom]. Otherwise bedrooms take the
  // back row and the living room the front, with the wet column at one end.
  const rowBedW = n > 0 ? (Lm - bathW) / n : 0;
  if (n <= 2 && (Sm < 6.5 || rowBedW > 5.5)) {
    const Sbath = r1(Math.min(2.4, Sm * 0.5));
    const bw = n ? Math.min(4.2, Math.max(2.8, r1((Lm - bathW - 3.6) / n))) : 0;
    let u = 0;
    if (n === 2) { room("Унтлагын өрөө", "bed", [0, 0, bw, Sm], "wood", { head: "u0" }); u = bw; }
    const w0 = u, w1 = u + bathW, l1 = Lm - (n ? bw : 0);
    room("Ариун цэврийн өрөө", "bath", [w0, 0, w1, Sbath], "tile");
    room("Үүдний өрөө", "hall", [w0, Sbath, w1, Sm], "tile", { wardrobe: n === 2 ? null : "u0" });
    room(livingName, "living", [w1, 0, l1, Sm], "wood", { kitchen: "v0" });
    if (n) room("Унтлагын өрөө", "bed", [l1, 0, Lm, Sm], "wood", { head: "u1" });
    const hm = (Sbath + Sm) / 2;
    wallC([w0, Sbath], [w1, Sbath], [{ p: [(w0 + w1) / 2 - 0.35, Sbath], q: [(w0 + w1) / 2 + 0.35, Sbath], into: [(w0 + w1) / 2, Sbath / 2] }]);
    if (n === 2) wallC([w0, 0], [w0, Sm], [vDoor(w0, hm, w0 / 2)]);
    wallC([w1, 0], [w1, Sm], [vDoor(w1, hm, (w1 + l1) / 2)]);
    if (n) wallC([l1, 0], [l1, Sm], [vDoor(l1, Sm - 1.0, (l1 + Lm) / 2)]);
  } else {
    const Sb = n > 0 ? r1(Sm * 0.5) : r1(Math.min(2.4, Sm * 0.45));
    room("Ариун цэврийн өрөө", "bath", [0, 0, bathW, Sb], "tile");
    for (let k = 0; k < n; k++) room("Унтлагын өрөө", "bed", [bathW + k * rowBedW, 0, bathW + (k + 1) * rowBedW, Sb], "wood", { head: "u1" });
    room("Үүдний өрөө", "hall", [0, Sb, bathW, Sm], "tile", { wardrobe: "u0" });
    room(livingName, "living", [bathW, n > 0 ? Sb : 0, Lm, Sm], "wood", { kitchen: "u1" });
    const bathDoor = { p: [bathW / 2 - 0.35, Sb], q: [bathW / 2 + 0.35, Sb], into: [bathW / 2, Sb / 2] };
    const bedDoors = [...Array(n)].map((_, k) => {
      const us = bathW + k * rowBedW, d0 = Math.min(us + 0.45, us + rowBedW - 1.3);
      return { p: [d0, Sb], q: [d0 + 0.85, Sb], into: [us + rowBedW / 2, Sb / 2] };
    });
    wallC([0, Sb], [n > 0 ? Lm : bathW, Sb], [bathDoor, ...bedDoors]);
    wallC([bathW, 0], [bathW, Sm], [vDoor(bathW, (Sb + Sm) / 2, bathW + 1)]);
    for (let k = 1; k < n; k++) wallC([bathW + k * rowBedW, 0], [bathW + k * rowBedW, Sb]);
  }
  if (wing) room(wingBed ? "Унтлагын өрөө" : "Агуулах", wingBed ? "bed" : "store", null, wingBed ? "wood" : "tile", { wing: true });
  const wingRoom = rooms.find((r) => r.wing);
  if (wingRoom) wingRoom.c = wing;

  // Wing: separating wall on the shared edge, door from a neighbouring non-bath room.
  if (wing) {
    const h = wing[1] === main[3] || wing[3] === main[1];
    const c = h ? (wing[1] === main[3] ? wing[1] : wing[3]) : (wing[0] === main[2] ? wing[0] : wing[2]);
    const s = h ? Math.max(wing[0], main[0]) : Math.max(wing[1], main[1]), e = h ? Math.min(wing[2], main[2]) : Math.min(wing[3], main[3]);
    const w = { a: h ? [s, c] : [c, s], b: h ? [e, c] : [c, e], t: INT, op: [] };
    const nb = rooms.filter((r) => r.kind !== "bath" && !r.wing)
      .map((r) => ({ r, o: [Math.max(s, h ? r.c[0] : r.c[1]), Math.min(e, h ? r.c[2] : r.c[3])] }))
      .filter((x) => x.o[1] - x.o[0] >= 1.2 && (h ? r_on(x.r.c, 1, c) : r_on(x.r.c, 0, c)))
      .sort((a, b) => (a.r.kind === "living" ? -1 : 1) - (b.r.kind === "living" ? -1 : 1));
    if (nb[0]) {
      const m = (nb[0].o[0] + nb[0].o[1]) / 2;
      w.op.push({ k: "door", f: m - 0.42 - s, to: m + 0.43 - s, into: [(wing[0] + wing[2]) / 2, (wing[1] + wing[3]) / 2] });
    }
    walls.push(w);
  }
  function r_on(c, axis, v) { return axis === 1 ? c[1] === v || c[3] === v : c[0] === v || c[2] === v; }

  // Exterior walls = outline edges; windows where a habitable room meets them, the entrance in the hall.
  const ext = extEdges.map((g) => ({ a: g.a, b: g.b, t: EXT, op: [] }));
  const addOp = (h, c, s, e, op) => {
    const w = ext.find((x) => (h ? x.a[1] === x.b[1] && x.a[1] === c : x.a[0] === x.b[0] && x.a[0] === c) &&
      (h ? x.a[0] <= s && x.b[0] >= e : x.a[1] <= s && x.b[1] >= e));
    if (w) w.op.push({ ...op, f: s - (h ? w.a[0] : w.a[1]), to: e - (h ? w.a[0] : w.a[1]) });
  };
  const sides = (c) => [[true, c[1], c[0], c[2]], [true, c[3], c[0], c[2]], [false, c[0], c[1], c[3]], [false, c[2], c[1], c[3]]];
  const hall = rooms.find((r) => r.kind === "hall");
  const entry = sides(hall.c).flatMap(([h, cc, s, e]) => onExt(h, cc, s, e).map((o) => ({ h, cc, o })))
    .sort((a, b) => (b.o[1] - b.o[0]) - (a.o[1] - a.o[0]))[0];
  if (entry) {
    const m = (entry.o[0] + entry.o[1]) / 2;
    addOp(entry.h, entry.cc, m - 0.45, m + 0.45, { k: "door", main: true, into: [(hall.c[0] + hall.c[2]) / 2, (hall.c[1] + hall.c[3]) / 2] });
  }
  for (const r of rooms) {
    if (r.kind === "bath" || r.kind === "hall" || r.kind === "store") continue;
    for (const [h, cc, s, e] of sides(r.c)) for (const [p, q] of onExt(h, cc, s, e)) {
      if (entry && entry.h === h && entry.cc === cc && p < entry.o[1] && q > entry.o[0]) continue;
      const len = q - p - 1.2;
      if (len < 1.2) continue;
      const wdt = Math.min(2.0, len), two = r.kind === "living" && len >= 5.5;
      for (const m of two ? [p + (q - p) * 0.3, p + (q - p) * 0.7] : [(p + q) / 2]) addOp(h, cc, m - wdt / 2, m + wdt / 2, { k: "win" });
    }
  }

  // Inner (finished) room rectangles: half a wall in from each side.
  const isExt = (h, cc, s, e) => onExt(h, cc, s, e).some(([p, q]) => q - p > 0.5);
  rooms.forEach((r, i) => {
    const [x0, y0, x1, y1] = r.c;
    const ins = (h, cc, s, e) => (isExt(h, cc, s, e) ? EXT : INT) / 2;
    r.r = [x0 + ins(false, x0, y0, y1), y0 + ins(true, y0, x0, x1), x1 - ins(false, x1, y0, y1), y1 - ins(true, y1, x0, x1)];
    r.no = String(i + 1).padStart(2, "0");
  });

  const axisVals = (pick) => [...new Set([...ext, ...walls].filter(pick).map((w) => (pick === isV ? w.a[0] : w.a[1])))].sort((a, b) => a - b);
  const isV = (w) => w.a[0] === w.b[0], isH = (w) => w.a[1] === w.b[1];
  const AX = "АБВГДЕЖЗИК";
  return {
    unit: u.unit_id, W, H, main, wing, canon: { TR },
    walls: [...ext, ...walls], rooms,
    axes: { x: axisVals(isV).map((v, i) => [String(i + 1), v]), y: axisVals(isH).map((v, i) => [AX[i] ?? String(i + 1), v]) },
  };
}

/* Wall pieces along the wall: solid / win / door, distances from a. */
function wallParts(w) {
  const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), e = w.t / 2;
  const ops = [...w.op].sort((p, q) => p.f - q.f), out = [];
  let cur = -e;
  for (const o of ops) { if (o.f > cur) out.push({ k: "solid", s: cur, e: o.f }); out.push({ k: o.k, s: o.f, e: o.to, o }); cur = o.to; }
  if (cur < L + e) out.push({ k: "solid", s: cur, e: L + e });
  return out;
}
const horiz = (w) => w.a[1] === w.b[1];
const at = (w, d) => (horiz(w) ? [w.a[0] + d, w.a[1]] : [w.a[0], w.a[1] + d]);
/** Door leaf direction: towards the room it opens into. */
const swing = (w, o) => Math.sign(horiz(w) ? o.into[1] - w.a[1] : o.into[0] - w.a[0]) || 1;

const KIND = { bed: "bedroom", bath: "bathroom", hall: "hall", living: "living", store: "storage" };

/** units.json row → apartment-plan schema v1 (status "inferred"). */
export function inferPlan(u, project) {
  const G = buildGeometry(u);
  const xs = u.floor_polygon.map((p) => p[0]), ys = u.floor_polygon.map((p) => p[1]);
  const ox = Math.min(...xs), oy = Math.min(...ys), P = (q) => [q[0] + ox, q[1] + oy];
  const walls = [], openings = [];
  G.walls.forEach((w, i) => {
    const id = `W${i + 1}`, a = P(w.a), b = P(w.b), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
    walls.push({ id, kind: w.t === EXT ? "exterior" : "interior", a, b, thickness: w.t, height: 2.7 });
    w.op.forEach((o, k) => {
      const base = { id: `${id}-${o.k}${k + 1}`, wall: id, offset: o.f, width: o.to - o.f };
      if (o.k === "win") { openings.push({ ...base, type: "window", sill: 0.9, height: 1.2 }); return; }
      const into = P(o.into), mid = [a[0] + (b[0] - a[0]) * ((o.f + o.to) / 2) / L, a[1] + (b[1] - a[1]) * ((o.f + o.to) / 2) / L];
      const side = (into[0] - mid[0]) * n[0] + (into[1] - mid[1]) * n[1] >= 0 ? "left" : "right";
      openings.push({ ...base, type: o.main ? "entrance" : "door", sill: 0, height: 2.1, swing: { side, hinge: "start" } });
    });
  });
  const rooms = G.rooms.map((r, i) => {
    const [x0, y0, x1, y1] = r.r;
    return { id: `R${i + 1}`, type: KIND[r.kind] ?? "other", name: r.name, floor_finish: r.floor, polygon: [P([x0, y0]), P([x1, y0]), P([x1, y1]), P([x0, y1])] };
  });
  return {
    schema: SCHEMA, version: VERSION,
    id: `${project?.slug ?? "unit"}/inferred/${u.unit_id}`, revision: "inferred-v1",
    title: `${u.rooms} өрөө, таамагласан хуваалт`, units: "m",
    coordinates: { frame: "building plan of plan.dxf", x: "DXF X, metres", y: "DXF Y, metres", rooms: "finished wall faces", walls: "centrelines; exterior walls on the outline" },
    north_deg: null, ceiling_height: 2.7,
    status: { verification: "inferred", note: "Нэгжийн гадна хил plan.dxf-ээс; дотор хана, хаалга, цонх, өрөөг өрөөний тооноос автоматаар таамагласан. Бодит зураг биш." },
    source: { file: "plan.dxf (outline only)", revision: project?.updated ?? null, authoring: "landing/units/lib/legacy-layout.js" },
    area: {
      declared: u.area_declared ?? null,
      declared_definition: "Төсөл хэрэгжүүлэгчийн зарласан талбай (units.json area_declared). Үнэ үүгээр тооцогдоно.",
      boundary_definition: "plan.dxf дахь нэгжийн гадна хилийн полигоноос тооцсон.",
      internal_definition: "Таамагласан өрөөнүүдийн хананы дотор нүүрээр тооцсон нийлбэр — зөвхөн жишээ.",
      sales_area: "declared",
    },
    boundary: u.floor_polygon.map((p) => [p[0], p[1]]),
    walls, openings, rooms, fixed_zones: [],
  };
}

export { buildGeometry, decompose, area };
