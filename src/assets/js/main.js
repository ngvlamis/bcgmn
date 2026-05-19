// Theme toggle — cycles: auto → light → dark → auto
const themeToggle = document.querySelector(".theme-toggle");
if (themeToggle) {
  const labels = { auto: "Theme: system", light: "Theme: light", dark: "Theme: dark" };
  const cycle  = { auto: "light", light: "dark", dark: "auto" };

  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "auto";
    const next = cycle[current] || "auto";
    document.documentElement.setAttribute("data-theme", next);
    themeToggle.setAttribute("aria-label", labels[next]);
    if (next === "auto") {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", next);
    }
  });
}

// Hamburger nav
const hamburger = document.querySelector(".nav-hamburger");
if (hamburger) {
  const nav = hamburger.closest(".nav");

  hamburger.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    hamburger.setAttribute("aria-expanded", String(isOpen));
  });

  nav.querySelectorAll(".nav-links a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      hamburger.setAttribute("aria-expanded", "false");
    });
  });

  document.addEventListener("click", (e) => {
    if (!nav.contains(e.target)) {
      nav.classList.remove("is-open");
      hamburger.setAttribute("aria-expanded", "false");
    }
  });
}

// Meeting expand/collapse
document.querySelectorAll(".meeting-header").forEach((btn) => {
  btn.addEventListener("click", () => {
    const card = btn.closest(".meeting-card");
    const body = card.querySelector(".meeting-body");
    if (!body) return;
    const isOpen = !body.hidden;
    body.hidden = isOpen;
    btn.setAttribute("aria-expanded", String(!isOpen));
    card.classList.toggle("is-open", !isOpen);
  });
});

// Round expand/collapse
document.querySelectorAll(".round-header").forEach((btn) => {
  btn.addEventListener("click", () => {
    const section = btn.closest(".round-section");
    const body = section.querySelector(".round-body");
    const isOpen = !body.hidden;
    body.hidden = isOpen;
    btn.setAttribute("aria-expanded", String(!isOpen));
    section.classList.toggle("is-open", !isOpen);
  });
});

// Standings sort
const table = document.getElementById("standings-table");
if (table) {
  let sortCol = "pct";
  let sortDir = -1;

  table.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      sortDir = col === sortCol ? sortDir * -1 : th.dataset.type === "string" ? 1 : -1;
      sortCol = col;
      sortRows(col, sortDir, th.dataset.type);
      table.querySelectorAll("th[aria-sort]").forEach((h) => h.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", sortDir === 1 ? "ascending" : "descending");
    });
  });

  function colIndex(col) {
    return Array.from(table.querySelectorAll("th")).findIndex(
      (h) => h.dataset.sort === col
    );
  }

  function sortRows(col, dir, type) {
    const tbody = table.querySelector("tbody");
    const idx = colIndex(col);
    const rows = Array.from(tbody.querySelectorAll("tr"));
    rows.sort((a, b) => {
      const av = a.cells[idx].textContent.trim();
      const bv = b.cells[idx].textContent.trim();
      return type === "string"
        ? dir * av.localeCompare(bv)
        : dir * (parseFloat(av) - parseFloat(bv));
    });
    rows.forEach((r, i) => {
      tbody.appendChild(r);
      r.cells[0].textContent = i + 1;
      r.classList.toggle("top-three", i < 3);
    });
  }
}
