// Recipe Book — Cloudflare Worker.
// Static files in /public are served automatically; this script only handles
// /api/book. All books live in one SQLite-backed Durable Object ("BookStore"),
// so there's no separate database to set up and every read is up to date.
//   books(code, name, version, created)
//   recipes(code, id, data)  -- data is the recipe JSON
// Clients poll GET /api/book?code=X&since=<version>; every change bumps the
// book's version so other phones pick it up automatically.

import { DurableObject } from "cloudflare:workers";

const CODE_RE = /^[A-Z0-9]{6}$/;
const ID_RE = /^[a-z0-9-]{1,48}$/;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_RECIPE_BYTES = 60_000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const newVersion = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function newCode() {
  let c = "";
  for (const b of crypto.getRandomValues(new Uint8Array(6))) c += CODE_CHARS[b % CODE_CHARS.length];
  return c;
}

const clip = (v, n) => String(v ?? "").slice(0, n);
const num = (v) => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) && n >= 0 ? Math.min(n, 100000) : null;
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

export class BookStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS books (code TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, created INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS recipes (code TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (code, id))");
  }

  book(code) {
    return this.sql.exec("SELECT name, version FROM books WHERE code = ?", code).toArray()[0] || null;
  }

  bump(code) {
    const version = newVersion();
    this.sql.exec("UPDATE books SET version = ? WHERE code = ?", version, code);
    return version;
  }

  tx(fn) {
    return this.ctx.storage.transactionSync(fn);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      const code = (url.searchParams.get("code") || "").toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: "bad code" }, 400);
      const book = this.book(code);
      if (!book) return json({ error: "Book not found" }, 404);
      if (url.searchParams.get("since") === book.version) return json({ changed: false, version: book.version });
      const recipes = this.sql.exec("SELECT data FROM recipes WHERE code = ?", code).toArray()
        .map((row) => { try { return JSON.parse(row.data); } catch { return null; } })
        .filter(Boolean);
      return json({ changed: true, version: book.version, name: book.name, code, recipes });
    }

    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }

    if (body.action === "create") {
      const name = clip(body.name, 60).trim() || "Our Recipe Book";
      let code = newCode();
      for (let i = 0; i < 5 && this.book(code); i++) code = newCode();
      const version = newVersion();
      const seeds = (Array.isArray(body.recipes) ? body.recipes : []).slice(0, 10).map(cleanRecipe).filter(Boolean);
      this.tx(() => {
        this.sql.exec("INSERT INTO books (code, name, version, created) VALUES (?, ?, ?, ?)", code, name, version, Date.now());
        for (const r of seeds) this.sql.exec("INSERT OR REPLACE INTO recipes (code, id, data) VALUES (?, ?, ?)", code, r.id, JSON.stringify(r));
      });
      return json({ code, name, version });
    }

    const code = clip(body.code, 6).toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: "bad code" }, 400);
    if (!this.book(code)) return json({ error: "Book not found" }, 404);

    if (body.action === "save") {
      const recipe = cleanRecipe(body.recipe);
      if (!recipe) return json({ error: "Recipe needs a name (and must not be huge)" }, 400);
      const version = this.tx(() => {
        this.sql.exec("INSERT OR REPLACE INTO recipes (code, id, data) VALUES (?, ?, ?)", code, recipe.id, JSON.stringify(recipe));
        return this.bump(code);
      });
      return json({ ok: true, recipe, version });
    }

    if (body.action === "delete") {
      if (!ID_RE.test(body.id || "")) return json({ error: "bad id" }, 400);
      const version = this.tx(() => {
        this.sql.exec("DELETE FROM recipes WHERE code = ? AND id = ?", code, body.id);
        return this.bump(code);
      });
      return json({ ok: true, version });
    }

    if (body.action === "rename") {
      const name = clip(body.name, 60).trim();
      if (!name) return json({ error: "name required" }, 400);
      const version = newVersion();
      this.sql.exec("UPDATE books SET name = ?, version = ? WHERE code = ?", name, version, code);
      return json({ ok: true, name, version });
    }

    return json({ error: "unknown action" }, 400);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/book") {
      const store = env.BOOKS.get(env.BOOKS.idFromName("all-books"));
      return store.fetch(request);
    }
    // Anything that isn't a file in /public and isn't the API.
    return new Response("Not found", { status: 404 });
  },
};
