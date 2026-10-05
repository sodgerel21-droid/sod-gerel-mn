#!/usr/bin/env node
/* Builds a deliberately "raw" apartment GLB to validate the existing-model workflow (/units/inspect.html):
 * the B-0301 demonstration plan exported the way a CAD/DCC tool often does it — centimetres, Z up,
 * generic node names (Mesh.001…) and generic materials (Material.001…), no semantic room data.
 * It is a test fixture made from our own demonstration plan, not a real apartment model.
 *
 *   cd tools/assets && node make-test-model.mjs
 */
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { shellPieces } from "../../landing/units/lib/shell.js";

const here = dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(readFileSync(join(here, "../../landing/3d/data/tuul-river/plans/type-01.plan.json"), "utf8"));
const CM = 100; // export unit
const doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene("Scene");
const mat = (name, rgba, rough = 0.8) => doc.createMaterial(name).setBaseColorFactor(rgba).setRoughnessFactor(rough).setMetallicFactor(0);
const M = { wall: mat("Material.001", [0.8, 0.8, 0.8, 1]), floor: mat("Material.002", [0.6, 0.6, 0.6, 1]), glass: mat("Material.003", [0.7, 0.8, 0.9, 0.4], 0.1), slab: mat("Material.004", [0.5, 0.5, 0.5, 1]) };
M.glass.setAlphaMode("BLEND");
let n = 0;
/** Prism over a plan polygon between heights z0..z1, Z-up, centimetres, with planar UVs in metres. */
function prism(poly, z0, z1, material) {
  const pos = [], uv = [], idx = [];
  const P = poly.map(([x, y]) => [x * CM, y * CM]);
  const quad = (a, b, c, d, uva) => { const k = pos.length / 3; pos.push(...a, ...b, ...c, ...d); uv.push(...uva); idx.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) / CM;
    quad([a[0], a[1], z0 * CM], [b[0], b[1], z0 * CM], [b[0], b[1], z1 * CM], [a[0], a[1], z1 * CM], [0, z0, L, z0, L, z1, 0, z1]);
  }
  // caps (fan; the inputs here are convex quads or simple room polygons)
  for (const [z, flip] of [[z1, false], [z0, true]]) for (let i = 1; i + 1 < P.length; i++) {
    const k = pos.length / 3, tri = [P[0], P[i], P[i + 1]];
    for (const p of tri) { pos.push(p[0], p[1], z * CM); uv.push(p[0] / CM, p[1] / CM); }
    idx.push(...(flip ? [k, k + 2, k + 1] : [k, k + 1, k + 2]));
  }
  const prim = doc.createPrimitive().setMaterial(material)
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(idx)).setBuffer(buf));
  scene.addChild(doc.createNode(`Mesh.${String(++n).padStart(3, "0")}`).setMesh(doc.createMesh().addPrimitive(prim)));
}
const { pieces, openings } = shellPieces(plan);
for (const p of pieces) prism(p.quad, p.z0, p.z1, M.wall);
for (const r of plan.rooms) prism(r.polygon, -0.02, 0, M.floor);
prism(plan.boundary, -0.25, -0.02, M.slab);
for (const o of openings.filter((x) => x.opening.type === "window")) {
  const [a, b] = [o.a, o.b], t = 0.01, nx = -(b[1] - a[1]), ny = b[0] - a[0], L = Math.hypot(nx, ny), d = [nx / L * t, ny / L * t];
  prism([[a[0] - d[0], a[1] - d[1]], [b[0] - d[0], b[1] - d[1]], [b[0] + d[0], b[1] + d[1]], [a[0] + d[0], a[1] + d[1]]], o.z0, o.z1, M.glass);
}
const out = join(here, "../../landing/units/assets/test/b0301-raw-cm-zup.glb");
mkdirSync(dirname(out), { recursive: true });
await new NodeIO().write(out, doc);
console.log(`${n} meshes → ${out}`);
