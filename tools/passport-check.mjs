// Every demo unit without a structured plan gets a sane inferred room split from
// landing/units/lib/legacy-layout.js: rooms inside the outline, positive and non-overlapping, the
// right number of bedrooms, an entrance, an interior area a little under the outline's, and a
// plan that passes the schema validation it is shown with (status "inferred").
//   node tools/passport-check.mjs
import { readFileSync } from "node:fs";
import { buildGeometry, area, inferPlan } from "../landing/units/lib/legacy-layout.js";
import { validatePlan } from "../landing/units/lib/plan-geometry.js";
const data = "landing/3d/data";
let units = 0;
for (const p of JSON.parse(readFileSync(`${data}/projects.json`, "utf8"))) {
  for (const u of JSON.parse(readFileSync(`${data}/${p.slug}/units.json`, "utf8"))) {
    const G = buildGeometry(u), id = `${p.slug}/${u.unit_id}`;
    const fail = (m) => { throw new Error(`${id}: ${m}`); };
    for (const r of G.rooms) {
      if (!(r.r[2] - r.r[0] > 0.8 && r.r[3] - r.r[1] > 0.8)) fail(`room ${r.no} ${r.name} too small ${r.r}`);
      if (r.r[0] < 0 || r.r[1] < 0 || r.r[2] > G.W || r.r[3] > G.H) fail(`room ${r.no} outside the outline`);
    }
    for (let i = 0; i < G.rooms.length; i++) for (let j = i + 1; j < G.rooms.length; j++) {
      const a = G.rooms[i].r, b = G.rooms[j].r;
      if (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1e-6 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1e-6) fail(`rooms ${i + 1} and ${j + 1} overlap`);
    }
    const beds = G.rooms.filter((r) => r.kind === "bed").length;
    if (beds !== Math.max(0, u.rooms - 1)) fail(`${beds} bedrooms for ${u.rooms} rooms`);
    if (!G.walls.some((w) => w.op.some((o) => o.main))) fail("no entrance");
    const inner = G.rooms.reduce((s, r) => s + area(r.r), 0);
    if (!(inner < u.area_measured && inner > u.area_measured * 0.8)) fail(`interior ${inner.toFixed(1)} vs outline ${u.area_measured}`);
    const v = validatePlan(inferPlan(u, p));
    if (!v.ok) fail(`inferred plan invalid: ${v.diagnostics.filter((d) => d.level === "error").map((d) => d.message).join("; ")}`);
    units++;
  }
}
console.log(`passport geometry ok for ${units} units`);
