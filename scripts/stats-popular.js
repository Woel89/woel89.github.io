#!/usr/bin/env node
/* NetGameForge popularity job (NGF-007): Яндекс.Метрика Reporting API -> games.json.
   Раз в сутки тянет per-page метрики, считает popularityScore, проставляет
   flags.isPopular у опубликованных игр. Zero dependencies — Node built-ins only.

   ENV:
     YM_OAUTH_TOKEN  — OAuth-токен Метрики (право metrika:read). Без него скрипт мягко выходит (0).
     YM_COUNTER_ID   — id счётчика (по умолчанию 109411317).

   Анти-петля: скрипт пишет games.json ТОЛЬКО при реальном изменении полей.
   Если Метрика вернула ошибку/пусто — games.json не трогается, выход 0.

   TODO(retention): per-page Reporting API не отдаёт retention/play-конверсию.
   Для настоящего retention нужны цели (goals) play_start/play_end в Метрике
   и метрики ym:s:goal<id>... — тогда подключить и вернуть полный вес. */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const GAMES_FILE = path.join(ROOT, "games.json");
const CONFIG_FILE = path.join(__dirname, "stats.config.json");

const API_HOST = "api-metrika.yandex.net";
const API_PATH = "/stat/v1/data";

function log(msg) { console.log("[stats-popular] " + msg); }

// --- мягкий выход без падения / без правок games.json ---
function softExit(reason) {
  log(reason + " — games.json не тронут, выход 0.");
  process.exit(0);
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// slug из пути /games/<slug>/ → <slug>
function slugFromPath(p) {
  if (!p) return null;
  const m = String(p).match(/\/games\/([a-z0-9-]+)\/?/i);
  return m ? m[1].toLowerCase() : null;
}

// GET к Reporting API, JSON-ответ. Резолвит {ok, data} | {ok:false}.
function fetchMetrika(token, params) {
  return new Promise((resolve) => {
    const qs = Object.keys(params)
      .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
      .join("&");
    const opts = {
      host: API_HOST,
      path: API_PATH + "?" + qs,
      method: "GET",
      headers: {
        "Authorization": "OAuth " + token,
        "Accept": "application/json"
      }
    };
    const req = https.request(opts, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          log("Метрика HTTP " + res.statusCode + ": " + body.slice(0, 300));
          return resolve({ ok: false });
        }
        try {
          resolve({ ok: true, data: JSON.parse(body) });
        } catch (e) {
          log("Метрика: невалидный JSON.");
          resolve({ ok: false });
        }
      });
    });
    req.on("error", (e) => {
      log("Метрика сетевая ошибка: " + e.message);
      resolve({ ok: false });
    });
    req.setTimeout(30000, () => {
      log("Метрика таймаут.");
      req.destroy();
      resolve({ ok: false });
    });
    req.end();
  });
}

// нормализация min-max в [0,1]; одинаковые значения → 0
function minmax(values) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo;
  return (v) => (span > 0 ? (v - lo) / span : 0);
}

function log10p(x) { return Math.log10(1 + Math.max(0, x)); }

function daysSince(dateAdded) {
  if (!dateAdded) return Infinity;
  const t = new Date(dateAdded).getTime();
  if (isNaN(t)) return Infinity;
  return (Date.now() - t) / (24 * 60 * 60 * 1000);
}

async function main() {
  const token = process.env.YM_OAUTH_TOKEN;
  if (!token) softExit("Нет YM_OAUTH_TOKEN");
  const counterId = process.env.YM_COUNTER_ID || "109411317";

  const cfg = readJSON(CONFIG_FILE);
  const wrapper = readJSON(GAMES_FILE);
  if (!wrapper || !Array.isArray(wrapper.games)) softExit("games.json без games[]");

  const published = wrapper.games.filter((g) => g.flags && g.flags.isPublished);
  if (!published.length) softExit("Нет опубликованных игр");

  // --- запрос к Метрике ---
  const params = {
    ids: counterId,
    dimensions: "ym:pv:URLPathFull",
    metrics: "ym:s:users,ym:pv:pageviews,ym:s:avgVisitDurationSeconds",
    filters: "ym:pv:URLPathFull=@'/games/'",
    date1: cfg.window.days + "daysAgo",
    date2: "today",
    limit: 10000,
    accuracy: "full"
  };
  const res = await fetchMetrika(token, params);
  if (!res.ok) softExit("Метрика недоступна");
  const rows = res.data && Array.isArray(res.data.data) ? res.data.data : [];
  if (!rows.length) softExit("Метрика вернула пусто");

  // --- агрегируем по slug ---
  const bySlug = {}; // slug -> {users, pageviews, avgDur}
  for (const row of rows) {
    const dim = row.dimensions && row.dimensions[0];
    const p = dim && (dim.name || dim["ym:pv:URLPathFull"] || dim.id);
    const slug = slugFromPath(p);
    if (!slug) continue;
    const m = row.metrics || [];
    const acc = bySlug[slug] || { users: 0, pageviews: 0, durSum: 0, durW: 0 };
    const users = +m[0] || 0;
    const pv = +m[1] || 0;
    const dur = +m[2] || 0;
    acc.users += users;
    acc.pageviews += pv;
    // средняя длительность взвешиваем по users, чтобы суммировать корректно
    acc.durSum += dur * users;
    acc.durW += users;
    bySlug[slug] = acc;
  }

  // --- собираем кандидатов (опубликованные, прошли порог уников) ---
  const candidates = [];
  for (const g of published) {
    const s = bySlug[g.id];
    if (!s) continue;
    if (s.users < cfg.minUniques) continue; // антинакрутка: минимум данных
    const avgDur = s.durW > 0 ? s.durSum / s.durW : 0;
    candidates.push({
      g,
      uniques: s.users,
      sessionTime: avgDur,
      pageviews: s.pageviews,
      age: daysSince(g.dateAdded)
    });
  }

  // retention/plays из page-метрик недоступны → деградация:
  // перераспределяем их веса на доступные (uniques/sessionTime/freshness).
  const W = cfg.weights;
  const availKeys = ["uniques", "sessionTime", "freshness"];
  const availSum = availKeys.reduce((a, k) => a + (W[k] || 0), 0);
  const w = {};
  for (const k of availKeys) w[k] = (W[k] || 0) / availSum; // нормируем к сумме 1

  // нормализация по каталогу (log10 для объёмных)
  const normU = minmax(candidates.map((c) => log10p(c.uniques)));
  const normS = minmax(candidates.map((c) => c.sessionTime));
  const maxAge = cfg.window.days * 2; // свежесть линейно затухает за ~окно
  for (const c of candidates) {
    const u = normU(log10p(c.uniques));
    const st = normS(c.sessionTime);
    // freshness: новее = выше; >maxAge → 0
    const fr = c.age >= maxAge ? 0 : 1 - c.age / maxAge;
    let score = w.uniques * u + w.sessionTime * st + w.freshness * fr;
    // грейс для игр младше graceDays: меньше данных — мягкий штраф к уверенности
    if (c.age < cfg.graceDays) score *= 0.5 + 0.5 * (c.age / cfg.graceDays);
    c.score = Math.round(score * 1000) / 1000;
  }

  // --- бейдж: топ-перцентиль с границами + гистерезис ---
  const sorted = candidates.slice().sort((a, b) => b.score - a.score);
  const n = sorted.length;
  const B = cfg.badge;
  // целевое число победителей: перцентиль, зажатый в [min,max] и в n
  let target = Math.round(n * B.percentileTop);
  target = Math.max(B.minWinners, Math.min(B.maxWinners, target));
  target = Math.min(target, n);

  // ранг-перцентиль (0 = топ). гистерезис: уже популярные держатся до exitPercentile.
  const winners = new Set();
  for (let i = 0; i < n; i++) {
    const pct = n > 1 ? i / (n - 1) : 0;
    const c = sorted[i];
    const wasPopular = !!(c.g.flags && c.g.flags.isPopular);
    if (i < target) {
      winners.add(c.g.id); // вошёл по целевому числу
    } else if (wasPopular && pct < B.hysteresisExitPercentile) {
      winners.add(c.g.id); // удерживаем по гистерезису выхода
    }
  }

  // --- применяем к games.json (только опубликованным) ---
  const stamp = new Date().toISOString();
  const scoreById = {};
  for (const c of candidates) scoreById[c.g.id] = c.score;

  let changed = false;
  for (const g of wrapper.games) {
    const isPub = !!(g.flags && g.flags.isPublished);
    const newPopular = isPub && winners.has(g.id);
    const newScore = isPub && (g.id in scoreById) ? scoreById[g.id] : 0;

    g.flags = g.flags || {};
    if (g.flags.isPopular !== newPopular) { g.flags.isPopular = newPopular; changed = true; }
    if (g.popularityScore !== newScore) { g.popularityScore = newScore; changed = true; }
    if (g.statsUpdatedAt !== stamp) { /* timestamp сам по себе не делает changed */ }
    g.statsUpdatedAt = stamp;
  }

  if (!changed) softExit("Метрики совпали — изменений нет");

  fs.writeFileSync(GAMES_FILE, JSON.stringify(wrapper, null, 2) + "\n", "utf8");
  log("games.json обновлён: " + winners.size + " популярных из " + candidates.length + " кандидатов.");
  process.exit(0);
}

main().catch((e) => {
  // непредвиденная ошибка — не валим pipeline, games.json не трогаем
  log("Непредвиденная ошибка: " + (e && e.message));
  process.exit(0);
});
