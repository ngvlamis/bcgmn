const yaml = require("js-yaml");

module.exports = function (eleventyConfig) {
  eleventyConfig.addDataExtension("yaml", (contents) => yaml.load(contents));
  eleventyConfig.addDataExtension("yml", (contents) => yaml.load(contents));

  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/CNAME");

  eleventyConfig.addFilter("dateFormat", (dateStr) => {
    const [y, m, d] = String(dateStr).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  });

  eleventyConfig.addFilter("round", (num, places = 0) =>
    Number(num).toFixed(places)
  );

  eleventyConfig.addFilter("sumMatches", (rounds) =>
    (rounds || []).reduce((sum, r) => sum + (r.matches || []).length, 0)
  );

  eleventyConfig.addFilter("meetingTally", (rounds) => {
    const players = {};
    for (const round of (rounds || [])) {
      for (const match of (round.matches || [])) {
        if (!players[match.p1]) players[match.p1] = { name: match.p1, wins: 0, losses: 0, byes: 0 };
        if (match.bye || !match.p2) {
          players[match.p1].byes++;
        } else {
          if (!players[match.p2]) players[match.p2] = { name: match.p2, wins: 0, losses: 0, byes: 0 };
          if (match.w === 1) { players[match.p1].wins++; players[match.p2].losses++; }
          else if (match.w === 2) { players[match.p2].wins++; players[match.p1].losses++; }
        }
      }
    }
    return Object.values(players).sort((a, b) =>
      b.wins !== a.wins ? b.wins - a.wins : a.losses - b.losses
    );
  });

  eleventyConfig.addFilter("linkEmails", (text) =>
    String(text).replace(
      /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
      (email) => `<a href="mailto:${email}">${email}</a>`
    )
  );

  eleventyConfig.addFilter("dateFormatMonth", (dateStr) => {
    const [y, m] = String(dateStr).split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk", "html", "md"],
  };
};
