/* Development substitutes for furniture whose licensed GLB is not in the repository yet.
 *
 * Built to the manifest's exact dimensions with believable proportions (rounded edges, cushions,
 * bedding, legs), never stretched. Every group is tagged userData.substitute = true and the UI
 * labels them "орлуулагч загвар". Asset frame: width along X, depth along Z, front towards −Z,
 * back (the wall side) at +Z, origin at the footprint centre on the floor.
 */
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export function createSubstituteFactory(THREE, M) {
  const geos = [];
  const keep = (g) => { geos.push(g); return g; };
  const rbox = (w, h, d, r, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(keep(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) - 1e-4)), mat);
    m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; return m;
  };
  const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; return m;
  };
  const cyl = (rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 24) => {
    const m = new THREE.Mesh(keep(new THREE.CylinderGeometry(rt, rb, h, seg)), mat);
    m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; return m;
  };
  const legs = (g, w, d, h, inset, r, mat) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(r, r * 0.8, h, mat, sx * (w / 2 - inset), 0, sz * (d / 2 - inset), 12)); };
  const groove = (g, x, y, z, w, h) => g.add(box(w, h, 0.004, M.dark, x, y, z));

  const B = {
    bed(a) {
      const g = new THREE.Group(), { w, d, h } = a.dims, head = 0.09, L = d - head, cz = -head / 2;
      const frameH = 0.26, matt = 0.24, top = frameH + matt;
      g.add(rbox(w, frameH - 0.06, L, 0.025, M.fabric2, 0, 0.06, cz));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(0.025, 0.02, 0.06, M.oak, sx * (w / 2 - 0.08), 0, cz + sz * (L / 2 - 0.08), 12));
      g.add(rbox(w - 0.06, matt, L - 0.04, 0.07, M.linen, 0, frameH, cz));
      // upholstered headboard with three soft vertical panels
      g.add(rbox(w, 0.28, head, 0.02, M.fabric2, 0, frameH - 0.02, d / 2 - head / 2));
      for (let i = 0; i < 3; i++) g.add(rbox(w / 3 - 0.012, h - 0.26, head, 0.035, M.fabric2, -w / 3 + (w / 3) * i, 0.26, d / 2 - head / 2));
      // duvet: a draped sheet — flat over the mattress, falling over both sides and the foot
      const dw = w + 0.04, dl = L * 0.74, drop = 0.3, seg = 48;
      const geo = keep(new THREE.PlaneGeometry(dw + 2 * drop, dl + drop, seg, seg)), pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), along = pos.getY(i) + (dl + drop) / 2;            // 0 at the foot edge
        const f1 = Math.min(Math.max(Math.abs(x) - dw / 2, 0), drop), f2 = Math.min(Math.max(drop - along, 0), drop);
        const fall = Math.max(f1, f2), soft = Math.sin(x * 9 + along * 6) * 0.004 + (fall > 0 ? Math.sin((x + along) * 20) * 0.007 * (fall / drop) : 0);
        const X = Math.max(-dw / 2, Math.min(dw / 2, x)) + Math.sign(x) * 0.02 * (f1 / drop);
        const Z = cz - L / 2 + Math.max(along - drop, 0) - 0.02 * (f2 / drop);
        pos.setXYZ(i, X, top + 0.035 - fall * 0.95 + soft, Z);
      }
      // the plane's (x, y) became (x, z): reverse the winding so faces point up, not down
      const ix = geo.index; for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t); }
      geo.computeVertexNormals();
      const duvet = new THREE.Mesh(geo, M.linen); duvet.castShadow = duvet.receiveShadow = true; g.add(duvet);
      g.add(rbox(w + 0.03, 0.028, 0.46, 0.012, M.fabric, 0, top + 0.03, cz - L / 2 + 0.36)); // folded throw at the foot
      const n = w > 1.3 ? 2 : 1, pw = n === 2 ? (w - 0.2) / 2 : w - 0.3;
      for (let i = 0; i < n; i++) {
        const pg = keep(new RoundedBoxGeometry(pw, 0.16, 0.42, 4, 0.07)), pp = pg.attributes.position;
        for (let k = 0; k < pp.count; k++) { const x = pp.getX(k) / (pw / 2), z = pp.getZ(k) / 0.21; pp.setY(k, pp.getY(k) * (1 - 0.35 * (x * x + z * z) / 2)); }
        pg.computeVertexNormals();
        const p = new THREE.Mesh(pg, M.linen); p.position.set(n === 2 ? (i - 0.5) * (pw + 0.04) : 0, top + 0.1, d / 2 - head - 0.28); p.rotation.x = -0.35; p.castShadow = p.receiveShadow = true; g.add(p);
      }
      return g;
    },
    nightstand(a, v) {
      const g = new THREE.Group(), { w, d, h } = a.dims, wood = M.byVariant(v, "oak");
      g.add(rbox(w, h - 0.12, d, 0.012, wood, 0, 0.12)); legs(g, w - 0.02, d - 0.02, 0.12, 0.03, 0.012, M.metal);
      groove(g, 0, h - 0.24, -d / 2 - 0.001, w - 0.04, 0.006);
      g.add(cyl(0.07, 0.09, 0.03, M.ceramic, 0.08, h, 0.03)); g.add(cyl(0.012, 0.012, 0.28, M.metal, 0.08, h + 0.03, 0.03, 8)); g.add(cyl(0.09, 0.12, 0.16, M.linen, 0.08, h + 0.25, 0.03));
      return g;
    },
    wardrobe(a, v) {
      const g = new THREE.Group(), { w, d, h } = a.dims, mat = M.front;
      g.add(rbox(w, h - 0.06, d, 0.006, mat, 0, 0.06)); g.add(box(w - 0.04, 0.06, d - 0.04, M.dark, 0, 0, 0.02));
      const doors = Math.max(2, Math.round(w / 0.6));
      for (let i = 1; i < doors; i++) groove(g, -w / 2 + (w * i) / doors, 0.06, -d / 2 - 0.001, 0.004, h - 0.06);
      for (let i = 0; i < doors; i++) g.add(box(0.012, 0.32, 0.02, M.handle, -w / 2 + (w * (i + 0.5)) / doors + (i % 2 ? -1 : 1) * (w / doors / 2 - 0.05), 1.0, -d / 2 - 0.012));
      return g;
    },
    sofa(a, v) {
      const g = new THREE.Group(), { w, d, h } = a.dims, fab = M.byVariant(v, "fabric"), arm = 0.16, seatH = 0.44;
      g.add(rbox(w, seatH - 0.18, d, 0.04, fab, 0, 0.12)); legs(g, w - 0.08, d - 0.1, 0.12, 0.04, 0.018, M.walnut);
      for (const s of [-1, 1]) g.add(rbox(arm, 0.62 - 0.12, d, 0.06, fab, s * (w / 2 - arm / 2), 0.12));
      const n = w > 1.9 ? 3 : 2, cw = (w - 2 * arm) / n;
      for (let i = 0; i < n; i++) {
        g.add(rbox(cw - 0.01, 0.14, d - 0.24, 0.05, fab, -w / 2 + arm + cw * (i + 0.5), seatH - 0.14, -0.1));
        const back = rbox(cw - 0.02, h - seatH + 0.02, 0.2, 0.07, fab, -w / 2 + arm + cw * (i + 0.5), seatH - 0.02, d / 2 - 0.14);
        back.rotation.x = -0.12; g.add(back);
      }
      g.add(rbox(0.4, 0.4, 0.12, 0.05, M.fabric2, -w / 2 + arm + 0.3, seatH, d / 2 - 0.33).rotateZ(0.12));
      return g;
    },
    "coffee-table"(a, v) {
      const g = new THREE.Group(), { w, d, h } = a.dims, wood = M.byVariant(v, "oak");
      g.add(rbox(w, 0.035, d, 0.012, wood, 0, h - 0.035)); g.add(rbox(w - 0.1, 0.02, d - 0.1, 0.008, wood, 0, 0.12));
      legs(g, w - 0.08, d - 0.08, h - 0.035, 0.03, 0.016, M.metal);
      g.add(rbox(0.28, 0.025, 0.2, 0.01, M.fabric2, 0.2, h, 0.02)); g.add(cyl(0.06, 0.05, 0.11, M.ceramic, -0.25, h, -0.05));
      return g;
    },
    media(a, v) {
      const g = new THREE.Group(), { w, d, h } = a.dims, wood = M.byVariant(v, "oak");
      g.add(rbox(w, h - 0.1, d, 0.012, wood, 0, 0.1)); legs(g, w - 0.04, d - 0.04, 0.1, 0.04, 0.012, M.metal);
      for (let i = 1; i < 3; i++) groove(g, -w / 2 + (w * i) / 3, 0.12, -d / 2 - 0.001, 0.004, h - 0.14);
      g.add(box(1.23, 0.71, 0.03, M.dark, 0, h + 0.08, 0.05)); g.add(box(0.3, 0.08, 0.18, M.dark, 0, h, 0.05));
      return g;
    },
    dining(a, v) {
      const g = new THREE.Group(), { w, d } = a.dims, wood = M.byVariant(v, "oak"), tw = Math.min(w, 1.4), td = Math.min(0.85, d - 0.9);
      g.add(rbox(tw, 0.035, td, 0.012, wood, 0, 0.74)); legs(g, tw - 0.1, td - 0.1, 0.74, 0.04, 0.022, wood);
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
        const c = new THREE.Group();
        c.add(rbox(0.44, 0.05, 0.44, 0.02, M.fabric, 0, 0.42, 0)); legs(c, 0.4, 0.4, 0.42, 0.03, 0.013, wood);
        c.add(rbox(0.42, 0.36, 0.04, 0.015, wood, 0, 0.5, 0.2));
        c.position.set(sx * tw * 0.24, 0, sz * (td / 2 + 0.12)); c.rotation.y = sz > 0 ? 0 : Math.PI; g.add(c);
      }
      return g;
    },
    kitchen(a, v) {
      const g = new THREE.Group(), { w, d, h } = a.dims, front = M.front;
      if (a.id === "kitchen-fridge") {
        g.add(rbox(w - 0.004, h, d, 0.008, front, 0)); groove(g, 0, 0.85, -d / 2 - 0.001, w - 0.02, 0.005);
        g.add(box(0.015, 0.5, 0.025, M.handle, w / 2 - 0.06, 1.1, -d / 2 - 0.012));
        return g;
      }
      g.add(box(w - 0.004, 0.1, d - 0.06, M.dark, 0, 0, 0.03)); // plinth
      g.add(rbox(w - 0.004, h - 0.13, d - 0.02, 0.006, front, 0, 0.1, 0.01));
      g.add(rbox(w + 0.002, 0.03, d + 0.02, 0.004, M.stone, 0, h - 0.03, 0)); // worktop
      g.add(box(w - 0.06, 0.012, 0.02, M.handle, 0, h - 0.12, -d / 2 - 0.006));
      g.add(rbox(w - 0.004, 0.7, 0.35, 0.006, front, 0, 1.45, d / 2 - 0.175)); // wall cabinet
      if (a.id === "kitchen-sink-80") { g.add(box(0.5, 0.004, 0.4, M.chrome, 0, h + 0.001, -0.02)); g.add(cyl(0.012, 0.015, 0.28, M.chrome, 0, h, 0.2, 12)); }
      if (a.id === "kitchen-hob-60") { g.add(box(0.56, 0.006, 0.5, M.dark, 0, h + 0.001, 0)); g.add(box(0.56, 0.3, 0.3, M.metal, 0, 1.25, d / 2 - 0.15)); }
      return g;
    },
    toilet() {
      const g = new THREE.Group();
      const prof = [[0.12, 0], [0.15, 0.06], [0.17, 0.2], [0.19, 0.33], [0.185, 0.38], [0.15, 0.385]].map(([r, y]) => new THREE.Vector2(r, y));
      const bowl = new THREE.Mesh(keep(new THREE.LatheGeometry(prof, 40)), M.ceramic); bowl.scale.z = 1.3; bowl.position.z = -0.08; bowl.castShadow = bowl.receiveShadow = true; g.add(bowl);
      g.add(rbox(0.38, 0.4, 0.17, 0.03, M.ceramic, 0, 0.38, 0.24)); g.add(rbox(0.36, 0.025, 0.46, 0.02, M.ceramic, 0, 0.38, -0.06));
      g.add(box(0.12, 0.02, 0.05, M.chrome, 0, 0.78, 0.24));
      return g;
    },
    vanity(a, v) {
      const g = new THREE.Group(), { w, d } = a.dims, wood = M.byVariant(v, "oak");
      g.add(rbox(w, 0.42, d - 0.02, 0.01, wood, 0, 0.4, 0.01)); groove(g, 0, 0.6, -d / 2 + 0.009, w - 0.04, 0.005);
      g.add(rbox(w, 0.04, d, 0.012, M.ceramic, 0, 0.82)); g.add(box(0.46, 0.005, 0.3, M.chrome, 0, 0.861, -0.02));
      g.add(cyl(0.012, 0.014, 0.2, M.chrome, 0, 0.86, d / 2 - 0.07, 12));
      g.add(box(w - 0.1, 0.8, 0.012, M.glass, 0, 1.1, d / 2 - 0.006));
      return g;
    },
    bath(a) {
      const g = new THREE.Group(), { w, d, h } = a.dims;
      if (a.id === "shower-90") {
        g.add(rbox(w, 0.04, d, 0.01, M.ceramic));
        const glass = box(w, h - 0.04, 0.008, M.glass, 0, 0.04, -d / 2 + 0.004); glass.castShadow = false; g.add(glass);
        g.add(box(0.02, h - 0.04, 0.02, M.chrome, -w / 2 + 0.01, 0.04, -d / 2 + 0.01));
        g.add(cyl(0.11, 0.11, 0.01, M.chrome, 0, h - 0.05, d / 2 - 0.25)); g.add(box(0.02, 0.02, 0.25, M.chrome, 0, h - 0.04, d / 2 - 0.125));
        return g;
      }
      g.add(rbox(w, h, d, 0.04, M.ceramic));
      const inner = rbox(w - 0.12, 0.02, d - 0.12, 0.08, M.lacquer, 0, h - 0.015); g.add(inner);
      g.add(cyl(0.015, 0.015, 0.16, M.chrome, w / 2 - 0.12, h, d / 2 - 0.05, 12));
      return g;
    },
    "hall-storage"(a, v) { return B.wardrobe(a, v); },
    storage(a, v) {
      const g = new THREE.Group(), { w, d, h } = a.dims, mat = M.byVariant(v, "lacquer");
      for (const s of [-1, 1]) g.add(box(0.02, h, d, mat, s * (w / 2 - 0.01)));
      for (let i = 0; i < 5; i++) g.add(box(w - 0.04, 0.02, d, mat, 0, 0.05 + i * (h - 0.1) / 4));
      for (let i = 0; i < 4; i++) g.add(rbox(0.3, 0.22, d - 0.08, 0.02, i % 2 ? M.fabric : M.linen, -w / 2 + 0.2 + (i % 3) * 0.3, 0.07 + i * (h - 0.1) / 4, 0));
      return g;
    },
    rug(a, v) { const { w, d } = a.dims, m = rbox(w, 0.012, d, 0.004, M.byVariant(v, "rug")); m.castShadow = false; const g = new THREE.Group(); g.add(m); return g; },
    light(a) {
      const g = new THREE.Group(), shade = cyl(a.dims.w / 2, a.dims.w / 2, 0.06, M.lamp, 0, -0.08, 0, 32);
      shade.castShadow = false; g.add(shade); g.add(cyl(0.006, 0.006, 0.08, M.metal, 0, -0.02, 0, 6)); g.userData.lamp = true; return g;
    },
    curtain(a, v, p) {
      const g = new THREE.Group(), width = p?.width ?? a.dims.w, top = p?.top ?? a.dims.h, hgt = top - 0.02, folds = Math.max(6, Math.round(width / 0.11));
      const geo = keep(new THREE.PlaneGeometry(width / 2 - 0.05, hgt, folds * 4, 1)), pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) / (width / 2)) * folds * Math.PI) * 0.035);
      geo.computeVertexNormals();
      for (const s of [-1, 1]) { const m = new THREE.Mesh(geo, M.curtain); m.position.set(s * (width / 4 + 0.025), 0.02 + hgt / 2, 0); m.castShadow = true; g.add(m); }
      g.add(cyl(0.012, 0.012, width + 0.1, M.metal, 0, 0, 0, 8).rotateZ(Math.PI / 2)).children.at(-1).position.set(0, top, 0);
      return g;
    },
  };
  const byCategory = { bed: B.bed, nightstand: B.nightstand, wardrobe: B.wardrobe, sofa: B.sofa, "coffee-table": B["coffee-table"], media: B.media, dining: B.dining, kitchen: B.kitchen, toilet: B.toilet, vanity: B.vanity, bath: B.bath, "hall-storage": B["hall-storage"], storage: B.storage, rug: B.rug, light: B.light, curtain: B.curtain };

  return {
    build(asset, variant, placement) {
      const fn = byCategory[asset.category];
      const g = fn ? fn(asset, variant ?? asset.variants?.[0], placement) : rbox(asset.dims.w, asset.dims.h, asset.dims.d, 0.02, M.lacquer);
      g.userData.substitute = true; g.userData.assetId = asset.id;
      return g;
    },
    dispose() { geos.forEach((g) => g.dispose()); geos.length = 0; },
  };
}
