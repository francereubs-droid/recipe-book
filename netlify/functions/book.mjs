import { getStore, getDeployStore } from "@netlify/blobs";

// Shared recipe books.
// Each book has a 6-character code. Blobs:
//   <CODE>/_meta        -> { name, version, created }
//   <CODE>/r/<id>       -> recipe object
// Clients poll GET /api/book?code=X&since=<version>; anything that changes a
// book bumps its version, so other devices pick the change up automatically.

const CODE_RE = /^[A-Z0-9]{6}$/;
const ID_RE = /^[a-z0-9-]{1,48}$/;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_RECIPE_BYTES = 60_000;

function blobStore(context) {
  const opts = { name: "recipe-books", consistency: "strong" };
  if (context?.deploy?.context === "production") return getStore(opts);
  return getDeployStore(opts);
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const newVersion = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function newCode() {
  let c = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) c += CODE_CHARS[b % CODE_CHARS.length];
  return c;
}

const clip = (v, n) => String(v ?? "").slice(0, n);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 100000) : null;
};

function cleanRecipe(r) {
  if (!r || typeof r !== "object" || !ID_RE.test(r.id || "")) return null;
  const recipe = {
    id: r.id,
    name: clip(r.name, 120).trim(),
    category: clip(r.category, 40).trim() || "Other",
    serves: num(r.serves),
    prep: num(r.prep),
    cook: num(r.cook),
    notes: clip(r.notes, 2000),
    ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []).slice(0, 80).map((i) => ({
      qty: num(i?.qty),
      unit: clip(i?.unit, 12),
      name: clip(i?.name, 120),
    })).filter((i) => i.name.trim()),
    method: (Array.isArray(r.method) ? r.method : []).slice(0, 60).map((s) => clip(s, 1500)).filter((s) => s.trim()),
    by: clip(r.by, 40),
    updated: Date.now(),
  };
  if (!recipe.name) return null;
  if (JSON.stringify(recipe).length > MAX_RECIPE_BYTES) return null;
  return recipe;
}

async function bump(store, code, patch = {}) {
  const meta = (await store.get(`${code}/_meta`, { type: "json" })) || {};
  const next = { ...meta, ...patch, version: newVersion() };
  await store.setJSON(`${code}/_meta`, next);
  return next;
}

export default async (req, context) => {
  const store = blobStore(context);
  const url = new URL(req.url);

  if (req.method === "GET") {
    const code = (url.searchParams.get("code") || "").toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: "bad code" }, 400);
    const meta = await store.get(`${code}/_meta`, { type: "json" });
    if (!meta) return json({ error: "Book not found" }, 404);
    if (url.searchParams.get("since") === meta.version) {
      return json({ changed: false, version: meta.version });
    }
    const { blobs } = await store.list({ prefix: `${code}/r/` });
    const recipes = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
    return json({ changed: true, version: meta.version, name: meta.name, code, recipes });
  }

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  if (body.action === "create") {
    const name = clip(body.name, 60).trim() || "Our Recipe Book";
    let code = newCode();
    for (let i = 0; i < 5 && (await store.get(`${code}/_meta`)); i++) code = newCode();
    const seeds = (Array.isArray(body.recipes) ? body.recipes : []).slice(0, 10).map(cleanRecipe).filter(Boolean);
    await Promise.all(seeds.map((r) => store.setJSON(`${code}/r/${r.id}`, r)));
    const meta = { name, created: Date.now(), version: newVersion() };
    await store.setJSON(`${code}/_meta`, meta);
    return json({ code, name, version: meta.version });
  }

  const code = clip(body.code, 6).toUpperCase();
  if (!CODE_RE.test(code)) return json({ error: "bad code" }, 400);
  if (!(await store.get(`${code}/_meta`))) return json({ error: "Book not found" }, 404);

  if (body.action === "save") {
    const recipe = cleanRecipe(body.recipe);
    if (!recipe) return json({ error: "Recipe needs a name (and must not be huge)" }, 400);
    await store.setJSON(`${code}/r/${recipe.id}`, recipe);
    const meta = await bump(store, code);
    return json({ ok: true, recipe, version: meta.version });
  }

  if (body.action === "delete") {
    if (!ID_RE.test(body.id || "")) return json({ error: "bad id" }, 400);
    await store.delete(`${code}/r/${body.id}`);
    const meta = await bump(store, code);
    return json({ ok: true, version: meta.version });
  }

  if (body.action === "rename") {
    const name = clip(body.name, 60).trim();
    if (!name) return json({ error: "name required" }, 400);
    const meta = await bump(store, code, { name });
    return json({ ok: true, name, version: meta.version });
  }

  return json({ error: "unknown action" }, 400);
};

export const config = { path: "/api/book" };
