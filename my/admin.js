/**
 * Admin overview — сводная статистика площадки по всем играм (NGF-073).
 * Виден только владельцу-админу (Bearer-токен с admin-правами).
 * Определение роли: ленивое — при первом открытии шлём GET /api/admin/overview;
 * 401/403 → показываем «нет доступа», прячем кнопку.
 * @module admin
 */

import { getToken, isAuthed } from './lib/auth.js';

const WORKER_API = 'https://ngf-api.kovalevde.workers.dev';

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
    const err = new Error((data && data.error) || `http_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------- State ---------- */

let currentPeriod = '7d';

const els = {
  adminView:         $('admin-view'),
  adminBackBtn:      $('admin-back-btn'),
  adminOpenBtn:      $('admin-open-btn'),
  cabinetView:       $('cabinet-view'),
  adminStatus:       $('admin-status'),
  adminError:        $('admin-error'),
  adminMetrics:      $('admin-metrics'),
  adminChart:        $('admin-chart'),
  adminChartTitle:   $('admin-chart-title'),
  adminBars:         $('admin-bars'),
  adminGamesSection: $('admin-games-section'),
  adminGamesTable:   $('admin-games-table'),
  period7d:          $('admin-period-7d'),
  period30d:         $('admin-period-30d'),
};

/* ---------- Helpers ---------- */

function showError(msg) {
  els.adminError.textContent = msg;
  els.adminError.hidden = false;
}

function hideError() {
  els.adminError.textContent = '';
  els.adminError.hidden = true;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const dt = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtSec(sec) {
  if (sec == null) return '—';
  const s = Number(sec);
  if (isNaN(s)) return '—';
  if (s < 60) return `${Math.round(s)} с`;
  return `${(s / 60).toFixed(1)} мин`;
}

function makeMetricCard(valText, label) {
  const metric = document.createElement('div');
  metric.className = 'studio-metric';
  const valEl = document.createElement('div');
  valEl.className = 'studio-metric__val';
  valEl.textContent = valText;
  const lblEl = document.createElement('div');
  lblEl.className = 'studio-metric__label';
  lblEl.textContent = label;
  metric.appendChild(valEl);
  metric.appendChild(lblEl);
  return metric;
}

/* ---------- Render totals ---------- */

function renderMetrics(totals) {
  els.adminMetrics.innerHTML = '';
  const plays = totals.plays ?? 0;
  const unique = totals.unique_players ?? 0;
  const avg = totals.avg_session_sec ?? null;
  const games = totals.games_count ?? 0;

  els.adminMetrics.appendChild(makeMetricCard(plays.toLocaleString('ru-RU'), 'Всего запусков'));
  els.adminMetrics.appendChild(makeMetricCard(unique.toLocaleString('ru-RU'), 'Уник. игроков'));
  els.adminMetrics.appendChild(makeMetricCard(fmtSec(avg), 'Ср. сессия'));
  els.adminMetrics.appendChild(makeMetricCard(String(games), 'Игр в каталоге'));
}

/* ---------- Render chart ---------- */

function renderChart(byDay, period) {
  const days = period === '30d' ? 30 : 7;
  els.adminChartTitle.textContent = `Запуски по дням (${period === '30d' ? '30д' : '7д'})`;
  els.adminChart.hidden = false;
  els.adminBars.innerHTML = '';

  // Строим сетку нужной длины
  const todayUTC = new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  ));
  const grid = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayUTC);
    d.setUTCDate(d.getUTCDate() - i);
    grid.push({ date: d.toISOString().slice(0, 10), plays: 0 });
  }

  const byDate = {};
  for (const d of (byDay || [])) { byDate[d.date] = d; }
  for (const slot of grid) {
    if (byDate[slot.date]) slot.plays = byDate[slot.date].plays || 0;
  }

  const totalPlays = grid.reduce((s, d) => s + d.plays, 0);
  if (!totalPlays) {
    const empty = document.createElement('div');
    empty.className = 'studio-chart__empty';
    empty.textContent = 'Пока нет данных';
    els.adminBars.appendChild(empty);
    return;
  }

  const max = Math.max(...grid.map(d => d.plays), 1);
  for (const d of grid) {
    const pct = Math.round((d.plays / max) * 100);
    const wrap = document.createElement('div');
    wrap.className = 'studio-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'studio-bar' + (d.plays ? '' : ' studio-bar--empty');
    bar.style.height = `${Math.max(pct, 2)}%`;
    bar.title = `${d.date}: ${d.plays} запусков`;
    const lbl = document.createElement('div');
    lbl.className = 'studio-bar-label';
    // dd.mm из YYYY-MM-DD
    lbl.textContent = d.date ? `${d.date.slice(8)}.${d.date.slice(5, 7)}` : '';
    wrap.appendChild(bar);
    wrap.appendChild(lbl);
    els.adminBars.appendChild(wrap);
  }
}

/* ---------- Render games table ---------- */

function renderGamesTable(games) {
  els.adminGamesTable.innerHTML = '';

  if (!games || !games.length) {
    const p = document.createElement('p');
    p.className = 'cab-muted';
    p.textContent = 'Пока нет данных по играм.';
    els.adminGamesTable.appendChild(p);
    els.adminGamesSection.hidden = false;
    return;
  }

  // Сортировка по запускам desc
  const sorted = [...games].sort((a, b) => (b.plays || 0) - (a.plays || 0));

  const table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.88rem';

  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>
    <th style="text-align:left;padding:0.45rem 0.6rem;color:var(--color-text-muted);font-weight:500;border-bottom:1px solid var(--color-border)">Игра</th>
    <th style="text-align:right;padding:0.45rem 0.6rem;color:var(--color-text-muted);font-weight:500;border-bottom:1px solid var(--color-border)">Запуски</th>
    <th style="text-align:right;padding:0.45rem 0.6rem;color:var(--color-text-muted);font-weight:500;border-bottom:1px solid var(--color-border)">Уник.</th>
    <th style="text-align:right;padding:0.45rem 0.6rem;color:var(--color-text-muted);font-weight:500;border-bottom:1px solid var(--color-border)">Ср. сессия</th>
    <th style="text-align:right;padding:0.45rem 0.6rem;color:var(--color-text-muted);font-weight:500;border-bottom:1px solid var(--color-border)">Посл. запуск</th>
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const g of sorted) {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--color-border)';
    tr.innerHTML = `
      <td style="padding:0.45rem 0.6rem;word-break:break-all">${g.slug || '—'}</td>
      <td style="padding:0.45rem 0.6rem;text-align:right">${(g.plays || 0).toLocaleString('ru-RU')}</td>
      <td style="padding:0.45rem 0.6rem;text-align:right">${(g.unique_players || 0).toLocaleString('ru-RU')}</td>
      <td style="padding:0.45rem 0.6rem;text-align:right">${fmtSec(g.avg_session_sec)}</td>
      <td style="padding:0.45rem 0.6rem;text-align:right;white-space:nowrap">${fmtDate(g.last_play_at)}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  els.adminGamesTable.appendChild(table);
  els.adminGamesSection.hidden = false;
}

/* ---------- Load data ---------- */

async function loadOverview() {
  hideError();
  els.adminStatus.textContent = 'Загрузка…';
  els.adminMetrics.innerHTML = '';
  els.adminChart.hidden = true;
  els.adminGamesSection.hidden = true;

  try {
    const data = await workerFetch(`/api/admin/overview?period=${currentPeriod}`);
    els.adminStatus.textContent = '';
    renderMetrics(data.totals || {});
    renderChart(data.by_day || [], currentPeriod);
    renderGamesTable(data.games || []);
  } catch (err) {
    els.adminStatus.textContent = '';
    if (err.status === 401 || err.status === 403) {
      showError('Нет доступа. Этот раздел доступен только администратору площадки.');
      // Прячем кнопку — не нужна без прав
      els.adminOpenBtn.hidden = true;
    } else {
      showError(`Ошибка загрузки: ${err.message}`);
    }
  }
}

/* ---------- Period switcher ---------- */

function switchPeriod(period) {
  currentPeriod = period;
  const is7d = period === '7d';
  els.period7d.setAttribute('aria-selected', is7d ? 'true' : 'false');
  els.period30d.setAttribute('aria-selected', is7d ? 'false' : 'true');
  loadOverview();
}

els.period7d.addEventListener('click', () => switchPeriod('7d'));
els.period30d.addEventListener('click', () => switchPeriod('30d'));

/* ---------- Open / Close ---------- */

function openAdmin() {
  if (!isAuthed()) return;
  els.cabinetView.hidden = true;
  els.adminView.hidden = false;
  // Сброс периода
  currentPeriod = '7d';
  els.period7d.setAttribute('aria-selected', 'true');
  els.period30d.setAttribute('aria-selected', 'false');
  loadOverview();
}

function closeAdmin() {
  els.adminView.hidden = true;
  els.cabinetView.hidden = false;
}

els.adminBackBtn.addEventListener('click', closeAdmin);

// Кнопка в toolbar кабинета
els.adminOpenBtn.addEventListener('click', openAdmin);

/* ---------- Показать кнопку после авторизации ---------- */
// cabinet.js не шлёт событие о логине, поэтому наблюдаем за появлением cabinet-view.
// Как только cabinet-view перестаёт быть hidden — показываем кнопку.
(function initAdminBtnVisibility() {
  const cabinetView = els.cabinetView;
  if (!cabinetView) return;

  function syncBtn() {
    if (!cabinetView.hidden && isAuthed()) {
      els.adminOpenBtn.hidden = false;
    } else {
      els.adminOpenBtn.hidden = true;
    }
  }

  // MutationObserver на hidden-атрибут cabinet-view
  const observer = new MutationObserver(syncBtn);
  observer.observe(cabinetView, { attributes: true, attributeFilter: ['hidden'] });

  // Начальная проверка (если уже залогинен при загрузке)
  syncBtn();
})();

/* ---------- Скрыть admin-view при логауте ---------- */
// cabinet.js прячет cabinet-view и показывает login-view при логауте,
// при этом cabinet-view.hidden = true → наш observer уберёт кнопку.
// Если admin-view был открыт — закроем его.
(function initLogoutGuard() {
  const cabinetView = els.cabinetView;
  if (!cabinetView) return;

  const observer = new MutationObserver(() => {
    if (cabinetView.hidden && !els.adminView.hidden) {
      closeAdmin();
    }
  });
  observer.observe(cabinetView, { attributes: true, attributeFilter: ['hidden'] });
})();
