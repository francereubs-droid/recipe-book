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

Hosted on **Cloudflare Pages** (free).

- `public/` — the app (plain HTML/CSS/JS, no build step)
- `functions/api/book.js` — the sync API at `/api/book`, storing books in a Cloudflare D1 database
- Phones poll the API every few seconds; any change bumps the book's version so others pick it up

## Cloudflare setup

1. Workers & Pages → Create → Pages → Connect to Git → pick this repo
2. Build command: *(none)* · Build output directory: `public`
3. Storage & Databases → D1 → Create database (e.g. `recipe-book-db`)
4. Pages project → Settings → Bindings → Add → D1 database: variable name `DB` → pick the database
5. Deployments → Retry/redeploy so the binding takes effect

The tables are created automatically on first use.
