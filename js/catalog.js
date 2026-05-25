/* NetGameForge catalog renderer. Zero dependencies. */
(function () {
  "use strict";

  var grid = document.getElementById("catalog-grid");
  var shelvesEl = document.getElementById("shelves");
  var tagFilterEl = document.getElementById("tag-filter");
  if (!grid) return;

  var allGames = [];
  var activeTag = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function gameUrl(g) {
    return "/games/" + encodeURIComponent(g.id) + "/";
  }

  function cardHTML(g, headingTag) {
    var h = headingTag || "h3";
    var badges = "";
    if (g.flags && g.flags.isNew) badges += '<span class="badge badge--new">Новинка</span>';
    if (g.flags && g.flags.isPopular) badges += '<span class="badge badge--popular">Популярное</span>';
    var tags = (g.tags || [])
      .slice(0, 3)
      .map(function (t) { return "<span>" + esc(t) + "</span>"; })
      .join("");
    // Cover: <img> with lazy/async + explicit dims; CSS gradient shows if it fails.
    var img = g.coverUrl
      ? '<img src="' + esc(g.coverUrl) + '" alt="" width="400" height="400" loading="lazy" decoding="async" onerror="this.remove()">'
      : "";
    return (
      '<article class="game-card">' +
        '<a href="' + esc(gameUrl(g)) + '">' +
          '<span class="cover">' + img +
            (badges ? '<span class="badges">' + badges + "</span>" : "") +
          "</span>" +
          '<span class="body">' +
            "<" + h + ">" + esc(g.title) + "</" + h + ">" +
            '<span class="tags">' + tags + "</span>" +
          "</span>" +
        "</a>" +
      "</article>"
    );
  }

  function renderGrid(games) {
    if (!games.length) {
      grid.innerHTML =
        '<div class="empty-state">' +
          "<h2>Скоро новые игры</h2>" +
          "<p>Каталог пополняется. Загляните позже!</p>" +
        "</div>";
      return;
    }
    grid.innerHTML = games.map(function (g) { return cardHTML(g, "h2"); }).join("");
  }

  function renderShelf(title, games) {
    if (!games.length) return "";
    return (
      '<section class="shelf">' +
        "<h2>" + esc(title) + "</h2>" +
        '<div class="game-grid">' +
          games.map(function (g) { return cardHTML(g, "h3"); }).join("") +
        "</div>" +
      "</section>"
    );
  }

  function renderShelves(games) {
    if (!shelvesEl) return;
    var isNew = games.filter(function (g) { return g.flags && g.flags.isNew; });
    var popular = games.filter(function (g) { return g.flags && g.flags.isPopular; });
    shelvesEl.innerHTML = renderShelf("Новинки", isNew) + renderShelf("Популярное", popular);
  }

  function applyFilter() {
    var filtered = activeTag
      ? allGames.filter(function (g) { return (g.tags || []).indexOf(activeTag) !== -1; })
      : allGames;
    renderGrid(filtered);
  }

  function renderTagFilter(games) {
    if (!tagFilterEl) return;
    var seen = {};
    games.forEach(function (g) {
      (g.tags || []).forEach(function (t) { seen[t] = true; });
    });
    var tags = Object.keys(seen).sort();
    if (!tags.length) return;

    function btn(label, tag) {
      var pressed = activeTag === tag;
      return '<button type="button" aria-pressed="' + pressed + '" data-tag="' +
        (tag == null ? "" : esc(tag)) + '">' + esc(label) + "</button>";
    }
    tagFilterEl.innerHTML =
      btn("Все", null) + tags.map(function (t) { return btn(t, t); }).join("");

    tagFilterEl.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      activeTag = b.getAttribute("data-tag") || null;
      Array.prototype.forEach.call(tagFilterEl.querySelectorAll("button"), function (x) {
        x.setAttribute("aria-pressed", (x === b).toString());
      });
      applyFilter();
    });
  }

  fetch("games.json", { cache: "no-cache" })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      allGames = (data.games || []).filter(function (g) {
        return g.flags && g.flags.isPublished;
      });
      renderTagFilter(allGames);
      renderShelves(allGames);
      renderGrid(allGames);
    })
    .catch(function () {
      grid.innerHTML =
        '<div class="empty-state"><h2>Скоро новые игры</h2>' +
        "<p>Не удалось загрузить каталог.</p></div>";
    });
})();
