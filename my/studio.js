/**
 * Per-game Studio экран /my/?game=<slug> (NGF-027).
 * Вкладки: Обзор (метрики + 7d-график) + Отзывы (held_for_review / published).
 * Admin PIN-барьер для деструктивных действий (delete, hide_user) — клиентский,
 * NGF-029 добавит серверную проверку.
 * @module studio
 */

import { getToken, isAuthed } from './lib/auth.js';

const WORKER_API = 'https://ngf-api.kovalevde.workers.dev';
const PIN_HASH_KEY = 'ngf_admin_pin_hash';

const $ = (id) => document.getElementById(id);

/* ---------- Worker fetch (Bearer = основной PAT) ---------- */

async function workerFetch(path, opts = {}) {
  const token = getToken();
  if (!token) throw new Error('Не авторизован.');
  const res = await fetch(WORKER_API + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    throw new Error((data && data.error) || `http_${res.status}`);
  }
  return data;
}

/* ---------- SHA-256 (Web Crypto) ---------- */

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- Admin PIN modal ---------- */

function getPinHash() {
  return sessionStorage.getItem(PIN_HASH_KEY);
}

function setPinHash(hash) {
  sessionStorage.setItem(PIN_HASH_KEY, hash);
}

/**
 * Проверить наличие PIN в sessionStorage, при отсутствии показать модалку.
 * Возвращает Promise<boolean> — true если PIN уже был или введён корректно.
 * (В этом тикете PIN «любой непустой» — NGF-029 добавит серверную сверку.)
 */
function requirePin() {
  if (getPinHash()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'pin-modal-backdrop';
    backdrop.innerHTML = `
      <div class="pin-modal" role="dialog" aria-modal="true" aria-labelledby="pin-modal-title">
        <h3 id="pin-modal-title">Введите Admin PIN</h3>
        <p class="cab-muted" style="margin:0 0 0.75rem;font-size:0.82rem">
          PIN защищает деструктивные действия. Хранится до закрытия вкладки.
        </p>
        <input type="password" id="pin-modal-input" placeholder="4-8 символов"
               minlength="4" maxlength="8" autocomplete="off">
        <p class="cab-error" id="pin-modal-error" hidden></p>
        <div class="pin-modal__btns">
          <button type="button" class="cab-btn cab-btn--ghost" id="pin-modal-cancel">Отмена</button>
          <button type="button" class="cab-btn cab-btn--primary" id="pin-modal-ok">Подтвердить</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const input = $('pin-modal-input');
    const errEl = $('pin-modal-error');
    input.focus();

    async function confirm() {
      const val = input.value.trim();
      if (val.length < 4) {
        errEl.textContent = 'PIN должен быть не короче 4 символов.';
        errEl.hidden = false;
        return;
      }
      const hash = await sha256hex(val);
      setPinHash(hash);
      backdrop.remove();
      resolve(true);
    }

    $('pin-modal-ok').addEventListener('click', confirm);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); });
    $('pin-modal-cancel').addEventListener('click', () => {
      backdrop.remove();
      resolve(false);
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) { backdrop.remove(); resolve(false); }
    });
  });
}

/* ---------- Helpers ---------- */

function fmtDate(ts) {
  if (!ts) return '';
  const dt = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function badge(text, cls) {
  const b = document.createElement('span');
  b.className = `cab-tag ${cls}`;
  b.textContent = text;
  return b;
}

/* ---------- Studio state ---------- */

let currentSlug = null;
let currentReviewStatus = 'held_for_review';

const els = {
  studioView: $('studio-view'),
  studioGameName: $('studio-game-name'),
  studioBackBtn: $('studio-back-btn'),
  tabOverview: $('tab-overview'),
  tabReviews: $('tab-reviews'),
  panelOverview: $('tabpanel-overview'),
  panelReviews: $('tabpanel-reviews'),
  statsStatus: $('stats-status'),
  studioMetrics: $('studio-metrics'),
  studioFunnel: $('studio-funnel'),
  studioReturnGrid: $('studio-return-grid'),
  studioChart: $('studio-chart'),
  studioBars: $('studio-bars'),
  subtabHeld: $('subtab-held'),
  subtabPublished: $('subtab-published'),
  reviewsStatus: $('reviews-status'),
  reviewsList: $('reviews-list'),
};

/* ---------- Tabs ---------- */

function showTab(tab) {
  const isOverview = tab === 'overview';
  els.tabOverview.setAttribute('aria-selected', isOverview ? 'true' : 'false');
  els.tabReviews.setAttribute('aria-selected', isOverview ? 'false' : 'true');
  els.panelOverview.hidden = !isOverview;
  els.panelReviews.hidden = isOverview;
  if (!isOverview) loadReviews(currentSlug, currentReviewStatus);
  else loadStats(currentSlug);
}

els.tabOverview.addEventListener('click', () => showTab('overview'));
els.tabReviews.addEventListener('click', () => showTab('reviews'));

/* ---------- Subtabs (reviews) ---------- */

function showSubtab(status) {
  currentReviewStatus = status;
  const isHeld = status === 'held_for_review';
  els.subtabHeld.setAttribute('aria-selected', isHeld ? 'true' : 'false');
  els.subtabPublished.setAttribute('aria-selected', isHeld ? 'false' : 'true');
  loadReviews(currentSlug, status);
}

els.subtabHeld.addEventListener('click', () => showSubtab('held_for_review'));
els.subtabPublished.addEventListener('click', () => showSubtab('published'));

/* ---------- Stats / Overview ---------- */

async function loadStats(slug) {
  els.statsStatus.textContent = 'Загрузка метрик…';
  els.studioMetrics.innerHTML = '';
  els.studioFunnel.hidden = true;
  els.studioFunnel.innerHTML = '';
  els.studioReturnGrid.innerHTML = '';
  els.studioChart.hidden = true;
  try {
    const data = await workerFetch(`/api/studio/${slug}/stats?period=7d`);
    els.statsStatus.textContent = '';
    renderMetrics(data);
    renderFunnel(data);
    renderReturnRetention(data.return_retention || null);
    renderChart(data.daily || []);
  } catch (err) {
    els.statsStatus.textContent = `Ошибка загрузки метрик: ${err.message}`;
  }
}

/* ---------- Benchmark thresholds (§5, studio-metrics-v2-design.md) ---------- */

/**
 * Returns 'good'|'ok'|'bad'|null for a numeric value against threshold config.
 * thresholds: { good: N, ok: N } — value >= good → 'good', >= ok → 'ok', else 'bad'.
 * Returns null if value is null/undefined (not enough data).
 */
function benchTier(value, thresholds) {
  if (value == null) return null;
  const v = Number(value);
  if (v >= thresholds.good) return 'good';
  if (v >= thresholds.ok)   return 'ok';
  return 'bad';
}

const BENCH = {
  retention_1min_pct:  { good: 70, ok: 40 },
  retention_3min_pct:  { good: 40, ok: 20 },
  retention_10min_pct: { good: 20, ok: 8  },
  like_ratio:          { good: 75, ok: 55 },
  avg_session_min:     { good: 8,  ok: 3  },
};

const BENCH_LABEL = { good: 'Выше нормы', ok: 'В норме', bad: 'Ниже нормы' };

function makeMetricCard(valText, label, tier) {
  const metric = document.createElement('div');
  metric.className = 'studio-metric' + (tier ? ` studio-metric--${tier}` : '');

  const valEl = document.createElement('div');
  valEl.className = 'studio-metric__val';
  valEl.textContent = valText;

  const lblEl = document.createElement('div');
  lblEl.className = 'studio-metric__label';
  lblEl.textContent = label;

  metric.appendChild(valEl);
  metric.appendChild(lblEl);

  if (tier) {
    const benchEl = document.createElement('div');
    benchEl.className = 'studio-metric__bench';
    benchEl.textContent = BENCH_LABEL[tier];
    metric.appendChild(benchEl);
  }
  return metric;
}

function renderMetrics(data) {
  els.studioMetrics.innerHTML = '';

  // A1: Запусков — без подсветки (объём)
  els.studioMetrics.appendChild(makeMetricCard(
    data.total_plays ?? '—', 'Запусков', null
  ));

  // A2: Уник. игроки — без подсветки (объём)
  els.studioMetrics.appendChild(makeMetricCard(
    data.unique_players ?? '—', 'Уник. игроки', null
  ));

  // A3: R@1мин
  const r1 = data.retention_1min_pct;
  els.studioMetrics.appendChild(makeMetricCard(
    r1 != null ? `${Number(r1).toFixed(0)}%` : '—',
    'R@1мин',
    benchTier(r1, BENCH.retention_1min_pct)
  ));

  // A4: R@3мин
  const r3 = data.retention_3min_pct;
  els.studioMetrics.appendChild(makeMetricCard(
    r3 != null ? `${Number(r3).toFixed(0)}%` : '—',
    'R@3мин',
    benchTier(r3, BENCH.retention_3min_pct)
  ));

  // A5: R@10мин
  const r10 = data.retention_10min_pct;
  els.studioMetrics.appendChild(makeMetricCard(
    r10 != null ? `${Number(r10).toFixed(0)}%` : '—',
    'R@10мин',
    benchTier(r10, BENCH.retention_10min_pct)
  ));

  // A6: Like ratio
  const lr = data.like_ratio;
  els.studioMetrics.appendChild(makeMetricCard(
    lr != null ? `${Number(lr).toFixed(0)}%` : '—',
    'Like ratio',
    benchTier(lr, BENCH.like_ratio)
  ));

  // A7: Ср. сессия (вспомогательное)
  const avg = data.avg_session_min;
  els.studioMetrics.appendChild(makeMetricCard(
    avg != null ? `${Number(avg).toFixed(1)} мин` : '—',
    'Ср. сессия',
    benchTier(avg, BENCH.avg_session_min)
  ));
}

/* ---------- Ping funnel (§6.1) ---------- */

/**
 * Determines bar fill class: 'good' → no modifier, 'ok' → '--ok', 'bad' → '--bad'.
 */
function funnelFillClass(pct, thresholds) {
  const tier = benchTier(pct, thresholds);
  if (tier === 'ok')  return 'studio-funnel__fill--ok';
  if (tier === 'bad') return 'studio-funnel__fill--bad';
  return '';
}

function renderFunnel(data) {
  const r1  = data.retention_1min_pct;
  const r3  = data.retention_3min_pct;
  const r10 = data.retention_10min_pct;
  const r30 = data.retention_30min_pct;

  // Always show 4 steps; show R@30 only if > 0
  const steps = [
    { label: 'Запуск',  pct: 100,  thresholds: null },
    { label: 'R@1мин',  pct: r1,   thresholds: BENCH.retention_1min_pct },
    { label: 'R@3мин',  pct: r3,   thresholds: BENCH.retention_3min_pct },
    { label: 'R@10мин', pct: r10,  thresholds: BENCH.retention_10min_pct },
  ];
  if (r30 != null && Number(r30) > 0) {
    steps.push({ label: 'R@30мин', pct: r30, thresholds: { good: 8, ok: 3 } });
  }

  els.studioFunnel.innerHTML = '';
  for (const step of steps) {
    const row = document.createElement('div');
    row.className = 'studio-funnel__row';

    const lbl = document.createElement('div');
    lbl.className = 'studio-funnel__label';
    lbl.textContent = step.label;

    const track = document.createElement('div');
    track.className = 'studio-funnel__track';

    const fill = document.createElement('div');
    const pctVal = step.pct != null ? Number(step.pct) : null;
    const fillPct = pctVal ?? 0;
    const fillMod = step.thresholds ? funnelFillClass(pctVal, step.thresholds) : '';
    fill.className = ('studio-funnel__fill' + (fillMod ? ' ' + fillMod : '')).trim();
    fill.style.width = `${Math.min(fillPct, 100)}%`;

    track.appendChild(fill);

    const pctEl = document.createElement('div');
    pctEl.className = 'studio-funnel__pct';
    pctEl.textContent = pctVal != null ? `${pctVal.toFixed(0)}%` : '—';

    row.appendChild(lbl);
    row.appendChild(track);
    row.appendChild(pctEl);
    els.studioFunnel.appendChild(row);
  }

  els.studioFunnel.hidden = false;
}

/* ---------- Return-retention (§3, §5.2) ---------- */

const BENCH_RETURN = {
  d1:  { good: 12,  ok: 5   },
  d3:  { good: 6,   ok: 2   },
  d7:  { good: 4,   ok: 1.5 },
  d30: { good: 2,   ok: 0.5 },
};

function renderReturnRetention(rr) {
  els.studioReturnGrid.innerHTML = '';
  const keys = ['d1', 'd3', 'd7', 'd30'];
  const labels = { d1: 'D1', d3: 'D3', d7: 'D7', d30: 'D30' };

  for (const key of keys) {
    const entry = rr && rr[key] ? rr[key] : null;
    const pct   = entry && entry.pct != null ? entry.pct : null;
    const size  = entry ? entry.cohort_size : null;
    const tier  = pct != null ? benchTier(pct, BENCH_RETURN[key]) : null;

    const card = document.createElement('div');
    card.className = 'studio-metric' + (tier ? ` studio-metric--${tier}` : '');

    const valEl = document.createElement('div');
    valEl.className = 'studio-metric__val';
    valEl.textContent = pct != null ? `${Number(pct).toFixed(1)}%` : '—';

    const lblEl = document.createElement('div');
    lblEl.className = 'studio-metric__label';
    lblEl.textContent = labels[key];

    card.appendChild(valEl);
    card.appendChild(lblEl);

    if (pct == null && size != null) {
      // Not enough data — show cohort size hint
      const hint = document.createElement('div');
      hint.className = 'studio-metric__bench';
      hint.style.color = 'var(--color-text-muted)';
      hint.textContent = `мало данных (${size})`;
      card.appendChild(hint);
    } else if (tier) {
      const benchEl = document.createElement('div');
      benchEl.className = 'studio-metric__bench';
      benchEl.textContent = BENCH_LABEL[tier];
      card.appendChild(benchEl);
    }

    els.studioReturnGrid.appendChild(card);
  }
}

function renderChart(daily) {
  els.studioChart.hidden = false;
  els.studioBars.innerHTML = '';

  // Строим сетку из 7 дней (сегодня и 6 дней назад по UTC)
  const DAYS = 7;
  const todayUTC = new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  ));
  const grid = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(todayUTC);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
    grid.push({ day: key, starts: 0, uniques: 0 });
  }
  // Наложить реальные данные на сетку
  const byDay = {};
  for (const d of daily) { byDay[d.day] = d; }
  for (const slot of grid) { if (byDay[slot.day]) Object.assign(slot, byDay[slot.day]); }

  const totalStarts = grid.reduce((s, d) => s + (d.starts || 0), 0);
  if (!totalStarts) {
    const empty = document.createElement('div');
    empty.className = 'studio-chart__empty';
    empty.textContent = 'Пока нет запусков';
    els.studioBars.appendChild(empty);
    return;
  }

  const max = Math.max(...grid.map(d => d.starts || 0), 1);
  for (const d of grid) {
    const pct = Math.round(((d.starts || 0) / max) * 100);
    const wrap = document.createElement('div');
    wrap.className = 'studio-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'studio-bar' + (d.starts ? '' : ' studio-bar--empty');
    bar.style.height = `${Math.max(pct, 2)}%`;
    bar.title = `${d.day}: ${d.starts} запусков`;
    const lbl = document.createElement('div');
    lbl.className = 'studio-bar-label';
    // Формат dd.mm из YYYY-MM-DD
    lbl.textContent = d.day ? `${d.day.slice(8)}.${d.day.slice(5, 7)}` : '';
    wrap.appendChild(bar);
    wrap.appendChild(lbl);
    els.studioBars.appendChild(wrap);
  }
}

/* ---------- Reviews ---------- */

async function loadReviews(slug, status) {
  els.reviewsStatus.textContent = 'Загрузка отзывов…';
  els.reviewsList.innerHTML = '';
  try {
    const data = await workerFetch(`/api/studio/${slug}/reviews?status=${status}`);
    els.reviewsStatus.textContent = '';
    const reviews = data.reviews || [];
    if (!reviews.length) {
      els.reviewsStatus.textContent = 'Отзывов нет.';
      return;
    }
    // Закреплённые — первыми
    reviews.sort((a, b) => (b.is_pinned || 0) - (a.is_pinned || 0));
    for (const r of reviews) {
      els.reviewsList.appendChild(reviewCard(r, slug, status));
    }
  } catch (err) {
    els.reviewsStatus.textContent = `Ошибка загрузки: ${err.message}`;
  }
}

async function doAction(slug, reviewId, body, card) {
  const btns = card.querySelectorAll('button');
  btns.forEach(b => { b.disabled = true; });
  try {
    await workerFetch(`/api/studio/${slug}/review/${reviewId}/action`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    // Перезагрузить список после успешного действия
    loadReviews(slug, currentReviewStatus);
  } catch (err) {
    els.reviewsStatus.textContent = `Ошибка: ${err.message}`;
    btns.forEach(b => { b.disabled = false; });
  }
}

function reviewCard(r, slug, status) {
  const card = document.createElement('div');
  card.className = 'studio-review' + (r.is_pinned ? ' studio-review--pinned' : '');

  // Мета-строка
  const meta = document.createElement('div');
  meta.className = 'studio-review__meta';
  meta.appendChild(document.createTextNode(
    `${r.name || 'Аноним'} · ${fmtDate(r.created_at)}`
  ));
  if (r.is_pinned) meta.appendChild(badge('закреплён', 'cab-tag--pinned'));
  if (r.hold_reason) meta.appendChild(badge(r.hold_reason, 'cab-tag--held'));
  if (status === 'hidden') meta.appendChild(badge('скрыт', 'cab-tag--hidden'));
  card.appendChild(meta);

  // Причина hold/reject
  if (r.hold_reason || r.reject_reason) {
    const reason = document.createElement('div');
    reason.className = 'studio-review__reason';
    reason.textContent = r.hold_reason
      ? `На проверке: ${r.hold_reason}`
      : `Отклонён: ${r.reject_reason}`;
    card.appendChild(reason);
  }

  // Текст
  const text = document.createElement('p');
  text.className = 'studio-review__text';
  text.textContent = r.text;
  card.appendChild(text);

  // Ответ автора (если есть)
  if (r.reply_text) {
    const reply = document.createElement('div');
    reply.className = 'studio-review__reply';
    reply.textContent = `Ответ: ${r.reply_text}`;
    card.appendChild(reply);
  }

  // Кнопки действий
  const actions = document.createElement('div');
  actions.className = 'studio-review__actions';

  function btn(label, cls, handler) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cab-btn cab-btn--sm ${cls}`;
    b.textContent = label;
    b.addEventListener('click', handler);
    return b;
  }

  if (status === 'held_for_review') {
    actions.appendChild(btn('Одобрить', 'cab-btn--primary', () =>
      doAction(slug, r.id, { action: 'approve' }, card)));
    actions.appendChild(btn('Отклонить', 'cab-btn--ghost', () =>
      doAction(slug, r.id, { action: 'reject', reject_reason: 'manual' }, card)));
    actions.appendChild(btn('Скрыть юзера', 'cab-btn--danger', async () => {
      if (!await requirePin()) return;
      doAction(slug, r.id, { action: 'hide_user' }, card);
    }));
    actions.appendChild(btn('Удалить', 'cab-btn--danger', async () => {
      if (!await requirePin()) return;
      doAction(slug, r.id, { action: 'delete' }, card);
    }));
  }

  if (status === 'published') {
    const pinLabel = r.is_pinned ? 'Открепить' : 'Закрепить';
    const pinAction = r.is_pinned ? 'unpin' : 'pin';
    actions.appendChild(btn(pinLabel, 'cab-btn--ghost', () =>
      doAction(slug, r.id, { action: pinAction }, card)));

    const heartLabel = r.author_hearted ? '♥ Убрать' : '♡ Сердечко';
    const heartAction = r.author_hearted ? 'unheart' : 'heart';
    actions.appendChild(btn(heartLabel, 'cab-btn--ghost', () =>
      doAction(slug, r.id, { action: heartAction }, card)));

    // Ответить — toggle поле
    const replyToggle = btn('Ответить', 'cab-btn--ghost', null);
    actions.appendChild(replyToggle);

    actions.appendChild(btn('Скрыть юзера', 'cab-btn--danger', async () => {
      if (!await requirePin()) return;
      doAction(slug, r.id, { action: 'hide_user' }, card);
    }));
    actions.appendChild(btn('Удалить', 'cab-btn--danger', async () => {
      if (!await requirePin()) return;
      doAction(slug, r.id, { action: 'delete' }, card);
    }));

    // Поле ответа (скрыто по умолчанию)
    const replyForm = document.createElement('div');
    replyForm.className = 'studio-review__reply-form';
    replyForm.hidden = true;
    const replyTextarea = document.createElement('textarea');
    replyTextarea.placeholder = 'Ваш ответ…';
    replyTextarea.value = r.reply_text || '';
    const replySend = document.createElement('button');
    replySend.type = 'button';
    replySend.className = 'cab-btn cab-btn--sm cab-btn--primary';
    replySend.textContent = 'Отправить';
    replySend.addEventListener('click', () => {
      const text = replyTextarea.value.trim();
      if (!text) return;
      doAction(slug, r.id, { action: 'reply', reply_text: text }, card);
    });
    replyForm.appendChild(replyTextarea);
    replyForm.appendChild(replySend);
    replyToggle.addEventListener('click', () => {
      replyForm.hidden = !replyForm.hidden;
      if (!replyForm.hidden) replyTextarea.focus();
    });
    card.appendChild(replyForm);
  }

  card.appendChild(actions);
  return card;
}

/* ---------- Open / Close Studio ---------- */

function openStudio(slug, title) {
  if (!isAuthed()) return;
  currentSlug = slug;
  currentReviewStatus = 'held_for_review';
  els.studioGameName.textContent = title || slug;
  // Сброс вкладок
  showTab('overview');
  els.subtabHeld.setAttribute('aria-selected', 'true');
  els.subtabPublished.setAttribute('aria-selected', 'false');
  els.studioView.hidden = false;
}

function closeStudio() {
  els.studioView.hidden = true;
  currentSlug = null;
  window.dispatchEvent(new CustomEvent('ngf:studio-close'));
}

els.studioBackBtn.addEventListener('click', closeStudio);

/* ---------- Routing ---------- */

// При открытии страницы с ?game= — сразу открываем Studio.
// Ждём события isAuthed (cabinet.js вызывает render → loadGames → gameCard).
// Проще: слушаем ngf:studio-open от gameCard-кнопки, а ?game= при load
// обрабатываем после небольшой задержки (catalog ещё не загружен).

window.addEventListener('ngf:studio-open', (e) => {
  openStudio(e.detail.slug, e.detail.title);
});

// При загрузке страницы с ?game= в URL — диспатчим событие после загрузки каталога.
// cabinet.js грузит игры асинхронно; Studio ждёт события ngf:catalog-ready,
// которое cabinet.js не шлёт — поэтому используем простой polling через MutationObserver
// на #games-list: как только карточки появились, ищем совпадение по slug.
(function initQueryRouting() {
  const params = new URLSearchParams(location.search);
  const slugFromQuery = params.get('game');
  if (!slugFromQuery) return;

  const gamesList = document.getElementById('games-list');
  if (!gamesList) return;

  // Наблюдаем за появлением карточек
  const observer = new MutationObserver(() => {
    // Карточки уже есть — ищем кнопку Студия для нужного slug
    // cabinet.js хранит данные игры в замыкании кнопки; здесь нам достаточно
    // знать slug из URL — slug = g.id = data-slug атрибута, но его нет.
    // Диспатчим событие с slug; title возьмём из первого <strong> карточки.
    if (!gamesList.children.length) return;
    observer.disconnect();
    clearTimeout(fallbackTimer);

    // Находим карточку по тексту slug в мета-строке (g.id в cab-muted)
    let title = slugFromQuery;
    for (const card of gamesList.children) {
      const muted = card.querySelector('.cab-muted');
      if (muted && muted.textContent.startsWith(slugFromQuery + ' ·')) {
        const strong = card.querySelector('strong');
        if (strong) title = strong.textContent;
        break;
      }
    }
    window.dispatchEvent(new CustomEvent('ngf:studio-open', {
      detail: { slug: slugFromQuery, title },
    }));
  });
  observer.observe(gamesList, { childList: true });

  // Фоллбэк: отключить observer если каталог так и не загрузился за 10с
  const fallbackTimer = setTimeout(() => { observer.disconnect(); }, 10000);

  // Отключить при закрытии студии
  window.addEventListener('ngf:studio-close', () => {
    observer.disconnect();
    clearTimeout(fallbackTimer);
  }, { once: true });
})();
