/* Apartment viewer: architectural shell from the shared plan, furniture from the asset manifest.
 *
 * three.js 0.170 (same version as /3d/) through the page's import map. Plan (x, y) maps to world
 * (x, 0, −y); plan rotation rot maps to rotation.y = rot. Renders on demand (controls, edits,
 * resize) and stops while hidden or off screen. Everything it creates is disposed in dispose().
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { shellPieces } from "./shell.js";
import { createMaterials, createTextureCache, STYLES } from "./materials.js";
import { createSubstituteFactory } from "./substitutes.js";
import { assetById } from "./furnish.js";
import { centroid, bounds, pointInPolygon, polygonArea, wallFrame, dot, sub, mul, add, len, edges } from "./plan-geometry.js";

const W = (p, y = 0) => new THREE.Vector3(p[0], y, -p[1]);
const glbCache = new Map(); // url → Promise<gltf> (scenes are cloned per use, the cache keeps the source)

export function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export function createViewer(container, { plan, manifest, onRoomPick, onItemPick, onStats, assetBase = new URL("./", location.href).href, quality: q0 } = {}) {
  RectAreaLightUniformsLib.init();
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  let pixelRatio = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.domElement.className = "v3d";
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.09; controls.screenSpacePanning = true;
  // one finger scrolls the page on phones; two fingers rotate/zoom the model
  controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };

  const hemi = new THREE.HemisphereLight(0xffffff, 0xc9c2b8, 0.35); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1e0, 2.6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 4; sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const textures = createTextureCache(THREE, new URL("assets/materials/", assetBase).href, renderer.capabilities.getMaxAnisotropy());
  // contact shading (GTAO) in the "high" quality mode; "low" renders directly
  let quality = q0 ?? (matchMedia("(pointer: coarse)").matches ? "low" : "high");
  const composer = new EffectComposer(renderer), gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1.4, thickness: 1, scale: 1.1, samples: 12 });
  gtao.blendIntensity = 0.85;
  composer.addPass(new RenderPass(scene, camera)); composer.addPass(gtao); composer.addPass(new OutputPass());
  let windowLights = [];

  const A = assetById(manifest);
  const B = bounds(plan.boundary), C = [(B.minX + B.maxX) / 2, (B.minY + B.maxY) / 2], SPAN = Math.max(B.maxX - B.minX, B.maxY - B.minY);
  const apartmentCentre = centroid(plan.boundary);
  const state = { style: "modern", light: "day", view: "dollhouse", room: null, furnished: false, placements: [], selected: null, invalid: false };

  let M = null, factory = null, shell = new THREE.Group(), furniture = new THREE.Group(), lamps = [], wallMeshes = [], floorMeshes = [], ceilings = [], highlight = null, selBox = null;
  scene.add(shell, furniture);

  /* ───────── shell ───────── */
  function buildShell() {
    disposeGroup(shell); shell.clear(); wallMeshes = []; floorMeshes = []; ceilings = [];
    const { pieces, openings } = shellPieces(plan);
    const outward = (wall) => { const { n } = wallFrame(wall), mid = mul(add(wall.a, wall.b), 0.5); return dot(n, sub(mid, apartmentCentre)) >= 0 ? n : mul(n, -1); };
    for (const p of pieces) {
      const wall = plan.walls.find((w) => w.id === p.wall);
      const mesh = prismMesh(p.quad, p.z0, p.z1, [M.wall, M.cut]);
      mesh.userData = { wall: wall.id, piece: p, outward: outward(wall), mid: mul(add(wall.a, wall.b), 0.5), z0: p.z0, z1: p.z1 };
      shell.add(mesh); wallMeshes.push(mesh);
    }
    // slab under the apartment, floors per room (UVs in plan metres → real texture scale)
    const slab = new THREE.Mesh(shapeGeo(plan.boundary), M.slab); slab.rotation.x = -Math.PI / 2; slab.position.y = -0.02; slab.receiveShadow = true; shell.add(slab);
    const slabEdge = prismMesh(plan.boundary, -0.25, -0.02, [M.slab, M.slab]); slabEdge.receiveShadow = true; shell.add(slabEdge);
    for (const r of plan.rooms) {
      const mat = r.floor_finish === "tile" ? (["bathroom", "wc"].includes(r.type) ? M.floor.wet : M.floor.tile) : M.floor.wood;
      const f = new THREE.Mesh(shapeGeo(r.polygon), mat); f.rotation.x = -Math.PI / 2; f.position.y = 0.001; f.receiveShadow = true; f.userData.room = r.id;
      shell.add(f); floorMeshes.push(f);
      const c = new THREE.Mesh(shapeGeo(r.polygon), M.ceiling); c.rotation.x = -Math.PI / 2; c.position.y = plan.ceiling_height; c.visible = false; c.userData.ceiling = true;
      shell.add(c); ceilings.push(c);
      // skirting: thin strip along the room outline except across openings at floor level
      for (const [a, b] of edges(r.polygon)) {
        const L = len(sub(b, a)); if (L < 0.2) continue;
        const u = mul(sub(b, a), 1 / L), ccw = polygonArea(r.polygon) > 0 && signed(r.polygon) > 0, inward = ccw ? [-u[1], u[0]] : [u[1], -u[0]];
        const gaps = openings.filter((o) => o.z0 < 0.1 && segOnEdge(o, a, b)).map((o) => [dot(sub(o.a, a), u), dot(sub(o.b, a), u)].sort((x, y) => x - y));
        let s = 0;
        for (const [g0, g1] of [...gaps.sort((x, y) => x[0] - y[0]), [L, L]]) {
          if (g0 - s > 0.05) { const q = [add(a, mul(u, s)), add(a, mul(u, g0)), add(add(a, mul(u, g0)), mul(inward, 0.012)), add(add(a, mul(u, s)), mul(inward, 0.012))]; shell.add(prismMesh(q, 0, 0.07, [M.skirting, M.skirting])); }
          s = Math.max(s, g1);
        }
      }
      // wet-room wall tiles up to 2.1 m
      if (["bathroom", "wc"].includes(r.type)) for (const [a, b] of edges(r.polygon)) {
        const L = len(sub(b, a)), u = mul(sub(b, a), 1 / L), inward = signed(r.polygon) > 0 ? [-u[1], u[0]] : [u[1], -u[0]];
        const q = [a, b, add(b, mul(inward, 0.008)), add(a, mul(inward, 0.008))], m = prismMesh(q, 0.07, 2.1, [M.wallTile, M.wallTile]);
        m.userData.tileOf = r.id; shell.add(m);
      }
    }
    for (const o of openings) shell.add(openingMesh(o));
    applyCutaway();
  }
  const signed = (poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
  const segOnEdge = (o, a, b) => { const d = (p) => { const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab))); return len(sub(p, add(a, mul(ab, t)))); }; return d(o.a) < o.wall.thickness / 2 + 0.02 && d(o.b) < o.wall.thickness / 2 + 0.02; };

  function openingMesh(o) {
    const g = new THREE.Group(), { u, n } = wallFrame(o.wall), t = o.wall.thickness, wdt = o.e - o.s, mid = mul(add(o.a, o.b), 0.5);
    g.position.copy(W(mid)); g.rotation.y = Math.atan2(u[1], u[0]); // local x along the wall, local z across it (−n)
    const frame = (fw, fh, fd, x, y, z, mat = M.frame) => { const m = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, fd), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    const h = o.z1 - o.z0, f = 0.05;
    if (o.opening.type === "window") {
      frame(wdt, f, t * 0.5, 0, o.z0 + f / 2, 0); frame(wdt, f, t * 0.5, 0, o.z1 - f / 2, 0);
      frame(f, h, t * 0.5, -wdt / 2 + f / 2, o.z0 + h / 2, 0); frame(f, h, t * 0.5, wdt / 2 - f / 2, o.z0 + h / 2, 0);
      const mullions = Math.max(0, Math.round(wdt / 1.2) - 1);
      for (let i = 1; i <= mullions; i++) frame(0.04, h - 2 * f, 0.07, -wdt / 2 + (wdt * i) / (mullions + 1), o.z0 + h / 2, 0);
      const glass = frame(wdt - 2 * f, h - 2 * f, 0.012, 0, o.z0 + h / 2, 0, M.glass); glass.castShadow = false;
      frame(wdt + 0.04, 0.025, t * 0.5 + 0.06, 0, o.z0 - 0.0125, -0.03, M.stone); // inner sill
    } else {
      const lining = 0.035;
      frame(wdt, lining, t + 0.02, 0, o.z1 - lining / 2, 0, M.door); frame(lining, h, t + 0.02, -wdt / 2 + lining / 2, h / 2, 0, M.door); frame(lining, h, t + 0.02, wdt / 2 - lining / 2, h / 2, 0, M.door);
      if (o.swing) {
        // leaf drawn open 75° into its room, hinged where the plan says
        const leafW = wdt - 2 * lining, hingeX = (o.swing.hinge[0] === o.a[0] && o.swing.hinge[1] === o.a[1]) ? -wdt / 2 + lining : wdt / 2 - lining;
        const intoLocalZ = -dot(o.swing.side, n) >= 0 ? 1 : -1; // local +z is −n
        const pivot = new THREE.Group(); pivot.position.set(hingeX, 0, intoLocalZ * (t / 2));
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, h - lining, 0.04), o.opening.type === "entrance" ? M.entrance : M.door);
        leaf.position.set(hingeX < 0 ? leafW / 2 : -leafW / 2, (h - lining) / 2, 0); leaf.castShadow = leaf.receiveShadow = true;
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.06), M.handle); handle.position.set(hingeX < 0 ? leafW - 0.08 : -leafW + 0.08, 1.0, 0); leaf.add(handle);
        pivot.add(leaf); pivot.rotation.y = (hingeX < 0 ? -1 : 1) * intoLocalZ * (Math.PI * 75 / 180); g.add(pivot);
      }
    }
    g.userData.opening = o.opening.id; g.userData.wall = o.wall.id;
    return g;
  }

  /* cutaway: a presentation setting, the geometry keeps full height */
  function applyCutaway() {
    const camH = new THREE.Vector3().subVectors(camera.position, controls.target).setY(0).normalize(), camDir = [camH.x, -camH.z];
    const room = state.room && plan.rooms.find((r) => r.id === state.room), rc = room ? centroid(room.polygon) : apartmentCentre;
    const cutTo = state.view === "plan" ? 1.15 : state.view === "interior" ? null : 1.0;
    const cutWalls = new Set();
    for (const m of wallMeshes) {
      const { outward, mid, z0, z1 } = m.userData;
      let cut = null;
      if (state.view === "plan") cut = cutTo;
      else if (state.view === "dollhouse") cut = dot(outward, camDir) > 0.3 ? cutTo : null;
      else if (state.view === "room") cut = dot(sub(mid, rc), camDir) > 0.25 && dot(outward, camDir) > -0.2 ? cutTo : null;
      if (cut != null) cutWalls.add(m.userData.wall);
      const top = cut == null ? z1 : Math.min(z1, cut);
      m.visible = top > z0 + 1e-3;
      if (m.visible) { m.scale.y = (top - z0) / (z1 - z0); m.position.y = z0 * (1 - m.scale.y); }
    }
    for (const c of ceilings) c.visible = state.view === "interior";
    if (highlight) highlight.visible = state.view !== "interior"; // inside a room the tint would colour the whole floor
    shell.traverse((o) => { if (o.userData.tileOf) o.scale.y = 1; });
    const lowered = state.view !== "interior";
    // frames, glass and leaves belong to their wall: a cut wall hides them instead of leaving them floating
    shell.children.forEach((o) => { if (o.userData.opening) o.visible = !cutWalls.has(o.userData.wall); });
    if (lowered) requestRender();
  }

  /* ───────── furniture ───────── */
  const loadGltf = (file) => { const url = new URL(file, assetBase).href; return glbCache.get(url) ?? glbCache.set(url, new GLTFLoader().loadAsync(url)).get(url); };
  /** Clone a model, pick its style variant (KHR_materials_variants), turn its front to −Z and put its
   *  footprint centre on the floor (or its top at y = 0 for hanging fixtures). Never rescales. */
  async function placeModel(src, { rotY = 0, hang = false, variant = null } = {}) {
    const inner = src.scene.clone(true);
    if (variant && src.parser?.json?.extensions?.KHR_materials_variants) {
      const vi = src.parser.json.extensions.KHR_materials_variants.variants.findIndex((v) => v.name === variant);
      const orig = [], copy = [];
      src.scene.traverse((o) => { if (o.isMesh) orig.push(o); }); inner.traverse((o) => { if (o.isMesh) copy.push(o); });
      await Promise.all(orig.map(async (o, i) => {
        const assoc = src.parser.associations.get(o); if (!assoc || assoc.meshes == null) return;
        const maps = src.parser.json.meshes[assoc.meshes].primitives[assoc.primitives ?? 0]?.extensions?.KHR_materials_variants?.mappings ?? [];
        const m = maps.find((x) => x.variants.includes(vi)); if (m) copy[i].material = await src.parser.getDependency("material", m.material);
      }));
    }
    inner.rotation.y = rotY;
    const g = new THREE.Group(); g.add(inner); g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g), c = b.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, hang ? -b.max.y : -b.min.y, -c.z);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.sharedGeo = true; } });
    return { g, size: b.getSize(new THREE.Vector3()) };
  }
  async function loadAsset(asset, p) {
    try {
      if (asset.composite) {
        const g = new THREE.Group(), T = asset.composite.table, C = asset.composite.chairs;
        const top = new THREE.Mesh(new RoundedBoxGeometry(T.w, 0.035, T.d, 3, 0.008), M.oak); top.position.y = T.h - 0.0175; g.add(top);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.045, T.h - 0.035, 0.045), M.oak); l.position.set(sx * (T.w / 2 - 0.07), (T.h - 0.035) / 2, sz * (T.d / 2 - 0.07)); g.add(l); }
        const chair = await loadGltf(C.model);
        for (const [x, z, flip] of C.at) { const { g: ch } = await placeModel(chair, { rotY: C.rotY + (flip ? Math.PI : 0) }); ch.position.set(x, 0, z); g.add(ch); }
        g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
        g.userData.assetId = asset.id; g.userData.licensed = true; return g;
      }
      if (asset.model) {
        const src = await loadGltf(asset.model.file);
        const { g, size } = await placeModel(src, { rotY: asset.model.rotY ?? 0, hang: asset.model.hang, variant: asset.model.variants?.[state.style] });
        const off = [size.x / asset.dims.w, size.z / asset.dims.d, size.y / asset.dims.h].map((k) => Math.abs(k - 1));
        if (Math.max(...off) > 0.03) { console.warn(asset.id + ": загварын хэмжээ " + [size.x, size.z, size.y].map((v) => v.toFixed(2)).join("×") + " м manifest-ээс зөрнө — сунгахгүй, орлуулагч ашиглана"); throw new Error("dims"); }
        if (asset.model.addTV) { // 55-inch screen on a low stand: the cabinet is the licensed model, the TV is parametric
          const tv = new THREE.Mesh(new THREE.BoxGeometry(1.23, 0.71, 0.03), M.screen); tv.position.set(0, asset.dims.h + 0.06 + 0.355, asset.dims.d / 2 - 0.16); tv.castShadow = true; g.add(tv);
          const st = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.2), M.dark); st.position.set(0, asset.dims.h + 0.03, asset.dims.d / 2 - 0.16); g.add(st);
        }
        if (asset.layer === "ceiling") {
          g.userData.lampDrop = asset.dims.h - 0.12;
          // own copies of the fixture materials so the shade can glow in the evening
          g.userData.glow = []; g.traverse((o) => { if (o.isMesh && o.material?.emissive) { o.material = o.material.clone(); g.userData.glow.push(o.material); } });
        }
        g.userData.assetId = asset.id; g.userData.licensed = true; return g;
      }
    } catch (e) { if (e.message !== "dims") console.warn(asset.id + ": загвар ачаалсангүй, орлуулагч ашиглана", e); }
    const g = factory.build(asset, null, p);
    if (asset.category === "light") g.userData.lampDrop = 0.15;
    return g;
  }
  let buildToken = 0;
  async function buildFurniture() {
    const token = ++buildToken;
    const objs = await Promise.all(state.placements.map(async (p) => {
      const a = A.get(p.asset); if (!a) return null;
      const g = await loadAsset(a, p);
      g.position.copy(W([p.x, p.y], a.layer === "ceiling" ? plan.ceiling_height : 0)); g.rotation.y = p.rot;
      g.userData.placement = p.id; g.userData.layer = a.layer ?? null;
      return g;
    }));
    if (token !== buildToken) return;
    furniture.children.forEach((c) => { if (!c.userData.keep) disposeGroup(c, false); });
    furniture.clear(); lamps.forEach((l) => scene.remove(l)); lamps = [];
    for (const g of objs) if (g) furniture.add(g);
    furniture.visible = state.furnished;
    applyLight(); markSelection();
  }

  /* ───────── light, view ───────── */
  // the side most window area faces: daylight comes in from there (north is not known for demo plans)
  const windowSide = (() => {
    let v = [0, 0];
    for (const o of plan.openings.filter((x) => x.type === "window")) {
      const w = plan.walls.find((x) => x.id === o.wall), { n } = wallFrame(w), mid = mul(add(w.a, w.b), 0.5), out = dot(n, sub(mid, apartmentCentre)) >= 0 ? n : mul(n, -1);
      v = add(v, mul(out, o.width * o.height));
    }
    const L = len(v) || 1; return [v[0] / L, v[1] / L];
  })();
  function buildWindowLights() {
    windowLights.forEach((l) => { scene.remove(l); l.dispose?.(); }); windowLights = [];
    for (const o of plan.openings.filter((x) => x.type === "window")) {
      const w = plan.walls.find((x) => x.id === o.wall), { u, n } = wallFrame(w), mid0 = mul(add(w.a, w.b), 0.5);
      const out = dot(n, sub(mid0, apartmentCentre)) >= 0 ? n : mul(n, -1), a = add(w.a, mul(u, o.offset + o.width / 2));
      const face = add(a, mul(out, -(w.thickness / 2 + 0.02)));
      const L = new THREE.RectAreaLight(0xF1F4FA, 0, o.width, o.height);
      L.position.copy(W(face, (o.sill ?? 0) + o.height / 2)); L.lookAt(W(add(face, mul(out, -1)), (o.sill ?? 0) + o.height / 2 - 0.25));
      scene.add(L); windowLights.push(L);
    }
  }
  buildWindowLights();
  function applyLight() {
    const night = state.light === "night", interior = state.view === "interior";
    // sun outside the windows, 30° off their normal, low enough to reach into the rooms
    const az = Math.atan2(windowSide[1], windowSide[0]) + THREE.MathUtils.degToRad(30), elevation = THREE.MathUtils.degToRad(interior ? 28 : 42);
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elevation), Math.sin(elevation), -Math.sin(az) * Math.cos(elevation));
    sun.position.copy(W(C)).addScaledVector(dir, SPAN * 1.6); sun.target.position.copy(W(C));
    const sc = sun.shadow.camera, r = SPAN * 0.75; Object.assign(sc, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: SPAN * 4 }); sc.updateProjectionMatrix();
    sun.intensity = night ? 0.0 : interior ? 2.4 : 2.2;
    hemi.intensity = night ? 0.02 : interior ? 0.18 : 0.3;
    scene.environmentIntensity = night ? 0.03 : interior ? 0.42 : 0.7;
    windowLights.forEach((l) => { l.intensity = night ? 0 : interior ? 5.5 : 2.5; });
    renderer.toneMappingExposure = night ? 1.15 : interior ? 1.05 : 1.0;
    scene.background = new THREE.Color(night ? "#121820" : getComputedStyle(container).getPropertyValue("--viewer-bg").trim() || "#ECEAE6");
    if (M) M.lamp.emissiveIntensity = night ? 2.5 : 0;
    for (const g of furniture.children) for (const m of g.userData.glow ?? []) { m.emissive.set(night ? 0xffd2a0 : 0x000000); m.emissiveIntensity = night ? 0.9 : 0; }
    lamps.forEach((l) => scene.remove(l)); lamps = [];
    // evening light comes from the fixtures themselves: one warm point light at each lamp
    if (night && furniture.visible) for (const g of furniture.children) if (g.userData.layer === "ceiling") {
      const L = new THREE.PointLight(0xffcf9a, (g.userData.lampDrop ?? 0) > 0.5 ? 2.6 : 4.2, 0, 2); L.position.copy(g.position); L.position.y -= (g.userData.lampDrop ?? 0.2) + 0.05;
      scene.add(L); lamps.push(L);
    }
    requestRender();
  }

  function fit(view = state.view) {
    const room = state.room && plan.rooms.find((r) => r.id === state.room);
    const aspect = camera.aspect || 1;
    if (view === "interior") {
      const r = room ?? largestRoom(), poly = r.polygon, c = interiorPoint(poly);
      // look towards the room's window (or its farthest corner) from a free standing point: not inside
      // furniture, not against a wall, as far back as the room allows
      const win = plan.openings.find((o) => o.type === "window" && touches(o, r));
      // a bedroom is framed on its bed; other rooms look towards their window
      const bed = r.type === "bedroom" && state.furnished ? state.placements.find((p) => p.room === r.id && A.get(p.asset)?.category === "bed") : null;
      const look = bed ? [bed.x, bed.y] : win ? mul(add(...openingEnds(win)), 0.5) : farthest(poly, c);
      const eye = standingPoint(r, look) ?? c;
      const dirv = sub(look, eye), L = len(dirv) || 1;
      camera.fov = 56; camera.near = 0.05; camera.updateProjectionMatrix();
      // eye height 1.5 m, looking 4–5° down; the orbit target sits 1 m ahead so dragging turns the head
      camera.position.copy(W(eye, 1.5)); controls.target.copy(W(add(eye, mul(dirv, 1 / L)), 1.42));
      Object.assign(controls, { enablePan: false, enableZoom: false, rotateSpeed: -0.35, minDistance: 1, maxDistance: 1, minPolarAngle: 0.9, maxPolarAngle: 2.0 });
    } else {
      const poly = view === "room" && room ? room.polygon : plan.boundary, b = bounds(poly), c = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
      const size = Math.max(b.maxX - b.minX, (b.maxY - b.minY)), fov = 36;
      camera.fov = fov; camera.near = 0.1; camera.updateProjectionMatrix();
      const fitDist = (size * 0.5) / Math.tan(THREE.MathUtils.degToRad(fov / 2)) / Math.min(1, aspect * 0.9) + 0.4;
      const polar = view === "plan" ? 0.001 : view === "room" ? 0.85 : 0.92, az = THREE.MathUtils.degToRad(view === "plan" ? 0 : 35);
      const dir = new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az));
      controls.target.copy(W(c, 0.6));
      camera.position.copy(controls.target).addScaledVector(dir, fitDist);
      Object.assign(controls, { enablePan: true, enableZoom: true, rotateSpeed: 0.8, minDistance: size * 0.6, maxDistance: fitDist * 2.2, minPolarAngle: view === "plan" ? 0 : 0.25, maxPolarAngle: view === "plan" ? 0.001 : 1.3 });
    }
    controls.update(); applyCutaway(); applyLight(); requestRender();
  }
  function standingPoint(r, look) {
    const b = bounds(r.polygon), A2 = A, items = state.furnished ? state.placements.filter((p) => p.room === r.id && (!A2.get(p.asset)?.layer || A2.get(p.asset)?.category === "pendant")) : [];
    const clear = (pt) => items.every((p) => { const a = A2.get(p.asset), dx = pt[0] - p.x, dy = pt[1] - p.y, c = Math.cos(-p.rot), s = Math.sin(-p.rot), lx = dx * c - dy * s, ly = dx * s + dy * c; return Math.hypot(Math.max(Math.abs(lx) - a.dims.w / 2, 0), Math.max(Math.abs(ly) - a.dims.d / 2, 0)) > (a.category === "pendant" ? 0.9 : 0.3); });
    // a pendant hanging just above eye height inside the view cone fills the top of the frame
    const pendants = state.furnished ? state.placements.filter((p) => p.room === r.id && A2.get(p.asset)?.category === "pendant") : [];
    const blocksView = (pt) => pendants.some((p) => { const to = sub([p.x, p.y], pt), d = len(to), dir = sub(look, pt), cos = dot(to, dir) / ((d * len(dir)) || 1); return d < 2.5 && cos > Math.cos(THREE.MathUtils.degToRad(35)); });
    let best = null, bd = -1;
    for (let x = b.minX; x <= b.maxX; x += 0.15) for (let y = b.minY; y <= b.maxY; y += 0.15) {
      const pt = [x, y];
      if (pointInPolygon(pt, r.polygon) !== 1) continue;
      if (Math.min(...edges(r.polygon).map(([p, q]) => { const ab = sub(q, p), t = Math.max(0, Math.min(1, dot(sub(pt, p), ab) / dot(ab, ab))); return len(sub(pt, add(p, mul(ab, t)))); })) < 0.45) continue;
      if (!clear(pt) || blocksView(pt)) continue;
      const d = len(sub(pt, look));
      if (d > bd) { bd = d; best = pt; }
    }
    return best;
  }
  const largestRoom = () => plan.rooms.reduce((a, b) => (polygonArea(b.polygon) > polygonArea(a.polygon) ? b : a));
  const openingEnds = (o) => { const w = plan.walls.find((x) => x.id === o.wall), { u } = wallFrame(w); return [add(w.a, mul(u, o.offset)), add(w.a, mul(u, o.offset + o.width))]; };
  const touches = (o, r) => { const [a, b] = openingEnds(o), w = plan.walls.find((x) => x.id === o.wall), m = mul(add(a, b), 0.5), { n } = wallFrame(w), k = w.thickness / 2 + 0.05; return [1, -1].some((s) => pointInPolygon(add(m, mul(n, s * k)), r.polygon) === 1); };
  const farthest = (poly, c) => poly.reduce((a, p) => (len(sub(p, c)) > len(sub(a, c)) ? p : a), poly[0]);
  function interiorPoint(poly) {
    const b = bounds(poly); let best = centroid(poly), bd = -1;
    for (let x = b.minX; x <= b.maxX; x += 0.1) for (let y = b.minY; y <= b.maxY; y += 0.1) {
      if (pointInPolygon([x, y], poly) !== 1) continue;
      const d = Math.min(...edges(poly).map(([p, q]) => { const ab = sub(q, p), t = Math.max(0, Math.min(1, dot(sub([x, y], p), ab) / dot(ab, ab))); return len(sub([x, y], add(p, mul(ab, t)))); }));
      if (d > bd) { bd = d; best = [x, y]; }
    }
    return best;
  }

  /* ───────── selection ───────── */
  function markRoom() {
    if (highlight) { shell.remove(highlight); highlight.geometry.dispose(); highlight.material.dispose(); highlight = null; }
    const r = state.room && plan.rooms.find((x) => x.id === state.room);
    if (r) {
      highlight = new THREE.Mesh(shapeGeo(r.polygon), new THREE.MeshBasicMaterial({ color: getComputedStyle(container).getPropertyValue("--accent").trim() || "#087F8C", transparent: true, opacity: 0.22, depthWrite: false }));
      highlight.rotation.x = -Math.PI / 2; highlight.position.y = 0.004; highlight.renderOrder = 2; shell.add(highlight);
    }
    requestRender();
  }
  function markSelection() {
    if (selBox) { scene.remove(selBox); selBox.geometry.dispose(); selBox.material.dispose(); selBox = null; }
    const g = furniture.children.find((c) => c.userData.placement === state.selected);
    if (g && state.furnished) { selBox = new THREE.BoxHelper(g, state.invalid ? 0xd92d20 : 0x087f8c); scene.add(selBox); }
    requestRender();
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pick = (ev, objects) => { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.intersectObjects(objects, true)[0]; };
  const floorPoint = (ev) => { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); const p = new THREE.Vector3(); return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? [p.x, -p.z] : null; };
  let down = null, drag = null;
  const edit = { enabled: false, onDrag: null, onDrop: null };
  const onDown = (ev) => {
    down = [ev.clientX, ev.clientY];
    if (!edit.enabled || !state.furnished) return;
    const hit = pick(ev, furniture.children.filter((g) => !g.userData.layer));
    if (!hit) return;
    let o = hit.object; while (o && !o.userData.placement) o = o.parent;
    const p = state.placements.find((x) => x.id === o.userData.placement), fp = floorPoint(ev);
    if (!p || !fp) return;
    drag = { id: p.id, start: { x: p.x, y: p.y }, off: [p.x - fp[0], p.y - fp[1]], obj: o, last: { x: p.x, y: p.y } };
    controls.enabled = false; renderer.domElement.setPointerCapture(ev.pointerId);
    state.selected = p.id; onItemPick?.(p.id); markSelection();
  };
  const onMove = (ev) => {
    if (!drag) return;
    const fp = floorPoint(ev); if (!fp) return;
    const snap = (v) => Math.round(v / 0.05) * 0.05, x = snap(fp[0] + drag.off[0]), y = snap(fp[1] + drag.off[1]);
    const res = edit.onDrag?.(drag.id, { x, y }) ?? { ok: true };
    drag.obj.position.copy(W([x, y])); drag.last = { x, y, ok: res.ok };
    state.invalid = !res.ok; markSelection();
  };
  const onUp = (ev) => {
    if (drag) {
      controls.enabled = true;
      const ok = edit.onDrop?.(drag.id, drag.last.ok ? { x: drag.last.x, y: drag.last.y } : null);
      if (!ok) drag.obj.position.copy(W([drag.start.x, drag.start.y]));
      drag = null; state.invalid = false; markSelection(); return;
    }
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5) return;
    if (state.furnished) {
      const hit = pick(ev, furniture.children.filter((g) => !g.userData.layer));
      if (hit) { let o = hit.object; while (o && !o.userData.placement) o = o.parent; state.selected = o?.userData.placement ?? null; onItemPick?.(state.selected); markSelection(); return; }
    }
    const f = pick(ev, floorMeshes);
    onRoomPick?.(f?.object.userData.room ?? null);
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerup", onUp);

  /* ───────── rendering on demand ───────── */
  let needs = true, visible = true, raf = 0, frames = 0, slow = 0, lastT = 0;
  const requestRender = () => { needs = true; if (!raf) raf = requestAnimationFrame(loop); };
  function loop(t) {
    raf = 0;
    if (!visible || document.hidden) return;
    const moving = controls.update();
    if (needs || moving) {
      needs = false;
      if (quality === "high") composer.render(); else renderer.render(scene, camera);
      if (lastT) { const dt = t - lastT; frames++; if (dt > 40) slow++; if (frames === 40) adapt(); onStats?.({ frameMs: dt }); }
      lastT = t; raf = requestAnimationFrame(loop);
    } else lastT = 0;
  }
  function adapt() {
    if (slow > 20 && pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); sun.shadow.mapSize.set(1024, 1024); sun.shadow.map?.dispose(); sun.shadow.map = null; resize(); }
    frames = 0; slow = 0;
  }
  controls.addEventListener("change", () => { requestRender(); cutThrottle(); });
  let cutT = 0; const cutThrottle = () => { const n = performance.now(); if (n - cutT > 120) { cutT = n; applyCutaway(); } };
  controls.addEventListener("end", applyCutaway);
  function resize() {
    const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); requestRender();
  }
  const ro = new ResizeObserver(resize); ro.observe(container);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) requestRender(); }); io.observe(container);
  const onVis = () => { if (!document.hidden) requestRender(); }; document.addEventListener("visibilitychange", onVis);

  async function setStyle(id) {
    const old = M, oldF = factory;
    M = await createMaterials(THREE, id, textures); factory = createSubstituteFactory(THREE, M); state.style = id;
    buildShell(); markRoom();
    await buildFurniture(); oldF?.dispose(); old?.dispose();
  }

  const ready = setStyle("modern").then(() => { resize(); fit("dollhouse"); });

  return {
    ready, THREE,
    get state() { return { ...state }; },
    setStyle,
    setLight(v) { state.light = v; applyLight(); },
    setQuality(v) { quality = v; if (v === "low") { renderer.setPixelRatio(1); sun.shadow.mapSize.set(1024, 1024); } else { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); sun.shadow.mapSize.set(2048, 2048); } sun.shadow.map?.dispose(); sun.shadow.map = null; resize(); },
    get quality() { return quality; },
    styles: Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v.label])),
    setView(v) { state.view = v; fit(v); },
    resetView() { fit(state.view); },
    setRoom(id, { refit = false } = {}) { state.room = id; markRoom(); if (refit && (state.view === "room" || state.view === "interior")) fit(); else applyCutaway(); },
    setFurnished(on) { state.furnished = on; furniture.visible = on; markSelection(); requestRender(); },
    setPlacements(list) { state.placements = list; return buildFurniture(); },
    select(id) { state.selected = id; markSelection(); },
    edit,
    dispose() {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis);
      renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointermove", onMove); renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose(); disposeGroup(shell); furniture.children.forEach((c) => disposeGroup(c, false)); factory?.dispose(); M?.dispose();
      windowLights.forEach((l) => l.dispose?.()); composer.dispose?.(); gtao.dispose?.(); textures.dispose();
      envRT.dispose(); pmrem.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}

/* ───────── geometry helpers ───────── */
function shapeGeo(poly) {
  const s = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1])));
  return new THREE.ShapeGeometry(s); // UVs = plan metres
}
/** Vertical prism over a plan quad/polygon between heights z0..z1; material[0] sides, [1] top cut. */
function prismMesh(poly, z0, z1, mats) {
  const s = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(s, { depth: z1 - z0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, z0, 0); // shape y → world −z, extrusion → up
  // ExtrudeGeometry groups: 0 = caps, 1 = sides
  const m = new THREE.Mesh(g, [mats[1], mats[0]]); m.castShadow = true; m.receiveShadow = true; return m;
}
function disposeGroup(g, materials = false) {
  g.traverse((o) => { if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose?.(); if (materials && o.material) [].concat(o.material).forEach((m) => m.dispose()); });
}
