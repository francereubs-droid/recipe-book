/* Recipe Book — a shared, book-style recipe app.
   Pages: cover → contents → (category divider → recipes)… → end page.
   Sync: polls /api/book every few seconds; any change bumps the book's version. */
(() => {
  "use strict";

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  let toastTimer;
  function toast(msg, ms = 2200) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-on"), ms);
  }

  const DEFAULT_CATS = ["Breakfast", "Mains", "Soups", "Sides & Salads", "Baking", "Desserts", "Snacks", "Drinks"];
  // [text colour, soft background] per category
  const CAT_COLORS = [
    ["#3f7a3a", "#e4f0df"], ["#c0532f", "#fde6dc"], ["#2e6a8e", "#ddedf6"], ["#a8700f", "#fcf0d6"],
    ["#8a4688", "#f3e3f2"], ["#2c7566", "#dcf1ec"], ["#a0582a", "#f8e6d8"], ["#4b52a0", "#e4e6f8"],
  ];

  function catPair(cat) {
    const i = DEFAULT_CATS.indexOf(cat);
    if (i >= 0) return CAT_COLORS[i % CAT_COLORS.length];
    let h = 0;
    for (const c of cat) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return CAT_COLORS[h % CAT_COLORS.length];
  }
  const catColor = (cat) => catPair(cat)[0];
  const catStyle = (cat) => { const [fg, bg] = catPair(cat); return `--tab:${fg};--tab-bg:${bg}`; };

  const CLOCK = `<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2"/></svg>`;
  const PENCIL = `<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>`;
  const CHEV = `<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>`;
  const PEOPLE = `<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M16 5.5a3 3 0 0 1 0 5.6M18 14c1.6.6 2.6 2.2 3 4.5"/></svg>`;

  // ---------- state ----------
  const state = {
    code: null,
    name: "",
    version: null,
    recipes: [],
    pages: [],
    cur: 0,
    scale: {},
    who: LS.get("who", ""),
  };

  // ---------- amounts (metric) ----------
  const trim0 = (s) => s.replace(/\.0+$|(\.\d*?)0+$/, "$1");
  function fraction(q) {
    if (q < 0.2) return trim0(q.toFixed(2));
    let whole = Math.floor(q);
    const rem = q - whole;
    const opts = [[0, ""], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"], [1, ""]];
    let best = opts[0];
    for (const o of opts) if (Math.abs(rem - o[0]) < Math.abs(rem - best[0])) best = o;
    if (best[0] === 1) whole += 1;
    if (!whole) return best[1] || "0";
    return `${whole}${best[1]}`;
  }
  function amount(qty, unit, s) {
    if (unit === "to taste") return "to taste";
    if (qty == null || qty === "") return unit && unit !== "whole" ? unit : "";
    let q = qty * s;
    let u = unit || "";
    if (u === "g" && q >= 1000) { q /= 1000; u = "kg"; }
    else if (u === "kg" && q < 1) { q *= 1000; u = "g"; }
    else if (u === "ml" && q >= 1000) { q /= 1000; u = "L"; }
    else if (u === "L" && q < 1) { q *= 1000; u = "ml"; }
    let str;
    if (["tsp", "tbsp", "cup", "whole", "pinch", ""].includes(u)) str = fraction(q);
    else if (u === "g" || u === "ml") str = q >= 10 ? String(Math.round(q)) : trim0(q.toFixed(1));
    else str = trim0(q >= 100 ? q.toFixed(0) : q >= 10 ? q.toFixed(1) : q.toFixed(2));
    if (u === "pinch" && q > 1) u = "pinches";
    if (u === "cup" && q > 1) u = "cups";
    return u && u !== "whole" ? `${str} ${u}` : str;
  }

  // "200 g plain flour" ⇄ { qty: 200, unit: "g", name: "plain flour" }
  const UNIT_ALIASES = {
    g: "g", gram: "g", grams: "g", gm: "g", gms: "g",
    kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
    ml: "ml", millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml",
    l: "L", litre: "L", litres: "L", liter: "L", liters: "L",
    tsp: "tsp", tsps: "tsp", teaspoon: "tsp", teaspoons: "tsp",
    tbsp: "tbsp", tbsps: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", tbs: "tbsp",
    cup: "cup", cups: "cup", pinch: "pinch", pinches: "pinch",
  };
  const VULGAR = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
  function parseQty(s) {
    s = s.trim().replace(",", ".");
    let m = s.match(/^(\d+)?\s*([¼½¾⅓⅔⅛])$/);
    if (m) return (+m[1] || 0) + VULGAR[m[2]];
    m = s.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
    if (m) return (+m[1] || 0) + +m[2] / +m[3];
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  function parseIngredient(line) {
    let text = line.trim().replace(/^[-•*]\s*/, "");
    if (!text) return null;
    const taste = text.match(/^(.*?)[,\s]+to taste$/i);
    if (taste) return { qty: null, unit: "to taste", name: taste[1].trim() };
    const m = text.match(/^((?:\d+\s+)?\d+\/\d+|\d*\s*[¼½¾⅓⅔⅛]|\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (!m) {
      const p = text.match(/^(?:a\s+)?pinch(?:\s+of)?\s+(.+)$/i);
      return p ? { qty: 1, unit: "pinch", name: p[1] } : { qty: null, unit: "whole", name: text };
    }
    const qty = parseQty(m[1]);
    let rest = m[2];
    const um = rest.match(/^([a-zA-Z]+)\.?(?:\s+of)?\s+(.+)$/) || rest.match(/^([a-zA-Z]+)$/);
    let unit = "whole";
    if (um && UNIT_ALIASES[um[1].toLowerCase()]) {
      unit = UNIT_ALIASES[um[1].toLowerCase()];
      rest = um[2] || "";
    }
    return { qty, unit, name: rest.trim() || text };
  }
  function formatIngredient(g) {
    if (g.unit === "to taste") return `${g.name}, to taste`;
    if (g.qty == null) return g.name;
    const q = trim0(String(Math.round(g.qty * 1000) / 1000));
    return g.unit && g.unit !== "whole" ? `${q} ${g.unit} ${g.name}` : `${q} ${g.name}`;
  }

  // Turn "bake 20–25 minutes" into a tap-to-start timer chip.
  const TIME_RE = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:[.,]\d+)?))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi;
  function methodHTML(step, label) {
    return esc(step).replace(TIME_RE, (m, a, b, unit) => {
      const n = parseFloat((b || a).replace(",", "."));
      const u = unit.toLowerCase();
      const sec = Math.round(n * (u.startsWith("h") ? 3600 : u.startsWith("s") ? 1 : 60));
      if (!sec || sec > 86400) return m;
      return `<button class="t-chip" data-action="timer-step" data-sec="${sec}" data-label="${esc(label)}">${CLOCK}${m}</button>`;
    });
  }

  // ---------- pages ----------
  function categories() {
    const map = new Map();
    for (const r of state.recipes) {
      const c = r.category || "Other";
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(r);
    }
    const names = [...map.keys()].sort((a, b) => {
      const ia = DEFAULT_CATS.indexOf(a), ib = DEFAULT_CATS.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    return names.map((n) => ({ name: n, recipes: map.get(n).sort((a, b) => a.name.localeCompare(b.name)) }));
  }

  function buildPages() {
    const oldKey = state.pages[state.cur]?.key;
    const pages = [{ type: "cover", key: "cover" }, { type: "contents", key: "contents" }];
    for (const c of categories()) {
      pages.push({ type: "divider", cat: c.name, key: "cat:" + c.name, recipes: c.recipes });
      for (const r of c.recipes) pages.push({ type: "recipe", id: r.id, cat: c.name, key: "r:" + r.id });
    }
    pages.push({ type: "end", key: "end" });
    state.pages = pages;
    const idx = pages.findIndex((p) => p.key === oldKey);
    state.cur = idx >= 0 ? idx : clamp(state.cur, 0, pages.length - 1);
  }
  const pageIndex = (key) => state.pages.findIndex((p) => p.key === key);
  const recipeById = (id) => state.recipes.find((r) => r.id === id);

  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  function pageHTML(p, i) {
    switch (p.type) {
      case "cover":
        return `<div>
            <p class="cover-kicker">Recipe book</p>
          </div>
          <div>
            <h1 class="cover-title">${esc(state.name || "Recipe Book")}</h1>
            <p class="cover-meta">${plural(state.recipes.length, "recipe")}</p>
          </div>
          <button class="cover-open" data-action="next">Open the book ${CHEV}</button>`;
      case "contents": {
        const cats = categories();
        if (!cats.length) return `<h2 class="p-head">Contents</h2>
          <div class="empty-state"><p>No recipes yet.<br>Add the first one and it'll appear here.</p>
          <button class="btn btn--primary" data-action="add">+ Add a recipe</button></div>`;
        return `<h2 class="p-head">Contents</h2>
          <ul class="toc">${cats.map((c) => `
            <li><button class="toc__cat" data-action="goto" data-key="cat:${esc(c.name)}" style="${catStyle(c.name)}"><span class="dot"></span>${esc(c.name)}</button></li>
            ${c.recipes.map((r) => `<li><button class="toc__item" data-action="goto" data-key="r:${r.id}"><span>${esc(r.name)}</span><span class="pg">p. ${pageIndex("r:" + r.id) + 1}</span></button></li>`).join("")}
          `).join("")}</ul>`;
      }
      case "divider":
        return `<span class="divider-tag">${plural(p.recipes.length, "recipe")}</span>
          <h2 class="divider-title">${esc(p.cat)}</h2>
          <ul class="divider-list">${p.recipes.map((r) => `<li><button data-action="goto" data-key="r:${r.id}"><span>${esc(r.name)}</span>${CHEV}</button></li>`).join("")}</ul>`;
      case "recipe": {
        const r = recipeById(p.id);
        if (!r) return "";
        const s = state.scale[r.id] || 1;
        const meta = [
          r.serves ? `<span>${PEOPLE}Serves <b>${Math.round(r.serves * s)}</b></span>` : "",
          r.prep ? `<span>${CLOCK}Prep <b>${r.prep} min</b></span>` : "",
          r.cook ? `<span>${CLOCK}Cook <b>${r.cook} min</b></span>` : "",
        ].filter(Boolean).join("");
        return `<div class="r-top">
            <span class="r-cat">${esc(r.category)}</span>
            <button class="r-edit" data-action="edit" data-id="${r.id}">${PENCIL}Edit</button>
          </div>
          <h2 class="r-title">${esc(r.name)}</h2>
          ${r.by ? `<div class="r-by">Added by ${esc(r.by)}</div>` : ""}
          ${meta ? `<div class="r-meta">${meta}</div>` : ""}
          <div class="scaler"><span class="scaler__label">Batch size</span>
            <div class="seg" role="group" aria-label="Scale recipe">
              ${[1, 2, 4].map((n) => `<button data-action="scale" data-id="${r.id}" data-s="${n}" class="${n === s ? "is-on" : ""}" aria-pressed="${n === s}">${n}×</button>`).join("")}
            </div></div>
          <h3 class="r-section">Ingredients</h3>
          ${r.ingredients.length ? `<ul class="ing">${r.ingredients.map((g) => `<li><span class="q">${esc(amount(g.qty, g.unit, s))}</span><span>${esc(g.name)}</span></li>`).join("")}</ul>` : `<p class="hint">No ingredients listed.</p>`}
          <h3 class="r-section">Method</h3>
          ${r.method.length ? `<ol class="method">${r.method.map((st, n) => `<li>${methodHTML(st, `${r.name} · step ${n + 1}`)}</li>`).join("")}</ol>` : `<p class="hint">No method yet.</p>`}
          ${r.notes ? `<div class="r-notes">${esc(r.notes)}</div>` : ""}`;
      }
      case "end":
        return `<h2 class="p-head">The end… for now</h2>
          <p>Got another favourite? Add it to the book.</p>
          <button class="btn btn--primary" data-action="add">+ Add a recipe</button>
          <button class="btn" data-action="goto" data-key="contents">Back to contents</button>`;
    }
    return "";
  }

  function makePage(i) {
    const p = state.pages[i];
    const el = document.createElement("div");
    el.className = `page p-${p.type}`;
    if (p.cat) el.setAttribute("style", catStyle(p.cat));
    el.innerHTML = `<div class="page__scroll">${pageHTML(p, i)}</div>
      ${i > 1 ? `<button class="dog-ear dog-ear--prev" data-action="prev" aria-label="Previous page"></button>` : ""}
      ${i > 0 && i < state.pages.length - 1 ? `<button class="dog-ear dog-ear--next" data-action="next" aria-label="Next page"></button>` : ""}`;
    return el;
  }

  const stage = $("#stage");
  let currentEl = $("#current");

  function renderCurrent(keepScroll = false) {
    const prevScroll = keepScroll ? currentEl.querySelector(".page__scroll")?.scrollTop || 0 : 0;
    const el = makePage(state.cur);
    el.id = "current";
    currentEl.replaceWith(el);
    currentEl = el;
    if (prevScroll) el.querySelector(".page__scroll").scrollTop = prevScroll;
    renderChrome();
  }

  function renderChrome() {
    $("#bookName").textContent = state.name || "Recipe Book";
    document.title = `${state.name || "Recipe Book"} · Recipes`;
    $("#pageNum").textContent = `${state.cur + 1} of ${state.pages.length}`;
    $('.pager [data-action="prev"]').disabled = state.cur === 0;
    $('.pager [data-action="next"]').disabled = state.cur >= state.pages.length - 1;
    const cats = categories();
    const curCat = state.pages[state.cur]?.cat;
    const html = cats.map((c) => `<button class="cat-chip${c.name === curCat ? " is-active" : ""}" style="${catStyle(c.name)}" data-action="goto" data-key="cat:${esc(c.name)}">${esc(c.name)}<span class="n">${c.recipes.length}</span></button>`).join("");
    const nav = $("#cats");
    if (nav.innerHTML !== html) nav.innerHTML = html;
    nav.hidden = !cats.length;
    nav.querySelector(".is-active")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }

  // ---------- page flipping ----------
  let flipping = false;
  let pendingRender = false;
  let flip = null; // { dir, target, leaf, under, shadow }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  function beginFlip(dir, target) {
    const fromScroll = currentEl.querySelector(".page__scroll")?.scrollTop || 0;
    const under = makePage(dir > 0 ? target : state.cur);
    const front = makePage(dir > 0 ? state.cur : target);
    if (dir < 0) under.querySelector(".page__scroll").scrollTop = fromScroll;
    else front.querySelector(".page__scroll").scrollTop = fromScroll;

    const shadow = document.createElement("div");
    shadow.className = "under-shadow";

    const leaf = document.createElement("div");
    leaf.className = "leaf";
    leaf.innerHTML = `<div class="leaf__face leaf__front"></div><div class="leaf__face leaf__back"><div class="page"></div><div class="leaf__shade"></div></div>`;
    const frontFace = leaf.querySelector(".leaf__front");
    frontFace.append(front);
    const shade = document.createElement("div");
    shade.className = "leaf__shade";
    frontFace.append(shade);

    stage.append(under, shadow, leaf);
    currentEl.style.visibility = "hidden";
    flip = { dir, target, leaf, under, shadow, angle: dir > 0 ? 0 : -180 };
    setAngle(flip.angle);
  }

  function setAngle(a) {
    if (!flip) return;
    flip.angle = a;
    const p = -a / 180; // 0 → 1 as the leaf turns over
    flip.leaf.style.transform = `rotateY(${a}deg)`;
    flip.leaf.style.setProperty("--shade", (p < 0.5 ? p * 2 : (1 - p) * 2).toFixed(3));
    flip.shadow.style.setProperty("--under", ((1 - p) * 0.75 * Math.min(1, p * 6)).toFixed(3));
  }

  function animateAngle(to, ms, fn = ease) {
    return new Promise((resolve) => {
      const from = flip.angle;
      const t0 = performance.now();
      const step = (now) => {
        const t = clamp((now - t0) / ms, 0, 1);
        setAngle(from + (to - from) * fn(t));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  function endFlip(completed) {
    if (!flip) return;
    const { target, leaf, under, shadow } = flip;
    if (completed) state.cur = target;
    leaf.remove(); under.remove(); shadow.remove();
    flip = null;
    currentEl.style.visibility = "";
    if (completed || pendingRender) { renderCurrent(!completed); pendingRender = false; }
  }

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  async function flipTo(target) {
    target = clamp(target, 0, state.pages.length - 1);
    if (flipping || target === state.cur) return;
    if (reduceMotion) { state.cur = target; renderCurrent(); return; }
    flipping = true;
    const dir = Math.sign(target - state.cur);
    const dist = Math.abs(target - state.cur);
    const hops = Math.min(dist, 5);
    const start = state.cur;
    for (let k = 1; k <= hops; k++) {
      const idx = k === hops ? target : start + dir * Math.round((dist * k) / hops);
      const last = k === hops;
      beginFlip(dir, idx);
      const ms = hops === 1 ? 620 : last ? 520 : 230;
      await animateAngle(dir > 0 ? -180 : 0, ms, hops > 1 && !last ? (t) => t : ease);
      endFlip(true);
    }
    flipping = false;
  }
  // Tapping a recipe, category, contents or search result jumps straight there.
  function jumpTo(target) {
    target = clamp(target, 0, state.pages.length - 1);
    if (flipping || target === state.cur) return;
    state.cur = target;
    renderCurrent();
    if (!reduceMotion) {
      currentEl.classList.add("page--arrive");
      currentEl.addEventListener("animationend", () => currentEl.classList.remove("page--arrive"), { once: true });
    }
  }
  const next = () => flipTo(state.cur + 1);
  const prev = () => flipTo(state.cur - 1);

  // Drag a page to turn it.
  let drag = null;
  let suppressClick = false;
  stage.addEventListener("pointerdown", (e) => {
    suppressClick = false;
    if (flipping || e.button > 0 || e.target.closest("input, textarea, select")) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, decided: false, hist: [[e.clientX, performance.now()]] };
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.decided) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        const dir = dx < 0 ? 1 : -1;
        const target = state.cur + dir;
        if (target < 0 || target >= state.pages.length) { drag = null; return; }
        drag.decided = true;
        drag.dir = dir;
        flipping = true;
        suppressClick = true;
        try { stage.setPointerCapture(e.pointerId); } catch {}
        beginFlip(dir, target);
      } else if (Math.abs(dy) > 12) { drag = null; return; }
      else return;
    }
    e.preventDefault();
    const W = stage.clientWidth;
    const turned = clamp((Math.abs(dx) / W) * 180 * 1.15, 0, 180);
    setAngle(drag.dir > 0 ? -turned * (dx < 0 ? 1 : 0) : -180 + turned * (dx > 0 ? 1 : 0));
    drag.hist.push([e.clientX, performance.now()]);
    if (drag.hist.length > 6) drag.hist.shift();
  });
  async function release(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    if (!d.decided) return;
    const [x0, t0] = d.hist[0];
    const [x1, t1] = d.hist[d.hist.length - 1];
    const v = (x1 - x0) / Math.max(1, t1 - t0); // px/ms
    const a = flip.angle;
    const complete = d.dir > 0 ? a < -75 || v < -0.45 : a > -105 || v > 0.45;
    const to = complete ? (d.dir > 0 ? -180 : 0) : (d.dir > 0 ? 0 : -180);
    const ms = clamp((Math.abs(to - a) / 180) * 520, 140, 520);
    await animateAngle(to, ms, easeOut);
    endFlip(complete);
    flipping = false;
  }
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  document.addEventListener("click", (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select")) { if (e.key === "Escape") closeSheets(); return; }
    if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === "Escape") closeSheets();
    else if (e.key === "/" && !$("#app").hidden) { e.preventDefault(); openSearch(); }
  });

  // ---------- sync with the server ----------
  const api = async (method, body, qs = "") => {
    const res = await fetch(`/api/book${qs}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || `HTTP ${res.status}`); err.status = res.status; throw err; }
    return data;
  };

  function setSync(mode) {
    const s = $("#sync");
    s.classList.toggle("is-busy", mode === "busy");
    s.classList.toggle("is-off", mode === "off");
    $("#syncText").textContent = mode === "busy" ? "Saving…" : mode === "off" ? "Offline" : "Synced";
  }

  function applyData(d) {
    state.recipes = d.recipes || [];
    state.name = d.name || state.name;
    state.version = d.version;
    LS.set("book:" + state.code, { name: state.name, version: d.version, recipes: state.recipes });
    rememberBook(state.code, state.name);
    buildPages();
    if (flip) pendingRender = true;
    else renderCurrent(true);
  }

  let pollTimer;
  let pulling = false;
  async function pull() {
    clearTimeout(pollTimer);
    if (state.code && !document.hidden && !pulling) {
      pulling = true;
      try {
        const d = await api("GET", null, `?code=${state.code}&since=${encodeURIComponent(state.version || "")}`);
        if (d.changed) applyData(d);
        if ($("#sync").classList.contains("is-off")) setSync("ok");
      } catch (err) {
        if (err.status === 404) { toast("That book no longer exists"); forgetBook(state.code); showWelcome(); pulling = false; return; }
        setSync("off");
      }
      pulling = false;
    }
    pollTimer = setTimeout(pull, 4000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
  window.addEventListener("focus", pull);
  window.addEventListener("online", pull);

  async function write(body) {
    setSync("busy");
    try {
      const d = await api("POST", { ...body, code: state.code });
      setSync("ok");
      return d;
    } catch (err) {
      setSync("off");
      toast(err.status ? err.message : "Couldn't save — check your connection", 3000);
      state.version = null; // force a full refresh
      pull();
      throw err;
    }
  }

  // ---------- books on this device ----------
  function rememberBook(code, name) {
    const books = LS.get("books", []).filter((b) => b.code !== code);
    books.unshift({ code, name });
    LS.set("books", books.slice(0, 12));
    LS.set("current", code);
  }
  function forgetBook(code) {
    LS.set("books", LS.get("books", []).filter((b) => b.code !== code));
    if (LS.get("current") === code) LS.set("current", null);
  }

  function openBook(code, cached) {
    state.code = code;
    state.version = null;
    state.cur = 0;
    state.pages = [];
    const c = cached || LS.get("book:" + code, null);
    state.name = c?.name || "";
    state.recipes = c?.recipes || [];
    LS.set("current", code);
    $("#welcome").hidden = true;
    $("#app").hidden = false;
    buildPages();
    renderCurrent();
    pull();
  }

  function showWelcome() {
    clearTimeout(pollTimer);
    state.code = null;
    $("#app").hidden = true;
    $("#welcome").hidden = false;
    closeSheets();
    const f = $("#createForm"), j = $("#joinForm");
    if (state.who) { f.who.value = state.who; j.who.value = state.who; }
  }

  const SEEDS = () => [
    {
      id: "pancakes-" + uid().slice(0, 5), name: "Fluffy Pancakes", category: "Breakfast", serves: 4, prep: 10, cook: 15,
      ingredients: [
        { qty: 250, unit: "g", name: "plain flour" }, { qty: 2, unit: "tsp", name: "baking powder" },
        { qty: 1, unit: "tbsp", name: "caster sugar" }, { qty: 1, unit: "pinch", name: "salt" },
        { qty: 2, unit: "whole", name: "eggs" }, { qty: 300, unit: "ml", name: "milk" },
        { qty: 30, unit: "g", name: "butter, melted, plus extra for the pan" },
      ],
      method: [
        "Whisk the flour, baking powder, sugar and salt together in a large bowl.",
        "In a jug, whisk the eggs, milk and melted butter. Pour into the dry ingredients and stir until just combined — a few lumps are fine.",
        "Rest the batter for 5 minutes.",
        "Heat a little butter in a frying pan over medium heat. Pour in about 60 ml of batter per pancake.",
        "Cook for 2 minutes until bubbles appear, flip, then cook 1 minute more. Serve warm.",
      ],
      notes: "Example recipe — edit or delete me!",
    },
    {
      id: "cookies-" + uid().slice(0, 5), name: "Chocolate Chip Cookies", category: "Baking", serves: 24, prep: 15, cook: 12,
      ingredients: [
        { qty: 125, unit: "g", name: "butter, softened" }, { qty: 100, unit: "g", name: "brown sugar" },
        { qty: 50, unit: "g", name: "caster sugar" }, { qty: 1, unit: "whole", name: "egg" },
        { qty: 1, unit: "tsp", name: "vanilla essence" }, { qty: 225, unit: "g", name: "plain flour" },
        { qty: 0.5, unit: "tsp", name: "baking soda" }, { qty: 200, unit: "g", name: "chocolate chips" },
      ],
      method: [
        "Preheat the oven to 180°C (160°C fan) and line two trays with baking paper.",
        "Cream the butter and both sugars until pale, then beat in the egg and vanilla.",
        "Mix in the flour and baking soda, then fold through the chocolate chips.",
        "Chill the dough for 30 minutes.",
        "Roll into balls and space them out on the trays. Bake for 10–12 minutes until golden at the edges.",
        "Cool on the tray for 5 minutes before moving to a rack.",
      ],
      notes: "Example recipe — edit or delete me!",
    },
    {
      id: "bolognese-" + uid().slice(0, 5), name: "Spaghetti Bolognese", category: "Mains", serves: 4, prep: 15, cook: 45,
      ingredients: [
        { qty: 1, unit: "tbsp", name: "olive oil" }, { qty: 1, unit: "whole", name: "onion, finely diced" },
        { qty: 2, unit: "whole", name: "garlic cloves, crushed" }, { qty: 500, unit: "g", name: "beef mince" },
        { qty: 800, unit: "g", name: "tinned chopped tomatoes" }, { qty: 2, unit: "tbsp", name: "tomato paste" },
        { qty: 1, unit: "tsp", name: "dried oregano" }, { qty: 400, unit: "g", name: "spaghetti" },
        { qty: null, unit: "to taste", name: "salt & pepper" },
      ],
      method: [
        "Heat the oil in a large pan and cook the onion for 5 minutes until soft. Add the garlic for 1 minute.",
        "Add the mince and brown it, breaking it up as it cooks.",
        "Stir in the tomatoes, tomato paste and oregano. Simmer gently for 30 minutes, stirring now and then.",
        "Meanwhile cook the spaghetti in salted boiling water for 10 minutes, or as the packet says.",
        "Season the sauce and serve over the drained spaghetti.",
      ],
      notes: "Example recipe — edit or delete me!",
    },
  ];

  $("#createForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const btn = f.querySelector("button");
    btn.disabled = true;
    $("#welcomeError").textContent = "";
    if (f.who.value.trim()) { state.who = f.who.value.trim(); LS.set("who", state.who); }
    try {
      const seeds = SEEDS().map((r) => ({ ...r, by: state.who }));
      const d = await api("POST", { action: "create", name: f.name.value, recipes: seeds });
      rememberBook(d.code, d.name);
      openBook(d.code, { name: d.name, recipes: [] });
      setTimeout(() => openMenu(), 900);
      toast("Book created! Share the code so others can join.", 3200);
    } catch (err) {
      $("#welcomeError").textContent = "Couldn't create the book — check your connection and try again.";
    }
    btn.disabled = false;
  });

  async function joinBook(code) {
    code = code.trim().toUpperCase();
    try {
      const d = await api("GET", null, `?code=${code}`);
      rememberBook(code, d.name);
      openBook(code, { name: d.name, recipes: d.recipes });
      toast(`Opened “${d.name}”`);
      return true;
    } catch (err) {
      $("#welcomeError").textContent = err.status === 404 || err.status === 400 ? "No book found with that code." : "Couldn't reach the server — try again.";
      return false;
    }
  }
  $("#joinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (f.who.value.trim()) { state.who = f.who.value.trim(); LS.set("who", state.who); }
    $("#welcomeError").textContent = "";
    await joinBook(f.code.value);
  });

  // ---------- sheets ----------
  function openSheet(id) {
    $$(".sheet").forEach((s) => (s.hidden = s.id !== id));
    $("#scrim").hidden = false;
  }
  function closeSheets() {
    $$(".sheet").forEach((s) => (s.hidden = true));
    $("#scrim").hidden = true;
    document.activeElement?.blur?.();
  }
  $("#scrim").addEventListener("click", closeSheets);

  // Search
  function openSearch() {
    openSheet("searchSheet");
    const inp = $("#searchInput");
    inp.value = "";
    renderResults("");
    setTimeout(() => inp.focus(), 60);
  }
  function renderResults(q) {
    const term = q.trim().toLowerCase();
    let list = state.recipes.filter((r) => !term || r.name.toLowerCase().includes(term));
    list.sort((a, b) => {
      const sa = a.name.toLowerCase().startsWith(term) ? 0 : 1, sb = b.name.toLowerCase().startsWith(term) ? 0 : 1;
      return sa - sb || a.name.localeCompare(b.name);
    });
    const hi = (name) => {
      if (!term) return esc(name);
      const i = name.toLowerCase().indexOf(term);
      return esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + term.length)) + "</mark>" + esc(name.slice(i + term.length));
    };
    $("#results").innerHTML = list.length
      ? list.map((r) => `<li><button data-action="goto" data-key="r:${r.id}" style="${catStyle(r.category)}"><span class="name">${hi(r.name)}</span><span class="cat">${esc(r.category)}</span></button></li>`).join("")
      : `<li class="empty">${state.recipes.length ? "No recipe by that name" : "No recipes yet"}</li>`;
  }
  $("#searchInput").addEventListener("input", (e) => renderResults(e.target.value));
  $("#searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("#results button")?.click(); }
  });

  // Menu
  function openMenu() {
    $("#shareCode").textContent = state.code;
    $("#whoLabel").textContent = state.who ? `· ${state.who}` : "· not set";
    const others = LS.get("books", []).filter((b) => b.code !== state.code);
    $("#bookList").innerHTML = others.length
      ? `<p class="menu__sub">Switch to another book</p>` + others.map((b) => `<button class="menu__item" data-action="switch-book" data-code="${esc(b.code)}"><span>${esc(b.name || b.code)}</span>${CHEV}</button>`).join("")
      : "";
    openSheet("menuSheet");
  }
  const inviteLink = () => `${location.origin}/?book=${state.code}`;
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg); }
    catch { prompt("Copy this:", text); }
  }

  // ---------- recipe editor ----------
  let editing = null;
  let pickedCat = null;
  function renderCatPick() {
    const set = new Set([...DEFAULT_CATS, ...state.recipes.map((r) => r.category)]);
    if (pickedCat && pickedCat !== "__new") set.add(pickedCat);
    $("#catPick").innerHTML = [...set].map((c) => `<button type="button" data-action="pick-cat" data-cat="${esc(c)}" style="${catStyle(c)}" class="${c === pickedCat ? "is-on" : ""}">${esc(c)}</button>`).join("")
      + `<button type="button" class="chip-new${pickedCat === "__new" ? " is-on" : ""}" data-action="pick-cat" data-cat="__new">+ New</button>`;
    $("#newCatInput").hidden = pickedCat !== "__new";
  }
  function openEditor(recipe) {
    editing = recipe || null;
    const f = $("#editForm");
    f.reset();
    $("#editTitle").textContent = recipe ? "Edit recipe" : "New recipe";
    $("#deleteBtn").hidden = !recipe;
    const curCat = state.pages[state.cur]?.cat;
    pickedCat = recipe?.category || curCat || DEFAULT_CATS[1];
    renderCatPick();
    f.name.value = recipe?.name || "";
    f.serves.value = recipe?.serves ?? "";
    f.prep.value = recipe?.prep ?? "";
    f.cook.value = recipe?.cook ?? "";
    f.ingredients.value = (recipe?.ingredients || []).map(formatIngredient).join("\n");
    f.method.value = (recipe?.method || []).join("\n");
    f.notes.value = recipe?.notes || "";
    openSheet("editSheet");
    $("#editSheet").scrollTop = 0;
    if (!recipe) setTimeout(() => f.name.focus(), 300);
  }

  $("#editForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    let category = pickedCat;
    if (category === "__new") category = f.newCategory.value.trim();
    if (!category) { toast("Give the new category a name"); return; }
    const numOrNull = (v) => (v === "" || v == null ? null : Math.max(0, parseFloat(String(v).replace(",", "."))) || null);
    const ingredients = f.ingredients.value.split("\n").map(parseIngredient).filter((g) => g && g.name);
    const recipe = {
      id: editing?.id || (f.name.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "recipe") + "-" + uid().slice(0, 5),
      name: f.name.value.trim(),
      category,
      serves: numOrNull(f.serves.value),
      prep: numOrNull(f.prep.value),
      cook: numOrNull(f.cook.value),
      ingredients,
      method: f.method.value.split("\n").map((s) => s.trim()).filter(Boolean),
      notes: f.notes.value.trim(),
      by: editing?.by || state.who,
    };
    if (!recipe.name) return;
    // optimistic update
    state.recipes = [...state.recipes.filter((r) => r.id !== recipe.id), recipe];
    closeSheets();
    buildPages();
    renderCurrent(true);
    setTimeout(() => jumpTo(pageIndex("r:" + recipe.id)), 200);
    try {
      const d = await write({ action: "save", recipe });
      state.version = null; // pull the canonical copy (and anything others changed)
      pull();
      toast(editing ? "Recipe updated" : "Recipe added to the book");
      return d;
    } catch {}
  });

  async function deleteRecipe() {
    if (!editing || !confirm(`Delete “${editing.name}” from the book? This can't be undone.`)) return;
    const id = editing.id;
    const cat = editing.category;
    state.recipes = state.recipes.filter((r) => r.id !== id);
    closeSheets();
    const onIt = state.pages[state.cur]?.key === "r:" + id;
    buildPages();
    if (onIt) state.cur = Math.max(0, pageIndex("cat:" + cat) >= 0 ? pageIndex("cat:" + cat) : 1);
    renderCurrent();
    try { await write({ action: "delete", id }); toast("Recipe deleted"); } catch {}
  }

  // ---------- timers ----------
  let timers = LS.get("timers", []);
  let setterSec = 300;
  let actx = null;
  let alarmLoop = null;
  let wakeLock = null;

  const tLeft = (t) => (t.end ? Math.max(0, (t.end - Date.now()) / 1000) : t.left);
  const saveTimers = () => LS.set("timers", timers);
  function fmt(sec) {
    sec = Math.ceil(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  function unlockAudio() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
    } catch {}
  }
  function beep() {
    if (!actx) return;
    const t0 = actx.currentTime;
    [0, 0.22, 0.44].forEach((d) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "triangle";
      o.frequency.value = 988;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
      o.connect(g).connect(actx.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.2);
    });
  }
  function ring(t) {
    $("#alarmTitle").textContent = "Time's up!";
    $("#alarmSub").textContent = t.label || fmt(t.total) + " timer";
    $("#alarm").hidden = false;
    if (!alarmLoop) {
      const go = () => { beep(); navigator.vibrate?.([250, 120, 250, 120, 250]); };
      go();
      alarmLoop = setInterval(go, 1400);
    }
  }
  function stopAlarm() {
    clearInterval(alarmLoop);
    alarmLoop = null;
    navigator.vibrate?.(0);
    $("#alarm").hidden = true;
    timers = timers.filter((t) => !t.done);
    saveTimers();
    renderTimerList();
    updateTimerUI();
  }
  async function syncWake() {
    const running = timers.some((t) => t.end);
    try {
      if (running && !wakeLock && "wakeLock" in navigator && !document.hidden) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => (wakeLock = null));
      } else if (!running && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {}
  }
  function startTimer(sec, label) {
    if (!sec) return;
    unlockAudio();
    timers.push({ id: uid(), label: label || "", total: sec, left: sec, end: Date.now() + sec * 1000, done: false });
    saveTimers();
    renderTimerList();
    updateTimerUI();
    syncWake();
  }
  function renderSetter() { $("#setterDisplay").textContent = fmt(setterSec); }
  function renderTimerList() {
    const PLAY = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
    const PAUSE = `<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>`;
    const X = `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
    $("#timerList").innerHTML = timers.map((t) => `
      <li class="timer-item${t.done ? " is-done" : ""}" data-tid="${t.id}">
        <span class="timer-item__time">${t.done ? "Done!" : fmt(tLeft(t))}</span>
        <span class="timer-item__label">${esc(t.label || fmt(t.total) + " timer")}${!t.end && !t.done ? " · paused" : ""}</span>
        <span class="timer-item__btns">
          <button data-action="t-plus" data-id="${t.id}" aria-label="Add 1 minute">+1</button>
          ${t.done ? "" : `<button data-action="t-toggle" data-id="${t.id}" aria-label="${t.end ? "Pause" : "Resume"}">${t.end ? PAUSE : PLAY}</button>`}
          <button data-action="t-del" data-id="${t.id}" aria-label="Remove timer">${X}</button>
        </span>
        <span class="timer-bar"><i></i></span>
      </li>`).join("");
    updateTimerUI();
  }
  function updateTimerUI() {
    for (const t of timers) {
      const li = $(`.timer-item[data-tid="${t.id}"]`);
      if (!li) continue;
      if (!t.done) li.querySelector(".timer-item__time").textContent = fmt(tLeft(t));
      li.querySelector(".timer-bar i").style.width = `${t.done ? 100 : (1 - tLeft(t) / t.total) * 100}%`;
    }
    const pill = $("#timerBtn");
    const done = timers.find((t) => t.done);
    const running = timers.filter((t) => t.end).sort((a, b) => a.end - b.end);
    pill.classList.toggle("is-done", !!done);
    pill.classList.toggle("is-running", !done && running.length > 0);
    $("#timerBtnText").textContent = done ? "Done!" : running.length ? fmt(tLeft(running[0])) + (running.length > 1 ? ` +${running.length - 1}` : "") : timers.length ? "Paused" : "Timer";
  }
  setInterval(() => {
    let changed = false;
    for (const t of timers) {
      if (t.end && !t.done && Date.now() >= t.end) {
        t.done = true; t.end = null; t.left = 0; changed = true;
        ring(t);
      }
    }
    if (changed) { saveTimers(); renderTimerList(); syncWake(); }
    else updateTimerUI();
  }, 250);
  document.addEventListener("visibilitychange", syncWake);

  // ---------- actions ----------
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    switch (a) {
      case "next": next(); break;
      case "prev": prev(); break;
      case "search": openSearch(); break;
      case "add": openEditor(null); break;
      case "menu": openMenu(); break;
      case "close": closeSheets(); break;
      case "goto": {
        const i = pageIndex(el.dataset.key);
        if (i < 0) break;
        const fromSheet = !!el.closest(".sheet");
        closeSheets();
        if (fromSheet) setTimeout(() => jumpTo(i), 120);
        else jumpTo(i);
        break;
      }
      case "scale": {
        const s = +el.dataset.s;
        state.scale[el.dataset.id] = s;
        renderCurrent(true);
        $$(".ing .q", currentEl).forEach((q) => q.classList.add("flash"));
        break;
      }
      case "edit": openEditor(recipeById(el.dataset.id)); break;
      case "delete": deleteRecipe(); break;
      case "pick-cat":
        pickedCat = el.dataset.cat;
        renderCatPick();
        if (pickedCat === "__new") setTimeout(() => $("#newCatInput").focus(), 30);
        break;
      case "welcome-tab": {
        const join = el.dataset.tab === "join";
        $$('[data-action="welcome-tab"]').forEach((b) => b.classList.toggle("is-on", b === el));
        $("#createForm").hidden = join;
        $("#joinForm").hidden = !join;
        $("#welcomeError").textContent = "";
        break;
      }
      case "share": {
        const text = `Join our recipe book “${state.name}” — open the link, or enter code ${state.code}`;
        if (navigator.share) navigator.share({ title: state.name, text, url: inviteLink() }).catch(() => {});
        else copy(inviteLink(), "Invite link copied");
        break;
      }
      case "copy-code": copy(state.code, "Code copied"); break;
      case "rename": {
        const n = prompt("Book name", state.name);
        if (n && n.trim()) {
          state.name = n.trim();
          renderChrome();
          if (state.cur === 0) renderCurrent();
          write({ action: "rename", name: state.name }).then(() => toast("Book renamed")).catch(() => {});
          closeSheets();
        }
        break;
      }
      case "set-name": {
        const n = prompt("Your name (shown on recipes you add)", state.who);
        if (n != null) { state.who = n.trim(); LS.set("who", state.who); $("#whoLabel").textContent = state.who ? `(${state.who})` : "(not set)"; }
        break;
      }
      case "switch-book": closeSheets(); openBook(el.dataset.code); break;
      case "new-book": showWelcome(); break;
      case "timers": unlockAudio(); renderSetter(); renderTimerList(); openSheet("timerSheet"); break;
      case "t-adj": setterSec = clamp(setterSec + +el.dataset.d, 0, 6 * 3600); renderSetter(); break;
      case "t-set": setterSec = +el.dataset.s; renderSetter(); break;
      case "t-start": {
        if (!setterSec) { toast("Set a time first"); break; }
        startTimer(setterSec, $("#timerLabel").value.trim());
        $("#timerLabel").value = "";
        toast(`Timer started · ${fmt(setterSec)}`);
        break;
      }
      case "t-toggle": {
        const t = timers.find((x) => x.id === el.dataset.id);
        if (!t) break;
        if (t.end) { t.left = tLeft(t); t.end = null; } else { unlockAudio(); t.end = Date.now() + t.left * 1000; }
        saveTimers(); renderTimerList(); syncWake();
        break;
      }
      case "t-plus": {
        const t = timers.find((x) => x.id === el.dataset.id);
        if (!t) break;
        if (t.done) { t.done = false; t.left = 60; t.total = 60; t.end = Date.now() + 60000; if (!timers.some((x) => x.done)) stopAlarmSoundOnly(); }
        else if (t.end) { t.end += 60000; t.total += 60; }
        else { t.left += 60; t.total += 60; }
        saveTimers(); renderTimerList(); syncWake();
        break;
      }
      case "t-del": {
        timers = timers.filter((x) => x.id !== el.dataset.id);
        if (!timers.some((x) => x.done)) stopAlarmSoundOnly();
        saveTimers(); renderTimerList(); syncWake();
        break;
      }
      case "timer-step": {
        const sec = +el.dataset.sec;
        startTimer(sec, el.dataset.label);
        toast(`⏱ Timer started · ${fmt(sec)}`);
        break;
      }
      case "alarm-stop": stopAlarm(); break;
    }
  });
  function stopAlarmSoundOnly() {
    clearInterval(alarmLoop);
    alarmLoop = null;
    navigator.vibrate?.(0);
    $("#alarm").hidden = true;
  }

  // ---------- start ----------
  updateTimerUI();
  if (timers.some((t) => t.done)) timers.filter((t) => t.done).forEach(ring);
  syncWake();

  const params = new URLSearchParams(location.search);
  const invite = (params.get("book") || "").toUpperCase();
  if (invite) history.replaceState(null, "", location.pathname);
  const current = LS.get("current", null);
  if (invite && /^[A-Z0-9]{6}$/.test(invite)) {
    if (invite === current) openBook(invite);
    else {
      showWelcome();
      $('[data-action="welcome-tab"][data-tab="join"]').click();
      $("#joinForm").code.value = invite;
      joinBook(invite);
    }
  } else if (current) openBook(current);
  else showWelcome();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
})();
