# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # dev server with live reload at http://localhost:8080
npm run build    # production build → _site/
npm run deploy   # build + push _site/ to gh-pages branch
```

No linter or test runner is configured.

## Architecture

Purely static — no backend. All data lives in `src/_data/`, all logic runs at build time.

### Data flow

```
src/_data/members.yaml   → members page, bracket-members.njk
src/_data/meetings.yaml  → schedule page (index.njk)
                         → standings.js reads it directly via fs+js-yaml
src/_data/standings.js   → standings page (computed at build time)
src/_data/site.js        → site.title, site.year available in all templates
```

`standings.js` reads `meetings.yaml` directly with `fs.readFileSync` (not via Eleventy's data cascade) because JS data files don't receive other data files as input. It filters to the current calendar year and computes W/L/pct per player.

### YAML dates must be quoted

js-yaml 4.x parses bare `YYYY-MM-DD` values as Date objects. All dates in YAML files are stored as quoted strings (e.g. `"2026-01-08"`) so they arrive in templates and `standings.js` as plain strings. Don't remove the quotes.

### YAML support requires explicit registration

Eleventy 3.x does not parse `.yaml` data files by default. The `addDataExtension` calls in `.eleventy.js` are required — don't remove them.

### Nunjucks filters

Both filters are defined in `.eleventy.js`:
- `dateFormat` — `"2026-01-08"` → `"January 8, 2026"` (used on meeting cards)
- `dateFormatMonth` — `"2024-09"` → `"September 2024"` (used on member cards for `joined`)

### bracket-members.njk

Outputs `_site/members.json` — a flat JSON array of member names for the standalone Swiss bracket generator at `../backgammon-tournament/`. Permalink is set in frontmatter; Eleventy handles it as a regular Nunjucks template.

### Client-side JS (`src/assets/js/main.js`)

Two behaviors:
1. **Meeting expand/collapse** — toggles `hidden` on `.meeting-body` and `is-open` on `.meeting-card`
2. **Standings sort** — re-sorts `<tbody>` rows by clicked column, re-numbers the rank cell, and re-applies the `top-three` class to the first three rows after each sort

### Adding data

- **New meeting**: append an entry to `meetings.yaml`. Standings recalculate on next build.
- **New member**: append to `members.yaml`. They appear on the members page and in `members.json` automatically.
- **Member photo**: add `photo: /assets/img/filename.jpg` to a member entry; the template falls back to an initial-letter placeholder if absent.

### Deployment note (for when it's needed)

The site will live at a subpath (e.g. `ngvlamis.github.io/bcgmn`). When deploying, set `pathPrefix` in `.eleventy.js` so that `/assets/...` hrefs resolve correctly under the subpath.
