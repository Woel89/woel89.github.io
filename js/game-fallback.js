/**
 * NGF-080: Graceful fallback при незагрузке игры (итерация 3).
 * Независим от инлайн-скрипта плеера. Подключается как общий <script src>.
 *
 * Определение типа игры:
 *   - GameMonetize: REAL_SRC iframe содержит "gamemonetize" (src до клика — about:blank,
 *     реальный адрес прописывается инлайн-скриптом плеера в REAL_SRC и вставляется в
 *     frame.src при клике «Играть»). Детектируем по текущему frame.src после клика.
 *   - Self-hosted (builds.netgameforge.com, broadside и др.): overlay никогда не показываем.
 *
 * Логика для GameMonetize-игр:
 *   1. При клике «Играть» ждём 300 мс (чтобы инлайн-скрипт успел обновить frame.src),
 *      затем проверяем: frame.src содержит "gamemonetize"?
 *   2. Если да — запускаем probe doubleclick (securepubads.g.doubleclick.net/tag/js/gpt.js,
 *      таймаут 4 с):
 *      - onerror / таймаут → показываем overlay «блокировка рекламы» + ссылка /help/adblock/
 *      - onload → doubleclick доступен, overlay не показываем; если конкретный embed
 *        мёртв — это проблема каталога, не этого скрипта.
 *   3. Если frame.src не содержит "gamemonetize" — ничего не делаем.
 *
 * Главный критерий: НЕТ ложных срабатываний на рабочих играх.
 * Self-hosted overlay не показывает никогда.
 * Стили overlay живут в css/styles.css — здесь не дублируем.
 */
(function () {
  'use strict';

  var PROBE_TIMEOUT_MS = 4000;   /* 4 с на probe doubleclick */
  var CLICK_DELAY_MS   = 300;    /* ждём, пока инлайн-скрипт запишет frame.src */
  var DOUBLECLICK_URL  = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';

  function init() {
    var player  = document.getElementById('game-player');
    var frame   = document.getElementById('game-frame');
    var playBtn = document.getElementById('game-play-btn');

    if (!player || !frame || !playBtn) return;

    var overlayShown = false;

    /* ---- Создаём overlay-элемент ---- */
    var overlay = document.createElement('div');
    overlay.id = 'game-error-overlay';
    overlay.className = 'game-error-overlay';
    overlay.setAttribute('role', 'alert');
    overlay.setAttribute('aria-live', 'assertive');
    overlay.hidden = true;
    player.appendChild(overlay);

    /* ---- При нажатии «Играть» ---- */
    playBtn.addEventListener('click', function () {
      overlayShown = false;
      overlay.hidden = true;
      overlay.innerHTML = '';
      player.removeAttribute('data-error');

      /* Ждём, пока инлайн-скрипт плеера запишет реальный src в frame.src */
      setTimeout(function () {
        var src = frame.src || '';
        if (src.indexOf('gamemonetize') === -1) {
          /* Self-hosted или неизвестный src — ничего не делаем */
          return;
        }
        /* GameMonetize: запускаем probe doubleclick */
        probeDoubleclick(function (blocked) {
          if (blocked) {
            showOverlay();
          }
          /* blocked=false: doubleclick доступен → не показываем overlay */
        });
      }, CLICK_DELAY_MS);
    });

    /* ---- Probe doubleclick ---- */
    function probeDoubleclick(cb) {
      var done = false;

      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        /* Таймаут = doubleclick недоступен (заблокирован или сеть) → считаем adblock */
        cb(true);
      }, PROBE_TIMEOUT_MS);

      var s = document.createElement('script');
      s.src = DOUBLECLICK_URL + '?ngf_probe=1&_=' + Date.now();
      s.async = true;
      s.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        s.parentNode && s.parentNode.removeChild(s);
        cb(false); /* doubleclick грузится → adblock не активен */
      };
      s.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        s.parentNode && s.parentNode.removeChild(s);
        cb(true); /* doubleclick заблокирован → adblock */
      };
      document.head.appendChild(s);
    }

    /* ---- Показать overlay (только adblock-кейс) ---- */
    function showOverlay() {
      if (overlayShown) return;
      overlayShown = true;
      player.dataset.error = '1';

      overlay.innerHTML =
        '<div class="game-error-overlay__box">'
        + '<p class="game-error-overlay__title">Игра не запустилась</p>'
        + '<p class="game-error-overlay__message">Похоже, включена блокировка рекламы (Яндекс.Protect, AdBlock или фильтрующий DNS). '
        + 'Для запуска игры её нужно отключить для этого сайта.</p>'
        + '<p class="game-error-overlay__help">'
        + '<a href="/help/adblock/" class="game-error-overlay__link">Как отключить блокировку?</a>'
        + '</p>'
        + '<button type="button" class="game-error-overlay__retry">Попробовать снова</button>'
        + '</div>';

      overlay.hidden = false;

      overlay.querySelector('.game-error-overlay__retry').addEventListener('click', function () {
        overlay.hidden = true;
        overlay.innerHTML = '';
        player.removeAttribute('data-error');
        overlayShown = false;

        /* Сбросить iframe, затем симулировать клик «Играть» — инлайн-скрипт установит src */
        frame.src = 'about:blank';
        setTimeout(function () {
          playBtn.click();
        }, 50);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
