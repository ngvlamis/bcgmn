const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

module.exports = function () {
  const meetings =
    yaml.load(fs.readFileSync(path.join(__dirname, "meetings.yaml"), "utf8")) || [];

  const currentYear = new Date().getFullYear();
  const stats = {};

  for (const meeting of meetings) {
    if (parseInt(String(meeting.date).slice(0, 4)) !== currentYear) continue;
    for (const match of meeting.matches || []) {
      const { p1, p2, winner } = match;
      if (!p1 || !p2 || !winner) continue;
      stats[p1] = stats[p1] || { name: p1, wins: 0, losses: 0 };
      stats[p2] = stats[p2] || { name: p2, wins: 0, losses: 0 };
      if (winner === p1) {
        stats[p1].wins++;
        stats[p2].losses++;
      } else if (winner === p2) {
        stats[p2].wins++;
        stats[p1].losses++;
      }
    }
  }

  return Object.values(stats)
    .map((s) => ({
      ...s,
      played: s.wins + s.losses,
      pct: s.wins + s.losses > 0 ? s.wins / (s.wins + s.losses) : 0,
    }))
    .sort((a, b) => b.pct - a.pct || b.wins - a.wins);
};
