#!/usr/bin/env node
/* Downloads the licensed furniture models and PBR material sets used by the apartment viewer,
 * normalises them for the web and records where each came from.
 *
 *   cd tools/assets && npm install && node fetch-assets.mjs
 *
 * Output (committed): landing/units/assets/models/*.glb, landing/units/assets/materials/<set>/*.webp,
 * landing/units/assets/CREDITS.json. Sources: Poly Haven (CC0) and the Khronos glTF Sample Assets
 * (Wayfair models, CC-BY 4.0 — attribution required, see CREDITS.json and the viewer's credits).
 * Models are converted to binary glTF with WebP textures (EXT_texture_webp) at ≤ 1024 px; geometry
 * is not rescaled or reshaped — dimensions are measured and reported so the manifest can match them.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune, getBounds } from "@gltf-transform/functions";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../landing/units/assets");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); };
const json = async (url) => JSON.parse((await get(url)).toString());

/* model id in the manifest ← source */
const MODELS = [
  { id: "sofa-velvet", source: "khronos", name: "GlamVelvetSofa" },
  { id: "coffee-table-modern", source: "polyhaven", name: "modern_coffee_table_01" },
  { id: "media-cabinet-oak", source: "polyhaven", name: "modern_wooden_cabinet" },
  { id: "dining-chair", source: "polyhaven", name: "dining_chair_02" },
  { id: "side-table-oak", source: "polyhaven", name: "side_table_01" },
  { id: "pendant-light", source: "polyhaven", name: "modern_ceiling_lamp_01" },
  { id: "plant-floor", source: "polyhaven", name: "potted_plant_02" },
];
/* material set ← Poly Haven texture, with its real-world size in metres */
const MATERIALS = [
  { id: "oak-floor", name: "laminate_floor_02", res: "2k" },
  { id: "plaster-warm", name: "beige_wall_001", res: "1k" },
  { id: "stone-tile", name: "marble_01", res: "1k" },
  { id: "wall-tile", name: "long_white_tiles", res: "1k" },
  { id: "oak-veneer", name: "oak_veneer_02", res: "1k" },
  { id: "linen", name: "rough_linen", res: "1k" },
  { id: "wool", name: "poly_wool_herringbone", res: "1k" },
];

const credits = existsSync(join(ROOT, "CREDITS.json")) ? JSON.parse(readFileSync(join(ROOT, "CREDITS.json"), "utf8")) : { models: {}, materials: {} };

async function polyhavenModel(m) {
  const info = await json(`https://api.polyhaven.com/info/${m.name}`), files = await json(`https://api.polyhaven.com/files/${m.name}`);
  const g = files.gltf["1k"].gltf, tmp = join(ROOT, ".tmp", m.name);
  mkdirSync(join(tmp, "textures"), { recursive: true });
  writeFileSync(join(tmp, `${m.name}.gltf`), await get(g.url));
  for (const [rel, f] of Object.entries(g.include)) { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), await get(f.url)); }
  return { doc: await io.read(join(tmp, `${m.name}.gltf`)), credit: { source: `https://polyhaven.com/a/${m.name}`, license: "CC0-1.0", authors: Object.keys(info.authors ?? {}), attribution_required: false } };
}
async function khronosModel(m) {
  const base = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/${m.name}`;
  const meta = await json(`${base}/metadata.json`), buf = await get(`${base}/glTF-Binary/${m.name}.glb`);
  const legal = meta.legal ?? [];
  return { doc: await io.readBinary(buf), credit: { source: `https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/${m.name}`, license: legal.map((l) => l.spdx).join(" + "), authors: legal.map((l) => `${l.artist} / ${l.owner} (${l.year}, ${l.what})`), attribution_required: legal.some((l) => /BY/.test(l.spdx)) } };
}

mkdirSync(join(ROOT, "models"), { recursive: true });
for (const m of MODELS) {
  process.stdout.write(`${m.id} ← ${m.name} … `);
  const { doc, credit } = m.source === "khronos" ? await khronosModel(m) : await polyhavenModel(m);
  // the source scene may carry its own lights (KHR_lights_punctual); the viewer lights the apartment
  doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === "KHR_lights_punctual")?.dispose();
  await doc.transform(dedup(), prune());
  // textures → 8-bit WebP ≤ 1024 px (sharp directly: some sources are 16-bit PNG)
  doc.createExtension(EXTTextureWebP).setRequired(true);
  for (const tex of doc.getRoot().listTextures()) {
    const raw = await sharp(Buffer.from(tex.getImage())).raw().toBuffer({ resolveWithObject: true }); // decode first: libvips on Windows fails resizing some PNGs in one pipeline
    const img = await sharp(raw.data, { raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels } }).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    tex.setImage(new Uint8Array(img)).setMimeType("image/webp").setURI(tex.getURI().replace(/.(png|jpe?g)$/i, ".webp"));
  }
  const b = getBounds(doc.getRoot().getDefaultScene()), size = b.max.map((v, k) => +(v - b.min[k]).toFixed(4));
  const out = join(ROOT, "models", `${m.id}.glb`);
  await io.write(out, doc);
  const bytes = readFileSync(out).length;
  credits.models[m.id] = { ...credit, file: `models/${m.id}.glb`, original: m.name, size_m: { x: size[0], y: size[1], z: size[2] }, min_m: b.min.map((v) => +v.toFixed(4)), up: "+Y (glTF)", bytes, optimisation: "dedup, prune, textures → WebP ≤1024 px (q82)" };
  console.log(`${size.join(" × ")} m, ${(bytes / 1024).toFixed(0)} KB`);
}

for (const t of MATERIALS) {
  process.stdout.write(`${t.id} ← ${t.name} … `);
  const info = await json(`https://api.polyhaven.com/info/${t.name}`), files = await json(`https://api.polyhaven.com/files/${t.name}`);
  const dir = join(ROOT, "materials", t.id); mkdirSync(dir, { recursive: true });
  const maps = { diff: files.Diffuse, nor: files.nor_gl, rough: files.Rough, ao: files.AO };
  const got = [];
  for (const [k, src] of Object.entries(maps)) {
    const url = src?.[t.res]?.jpg?.url ?? src?.[t.res]?.png?.url; if (!url) continue;
    await sharp(await get(url)).webp({ quality: k === "nor" ? 90 : 82 }).toFile(join(dir, `${k}.webp`)); got.push(k);
  }
  credits.materials[t.id] = { source: `https://polyhaven.com/a/${t.name}`, license: "CC0-1.0", authors: Object.keys(info.authors ?? {}), attribution_required: false, size_m: (info.dimensions ?? []).map((v) => v / 1000), maps: got, resolution: t.res, colour_space: { diff: "sRGB", nor: "linear (OpenGL +Y)", rough: "linear", ao: "linear" } };
  console.log(`${got.join(", ")} · ${credits.materials[t.id].size_m.join(" × ")} m`);
}
writeFileSync(join(ROOT, "CREDITS.json"), JSON.stringify(credits, null, 1) + "\n");
console.log("CREDITS.json written");
