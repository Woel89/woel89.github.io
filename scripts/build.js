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
  return data.games;
}

// Cover for a game page resolves one level up from games/<slug>/.
function pageCover(g) {
  if (!g.coverUrl) return "";
  return /^https?:\/\//.test(g.coverUrl) ? g.coverUrl : SITE + "/" + g.coverUrl.replace(/^\/+/, "");
}

function leadSentence(g) {
  const control = g.orientation === "portrait" ? "управление одним касанием" : "управление с клавиатуры или касанием";
  return `${esc(g.title)} — это ${esc(g.category)}-игра, ${control}. Играйте прямо в браузере.`;
}

function relatedGames(g, all) {
  const tags = new Set(g.tags || []);
  return all
    .filter((x) => x.id !== g.id && x.flags && x.flags.isPublished)
    .map((x) => ({ x, score: (x.tags || []).filter((t) => tags.has(t)).length + (x.category === g.category ? 1 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((o) => o.x);
}

function gamePageHTML(g, all) {
  const url = `${SITE}/games/${g.id}/`;
  const cover = pageCover(g);
  const desc = esc(g.description || "");
  const orientation = g.orientation === "portrait" ? "portrait" : "landscape";
  const tags = (g.tags || []).map((t) => `<span>${esc(t)}</span>`).join("");

  const related = relatedGames(g, all);
  const relatedHTML = related.length
    ? `<section class="shelf" aria-labelledby="related-h">
      <h2 id="related-h">Похожие игры</h2>
      <div class="game-grid">
        ${related.map((r) => `
        <article class="game-card">
          <a href="/games/${esc(r.id)}/">
            <span class="cover">${r.coverUrl ? `<img src="/${esc(r.coverUrl.replace(/^\/+/, ""))}" alt="" width="400" height="400" loading="lazy" decoding="async" onerror="this.remove()">` : ""}</span>
            <span class="body"><h3>${esc(r.title)}</h3></span>
          </a>
        </article>`).join("")}
      </div>
    </section>`
    : "";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: g.title,
    description: g.description,
    url: url,
    genre: g.category,
    author: { "@type": "Organization", name: g.author || "NetGameForge" },
    publisher: { "@type": "Organization", name: "NetGameForge" },
    image: cover || undefined,
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
  ${cover ? `<meta property="og:image" content="${esc(cover)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">` : ""}

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(g.title)} — играть бесплатно онлайн">
  <meta name="twitter:description" content="${desc}">
  ${cover ? `<meta name="twitter:image" content="${esc(cover)}">` : ""}

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
      <a href="/?tag=${encodeURIComponent(g.category)}">${esc(g.category)}</a> ›
      <span aria-current="page">${esc(g.title)}</span>
    </nav>

    <div class="game-hero">
      <h1>${esc(g.title)}</h1>
      <p class="game-lead">${leadSentence(g)}</p>
    </div>

    <div class="game-frame ${orientation}">
      <iframe id="game-frame" src="${esc(g.buildUrl)}" title="${esc(g.title)}"
        sandbox="allow-scripts allow-pointer-lock"
        allow="autoplay; fullscreen; gamepad" referrerpolicy="no-referrer"
        allowfullscreen loading="lazy"></iframe>
    </div>

    <section class="game-meta" aria-label="Об игре">
      <p>${desc}</p>
      <p>Жанр: ${esc(g.category)} · Автор: ${esc(g.author || "NetGameForge")}</p>
      <div class="tags">${tags}</div>
    </section>

    ${relatedHTML}
  </main>

  <footer class="site-footer">
    <div class="container">
      <p><a href="/">← Назад в каталог</a> · <a href="/my/">Разработчикам</a></p>
    </div>
  </footer>

  <script src="/js/track.js"></script>
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
