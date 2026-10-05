/* Materials for the apartment viewer.
 *
 * Surfaces use licensed PBR sets from assets/materials (Poly Haven, CC0 — see assets/CREDITS.json):
 * base colour (sRGB), OpenGL normal, roughness and AO (linear). Each set tiles at its real size, so
 * planks and tiles have the same size in every room. Textures are loaded once per viewer and shared
 * by both styles; a style only changes tints and variant choices. Metalness is used for metals only.
 */
const SETS = {
  "oak-floor": 1.7, "plaster-warm": 3.0, "stone-tile": 1.5, "wall-tile": 1.27, "oak-veneer": 1.0, linen: 0.27, wool: 0.27,
};

/** Two curated styles: real material and furniture-variant choices, not recoloured blocks. */
export const STYLES = {
  modern: {
    label: "Модерн", sofaVariant: "Gray",
    wall: "#E9E2D8", floorTint: "#E7D8C6", cabinetFront: "oak", cabinetTint: "#F2E9DE", worktop: "#E4E0DA",
    linen: "#ECE6DC", throw: "#4D5157", headboard: "#6B6660", rug: "#8E8A83", curtain: "#E5DED2", ceramic: "#F5F4F1", metal: "#2E3033",
  },
  scandi: {
    label: "Скандинав", sofaVariant: "Champagne",
    wall: "#F3F0EA", floorTint: "#FFFFFF", cabinetFront: "lacquer", cabinetTint: "#EFECE6", worktop: "#D9CFC2",
    linen: "#F4F1EB", throw: "#A9B4A6", headboard: "#D6CFC4", rug: "#D9D1C3", curtain: "#F1ECE3", ceramic: "#F7F7F5", metal: "#A7A9AA",
  },
};

/** Loads the PBR sets once; returns a cache the material sets borrow from. */
export function createTextureCache(THREE, baseUrl, maxAniso = 8) {
  const loader = new THREE.TextureLoader(), cache = new Map();
  const load = (set, map) => {
    const key = `${set}/${map}`;
    if (!cache.has(key)) cache.set(key, new Promise((ok) => loader.load(`${baseUrl}${set}/${map}.webp`, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso;
      t.colorSpace = map === "diff" ? THREE.SRGBColorSpace : THREE.NoColorSpace; ok(t);
    }, undefined, () => ok(null))));
    return cache.get(key);
  };
  return {
    async set(name) {
      const [diff, nor, rough, ao] = await Promise.all(["diff", "nor", "rough", "ao"].map((m) => load(name, m)));
      return { diff, nor, rough, ao, size: SETS[name] ?? 1 };
    },
    async dispose() { for (const p of cache.values()) (await p)?.dispose(); cache.clear(); },
  };
}

/** A material set for one style. repeatFor(metres) clones textures with the right repeat. */
export async function createMaterials(THREE, styleId, textures) {
  const S = STYLES[styleId] ?? STYLES.modern, owned = [], clones = [];
  const P = Object.fromEntries(await Promise.all(Object.keys(SETS).map(async (k) => [k, await textures.set(k)])));
  // a set's textures with a repeat that makes one tile = its real size on a surface whose UVs are `uvUnit` metres
  const maps = (set, { uvUnit = 1, rotate = 0, keep = ["diff", "nor", "rough", "ao"] } = {}) => {
    const src = P[set], out = {};
    for (const k of keep) {
      if (!src[k]) continue;
      const t = src[k].clone(); t.needsUpdate = true; t.repeat.set(uvUnit / src.size, uvUnit / src.size);
      if (rotate) { t.center.set(0.5, 0.5); t.rotation = rotate; }
      clones.push(t); out[k] = t;
    }
    return out;
  };
  const std = (o) => { const m = new THREE.MeshStandardMaterial(o); owned.push(m); return m; };
  const phys = (o) => { const m = new THREE.MeshPhysicalMaterial(o); owned.push(m); return m; };
  const pbr = (set, o = {}, mapOpts = {}) => {
    const t = maps(set, mapOpts);
    return std({ map: t.diff, normalMap: t.nor, roughnessMap: t.rough, aoMap: t.ao, aoMapIntensity: 0.7, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.6, 0.6), ...o });
  };
  // per-object fabric/veneer: surfaces of furniture have UV 0..1 per face of ~0.5–2 m, so the
  // repeat assumes ~1 m per UV unit (close enough for fabric weave and veneer grain at viewing distance)
  const fabric = (set, color) => pbr(set, { map: null, color, normalScale: new THREE.Vector2(0.45, 0.45) }, { uvUnit: 1, keep: ["nor", "rough", "ao"] });
  const veneer = (tint) => pbr("oak-veneer", { color: tint, normalScale: new THREE.Vector2(0.3, 0.3) }, { uvUnit: 1 });

  const M = {
    style: S,
    floor: {
      wood: pbr("oak-floor", { color: S.floorTint, normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 0.8 }),
      tile: pbr("stone-tile", { normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 0.8 }),
      wet: pbr("stone-tile", { normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 0.8 }),
    },
    wall: pbr("plaster-warm", { map: null, color: S.wall, normalScale: new THREE.Vector2(0.25, 0.25), aoMap: null }, { keep: ["nor", "rough"] }),
    wallTile: pbr("wall-tile", { normalScale: new THREE.Vector2(0.5, 0.5) }),
    cut: std({ color: "#8A847C", roughness: 1 }),
    ceiling: std({ color: "#F6F4F0", roughness: 0.95, side: THREE.BackSide }),
    skirting: std({ color: S.cabinetFront === "lacquer" ? "#F1EEE8" : "#E9E4DC", roughness: 0.55 }),
    slab: std({ color: "#BDB8B0", roughness: 1 }),
    frame: std({ color: "#3A3D41", roughness: 0.4, metalness: 0.6 }),
    glass: phys({ color: "#E6EEF0", roughness: 0.03, metalness: 0, transparent: true, opacity: 0.16, ior: 1.5, envMapIntensity: 1.0, depthWrite: false }),
    door: std({ color: "#F1EEE8", roughness: 0.45 }),
    entrance: std({ color: "#4A4642", roughness: 0.55, metalness: 0.1 }),
    handle: std({ color: "#B6B1A9", roughness: 0.3, metalness: 0.9 }),
    linen: fabric("linen", S.linen),
    fabric: fabric("wool", S.throw),
    fabric2: fabric("wool", S.headboard),
    rug: fabric("wool", S.rug),
    oak: veneer(S.cabinetTint), walnut: veneer("#6E5440"),
    front: S.cabinetFront === "oak" ? veneer(S.cabinetTint) : std({ color: S.cabinetTint, roughness: 0.42 }),
    lacquer: std({ color: "#EFECE6", roughness: 0.42 }),
    stone: std({ color: S.worktop, roughness: 0.32 }),
    ceramic: phys({ color: S.ceramic, roughness: 0.08, clearcoat: 0.6, clearcoatRoughness: 0.1 }),
    chrome: std({ color: "#D8DADC", roughness: 0.15, metalness: 1 }),
    metal: std({ color: S.metal, roughness: 0.35, metalness: 0.8 }),
    dark: std({ color: "#1C1D20", roughness: 0.35, metalness: 0.1 }),
    screen: std({ color: "#0B0C0E", roughness: 0.18, metalness: 0.2 }),
    lamp: std({ color: "#FFF7EA", emissive: "#FFE0B2", emissiveIntensity: 0, roughness: 0.9 }),
    curtain: pbr("linen", { map: null, color: S.curtain, side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.4, 0.4) }, { uvUnit: 1, keep: ["nor", "rough"] }),
    dispose() { owned.forEach((o) => o.dispose()); clones.forEach((t) => t.dispose()); },
  };
  M.byVariant = (v, fallback) => M[{ oak: "oak", walnut: "walnut", white: "lacquer", "linen-warm": "linen", "linen-cool": "linen", "wool-oat": "rug", "wool-grey": "rug" }[v]] ?? M[fallback] ?? M.lacquer;
  return M;
}
