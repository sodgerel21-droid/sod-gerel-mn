#!/usr/bin/env node
/* Structured apartment plan ⇄ DXF, following the E-Property interior layer convention
 * (tools/cad/README.mn.md, "Нэгжийн дотор зураг"). This reads explicitly layered drawings; it does
 * not try to understand arbitrary CAD drawings, and raster/PDF plans are not recognised at all.
 *
 *   node tools/cad/plan-dxf.mjs import plan.dxf --id tuul-river/type-01 --revision r1 [--declared 96] [--out plan.json]
 *   node tools/cad/plan-dxf.mjs export plan.json [--out plan.dxf]
 *
 * Exit code 1 when the import has errors; the diagnostics are printed either way.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
  SCHEMA, VERSION, validatePlan, wallFrame, openingEndpoints, segmentDistance, pointInPolygon, polygonInside, sub, dot, dist,
} from "../../landing/units/lib/plan-geometry.js";

/* ───────── reading ───────── */
/** Minimal ASCII DXF reader: header variables and ENTITIES (LINE, LWPOLYLINE, POLYLINE/VERTEX, TEXT, MTEXT, ARC, CIRCLE, SPLINE). */
export function parseDxf(text) {
  const lines = text.split(/\r?\n/), pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].replace(/\s+$/, "")]);
  const header = {}, entities = [];
  let section = null, i = 0;
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c === 0 && v === "SECTION") { section = pairs[i + 1]?.[1]; i += 2; continue; }
    if (c === 0 && v === "ENDSEC") { section = null; i++; continue; }
    if (section === "HEADER" && c === 9) { header[v] = pairs[i + 1]?.[1]; i += 2; continue; }
    if (section === "ENTITIES" && c === 0) {
      const ent = { type: v, codes: [] }; i++;
      while (i < pairs.length && pairs[i][0] !== 0) ent.codes.push(pairs[i++]);
      entities.push(ent); continue;
    }
    i++;
  }
  // fold R12 POLYLINE + VERTEX… + SEQEND into one entity
  const out = [];
  for (let k = 0; k < entities.length; k++) {
    const e = entities[k];
    if (e.type === "POLYLINE") {
      const verts = [];
      while (entities[k + 1]?.type === "VERTEX") verts.push(entities[++k]);
      if (entities[k + 1]?.type === "SEQEND") k++;
      out.push({ type: "POLYLINE", codes: e.codes, vertices: verts });
    } else out.push(e);
  }
  return { header, entities: out.map(describe) };
}
function describe(e) {
  const get = (c) => e.codes.find((p) => p[0] === c)?.[1], num = (c) => parseFloat(get(c));
  const layer = get(8) ?? "0";
  if (e.type === "LINE") return { type: "LINE", layer, a: [num(10), num(20)], b: [num(11), num(21)] };
  if (e.type === "LWPOLYLINE") {
    const pts = [], bulges = [];
    for (const [c, v] of e.codes) { if (c === 10) pts.push([parseFloat(v), NaN]); if (c === 20) pts[pts.length - 1][1] = parseFloat(v); if (c === 42 && Math.abs(parseFloat(v)) > 1e-9) bulges.push(parseFloat(v)); }
    return { type: "POLY", layer, closed: (parseInt(get(70) ?? "0", 10) & 1) === 1, pts, curved: bulges.length > 0 };
  }
  if (e.type === "POLYLINE") {
    const pts = e.vertices.map((v) => [parseFloat(v.codes.find((p) => p[0] === 10)?.[1]), parseFloat(v.codes.find((p) => p[0] === 20)?.[1])]);
    const curved = e.vertices.some((v) => Math.abs(parseFloat(v.codes.find((p) => p[0] === 42)?.[1] ?? "0")) > 1e-9);
    return { type: "POLY", layer, closed: (parseInt(get(70) ?? "0", 10) & 1) === 1, pts, curved };
  }
  if (e.type === "TEXT" || e.type === "MTEXT") return { type: "TEXT", layer, at: [num(10), num(20)], text: (get(1) ?? "").replace(/\\P/g, " ").trim() };
  return { type: e.type, layer };
}

const UNITS = { 1: ["inch", 0.0254], 2: ["foot", 0.3048], 4: ["mm", 0.001], 5: ["cm", 0.01], 6: ["m", 1] };

/** DXF text → { plan, diagnostics }. Coordinates keep full precision after unit scaling. */
export function importPlan(text, opts = {}) {
  const D = [], err = (code, message, ref) => D.push({ level: "error", code, message, ...(ref ? { ref } : {}) }), warn = (code, message, ref) => D.push({ level: "warning", code, message, ...(ref ? { ref } : {}) });
  const { header, entities } = parseDxf(text);
  const meta = Object.fromEntries(entities.filter((e) => e.type === "TEXT" && e.layer === "EP-META").map((e) => e.text.split("=").map((s) => s.trim())).filter((kv) => kv.length === 2));
  let scale = 1, unitName = "m";
  if (meta.units) { const found = Object.values(UNITS).find(([n]) => n === meta.units); if (found) [unitName, scale] = found; else err("units", `EP-META units=${meta.units} дэмжигдэхгүй (m, cm, mm)`); }
  else if (header.$INSUNITS && UNITS[parseInt(header.$INSUNITS, 10)]) [unitName, scale] = UNITS[parseInt(header.$INSUNITS, 10)];
  else warn("units", "Нэгж заагаагүй ($INSUNITS эсвэл EP-META units=) — метр гэж үзлээ");
  const S = (p) => [p[0] * scale, p[1] * scale];

  const ep = entities.filter((e) => e.layer.startsWith("EP-"));
  for (const e of ep) if (["ARC", "CIRCLE", "SPLINE", "ELLIPSE"].includes(e.type) || e.curved) err("curved", `${e.layer}: муруй (${e.type === "POLY" ? "bulge" : e.type}) объект дэмжигдэхгүй — шулуун хэсгүүдээр зурна уу`, e.layer);
  const seen = new Set();
  for (const e of ep.filter((x) => x.type === "LINE" || x.type === "POLY")) {
    const key = `${e.layer}|${JSON.stringify(e.type === "LINE" ? [e.a, e.b].sort() : e.pts)}`;
    if (seen.has(key)) err("duplicate", `${e.layer}: давхардсан объект`, e.layer); else seen.add(key);
  }
  const closedPolys = (layer) => ep.filter((e) => e.layer === layer && e.type === "POLY").flatMap((e) => {
    let pts = e.pts.map(S);
    if (!e.closed) {
      if (pts.length > 3 && dist(pts[0], pts.at(-1)) < 1e-6) { pts = pts.slice(0, -1); warn("closed", `${layer}: хаалттай гэж тэмдэглээгүй ч эхлэл, төгсгөл давхцсан тул хаалттай гэж үзлээ`, layer); }
      else { err("closed", `${layer}: полигон хаалттай биш`, layer); return []; }
    }
    return [pts];
  });

  const units = closedPolys("EP-UNIT");
  if (units.length !== 1) err("boundary", `EP-UNIT давхаргад яг 1 хаалттай полигон хүлээж байна, ${units.length} олдлоо`);
  const boundary = units[0] ?? [];

  const walls = [];
  for (const e of ep.filter((x) => x.layer.startsWith("EP-WALL-"))) {
    const m = /^EP-WALL-(EXT|PARTY|CORR|INT)-(\d+)-(\d+)$/.exec(e.layer);
    if (!m) { err("wall-layer", `${e.layer}: нэр EP-WALL-<EXT|PARTY|CORR|INT>-<зузаан мм>-<өндөр мм> байх ёстой`, e.layer); continue; }
    const kind = { EXT: "exterior", PARTY: "party", CORR: "corridor", INT: "interior" }[m[1]];
    const segs = e.type === "LINE" ? [[e.a, e.b]] : e.type === "POLY" ? e.pts.slice(0, e.closed ? undefined : -1).map((p, k) => [p, e.pts[(k + 1) % e.pts.length]]) : [];
    for (const [a, b] of segs) walls.push({ id: `W${walls.length + 1}`, kind, a: S(a), b: S(b), thickness: +m[2] / 1000, height: +m[3] / 1000 });
  }

  const openings = [];
  for (const e of ep.filter((x) => /^EP-(WIN|DOOR|ENTRY|OPEN)-/.test(x.layer))) {
    if (e.type !== "LINE") { err("opening-entity", `${e.layer}: нүхийг LINE-аар зурна (нээгдэх тэнхлэгийн эхлэл = нугас)`, e.layer); continue; }
    const p = S(e.a), q = S(e.b), id = `O${openings.length + 1}`;
    let spec;
    const mw = /^EP-WIN-(\d+)-(\d+)$/.exec(e.layer), md = /^EP-(DOOR|ENTRY)-(\d+)-(L|R)$/.exec(e.layer), mo = /^EP-OPEN-(\d+)$/.exec(e.layer);
    if (mw) spec = { type: "window", sill: +mw[1] / 1000, height: +mw[2] / 1000 };
    else if (md) spec = { type: md[1] === "ENTRY" ? "entrance" : "door", sill: 0, height: +md[2] / 1000, side: md[3] };
    else if (mo) spec = { type: "opening", sill: 0, height: +mo[1] / 1000 };
    else { err("opening-layer", `${e.layer}: нэр EP-WIN-<доод мм>-<өндөр мм>, EP-DOOR-<өндөр мм>-<L|R>, EP-ENTRY-…, EP-OPEN-<өндөр мм> байх ёстой`, e.layer); continue; }
    const host = walls.find((w) => segmentDistance(p, w.a, w.b).d < 0.02 && segmentDistance(q, w.a, w.b).d < 0.02);
    if (!host) { err("opening-wall", `${id} (${e.layer}, ${p.map((v) => v.toFixed(3))}): хананы тэнхлэг дээр биш — ойролцоох хана олдсонгүй`, id); continue; }
    const { u, n } = wallFrame(host), tp = dot(sub(p, host.a), u), tq = dot(sub(q, host.a), u);
    const o = { id, type: spec.type, wall: host.id, offset: Math.min(tp, tq), width: Math.abs(tq - tp), height: spec.height, sill: spec.sill };
    if (spec.side) {
      // the line runs hinge → free end; L/R is the swing side seen along that line
      const along = tq >= tp, lineLeft = along ? n : [-n[0], -n[1]];
      const swingLeftOfWall = (spec.side === "L") === (dot(lineLeft, n) > 0);
      o.swing = { side: swingLeftOfWall ? "left" : "right", hinge: along ? "start" : "end" };
    }
    openings.push(o);
  }

  const tags = ep.filter((e) => e.type === "TEXT" && e.layer === "EP-ROOM-TAG").map((t) => ({ at: S(t.at), parts: t.text.split("|").map((s) => s.trim()) }));
  const rooms = [];
  closedPolys("EP-ROOM").forEach((poly, k) => {
    const id = `R${k + 1}`, inside = tags.filter((t) => pointInPolygon(t.at, poly) === 1);
    if (inside.length !== 1) { err("room-label", `${id}: EP-ROOM-TAG шошго ${inside.length} байна, 1 хүлээж байна (төрөл|нэр|шал)`, id); return; }
    const [type, name, finish] = inside[0].parts;
    rooms.push({ id, type, name, floor_finish: finish || (["bathroom", "wc", "hall", "storage"].includes(type) ? "tile" : "wood"), polygon: poly });
  });
  const zones = [];
  for (const [layer, type] of [["EP-ZONE-KITCHEN", "kitchen"], ["EP-ZONE-PLUMBING", "plumbing"]]) closedPolys(layer).forEach((poly) => {
    const room = rooms.find((r) => polygonInside(poly, r.polygon, 0.005));
    if (!room) err("zone-room", `${layer}: ямар ч өрөөнд бүрэн багтсангүй`, layer);
    else zones.push({ id: `Z${zones.length + 1}`, type, room: room.id, polygon: poly });
  });

  const declaredTxt = ep.find((e) => e.type === "TEXT" && e.layer === "EP-UNIT-AREA")?.text;
  const declared = opts.declared ?? (declaredTxt ? parseFloat(declaredTxt) : null);
  const plan = {
    schema: SCHEMA, version: VERSION,
    id: opts.id ?? meta.id ?? "imported", revision: opts.revision ?? meta.revision ?? "unrevised",
    title: meta.title ?? undefined, units: "m",
    coordinates: { frame: "DXF model space", x: "DXF X", y: "DXF Y", source_units: unitName, rooms: "finished wall faces", walls: "centrelines" },
    north_deg: meta.north != null ? parseFloat(meta.north) : null,
    ceiling_height: meta.ceiling != null ? parseFloat(meta.ceiling) : Math.max(...walls.map((w) => w.height), 0) || 2.7,
    status: { verification: meta.verification === "demonstration" ? "demonstration" : "imported-unverified", note: meta.note ?? "DXF-ээс импортолсон. Архитектор хянаж баталгаажуулах хүртэл шалгагдаагүй." },
    source: { file: opts.file ?? null, sha256: createHash("sha256").update(text).digest("hex"), importer: "tools/cad/plan-dxf.mjs", revision: opts.revision ?? meta.revision ?? null },
    area: { declared, declared_definition: opts.declaredDefinition ?? "EP-UNIT-AREA шошгоны зарласан талбай", boundary_definition: "EP-UNIT полигоноос тооцсон", internal_definition: "EP-ROOM полигонуудын нийлбэр", sales_area: "declared" },
    boundary, walls, openings, rooms, fixed_zones: zones,
  };
  if (!D.some((d) => d.level === "error")) D.push(...validatePlan(plan).diagnostics);
  return { plan, diagnostics: D, ok: !D.some((d) => d.level === "error") };
}

/* ───────── writing (fixtures and round trips) ───────── */
export function writePlanDxf(plan) {
  const out = [], g = (c, v) => out.push(String(c), String(v));
  const num = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(9, "$INSUNITS"); g(70, 6); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  const line = (layer, a, b) => { g(0, "LINE"); g(8, layer); g(10, num(a[0])); g(20, num(a[1])); g(30, "0.0"); g(11, num(b[0])); g(21, num(b[1])); g(31, "0.0"); };
  const text = (layer, at, s) => { g(0, "TEXT"); g(8, layer); g(10, num(at[0])); g(20, num(at[1])); g(30, "0.0"); g(40, "0.2"); g(1, s); };
  const poly = (layer, pts) => { g(0, "POLYLINE"); g(8, layer); g(66, 1); g(10, "0.0"); g(20, "0.0"); g(30, "0.0"); g(70, 1); for (const p of pts) { g(0, "VERTEX"); g(8, layer); g(10, num(p[0])); g(20, num(p[1])); g(30, "0.0"); } g(0, "SEQEND"); g(8, layer); };
  const inside = (polyPts) => { let best = null, bd = -1; const xs = polyPts.map((p) => p[0]), ys = polyPts.map((p) => p[1]); for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.1) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.1) { if (pointInPolygon([x, y], polyPts) !== 1) continue; const d = Math.min(...polyPts.map((p, i) => segmentDistance([x, y], p, polyPts[(i + 1) % polyPts.length]).d)); if (d > bd) { bd = d; best = [x, y]; } } return best; };
  for (const [k, v] of Object.entries({ units: "m", id: plan.id, revision: plan.revision, ceiling: plan.ceiling_height, verification: plan.status.verification, ...(plan.north_deg != null ? { north: plan.north_deg } : {}) })) text("EP-META", [0, -1 - out.length / 1000], `${k}=${v}`);
  poly("EP-UNIT", plan.boundary);
  if (plan.area?.declared != null) text("EP-UNIT-AREA", inside(plan.boundary), String(plan.area.declared));
  const K = { exterior: "EXT", party: "PARTY", corridor: "CORR", interior: "INT" };
  for (const w of plan.walls) line(`EP-WALL-${K[w.kind]}-${Math.round(w.thickness * 1000)}-${Math.round(w.height * 1000)}`, w.a, w.b);
  for (const o of plan.openings) {
    const w = plan.walls.find((x) => x.id === o.wall), [s, e] = openingEndpoints(w, o);
    if (o.type === "window") { line(`EP-WIN-${Math.round((o.sill ?? 0) * 1000)}-${Math.round(o.height * 1000)}`, s, e); continue; }
    if (o.type === "opening") { line(`EP-OPEN-${Math.round(o.height * 1000)}`, s, e); continue; }
    // line from hinge to free end; L/R as seen along it
    const hingeStart = (o.swing?.hinge ?? "start") === "start", from = hingeStart ? s : e, to = hingeStart ? e : s;
    const sideOfWallLeft = o.swing.side === "left", lineAlongWall = hingeStart;
    const side = sideOfWallLeft === lineAlongWall ? "L" : "R";
    line(`EP-${o.type === "entrance" ? "ENTRY" : "DOOR"}-${Math.round(o.height * 1000)}-${side}`, from, to);
  }
  for (const r of plan.rooms) { poly("EP-ROOM", r.polygon); text("EP-ROOM-TAG", inside(r.polygon), `${r.type}|${r.name}|${r.floor_finish ?? ""}`); }
  for (const z of plan.fixed_zones ?? []) poly(z.type === "kitchen" ? "EP-ZONE-KITCHEN" : "EP-ZONE-PLUMBING", z.polygon);
  g(0, "ENDSEC"); g(0, "EOF");
  return out.join("\n") + "\n";
}

/* ───────── CLI ───────── */
const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  const [cmd, file, ...rest] = process.argv.slice(2);
  const arg = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === "import" && file) {
    const r = importPlan(readFileSync(file, "utf8"), { id: arg("id"), revision: arg("revision"), file, declared: arg("declared") ? parseFloat(arg("declared")) : undefined });
    for (const d of r.diagnostics) console.error(`${d.level.toUpperCase()} ${d.code}${d.ref ? ` [${d.ref}]` : ""}: ${d.message}`);
    const json = JSON.stringify(r.plan, null, 1);
    if (arg("out")) writeFileSync(arg("out"), json + "\n"); else console.log(json);
    console.error(r.ok ? `OK: ${r.plan.walls.length} хана, ${r.plan.openings.length} нүх, ${r.plan.rooms.length} өрөө` : "Импорт алдаатай");
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === "export" && file) {
    const dxf = writePlanDxf(JSON.parse(readFileSync(file, "utf8")));
    if (arg("out")) writeFileSync(arg("out"), dxf); else process.stdout.write(dxf);
  } else {
    console.error("usage: plan-dxf.mjs import <plan.dxf> [--id ID] [--revision R] [--declared M2] [--out plan.json]\n       plan-dxf.mjs export <plan.json> [--out plan.dxf]");
    process.exit(2);
  }
}
