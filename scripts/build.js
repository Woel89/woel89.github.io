#!/usr/bin/env node
/* NetGameForge build: games.json -> games/<slug>/index.html + sitemap.xml
   + zhanr/<code>/index.html (NGF-065) + IndexNow key file (NGF-063).
   Zero dependencies — Node built-ins only. */
"use strict";

const fs = require("fs");
const path = require("path");

const API_BASE = "https://ngf-api.kovalevde.workers.dev/api/game";
const RATING_TIMEOUT_MS = 5000;

// NGF-063: IndexNow — статический ключ верификации.
const INDEXNOW_KEY = "7f3a9c2e-b841-4d6f-8e05-1a2b3c4d5e6f";

// NGF-065: маппинг кода категории → RU-лейбл (зеркало CATEGORY_LABELS из js/catalog.js).
const CATEGORY_LABELS = {
  arcade:     "Аркады",
  puzzle:     "Головоломки",
  action:     "Экшн",
  adventure:  "Приключения",
  clicker:    "Кликеры",
  simulation: "Симуляторы",
  racing:     "Гонки",
  shooter:    "Шутеры"
};

// NGF-065: SEO-контент для жанровых лендингов (из docs/seo-content-v1.md, раздел A).
const GENRE_SEO = {
  arcade: {
    title: "Аркады играть онлайн бесплатно — NetGameForge",
    description: "Аркадные игры прямо в браузере: Tornado.io, Snake Warz, Truck Slam и ещё десятки. Без установки, без регистрации — запустил и играешь.",
    intro: "Аркады — это когда правила объясняются за пять секунд, а оторваться невозможно. Управляй торнадо и сноси целые кварталы в Tornado.io, сражайся за место на арене в Snake Warz, таранись с соперниками в Truck Slam. Каждая игра запускается прямо в окне браузера — ни скачивания, ни регистрации. Аркадные игры играть онлайн бесплатно в браузере: выбирай из подборки и стартуй сразу."
  },
  puzzle: {
    title: "Головоломки онлайн бесплатно в браузере — NetGameForge",
    description: "Головоломки без скачивания: Merge Melons, WaterJam, Screw Master. Сортировка, слияние, логика — выбирай жанр и играй прямо сейчас.",
    intro: "Головоломки — жанр, который одновременно расслабляет и держит ум в тонусе. Соединяй фрукты в Merge Melons, переливай цветную воду в WaterJam, откручивай болты в правильном порядке в Screw Master. Нет таймера давления — темп задаёшь ты сам. Головоломки играть онлайн бесплатно в браузере: управление мышью или тапом, запуск в один клик."
  },
  action: {
    title: "Экшн игры онлайн бесплатно в браузере — NetGameForge",
    description: "Экшн в браузере без установки: паркур в Parkour Block 3D, выживание в Zombie Swarm, физическая песочница Melon Sandbox. Быстрый старт, горячие матчи.",
    intro: "Экшн — для тех, кому нужен быстрый ритм и постоянное движение. Прыгай по блокам в Parkour Block 3D, отбивайся от волн нежити в Zombie Swarm, или просто крушишь всё вокруг в Melon Sandbox Online. Игры запускаются мгновенно — без аккаунтов и загрузок. Экшн игры играть онлайн бесплатно в браузере: на ПК и мобильном, прямо сейчас."
  },
  adventure: {
    title: "Приключения играть онлайн в браузере — NetGameForge",
    description: "Приключенческие игры без скачивания: пиратский бой в Broadside Caribbean, блочный мир Terra Craft World, кооп-платформер Duo Water and Fire.",
    intro: "Приключения — это исследование, неожиданные ситуации и история, в которой ты сам принимаешь решения. Командуй пиратским кораблём в Broadside Caribbean, строй и выживай в открытом блочном мире Terra Craft World, или пройди кооп-уровни вместе с другом в Duo Water and Fire. Приключенческие игры играть онлайн бесплатно в браузере: на ПК и мобильном, без регистрации."
  },
  clicker: {
    title: "Кликеры онлайн бесплатно в браузере — NetGameForge",
    description: "Кликеры и idle-игры: шахта в Resource Empire, гайки в Screw Master, слияние рыб в Ocean Fish Merge. Прогресс растёт сам — заходи и смотри.",
    intro: "Кликеры — жанр, в котором прогресс виден сразу и непрерывно. Строй шахтёрскую империю с нуля в Resource Empire, откручивай болты быстрее с каждым уровнем в Screw Master, или соединяй рыбок в Ocean Fish Merge. Можно активно кликать, можно оставить на пару минут — игра работает в фоне. Кликеры играть онлайн бесплатно в браузере: без установки, на ПК и телефоне."
  },
  simulation: {
    title: "Симуляторы играть онлайн бесплатно — NetGameForge",
    description: "Симуляторы в браузере: шахтёрский менеджмент Resource Empire и физическая песочница Melon Sandbox Online. Строй, управляй, экспериментируй без скачивания.",
    intro: "Симуляторы дают свободу: сам решаешь, что строить, как развиваться и что ломать. В Resource Empire управляешь растущей горнодобывающей империей — нанимаешь работников, прокачиваешь шахты, наращиваешь добычу. В Melon Sandbox Online никакой цели нет вообще — только физика, объекты и твои эксперименты. Симуляторы играть онлайн бесплатно в браузере: запуск без регистрации, на ПК и мобильном."
  },
  racing: {
    title: "Гонки онлайн бесплатно в браузере — NetGameForge",
    description: "Гонки без установки: аркадный Max Speed, постапокалиптические Dead Paradise, трюки на мото в Crazy Moto. Стартуй прямо в браузере.",
    intro: "Гонки в браузере — от чистого адреналина до трюков и боевых схваток за рулём. Прокачивай спорткар и обгоняй соперников в Max Speed, уничтожай врагов на постапокалиптических трассах в Dead Paradise, или выполняй сложные прыжки на байке в Crazy Moto. Гонки играть онлайн бесплатно в браузере: управление с клавиатуры или тач-кнопками, без регистрации."
  },
  shooter: {
    title: "Шутеры онлайн бесплатно в браузере — NetGameForge",
    description: "Браузерные шутеры без скачивания: 3D зомби-экшн Zombie Graveyard и horde survival Zombie Swarm. WASD + мышь — и сразу в бой.",
    intro: "Шутеры — для тех, кому нравится держать оборону под давлением. В Zombie Graveyard ты один против толп нежити в 3D: кампания с нарастающей сложностью или бесконечное выживание на рекорд. В Zombie Swarm — вид сверху, авто-стрельба и лавина врагов, которая с каждой волной становится плотнее. Шутеры играть онлайн бесплатно в браузере: на ПК, без установки и регистрации."
  }
};

// Fetch rating for a single slug. Returns null on any error/timeout.
async function fetchRating(slug) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), RATING_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/${slug}`, { signal: ac.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Returns Map slug -> { totalVotes, percentPositive } for games with enoughVotes.
async function fetchAllRatings(slugs) {
  const results = await Promise.allSettled(slugs.map((s) => fetchRating(s)));
  const map = new Map();
  slugs.forEach((slug, i) => {
    const r = results[i];
    if (r.status === "fulfilled" && r.value && r.value.enoughVotes) {
      map.set(slug, { totalVotes: r.value.totalVotes, percentPositive: r.value.percentPositive });
    }
  });
  return map;
}

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
    .map((x) => {
      const tagMatches = (x.tags || []).filter((t) => tags.has(t)).length;
      const categoryMatches = gameCategories(x).filter((c) => cats.has(c)).length;
      const ratingBonus = (x.flags && x.flags.isPopular) ? 1 : 0;
      const score = tagMatches * 2 + categoryMatches * 3 + ratingBonus;
      return { x, score };
    })
    .sort((a, b) => b.score - a.score || new Date(b.x.dateAdded || 0) - new Date(a.x.dateAdded || 0))
    .slice(0, 4)
    .map((o) => o.x);
}

function gamePageHTML(g, all, ratingsMap) {
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
  const ratingData = ratingsMap && ratingsMap.get(g.id);
  if (ratingData && ratingData.totalVotes >= 10) {
    jsonLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Math.round(ratingData.percentPositive / 20 * 10) / 10,
      ratingCount: ratingData.totalVotes,
      bestRating: 5,
      worstRating: 1
    };
  }

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

  <link rel="icon" href="/favicon.ico?v=3" sizes="any">
  <link rel="icon" type="image/png" sizes="48x48" href="/assets/logo/favicon-48.png?v=3">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/logo/favicon-32.png?v=3">
  <link rel="apple-touch-icon" href="/assets/logo/apple-touch-icon.png?v=3">

  <link rel="stylesheet" href="/css/styles.css?v=20260531d">

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
    ym(109411317, "init", {clickmap:true, trackLinks:true, accurateTrackBounce:true, webvisor:true});
  </script>
  <noscript><div><img src="https://mc.yandex.ru/watch/109411317" style="position:absolute; left:-9999px;" alt=""></div></noscript>

  <script type="application/ld+json">
  ${JSON.stringify(jsonLd, null, 2)}
  </script>

  <script type="application/ld+json">
  ${(function() {
    const pl = Array.isArray(g.platforms) ? g.platforms : [];
    const ctrl = g.controls || {};
    const hasMobile = pl.indexOf("mobile") !== -1 && ctrl.mobile;
    const platformText = (pl.indexOf("pc") !== -1 && pl.indexOf("mobile") !== -1)
      ? "ПК и мобильном (браузер)"
      : (pl.indexOf("mobile") !== -1 ? "мобильном (браузер)" : "ПК (браузер)");
    const q4answer = `На компьютере: ${ctrl.pc || "мышь или клавиатура"}.${hasMobile ? " На телефоне: " + ctrl.mobile + "." : ""}`;
    const faqLd = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: `Сколько стоит играть в ${g.title}?`,
          acceptedAnswer: { "@type": "Answer", text: "Игра полностью бесплатная. Никаких платежей, подписок и скрытых покупок — просто нажми «Играть»." }
        },
        {
          "@type": "Question",
          name: `Нужно ли скачивать или устанавливать ${g.title}?`,
          acceptedAnswer: { "@type": "Answer", text: `Нет. ${g.title} запускается прямо в браузере — заходишь на страницу игры и начинаешь без установки.` }
        },
        {
          "@type": "Question",
          name: `На каком устройстве можно играть в ${g.title}?`,
          acceptedAnswer: { "@type": "Answer", text: `Игра работает на ${platformText}. Открой страницу в браузере на нужном устройстве — дополнительных настроек не требуется.` }
        },
        {
          "@type": "Question",
          name: `Как управлять в ${g.title}?`,
          acceptedAnswer: { "@type": "Answer", text: q4answer }
        },
        {
          "@type": "Question",
          name: "Безопасно ли играть в браузере на NetGameForge?",
          acceptedAnswer: { "@type": "Answer", text: "Да. Все игры на NetGameForge запускаются в изолированном iframe — никакого доступа к файлам устройства, никаких дополнительных разрешений браузеру давать не нужно." }
        }
      ]
    };
    return JSON.stringify(faqLd, null, 2);
  })()}
  </script>
</head>
<body>
  <header class="site-header">
    <div class="container">
      <a class="brand" href="/">
        <img src="/assets/logo/logo-header.png" alt="NetGameForge" width="895" height="342" decoding="async">
        <span>NetGameForge</span>
      </a>
    </div>
  </header>

  <main class="container">
    <nav class="breadcrumbs" aria-label="Хлебные крошки">
      <a href="/">Каталог</a> ›
      ${CATEGORY_LABELS[primary]
        ? `<a href="/zhanr/${encodeURIComponent(primary)}/">${esc(CATEGORY_LABELS[primary])}</a>`
        : `<a href="/?category=${encodeURIComponent(primary)}">${esc(primary)}</a>`} ›
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
      <button class="share-btn" type="button" aria-label="Поделиться игрой ${esc(g.title)}" onclick="(function(){try{if(typeof track==='function')track('share_click',{slug:${JSON.stringify(g.id)}});}catch(_e){}var t=${JSON.stringify(esc(g.title))};var u=${JSON.stringify(url)}+'?utm_source=share&utm_medium=social';var tx='Играю в '+t+' на NetGameForge — играй бесплатно';if(navigator.share){navigator.share({title:t,text:tx,url:u}).catch(function(){});}else if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){var b=document.querySelector('.share-btn');if(b){var orig=b.textContent;b.textContent='Ссылка скопирована';setTimeout(function(){b.textContent=orig;},2000);}}).catch(function(){});}})()">Поделиться</button>
    </div>

    <div class="game-frame ${orientation}" id="game-player" data-state="idle">

      <!-- Слой превью — видим только в state=idle -->
      <div class="game-cover" id="game-cover" aria-hidden="false">
        ${cover ? `<img src="${esc(cover)}" alt="${esc(g.title)}" class="game-cover__img" loading="eager" decoding="async">` : `<div class="game-cover__placeholder"></div>`}
        <button class="game-play-btn" id="game-play-btn" type="button" aria-label="Играть в ${esc(g.title)}">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z"/>
          </svg>
          Играть
        </button>
      </div>

      <!-- Прелоадер — видим только в state=loading -->
      <div class="game-loader" id="game-loader" aria-live="polite" aria-label="Игра загружается..." hidden>
        <div class="game-loader__spinner"></div>
        <p>Загружается...</p>
      </div>

${(function() {
  const isExternal = g.source === "external";
  if (isExternal) {
    return `      <iframe id="game-frame" src="about:blank" title="${esc(g.title)}"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock"
          allow="autoplay; fullscreen; gamepad" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
  }
  return `      <iframe id="game-frame" src="about:blank" title="${esc(g.title)}"
          sandbox="allow-scripts allow-pointer-lock allow-same-origin"
          allow="autoplay; fullscreen; gamepad" referrerpolicy="no-referrer"></iframe>`;
})()}

      <!-- Кнопка фуллскрин — видима только в state=playing -->
      <button class="game-fullscreen-btn" id="game-fs-btn" type="button" aria-label="Полный экран" hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
        </svg>
      </button>

${orientation === "landscape" ? `      <!-- Hint переверни телефон — только для landscape-игр -->
      <div class="game-rotate-hint" id="game-rotate-hint" hidden role="status">
        &#8635; Поверни телефон горизонтально
      </div>` : ""}
    </div>

  <script>
    (function () {
      var player  = document.getElementById("game-player");
      var cover   = document.getElementById("game-cover");
      var loader  = document.getElementById("game-loader");
      var frame   = document.getElementById("game-frame");
      var fsBtn   = document.getElementById("game-fs-btn");
      var playBtn = document.getElementById("game-play-btn");
      var hint    = document.getElementById("game-rotate-hint");
      var REAL_SRC = ${JSON.stringify(g.source === "external" ? (g.embedUrl || "") : (g.buildUrl || ""))};
      var IS_EXTERNAL = ${g.source === "external" ? "true" : "false"};
      var loadTimeout = null;

      function setState(s) {
        player.dataset.state = s;
        cover.hidden  = s !== "idle";
        loader.hidden = s !== "loading";
        fsBtn.hidden  = s !== "playing";
        cover.setAttribute("aria-hidden", s !== "idle" ? "true" : "false");
      }

      playBtn.addEventListener("click", function () {
        setState("loading");
        try { if (typeof track === "function") track("play_click", { slug: ${JSON.stringify(g.id)}, device: /Mobi|Android/i.test(navigator.userAgent) ? "mobile" : "desktop" }); } catch (_e) {}
        frame.src = REAL_SRC;
        // Записать игру в историю «Продолжить играть»
        try {
          var _recentRaw = localStorage.getItem("ngf_recent_v1");
          var _recent = [];
          try { _recent = JSON.parse(_recentRaw || "[]"); } catch (e2) { _recent = []; }
          if (!Array.isArray(_recent)) _recent = [];
          _recent = _recent.filter(function(r) { return r && r.id !== ${JSON.stringify(g.id)}; });
          _recent.unshift({ id: ${JSON.stringify(g.id)}, title: ${JSON.stringify(g.title)}, icon: ${JSON.stringify(g.icon || g.coverUrl || "")}, ts: Math.floor(Date.now() / 1000) });
          if (_recent.length > 8) _recent = _recent.slice(0, 8);
          localStorage.setItem("ngf_recent_v1", JSON.stringify(_recent));
        } catch (e) {}
        if (IS_EXTERNAL) {
          loadTimeout = setTimeout(function () {
            var p = loader.querySelector("p");
            if (p) p.textContent = "Не удалось загрузить игру. Попробуй обновить страницу.";
            var sp = loader.querySelector(".game-loader__spinner");
            if (sp) sp.style.display = "none";
          }, 15000);
        }
      });

      frame.addEventListener("load", function () {
        if (frame.src === "about:blank" || frame.src === "") return;
        if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null; }
        setState("playing");
${orientation === "landscape" ? `        if (hint) {
          checkOrientation();
          window.addEventListener("resize", checkOrientation);
        }` : ""}
      });

${orientation === "landscape" ? `      function checkOrientation() {
        if (!hint) return;
        if (window.innerWidth < window.innerHeight && player.dataset.state === "playing") {
          hint.hidden = false;
          setTimeout(function () { hint.hidden = true; }, 3000);
        } else {
          hint.hidden = true;
        }
      }` : ""}

      fsBtn.addEventListener("click", function () {
        var el = player;
        var req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
        if (req) req.call(el);
      });
    })();
  </script>
${g.source !== "external" ? `  <script>
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
            if (frame.src === "about:blank" || frame.src === "") return; // idle — не трогаем до клика Играть
            if (entry.buildUrl !== frame.src) { frame.src = entry.buildUrl; }
          })
          .catch(function () { /* молчок — оставляем захардкоженный src */ });
      });
    })();
  </script>` : ""}

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

    <section class="game-faq" aria-labelledby="faq-h">
      <h2 id="faq-h">Часто спрашивают</h2>
      <dl class="faq-list">
        <dt>Сколько стоит играть в ${esc(g.title)}?</dt>
        <dd>Игра полностью бесплатная. Никаких платежей, подписок и скрытых покупок — просто нажми «Играть».</dd>
        <dt>Нужно ли скачивать или устанавливать ${esc(g.title)}?</dt>
        <dd>Нет. ${esc(g.title)} запускается прямо в браузере — заходишь на страницу игры и начинаешь без установки.</dd>
        <dt>На каком устройстве можно играть в ${esc(g.title)}?</dt>
        <dd>Игра работает на ${(function() {
          const pl = Array.isArray(g.platforms) ? g.platforms : [];
          return (pl.indexOf("pc") !== -1 && pl.indexOf("mobile") !== -1)
            ? "ПК и мобильном (браузер)"
            : (pl.indexOf("mobile") !== -1 ? "мобильном (браузер)" : "ПК (браузер)");
        })()} . Открой страницу в браузере на нужном устройстве — дополнительных настроек не требуется.</dd>
        <dt>Как управлять в ${esc(g.title)}?</dt>
        <dd>${(function() {
          const pl = Array.isArray(g.platforms) ? g.platforms : [];
          const ctrl = g.controls || {};
          const hasMobile = pl.indexOf("mobile") !== -1 && ctrl.mobile;
          return `На компьютере: ${esc(ctrl.pc || "мышь или клавиатура")}.${hasMobile ? " На телефоне: " + esc(ctrl.mobile) + "." : ""}`;
        })()}</dd>
        <dt>Безопасно ли играть в браузере на NetGameForge?</dt>
        <dd>Да. Все игры на NetGameForge запускаются в изолированном iframe — никакого доступа к файлам устройства, никаких дополнительных разрешений браузеру давать не нужно.</dd>
      </dl>
    </section>

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

  <script src="/js/game-fallback.js?v=20260604"></script>
  <script src="/js/track.js"></script>
  <script src="/js/ratings.js"></script>
  <script src="/js/game-ratings.js?v=20260531b"></script>
  <script>
    (function () {
      var slug = "${esc(g.id)}";
      var frame = document.getElementById("game-frame");
      var started = false, playStart = 0, ended = false;
      var engagedFired = false, engagedTimer = null;
      function start() {
        if (started) return;
        started = true;
        playStart = Date.now();
        track("play_start", { game_id: slug });
        if (!engagedFired) {
          engagedTimer = setTimeout(function () {
            if (!document.hidden) { engagedFired = true; try { if (typeof track === "function") track("engaged_30s", { slug: ${JSON.stringify(g.id)} }); } catch (_e) {} }
          }, 30000);
        }
      }
      function end() {
        if (!started || ended) return;
        ended = true;
        var seconds = Math.round((Date.now() - playStart) / 1000);
        track("play_end", { game_id: slug, play_seconds: seconds });
      }
      if (frame) frame.addEventListener("load", function () {
        if (frame.src === "about:blank" || frame.src === "") return;
        start();
      }, { once: true });
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
      var IS_EXTERNAL = ${g.source === "external" ? "true" : "false"};
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
      // Для external-игр postMessage не слушаем: другой origin, наш фильтр отклонит чужие сообщения,
      // но не создаём лишний слушатель во избежание шума от провайдерских скриптов.
      if (!IS_EXTERNAL) {
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
      }

      // Авто-старт при загрузке iframe (fallback, пока нет SDK)
      var frame = document.getElementById("game-frame");
      if (frame) {
        frame.addEventListener("load", function () {
          if (frame.src === "about:blank" || frame.src === "") return; // idle — не считаем
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

function buildSitemap(games, genreCodes) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [{ loc: SITE + "/", lastmod: today }];
  // Жанровые страницы (NGF-065).
  genreCodes.forEach((code) => urls.push({ loc: `${SITE}/zhanr/${code}/`, lastmod: today }));
  games
    .filter((g) => g.flags && g.flags.isPublished)
    .forEach((g) => urls.push({ loc: `${SITE}/games/${g.id}/`, lastmod: g.dateAdded || today }));
  const body = urls
    .map((u) => `  <url>\n    <loc>${esc(u.loc)}</loc>\n    <lastmod>${esc(u.lastmod)}</lastmod>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// NGF-065: строит HTML страницы жанра.
function genrePageHTML(code, label, seo, gamesInGenre) {
  const url = `${SITE}/zhanr/${code}/`;
  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${label} — NetGameForge`,
    url: url,
    itemListElement: gamesInGenre.map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/games/${g.id}/`,
      name: g.title
    }))
  };

  const cardsHTML = gamesInGenre.map((g) => {
    const rawSrc = g.icon || g.coverUrl;
    const imgSrc = rawSrc
      ? (/^https?:\/\//i.test(rawSrc)
          ? esc(rawSrc)
          : "/" + esc(rawSrc.replace(/^\/+/, "")) + (g.updatedAt ? "?v=" + encodeURIComponent(g.updatedAt) : ""))
      : "";
    return `
        <article class="game-card">
          <a href="/games/${esc(g.id)}/">
            <span class="cover">${imgSrc ? `<img src="${imgSrc}" alt="" width="400" height="400" loading="lazy" decoding="async" onerror="this.remove()">` : ""}</span>
            <span class="body"><h3>${esc(g.title)}</h3></span>
          </a>
        </article>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(seo.title)}</title>
  <meta name="description" content="${esc(seo.description)}">
  <link rel="canonical" href="${url}">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="NetGameForge">
  <meta property="og:title" content="${esc(seo.title)}">
  <meta property="og:description" content="${esc(seo.description)}">
  <meta property="og:url" content="${url}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(seo.title)}">
  <meta name="twitter:description" content="${esc(seo.description)}">

  <!-- Verification placeholders (NGF-063): вставь meta-теги верификации Яндекс.Вебмастера и GSC здесь. -->
  <!-- <meta name="yandex-verification" content="XXXXXXXXXXXXXXXX"> -->
  <!-- <meta name="google-site-verification" content="XXXXXXXXXXXXXXXX"> -->

  <link rel="icon" href="/favicon.ico?v=3" sizes="any">
  <link rel="icon" type="image/png" sizes="48x48" href="/assets/logo/favicon-48.png?v=3">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/logo/favicon-32.png?v=3">
  <link rel="apple-touch-icon" href="/assets/logo/apple-touch-icon.png?v=3">

  <link rel="stylesheet" href="/css/styles.css?v=20260531d">

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
    ym(109411317, "init", {clickmap:true, trackLinks:true, accurateTrackBounce:true, webvisor:true});
  </script>
  <noscript><div><img src="https://mc.yandex.ru/watch/109411317" style="position:absolute; left:-9999px;" alt=""></div></noscript>

  <script type="application/ld+json">
  ${JSON.stringify(itemListLd, null, 2)}
  </script>
</head>
<body>
  <header class="site-header">
    <div class="container">
      <a class="brand" href="/">
        <img src="/assets/logo/logo-header.png" alt="NetGameForge" width="895" height="342" decoding="async">
        <span>NetGameForge</span>
      </a>
    </div>
  </header>

  <main class="container">
    <nav class="breadcrumbs" aria-label="Хлебные крошки">
      <a href="/">Каталог</a> ›
      <span aria-current="page">${esc(label)}</span>
    </nav>

    <h1>${esc(label)}</h1>
    <p class="genre-intro">${esc(seo.intro)}</p>

    <div class="game-grid">
      ${cardsHTML}
    </div>
  </main>

  <footer class="site-footer">
    <div class="container">
      <p><a href="/">← Назад в каталог</a></p>
    </div>
  </footer>

  <script src="/js/track.js"></script>
</body>
</html>
`;
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

async function main() {
  const games = readGames();
  const published = games.filter((g) => g.flags && g.flags.isPublished);
  let count = 0;

  console.log("  fetching ratings from worker...");
  const slugs = published.map((g) => g.id);
  const ratingsMap = await fetchAllRatings(slugs);
  console.log(`  ratings fetched: ${ratingsMap.size} game(s) with enough votes`);

  published.forEach((g) => {
    if (!/^[a-z0-9-]+$/.test(g.id)) throw new Error(`Invalid slug: ${g.id}`);
    const dir = path.join(ROOT, "games", g.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), gamePageHTML(g, games, ratingsMap), "utf8");
    count++;
    console.log("  generated games/" + g.id + "/index.html");
  });

  writeItemList(published);

  // NGF-065: Жанровые лендинги.
  // Определяем, у каких категорий есть опубликованные игры.
  const genreGamesMap = new Map(); // code -> Game[]
  published.forEach((g) => {
    gameCategories(g).forEach((code) => {
      if (!CATEGORY_LABELS[code]) return; // пропускаем категории без SEO-данных
      if (!genreGamesMap.has(code)) genreGamesMap.set(code, []);
      genreGamesMap.get(code).push(g);
    });
  });

  const genreCodes = [];
  genreGamesMap.forEach((gamesInGenre, code) => {
    const label = CATEGORY_LABELS[code];
    const seo = GENRE_SEO[code];
    if (!label || !seo) return;
    const dir = path.join(ROOT, "zhanr", code);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), genrePageHTML(code, label, seo, gamesInGenre), "utf8");
    genreCodes.push(code);
    console.log(`  generated zhanr/${code}/index.html (${gamesInGenre.length} игр)`);
  });

  // NGF-063: IndexNow — файл верификации ключа в корне.
  fs.writeFileSync(path.join(ROOT, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY, "utf8");
  console.log(`  generated ${INDEXNOW_KEY}.txt (IndexNow key)`);

  fs.writeFileSync(path.join(ROOT, "sitemap.xml"), buildSitemap(games, genreCodes), "utf8");
  console.log("  generated sitemap.xml");
  console.log(`Done: ${count} game page(s), ${genreCodes.length} genre page(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
