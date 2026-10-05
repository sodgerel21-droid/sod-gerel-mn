/* Unit passport: 2D plan · 3D shell · furnished interior, all from one apartment plan
 * (landing/units/lib, docs/apartment-plan.mn.md). The 3D code loads only when a 3D tab opens.
 */
import { resolvePlan } from "./lib/plan-source.js";
import { areas, VERIFICATION, fmtM, geometryKey, openingRooms } from "./lib/plan-geometry.js";
import { drawPlan } from "./lib/plan2d.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (data) => { try { return hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data)); } catch { return "тооцох боломжгүй (secure context биш)"; } };
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } } };
const ICON_INFO = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 8v5M9 5.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

export async function mountPassport({ project: p, unit: u, $, params, dataUrl, STATUS, money, m2 }) {
  const t0 = performance.now(), timing = {};
  const { plan, validation, kind, entry, notes } = await resolvePlan(p, u, dataUrl);
  timing.plan = performance.now() - t0;
  const AR = areas(plan), verif = plan.status.verification;
  const openingSides = (o) => { const r = openingRooms(plan, o); return [r.left, r.right].filter(Boolean); };
  const sales = u.area_declared ?? null;

  document.title = `${u.unit_id} · ${p.name} — E-Property`;
  document.querySelector("main").classList.add("wide");
  const root = $("passport"); root.hidden = false;
  const orientation = plan.north_deg == null ? "Тодорхойгүй (зурагт хойд зүг заагаагүй)" : `Хойд зүг ${plan.north_deg}°`;
  const verifClass = verif === "verified" ? "verified" : notes.some((n) => n.level === "error") ? "error" : "";
  root.innerHTML = `
    <nav class="crumbs" aria-label="Зам"><a href="./?project=${encodeURIComponent(p.slug)}">← ${esc(p.name)}, ${esc(p.block)} блокийн нэгжүүд</a><span class="muted">·</span><a href="/3d/?project=${encodeURIComponent(p.slug)}&unit=${encodeURIComponent(u.unit_id)}">Барилгад байршлыг харах</a></nav>
    <section class="unit-head">
      <div>
        <div class="uid">Нэгж ${esc(u.unit_id)} · ${esc(plan.title ?? "")}</div>
        <h1>${u.rooms} өрөө байр, ${u.floor}-р давхар</h1>
        <p>${esc(p.name)}, ${esc(p.block)} блок · ${esc(p.district)} · ${esc(p.developer)}</p>
      </div>
      <div class="headprice">
        <div class="price num">${u.status === "sold" ? "Зарагдсан" : money(u.price)}</div>
        <small>${u.status === "sold" ? "" : `${money(u.price_per_m2)} / м² · зарласан ${m2(sales)}`}</small>
        <span class="st ${u.status}">${STATUS[u.status]}</span>
      </div>
    </section>
    <div class="verif ${verifClass}" role="note">${ICON_INFO}<div><b>${esc(VERIFICATION[verif])}</b>${esc(plan.status.note ?? "")}${notes.map((n) => `<br>${esc(n.message)}`).join("")}</div></div>
    <div class="layout">
      <div class="stage">
        <div class="tabs" role="tablist" aria-label="Харагдац">
          <button role="tab" id="t-plan" aria-controls="viewer">2D зураг</button>
          <button role="tab" id="t-shell" aria-controls="viewer">3D</button>
          <button role="tab" id="t-int" aria-controls="viewer">Интерьер</button>
        </div>
        <div class="viewer" id="viewer" role="tabpanel">
          <svg id="plan" role="img" aria-label="Нэгжийн техникийн төлөвлөлт"></svg>
          <div class="overlay"><div class="toolbar" id="tb-left"></div><div class="toolbar" id="tb-right"></div></div>
          <div class="hint" id="hint" hidden></div>
          <div class="loading" id="loading" hidden>3D ачаалж байна…</div>
        </div>
        <div class="controls" id="controls"></div>
        <div class="editbar" id="editbar" hidden></div>
      </div>
      <aside class="side">
        <section class="card"><h2>Өрөөнүүд</h2><ul class="rooms" id="rooms"></ul></section>
        <section class="card"><h2>Талбай</h2><div class="areas" id="areas"></div></section>
        <section class="card"><h2>Нэгж</h2>
          <dl class="facts">
            <dt>Давхар</dt><dd>${u.floor}</dd>
            <dt>Өрөө</dt><dd>${u.rooms}</dd>
            <dt>Таазны өндөр</dt><dd>${fmtM(plan.ceiling_height)} м</dd>
            <dt>Чиглэл</dt><dd>${esc(orientation)}</dd>
            <dt>Борлуулалт</dt><dd><span class="st ${u.status}">${STATUS[u.status]}</span>${u.hold_until ? `<br><span class="muted">хүлээлт ${esc(u.hold_until.slice(0, 16).replace("T", " "))} хүртэл</span>` : ""}</dd>
            <dt>Барилгын явц</dt><dd>${p.progress}%<div class="bar"><i style="width:${Math.max(0, Math.min(100, p.progress))}%"></i></div></dd>
            <dt>Ашиглалтад</dt><dd>${esc(p.completion)}</dd>
          </dl>
        </section>
        <section class="card actions">
          <h2>Холбогдох</h2>
          <button class="btn" type="button" aria-disabled="true" disabled>Сонирхож байна — хүсэлт илгээх</button>
          <p class="note">Хүсэлт хүлээн авах суваг удахгүй нээгдэнэ. Одоогоор хүсэлт хаашаа ч илгээгдэхгүй.</p>
          <button class="btn ghost" type="button" id="copy">Холбоос хуулах</button>
          <button class="btn ghost" type="button" id="save" aria-pressed="false" hidden></button>
        </section>
      </aside>
    </div>
    <details class="prov" id="prov"><summary>Эх сурвалж, шалгалт, техникийн дэлгэрэнгүй</summary><dl class="kv" id="provkv"></dl></details>`;

  /* areas: declared (sales) vs calculated, never merged */
  $("areas").innerHTML = `
    <div class="ar sale"><b>Зарласан талбай</b><span class="v">${sales == null ? "—" : `${fmtM(sales, 1)} м²`}</span><p>${esc(plan.area?.declared_definition ?? "")} Үнэ энэ талбайгаар тооцогдсон.</p></div>
    <div class="ar"><b>Хилээр тооцсон</b><span class="v">${fmtM(AR.boundary)} м²</span><p>${esc(plan.area?.boundary_definition ?? "")}${AR.diffPct != null && Math.abs(AR.diffPct) > 0.005 ? ` Зарласантай ${AR.diffPct > 0 ? "+" : ""}${fmtM(AR.diffPct)}% зөрүүтэй${u.area_flag ? " — гэрээний өмнө тодруулна уу" : ""}.` : ""}</p></div>
    <div class="ar"><b>Өрөөнүүдийн нийлбэр</b><span class="v">${fmtM(AR.internal)} м²</span><p>${esc(plan.area?.internal_definition ?? "")}</p></div>`;

  /* rooms list ↔ 2D ↔ 3D */
  let selectedRoom = null, viewer = null, plan2d = null;
  $("rooms").innerHTML = AR.rooms.map((r) => `<li><button type="button" data-room="${esc(r.id)}" aria-pressed="false"><span>${esc(r.name)}</span><span class="a">${fmtM(r.area)} м²</span></button></li>`).join("") + `<li class="sum"><span>Нийт</span><span class="mono">${fmtM(AR.internal)} м²</span></li>`;
  const selectRoom = (id, { refit = true } = {}) => {
    selectedRoom = id === selectedRoom ? null : id;
    $("rooms").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.room === selectedRoom)));
    plan2d?.select(selectedRoom);
    viewer?.setRoom(selectedRoom, { refit });
    renderControls(); syncUrl();
  };
  $("rooms").addEventListener("click", (e) => { const b = e.target.closest("button[data-room]"); if (b) selectRoom(b.dataset.room); });
  plan2d = drawPlan($("plan"), plan, { onRoom: (id) => selectRoom(id) });

  /* tabs */
  const TABS = { plan: "t-plan", shell: "t-shell", interior: "t-int" };
  let tab = { plan: "plan", "3d": "shell", interior: "interior" }[params.get("tab")] ?? "interior";
  // deep link: ?tab=interior&room=R-living&view=interior&light=night
  const pick = (k, allowed, def) => (allowed.includes(params.get(k)) ? params.get(k) : def);
  const state = { view: pick("view", ["dollhouse", "plan", "room", "interior"], "dollhouse"), style: pick("style", ["modern", "scandi"], "modern"), light: pick("light", ["day", "night"], "day"), edit: false, selectedItem: null, measure: false };
  const syncUrl = () => {
    const url = new URL(location.href);
    for (const [k, val, def] of [["room", selectedRoom, null], ["view", state.view, "dollhouse"], ["light", state.light, "day"], ["style", state.style, "modern"]]) val && val !== def ? url.searchParams.set(k, val) : url.searchParams.delete(k);
    history.replaceState(null, "", url);
  };
  let editor = null, manifest = null, solverDiag = [], restoreNote = null, webglFailed = false;

  const setHint = (t) => { $("hint").textContent = t ?? ""; $("hint").hidden = !t; };
  async function ensureViewer() {
    if (viewer || webglFailed) return viewer;
    $("loading").hidden = false;
    const ts = performance.now();
    try {
      const mod = await import("./lib/viewer3d.js");
      if (!mod.webglAvailable()) throw new Error("WebGL алга");
      manifest = manifest ?? (await fetch("./assets/manifest.json").then((r) => r.json()));
      viewer = mod.createViewer($("viewer"), { plan, manifest, quality: ["low", "high"].includes(params.get("q")) ? params.get("q") : undefined, onRoomPick: (id) => selectRoom(id, { refit: false }), onItemPick: (id) => { state.selectedItem = id; renderEdit(); } });
      await viewer.ready;
      timing.viewer = performance.now() - ts;
      viewer.setRoom(selectedRoom); viewer.setLight(state.light);
    } catch (e) {
      console.error(e); webglFailed = true;
      $("loading").textContent = "3D харагдац энэ төхөөрөмж дээр ажиллахгүй байна (WebGL). 2D зургийг үзнэ үү.";
      return null;
    }
    $("loading").hidden = true;
    return viewer;
  }
  async function ensureFurniture() {
    if (editor) return;
    const ts = performance.now();
    const { furnish } = await import("./lib/furnish.js");
    const { createEditor, configKey, restore } = await import("./lib/interior-config.js");
    const auto = furnish(plan, manifest);
    timing.furnish = performance.now() - ts; solverDiag = auto.diagnostics;
    editor = createEditor(plan, manifest, auto.placements);
    const saved = store.get(configKey(plan));
    if (saved) {
      const r = restore(plan, manifest, saved);
      if (r.ok) { editor.load(r.placements); state.style = r.style ?? state.style; restoreNote = r.dropped.length ? `Хадгалсан тохиргоог сэргээлээ; ${r.dropped.length} зүйлийг хассан: ${r.dropped.map((d) => d.reason).join("; ")}` : "Хадгалсан тохиргоог сэргээлээ"; }
      else restoreNote = r.reason;
    }
    viewer.edit.onDrag = (id, pos) => editor.transform(id, pos, { dryRun: true, walk: false });
    viewer.edit.onDrop = (id, pos) => {
      if (!pos) { editNote = "Энэ байрлал дүрэм зөрчиж байгаа тул буцаалаа"; renderEdit(); return false; }
      const r = editor.transform(id, pos);
      if (!r.ok) { editNote = r.problems.map((x) => x.message).join("; "); renderEdit(); return false; }
      editNote = null; syncFurniture(); return true;
    };
  }
  let editNote = null;
  const syncFurniture = () => { viewer?.setPlacements(editor.placements); plan2d.setPlacements(editor.placements, state.selectedItem); renderEdit(); };

  async function setTab(next) {
    tab = next;
    for (const [k, id] of Object.entries(TABS)) { const b = $(id); b.setAttribute("aria-selected", String(k === tab)); b.tabIndex = k === tab ? 0 : -1; }
    const url = new URL(location.href); url.searchParams.set("tab", { plan: "plan", shell: "3d", interior: "interior" }[tab]); history.replaceState(null, "", url);
    const svg = $("plan");
    if (tab === "plan") {
      svg.removeAttribute("hidden"); viewer && (viewer.edit.enabled = false); $("editbar").hidden = true;
      if (editor) plan2d.setPlacements(editor.placements, state.selectedItem);
      setHint(""); renderControls(); return;
    }
    svg.setAttribute("hidden", ""); // SVGElement has no .hidden property
    const v = await ensureViewer();
    if (!v) { svg.removeAttribute("hidden"); renderControls(); return; }
    if (tab === "interior") { await ensureFurniture(); if (v.state.style !== state.style) await v.setStyle(state.style); await v.setPlacements(editor.placements); }
    v.setFurnished(tab === "interior");
    if (tab === "shell" && state.view === "interior") state.view = "dollhouse";
    v.edit.enabled = tab === "interior" && state.edit;
    v.setView(state.view);
    setHint(matchMedia("(pointer: coarse)").matches ? "Хоёр хуруугаар эргүүлж, томруулна" : "Чирж эргүүлэх · гүйлгэж ойртуулах · өрөөн дээр дарж сонгох");
    renderControls(); renderEdit(); renderProv();
  }
  Object.entries(TABS).forEach(([k, id], i, all) => {
    $(id).addEventListener("click", () => setTab(k));
    $(id).addEventListener("keydown", (e) => { if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; const n = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length]; $(n[1]).focus(); setTab(n[0]); });
  });

  /* controls under the viewer and the toolbar on it */
  const seg = (name, opts, val) => `<span class="ctl">${name}<span class="seg" data-seg="${name}">${opts.map(([v, l, dis]) => `<button type="button" data-v="${v}" aria-pressed="${v === val}" ${dis ? "disabled" : ""}>${l}</button>`).join("")}</span></span>`;
  function renderControls() {
    const c = $("controls"), left = $("tb-left"), right = $("tb-right");
    left.innerHTML = ""; right.innerHTML = "";
    if (tab === "plan") {
      c.innerHTML = `<span class="note">Хэмжээ мм, талбай м² · ${esc(VERIFICATION[verif])}</span>`;
      right.innerHTML = `<button class="tb" type="button" id="mbtn" aria-pressed="${state.measure}">Хэмжих</button>`;
      $("mbtn").onclick = (e) => { state.measure = plan2d.measure.toggle(setHint); e.currentTarget.setAttribute("aria-pressed", state.measure); setHint(state.measure ? "Эхний цэгээ дарна уу. Булан, нүхний ирмэгт наалдана." : ""); };
      return;
    }
    if (!viewer) { c.innerHTML = ""; return; }
    const views = [["dollhouse", "Ерөнхий"], ["plan", "Дээрээс"], ["room", "Өрөө", !selectedRoom], ...(tab === "interior" ? [["interior", "Дотроос"]] : [])];
    c.innerHTML = seg("Харагдац", views, state.view) + (tab === "interior" ? seg("Стиль", Object.entries(viewer.styles), state.style) + seg("Гэрэл", [["day", "Өдөр"], ["night", "Орой"]], state.light) : "") + seg("Чанар", [["high", "Өндөр"], ["low", "Хөнгөн"]], viewer.quality);
    if (tab === "interior") c.insertAdjacentHTML("beforeend", `<span class="note">Стиль нь материал, буйдангийн өнгөний хувилбар, шүүгээний нүүрийг солино; тавилгын байршил, таны засвар хэвээр үлдэнэ.</span>`);
    if (selectedRoom) {
      const r = plan.rooms.find((x) => x.id === selectedRoom), ops = plan.openings.filter((o) => { const sides = openingSides(o); return sides.includes(r.id); });
      const win = ops.filter((o) => o.type === "window").length, doors = ops.length - win;
      c.insertAdjacentHTML("afterbegin", `<div class="roominfo"><b>${esc(r.name)}</b><span class="mono">${fmtM(AR.rooms.find((x) => x.id === r.id).area)} м²</span><span>${win} цонх · ${doors} хаалга/нүх</span><span>Шал: ${r.floor_finish === "tile" ? "хавтан" : "мод"}</span></div>`);
    }
    if (tab === "interior" && state.view === "interior" && !selectedRoom) c.insertAdjacentHTML("beforeend", `<span class="note">Дотроос харах өрөөгөө жагсаалтаас сонгоно уу — одоо хамгийн том өрөө.</span>`);
    c.querySelectorAll("[data-seg]").forEach((g) => g.addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-v]"); if (!b || b.disabled) return;
      const v = b.dataset.v, kind = g.dataset.seg;
      if (kind === "Харагдац") { state.view = v; viewer.setView(v); }
      if (kind === "Стиль") { state.style = v; await viewer.setStyle(v); }
      if (kind === "Гэрэл") { state.light = v; viewer.setLight(v); }
      if (kind === "Чанар") { viewer.setQuality(v); }
      renderControls(); syncUrl();
    }));
    left.innerHTML = `<span class="chip">${tab === "interior" ? "Дүрслэл · тавилга, материал жишээ" : "Архитектурын бүрхүүл"}</span>${kind === "inferred" ? `<span class="chip warn">Таамагласан хуваалт</span>` : verif === "demonstration" ? `<span class="chip warn">Жишээ төлөвлөлт</span>` : ""}`;
    right.innerHTML = `<button class="tb" type="button" id="reset-view">Харагдац сэргээх</button>${tab === "interior" ? `<button class="tb" type="button" id="edit-btn" aria-pressed="${state.edit}">Тавилга засах</button>` : ""}`;
    $("reset-view").onclick = () => viewer.resetView();
    if ($("edit-btn")) $("edit-btn").onclick = () => { state.edit = !state.edit; viewer.edit.enabled = state.edit; if (!state.edit) { state.selectedItem = null; viewer.select(null); } renderControls(); renderEdit(); };
  }

  function renderEdit() {
    const bar = $("editbar");
    if (tab !== "interior" || !editor) { bar.hidden = true; return; }
    bar.hidden = false;
    const A = new Map(manifest.assets.map((a) => [a.id, a])), sel = editor.placements.find((x) => x.id === state.selectedItem), a = sel && A.get(sel.asset);
    const count = (st) => editor.placements.filter((x) => A.get(x.asset)?.status === st).length;
    const subs = count("substitute"), lic = count("licensed"), par = count("parametric");
    const diag = [
      ...(restoreNote ? [{ level: "ok", message: restoreNote }] : []),
      ...solverDiag,
      ...(editNote ? [{ level: "error", message: editNote }] : []),
    ];
    const label = { licensed: "лицензтэй загвар", parametric: "параметрт загвар", substitute: "орлуулагч загвар" };
    let html = `<div class="row"><h3>${state.edit ? (a ? esc(a.name) : "Тавилга сонгоно уу") : "Тавилга"}</h3>${a ? `<span class="tag ${a.status}">${label[a.status] ?? a.status}</span><span class="note">${esc(a.source ?? "")} · ${esc(a.license ?? "")}</span>` : `<span class="tag licensed">лицензтэй ${lic}</span><span class="tag parametric">параметрт ${par}</span><span class="tag">орлуулагч ${subs}</span>`}</div>`;
    if (state.edit && sel && a) {
      const same = manifest.assets.filter((x) => x.category === a.category);
      html += `<div class="row">
        <button class="tb" type="button" data-op="rotl">⟲ 90°</button><button class="tb" type="button" data-op="rotr">⟳ 90°</button><button class="tb" type="button" data-op="del">Устгах</button>
        ${same.length > 1 ? `<label class="ctl">Солих <select data-op="replace">${same.map((x) => `<option value="${x.id}" ${x.id === a.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : ""}
        ${(a.variants ?? []).length > 1 ? `<label class="ctl">Материал <select data-op="variant">${a.variants.map((v) => `<option ${v === (sel.variant ?? a.variants[0]) ? "selected" : ""}>${v}</option>`).join("")}</select></label>` : ""}
      </div>`;
      const probs = editor.problemsOf(sel.id);
      if (probs.length) diag.push(...probs.map((p) => ({ level: "error", message: p.message })));
    }
    html += `<div class="row"><button class="tb" type="button" data-op="undo" ${editor.canUndo ? "" : "disabled"}>Буцаах</button><button class="tb" type="button" data-op="redo" ${editor.canRedo ? "" : "disabled"}>Дахих</button><button class="tb" type="button" data-op="reset">Анхны байршил</button><button class="tb" type="button" data-op="save">Хадгалах</button><span class="note">Хадгалалт энэ төхөөрөмжийн хөтөч дотор, ${esc(plan.id)} төрлийн бүх нэгжид хэрэглэгдэнэ.</span></div>`;
    if (diag.length) html += `<ul class="diag">${diag.map((d) => `<li class="${d.level === "error" ? "error" : d.level === "ok" ? "ok" : ""}">${esc(d.message)}</li>`).join("")}</ul>`;
    bar.innerHTML = html;
    bar.querySelectorAll("button[data-op]").forEach((b) => b.addEventListener("click", () => op(b.dataset.op)));
    bar.querySelectorAll("select[data-op]").forEach((s) => s.addEventListener("change", () => op(s.dataset.op, s.value)));
  }
  async function op(kind, value) {
    const id = state.selectedItem, cur = editor.placements.find((x) => x.id === id);
    let r = { ok: true };
    if (kind === "rotl" || kind === "rotr") r = editor.transform(id, { rot: cur.rot + (kind === "rotl" ? 1 : -1) * Math.PI / 2 });
    if (kind === "del") { r = editor.remove(id); state.selectedItem = null; }
    if (kind === "replace") r = editor.replace(id, value);
    if (kind === "variant") r = editor.setVariant(id, value);
    if (kind === "undo") editor.undo();
    if (kind === "redo") editor.redo();
    if (kind === "reset") r = editor.reset();
    if (kind === "save") {
      const { configKey, serialize } = await import("./lib/interior-config.js");
      const ok = store.set(configKey(plan), serialize(plan, { placements: editor.placements, style: state.style, savedAt: new Date().toISOString() }));
      restoreNote = ok ? "Хадгаллаа" : "Хөтөч хадгалах санах ойг хаасан тул хадгалж чадсангүй";
      renderEdit(); return;
    }
    editNote = r.ok ? null : r.problems.map((x) => x.message).join("; ");
    syncFurniture(); viewer.select(state.selectedItem);
  }

  /* copy link, provenance */
  $("copy").onclick = async (e) => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText(location.href); b.textContent = "Холбоос хуулагдлаа"; }
    catch { b.textContent = location.href; }
  };
  const planHash = await sha256(JSON.stringify(plan));
  let dxfHash = "…";
  const dxfFile = entry?.dxf ? `plans/${entry.dxf}` : "plan.dxf";
  fetch(dataUrl(dxfFile)).then((r) => r.arrayBuffer()).then(sha256).then((h) => { dxfHash = h; renderProv(); }).catch(() => { dxfHash = "ачаалсангүй"; renderProv(); });
  let credits = null;
  fetch("./assets/CREDITS.json").then((r) => r.json()).then((c) => { credits = c; renderProv(); }).catch(() => {});
  function renderProv() {
    const rows = [
      ["Төлөвлөлт", `${plan.id} · ${plan.revision}`],
      ["Төлөв", `${verif} — ${VERIFICATION[verif]}`],
      ["Эх файл", `${plan.source?.file ?? "—"}${plan.source?.authoring ? ` (${plan.source.authoring})` : ""}`],
      [`${dxfFile} SHA-256`, dxfHash],
      ["Төлөвлөлтийн JSON SHA-256", planHash],
      ["Геометрийн түлхүүр", geometryKey(plan)],
      ["Координат", `${plan.coordinates?.frame ?? ""}; өрөө: ${plan.coordinates?.rooms ?? ""}; хана: ${plan.coordinates?.walls ?? ""}`],
      ["Шалгалт", validation.diagnostics.length ? validation.diagnostics.map((d) => `${d.level}: ${d.message}`).join(" · ") : "Алдаа, анхааруулгагүй"],
      ["Хэмжилт (энэ хөтөч)", `төлөвлөлт ${fmtM(timing.plan ?? 0, 0)} мс${timing.viewer ? ` · 3D бэлэн ${fmtM(timing.viewer, 0)} мс` : ""}${timing.furnish ? ` · тавилга байршуулалт ${fmtM(timing.furnish, 0)} мс` : ""}`],
    ];
    if (credits) {
      for (const [id, c] of Object.entries(credits.models)) rows.push([`Загвар ${id}`, `${c.source} · ${c.license}${c.attribution_required ? " · нэр заах шаардлагатай: " + c.authors.join("; ") : ""}`]);
      rows.push(["PBR материал", Object.entries(credits.materials).map(([id, c]) => `${id}: ${c.source} (${c.license})`).join(" · ")]);
    }
    $("provkv").innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  }
  renderProv();
  const r0 = params.get("room");
  if (r0 && plan.rooms.some((x) => x.id === r0)) selectRoom(r0, { refit: false });
  if (tab === "shell" && state.view === "interior") state.view = "dollhouse";
  await setTab(tab);
}
