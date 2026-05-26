/* NetGameForge catalog renderer. Zero dependencies. */
(function () {
  "use strict";

  var grid = document.getElementById("catalog-grid");
  var shelvesEl = document.getElementById("shelves");
  var tagFilterEl = document.getElementById("tag-filter");
  if (!grid) return;

  var allGames = [];
  var activeTag = null;
  var activeCategory = null;
  var catFilterEl = document.getElementById("category-filter");

  var NEW_DAYS = 14;

  // i18n: поддерживаемые локали (совпадает с scripts/translate.js).
  var SUPPORTED_LANGS = ["en", "es", "pt-br"];

  // Выбор локали по navigator.language. ru-оригинал = null (фолбэк).
  function detectLang() {
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || "";
    nav = String(nav).toLowerCase();
    if (nav.indexOf("pt") === 0) return "pt-br";       // pt, pt-BR, pt-PT → pt-br
    if (nav.indexOf("es") === 0) return "es";
    if (nav.indexOf("en") === 0) return "en";
    return null; // включая ru → оригинал
  }
  var LANG = detectLang();

  // Берём перевод поля из game.i18n[LANG] с фолбэком на ru-оригинал.
  function pickField(g, field) {
    if (LANG && g.i18n && g.i18n[LANG] && typeof g.i18n[LANG][field] === "string" && g.i18n[LANG][field]) {
      return g.i18n[LANG][field];
    }
    return g[field];
  }

  // Хелпер: вернуть объект выбранных полей в нужной локали. pickLang(g, ["title","description"]).
  function pickLang(g, fields) {
    var out = {};
    (fields || []).forEach(function (f) { out[f] = pickField(g, f); });
    return out;
  }

  // Категории игры: categories[] или фолбэк со старого одиночного category.
  function gameCategories(g) {
    if (Array.isArray(g.categories) && g.categories.length) return g.categories;
    if (g.category) return [g.category];
    return [];
  }

  // «Новинка» вычисляется из dateAdded (≤14 дней), а не из flags.
  function isNewGame(g) {
    if (!g.dateAdded) return false;
    var added = new Date(g.dateAdded).getTime();
    if (isNaN(added)) return false;
    return (Date.now() - added) <= NEW_DAYS * 24 * 60 * 60 * 1000;
  }

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
    var title = pickLang(g, ["title"]).title;
    var badges = "";
    if (isNewGame(g)) badges += '<span class="badge badge--new">Новинка</span>';
    if (g.flags && g.flags.isPopular) badges += '<span class="badge badge--popular">Популярное</span>';
    var tags = (g.tags || [])
      .slice(0, 3)
      .map(function (t) { return "<span>" + esc(t) + "</span>"; })
      .join("");
    // Изображение карточки: иконка (если есть), иначе обложка; CSS-градиент при ошибке.
    var src = g.icon || g.coverUrl;
    var img = src
      ? '<img src="' + esc(src) + '" alt="" width="400" height="400" loading="lazy" decoding="async" onerror="this.remove()">'
      : "";
    return (
      '<article class="game-card">' +
        '<a href="' + esc(gameUrl(g)) + '">' +
          '<span class="cover">' + img +
            (badges ? '<span class="badges">' + badges + "</span>" : "") +
          "</span>" +
          '<span class="body">' +
            "<" + h + ">" + esc(title) + "</" + h + ">" +
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
    var isNew = games.filter(isNewGame);
    var popular = games.filter(function (g) { return g.flags && g.flags.isPopular; });
    shelvesEl.innerHTML = renderShelf("Новинки", isNew) + renderShelf("Популярное", popular);
  }

  function applyFilter() {
    var filtered = allGames.filter(function (g) {
      if (activeTag && (g.tags || []).indexOf(activeTag) === -1) return false;
      if (activeCategory && gameCategories(g).indexOf(activeCategory) === -1) return false;
      return true;
    });
    renderGrid(filtered);
  }

  function renderCategoryFilter(games) {
    if (!catFilterEl) return;
    var seen = {};
    games.forEach(function (g) {
      gameCategories(g).forEach(function (c) { if (c) seen[c] = true; });
    });
    var cats = Object.keys(seen).sort();
    if (!cats.length) return;

    function btn(label, cat) {
      var pressed = activeCategory === cat;
      return '<button type="button" aria-pressed="' + pressed + '" data-category="' +
        (cat == null ? "" : esc(cat)) + '">' + esc(label) + "</button>";
    }
    catFilterEl.innerHTML =
      btn("Все", null) + cats.map(function (c) { return btn(c, c); }).join("");

    catFilterEl.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      activeCategory = b.getAttribute("data-category") || null;
      Array.prototype.forEach.call(catFilterEl.querySelectorAll("button"), function (x) {
        x.setAttribute("aria-pressed", (x === b).toString());
      });
      applyFilter();
    });
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
      renderCategoryFilter(allGames);
      renderShelves(allGames);
      renderGrid(allGames);
    })
    .catch(function () {
      grid.innerHTML =
        '<div class="empty-state"><h2>Скоро новые игры</h2>' +
        "<p>Не удалось загрузить каталог.</p></div>";
    });
})();
