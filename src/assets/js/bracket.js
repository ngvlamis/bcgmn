// ─────────────────────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────────────────────
const STORAGE_KEY = 'bgTrio_v2';

let state = loadState() || {
  phase: 'setup', players: Array(8).fill(''),
  matches: {}, rounds: [], displayNums: {}, tournamentTitle: ''
};

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!s) return null;
    if (!s.displayNums) s.displayNums = {};
    if (!s.rounds) s.rounds = [];
    if (s.tournamentTitle === undefined) s.tournamentTitle = '';
    return s;
  } catch { return null; }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// ─────────────────────────────────────────────────────────────
//  Bracket builder — graph-model Swiss
//
//  Maintains a simple graph G on N vertices (players). Each edge
//  represents a match already scheduled. No-rematch is automatic:
//  G is simple so no edge can be added twice.
//
//  Guarantees:
//    • No rematches across all three rounds
//    • At most 1 bye per player (dummy ⊥ absorbs odd counts)
//    • Score-group pairing: winners vs winners, losers vs losers
//      where possible; cross-group only when group size is odd
//    • Minimises undefeated players (≈ floor(N/8))
//    • Fully pre-seeded — no result-chained slots
//    • Deterministic given the shuffled player array
// ─────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Graph helpers ──────────────────────────────────────────────

// adj: Map<playerName, Set<playerName>>
function makeGraph() { return new Map(); }

function gAdd(adj, u, v) {
  if (!adj.has(u)) adj.set(u, new Set());
  if (!adj.has(v)) adj.set(v, new Set());
  adj.get(u).add(v);
  adj.get(v).add(u);
}

function gHas(adj, u, v) {
  return adj.has(u) && adj.get(u).has(v);
}

function validPartners(v, candidates, adj) {
  return candidates.filter(u => u !== v && !gHas(adj, v, u));
}

// ── Greedy matching ────────────────────────────────────────────
// Most-constrained-first; ties broken by position in `candidates`
// array (stable, deterministic given fixed input order).
// Returns { pairs: [[u,v],...], leftover: name|null }
function greedyMatch(candidates, adj) {
  const unmatched = [...candidates];
  const pairs = [];

  while (unmatched.length >= 2) {
    // find most constrained vertex
    let bestIdx = 0, bestCount = Infinity;
    for (let i = 0; i < unmatched.length; i++) {
      const c = validPartners(unmatched[i], unmatched, adj).length;
      if (c < bestCount) { bestCount = c; bestIdx = i; }
    }
    const v = unmatched[bestIdx];

    const partners = validPartners(v, unmatched, adj);
    if (partners.length === 0) {
      // Should not happen for N >= 8; move v to leftover position
      unmatched.splice(bestIdx, 1);
      unmatched.push(v);
      break;
    }

    // among partners, pick most constrained (fewest remaining partners
    // after removing v); ties broken by array position
    let bestPartner = partners[0], bestPC = Infinity;
    const withoutV = unmatched.filter(x => x !== v);
    for (const p of partners) {
      const pc = validPartners(p, withoutV.filter(x => x !== p), adj).length;
      if (pc < bestPC) { bestPC = pc; bestPartner = p; }
    }

    pairs.push([v, bestPartner]);
    gAdd(adj, v, bestPartner);          // add edge immediately
    unmatched.splice(unmatched.indexOf(v), 1);
    unmatched.splice(unmatched.indexOf(bestPartner), 1);
  }

  return { pairs, leftover: unmatched.length === 1 ? unmatched[0] : null };
}

// ── Cross-group edge ───────────────────────────────────────────
// Pick the most-constrained vertex from `fromGroup` (excluding dummy)
// and match it with the most-constrained valid partner in `toGroup`
// (also excluding dummy — dummy must stay in lGroup so it ends up in
// llGroup for R3, ensuring the bye goes to a structural 0-2 player).
// Adds the edge to adj and returns [u, v].
function crossEdge(fromGroup, toGroup, adj, dummy) {
  const eligible  = fromGroup.filter(v => v !== dummy);
  const eligibleT = toGroup.filter(v => v !== dummy);
  // most constrained in fromGroup w.r.t. toGroup (excluding dummy)
  let v = eligible[0];
  let bestC = Infinity;
  for (const u of eligible) {
    const c = validPartners(u, eligibleT, adj).length;
    if (c < bestC) { bestC = c; v = u; }
  }
  const partners = validPartners(v, eligibleT, adj);
  // most constrained partner
  let u = partners[0], bestPC = Infinity;
  for (const p of partners) {
    const pc = validPartners(p, eligibleT.filter(x => x !== p), adj).length;
    if (pc < bestPC) { bestPC = pc; u = p; }
  }
  gAdd(adj, v, u);
  return [v, u];
}

// ── Main bracket builder ───────────────────────────────────────
function buildBracket(players) {
  // Step 0: normalise
  const dummy = players.length % 2 === 1 ? '⊥' : null;
  const roster = dummy ? [...players, dummy] : [...players];
  const N = roster.length;   // always even

  // ── Graph: tracks which players have been paired (no-rematch) ──
  const adj = makeGraph();
  roster.forEach(p => adj.set(p, new Set()));

  let _mid = 0;
  const mk = () => `M${_mid++}`;
  const matches = {};
  const rounds  = [[], [], []];

  // playerToR1Id: name -> round-1 match id that contains this player
  const playerToR1Id = {};

  // ── Round 1: direct seed assignments ─────────────────────────
  for (let i = 0; i < N; i += 2) {
    const u = roster[i], v = roster[i + 1];
    gAdd(adj, u, v);
    const id  = mk();
    const isBye = v === dummy;
    if (isBye) {
      matches[id] = {
        id, round: 1, group: 'r1',
        p1: { type: 'seed', name: u },
        p2: null,
        winner: null, _isBye: true
      };
    } else {
      matches[id] = {
        id, round: 1, group: 'r1',
        p1: { type: 'seed', name: u },
        p2: { type: 'seed', name: v },
        winner: null
      };
    }
    rounds[0].push(id);
    playerToR1Id[u] = id;
    if (!isBye) playerToR1Id[v] = id;
    if (dummy) playerToR1Id[dummy] = id;
  }

  // ── Determine round-2 pairings via graph algorithm ────────────
  // wGroup: structurally the "winner candidates" (even roster index = first of each R1 pair)
  // lGroup: structurally the "loser candidates"  (odd roster index  = second of each R1 pair)
  const wGroup = roster.filter((_, i) => i % 2 === 0);
  const lGroup = roster.filter((_, i) => i % 2 === 1);

  let r2PlayerPairs = []; // [[playerName, playerName], ...]

  if (N / 2 % 2 === 0) {
    r2PlayerPairs = [
      ...greedyMatch([...wGroup], adj).pairs,
      ...greedyMatch([...lGroup], adj).pairs,
    ];
  } else {
    const [cv, cu] = crossEdge(wGroup, lGroup, adj, dummy);
    r2PlayerPairs = [
      [cv, cu],
      ...greedyMatch(wGroup.filter(p => p !== cv), adj).pairs,
      ...greedyMatch(lGroup.filter(p => p !== cu), adj).pairs,
    ];
  }

  // ── Round 2: build match slots using R1 match references ──────
  // r2IdFor[player]   = the R2 match id this player is in
  // r2SlotFor[player] = 'winner' or 'loser' — which output slot of their
  //   R2 match they occupy in R3.  Assigned by position in the pair:
  //   first player (u) gets 'winner', second (v) gets 'loser'.
  //   This is purely structural — it does NOT pre-determine who wins the match.
  //   It just names the two output slots, guaranteeing they are distinct.

  const wSet      = new Set(wGroup);
  const r2IdFor   = {};
  const r2SlotFor = {};

  r2PlayerPairs.forEach(([u, v]) => {
    const id    = mk();
    const isBye = u === dummy || v === dummy;

    function r1SlotFor(name) {
      if (name === dummy) return null;
      // wGroup = even roster index = p1 of their R1 match → structural 'winner' slot
      // lGroup = odd  roster index = p2 of their R1 match → structural 'loser'  slot
      return {
        type: 'matchResult',
        matchId: playerToR1Id[name],
        outcome: wSet.has(name) ? 'winner' : 'loser'
      };
    }

    if (isBye) {
      const realName = u === dummy ? v : u;
      matches[id] = { id, round: 2, group: 'r2', p1: r1SlotFor(realName), p2: null, winner: null, _isBye: true };
      r2IdFor[realName]   = id;
      r2SlotFor[realName] = 'winner';
    } else {
      matches[id] = {
        id, round: 2, group: 'r2',
        p1: r1SlotFor(u),
        p2: r1SlotFor(v),
        winner: null
      };
      r2IdFor[u]   = id;  r2SlotFor[u] = 'winner';
      r2IdFor[v]   = id;  r2SlotFor[v] = 'loser';
    }
    rounds[1].push(id);
  });

  // ── Determine round-3 pairings via graph algorithm ────────────
  const r2Partner = {};
  r2PlayerPairs.forEach(([u, v]) => {
    r2Partner[u] = v;
    if (v !== null) r2Partner[v] = u;
  });

  const wwGroup  = roster.filter(p =>  wSet.has(p) &&  wSet.has(r2Partner[p]));
  const llGroup  = roster.filter(p => !wSet.has(p) && !wSet.has(r2Partner[p]));
  const midGroup = roster.filter(p => !wwGroup.includes(p) && !llGroup.includes(p));

  // The R3 bye must go to a true 0-2 player — someone who lost both R1 and R2.
  // Block dummy from pairing with:
  //   wwGroup        — 2-0 players
  //   midGroup       — 1-1 cross-edge players
  //   r2ByeReceiver  — the player who faced ⊥ in R2 (already had an effective
  //                    bye; giving them R3 bye = double bye)
  const r2ByeReceivers = dummy
    ? r2PlayerPairs
        .filter(([u, v]) => u === dummy || v === dummy)
        .map(([u, v]) => u === dummy ? v : u)
        .filter(p => p !== dummy)
    : [];

  const tempEdges = [];
  if (dummy) {
    [...wwGroup, ...midGroup, ...r2ByeReceivers].forEach(p => {
      if (!gHas(adj, p, dummy)) {
        gAdd(adj, p, dummy);
        tempEdges.push(p);
      }
    });
  }

  const r3Ordered = [...wwGroup, ...midGroup, ...llGroup];
  const { pairs: r3PlayerPairs } = greedyMatch(r3Ordered, adj);

  // Remove temporary edges so they don't affect match-reference encoding
  tempEdges.forEach(p => {
    adj.get(p).delete(dummy);
    adj.get(dummy).delete(p);
  });

  // ── Round 3: build match slots using R2 match references ──────
  // Each player's R3 input = their R2 output slot.
  // r2SlotFor[player] guarantees uniqueness:
  //   • Players from different R2 matches → different matchIds         ✓
  //   • Players from the same R2 match   → opposite outcomes (W vs L) ✓
  // So no two R3 slots are ever identical.
  //
  // Special case for odd N: when dummy pairs with a real player X in R3,
  // the bye must go to the 0-2 player — i.e. the *loser* of X's R2 match.
  // We guarantee this by swapping r2SlotFor for X and X's R2 match partner
  // so that X gets 'loser' and their partner gets 'winner'.
  // This swap is safe because X's partner is paired separately in R3 and
  // will use their (now 'winner') slot without conflict.
  if (dummy) {
    const byePair = r3PlayerPairs.find(([u, v]) => u === dummy || v === dummy);
    if (byePair) {
      const byePlayer = byePair[0] === dummy ? byePair[1] : byePair[0];
      if (byePlayer && r2SlotFor[byePlayer] === 'winner') {
        // Swap slots with the R2 partner
        const r2mate = r2PlayerPairs
          .find(([u, v]) => u === byePlayer || v === byePlayer)
          ?.find(p => p !== byePlayer);
        if (r2mate && r2mate !== dummy) {
          r2SlotFor[byePlayer] = 'loser';
          r2SlotFor[r2mate]    = 'winner';
        }
      }
    }
  }

  r3PlayerPairs.forEach(([u, v]) => {
    const id    = mk();
    const isBye = u === dummy || v === dummy;

    function r3SlotFor(name) {
      if (name === dummy) return null;
      return { type: 'matchResult', matchId: r2IdFor[name], outcome: r2SlotFor[name] };
    }

    if (isBye) {
      const realName = u === dummy ? v : u;
      matches[id] = { id, round: 3, group: 'r3', p1: r3SlotFor(realName), p2: null, winner: null, _isBye: true };
    } else {
      matches[id] = {
        id, round: 3, group: 'r3',
        p1: r3SlotFor(u),
        p2: r3SlotFor(v),
        winner: null
      };
    }
    rounds[2].push(id);
  });

  // ── Finalise ──────────────────────────────────────────────────
  autoresolveByes(matches);

  const displayNums = {};
  let n = 1;
  rounds.forEach(rnd => rnd.forEach(id => {
    if (!matches[id]._isBye) displayNums[id] = n++;
  }));

  return { matches, rounds, displayNums };
}

// ─────────────────────────────────────────────────────────────
//  Name resolution
// ─────────────────────────────────────────────────────────────
function resolveFrom(src, map) {
  if (!src) return null;
  if (src.type === 'seed') return src.name;
  const m = map[src.matchId];
  if (!m?.winner) return null;
  const side = src.outcome === 'winner' ? m.winner : (m.winner === 'p1' ? 'p2' : 'p1');
  return resolveFrom(m[side], map);
}
function resolveName(src) { return resolveFrom(src, state.matches); }

function autoresolveByes(matches) {
  let changed = true;
  while (changed) {
    changed = false;
    Object.values(matches).forEach(m => {
      if (m.winner !== null) return;
      const p1 = resolveFrom(m.p1, matches);
      const p2 = m.p2 ? resolveFrom(m.p2, matches) : 'BYE';
      if (p1 === null && p2 === 'BYE') return;
      if (p2 === 'BYE' && p1 !== null) { m.winner = 'p1'; m._isBye = true; changed = true; }
    });
  }
}

function buildRecordMap(beforeRound) {
  const wins = {}, losses = {};
  Object.values(state.matches).forEach(m => {
    if (!m.winner || m.round >= beforeRound) return;
    const wSide = m.winner, lSide = wSide === 'p1' ? 'p2' : 'p1';
    const winner = resolveName(m[wSide]);
    const loser  = m[lSide] ? resolveName(m[lSide]) : null;
    if (winner && winner !== 'BYE') wins[winner]  = (wins[winner]  || 0) + 1;
    if (loser  && loser  !== 'BYE') losses[loser] = (losses[loser] || 0) + 1;
  });
  return { wins, losses };
}

function recStr(name, recMap) {
  if (!name) return null;
  const w = recMap.wins[name] || 0, l = recMap.losses[name] || 0;
  if (w === 0 && l === 0) return null;
  return `${w}-${l}`;
}

function tbdLabel(src) {
  if (!src) return 'BYE';
  if (src.type === 'seed') return src.name;
  const m = state.matches[src.matchId];
  if (m?._isBye) return resolveName(src) || '?';
  const num = state.displayNums[src.matchId];
  return num ? `${src.outcome === 'winner' ? 'W' : 'L'}${num}` : '?';
}

function clearMatch(matchId) {
  const m = state.matches[matchId];
  if (!m || m._isBye) return;
  m.winner = null;
}

// ─────────────────────────────────────────────────────────────
//  Actions
// ─────────────────────────────────────────────────────────────
function startTournament() {
  const names = state.players.map(p => p.trim()).filter(Boolean);
  if (names.length < 4) return;
  const lower = names.map(n => n.toLowerCase());
  if (new Set(lower).size !== lower.length) return;
  const { matches, rounds, displayNums } = buildBracket(shuffle(names));
  state.matches = matches; state.rounds = rounds; state.displayNums = displayNums;
  state.phase = 'tournament';
  saveState(); render();
}

function pickWinner(matchId, side) {
  state.matches[matchId].winner = side;
  autoresolveByes(state.matches);
  saveState(); render();
}

function undoMatch(matchId) { clearMatch(matchId); saveState(); render(); }

function resetAll() {
  if (!confirm('Reset the tournament? All results will be cleared.')) return;
  state = { phase:'setup', players:Array(8).fill(''), matches:{}, rounds:[], displayNums:{}, tournamentTitle: state.tournamentTitle || '' };
  saveState(); render();
}

// ─────────────────────────────────────────────────────────────
//  Standings
// ─────────────────────────────────────────────────────────────
function computeStandings() {
  const lastRound = state.rounds[state.rounds.length - 1];
  if (!lastRound?.length) return null;
  if (lastRound.some(id => !state.matches[id]?.winner)) return null;
  const wins = {}, losses = {};
  Object.values(state.matches).forEach(m => {
    if (!m.winner) return;
    const wSide = m.winner, lSide = wSide === 'p1' ? 'p2' : 'p1';
    const winner = resolveName(m[wSide]), loser = m[lSide] ? resolveName(m[lSide]) : null;
    if (winner && winner !== 'BYE') wins[winner]  = (wins[winner]  || 0) + 1;
    if (loser  && loser  !== 'BYE') losses[loser] = (losses[loser] || 0) + 1;
  });
  return state.players.filter(p => p.trim())
    .map(p => ({ name: p, w: wins[p] || 0, l: losses[p] || 0 }))
    .sort((a, b) => b.w - a.w || a.l - b.l);
}

// ─────────────────────────────────────────────────────────────
//  Render helpers
// ─────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderMatchCard(matchId) {
  const m = state.matches[matchId];
  if (!m) return '';
  const p1Name = resolveName(m.p1);
  const p2Name = m.p2 ? resolveName(m.p2) : null;
  const num    = state.displayNums[matchId];
  const done   = m.winner !== null;
  const both   = p1Name && p2Name;
  const wait   = !both && !done;
  const recMap = buildRecordMap(m.round);
  const p1Rec  = recStr(p1Name, recMap);
  const p2Rec  = recStr(p2Name, recMap);

  if (m._isBye) {
    const playerName  = m.winner ? resolveName(m[m.winner]) : null;
    const playerLabel = playerName || tbdLabel(m.p1);
    const playerRec   = recStr(playerName, recMap);
    return `
      <div class="match-card bye-card">
        <div class="match-meta"><span class="match-num">BYE</span></div>
        <div class="match-players">
          <span class="pick-btn ${m.winner ? 'winner-btn' : 'tbd-btn'}" style="cursor:default">
            ${esc(playerLabel)}${playerRec ? `<span class="player-rec">${playerRec}</span>` : ''}
          </span>
          <span class="vs-label">vs</span>
          <span class="pick-btn bye-btn">bye</span>
        </div>
      </div>`;
  }

  let p1c = 'pick-btn', p2c = 'pick-btn', p1dis = true, p2dis = true;
  if (done) {
    p1c += m.winner === 'p1' ? ' winner-btn' : ' loser-btn';
    p2c += m.winner === 'p2' ? ' winner-btn' : ' loser-btn';
  } else if (both) {
    p1dis = false; p2dis = false;
  } else {
    if (!p1Name) p1c += ' tbd-btn';
    if (!p2Name) p2c += ' tbd-btn';
  }

  return `
    <div class="match-card ${done ? 'complete' : wait ? 'waiting' : ''}">
      <div class="match-meta">
        <span class="match-num">Match ${num}</span>
        ${done ? `<button class="match-undo" data-undo="${matchId}">undo</button>` : ''}
      </div>
      <div class="match-players">
        <button class="${p1c}" ${p1dis?'disabled':''} data-pick="${matchId}" data-side="p1">
          ${esc(p1Name || tbdLabel(m.p1))}${p1Rec ? `<span class="player-rec">${p1Rec}</span>` : ''}
        </button>
        <span class="vs-label">vs</span>
        <button class="${p2c}" ${p2dis?'disabled':''} data-pick="${matchId}" data-side="p2">
          ${esc(p2Name || (m.p2 ? tbdLabel(m.p2) : 'BYE'))}${p2Rec ? `<span class="player-rec">${p2Rec}</span>` : ''}
        </button>
      </div>
      ${!done && both ? '<div class="match-hint">tap a name to mark the winner</div>' : ''}
      ${wait          ? '<div class="match-hint">waiting for earlier results</div>'   : ''}
    </div>`;
}

function renderRound(matchIds) {
  const groupOrder = { 'r1': 0, 'r2': 0, 'r3': 0 };
  const sortKey = m => m._isBye ? -Infinity : (groupOrder[m.group] ?? 0);
  const sorted = [...matchIds].sort((a, b) => sortKey(state.matches[b]) - sortKey(state.matches[a]));
  const real   = sorted.filter(id => !state.matches[id]?._isBye);
  const wide   = real.length > 4 ? ' cols3' : '';
  return `<div class="match-grid${wide}">${sorted.map(renderMatchCard).join('')}</div>`;
}

function renderStandings(standings) {
  const maxW = standings[0]?.w || 0;
  const cls = w => w === maxW ? 'rec-hi' : w > maxW/2 ? 'rec-mid' : w > 0 ? 'rec-lo' : 'rec-min';
  return `
    <div class="standings">
      <div class="standings-header">
        <div class="standings-title">Final Standings</div>
        <div class="export-btns">
          <button class="export-btn" id="exportTxt">Export TXT</button>
          <button class="export-btn" id="exportCsv">Export CSV</button>
        </div>
      </div>
      ${standings.map((p, i) => `
        <div class="standing-row">
          <span class="standing-rank">${i+1}.</span>
          <span class="standing-name">${esc(p.name)}</span>
          <span class="standing-record ${cls(p.w)}">${p.w}-${p.l}</span>
        </div>`).join('')}
    </div>`;
}

function exportTxt(standings) {
  const date  = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const title = state.tournamentTitle || '3-Round Swiss Tournament';
  const sep   = '─'.repeat(Math.max(36, title.length + 4));
  const roundNames = ['Round 1', 'Round 2 — Win Track / Loss Track', 'Round 3 — Main / Consolation / Last Chance'];
  const matchLines = state.rounds.map((rnd, ri) => {
    const lines = [`\n${roundNames[ri]}`];
    rnd.forEach(id => {
      const m = state.matches[id];
      if (!m || m._isBye) return;
      const num = state.displayNums[id];
      const p1  = resolveName(m.p1) || '?', p2 = resolveName(m.p2) || '?';
      const win = m.winner ? (m.winner === 'p1' ? p1 : p2) : '—';
      lines.push(`  Match ${num}: ${p1} vs ${p2}  →  ${win}`);
    });
    return lines.join('\n');
  }).join('\n');
  const standingLines = standings.map((p, i) =>
    `  ${String(i+1).padStart(2)}.  ${p.name.padEnd(20)} ${p.w}-${p.l}`
  ).join('\n');
  const txt = [title, date, sep, matchLines, `\n${sep}\nFinal Standings\n${sep}`, standingLines, sep].join('\n');
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  download(`${slug}-results.txt`, txt, 'text/plain');
}

function exportCsv(standings) {
  const date  = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const title = state.tournamentTitle || '3-Round Swiss Tournament';
  const rows  = [[title], [date], [], ['Rank', 'Player', 'Wins', 'Losses', 'Record']];
  standings.forEach((p, i) => rows.push([i+1, p.name, p.w, p.l, `${p.w}-${p.l}`]));
  rows.push([], ['Round', 'Match', 'Player 1', 'Player 2', 'Winner']);
  const roundNames = ['Round 1', 'Round 2', 'Round 3'];
  state.rounds.forEach((rnd, ri) => {
    rnd.forEach(id => {
      const m = state.matches[id];
      if (!m || m._isBye) return;
      const num = state.displayNums[id];
      const p1  = resolveName(m.p1) || '', p2 = resolveName(m.p2) || '';
      const win = m.winner ? (m.winner === 'p1' ? p1 : p2) : '';
      rows.push([roundNames[ri], `Match ${num}`, p1, p2, win]);
    });
  });
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  download(`${slug}-results.csv`, csv, 'text/csv');
}

function download(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

// ─────────────────────────────────────────────────────────────
//  Full page renders
// ─────────────────────────────────────────────────────────────
function renderSetup() {
  const filled = state.players.filter(p => p.trim()).length;
  const n      = state.players.length;
  const info   = filled < 4
    ? 'Enter at least 4 names to continue'
    : filled % 2 === 1
      ? `<strong>${filled} players</strong> — 1 bye per round (odd count)`
      : `<strong>${filled} players</strong> — no byes needed`;

  return `
    <div class="setup-screen">
      <div class="screen-title" style="margin-bottom:0.25rem">3-Round Swiss Tournament</div>
      <div class="screen-subtitle">
        Enter player names in any order — seeding is randomized automatically. All three rounds are generated upfront, so you can record results at your own pace without waiting for a round to finish.
      </div>
      <div class="title-row">
        <span class="title-row-label">Title:</span>
        <input id="titleInput" type="text" class="player-input" style="flex:1;max-width:320px"
               placeholder="Tournament name (optional)" value="${esc(state.tournamentTitle || '')}" autocomplete="off" />
      </div>
      <div class="player-rows">
        ${state.players.map((p, i) => `
          <div class="player-row">
            <span class="player-num">${i+1}</span>
            <input class="player-input${p.trim() ? ' filled' : ''}"
                   type="text" placeholder="Player ${i+1}"
                   value="${esc(p)}" data-idx="${i}" list="member-list" />
            <button class="remove-btn" data-remove="${i}" ${n > 4 ? '' : 'disabled'} title="Remove">×</button>
          </div>`).join('')}
      </div>
      <button class="add-btn" id="addBtn" ${n < 32 ? '' : 'disabled'}>+ Add player</button>
      <div class="bracket-info">${info}</div>
      <button class="start-btn" id="startBtn" ${filled >= 4 ? '' : 'disabled'}>Generate Bracket</button>
      ${filled < 4 ? '<div class="hint">Enter at least 4 names to continue</div>' : ''}
    </div>`;
}

function renderTournament() {
  const standings = computeStandings();
  const roundTitles = ['Round 1', 'Round 2', 'Round 3'];
  return `
    <div class="tournament-screen">
      <div class="t-header">
        <div class="t-title">${esc(state.tournamentTitle) || '3-Round Swiss Tournament'}</div>
        <button class="reset-btn" id="resetBtn">Reset</button>
      </div>
      <div class="rounds">
        ${state.rounds.map((rnd, i) => `
          <div class="round-block">
            <div class="round-heading">${roundTitles[i]}</div>
            ${renderRound(rnd)}
          </div>`).join('')}
      </div>
      ${standings ? renderStandings(standings) : ''}
    </div>`;
}

// ─────────────────────────────────────────────────────────────
//  Render + events
// ─────────────────────────────────────────────────────────────
function render() {
  try {
    document.getElementById('app').innerHTML =
      state.phase === 'setup' ? renderSetup() : renderTournament();
    attachEvents();
  } catch(e) {
    console.error('Render error:', e);
    state = { phase:'setup', players:Array(8).fill(''), matches:{}, rounds:[], displayNums:{}, tournamentTitle:'' };
    saveState();
    document.getElementById('app').innerHTML = renderSetup();
    attachEvents();
  }
}

function refreshInfo() {
  const names = state.players.map(p => p.trim().toLowerCase());
  const filled = names.filter(Boolean);
  const seen = new Set();
  const dupes = new Set();
  for (const n of filled) { if (seen.has(n)) dupes.add(n); else seen.add(n); }

  document.querySelectorAll('.player-input[data-idx]').forEach(input => {
    const val = input.value.trim().toLowerCase();
    input.classList.toggle('duplicate', !!(val && dupes.has(val)));
  });

  const el = document.querySelector('.bracket-info');
  const btn = document.getElementById('startBtn');
  if (dupes.size) {
    if (el) el.innerHTML = '<span style="color:var(--red)">Duplicate names — each player must have a unique name</span>';
    if (btn) btn.disabled = true;
    return;
  }
  if (el) el.innerHTML = filled.length < 4
    ? 'Enter at least 4 names to continue'
    : filled.length % 2
      ? `<strong>${filled.length} players</strong> — 1 bye per round (odd count)`
      : `<strong>${filled.length} players</strong> — no byes needed`;
  if (btn) btn.disabled = filled.length < 4;
}

function attachEvents() {
  document.querySelectorAll('.player-input[data-idx]').forEach(input => {
    input.addEventListener('input', e => {
      state.players[+e.target.dataset.idx] = e.target.value;
      e.target.classList.toggle('filled', !!e.target.value.trim());
      saveState(); refreshInfo();
    });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const inputs = [...document.querySelectorAll('[data-idx]')];
      const i = +e.target.dataset.idx;
      const target = e.target;
      // Defer until after the browser commits any datalist selection to input.value
      setTimeout(() => {
        state.players[i] = target.value;
        target.classList.toggle('filled', !!target.value.trim());
        saveState(); refreshInfo();
        if (i < inputs.length - 1) inputs[i+1].focus();
        else document.getElementById('addBtn')?.click();
      }, 0);
    });
  });

  document.querySelectorAll('[data-remove]').forEach(btn =>
    btn.addEventListener('click', e => {
      state.players.splice(+e.currentTarget.dataset.remove, 1);
      saveState(); render();
    })
  );

  document.getElementById('addBtn')?.addEventListener('click', () => {
    state.players.push('');
    saveState(); render();
    const inputs = document.querySelectorAll('[data-idx]');
    inputs[inputs.length - 1]?.focus();
  });

  document.getElementById('titleInput')?.addEventListener('input', e => {
    state.tournamentTitle = e.target.value; saveState();
  });
  document.getElementById('startBtn')?.addEventListener('click', startTournament);
  document.getElementById('resetBtn')?.addEventListener('click', resetAll);

  document.querySelectorAll('[data-pick]').forEach(btn =>
    btn.addEventListener('click', e =>
      pickWinner(e.currentTarget.dataset.pick, e.currentTarget.dataset.side)
    )
  );
  document.querySelectorAll('[data-undo]').forEach(btn =>
    btn.addEventListener('click', e => undoMatch(e.currentTarget.dataset.undo))
  );

  const standings = computeStandings();
  document.getElementById('exportTxt')?.addEventListener('click', () => exportTxt(standings));
  document.getElementById('exportCsv')?.addEventListener('click', () => exportCsv(standings));

}

render();

(async () => {
  try {
    const names = await fetch('/members.json').then(r => r.json());
    const dl = document.createElement('datalist');
    dl.id = 'member-list';
    names.forEach(name => { const o = document.createElement('option'); o.value = name; dl.appendChild(o); });
    document.body.appendChild(dl);
  } catch {}
})();
