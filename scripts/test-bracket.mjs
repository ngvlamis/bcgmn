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

// ── Bye-recipient R3 pairing check ───────────────────────────────────────────

// Returns per-player record { wins, losses, byes } across R1+R2.
function buildDetailedRecord(resolved, rounds) {
  const rec = {};
  const track = (p, type) => {
    if (!p || p === 'BYE') return;
    if (!rec[p]) rec[p] = { wins: 0, losses: 0, byes: 0 };
    rec[p][type]++;
  };
  for (const rid of [0, 1]) {
    for (const id of rounds[rid]) {
      const m  = resolved[id];
      const p1 = resolve(m.p1, resolved);
      const p2 = m.p2 ? resolve(m.p2, resolved) : null;
      if (m._isBye || !p2 || p2 === 'BYE') {
        track(p1, 'byes');
      } else {
        track(m.winner === 'p1' ? p1 : p2, 'wins');
        track(m.winner === 'p1' ? p2 : p1, 'losses');
      }
    }
  }
  return rec;
}

// Returns a failure string if the bye recipient's R3 opponent is not a true
// 2-0 player (two real wins, no bye), or null if the trial passes / is N/A.
function checkByeRecipientR3(n) {
  if (n % 2 === 0) return null;

  const players = shuffle(Array.from({ length: n }, (_, i) => `P${i + 1}`));
  const { matches, rounds } = buildBracket(players);
  const resolved = simulate(matches);

  const r1ByeMatch = rounds[0].map(id => resolved[id]).find(m => m._isBye);
  if (!r1ByeMatch) return null;

  const byeRecipient = resolve(r1ByeMatch.p1, resolved);

  // Did the bye recipient win R2?
  let wonR2 = false;
  for (const id of rounds[1]) {
    const m  = resolved[id];
    if (m._isBye) continue;
    const p1 = resolve(m.p1, resolved);
    const p2 = m.p2 ? resolve(m.p2, resolved) : null;
    if (p1 === byeRecipient) { wonR2 = m.winner === 'p1'; break; }
    if (p2 === byeRecipient) { wonR2 = m.winner === 'p2'; break; }
  }
  if (!wonR2) return null; // lost R2 → not 2-0, skip

  // Find their R3 opponent
  let r3Opponent = null;
  for (const id of rounds[2]) {
    const m  = resolved[id];
    if (m._isBye) continue;
    const p1 = resolve(m.p1, resolved);
    const p2 = m.p2 ? resolve(m.p2, resolved) : null;
    if (p1 === byeRecipient) { r3Opponent = p2; break; }
    if (p2 === byeRecipient) { r3Opponent = p1; break; }
  }
  if (!r3Opponent) return `${byeRecipient} (bye+win) has no R3 match`;

  // Opponent must have 2 real wins, no bye
  const rec  = buildDetailedRecord(resolved, rounds);
  const oRec = rec[r3Opponent] ?? { wins: 0, losses: 0, byes: 0 };
  if (oRec.wins === 2 && oRec.byes === 0) return null;
  return `${byeRecipient} (bye+win) faced ${r3Opponent} (${oRec.wins}W-${oRec.losses}L-${oRec.byes}bye) in R3`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const N_TRIALS = 2000;
let grandTotal = 0;

// Test 1: rematches and double-byes
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
grandTotal += totalFails;

// Test 2: bye recipient faces a true 2-0 opponent in R3
console.log(`\nBye-recipient R3 pairing (odd N only): N=9–25, ${N_TRIALS} trials each\n`);
console.log(`${'N'.padStart(4)}  ${'failures'.padStart(10)}  status`);
console.log('─'.repeat(30));

let byeFails = 0;

for (let n = 9; n <= 25; n += 2) {
  let failTrials = 0;
  const failEx = [];

  for (let t = 0; t < N_TRIALS; t++) {
    const fail = checkByeRecipientR3(n);
    if (fail) { failTrials++; if (failEx.length < 2) failEx.push(fail); }
  }

  const ok     = failTrials === 0;
  byeFails    += ok ? 0 : 1;
  const status = ok ? '✓ PASS' : '✗ FAIL';
  console.log(`${String(n).padStart(4)}  ${String(failTrials === 0 ? 0 : `${failTrials} trials`).padStart(10)}  ${status}`);
  if (failEx.length) failEx.forEach(ex => console.log(`       ${ex}`));
}

console.log('─'.repeat(30));
console.log(byeFails === 0
  ? `\nAll player counts passed.`
  : `\n${byeFails} player count(s) had failures.`
);
grandTotal += byeFails;

process.exit(grandTotal > 0 ? 1 : 0);
