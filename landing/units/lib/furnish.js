/* Constraint-based furnishing (deterministic rules, no AI).
 *
 * A placement is { id, asset, room, x, y, rot, variant?, parent? } in plan metres; rot turns the
 * asset's +y "forward" so forward = (-sin rot, cos rot). Every rule value comes from
 * manifest.rules — design defaults, not a claim of regulatory compliance. When something does not
 * fit, it is left out and reported; nothing is stretched or forced into an impossible position.
 */
import {
  add, sub, mul, dot, len, dist, edges, signedArea, polygonInside, pointInPolygon, centroid, bounds,
  wallFrame, openingEndpoints, doorSwing, openingRooms,
} from "./plan-geometry.js";

const EPS = 1e-6;
export const fwdOf = (rot) => [-Math.sin(rot), Math.cos(rot)];
const rotV = (v, r) => [v[0] * Math.cos(r) - v[1] * Math.sin(r), v[0] * Math.sin(r) + v[1] * Math.cos(r)];
export const rotFromForward = (f) => Math.atan2(-f[0], f[1]);

/** Oriented rectangle as polygon: centre c, size w×d, rotation rot. */
export function orientedRect(c, w, d, rot) {
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map((p) => add(c, rotV(p, rot)));
}
export const assetById = (manifest) => new Map(manifest.assets.map((a) => [a.id, a]));
export const footprint = (p, a) => orientedRect([p.x, p.y], a.dims.w, a.dims.d, p.rot);

/** Clearance rectangles in front/left/right/all around an asset, in plan coordinates. */
export function clearances(p, a) {
  const { w, d } = a.dims, c = [p.x, p.y];
  return (a.clearance ?? []).map((k) => {
    if (k.side === "all") return orientedRect(c, w + 2 * k.depth, d + 2 * k.depth, p.rot);
    const local = k.side === "front" ? [[0, d / 2 + k.depth / 2], w, k.depth] : k.side === "left" ? [[-(w / 2 + k.depth / 2), 0], k.depth, d] : [[w / 2 + k.depth / 2, 0], k.depth, d];
    return orientedRect(add(c, rotV(local[0], p.rot)), local[1], local[2], p.rot);
  });
}

/** Separating-axis overlap of two convex polygons; touching (≤ tol) is not overlap. */
export function convexOverlap(A, B, tol = 1e-4) {
  for (const P of [A, B]) for (const [a, b] of edges(P)) {
    const ax = [-(b[1] - a[1]), b[0] - a[0]], L = len(ax) || 1, n = [ax[0] / L, ax[1] / L];
    const pa = A.map((p) => dot(p, n)), pb = B.map((p) => dot(p, n));
    if (Math.max(...pa) - Math.min(...pb) <= tol || Math.max(...pb) - Math.min(...pa) <= tol) return false;
  }
  return true;
}
/** Distance from point to an oriented rect (0 inside). */
function distToRect(pt, p, a) {
  const l = rotV(sub(pt, [p.x, p.y]), -p.rot);
  return Math.hypot(Math.max(Math.abs(l[0]) - a.dims.w / 2, 0), Math.max(Math.abs(l[1]) - a.dims.d / 2, 0));
}

/** Door swings, approach areas and window zones that touch a room. */
export function roomZones(plan, room, rules) {
  const zones = [];
  const ccw = signedArea(room.polygon) > 0;
  for (const o of plan.openings) {
    const sides = openingRooms(plan, o);
    const onLeft = sides.left === room.id, onRight = sides.right === room.id;
    if (!onLeft && !onRight) continue;
    const w = plan.walls.find((x) => x.id === o.wall), { n } = wallFrame(w), into = onLeft ? n : mul(n, -1);
    const [s, e] = openingEndpoints(w, o), face = w.thickness / 2;
    const band = (depth) => [add(s, mul(into, face)), add(e, mul(into, face)), add(e, mul(into, face + depth)), add(s, mul(into, face + depth))];
    if (o.type === "window") { zones.push({ kind: "window", opening: o.id, sill: o.sill ?? 0, poly: band(rules.windowZoneDepth) }); continue; }
    zones.push({ kind: "approach", opening: o.id, poly: band(rules.doorApproach), mid: add(mul(add(s, e), 0.5), mul(into, face)), into });
    if (o.type === "door" || o.type === "entrance") {
      const sw = doorSwing(w, o);
      if (dot(sw.side, into) > 0) {
        const h = add(sw.hinge, mul(into, face)), f = add(sw.free, mul(into, face));
        zones.push({ kind: "swing", opening: o.id, poly: [h, f, add(f, mul(into, sw.radius)), add(h, mul(into, sw.radius))] });
      }
    }
  }
  return { zones, ccw };
}

/* ───────── validation of one placement against the rest ───────── */
function ctxFor(plan, manifest, opts = {}) {
  const rules = { ...manifest.rules, ...(opts.rules ?? {}) };
  const A = assetById(manifest);
  const rooms = new Map(plan.rooms.map((r) => [r.id, r]));
  const zoneCache = new Map();
  const zonesOf = (rid) => zoneCache.get(rid) ?? zoneCache.set(rid, roomZones(plan, rooms.get(rid), rules)).get(rid);
  return { plan, manifest, rules, A, rooms, zonesOf };
}
const solid = (a) => !a.layer; // floor rugs, ceiling lights and curtains do not collide

/** Problems of placement `p` given the other placements. Empty list = valid. */
export function placementProblems(ctx, p, others, { walk = true } = {}) {
  const a = ctx.A.get(p.asset), room = ctx.rooms.get(p.room), out = [];
  if (!a) return [{ code: "asset", message: `Тавилга ${p.asset} manifest-д алга` }];
  if (!room) return [{ code: "room", message: `Өрөө ${p.room} алга` }];
  const fp = footprint(p, a);
  if (!polygonInside(fp, room.polygon, 0.005)) out.push({ code: "outside", message: `${a.name}: өрөөнөөс гарч байна` });
  if (a.anchor?.startsWith("zone:")) {
    const type = a.anchor.slice(5), zone = (ctx.plan.fixed_zones ?? []).find((z) => z.type === type && z.room === room.id);
    if (!zone) out.push({ code: "zone-missing", message: `${a.name}: ${room.name}-д ${type === "kitchen" ? "гал тогооны" : "усны"} тогтмол бүс заагдаагүй` });
    else if (!polygonInside(fp, zone.polygon, 0.005)) out.push({ code: "zone", message: `${a.name}: ${type === "kitchen" ? "гал тогооны" : "ус, ариутгах татуургын"} бүсээс гарч байна` });
  }
  if (!solid(a)) return out;
  const { zones } = ctx.zonesOf(room.id);
  for (const z of zones) {
    if (z.kind === "window" && a.dims.h <= z.sill - 0.02) continue;
    if (convexOverlap(fp, z.poly)) out.push({ code: z.kind, ref: z.opening, message: `${a.name}: ${z.kind === "swing" ? "хаалганы нээгдэх" : z.kind === "approach" ? "хаалганы орох" : "цонхны"} бүсийг хааж байна (${z.opening})` });
  }
  const mine = clearances(p, a);
  for (const q of others) {
    if (q.id === p.id || q.room !== p.room) continue;
    const b = ctx.A.get(q.asset); if (!b || !solid(b)) continue;
    const fq = footprint(q, b);
    if (convexOverlap(fp, fq)) { out.push({ code: "collision", ref: q.id, message: `${a.name}: ${b.name}-тай давхцаж байна` }); continue; }
    if (q.id !== p.parent && q.parent !== p.id) {
      if (clearances(q, b).some((c) => convexOverlap(fp, c))) out.push({ code: "clearance", ref: q.id, message: `${a.name}: ${b.name}-ийн ашиглах зайг эзэлж байна` });
      if (mine.some((c) => convexOverlap(c, fq))) out.push({ code: "clearance", ref: q.id, message: `${a.name}-ийн ашиглах зайд ${b.name} байна` });
    }
  }
  for (const c of mine) if (!polygonInside(c, room.polygon, 0.02)) { out.push({ code: "clearance-wall", message: `${a.name}: ашиглах зай хүрэлцэхгүй` }); break; }
  if (walk && !out.length) {
    const blocked = walkProblem(ctx, room, [...others.filter((q) => q.room === room.id && q.id !== p.id), p]);
    if (blocked) out.push(blocked);
  }
  return out;
}

/** Walking routes: every door of the room and every item's access side must stay mutually reachable. */
export function walkProblem(ctx, room, items) {
  const r = ctx.rules.walkway / 2, h = ctx.rules.gridStep, B = bounds(room.polygon);
  const solidItems = items.map((q) => ({ q, a: ctx.A.get(q.asset) })).filter((x) => x.a && solid(x.a));
  const nx = Math.ceil((B.maxX - B.minX) / h), ny = Math.ceil((B.maxY - B.minY) / h);
  const free = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const pt = [B.minX + (i + 0.5) * h, B.minY + (j + 0.5) * h];
    if (pointInPolygon(pt, room.polygon) !== 1) continue;
    if (solidItems.some(({ q, a }) => distToRect(pt, q, a) < r)) continue;
    free[i * ny + j] = 1;
  }
  const cell = (pt) => { const i = Math.floor((pt[0] - B.minX) / h), j = Math.floor((pt[1] - B.minY) / h); return i >= 0 && j >= 0 && i < nx && j < ny ? i * ny + j : -1; };
  // the nearest free cell within 15 cm of a target point (access points sit on a grid boundary)
  const snap = (pt) => {
    let best = -1, bd = 0.15;
    for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) {
      const q = [pt[0] + di * h, pt[1] + dj * h], k = cell(q);
      if (k >= 0 && free[k] && dist(q, pt) < bd) { bd = dist(q, pt); best = k; }
    }
    return best;
  };
  const { zones } = ctx.zonesOf(room.id);
  const targets = zones.filter((z) => z.kind === "approach").map((z) => ({ what: `хаалга ${z.opening}`, pts: [add(z.mid, mul(z.into, r + 0.03))] }));
  for (const { q, a } of solidItems) {
    if (q.parent || !(a.clearance ?? []).length) continue;
    // any point along the used side counts: a sofa is reached from its ends when a table stands in front
    const pts = (a.clearance ?? []).filter((k) => k.side !== "all").flatMap((k) => {
      const reach = r + 0.03, half = (k.side === "front" ? a.dims.w : a.dims.d) / 2, along = half > 0.3 ? [0, -(half - 0.15), half - 0.15] : [0];
      return along.map((t) => k.side === "front" ? [t, a.dims.d / 2 + reach] : k.side === "left" ? [-(a.dims.w / 2 + reach), t] : [a.dims.w / 2 + reach, t]);
    }).map((local) => add([q.x, q.y], rotV(local, q.rot)));
    if (pts.length) targets.push({ what: a.name, pts });
  }
  if (targets.length < 2) return null;
  const starts = targets[0].pts.map(snap).filter((k) => k >= 0);
  if (!starts.length) return { code: "walk", message: `${targets[0].what}-аас орох зам хаагдсан` };
  const seen = new Uint8Array(nx * ny), queue = [...starts];
  starts.forEach((k) => { seen[k] = 1; });
  while (queue.length) {
    const k = queue.pop(), i = Math.floor(k / ny), j = k % ny;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const m = a * ny + b; if (free[m] && !seen[m]) { seen[m] = 1; queue.push(m); }
    }
  }
  for (const t of targets.slice(1)) if (!t.pts.some((pt) => { const k = snap(pt); return k >= 0 && seen[k]; })) return { code: "walk", message: `${t.what} хүрэх явах зам (${ctx.rules.walkway} м) хаагдана` };
  return null;
}

/* ───────── candidate generation ───────── */
function wallCandidates(ctx, room, a, scoreFn) {
  const { ccw } = ctx.zonesOf(room.id), out = [], gap = ctx.rules.wallGap;
  edges(room.polygon).forEach(([p, q], ei) => {
    const L = dist(p, q); if (L < a.dims.w + 2 * gap) return;
    const u = mul(sub(q, p), 1 / L), inward = ccw ? [-u[1], u[0]] : [u[1], -u[0]], rot = rotFromForward(inward);
    const n = Math.floor((L - a.dims.w) / 0.05);
    for (let k = 0; k <= n; k++) {
      const s = a.dims.w / 2 + (n ? (k * (L - a.dims.w)) / n : (L - a.dims.w) / 2);
      const c = add(add(p, mul(u, s)), mul(inward, a.dims.d / 2 + gap));
      out.push({ x: c[0], y: c[1], rot, edge: ei, s, L, score: scoreFn({ c, s, L, ei, inward, p, q }) });
    }
  });
  return out.sort((x, y) => y.score - x.score);
}
function tryCandidates(ctx, room, asset, cands, placed, extra = {}, maxWalkChecks = 60) {
  // cheap geometric checks on every candidate in score order; the walking-route check (a grid
  // flood fill) only on the first few that pass them
  let walks = 0;
  for (const c of cands) {
    const p = { id: "", asset: asset.id, room: room.id, x: c.x, y: c.y, rot: c.rot, ...extra };
    if (placementProblems(ctx, p, placed, { walk: false }).length) continue;
    if (!placementProblems(ctx, p, placed).length) return p;
    if (++walks >= maxWalkChecks) return null;
  }
  return null;
}
const doorMids = (ctx, room) => ctx.zonesOf(room.id).zones.filter((z) => z.kind === "approach").map((z) => z.mid);
const windowEdges = (ctx, room) => {
  const wz = ctx.zonesOf(room.id).zones.filter((z) => z.kind === "window");
  return new Set(edges(room.polygon).map(([p, q], i) => (wz.some((z) => z.poly.some((v) => segDist(v, p, q) < 0.02)) ? i : -1)).filter((i) => i >= 0));
};
function segDist(v, p, q) { const ab = sub(q, p), t = Math.max(0, Math.min(1, dot(sub(v, p), ab) / dot(ab, ab))); return dist(v, add(p, mul(ab, t))); }
const nearest = (pts, c) => (pts.length ? Math.min(...pts.map((m) => dist(m, c))) : 0);

/** Furnish every room by its program. Returns { placements, diagnostics }. */
export function furnish(plan, manifest, opts = {}) {
  const ctx = ctxFor(plan, manifest, opts), placed = [], diagnostics = [];
  let seq = 0;
  const put = (p, room, a) => { p.id = `${room.id}:${a.id}:${++seq}`; placed.push(p); return p; };
  const skip = (room, a, why) => diagnostics.push({ level: "warning", code: "not-placed", room: room.id, asset: a.id, message: `${room.name}: ${a.name} байрлуулах боломжтой зай олдсонгүй${why ? ` (${why})` : ""}` });

  for (const room of plan.rooms) {
    const doors = doorMids(ctx, room), win = windowEdges(ctx, room), C = centroid(room.polygon);
    // kitchen run first: it is fixed by the plan, everything else works around it
    const kz = (plan.fixed_zones ?? []).find((z) => z.type === "kitchen" && z.room === room.id);
    if (kz) placeKitchenRun(ctx, room, kz, placed, put, diagnostics);
    for (const entry of manifest.programs[room.type] ?? []) {
      const choices = (Array.isArray(entry) ? entry : [entry]).map((id) => ctx.A.get(id)).filter(Boolean);
      let done = null;
      for (const a of choices) {
        done = placeOne(ctx, room, a, placed, { doors, win, C, kz });
        if (done) { put(done, room, a); break; }
      }
      if (!done && choices.length) {
        const a = choices[0];
        const parentCat = a.anchor?.startsWith("relative:") ? a.anchor.split(":")[1] : null;
        if (parentCat && !placed.some((q) => q.room === room.id && ctx.A.get(q.asset)?.category === parentCat)) continue; // its parent was not placed and is reported
        skip(room, a, (Array.isArray(entry) && entry.length > 1) ? "бүх хувилбарыг туршсан" : "");
      }
    }
    // a ceiling light at the most central point, curtains at every window
    const light = ctx.A.get("ceiling-light");
    if (light) { const c = pointInPolygon(C, room.polygon) === 1 ? C : interiorPoint(room.polygon); put({ id: "", asset: light.id, room: room.id, x: c[0], y: c[1], rot: 0 }, room, light); }
    const curtain = ctx.A.get("curtain");
    if (curtain && ["living", "bedroom"].includes(room.type)) for (const z of ctx.zonesOf(room.id).zones.filter((z) => z.kind === "window")) {
      const o = plan.openings.find((x) => x.id === z.opening), w = plan.walls.find((x) => x.id === o.wall), [s, e] = openingEndpoints(w, o);
      const into = sub(z.poly[3], z.poly[0]); const n = mul(into, 1 / len(into)), mid = mul(add(s, e), 0.5), c = add(mid, mul(n, w.thickness / 2 + 0.07));
      put({ id: "", asset: curtain.id, room: room.id, x: c[0], y: c[1], rot: rotFromForward(n), width: o.width + 0.5, top: Math.min(w.height - 0.05, (o.sill ?? 0) + o.height + 0.2) }, room, curtain);
    }
  }
  return { placements: placed, diagnostics };
}

function interiorPoint(poly) {
  const B = bounds(poly); let best = centroid(poly), bd = -1;
  for (let x = B.minX; x <= B.maxX; x += 0.1) for (let y = B.minY; y <= B.maxY; y += 0.1) {
    if (pointInPolygon([x, y], poly) !== 1) continue;
    const d = Math.min(...edges(poly).map(([p, q]) => segDist([x, y], p, q)));
    if (d > bd) { bd = d; best = [x, y]; }
  }
  return best;
}

function placeOne(ctx, room, a, placed, { doors, win, C, kz }) {
  const inRoom = placed.filter((q) => q.room === room.id);
  const find = (cat) => inRoom.find((q) => ctx.A.get(q.asset)?.category === cat || q.asset === cat);
  if (a.anchor?.startsWith("relative:")) {
    const [, parentCat, gapS] = a.anchor.split(":"), parent = find(parentCat); if (!parent) return null;
    const pa = ctx.A.get(parent.asset), gap = +gapS, f = fwdOf(parent.rot);
    const c = parentCat === "coffee-table" || gap === 0 ? [parent.x, parent.y] : add([parent.x, parent.y], mul(f, pa.dims.d / 2 + gap + a.dims.d / 2));
    return tryCandidates(ctx, room, a, [{ x: c[0], y: c[1], rot: parent.rot }], placed, { parent: parent.id });
  }
  if (a.category === "nightstand") {
    const bed = find("bed"); if (!bed) return null;
    const b = ctx.A.get(bed.asset), taken = inRoom.filter((q) => q.parent === bed.id).length;
    const sides = [-1, 1].map((s) => add([bed.x, bed.y], rotV([s * (b.dims.w / 2 + a.dims.w / 2 + 0.03), -b.dims.d / 2 + a.dims.d / 2], bed.rot)));
    return tryCandidates(ctx, room, a, sides.slice(taken).map((c) => ({ x: c[0], y: c[1], rot: bed.rot })), placed, { parent: bed.id });
  }
  if (a.anchor === "free") {
    const B = bounds(room.polygon), cands = [], base = longestEdgeRot(ctx, room);
    const target = kz ? centroid(kz.polygon) : C;
    for (let x = B.minX; x <= B.maxX; x += 0.1) for (let y = B.minY; y <= B.maxY; y += 0.1) for (const rot of [base, base + Math.PI / 2])
      cands.push({ x, y, rot, score: -dist([x, y], target) });
    cands.sort((p, q) => q.score - p.score);
    return tryCandidates(ctx, room, a, cands, placed);
  }
  const zone = a.anchor?.startsWith("zone:") ? (ctx.plan.fixed_zones ?? []).find((z) => z.type === a.anchor.slice(5) && z.room === room.id) : null;
  if (a.anchor?.startsWith("zone:") && !zone) return null;
  const sofa = find("sofa");
  const score = ({ c, s, L, ei, inward }) => {
    const centred = -Math.abs(s - L / 2) * 0.4, fromDoor = nearest(doors, c);
    switch (a.category) {
      case "bed": return fromDoor + centred - (win.has(ei) ? 1.5 : 0);
      case "wardrobe": return -Math.min(s - a.dims.w / 2, L - a.dims.w / 2 - s) * 0.8 + fromDoor * 0.2;
      case "sofa": return L * 0.3 + centred - (kz ? Math.max(0, 3 - dist(c, centroid(kz.polygon))) : 0);
      case "media": {
        if (!sofa) return centred;
        const to = sub([sofa.x, sofa.y], c), d = len(to);
        return dot(inward, mul(to, 1 / d)) > 0.9 ? -Math.abs(d - 2.8) : -100;
      }
      case "hall-storage": return -fromDoor * 0.2 + (fromDoor > 0.9 ? 0 : -2);
      case "plant": return -Math.min(s - a.dims.w / 2, L - a.dims.w / 2 - s) * 2 + Math.min(fromDoor, 3) * 0.3; // a corner, away from doors
      default: return centred - fromDoor * 0.1;
    }
  };
  const cands = wallCandidates(ctx, room, a, score);
  if (a.category === "media" && sofa) return tryCandidates(ctx, room, a, cands.filter((c) => c.score > -50), placed);
  return tryCandidates(ctx, room, a, cands, placed);
}
function longestEdgeRot(ctx, room) {
  let best = null, L = 0;
  for (const [p, q] of edges(room.polygon)) { const l = dist(p, q); if (l > L) { L = l; best = sub(q, p); } }
  return Math.atan2(best[1], best[0]);
}

function placeKitchenRun(ctx, room, zone, placed, put, diagnostics) {
  // the zone edge lying on a room wall is the back of the run; modules go along it, in order
  const { ccw } = ctx.zonesOf(room.id), gap = ctx.rules.wallGap;
  let back = null;
  for (const [p, q] of edges(zone.polygon)) {
    const onWall = edges(room.polygon).some(([a, b]) => segDist(p, a, b) < 0.01 && segDist(q, a, b) < 0.01);
    if (onWall && (!back || dist(p, q) > dist(back[0], back[1]))) back = [p, q];
  }
  if (!back) { diagnostics.push({ level: "warning", code: "kitchen-run", room: room.id, message: `${room.name}: гал тогооны бүсийн ар тал хананд тулаагүй` }); return; }
  const [p, q] = back, L = dist(p, q), u = mul(sub(q, p), 1 / L);
  let inward = ccw ? [-u[1], u[0]] : [u[1], -u[0]];
  if (pointInPolygon(add(mul(add(p, q), 0.5), mul(inward, 0.1)), zone.polygon) < 0) inward = mul(inward, -1);
  let s = 0;
  for (const id of ctx.manifest.kitchenRun) {
    const a = ctx.A.get(id); if (!a) continue;
    if (s + a.dims.w > L + 1e-6) break;
    const c = add(add(p, mul(u, s + a.dims.w / 2)), mul(inward, a.dims.d / 2 + gap));
    const pl = { id: "", asset: a.id, room: room.id, x: c[0], y: c[1], rot: rotFromForward(inward) };
    const probs = placementProblems(ctx, pl, placed);
    if (probs.length) { diagnostics.push({ level: "warning", code: "kitchen-run", room: room.id, asset: a.id, message: `${room.name}: ${a.name} — ${probs[0].message}` }); break; }
    put(pl, room, a); s += a.dims.w;
  }
}

/** Validate a whole configuration (used on restore and after edits). */
export function validatePlacements(plan, manifest, placements, opts) {
  const ctx = ctxFor(plan, manifest, opts);
  return placements.map((p) => ({ id: p.id, problems: placementProblems(ctx, p, placements, opts?.walk === false ? { walk: false } : undefined) }));
}
export { ctxFor };
