#!/usr/bin/env node
/* NetGameForge build: games.json -> games/<slug>/index.html + sitemap.xml.
   Zero dependencies — Node built-ins only. */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SITE = "https://netgameforge.com";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function readGames() {
  const raw = fs.readFileSync(path.join(ROOT, "games.json"), "utf8");
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.games)) throw new Error("games.json: missing games[]");
  // v2: извлечь published-слой; draft-only записи в публичный каталог не попадают.
  if (data.version >= 2) {
    return data.games
      .filter(function(e) { return e.published; })
      .map(function(e) { return e.published; });
  }
  // legacy v1: плоский GameMeta[]
  return data.games;
}

// Категории игры: categories[] или фолбэк со старого одиночного category.
function gameCategories(g) {
  if (Array.isArray(g.categories) && g.categories.length) return g.categories.filter(Boolean);
  if (g.category) return [g.category];
  return [];
}

// Основная (primary) категория = categories[0].
function primaryCategory(g) {
  const cats = gameCategories(g);
  return cats.length ? cats[0] : "";
}

// «Новинка» вычисляется из dateAdded (≤14 дней), а не из flags.
function isNewGame(g) {
  if (!g.dateAdded) return false;
  const added = new Date(g.dateAdded).getTime();
  if (isNaN(added)) return false;
  return (Date.now() - added) <= 14 * 24 * 60 * 60 * 1000;
}

// Cover for a game page resolves one level up from games/<slug>/.
function pageCover(g) {
  if (!g.coverUrl) return "";
  return /^https?:\/\//.test(g.coverUrl) ? g.coverUrl : SITE + "/" + g.coverUrl.replace(/^\/+/, "");
}

// Абсолютный URL иконки (если задана), как og/schema image-фолбэк.
function pageIcon(g) {
  if (!g.icon) return "";
  return /^https?:\/\//.test(g.icon) ? g.icon : SITE + "/" + g.icon.replace(/^\/+/, "");
}

function platformHint(g) {
  const pl = Array.isArray(g.platforms) ? g.platforms : [];
  if (pl.indexOf("pc") !== -1 && pl.indexOf("mobile") !== -1) return "ПК и мобильные";
  if (pl.indexOf("pc") !== -1) return "ПК";
  if (pl.indexOf("mobile") !== -1) return "Мобильные";
  // фолбэк: прежнее поведение по ориентации
  return g.orientation === "portrait" ? "управление одним касанием" : "управление с клавиатуры или касанием";
}

function leadSentence(g) {
  const control = platformHint(g);
  return `${esc(g.title)} — это ${esc(primaryCategory(g))}-игра, ${control}. Играйте прямо в браузере.`;
}

function relatedGames(g, all) {
  const tags = new Set(g.tags || []);
  const cats = new Set(gameCategories(g));
  return all
    .filter((x) => x.id !== g.id && x.flags && x.flags.isPublished)
    .map((x) => ({ x, score: (x.tags || []).filter((t) => tags.has(t)).length + (gameCategories(x).some((c) => cats.has(c)) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((o) => o.x);
}

function gamePageHTML(g, all) {
  const url = `${SITE}/games/${g.id}/`;
  const cover = pageCover(g);
  const icon = pageIcon(g);
  const image = cover || icon;
  const cats = gameCategories(g);
  const primary = primaryCategory(g);
  const desc = esc(g.description || "");
  const orientation = g.orientation === "portrait" ? "portrait" : "landscape";
  const tags = (g.tags || []).map((t) => `<span>${esc(t)}</span>`).join("");

  const related = relatedGames(g, all);
  const relatedHTML = related.length
    ? `<section class="shelf" aria-labelledby="related-h">
      <h2 id="related-h">Похожие игры</h2>
      <div class="game-grid">
        ${related.map((r) => {
          const rRawSrc = r.icon || r.coverUrl;
          const rSrc = rRawSrc
            ? (function() {
                const base = "/" + esc(rRawSrc.replace(/^\/+/, ""));
                return /^https?:\/\//i.test(rRawSrc)
                  ? esc(rRawSrc)
                  : (r.updatedAt ? base + "?v=" + encodeURIComponent(r.updatedAt) : base);
              })()
            : "";
          return `
        <article class="game-card">
          <a href="/games/${esc(r.id)}/">
            <span class="cover">${rSrc ? `<img src="${rSrc}" alt="" width="400" height="400" loading="lazy" decoding="async" onerror="this.remove()">` : ""}</span>
            <span class="body"><h3>${esc(r.title)}</h3></span>
          </a>
        </article>`;
        }).join("")}
      </div>
    </section>`
    : "";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: g.title,
    description: g.description,
    url: url,
    genre: cats.length ? cats : undefined,
    author: { "@type": "Organization", name: g.author || "NetGameForge" },
    publisher: { "@type": "Organization", name: "NetGameForge" },
    image: image || undefined,
    datePublished: g.dateAdded,
    keywords: (g.tags || []).join(", "),
    applicationCategory: "Game",
    operatingSystem: "Web"
  };

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- frame-ancestors браузер игнорирует в <meta>; полноценный CSP-заголовок ставится на VPS (Фаза 2) -->
  <title>${esc(g.title)} — играть бесплатно онлайн | NetGameForge</title>
  <meta name="description" content="${desc}">
  <link rel="canonical" href="${url}">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="NetGameForge">
  <meta property="og:title" content="${esc(g.title)} — играть бесплатно онлайн">
  <meta property="og:description" content="${desc}">
  <meta property="og:url" content="${url}">
  ${image ? `<meta property="og:image" content="${esc(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">` : ""}

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(g.title)} — играть бесплатно онлайн">
  <meta name="twitter:description" content="${desc}">
  ${image ? `<meta name="twitter:image" content="${esc(image)}">` : ""}

  <link rel="stylesheet" href="/css/styles.css">

  <!-- Analytics: Google Analytics 4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-2VT82NLXH9"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-2VT82NLXH9');
  </script>
  <!-- Analytics: Yandex.Metrika -->
  <script type="text/javascript">
    (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
    m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}
    k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
    (window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");
    ym(109411317, "init", {clickmap:true, trackLinks:true, accurateTrackBounce:true});
  </script>
  <noscript><div><img src="https://mc.yandex.ru/watch/109411317" style="position:absolute; left:-9999px;" alt=""></div></noscript>

  <script type="application/ld+json">
  ${JSON.stringify(jsonLd, null, 2)}
  </script>
</head>
<body>
  <header class="site-header">
    <div class="container">
      <a class="brand" href="/">
        <img src="/assets/logo/site-logo.png" alt="NetGameForge" width="1254" height="1254" decoding="async">
        <span>NetGameForge</span>
      </a>
    </div>
  </header>

  <main class="container">
    <nav class="breadcrumbs" aria-label="Хлебные крошки">
      <a href="/">Каталог</a> ›
      <a href="/?category=${encodeURIComponent(primary)}">${esc(primary)}</a> ›
      <span aria-current="page">${esc(g.title)}</span>
    </nav>

    <div class="game-hero">
      <h1 data-i18n="title">${esc(g.title)}</h1>
      ${(function() {
        const pl = Array.isArray(g.platforms) ? g.platforms : [];
        const badges = pl.map(function(p) {
          return p === "pc"
            ? '<span class="platform-badge platform-badge--pc">🖥 ПК</span>'
            : '<span class="platform-badge platform-badge--mobile">📱 Мобильные</span>';
        }).join(" ");
        return badges ? `<p class="platform-badges">${badges}</p>` : "";
      })()}
      <p class="game-lead">${leadSentence(g)}</p>
    </div>

    <div class="game-frame ${orientation}">
      <iframe id="game-frame" src="${esc(g.buildUrl)}" title="${esc(g.title)}"
        sandbox="allow-scripts allow-pointer-lock allow-same-origin"
        allow="autoplay; fullscreen; gamepad" referrerpolicy="no-referrer"
        loading="lazy"></iframe>
    </div>
  <script>
    (function () {
      var SLUG = "${esc(g.id)}";
      document.addEventListener("DOMContentLoaded", function () {
        fetch("/games.json?v=" + Date.now(), { cache: "no-cache" })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var rawGames = data && data.games ? data.games : (Array.isArray(data) ? data : []);
            // v2: достать published-слой; v1 (legacy): плоская запись.
            var games = (data && data.version >= 2)
              ? rawGames.filter(function(e) { return e.published; }).map(function(e) { return e.published; })
              : rawGames;
            var entry = null;
            for (var i = 0; i < games.length; i++) { if (games[i].id === SLUG) { entry = games[i]; break; } }
            if (!entry || !entry.buildUrl) return;
            var frame = document.getElementById("game-frame");
            if (!frame) return;
            if (entry.buildUrl !== frame.src) { frame.src = entry.buildUrl; }
          })
          .catch(function () { /* молчок — оставляем захардкоженный src */ });
      });
    })();
  </script>

    <div id="ngf-ratings" data-slug="${esc(g.id)}"></div>

    <section class="game-meta" aria-label="Об игре">
      <p data-i18n="description">${desc}</p>
      <p>Жанр: ${esc(cats.join(", "))} · Автор: ${esc(g.author || "NetGameForge")}</p>
      <div class="tags">${tags}</div>
    </section>
${(function() {
  const pl = Array.isArray(g.platforms) ? g.platforms : [];
  const ctrl = g.controls || {};
  const LABEL = { pc: "ПК", mobile: "Мобильные" };
  const items = pl.filter(function(p) { return ctrl[p]; }).map(function(p) {
    return `<dt>${esc(LABEL[p] || p)}</dt><dd>${esc(ctrl[p])}</dd>`;
  }).join("\n      ");
  return items ? `
    <section class="how-to-play" aria-labelledby="howto-h">
      <h2 id="howto-h">Управление</h2>
      <dl>${items}</dl>
    </section>` : "";
})()}

    ${relatedHTML}
  </main>

  <footer class="site-footer">
    <div class="container">
      <p><a href="/">← Назад в каталог</a></p>
    </div>
  </footer>

  <!-- i18n: ru — статичная SEO-версия выше; перевод применяется на клиенте по navigator.language. -->
  <script id="ngf-i18n" type="application/json">${esc(JSON.stringify(g.i18n || {}))}</script>
  <script>
    (function () {
      var el = document.getElementById("ngf-i18n");
      if (!el) return;
      var i18n;
      try { i18n = JSON.parse(el.textContent); } catch (e) { return; }
      if (!i18n) return;
      var nav = ((navigator.languages && navigator.languages[0]) || navigator.language || "").toLowerCase();
      var lang = nav.indexOf("pt") === 0 ? "pt-br" : nav.indexOf("es") === 0 ? "es" : nav.indexOf("en") === 0 ? "en" : null;
      if (!lang || !i18n[lang]) return; // ru / нет перевода → оставляем оригинал
      var tr = i18n[lang];
      document.documentElement.lang = lang === "pt-br" ? "pt-BR" : lang;
      Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (node) {
        var f = node.getAttribute("data-i18n");
        if (tr[f]) node.textContent = tr[f];
      });
      if (tr.title) document.title = tr.title + " — NetGameForge";
    })();
  </script>

  <script src="/js/track.js"></script>
  <script src="/js/ratings.js"></script>
  <script src="/js/game-ratings.js"></script>
  <script>
    (function () {
      var slug = "${esc(g.id)}";
      var frame = document.getElementById("game-frame");
      var started = false, playStart = 0, ended = false;
      function start() {
        if (started) return;
        started = true;
        playStart = Date.now();
        track("play_start", { game_id: slug });
      }
      function end() {
        if (!started || ended) return;
        ended = true;
        var seconds = Math.round((Date.now() - playStart) / 1000);
        track("play_end", { game_id: slug, play_seconds: seconds });
      }
      if (frame) frame.addEventListener("load", start, { once: true });
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") end();
      });
      window.addEventListener("pagehide", end);
    })();
  </script>
  <script>
    /* NGF-026: play-tracking (start/ping/end → /api/play) */
    (function () {
      var API_PLAY = "https://ngf-api.kovalevde.workers.dev/api/play";
      var BUILDS_ORIGIN = "https://builds.netgameforge.com";
      var PING_INTERVAL = 30000;
      var gameId = ${JSON.stringify(g.id)};

      function mkUuid() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
          return window.crypto.randomUUID();
        }
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
          var r = (Math.random() * 16) | 0;
          var v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }

      function sendPlay(payload) {
        var body = JSON.stringify(payload);
        try {
          fetch(API_PLAY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body,
            keepalive: true
          });
        } catch (e) {}
      }

      function sendPlayBeacon(payload) {
        var body = JSON.stringify(payload);
        var sent = false;
        if (navigator.sendBeacon) {
          try {
            sent = navigator.sendBeacon(API_PLAY, new Blob([body], { type: "application/json" }));
          } catch (e) {}
        }
        if (!sent) {
          sendPlay(payload);
        }
      }

      var sessionId = null;
      var seq = 0;
      var pingTimer = null;
      var started = false;       // guard: один start на просмотр страницы
      var sdkStarted = false;    // true если start пришёл через postMessage SDK

      function startSession(sid, vid) {
        started = true;
        sessionId = sid || mkUuid();
        seq = 0;
        sendPlay({ game_id: gameId, session_id: sessionId, visitor_id: vid, event_type: "start", seq: 0 });
        pingTimer = setInterval(function () {
          seq++;
          if (seq >= 120) { clearInterval(pingTimer); pingTimer = null; return; } // cap: 60 min
          sendPlay({ game_id: gameId, session_id: sessionId, visitor_id: vid, event_type: "ping", seq: seq });
        }, PING_INTERVAL);
      }

      function endSession(vid) {
        if (!sessionId) return;
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        sendPlayBeacon({ game_id: gameId, session_id: sessionId, visitor_id: vid, event_type: "end", seq: seq });
        sessionId = null;
      }

      // postMessage от SDK (приоритет — не дублируем start при авто-триггере)
      window.addEventListener("message", function (ev) {
        if (ev.origin !== BUILDS_ORIGIN) return;
        var d = ev.data;
        if (!d || typeof d.type !== "string") return;
        var vid = (d.visitorId) || (window.NGFRatings && window.NGFRatings.getVisitorId()) || mkUuid();
        if (d.type === "ngf:start") {
          sdkStarted = true;
          if (started) return; // уже запущено — игнорируем дубль
          startSession(d.sessionId || null, vid);
        } else if (d.type === "ngf:ping") {
          if (sessionId) {
            seq = typeof d.seq === "number" ? d.seq : seq + 1;
            sendPlay({ game_id: gameId, session_id: sessionId, visitor_id: vid, event_type: "ping", seq: seq });
          }
        } else if (d.type === "ngf:end") {
          endSession(vid);
          sdkStarted = false;
        }
      });

      // Авто-старт при загрузке iframe (fallback, пока нет SDK)
      var frame = document.getElementById("game-frame");
      if (frame) {
        frame.addEventListener("load", function () {
          if (started) return; // уже запущено (buildUrl-sync вызвал второй load) — игнорируем
          if (sdkStarted) return; // SDK уже взял управление
          var vid = (window.NGFRatings && window.NGFRatings.getVisitorId()) || mkUuid();
          startSession(null, vid);
        });
      }

      // end при выгрузке страницы
      function onUnload() {
        var vid = (window.NGFRatings && window.NGFRatings.getVisitorId()) || mkUuid();
        endSession(vid);
      }
      window.addEventListener("pagehide", onUnload);
      window.addEventListener("beforeunload", onUnload);
    })();
  </script>
</body>
</html>
`;
}

function buildSitemap(games) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [{ loc: SITE + "/", lastmod: today }];
  games
    .filter((g) => g.flags && g.flags.isPublished)
    .forEach((g) => urls.push({ loc: `${SITE}/games/${g.id}/`, lastmod: g.dateAdded || today }));
  const body = urls
    .map((u) => `  <url>\n    <loc>${esc(u.loc)}</loc>\n    <lastmod>${esc(u.lastmod)}</lastmod>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function buildItemList(published) {
  const items = published.map((g, i) => ({
    "@type": "ListItem",
    position: i + 1,
    url: `${SITE}/games/${g.id}/`,
    name: g.title
  }));
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Каталог игр NetGameForge",
    itemListElement: items
  };
  return `<script type="application/ld+json">\n  ${JSON.stringify(jsonLd, null, 2)}\n  </script>`;
}

function writeItemList(published) {
  const file = path.join(ROOT, "index.html");
  const html = fs.readFileSync(file, "utf8");
  const re = /(<!-- ITEMLIST:START -->)[\s\S]*?(<!-- ITEMLIST:END -->)/;
  if (!re.test(html)) throw new Error("index.html: ITEMLIST markers not found");
  const next = html.replace(re, `$1\n  ${buildItemList(published)}\n  $2`);
  fs.writeFileSync(file, next, "utf8");
  console.log("  updated index.html ItemList");
}

function main() {
  const games = readGames();
  const published = games.filter((g) => g.flags && g.flags.isPublished);
  let count = 0;

  published.forEach((g) => {
    if (!/^[a-z0-9-]+$/.test(g.id)) throw new Error(`Invalid slug: ${g.id}`);
    const dir = path.join(ROOT, "games", g.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), gamePageHTML(g, games), "utf8");
    count++;
    console.log("  generated games/" + g.id + "/index.html");
  });

  writeItemList(published);

  fs.writeFileSync(path.join(ROOT, "sitemap.xml"), buildSitemap(games), "utf8");
  console.log("  generated sitemap.xml");
  console.log(`Done: ${count} game page(s).`);
}

main();
