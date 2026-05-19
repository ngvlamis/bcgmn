# Backgammon Club of the Great Manhattan North

Static club website built with [Eleventy](https://www.11ty.dev/). Tracks members, meeting schedule, and season standings.

## Commands

```bash
npm start        # dev server with live reload at http://localhost:8080
npm run build    # production build → _site/
npm run deploy   # build + push _site/ to gh-pages branch
```

## Adding data

- **New meeting** — append an entry to `src/_data/meetings.yaml`. Standings recalculate on next build.
- **New member** — append to `src/_data/members.yaml`.

See [CLAUDE.md](CLAUDE.md) for full architecture notes.
