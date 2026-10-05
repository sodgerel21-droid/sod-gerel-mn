/* Saved interior configurations and the editing history.
 *
 * A configuration belongs to an apartment type (plan id + revision), not to one unit, so every
 * unit of the type reuses it; the unit's own facts (price, status, floor) stay in units.json.
 * It is stored apart from the architectural plan and never changes it. When the plan revision
 * changes, an old configuration is not applied silently — restore() reports it as stale.
 */
import { assetById, validatePlacements, ctxFor, placementProblems } from "./furnish.js";
import { geometryKey } from "./plan-geometry.js";

export const CONFIG_SCHEMA = "e-property.interior-config";

export const configKey = (plan) => `ep-interior:${plan.id}@${plan.revision}`;

export function serialize(plan, state) {
  return JSON.stringify({
    schema: CONFIG_SCHEMA, version: 1,
    plan: { id: plan.id, revision: plan.revision, geometry: geometryKey(plan) },
    style: state.style, savedAt: state.savedAt ?? null,
    placements: state.placements.map(({ id, asset, room, x, y, rot, variant, parent, width, top }) => ({ id, asset, room, x, y, rot, ...(variant ? { variant } : {}), ...(parent ? { parent } : {}), ...(width ? { width } : {}), ...(top ? { top } : {}) })),
  });
}

/** Parse and check a saved configuration against the current plan. */
export function restore(plan, manifest, text) {
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, reason: "Хадгалсан тохиргоо уншигдсангүй" }; }
  if (data?.schema !== CONFIG_SCHEMA || data.version !== 1) return { ok: false, reason: "Тохиргооны хувилбар дэмжигдэхгүй" };
  if (data.plan?.id !== plan.id || data.plan?.revision !== plan.revision || data.plan?.geometry !== geometryKey(plan))
    return { ok: false, stale: true, reason: "Төлөвлөлт шинэчлэгдсэн тул өмнөх тавилгын тохиргоог ашиглахгүй" };
  const A = assetById(manifest);
  const known = data.placements.filter((p) => A.has(p.asset));
  const checks = validatePlacements(plan, manifest, known, { walk: false });
  const bad = new Set(checks.filter((c) => c.problems.length).map((c) => c.id));
  return {
    ok: true, style: data.style, savedAt: data.savedAt,
    placements: known.filter((p) => !bad.has(p.id)),
    dropped: [...data.placements.filter((p) => !A.has(p.asset)).map((p) => ({ id: p.id, reason: `${p.asset} manifest-д алга` })),
      ...checks.filter((c) => c.problems.length).map((c) => ({ id: c.id, reason: c.problems[0].message }))],
  };
}

/**
 * Editing session with undo/redo. Every operation is validated; an invalid result is rejected
 * and returned with its problems, and the state stays as it was.
 */
export function createEditor(plan, manifest, initial, opts = {}) {
  const ctx = ctxFor(plan, manifest, opts);
  const clone = (list) => list.map((p) => ({ ...p }));
  const base = clone(initial);
  let current = clone(initial), undoStack = [], redoStack = [];
  const commit = (next) => { undoStack.push(current); if (undoStack.length > 50) undoStack.shift(); redoStack = []; current = next; return { ok: true, placements: current }; };
  const check = (next, id, walk = true) => {
    const p = next.find((x) => x.id === id);
    const problems = p ? placementProblems(ctx, p, next, { walk }) : [];
    return problems.length ? { ok: false, problems } : null;
  };
  const withMoved = (id, patch) => current.map((p) => {
    if (p.id === id) return { ...p, ...patch };
    // children (nightstands, coffee table, rug) follow their parent rigidly
    const parent = current.find((x) => x.id === id);
    if (p.parent === id && parent && (patch.x != null || patch.rot != null)) {
      const dr = (patch.rot ?? parent.rot) - parent.rot, ox = p.x - parent.x, oy = p.y - parent.y;
      const nx = (patch.x ?? parent.x) + ox * Math.cos(dr) - oy * Math.sin(dr), ny = (patch.y ?? parent.y) + ox * Math.sin(dr) + oy * Math.cos(dr);
      return { ...p, x: nx, y: ny, rot: p.rot + dr };
    }
    return p;
  });
  return {
    get placements() { return current; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    problemsOf(id) { const p = current.find((x) => x.id === id); return p ? placementProblems(ctx, p, current) : []; },
    /** Move/rotate one item (and its children). Rejected when the result breaks a rule. */
    transform(id, patch, { dryRun = false, walk = true } = {}) {
      const next = withMoved(id, patch);
      const bad = [id, ...next.filter((p) => p.parent === id).map((p) => p.id)].map((k) => check(next, k, walk)).find(Boolean);
      if (bad) return bad;
      return dryRun ? { ok: true, placements: next } : commit(next);
    },
    remove(id) { return commit(current.filter((p) => p.id !== id && p.parent !== id)); },
    /** Replace with another asset of the same category (only those the manifest lists). */
    replace(id, assetId) {
      const p = current.find((x) => x.id === id), a = ctx.A.get(assetId), old = p && ctx.A.get(p.asset);
      if (!p || !a || a.category !== old.category) return { ok: false, problems: [{ code: "replace", message: "Энэ ангиллын тавилгаар л солино" }] };
      const next = current.map((x) => (x.id === id ? { ...x, asset: assetId } : x));
      return check(next, id) ?? commit(next);
    },
    setVariant(id, variant) {
      const p = current.find((x) => x.id === id), a = p && ctx.A.get(p.asset);
      if (!a?.variants?.includes(variant)) return { ok: false, problems: [{ code: "variant", message: "Дэмжигдээгүй материал" }] };
      return commit(current.map((x) => (x.id === id ? { ...x, variant } : x)));
    },
    undo() { if (!undoStack.length) return false; redoStack.push(current); current = undoStack.pop(); return true; },
    redo() { if (!redoStack.length) return false; undoStack.push(current); current = redoStack.pop(); return true; },
    reset() { return commit(clone(base)); },
    load(list) { undoStack = []; redoStack = []; current = clone(list); },
  };
}
