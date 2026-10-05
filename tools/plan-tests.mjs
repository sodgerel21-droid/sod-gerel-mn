// Geometry and integration checks for the apartment plan system (landing/units/lib, tools/cad/plan-dxf.mjs).
//   node --test tools/plan-tests.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validatePlan, areas, polygonArea, openingEndpoints, openingRooms, wallFrame, wallSegments, geometryKey, dist,
} from "../landing/units/lib/plan-geometry.js";
import { shellPieces } from "../landing/units/lib/shell.js";
import { inferPlan } from "../landing/units/lib/legacy-layout.js";
import { resolvePlan } from "../landing/units/lib/plan-source.js";
import { furnish, validatePlacements, ctxFor, placementProblems } from "../landing/units/lib/furnish.js";
import { createEditor, serialize, restore } from "../landing/units/lib/interior-config.js";
import { importPlan, writePlanDxf } from "./cad/plan-dxf.mjs";

const DATA = new URL("../landing/3d/data/", import.meta.url);
const json = (rel) => JSON.parse(readFileSync(new URL(rel, DATA), "utf8"));
const FIX = json("tuul-river/plans/type-01.plan.json");
const MAN = JSON.parse(readFileSync(new URL("../landing/units/assets/manifest.json", import.meta.url), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test("fixture plan validates without diagnostics", () => {
  const v = validatePlan(FIX);
  assert.equal(v.ok, true); assert.deepEqual(v.diagnostics, []);
});

test("areas match the hand-calculated fixture values", () => {
  const A = areas(FIX), by = Object.fromEntries(A.rooms.map((r) => [r.id, r.area]));
  near(A.boundary, 96);
  near(by["R-bed1"], 3.54 * 4.04, 1e-9);
  near(by["R-bed2"], 3.18 * 4.04, 1e-9);
  near(by["R-bath"], 2.34 * 3.24, 1e-9);
  near(by["R-store"], 1.38 * 1.64, 1e-9);
  // hall: rectangle − storage notch − 45° chamfer triangle (legs 0.664852813…)
  const leg = 8.54 - 7.875147186257615;
  near(by["R-hall"], 5.78 * 3.24 - 1.5 * 1.76 - leg * leg / 2, 1e-9);
  // living: two rectangles + the triangle the chamfer adds on its side (legs 0.735147186…)
  const leg2 = 8.66 - 7.9248528137423855;
  near(by["R-living"], 3.04 * 3.36 + 4.44 * 4.04 + leg2 * leg2 / 2, 1e-9);
  assert.equal(A.declared, 96); near(A.diffPct, 0);
});

test("openings stay at their declared coordinates in the shared shell (2D and 3D)", () => {
  const { openings, pieces } = shellPieces(FIX);
  for (const o of FIX.openings) {
    const w = FIX.walls.find((x) => x.id === o.wall), [a, b] = openingEndpoints(w, o), s = openings.find((x) => x.opening.id === o.id);
    assert.ok(s, `${o.id} missing from shell`);
    near(s.s, o.offset); near(s.e, o.offset + o.width);
    near(dist(s.a, a), 0); near(dist(s.b, b), 0);
  }
  // e.g. the entrance on W-S: x from 0.15 + 5.45 to + 1.0, y on the centreline 10.15
  const e = openings.find((x) => x.opening.id === "D-entry");
  near(e.a[0], 5.6, 1e-12); near(e.b[0], 6.6, 1e-12); near(e.a[1], 10.15, 1e-12);
  // every wall is covered exactly once by solid stretches and openings
  for (const w of FIX.walls) {
    const segs = wallSegments(w, FIX.openings), L = wallFrame(w).L;
    near(segs[0].s, 0); near(segs.at(-1).e, L, 1e-9);
    for (let i = 1; i < segs.length; i++) near(segs[i].s, segs[i - 1].e);
  }
  assert.ok(pieces.every((p) => p.z1 > p.z0));
});

test("2D plan and 3D viewer draw from the same shell module", () => {
  const src = (f) => readFileSync(new URL(`../landing/units/lib/${f}`, import.meta.url), "utf8");
  for (const f of ["plan2d.js", "viewer3d.js"]) assert.match(src(f), /import \{ shellPieces \} from "\.\/shell\.js"/, f);
  assert.equal(geometryKey(FIX), geometryKey(clone(FIX)));
});

test("rotated walls and non-rectangular rooms are supported", () => {
  // the chamfer wall W-g is at 135°, the hall and living room are not rectangles
  const g = FIX.walls.find((w) => w.id === "W-g");
  near(wallFrame(g).angle, (3 * Math.PI) / 4, 1e-12);
  assert.deepEqual(openingRooms(FIX, FIX.openings.find((o) => o.id === "O-living")), { left: "R-hall", right: "R-living" });
  // rotating the whole apartment by 30° keeps it valid with identical areas and openings
  const th = Math.PI / 6, R = ([x, y]) => [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)];
  const rot = clone(FIX);
  rot.boundary = rot.boundary.map(R); rot.walls.forEach((w) => { w.a = R(w.a); w.b = R(w.b); });
  rot.rooms.forEach((r) => { r.polygon = r.polygon.map(R); }); rot.fixed_zones.forEach((z) => { z.polygon = z.polygon.map(R); });
  assert.equal(validatePlan(rot).ok, true);
  const A0 = areas(FIX), A1 = areas(rot);
  A0.rooms.forEach((r, i) => near(A1.rooms[i].area, r.area, 1e-9));
  for (const o of FIX.openings) assert.deepEqual(openingRooms(rot, o), openingRooms(FIX, o));
});

test("invalid geometry fails with actionable diagnostics instead of being replaced", () => {
  const bow = clone(FIX); bow.rooms[1].polygon = [[0.3, 13.66], [3.84, 17.7], [3.84, 13.66], [0.3, 17.7]];
  const v = validatePlan(bow);
  assert.equal(v.ok, false); assert.ok(v.diagnostics.some((d) => d.code === "self-intersection" && d.ref === "R-bed1"));
  const off = clone(FIX); off.openings[0].offset = 11.5;
  assert.ok(validatePlan(off).diagnostics.some((d) => d.code === "opening-range" && d.ref === "D-entry"));
  const over = clone(FIX); over.rooms[2].polygon = [[3.5, 13.66], [7.14, 13.66], [7.14, 17.7], [3.5, 17.7]];
  assert.ok(validatePlan(over).diagnostics.some((d) => d.code === "room-overlap"));
  const mm = clone(FIX); mm.units = "mm";
  assert.ok(validatePlan(mm).diagnostics.some((d) => d.code === "units"));
});

test("DXF round trip keeps every coordinate, swing and label", () => {
  const r = importPlan(writePlanDxf(FIX), { id: FIX.id, revision: FIX.revision });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  const P = r.plan;
  FIX.walls.forEach((w, i) => { assert.deepEqual(P.walls[i].a, w.a); assert.deepEqual(P.walls[i].b, w.b); near(P.walls[i].thickness, w.thickness); });
  for (const o of FIX.openings) {
    const wi = FIX.walls.findIndex((w) => w.id === o.wall), q = P.openings.find((x) => x.wall === P.walls[wi].id && Math.abs(x.offset - o.offset) < 1e-9);
    assert.ok(q, o.id); near(q.width, o.width, 1e-9); assert.equal(q.type, o.type);
    if (o.swing) assert.deepEqual(q.swing, o.swing, o.id);
  }
  FIX.rooms.forEach((rm, i) => { assert.deepEqual(P.rooms[i].polygon, rm.polygon); assert.equal(P.rooms[i].name, rm.name); });
  assert.deepEqual(P.fixed_zones.map((z) => z.type), ["kitchen", "plumbing"]);
  assert.equal(P.status.verification, "demonstration");
});

test("DXF importer reports scale, curves, duplicates, open outlines, labels and stray openings", () => {
  const base = writePlanDxf(FIX);
  // millimetres are scaled, not misread as metres
  const L = base.replace("units=m", "units=mm").split("\n");
  for (let i = 0; i + 1 < L.length; i += 2) if (["10", "20", "11", "21"].includes(L[i].trim())) L[i + 1] = String(parseFloat(L[i + 1]) * 1000);
  const mmText = L.join("\n");
  const mm = importPlan(mmText);
  assert.equal(mm.ok, true, JSON.stringify(mm.diagnostics.filter((d) => d.level === "error")));
  near(polygonArea(mm.plan.boundary), 96, 1e-6);
  const add = (s) => base.replace("0\nENDSEC\n0\nEOF", `${s}0\nENDSEC\n0\nEOF`);
  const curved = importPlan(add("0\nARC\n8\nEP-WALL-INT-120-2700\n10\n1\n20\n12\n40\n1\n50\n0\n51\n90\n"));
  assert.ok(curved.diagnostics.some((d) => d.code === "curved"));
  const dup = importPlan(add("0\nLINE\n8\nEP-WALL-INT-120-2700\n10\n3.9\n20\n13.6\n30\n0.0\n11\n3.9\n21\n17.7\n31\n0.0\n"));
  assert.ok(dup.diagnostics.some((d) => d.code === "duplicate"));
  const stray = importPlan(add("0\nLINE\n8\nEP-WIN-900-1500\n10\n5\n20\n15\n30\n0.0\n11\n6\n21\n15\n31\n0.0\n"));
  assert.ok(stray.diagnostics.some((d) => d.code === "opening-wall"));
  const unlabelled = importPlan(base.replace(/0\nTEXT\n8\nEP-ROOM-TAG\n10\n[\d.]+\n20\n[\d.]+\n30\n0.0\n40\n0.2\n1\nstorage\|[^\n]*\n/, ""));
  assert.ok(unlabelled.diagnostics.some((d) => d.code === "room-label"));
  const open = importPlan(base.replace(/(0\nPOLYLINE\n8\nEP-UNIT\n66\n1\n10\n0.0\n20\n0.0\n30\n0.0\n70\n)1/, "$10"));
  assert.ok(open.diagnostics.some((d) => d.code === "closed"));
});

test("furnishing places the programme without breaking any rule", () => {
  const r = furnish(FIX, MAN);
  assert.deepEqual(r.diagnostics, []);
  const invalid = validatePlacements(FIX, MAN, r.placements).filter((x) => x.problems.length);
  assert.deepEqual(invalid, []);
  const has = (room, asset) => r.placements.some((p) => p.room === room && p.asset === asset);
  assert.ok(has("R-bed1", "bed-double-160") && has("R-living", "sofa-3") && has("R-living", "dining-set-4") && has("R-bath", "toilet"));
  // the kitchen run sits inside the fixed kitchen zone, bathroom fixtures inside the wet zone
  assert.ok(r.placements.filter((p) => p.asset.startsWith("kitchen-")).length >= 4);
});

test("invalid furniture placements are rejected", () => {
  const ctx = ctxFor(FIX, MAN), { placements } = furnish(FIX, MAN);
  const bed = placements.find((p) => p.room === "R-bed1" && p.asset === "bed-double-160");
  const ward = placements.find((p) => p.room === "R-bed1" && p.asset.startsWith("wardrobe"));
  const codes = (p) => placementProblems(ctx, p, placements).map((x) => x.code);
  assert.ok(codes({ ...bed, x: ward.x, y: ward.y + 0.5 }).includes("collision"));
  // in front of the bedroom door (D-bed1 swings into R-bed1 between x 2.85–3.65 on y 13.6)
  const nst = { id: "t1", asset: "nightstand", room: "R-bed1", x: 3.3, y: 14.0, rot: 0 };
  assert.ok(codes(nst).some((c) => c === "swing" || c === "approach"));
  const toilet = placements.find((p) => p.asset === "toilet");
  assert.ok(codes({ ...toilet, room: "R-hall", x: 6, y: 11 }).includes("zone-missing"));
  assert.ok(codes({ ...bed, x: 0.2 }).includes("outside"));
  // the editor refuses the move and keeps its state
  const ed = createEditor(FIX, MAN, placements), before = JSON.stringify(ed.placements);
  const res = ed.transform(bed.id, { x: ward.x, y: ward.y });
  assert.equal(res.ok, false); assert.equal(JSON.stringify(ed.placements), before); assert.equal(ed.canUndo, false);
});

test("editing history and saved configuration restore correctly", () => {
  const { placements } = furnish(FIX, MAN), ed = createEditor(FIX, MAN, placements);
  const sofa = ed.placements.find((p) => p.asset === "sofa-3");
  assert.equal(ed.remove(sofa.id).ok, true);
  assert.ok(!ed.placements.some((p) => p.id === sofa.id || p.parent === sofa.id), "children go with their parent");
  ed.undo(); assert.ok(ed.placements.some((p) => p.id === sofa.id));
  ed.redo(); assert.ok(!ed.placements.some((p) => p.id === sofa.id));
  const text = serialize(FIX, { placements: ed.placements, style: "scandi", savedAt: "2026-10-05T00:00:00Z" });
  const r = restore(FIX, MAN, text);
  assert.equal(r.ok, true); assert.deepEqual(r.dropped, []); assert.equal(r.style, "scandi");
  assert.deepEqual(r.placements.map((p) => [p.id, p.x, p.y, p.rot]), ed.placements.map((p) => [p.id, p.x, p.y, p.rot]));
  const newer = { ...clone(FIX), revision: "r2" };
  const stale = restore(newer, MAN, text);
  assert.equal(stale.ok, false); assert.equal(stale.stale, true);
  ed.reset(); assert.equal(ed.placements.length, placements.length);
});

test("every demo unit still resolves: structured plan for type 01, labelled inferred split elsewhere", async () => {
  const fetchJson = async (url) => { try { return JSON.parse(readFileSync(new URL(url, DATA), "utf8")); } catch { return null; } };
  for (const p of json("projects.json")) {
    const units = json(`${p.slug}/units.json`);
    for (const u of units) {
      const r = await resolvePlan(p, u, (f) => `${p.slug}/${f}`, fetchJson);
      assert.equal(r.validation.ok, true, `${p.slug}/${u.unit_id}`);
      if (p.slug === "tuul-river" && u.unit_id.endsWith("01")) { assert.equal(r.kind, "structured"); assert.equal(r.plan.id, "tuul-river/type-01"); }
      else { assert.equal(r.kind, "inferred"); assert.equal(r.plan.status.verification, "inferred"); }
    }
  }
});

test("a structured plan whose outline differs from the unit is not used", async () => {
  const p = json("projects.json").find((x) => x.slug === "tuul-river"), u = { ...json("tuul-river/units.json")[0], floor_polygon: [[0, 10], [11, 10], [11, 18], [0, 18]] };
  const fetchJson = async (url) => { try { return JSON.parse(readFileSync(new URL(url, DATA), "utf8")); } catch { return null; } };
  const r = await resolvePlan(p, u, (f) => `${p.slug}/${f}`, fetchJson);
  assert.equal(r.kind, "inferred"); assert.ok(r.notes.some((n) => n.code === "plan-outline"));
});

test("unit deep links keep their contract (?project=&unit=&tab=)", () => {
  const html = readFileSync(new URL("../landing/units/index.html", import.meta.url), "utf8");
  assert.match(html, /params\.get\("project"\)/); assert.match(html, /params\.get\("unit"\)/);
  const pp = readFileSync(new URL("../landing/units/passport.js", import.meta.url), "utf8");
  assert.match(pp, /\{ plan: "plan", "3d": "shell", interior: "interior" \}\[params\.get\("tab"\)\]/);
  // the inferred conversion keeps the legacy geometry valid for all 292 demo units
  let n = 0;
  for (const p of json("projects.json")) for (const u of json(`${p.slug}/units.json`)) { assert.equal(validatePlan(inferPlan(u, p)).ok, true); n++; }
  assert.equal(n, 292);
});

test("existing-model inspection reports scale and axes and never classifies by guessing", async () => {
  const { analyze, applyMapping, mappingTemplate } = await import("../landing/units/lib/model-inspect.js");
  const mesh = (name, material, min, max, hasUV = true) => ({ name, material, triangles: 12, hasUV, hasNormals: true, min, max });
  // millimetre model, Y-up
  const mm = [mesh("Wall_001", "Paint", [0, 0, 0], [12000, 2700, 8000]), mesh("Mesh.004", "Glass", [100, 900, 0], [1900, 2100, 300], false)];
  const r = analyze(mm);
  assert.equal(r.unit.unit, "mm"); near(r.unit.span, 12, 1e-9); assert.equal(r.up, "y");
  assert.ok(r.issues.some((i) => i.code === "uv") && r.issues.some((i) => i.code === "names"));
  // metres, Z-up export: 20 m along Y, 2.7 m along Z
  const zup = analyze([mesh("Slab", "Concrete", [0, 0, 0], [12, 20, 2.7])]);
  assert.equal(zup.up, "z"); assert.ok(zup.issues.some((i) => i.code === "axis"));
  // implausible size is an error, not a silent rescale
  assert.ok(analyze([mesh("x", "y", [0, 0, 0], [0.5, 0.5, 0.5])]).issues.some((i) => i.level === "error" && i.code === "scale"));
  // the template assigns nothing; a manual rule marks meshes "manual-unverified"
  const t = mappingTemplate(r, "demo.glb");
  assert.ok(t.rules.every((x) => x.role === null));
  assert.equal(applyMapping(mm, t).unclassified, 2);
  const m = applyMapping(mm, { rules: [{ by: "material", match: "^Glass$", role: "window-glass" }, { by: "name", match: "(", role: "wall" }] });
  assert.deepEqual(m.meshes.map((x) => [x.role, x.status]), [[null, "unclassified"], ["window-glass", "manual-unverified"]]);
  assert.equal(m.problems.length, 1);
});

test("licensed models and PBR sets are present, credited and match the manifest dimensions", async () => {
  const { existsSync } = await import("node:fs");
  const units = new URL("../landing/units/", import.meta.url), credits = JSON.parse(readFileSync(new URL("assets/CREDITS.json", units), "utf8"));
  for (const a of MAN.assets.filter((x) => x.model || x.composite)) {
    const file = a.model?.file ?? a.composite.chairs.model, key = a.credit;
    assert.ok(existsSync(new URL(file, units)), `${a.id}: ${file} missing`);
    const c = credits.models[key]; assert.ok(c, `${a.id}: no CREDITS entry ${key}`);
    assert.ok(/CC0|CC-BY/.test(c.license), `${a.id}: license ${c.license}`);
    if (/BY/.test(c.license)) assert.ok(c.attribution_required && c.authors.length, `${a.id}: attribution missing`);
    if (a.model) {
      const quarter = Math.abs(Math.sin(a.model.rotY ?? 0)) > 0.5, w = quarter ? c.size_m.z : c.size_m.x, d = quarter ? c.size_m.x : c.size_m.z;
      for (const [got, want, k] of [[w, a.dims.w, "w"], [d, a.dims.d, "d"], [c.size_m.y, a.dims.h, "h"]]) assert.ok(Math.abs(got / want - 1) <= 0.03, `${a.id}: ${k} ${got} vs manifest ${want}`);
    }
  }
  for (const [id, m] of Object.entries(MAN.materials).filter(([k]) => k !== "note")) {
    for (const map of ["diff", "nor", "rough"]) assert.ok(existsSync(new URL(`assets/materials/${id}/${map}.webp`, units)), `${id}/${map}`);
    assert.ok(credits.materials[id] && Math.abs(credits.materials[id].size_m[0] - m.size) < 0.01, `${id}: size ${m.size} vs source`);
  }
});
