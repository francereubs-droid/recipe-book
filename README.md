# Recipe Book

A shared, book-style recipe app for your phone.

- Looks and turns like a real book — drag a page, tap the folded corner, or use the arrows
- Share a 6-letter book code (or invite link) and everyone's recipes sync automatically
- Recipes in metric, ingredients with quantities, method below, and 1× / 2× / 4× scaling
- Add recipes by typing ingredients naturally, one per line ("200 g flour", "2 eggs")
- Categories as coloured chips, a contents page, and name search that flips straight to the recipe
- Built-in kitchen timer, plus tap-to-start timers on any time in a method ("bake 25 min")
- Installable to your home screen

## How it works

Hosted free as a **Cloudflare Worker** with static assets.

- `public/` — the app (plain HTML/CSS/JS, no build step), served as static assets
- `src/worker.js` — the sync API at `/api/book`; books are stored in a SQLite-backed Durable Object
- `wrangler.jsonc` — Worker config (name, assets folder, Durable Object binding)
- Phones poll the API every few seconds; any change bumps the book's version so others pick it up

## Deploying

The Worker is connected to this repo with Workers Builds, so every push to `main`
runs `npx wrangler deploy` automatically. No database setup is needed.
