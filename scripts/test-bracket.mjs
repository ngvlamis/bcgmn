// Stress test for src/assets/js/bracket.js
// Run with: node scripts/test-bracket.mjs

import { readFileSync } from 'fs';
import { createContext, runInContext } from 'vm';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load bracket.js in a fake browser context ─────────────────────────────────

const noop   = () => {};
const fakeEl = () => ({
  innerHTML: '', setAttribute: noop, addEventListener: noop,
  classList: { toggle: noop, add: noop, remove: noop },
  disabled: false, value: '', dataset: {},
});
const ctx = {
  localStorage: { getItem: () => null, setItem: noop },
  document: {
    documentElement: { setAttribute: noop, style: {} },
    querySelector:    () => fakeEl(),
    querySelectorAll: () => [],
    getElementById:   () => fakeEl(),
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolve(ref, matches) { return resolveFrom(ref, matches); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Simulate all matches with random outcomes.
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

// ── Per-trial checks ──────────────────────────────────────────────────────────

function checkTrial(n) {
  const players = shuffle(Array.from({ length: n }, (_, i) => `P${i + 1}`));
  const { matches, rounds } = buildBracket(players);
  const resolved = simulate(matches);

  const rematches  = [];
  const doubleByes = [];
  const byeCount   = {};
  const seen       = new Set();

  rounds.forEach((ids, ri) => {
    for (const id of ids) {
      const m  = resolved[id];
      const p1 = resolve(m.p1, resolved);
      const p2 = m.p2 ? resolve(m.p2, resolved) : null;

      if (!p2) {
        if (p1) {
          byeCount[p1] = (byeCount[p1] || 0) + 1;
          if (byeCount[p1] > 1) doubleByes.push(`${p1} bye in R${ri + 1}`);
        }
        continue;
      }
      if (!p1) continue;

      const key = [p1, p2].sort().join('|');
      if (seen.has(key)) rematches.push(`R${ri + 1}: ${p1} vs ${p2}`);
      seen.add(key);
    }
  });

  return { rematches, doubleByes };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const N_TRIALS = 2000;

console.log(`Stress test: N=15–25, ${N_TRIALS} trials each\n`);
console.log(`${'N'.padStart(4)}  ${'rematches'.padStart(10)}  ${'double byes'.padStart(12)}  status`);
console.log('─'.repeat(50));

let totalFails = 0;

for (let n = 15; n <= 25; n++) {
  let rematchTrials = 0, dbyeTrials = 0;
  const rematchEx = [], dbyeEx = [];

  for (let t = 0; t < N_TRIALS; t++) {
    const { rematches, doubleByes } = checkTrial(n);
    if (rematches.length)  { rematchTrials++; if (rematchEx.length < 2) rematchEx.push(...rematches); }
    if (doubleByes.length) { dbyeTrials++;    if (dbyeEx.length   < 2) dbyeEx.push(...doubleByes); }
  }

  const ok     = rematchTrials === 0 && dbyeTrials === 0;
  totalFails  += ok ? 0 : 1;
  const status = ok ? '✓ PASS' : '✗ FAIL';
  const rStr   = String(rematchTrials === 0 ? 0 : `${rematchTrials} trials`).padStart(10);
  const dStr   = String(dbyeTrials   === 0 ? 0 : `${dbyeTrials} trials`).padStart(12);

  console.log(`${String(n).padStart(4)}  ${rStr}  ${dStr}  ${status}`);
  if (rematchEx.length) console.log(`       rematch examples: ${rematchEx.join('; ')}`);
  if (dbyeEx.length)    console.log(`       double-bye examples: ${dbyeEx.join('; ')}`);
}

console.log('─'.repeat(50));
console.log(totalFails === 0
  ? `\nAll player counts passed.`
  : `\n${totalFails} player count(s) had failures.`
);
process.exit(totalFails > 0 ? 1 : 0);
