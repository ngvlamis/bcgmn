'use strict';

// Usage:
//   node scripts/import-results.js <file.csv|file.txt> [options]
//
// Options:
//   --date YYYY-MM-DD      meeting date (default: inferred from file)
//   --name "Month YYYY"    meeting name (default: derived from date)
//   --location "Venue"     location (default: "Le Cheile")
//   --write                update src/_data/meetings.yaml in place
//
// Without --write, prints the YAML entry to stdout for review.

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const MEETINGS_YAML = path.join(__dirname, '..', 'src', '_data', 'meetings.yaml');

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let inputFile = null, meetingDate = null, meetingName = null;
let meetingLoc = 'Le Cheile', doWrite = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--date':     meetingDate = args[++i]; break;
    case '--name':     meetingName = args[++i]; break;
    case '--location': meetingLoc  = args[++i]; break;
    case '--write':    doWrite = true;           break;
    default:           if (!inputFile) inputFile = args[i];
  }
}

if (!inputFile) {
  process.stderr.write(
    'Usage: node scripts/import-results.js <file.csv|file.txt>\n' +
    '       [--date YYYY-MM-DD] [--name "Month YYYY"] [--location "Venue"] [--write]\n'
  );
  process.exit(1);
}

// ─── Date helpers ────────────────────────────────────────────────────────────

// Parse "June 11, 2026" → "2026-06-11"
const MONTHS = ['january','february','march','april','may','june',
                'july','august','september','october','november','december'];

function parseFileDate(str) {
  if (!str) return null;
  const m = /^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(str.trim());
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// ─── CSV parsing ─────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const fields = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let field = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else field += line[i++];
      }
      fields.push(field);
      if (line[i] === ',') i++;
    } else {
      const comma = line.indexOf(',', i);
      if (comma === -1) { fields.push(line.slice(i)); break; }
      fields.push(line.slice(i, comma));
      i = comma + 1;
    }
  }
  return fields;
}

function parseCsv(content) {
  // CSV structure:
  //   "Title"
  //   "Date"          ← line 2, e.g. "June 11, 2026"
  //   ""
  //   "Rank","Player","Wins","Losses","Record"
  //   "1","Alice","3","0","3-0"
  //   ...
  //   ""
  //   "Round","Match","Player 1","Player 2","Winner"
  //   "Round 1","Match 1","Alice","Bob","Alice"
  //   "Round 1","BYE","Charlie","","Charlie"   ← bye row
  //   ...

  const rounds = [[], [], []];
  let section = 'header';
  let fileDate = null;
  let headerLineCount = 0;

  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);

    if (section === 'header') headerLineCount++;
    if (section === 'header' && headerLineCount === 2) fileDate = f[0];

    if (f[0] === 'Rank'  && f[1] === 'Player') { section = 'standings'; continue; }
    if (f[0] === 'Round' && f[1] === 'Match')  { section = 'matches';   continue; }
    if (section !== 'matches') continue;

    const roundStr = f[0]; // "Round 1", "Round 2", "Round 3"
    const matchType = f[1]; // "Match N" or "BYE"
    const p1 = f[2], p2 = f[3], winner = f[4];

    if (!roundStr.startsWith('Round ') || !p1) continue;
    const ri = parseInt(roundStr.slice(6)) - 1;
    if (ri < 0 || ri > 2) continue;

    if (matchType === 'BYE') {
      rounds[ri].push({ p1, bye: true });
    } else {
      rounds[ri].push({ p1, p2, winner: winner === p1 ? 1 : 2 });
    }
  }

  return { rounds, fileDate };
}

// ─── TXT parsing ─────────────────────────────────────────────────────────────

function parseTxt(content) {
  // TXT structure:
  //   Title
  //   Date          ← line 2, e.g. "June 11, 2026"
  //   ───────
  //   Round 1
  //     Match 1: Alice vs Bob  →  Alice
  //     BYE: Charlie
  //   Round 2 — ...
  //     ...
  //   ───────
  //   Final Standings
  //   ───────
  //      1.  Alice                3-0

  const rounds = [[], [], []];
  let ri = -1;
  let fileDate = null;
  let nonEmptyLineCount = 0;

  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trim();
    if (!t) continue;

    nonEmptyLineCount++;
    if (nonEmptyLineCount === 2) fileDate = t;

    if (/^─+$/.test(t)) continue;
    if (/^Final Standings/i.test(t)) break;
    if (/^Round 1/i.test(t)) { ri = 0; continue; }
    if (/^Round 2/i.test(t)) { ri = 1; continue; }
    if (/^Round 3/i.test(t)) { ri = 2; continue; }

    if (ri < 0) continue;

    // "BYE: Charlie"
    const byeMatch = /^BYE:\s+(.+)$/i.exec(t);
    if (byeMatch) {
      rounds[ri].push({ p1: byeMatch[1].trim(), bye: true });
      continue;
    }

    // "Match 1: Alice vs Bob  →  Alice"
    const matchLine = /^Match \d+:\s+(.+?)\s+vs\s+(.+?)\s+→\s+(.+)$/.exec(t);
    if (matchLine) {
      const p1 = matchLine[1].trim(), p2 = matchLine[2].trim(), winner = matchLine[3].trim();
      rounds[ri].push({ p1, p2, winner: winner === p1 ? 1 : 2 });
    }
  }

  return { rounds, fileDate };
}

// ─── YAML rendering ──────────────────────────────────────────────────────────

function renderMatch(m) {
  if (m.bye) {
    return `        - p1: ${m.p1}\n          bye: true`;
  }
  const w = m.w !== undefined ? m.w : m.winner;
  return `        - p1: ${m.p1}\n          p2: ${m.p2}\n          w: ${w}`;
}

function renderEntry(name, date, loc, rounds) {
  const lines = [
    `- name: "${name}"`,
    `  date: "${date}"`,
    `  location: "${loc}"`,
  ];
  if (rounds && rounds.some(r => r.length > 0)) {
    lines.push('  rounds:');
    for (const matches of rounds) {
      lines.push('    - matches:');
      for (const m of matches) lines.push(renderMatch(m));
    }
  }
  return lines.join('\n');
}

function renderExistingEntry(m) {
  const date = m.date instanceof Date ? m.date.toISOString().slice(0, 10) : String(m.date);
  if (!m.rounds) return renderEntry(m.name, date, m.location, null);
  const rounds = m.rounds.map(r => r.matches);
  return renderEntry(m.name, date, m.location, rounds);
}

function deriveName(date) {
  const [y, mo] = date.split('-').map(Number);
  const name = MONTHS[mo - 1];
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const raw = fs.readFileSync(inputFile, 'utf8');
const ext = path.extname(inputFile).toLowerCase();
const { rounds, fileDate } = ext === '.csv' ? parseCsv(raw) : parseTxt(raw);

if (!meetingDate) meetingDate = parseFileDate(fileDate);
if (!meetingDate) {
  process.stderr.write(`Error: could not parse date from file ("${fileDate}") — use --date YYYY-MM-DD\n`);
  process.exit(1);
}

if (!meetingName) meetingName = deriveName(meetingDate);

const entryYaml = renderEntry(meetingName, meetingDate, meetingLoc, rounds);

if (!doWrite) {
  console.log(entryYaml);
  process.exit(0);
}

// ─── Write mode: update meetings.yaml ────────────────────────────────────────

const meetingsRaw = fs.readFileSync(MEETINGS_YAML, 'utf8');

// Preserve comment header lines at the top of the file
const commentLines = [];
for (const line of meetingsRaw.split('\n')) {
  if (line.startsWith('#')) commentLines.push(line);
  else break;
}
const header = commentLines.join('\n');

const meetings = yaml.load(meetingsRaw);
const dateStr  = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));

const idx = meetings.findIndex(m =>
  dateStr(m.date) === meetingDate || m.name === meetingName
);

if (idx === -1) {
  // Not found — append a new entry
  const newContent = meetingsRaw.trimEnd() + '\n\n' + entryYaml + '\n';
  fs.writeFileSync(MEETINGS_YAML, newContent);
  console.log(`Appended "${meetingName}" to meetings.yaml`);
} else {
  // Replace the matched entry and rebuild the whole file
  if (meetings[idx].rounds) {
    process.stderr.write(`Warning: "${meetings[idx].name}" already has rounds — overwriting.\n`);
  }
  meetings[idx] = {
    name: meetingName,
    date: meetingDate,
    location: meetingLoc,
    rounds: rounds.map(r => ({ matches: r })),
  };

  const body = meetings.map(m => renderExistingEntry(m)).join('\n\n');
  fs.writeFileSync(MEETINGS_YAML, header + '\n\n' + body + '\n');
  console.log(`Updated "${meetingName}" in meetings.yaml`);
}
