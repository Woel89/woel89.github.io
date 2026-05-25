/**
 * Кабинет NetGameForge — конфигурационные константы (Фаза 1, без сервера).
 * Всё, что зависит от инфраструктуры, вынесено сюда: в Фазе 2 меняются только
 * значения, интерфейсы модулей остаются стабильными (см. дизайн §7).
 * @module config
 */

/**
 * Репозиторий, в который коммитятся ОБФУСЦИРОВАННЫЕ билды игр.
 * Раскладка: builds/<gameId>/<version>/index.html + ассеты.
 * @type {string}
 */
export const BUILDS_REPO = 'Woel89/ngf-builds';

/**
 * Репозиторий каталога с games.json (read-modify-commit).
 * @type {string}
 */
export const CATALOG_REPO = 'Woel89/woel89.github.io';

/**
 * Публичный origin/базовый URL, с которого отдаются билды.
 * Origin абстрактен: в Фазе 1 фактически отдаётся из GitHub Pages
 * (woel89.github.io/ngf-builds), но публичный адрес может стать
 * builds.netgameforge.com. Здесь — целевой публичный хост каталога.
 * @type {string}
 */
export const BUILDS_BASE_URL = 'https://netgameforge.com/ngf-builds';

/**
 * ID счётчика Яндекс.Метрики (внешняя аналитика, дизайн §7 track()).
 * @type {number}
 */
export const METRIKA_ID = 109411317;

/**
 * Google Analytics 4 Measurement ID (вторая аналитика; GA4 — глобальная картина).
 * Используем обе: Метрику (RU + Вебвизор) и GA4. Слой track() (#11) шлёт события в обе.
 * @type {string}
 */
export const GA_MEASUREMENT_ID = 'G-2VT82NLXH9';

/**
 * Максимальный суммарный размер распакованного билда (zip-bomb guard).
 * @type {number}
 */
export const MAX_UNPACKED_BYTES = 25 * 1024 * 1024; // 25 МБ

/**
 * Максимальное число файлов в билде (zip-bomb guard).
 * @type {number}
 */
export const MAX_FILES = 500;

/**
 * Версия GitHub REST API (заголовок X-GitHub-Api-Version).
 * @type {string}
 */
export const GITHUB_API_VERSION = '2022-11-28';

/**
 * Базовый адрес GitHub REST API.
 * @type {string}
 */
export const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Whitelist разрешённых расширений файлов внутри билда (без точки, lowercase).
 * @type {string[]}
 */
export const ALLOWED_EXTENSIONS = [
  'html', 'js', 'css', 'wasm', 'json',
  'png', 'jpg', 'jpeg', 'webp', 'svg', 'gif',
  'mp3', 'ogg', 'wav',
  'woff', 'woff2', 'ttf',
];

/**
 * Чёрный список расширений/имён, которые всегда отклоняются.
 * @type {string[]}
 */
export const BLOCKED_EXTENSIONS = ['php', 'exe', 'sh', 'bat'];

/**
 * Подозрительный максимальный коэффициент сжатия одного файла (zip-bomb ratio).
 * Распакованный/сжатый выше этого порога — отклоняется.
 * @type {number}
 */
export const MAX_COMPRESSION_RATIO = 200;
