/* Inspection of an existing apartment model (GLB) before any enhancement — workflow B in
 * docs/apartment-plan.mn.md. Pure functions over a plain mesh list, so they run in Node too:
 *   { name, material, triangles, hasUV, hasNormals, min: [x,y,z], max: [x,y,z] } in model units.
 * Nothing here classifies a mesh as a wall or window by guessing; roles come only from an explicit
 * mapping, and every mapped role stays "manual, unverified" until someone signs it off.
 */
export const ROLES = ["wall", "floor", "ceiling", "window-glass", "window-frame", "door", "furniture", "fixture", "ignore"];
export const PRESETS = {
  wall: { label: "Будсан хана", color: "#EEEBE6", roughness: 0.92, metalness: 0 },
  floor: { label: "Шал (мод)", color: "#9A7655", roughness: 0.75, metalness: 0 },
  ceiling: { label: "Тааз", color: "#F7F6F3", roughness: 0.95, metalness: 0 },
  "window-glass": { label: "Шил", color: "#DDE7EA", roughness: 0.04, metalness: 0, opacity: 0.22 },
  "window-frame": { label: "Хөнгөн цагаан хүрээ", color: "#3A3D41", roughness: 0.38, metalness: 0.55 },
  door: { label: "Хаалга", color: "#F1EFEB", roughness: 0.42, metalness: 0 },
  furniture: { label: "Тавилга (эх материал хадгална)", keep: true },
  fixture: { label: "Сантехник", color: "#F7F7F5", roughness: 0.12, metalness: 0 },
  ignore: { label: "Нуух", hide: true },
};

/** Scale, axes and data problems of a mesh list. */
export function analyze(meshes) {
  const issues = [], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], m.min[k]); max[k] = Math.max(max[k], m.max[k]); }
  const size = max.map((v, k) => v - min[k]);
  // an apartment is roughly 4–40 m across and 2.3–4 m high
  const span = Math.max(size[0], size[2], size[1]);
  const guesses = [["m", 1], ["cm", 0.01], ["mm", 0.001], ["in", 0.0254]].map(([u, k]) => ({ unit: u, k, span: span * k }));
  const plausible = guesses.filter((g) => g.span >= 3 && g.span <= 60);
  const unit = plausible[0] ?? null;
  if (!unit) issues.push({ level: "error", code: "scale", message: `Загварын хэмжээ ${span.toFixed(2)} нэгж — метр, см, мм, инчийн аль нь ч орон сууцанд тохирохгүй. Масштабыг гараар заана уу.` });
  else if (unit.unit !== "m") issues.push({ level: "warning", code: "scale", message: `Хэмжээ ${span.toFixed(1)} — ${unit.unit} гэж үзвэл ${unit.span.toFixed(1)} м болно. Баталгаажуулна уу.` });
  // glTF is Y-up; a model whose smallest extent is not Y probably came in Z-up
  const k = unit?.k ?? 1, hY = size[1] * k, hZ = size[2] * k;
  let up = "y";
  if (hY > 6 && hZ >= 2 && hZ <= 4.5) { up = "z"; issues.push({ level: "warning", code: "axis", message: `Өндөр Y дагуу ${hY.toFixed(1)} м, Z дагуу ${hZ.toFixed(1)} м — Z-up эх файл байж магадгүй. Тэнхлэгийг шалгана уу.` }); }
  const noUV = meshes.filter((m) => !m.hasUV), unnamed = meshes.filter((m) => !m.name || /^(mesh|object|node|geometry|cube|plane)?[._\s-]*\d*$/i.test(m.name));
  if (noUV.length) issues.push({ level: "warning", code: "uv", message: `${noUV.length} mesh-д UV алга — texture-тэй материал зөв харагдахгүй (жишээ: ${noUV.slice(0, 3).map((m) => m.name || "нэргүй").join(", ")})` });
  if (unnamed.length) issues.push({ level: "warning", code: "names", message: `${unnamed.length} mesh утгагүй нэртэй — хана/цонх гэж ялгахын тулд гараар mapping хийнэ` });
  const tris = meshes.reduce((s, m) => s + m.triangles, 0);
  if (tris > 1_500_000) issues.push({ level: "warning", code: "triangles", message: `${tris.toLocaleString()} гурвалжин — гар утсанд хүнд. LOD эсвэл decimation хэрэгтэй.` });
  const materials = [...new Set(meshes.map((m) => m.material ?? "—"))];
  return { size, unit, up, triangles: tris, meshes: meshes.length, materials, issues };
}

/** Apply an explicit mapping { rules: [{ match: "regex", by: "name"|"material", role }] }. */
export function applyMapping(meshes, mapping) {
  const rules = (mapping?.rules ?? []).map((r) => {
    let re = null; try { re = new RegExp(r.match, "i"); } catch { /* reported below */ }
    return { ...r, re };
  });
  const bad = rules.filter((r) => r.role != null && (!r.re || !ROLES.includes(r.role))); // role: null = not assigned yet
  const out = meshes.map((m) => {
    const rule = rules.find((r) => r.re && ROLES.includes(r.role) && r.re.test(r.by === "material" ? m.material ?? "" : m.name ?? ""));
    return { name: m.name, material: m.material, role: rule?.role ?? null, status: rule ? "manual-unverified" : "unclassified" };
  });
  return {
    meshes: out,
    unclassified: out.filter((m) => !m.role).length,
    problems: bad.map((r) => `Буруу дүрэм: ${JSON.stringify({ match: r.match, role: r.role })}`),
  };
}

/** A starting mapping that lists every material, all unassigned — for a person to fill in. */
export const mappingTemplate = (report, source) => ({
  schema: "e-property.model-mapping", version: 1, source,
  note: "role-ийг гараар сонгоно: " + ROLES.join(", ") + ". Таамаглалаар бөглөхгүй.",
  scale: report.unit?.k ?? null, up: report.up,
  rules: report.materials.map((m) => ({ by: "material", match: `^${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, role: null })),
});
