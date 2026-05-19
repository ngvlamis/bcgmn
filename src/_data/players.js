const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

module.exports = function () {
  const meetings =
    yaml.load(fs.readFileSync(path.join(__dirname, "meetings.yaml"), "utf8")) || [];
  const meta =
    yaml.load(fs.readFileSync(path.join(__dirname, "playerMeta.yaml"), "utf8")) || [];

  const metaByName = Object.fromEntries(meta.map((m) => [m.name, m]));

  const currentYear = new Date().getFullYear();
  const attendance = {};

  for (const meeting of meetings) {
    if (parseInt(String(meeting.date).slice(0, 4)) !== currentYear) continue;

    const matches = (meeting.rounds || []).flatMap((r) => r.matches || []);
    const attendees = new Set();

    for (const match of matches) {
      if (match.p1) attendees.add(match.p1);
      if (!match.bye && match.p2) attendees.add(match.p2);
    }

    for (const name of attendees) {
      attendance[name] = (attendance[name] || 0) + 1;
    }
  }

  const makePlayer = (name) => ({
    name,
    events: attendance[name],
    ...Object.fromEntries(
      ["bio", "rating", "joined", "photo", "bmab", "bmab_title", "role", "og", "email"]
        .filter((k) => metaByName[name]?.[k] != null)
        .map((k) => [k, metaByName[name][k]])
    ),
  });

  const lastName = (name) => name.split(" ").at(-1);
  const byLastName = (a, b) => lastName(a.name).localeCompare(lastName(b.name));

  const members = Object.keys(attendance)
    .filter((name) => attendance[name] >= 2)
    .map(makePlayer)
    .sort(byLastName);

  const guests = Object.keys(attendance)
    .filter((name) => attendance[name] === 1)
    .map(makePlayer)
    .sort(byLastName);

  return { members, guests, all: [...members, ...guests] };
};
