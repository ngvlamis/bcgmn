const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

module.exports = function () {
  const meetings =
    yaml.load(fs.readFileSync(path.join(__dirname, "meetings.yaml"), "utf8")) || [];

  const currentYear = new Date().getFullYear();
  const stats = {};

  const ensure = (name) => {
    if (!stats[name]) stats[name] = { name, points: 0, wins: 0, losses: 0, byes: 0, events: 0 };
  };

  for (const meeting of meetings) {
    if (parseInt(String(meeting.date).slice(0, 4)) !== currentYear) continue;

    const matches = (meeting.rounds || []).flatMap((r) => r.matches || []);
    const attendees = new Set();
    const meetingWins = {};
    const meetingLosses = {};
    const meetingByes = {};

    for (const match of matches) {
      const { p1, p2, w, bye: isBye } = match;

      if (isBye || !p2) {
        if (p1) {
          ensure(p1);
          attendees.add(p1);
          stats[p1].byes++;
          stats[p1].points += 2.5;
          meetingByes[p1] = (meetingByes[p1] || 0) + 1;
        }
        continue;
      }

      if (!p1 || !p2 || !w) continue;
      ensure(p1);
      ensure(p2);
      attendees.add(p1);
      attendees.add(p2);

      const winner = w === 1 ? p1 : p2;
      const loser  = w === 1 ? p2 : p1;
      stats[winner].wins++;
      stats[winner].points += 5;
      meetingWins[winner]  = (meetingWins[winner]  || 0) + 1;
      meetingLosses[loser] = (meetingLosses[loser] || 0) + 1;
      stats[loser].losses++;
    }

    // Attendance bonus
    for (const name of attendees) {
      stats[name].events++;
      stats[name].points += 5;
    }

    // 3-0 bonus: split 5 pts among all undefeated players (wins + bye = 3, no losses)
    const perfect = [...attendees].filter(
      (name) => (meetingWins[name] || 0) + (meetingByes[name] || 0) >= 3 && !(meetingLosses[name])
    );
    if (perfect.length > 0) {
      const share = 5 / perfect.length;
      for (const name of perfect) {
        stats[name].points += share;
      }
    }
  }

  return Object.values(stats).sort((a, b) => b.points - a.points || b.wins - a.wins);
};
