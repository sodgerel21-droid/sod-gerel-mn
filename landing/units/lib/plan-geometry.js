/* Apartment plan schema v1 — the one geometry every view uses (docs/apartment-plan.mn.md).
 *
 * Pure functions, no DOM and no three.js, so the browser viewer, the importer and the Node
 * checks share them. Coordinates are metres in the building plan frame (x = DXF X, y = DXF Y,
 * counter-clockwise positive). Nothing here rounds a coordinate; only display code rounds.
 */

export const SCHEMA = "e-property.apartment-plan";
export const VERSION = 1;
export const ROOM_TYPES = ["living", "kitchen", "bedroom", "bathroom", "wc", "hall", "storage", "balcony", "other"];
export const OPENING_TYPES = ["door", "entrance", "window", "opening"];
export const WALL_KINDS = ["exterior", "party", "corridor", "interior"];
export const VERIFICATION = {
  verified: "Архитекторын баталгаажсан зураг",
  "imported-unverified": "CAD-аас импортолсон, шалгагдаагүй",
  demonstration: "Жишээ төлөвлөлт, архитекторын баталгаагүй",
  inferred: "Гадна хил, өрөөний тооноос таамагласан хуваалт",
};
const EPS = 1e-6;

/* ───────── vectors and polygons ───────── */
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => len(sub(a, b));

/** Signed shoelace area (positive when counter-clockwise). */
export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
export const polygonArea = (poly) => Math.abs(signedArea(poly));
export function centroid(poly) {
  const A = signedArea(poly);
  if (Math.abs(A) < EPS) return poly.reduce((s, p) => add(s, mul(p, 1 / poly.length)), [0, 0]);
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], f = a[0] * b[1] - b[0] * a[1]; cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f; }
  return [cx / (6 * A), cy / (6 * A)];
}
export function bounds(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
/** Closest distance from p to segment ab, and the parameter t along it. */
export function segmentDistance(p, a, b) {
  const ab = sub(b, a), L2 = dot(ab, ab);
  const t = L2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2));
  return { d: dist(p, add(a, mul(ab, t))), t };
}
/** 1 strictly inside, 0 on the edge (within tol), -1 outside. */
export function pointInPolygon(p, poly, tol = 1e-7) {
  for (let i = 0; i < poly.length; i++) if (segmentDistance(p, poly[i], poly[(i + 1) % poly.length]).d <= tol) return 0;
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c ? 1 : -1;
}
/** Proper crossing of two segments (touching endpoints or collinear overlap is not a crossing). */
export function segmentsCross(a, b, c, d) {
  const d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c));
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}
export const edges = (poly) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);

/** Self-intersections of a polygon: list of [edge i, edge j]. */
export function selfIntersections(poly) {
  const E = edges(poly), out = [];
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
    if (j === i + 1 || (i === 0 && j === E.length - 1)) continue;
    if (segmentsCross(E[i][0], E[i][1], E[j][0], E[j][1])) out.push([i, j]);
  }
  return out;
}
/** Area shared by two simple polygons, by Sutherland–Hodgman when the clipper is convex, else by sampling. */
export function overlapArea(A, B) {
  const clip = (subject, clipper) => {
    let out = subject;
    const ccw = signedArea(clipper) > 0;
    for (const [c1, c2] of edges(clipper)) {
      const inside = (p) => (ccw ? 1 : -1) * cross(sub(c2, c1), sub(p, c1)) >= -EPS;
      const input = out; out = [];
      for (let i = 0; i < input.length; i++) {
        const P = input[i], Q = input[(i + 1) % input.length];
        const hit = () => { const r = sub(Q, P), s = sub(c2, c1), t = cross(sub(c1, P), s) / cross(r, s); return add(P, mul(r, t)); };
        if (inside(Q)) { if (!inside(P)) out.push(hit()); out.push(Q); } else if (inside(P)) out.push(hit());
      }
      if (!out.length) return [];
    }
    return out;
  };
  if (isConvex(B)) return polygonArea(clip(A, B));
  if (isConvex(A)) return polygonArea(clip(B, A));
  // Both concave: grid sample over the bounding-box intersection (5 cm cells).
  const a = bounds(A), b = bounds(B), x0 = Math.max(a.minX, b.minX), x1 = Math.min(a.maxX, b.maxX), y0 = Math.max(a.minY, b.minY), y1 = Math.min(a.maxY, b.maxY);
  if (x1 <= x0 || y1 <= y0) return 0;
  const h = 0.05; let n = 0;
  for (let x = x0 + h / 2; x < x1; x += h) for (let y = y0 + h / 2; y < y1; y += h) if (pointInPolygon([x, y], A) === 1 && pointInPolygon([x, y], B) === 1) n++;
  return n * h * h;
}
export function isConvex(poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = cross(sub(poly[(i + 1) % poly.length], poly[i]), sub(poly[(i + 2) % poly.length], poly[(i + 1) % poly.length]));
    if (Math.abs(c) < EPS) continue;
    if (!sign) sign = Math.sign(c); else if (Math.sign(c) !== sign) return false;
  }
  return true;
}
/** Is polygon `inner` inside `outer` (edges may touch)? */
export function polygonInside(inner, outer, tol = 1e-6) {
  if (inner.some((p) => pointInPolygon(p, outer, tol) < 0)) return false;
  for (const [a, b] of edges(inner)) for (const [c, d] of edges(outer)) if (segmentsCross(a, b, c, d)) return false;
  // midpoints catch concave notches crossed without a proper crossing
  return edges(inner).every(([a, b]) => pointInPolygon(mul(add(a, b), 0.5), outer, tol) >= 0);
}

/* ───────── walls and openings ───────── */
export function wallFrame(w) {
  const d = sub(w.b, w.a), L = len(d), u = mul(d, 1 / L);
  return { L, u, n: [-u[1], u[0]], angle: Math.atan2(u[1], u[0]) }; // n = left normal of a→b
}
/** Opening span on the wall centreline, at full precision. */
export function openingEndpoints(wall, o) {
  const { u } = wallFrame(wall);
  return [add(wall.a, mul(u, o.offset)), add(wall.a, mul(u, o.offset + o.width))];
}
/** Door swing: hinge point, closed-leaf end and the side (unit normal) the leaf opens into. */
export function doorSwing(wall, o) {
  const [s, e] = openingEndpoints(wall, o), { n } = wallFrame(wall);
  const side = o.swing?.side === "right" ? mul(n, -1) : n;
  const hingeAtStart = (o.swing?.hinge ?? "start") === "start";
  return { hinge: hingeAtStart ? s : e, free: hingeAtStart ? e : s, side, radius: o.width };
}
/** Wall solid/opening pieces along the wall, distances from a (used by both 2D and 3D). */
export function wallSegments(wall, openings) {
  const { L } = wallFrame(wall);
  const ops = openings.filter((o) => o.wall === wall.id).sort((p, q) => p.offset - q.offset);
  const out = []; let cur = 0;
  for (const o of ops) { if (o.offset > cur + EPS) out.push({ kind: "solid", s: cur, e: o.offset }); out.push({ kind: o.type, s: o.offset, e: o.offset + o.width, opening: o }); cur = o.offset + o.width; }
  if (cur < L - EPS) out.push({ kind: "solid", s: cur, e: L });
  return out;
}
/** Quad of a wall stretch [s,e] (metres along the wall) with its thickness, for drawing. */
export function wallQuad(wall, s, e, extendStart = 0, extendEnd = 0) {
  const { u, n } = wallFrame(wall), h = wall.thickness / 2;
  const A = add(wall.a, mul(u, s - extendStart)), B = add(wall.a, mul(u, e + extendEnd));
  return [add(A, mul(n, -h)), add(B, mul(n, -h)), add(B, mul(n, h)), add(A, mul(n, h))];
}

/* ───────── areas ───────── */
export function areas(plan) {
  const boundary = polygonArea(plan.boundary);
  const rooms = plan.rooms.map((r) => ({ id: r.id, name: r.name, type: r.type, area: polygonArea(r.polygon) }));
  const internal = rooms.reduce((s, r) => s + r.area, 0);
  const declared = plan.area?.declared ?? null;
  return {
    boundary, internal, rooms, declared,
    diffPct: declared ? ((declared - boundary) / boundary) * 100 : null,
  };
}

/* ───────── validation ───────── */
const msg = (level, code, message, ref) => ({ level, code, message, ...(ref ? { ref } : {}) });

/** Validate a plan. Returns { ok, diagnostics }. Errors make the plan unusable; warnings are shown. */
export function validatePlan(plan, opts = {}) {
  const D = [], err = (c, m, r) => D.push(msg("error", c, m, r)), warn = (c, m, r) => D.push(msg("warning", c, m, r));
  const tolerancePct = opts.areaTolerancePct ?? 2;
  if (plan?.schema !== SCHEMA) err("schema", `schema "${plan?.schema}" биш "${SCHEMA}" байх ёстой`);
  if (plan?.version !== VERSION) err("version", `Хувилбар ${plan?.version} дэмжигдэхгүй, ${VERSION} хүлээж байна`);
  if (plan?.units !== "m") err("units", `Хэмжих нэгж "${plan?.units}" — зөвхөн метр ("m") дэмжинэ. Импортын үед хөрвүүлнэ үү.`);
  if (!VERIFICATION[plan?.status?.verification]) err("status", "status.verification тодорхойгүй");
  if (!(plan?.ceiling_height > 1.8 && plan.ceiling_height < 6)) err("ceiling", `Таазны өндөр ${plan?.ceiling_height} м бодит бус`);
  const ids = new Set();
  const uniq = (id, kind) => { if (!id) err("id", `${kind}-д id алга`); else if (ids.has(id)) err("duplicate-id", `Давхардсан id ${id}`, id); else ids.add(id); };

  const poly = (P, kind, ref) => {
    if (!Array.isArray(P) || P.length < 3) { err("polygon", `${kind} полигон 3-аас доош оройтой`, ref); return false; }
    if (P.some((p) => !Number.isFinite(p?.[0]) || !Number.isFinite(p?.[1]))) { err("polygon", `${kind} полигонд тоон бус координат`, ref); return false; }
    for (let i = 0; i < P.length; i++) if (dist(P[i], P[(i + 1) % P.length]) < 1e-4) { err("polygon", `${kind} полигонд давхардсан орой (${i})`, ref); return false; }
    const x = selfIntersections(P);
    if (x.length) { err("self-intersection", `${kind} полигон өөрөө огтлолцож байна (ирмэг ${x[0][0]}×${x[0][1]})`, ref); return false; }
    if (polygonArea(P) < 0.05) { err("polygon", `${kind} полигоны талбай тэг`, ref); return false; }
    return true;
  };

  const okB = poly(plan.boundary, "Нэгжийн хил", "boundary");
  if (okB) {
    const A = polygonArea(plan.boundary);
    if (A < 10 || A > 1000) err("scale", `Хилийн талбай ${A.toFixed(2)} м² — масштаб/нэгж буруу байж магадгүй (10–1000 м² хүлээнэ)`, "boundary");
  }

  const walls = new Map();
  for (const w of plan.walls ?? []) {
    uniq(w.id, "Хана");
    if (!WALL_KINDS.includes(w.kind)) err("wall-kind", `Ханын төрөл "${w.kind}" тодорхойгүй`, w.id);
    if (!(w.thickness > 0.04 && w.thickness < 1)) err("wall-thickness", `Ханын зузаан ${w.thickness} м бодит бус`, w.id);
    if (!(w.height > 1.8 && w.height <= 6)) err("wall-height", `Ханын өндөр ${w.height} м бодит бус`, w.id);
    if (!(dist(w.a, w.b) > 0.05)) { err("wall-length", "Ханын урт тэг", w.id); continue; }
    walls.set(w.id, w);
  }
  const wl = [...walls.values()];
  for (let i = 0; i < wl.length; i++) for (let j = i + 1; j < wl.length; j++) {
    const a = wl[i], b = wl[j];
    if ((dist(a.a, b.a) < 1e-3 && dist(a.b, b.b) < 1e-3) || (dist(a.a, b.b) < 1e-3 && dist(a.b, b.a) < 1e-3)) err("duplicate-wall", `${a.id}, ${b.id} давхардсан хана`, b.id);
  }
  if (okB) for (const w of wl) for (const p of [w.a, w.b]) if (pointInPolygon(p, plan.boundary, 0.02) < 0) err("wall-outside", `Ханын үзүүр хилээс гадна (${p.map((v) => v.toFixed(3)).join(", ")})`, w.id);

  const byWall = new Map();
  for (const o of plan.openings ?? []) {
    uniq(o.id, "Нүх");
    if (!OPENING_TYPES.includes(o.type)) err("opening-type", `Нүхний төрөл "${o.type}" тодорхойгүй`, o.id);
    const w = walls.get(o.wall);
    if (!w) { err("opening-wall", `${o.id}: хана ${o.wall} олдсонгүй`, o.id); continue; }
    const { L } = wallFrame(w);
    if (!(o.width > 0.3)) err("opening-width", `${o.id}: өргөн ${o.width} м хэт бага`, o.id);
    if (o.offset < -EPS || o.offset + o.width > L + EPS) err("opening-range", `${o.id}: ${o.offset.toFixed(3)}–${(o.offset + o.width).toFixed(3)} м нь ${w.id} ханын урт ${L.toFixed(3)}-аас гарна`, o.id);
    if (!(o.height > 0.3) || (o.sill ?? 0) < 0 || (o.sill ?? 0) + o.height > w.height + EPS) err("opening-height", `${o.id}: доод ${o.sill} + өндөр ${o.height} нь ханын өндөр ${w.height}-аас хэтэрнэ`, o.id);
    if ((o.type === "door" || o.type === "entrance") && !["left", "right"].includes(o.swing?.side)) err("door-swing", `${o.id}: хаалганы нээгдэх тал (swing.side) алга`, o.id);
    if (o.type === "window" && w.kind !== "exterior") warn("window-wall", `${o.id}: цонх ${w.kind} хананд байна`, o.id);
    (byWall.get(w.id) ?? byWall.set(w.id, []).get(w.id)).push(o);
  }
  for (const [wid, list] of byWall) {
    list.sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < list.length; i++) if (list[i].offset < list[i - 1].offset + list[i - 1].width - EPS) err("opening-overlap", `${list[i - 1].id}, ${list[i].id} нүхнүүд ${wid} хананд давхацна`, list[i].id);
  }
  if (!(plan.openings ?? []).some((o) => o.type === "entrance")) err("entrance", "Орцны хаалга (type: entrance) алга");

  const roomOk = [];
  for (const r of plan.rooms ?? []) {
    uniq(r.id, "Өрөө");
    if (!r.name?.trim()) err("room-label", `${r.id}: өрөөний нэр алга`, r.id);
    if (!ROOM_TYPES.includes(r.type)) err("room-type", `${r.id}: өрөөний төрөл "${r.type}" тодорхойгүй`, r.id);
    if (!poly(r.polygon, `Өрөө ${r.id}`, r.id)) continue;
    if (okB && !polygonInside(r.polygon, plan.boundary, 0.005)) err("room-outside", `${r.id} ${r.name}: хилээс гарна`, r.id);
    roomOk.push(r);
  }
  for (let i = 0; i < roomOk.length; i++) for (let j = i + 1; j < roomOk.length; j++) {
    const ov = overlapArea(roomOk[i].polygon, roomOk[j].polygon);
    if (ov > 0.01) err("room-overlap", `${roomOk[i].id}, ${roomOk[j].id} өрөөнүүд ${ov.toFixed(2)} м² давхацна`, roomOk[j].id);
  }
  for (const z of plan.fixed_zones ?? []) {
    uniq(z.id, "Бүс");
    if (!["kitchen", "plumbing"].includes(z.type)) err("zone-type", `${z.id}: бүсийн төрөл "${z.type}" тодорхойгүй`, z.id);
    const room = roomOk.find((r) => r.id === z.room);
    if (!room) { err("zone-room", `${z.id}: өрөө ${z.room} олдсонгүй`, z.id); continue; }
    if (poly(z.polygon, `Бүс ${z.id}`, z.id) && !polygonInside(z.polygon, room.polygon, 0.005)) err("zone-outside", `${z.id}: ${room.name} өрөөнөөс гарна`, z.id);
  }

  if (okB && plan.area?.declared != null) {
    const A = polygonArea(plan.boundary), diff = ((plan.area.declared - A) / A) * 100;
    if (Math.abs(diff) > tolerancePct) warn("area-diff", `Зарласан ${plan.area.declared} м² нь хилээс тооцсон ${A.toFixed(2)} м²-аас ${diff > 0 ? "+" : ""}${diff.toFixed(2)}% зөрнө`, "area");
  }
  if (roomOk.length && okB) {
    const inner = roomOk.reduce((s, r) => s + polygonArea(r.polygon), 0), A = polygonArea(plan.boundary);
    if (inner > A + 0.01) err("area-internal", `Өрөөнүүдийн нийлбэр ${inner.toFixed(2)} м² нь хилээс их`, "area");
    else if (inner < A * 0.6) warn("area-internal", `Өрөөнүүд хилийн ${((inner / A) * 100).toFixed(0)}%-ийг л эзэлнэ — өрөө дутуу байж магадгүй`, "area");
  }
  return { ok: !D.some((d) => d.level === "error"), diagnostics: D };
}

/** Rooms on each side of an opening: the room whose polygon contains a point just off the wall. */
export function openingRooms(plan, o) {
  const w = plan.walls.find((x) => x.id === o.wall), [s, e] = openingEndpoints(w, o), mid = mul(add(s, e), 0.5), { n } = wallFrame(w), k = w.thickness / 2 + 0.05;
  const at = (p) => plan.rooms.find((r) => pointInPolygon(p, r.polygon) === 1)?.id ?? null;
  return { left: at(add(mid, mul(n, k))), right: at(add(mid, mul(n, -k))) };
}

/** Deterministic fingerprint of the architectural geometry (FNV-1a over canonical JSON). */
export function geometryKey(plan) {
  const canon = JSON.stringify({ b: plan.boundary, w: plan.walls, o: plan.openings, r: plan.rooms.map((r) => [r.id, r.polygon]), z: plan.fixed_zones ?? [] });
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) { h ^= canon.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** Display rounding lives here and only here. */
export const fmtM = (v, d = 2) => Number(v).toFixed(d);
export const fmtMM = (v) => String(Math.round(v * 1000));
