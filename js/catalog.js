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
  var activePlatform = null;
  var catFilterEl = document.getElementById("category-filter");
  var platFilterEl = document.getElementById("platform-filter");
  var filterToggleBtn = document.getElementById("filter-toggle");
  var filterPanel = document.getElementById("filter-panel");
  var filterBackdrop = document.getElementById("filter-backdrop");
  var filterApplyBtn = document.getElementById("filter-apply");
  var filterResetBtn = document.getElementById("filter-reset");

  var NEW_DAYS = 30;

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

  // RU-лейблы жанровых чипов (в games.json categories — англ-коды).
  var CATEGORY_LABELS = {
    arcade: "Аркады",
    puzzle: "Головоломки",
    action: "Экшн",
    adventure: "Приключения",
    clicker: "Кликеры",
    simulation: "Симуляторы",
    racing: "Гонки",
    shooter: "Шутеры"
  };

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
    // Для относительных путей (наши ассеты) добавляем ?v=updatedAt для cache-busting.
    var imgSrc = src;
    if (imgSrc && !/^https?:\/\//i.test(imgSrc) && g.updatedAt) {
      imgSrc = imgSrc + "?v=" + encodeURIComponent(g.updatedAt);
    }
    var img = imgSrc
      ? '<img src="' + esc(imgSrc) + '" alt="" width="400" height="400" loading="lazy" decoding="async" onerror="this.remove()">'
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

  function getRecentGames(allGames) {
    var recent;
    try {
      recent = JSON.parse(localStorage.getItem("ngf_recent_v1") || "[]");
    } catch (e) { return []; }
    if (!Array.isArray(recent) || !recent.length) return [];
    var byId = {};
    allGames.forEach(function (g) { byId[g.id] = g; });
    return recent
      .map(function (r) { return byId[r.id]; })
      .filter(Boolean)
      .slice(0, 4);
  }

  function renderShelf(title, games) {
    if (!games.length) return "";
    return (
      '<section class="shelf">' +
        "<h2>" + esc(title) + "</h2>" +
        '<div class="shelf-row">' +
          games.map(function (g) { return cardHTML(g, "h3"); }).join("") +
        "</div>" +
      "</section>"
    );
  }

  var SHELF_MAX = 8; // полка-стрип, не дубль всего каталога

  function renderShelves(games) {
    if (!shelvesEl) return;
    var html = "";

    // 1. «Продолжить играть» — из localStorage, cap 4
    var recent = getRecentGames(games);
    if (recent.length) {
      html += renderShelf("Продолжить играть", recent.slice(0, 4));
    }

    // 2. «Популярное» — flags.isPopular, cap 8
    var popular = games.filter(function (g) { return g.flags && g.flags.isPopular; });
    html += renderShelf("Популярное", popular.slice(0, 8));

    // 3. «Новинки» — скрыть если совпадает со всем каталогом, cap 6
    var isNew = games.filter(isNewGame);
    if (isNew.length && isNew.length < games.length) {
      html += renderShelf("Новинки", isNew.slice(0, 6));
    }

    // 4. Жанровые полки — ≥4 игр в категории, cap 6, порядок по убыванию числа игр
    var catCounts = {};
    games.forEach(function (g) {
      gameCategories(g).forEach(function (c) {
        if (c) catCounts[c] = (catCounts[c] || 0) + 1;
      });
    });
    var sortedCats = Object.keys(catCounts)
      .filter(function (c) { return catCounts[c] >= 4; })
      .sort(function (a, b) { return catCounts[b] - catCounts[a]; });
    sortedCats.forEach(function (cat) {
      var catGames = games.filter(function (g) { return gameCategories(g).indexOf(cat) !== -1; });
      var label = CATEGORY_LABELS[cat] || cat;
      html += renderShelf(label, catGames.slice(0, 6));
    });

    shelvesEl.innerHTML = html;
  }

  function applyFilter() {
    var filtered = allGames.filter(function (g) {
      if (activeTag && (g.tags || []).indexOf(activeTag) === -1) return false;
      if (activeCategory && gameCategories(g).indexOf(activeCategory) === -1) return false;
      if (activePlatform && (g.platforms || []).indexOf(activePlatform) === -1) return false;
      return true;
    });
    renderGrid(filtered);
    updateFilterBtn();
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
      btn("Все", null) + cats.map(function (c) { return btn(CATEGORY_LABELS[c] || c, c); }).join("");

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

  function renderPlatformFilter(games) {
    if (!platFilterEl) return;
    var hasPc = games.some(function (g) { return (g.platforms || []).indexOf("pc") !== -1; });
    var hasMobile = games.some(function (g) { return (g.platforms || []).indexOf("mobile") !== -1; });
    if (!hasPc && !hasMobile) return;

    function btn(label, plat) {
      var pressed = activePlatform === plat;
      return '<button type="button" aria-pressed="' + pressed + '" data-platform="' +
        (plat == null ? "" : esc(plat)) + '">' + esc(label) + "</button>";
    }
    var html = btn("Все", null);
    if (hasPc) html += btn("ПК", "pc");
    if (hasMobile) html += btn("Мобильные", "mobile");
    platFilterEl.innerHTML = html;

    platFilterEl.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      activePlatform = b.getAttribute("data-platform") || null;
      Array.prototype.forEach.call(platFilterEl.querySelectorAll("button"), function (x) {
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

  // ---- Filter panel toggle (desktop dropdown / mobile bottom sheet) ----

  function openFilterPanel() {
    if (!filterPanel || !filterToggleBtn) return;
    filterPanel.hidden = false;
    filterToggleBtn.setAttribute("aria-expanded", "true");
  }

  function closeFilterPanel() {
    if (!filterPanel || !filterToggleBtn) return;
    filterPanel.hidden = true;
    filterToggleBtn.setAttribute("aria-expanded", "false");
    filterToggleBtn.focus();
  }

  function updateFilterBtn() {
    if (!filterToggleBtn) return;
    var count = (activeTag ? 1 : 0) + (activePlatform ? 1 : 0);
    var hasActive = count > 0;
    filterToggleBtn.classList.toggle("has-active", hasActive);
    filterToggleBtn.textContent = hasActive ? "Фильтры \xB7 " + count : "Фильтры";
  }

  function initFilterToggle() {
    if (!filterToggleBtn || !filterPanel) return;

    filterToggleBtn.addEventListener("click", function () {
      if (filterPanel.hidden) {
        openFilterPanel();
      } else {
        closeFilterPanel();
      }
    });

    if (filterBackdrop) {
      filterBackdrop.addEventListener("click", closeFilterPanel);
    }

    if (filterApplyBtn) {
      filterApplyBtn.addEventListener("click", function () {
        closeFilterPanel();
        applyFilter();
      });
    }

    if (filterResetBtn) {
      filterResetBtn.addEventListener("click", function () {
        activeTag = null;
        activePlatform = null;
        if (platFilterEl) {
          Array.prototype.forEach.call(platFilterEl.querySelectorAll("button"), function (b) {
            b.setAttribute("aria-pressed", (b.getAttribute("data-platform") === "").toString());
          });
        }
        if (tagFilterEl) {
          Array.prototype.forEach.call(tagFilterEl.querySelectorAll("button"), function (b) {
            b.setAttribute("aria-pressed", (b.getAttribute("data-tag") === "").toString());
          });
        }
        updateFilterBtn();
        closeFilterPanel();
        applyFilter();
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && filterPanel && !filterPanel.hidden) {
        closeFilterPanel();
      }
    });

    // Закрытие по клику вне панели (desktop)
    document.addEventListener("click", function (e) {
      if (!filterPanel || filterPanel.hidden) return;
      var withinPanel = filterPanel.contains(e.target);
      var withinToggle = filterToggleBtn && filterToggleBtn.contains(e.target);
      if (!withinPanel && !withinToggle) {
        closeFilterPanel();
      }
    });
  }

  // Показать/скрыть кнопку «Фильтры» в зависимости от наличия платформ/тегов.
  function maybeShowFilterBtn(games) {
    if (!filterToggleBtn) return;
    var hasPlatforms = games.some(function (g) { return (g.platforms || []).length > 0; });
    var hasTags = games.some(function (g) { return (g.tags || []).length > 0; });
    if (hasPlatforms || hasTags) {
      filterToggleBtn.hidden = false;
    }
  }

  // ---- NGF-078: Sidebar / genre navigation ----

  var GENRE_ICONS_SVG = {
    arcade:     '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="10" r="3" fill="currentColor"/></svg>',
    action:     '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 3l7 14H3L10 3z" fill="currentColor"/></svg>',
    puzzle:     '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="7" height="7" rx="1" fill="currentColor"/><rect x="11" y="2" width="7" height="7" rx="1" fill="currentColor"/><rect x="2" y="11" width="7" height="7" rx="1" fill="currentColor"/><rect x="11" y="11" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    adventure:  '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 10l6-6 4 4-6 8-4-6z" fill="currentColor"/></svg>',
    clicker:    '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 2l2 5h5l-4 3 2 5-5-3-5 3 2-5-4-3h5z" fill="currentColor"/></svg>',
    simulation: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    racing:     '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 12l4-6h8l4 6H2z" fill="currentColor"/><rect x="4" y="12" width="3" height="3" rx="1.5" fill="currentColor"/><rect x="13" y="12" width="3" height="3" rx="1.5" fill="currentColor"/></svg>',
    shooter:    '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 10h14M14 6l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  var ALL_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="7" height="7" rx="1" fill="currentColor"/><rect x="11" y="2" width="7" height="7" rx="1" fill="currentColor"/><rect x="2" y="11" width="7" height="7" rx="1" fill="currentColor"/><rect x="11" y="11" width="7" height="7" rx="1" fill="currentColor"/></svg>';

  function renderSidebarGenres(games) {
    var sidebarList = document.getElementById('sidebar-genre-list');
    var drawerList = document.getElementById('genres-drawer-list');

    var cats = Object.keys(CATEGORY_LABELS);
    if (games && games.length) {
      var existing = {};
      games.forEach(function(g) { gameCategories(g).forEach(function(c) { existing[c] = true; }); });
      cats = cats.filter(function(c) { return existing[c]; });
    }
    // If no games (e.g. fetch error), show all known categories

    function makeSidebarItem(cat, label, iconSvg, isActive) {
      return '<li><button type="button" class="sidebar-item' + (isActive ? ' sidebar-item--active' : '') +
        '" data-category="' + esc(cat) + '" aria-pressed="' + isActive + '" title="' + esc(label) + '">' +
        '<span class="sidebar-icon" aria-hidden="true">' + (iconSvg || '') + '</span>' +
        '<span class="sidebar-label">' + esc(label) + '</span>' +
        '</button></li>';
    }

    var allActive = !activeCategory;
    var html = makeSidebarItem('', 'Все игры', ALL_ICON_SVG, allActive);
    cats.forEach(function(c) {
      html += makeSidebarItem(c, CATEGORY_LABELS[c], GENRE_ICONS_SVG[c] || '', activeCategory === c);
    });

    if (sidebarList) { sidebarList.innerHTML = html; }

    if (drawerList) {
      var drawerHtml = '<li><button type="button" class="genres-drawer__item' + (allActive ? ' genres-drawer__item--active' : '') +
        '" data-category="">' +
        '<span aria-hidden="true">' + ALL_ICON_SVG + '</span>Все игры</button></li>';
      cats.forEach(function(c) {
        var active = activeCategory === c;
        drawerHtml += '<li><button type="button" class="genres-drawer__item' + (active ? ' genres-drawer__item--active' : '') +
          '" data-category="' + esc(c) + '">' +
          '<span aria-hidden="true">' + (GENRE_ICONS_SVG[c] || '') + '</span>' +
          esc(CATEGORY_LABELS[c]) + '</button></li>';
      });
      drawerList.innerHTML = drawerHtml;
    }
  }

  function initSidebar() {
    var toggle = document.getElementById('sidebar-toggle');
    var sidebar = document.getElementById('main-sidebar');
    if (!toggle || !sidebar) return;

    // Restore state from localStorage (default: collapsed)
    var saved = localStorage.getItem('ngf_sidebar');
    if (saved === 'expanded') {
      document.body.classList.add('sidebar-expanded');
      toggle.setAttribute('aria-expanded', 'true');
    }

    toggle.addEventListener('click', function() {
      var isExpanded = document.body.classList.toggle('sidebar-expanded');
      toggle.setAttribute('aria-expanded', isExpanded.toString());
      localStorage.setItem('ngf_sidebar', isExpanded ? 'expanded' : 'collapsed');
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && document.body.classList.contains('sidebar-expanded')) {
        document.body.classList.remove('sidebar-expanded');
        toggle.setAttribute('aria-expanded', 'false');
        localStorage.setItem('ngf_sidebar', 'collapsed');
      }
    });
  }

  function initSidebarGenreClicks() {
    var sidebarList = document.getElementById('sidebar-genre-list');
    if (!sidebarList) return;
    sidebarList.addEventListener('click', function(e) {
      var btn = e.target.closest('button[data-category]');
      if (!btn) return;
      activeCategory = btn.getAttribute('data-category') || null;
      applyFilter();
      renderSidebarGenres(allGames);
      var gridEl = document.getElementById('catalog-grid');
      if (gridEl) gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function initGenresDrawer() {
    var trigger = document.getElementById('genres-drawer-trigger');
    var drawer = document.getElementById('genres-drawer');
    var backdrop = document.getElementById('genres-drawer-backdrop');
    var drawerList = document.getElementById('genres-drawer-list');
    if (!trigger || !drawer) return;

    function openDrawer() {
      drawer.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
    }
    function closeDrawer() {
      drawer.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', function() {
      if (drawer.hidden) { openDrawer(); } else { closeDrawer(); }
    });
    if (backdrop) backdrop.addEventListener('click', closeDrawer);

    if (drawerList) {
      drawerList.addEventListener('click', function(e) {
        var btn = e.target.closest('button[data-category]');
        if (!btn) return;
        activeCategory = btn.getAttribute('data-category') || null;
        applyFilter();
        renderSidebarGenres(allGames);
        closeDrawer();
        var gridEl = document.getElementById('catalog-grid');
        if (gridEl) gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  // ---- end NGF-078 ----

  // Init sidebar toggle immediately (before fetch) so hamburger is responsive on page load
  initSidebar();

  // NGF-082: определяем тип устройства один раз при загрузке.
  // pointer:coarse — наиболее надёжный сигнал тач-устройства (мышь = fine).
  var IS_MOBILE_DEVICE = (function () {
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return true;
    return false;
  })();

  fetch("games.json?v=" + Date.now(), { cache: "no-cache" })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var entries = data.games || [];
      // v2: показывать только published-слой; draft-only в публичный каталог не идут.
      // legacy v1: фильтровать по flags.isPublished как прежде.
      var publishedGames = (data.version >= 2
        ? entries.filter(function(e) { return e.published; }).map(function(e) { return e.published; })
        : entries.filter(function(g) { return g.flags && g.flags.isPublished; })
      );
      // NGF-082: авто-фильтр по устройству — скрывать несовместимые платформы.
      // mobile-устройство видит только игры с "mobile" в platforms;
      // desktop-устройство видит только игры с "pc" в platforms.
      // Игры с обеими платформами видны везде.
      allGames = publishedGames.filter(function (g) {
        var plats = g.platforms || [];
        if (IS_MOBILE_DEVICE) return plats.indexOf("mobile") !== -1;
        return plats.indexOf("pc") !== -1;
      });
      // Применить ?cat= из URL если передан
      var urlCat = new URLSearchParams(location.search).get('cat');
      if (urlCat) activeCategory = urlCat;

      renderTagFilter(allGames);
      renderPlatformFilter(allGames);
      maybeShowFilterBtn(allGames);
      initFilterToggle();
      renderShelves(allGames);
      renderGrid(allGames);
      renderSidebarGenres(allGames);
      initSidebarGenreClicks();
      initGenresDrawer();
    })
    .catch(function () {
      grid.innerHTML =
        '<div class="empty-state"><h2>Скоро новые игры</h2>' +
        "<p>Не удалось загрузить каталог.</p></div>";
      // Fallback: рендерим статичный список жанров из CATEGORY_LABELS
      renderSidebarGenres([]);
    });
})();
