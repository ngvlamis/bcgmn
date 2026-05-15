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

    const matches = meeting.matches || [];
    const attendees = new Set();
    const meetingWins = {};   // real wins only (not byes)
    const meetingLosses = {};

    for (const match of matches) {
      const { p1, p2, winner, bye: isBye } = match;

      if (isBye || !p2) {
        // Bye: p1 gets 2.5 pts; byes don't count toward the 3-0 record
        if (p1) {
          ensure(p1);
          attendees.add(p1);
          stats[p1].byes++;
          stats[p1].points += 2.5;
        }
        continue;
      }

      if (!p1 || !p2 || !winner) continue;
      ensure(p1);
      ensure(p2);
      attendees.add(p1);
      attendees.add(p2);

      if (winner === p1) {
        stats[p1].wins++;
        stats[p1].points += 5;
        meetingWins[p1] = (meetingWins[p1] || 0) + 1;
        meetingLosses[p2] = (meetingLosses[p2] || 0) + 1;
        stats[p2].losses++;
      } else if (winner === p2) {
        stats[p2].wins++;
        stats[p2].points += 5;
        meetingWins[p2] = (meetingWins[p2] || 0) + 1;
        meetingLosses[p1] = (meetingLosses[p1] || 0) + 1;
        stats[p1].losses++;
      }
    }

    // Attendance bonus
    for (const name of attendees) {
      stats[name].events++;
      stats[name].points += 5;
    }

    // 3-0 bonus: split 5 pts among all players with 3 wins and 0 losses at this meeting
    const perfect = [...attendees].filter(
      (name) => (meetingWins[name] || 0) === 3 && !(meetingLosses[name])
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
