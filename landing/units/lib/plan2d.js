/* Technical 2D plan (SVG) from the same shell pieces as the 3D viewer. Plan y is up; the SVG
 * flips it once in P(), so text stays upright. Numbers are rounded only here, for display.
 */
import { shellPieces } from "./shell.js";
import { bounds, polygonArea, pointInPolygon, edges, segmentDistance, fmtM, fmtMM, dist, add, mul, sub, len } from "./plan-geometry.js";
import { footprint, assetById } from "./furnish.js";

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent?.appendChild(e); return e; };
const P = (p) => `${p[0]},${-p[1]}`;
const pts = (poly) => poly.map(P).join(" ");

function labelPoint(poly) {
  const b = bounds(poly); let best = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], bd = -1;
  for (let x = b.minX; x <= b.maxX; x += 0.1) for (let y = b.minY; y <= b.maxY; y += 0.1) {
    if (pointInPolygon([x, y], poly) !== 1) continue;
    const d = Math.min(...edges(poly).map(([p, q]) => segmentDistance([x, y], p, q).d));
    if (d > bd) { bd = d; best = [x, y]; }
  }
  return best;
}

export function drawPlan(svg, plan, { onRoom, manifest } = {}) {
  svg.replaceChildren();
  const B = bounds(plan.boundary), pad = 1.9;
  svg.setAttribute("viewBox", `${B.minX - pad} ${-B.maxY - pad} ${B.maxX - B.minX + 2 * pad} ${B.maxY - B.minY + 2 * pad + 0.6}`);
  const gR = el("g", { class: "rooms" }, svg), gZ = el("g", {}, svg), gF = el("g", { class: "furn" }, svg), gW = el("g", {}, svg), gO = el("g", {}, svg), gD = el("g", {}, svg), gT = el("g", {}, svg), gM = el("g", {}, svg);
  const roomEls = new Map();
  for (const r of plan.rooms) {
    const p = el("polygon", { points: pts(r.polygon), class: `rm rm-${r.type}`, "data-room": r.id, tabindex: 0, role: "button", "aria-label": `${r.name}, ${fmtM(polygonArea(r.polygon))} м²` }, gR);
    p.addEventListener("click", () => onRoom?.(r.id));
    p.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRoom?.(r.id); } });
    roomEls.set(r.id, p);
    const c = labelPoint(r.polygon), narrow = Math.min(bounds(r.polygon).maxX - bounds(r.polygon).minX, bounds(r.polygon).maxY - bounds(r.polygon).minY) < 1.8;
    const t = el("text", { x: c[0], y: -c[1] - 0.06, class: "rn", "text-anchor": "middle" }, gT); t.textContent = r.name;
    if (narrow || r.name.length * 0.14 > bounds(r.polygon).maxX - bounds(r.polygon).minX) t.setAttribute("class", "rn sm");
    el("text", { x: c[0], y: -c[1] + 0.3, class: "ra", "text-anchor": "middle" }, gT).textContent = `${fmtM(polygonArea(r.polygon))} м²`;
  }
  for (const z of plan.fixed_zones ?? []) el("polygon", { points: pts(z.polygon), class: `zone zone-${z.type}` }, gZ);
  const { pieces, openings } = shellPieces(plan);
  // in plan the cut is at ~1.2 m: solid wall and window sills read as cut wall, lintels do not
  for (const p of pieces) if (p.kind === "solid") el("polygon", { points: pts(p.quad), class: "wall" }, gW);
  for (const o of openings) {
    const [a, b] = [o.a, o.b];
    if (o.opening.type === "window") {
      el("polygon", { points: pts(o.quad), class: "win-o" }, gO);
      el("line", { x1: a[0], y1: -a[1], x2: b[0], y2: -b[1], class: "win-l" }, gO);
    } else if (o.swing) {
      const s = o.swing, leaf = add(s.hinge, mul(s.side, s.radius));
      el("line", { x1: s.hinge[0], y1: -s.hinge[1], x2: leaf[0], y2: -leaf[1], class: o.opening.type === "entrance" ? "door main" : "door" }, gO);
      const cr = (leaf[0] - s.hinge[0]) * (s.free[1] - s.hinge[1]) - (leaf[1] - s.hinge[1]) * (s.free[0] - s.hinge[0]);
      el("path", { d: `M${leaf[0]} ${-leaf[1]} A${s.radius} ${s.radius} 0 0 ${cr > 0 ? 1 : 0} ${s.free[0]} ${-s.free[1]}`, class: "door-arc" }, gO);
    } else el("line", { x1: a[0], y1: -a[1], x2: b[0], y2: -b[1], class: "pass" }, gO);
  }
  // overall dimensions of the boundary, in millimetres
  const dimH = (x0, x1, y, txt) => { el("line", { x1: x0, y1: -y, x2: x1, y2: -y, class: "dl" }, gD); for (const x of [x0, x1]) el("line", { x1: x, y1: -y - 0.12, x2: x, y2: -y + 0.12, class: "dl" }, gD); el("text", { x: (x0 + x1) / 2, y: -y - 0.1, class: "dt", "text-anchor": "middle" }, gD).textContent = txt; };
  const dimV = (y0, y1, x, txt) => { el("line", { x1: x, y1: -y0, x2: x, y2: -y1, class: "dl" }, gD); for (const y of [y0, y1]) el("line", { x1: x - 0.12, y1: -y, x2: x + 0.12, y2: -y, class: "dl" }, gD); const cy = -(y0 + y1) / 2; el("text", { x: x - 0.1, y: cy, class: "dt", "text-anchor": "middle", transform: `rotate(-90 ${x - 0.1} ${cy})` }, gD).textContent = txt; };
  dimH(B.minX, B.maxX, B.maxY + 0.7, fmtMM(B.maxX - B.minX));
  dimV(B.minY, B.maxY, B.minX - 0.7, fmtMM(B.maxY - B.minY));
  // north arrow only when the source states it
  const na = el("g", { transform: `translate(${B.maxX + 0.9} ${-B.minY + 0.75})` }, gD);
  if (plan.north_deg != null) { const g = el("g", { transform: `rotate(${plan.north_deg})` }, na); el("path", { d: "M0 -0.45 L0.16 0.25 L0 0.12 L-0.16 0.25Z", class: "north" }, g); el("text", { x: 0, y: -0.55, class: "dt", "text-anchor": "middle" }, g).textContent = "Х"; }
  else el("text", { x: 0, y: 0, class: "dt", "text-anchor": "end" }, na).textContent = "Хойд зүг заагаагүй";

  const A = manifest ? assetById(manifest) : null;
  return {
    select(id) { roomEls.forEach((e, k) => e.classList.toggle("on", k === id)); },
    setPlacements(list, selected) {
      gF.replaceChildren();
      if (!A) return;
      for (const p of list) {
        const a = A.get(p.asset); if (!a || a.layer) continue;
        el("polygon", { points: pts(footprint(p, a)), class: `fp${p.id === selected ? " on" : ""}` }, gF);
      }
    },
    measure: measureTool(svg, plan, pieces, openings, gM),
  };
}

/* Measuring: snaps to wall corners, opening edges and room vertices. */
function measureTool(svg, plan, pieces, openings, layer) {
  const snapPts = [...pieces.flatMap((p) => p.quad), ...openings.flatMap((o) => [o.a, o.b]), ...plan.rooms.flatMap((r) => r.polygon)];
  let on = false, first = null, onHint = () => {};
  const at = (ev) => {
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse()), p = [q.x, -q.y];
    let best = null, bd = 0.25; for (const s of snapPts) { const d = dist(s, p); if (d < bd) { bd = d; best = s; } }
    return best ?? p;
  };
  svg.addEventListener("click", (ev) => {
    if (!on) return;
    const p = at(ev);
    if (!first) { layer.replaceChildren(); first = p; el("circle", { cx: p[0], cy: -p[1], r: 0.07, class: "mp" }, layer); onHint("Хоёр дахь цэгээ сонгоно уу"); return; }
    el("line", { x1: first[0], y1: -first[1], x2: p[0], y2: -p[1], class: "ms" }, layer); el("circle", { cx: p[0], cy: -p[1], r: 0.07, class: "mp" }, layer);
    const m = mul(add(first, p), 0.5);
    el("text", { x: m[0] + 0.1, y: -m[1] - 0.12, class: "mt" }, layer).textContent = `${fmtMM(len(sub(p, first)))} мм`;
    first = null; onHint("Дахин хэмжих бол эхний цэгээ дарна уу. Булан, нүхний ирмэгт наалдана.");
  });
  return {
    get on() { return on; },
    toggle(hint) { on = !on; first = null; onHint = hint ?? onHint; if (!on) layer.replaceChildren(); return on; },
  };
}
