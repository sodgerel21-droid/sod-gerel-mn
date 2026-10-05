/* Which plan a unit uses. A structured plan listed in <project>/plans/index.json wins when its
 * boundary matches the unit outline from plan.dxf; otherwise the unit gets the inferred split,
 * clearly labelled. A structured plan that fails validation is reported, never patched up.
 */
import { validatePlan, dist } from "./plan-geometry.js";
import { inferPlan } from "./legacy-layout.js";

const sameOutline = (a, b, tol = 0.001) => {
  if (a.length !== b.length) return false;
  for (let shift = 0; shift < b.length; shift++) if (a.every((p, i) => dist(p, b[(i + shift) % b.length]) <= tol)) return true;
  return false;
};

/** Match rule for an index entry: { suffix: "01" } or { units: ["B-0301", …] }. */
export function matches(entry, unitId) {
  if (entry.match?.units) return entry.match.units.includes(unitId);
  if (entry.match?.suffix) return unitId.slice(-entry.match.suffix.length) === entry.match.suffix;
  return false;
}

export async function resolvePlan(project, unit, dataUrl, fetchJson = (u) => fetch(u).then((r) => (r.ok ? r.json() : null))) {
  const notes = [];
  let index = null;
  try { index = await fetchJson(dataUrl("plans/index.json")); } catch { /* no structured plans for this project */ }
  const entry = index?.plans?.find((e) => matches(e, unit.unit_id));
  if (entry) {
    const plan = await fetchJson(dataUrl(`plans/${entry.file}`));
    if (!plan) notes.push({ level: "error", code: "plan-missing", message: `plans/${entry.file} ачаалсангүй` });
    else {
      const v = validatePlan(plan);
      if (!v.ok) notes.push({ level: "error", code: "plan-invalid", message: `${plan.id}: төлөвлөлт алдаатай тул ашиглахгүй`, details: v.diagnostics });
      else if (!sameOutline(plan.boundary, unit.floor_polygon)) notes.push({ level: "error", code: "plan-outline", message: `${plan.id}: хил нь нэгжийн plan.dxf хилтэй таарахгүй тул ашиглахгүй` });
      else return { plan, validation: v, kind: "structured", entry, notes };
    }
  }
  const plan = inferPlan(unit, project);
  return { plan, validation: validatePlan(plan), kind: "inferred", entry: null, notes };
}
