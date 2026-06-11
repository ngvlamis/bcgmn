// Measure 3-0 player count across many trials.
// Compare against the theoretical minimum ceil(N/8) for 3-round Swiss.

import { readFileSync } from 'fs';
import { createContext, runInContext } from 'vm';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const noop = () => {};
const fakeEl = () => ({
  innerHTML: '', setAttribute: noop, addEventListener: noop,
  classList: { toggle: noop, add: noop, remove: noop },
  disabled: false, value: '', dataset: {},
});
const ctx = {
  localStorage: { getItem: () => null, setItem: noop },
  document: {
    documentElement: { setAttribute: noop, style: {} },
    querySelector: () => fakeEl(),
    querySelectorAll: () => [],
    getElementById: () => fakeEl(),
  },
  window: { matchMedia: () => ({ addEventListener: noop, matches: false }) },
  console,
};
createContext(ctx);
runInContext(
  readFileSync(join(__dirname, '..', 'src', 'assets', 'js', 'bracket.js'), 'utf8'),
  ctx
);

const { buildBracket, resolveFrom } = ctx;
const resolve = (ref, matches) => resolveFrom(ref, matches);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function simulate(matches) {
  const m = JSON.parse(JSON.stringify(matches));
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of Object.values(m)) {
      if (match.winner) continue;
      const p1 = resolve(match.p1, m);
      const p2 = match.p2 === null ? 'BYE' : resolve(match.p2, m);
      if (!p1 || !p2) continue;
      match.winner = p2 === 'BYE' ? 'p1' : (Math.random() < 0.5 ? 'p1' : 'p2');
      changed = true;
    }
  }
  return m;
}

function count30s(n) {
  const players = shuffle(Array.from({ length: n }, (_, i) => `P${i + 1}`));
  const { matches } = buildBracket(players);
  const resolved = simulate(matches);
  const wins = {}, losses = {};
  for (const m of Object.values(resolved)) {
    if (!m.winner) continue;
    const wSide = m.winner, lSide = wSide === 'p1' ? 'p2' : 'p1';
    const w = resolve(m[wSide], resolved);
    const l = m[lSide] ? resolve(m[lSide], resolved) : null;
    if (w && w !== 'BYE') wins[w] = (wins[w] || 0) + 1;
    if (l && l !== 'BYE') losses[l] = (losses[l] || 0) + 1;
  }
  let n30 = 0;
  for (const p of players) {
    if ((wins[p] || 0) === 3 && (losses[p] || 0) === 0) n30++;
  }
  return n30;
}

const TRIALS = 5000;
console.log(`3-0 counts across ${TRIALS} random trials each\n`);
console.log(`${'N'.padStart(4)}  ${'optimal'.padStart(7)}  ${'min'.padStart(4)}  ${'max'.padStart(4)}  ${'avg'.padStart(5)}  distribution`);
console.log('─'.repeat(60));

for (let n = 8; n <= 26; n++) {
  const counts = [];
  for (let t = 0; t < TRIALS; t++) counts.push(count30s(n));
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  const dist = {};
  for (const c of counts) dist[c] = (dist[c] || 0) + 1;
  const distStr = Object.entries(dist).sort().map(([k, v]) => `${k}:${(v / TRIALS * 100).toFixed(0)}%`).join(' ');
  const optimal = Math.ceil(n / 8);
  console.log(`${String(n).padStart(4)}  ${String(optimal).padStart(7)}  ${String(min).padStart(4)}  ${String(max).padStart(4)}  ${avg.toFixed(2).padStart(5)}  ${distStr}`);
}
