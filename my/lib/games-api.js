/**
 * Верхний слой публикации игр кабинета NetGameForge (Фаза 1, без сервера).
 * Связывает zip → obfuscate → storage (билды) и CRUD games.json (каталог).
 * Тикеты #6 (загрузка билда), #7 (CRUD games.json), #8 (оркестратор publishGame).
 *
 * ВАЖНО: токен НИКОГДА не логируется и не возвращается наружу.
 * @module games-api
 */

import { CATALOG_REPO, BUILDS_REPO, GITHUB_API_BASE } from './config.js';
import { authedRequest } from './auth.js';
import { putBuild, urlFor } from './storage.js';
import { unpackAndValidate } from './zip.js';
import { obfuscateFiles } from './obfuscate.js';

const CATALOG_PATH = 'games.json';

/**
 * @typedef {import('./zip.js').UnpackedFile} UnpackedFile
 */

/**
 * @typedef {Object} GameFlags
 * @property {boolean} isPopular ставится автоматикой позже (дефолт false).
 * @property {boolean} isPublished из формы.
 */

/**
 * @typedef {Object} GameMeta Контракт записи каталога (порядок полей стабилен).
 * @property {string} id slug игры ([a-z0-9-]), уникален.
 * @property {string} title
 * @property {string} description
 * @property {string} icon Путь к квадратной иконке (отдельно от coverUrl).
 * @property {string} coverUrl
 * @property {string} buildUrl URL опубликованного билда.
 * @property {string[]} tags
 * @property {string[]} categories 1-2 категории; primary = categories[0] (заменяет category).
 * @property {string[]} platforms Платформы: подмножество ['pc','mobile'], минимум одна.
 * @property {{pc?: string, mobile?: string}} controls Текст управления по платформе.
 * @property {string} dateAdded ISO-дата добавления.
 * @property {GameFlags} flags
 * @property {'portrait'|'landscape'} orientation
 * @property {string} author ник GitHub, проставляется автоматически.
 */

/**
 * Декодировать base64-контент Contents API (с переносами строк) в utf-8 строку.
 * @param {string} b64
 * @returns {string}
 */
function decodeBase64(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Закодировать utf-8 строку в base64 для Contents API.
 * @param {string} str
 * @returns {string}
 */
function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Проверить, что slug валиден ([a-z0-9-], непустой).
 * @param {string} slug
 * @returns {boolean}
 */
function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9-]+$/.test(slug);
}

/**
 * Таблица транслитерации кириллицы в латиницу для slug.
 * @type {Record<string,string>}
 */
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/**
 * Транслитерировать строку (RU→latin) посимвольно.
 * @param {string} str
 * @returns {string}
 */
function transliterate(str) {
  let out = '';
  for (const ch of String(str)) {
    const lower = ch.toLowerCase();
    out += Object.prototype.hasOwnProperty.call(TRANSLIT, lower) ? TRANSLIT[lower] : ch;
  }
  return out;
}

/**
 * Сгенерировать уникальный slug из названия.
 * RU→latin транслит, lowercase, только [a-z0-9-], схлопывание дефисов.
 * Если slug занят в existingIds — добавляет -2, -3…
 * @param {string} title
 * @param {string[]} [existingIds] список уже занятых id.
 * @returns {string} уникальный валидный slug.
 */
export function generateSlug(title, existingIds = []) {
  let base = transliterate(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!base) base = 'game';

  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Нормализовать название для сравнения «похожести» (lowercase, без пунктуации/пробелов).
 * @param {string} title
 * @returns {string}
 */
function normalizeTitle(title) {
  return transliterate(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Найти возможный дубликат игры по slug или похожему названию.
 * @param {string} title
 * @param {GameMeta[]} games текущий каталог.
 * @returns {GameMeta|null} найденная игра-дубль или null.
 */
export function findDuplicate(title, games) {
  if (!Array.isArray(games) || !games.length) return null;
  const slug = generateSlug(title, []);
  const norm = normalizeTitle(title);
  return (
    games.find((g) => g.id === slug || normalizeTitle(g.title) === norm) || null
  );
}

/** Кэш ника GitHub-владельца (в памяти, на время жизни модуля). */
let _viewerLogin = null;

/**
 * Получить ник (login) текущего владельца токена через GitHub API. Кэшируется.
 * @returns {Promise<string>} login.
 * @throws {Error} если запрос не удался.
 */
export async function getViewerLogin() {
  if (_viewerLogin) return _viewerLogin;
  const me = await authedRequest('GET', `${GITHUB_API_BASE}/user`);
  _viewerLogin = me && me.login ? me.login : '';
  return _viewerLogin;
}

/**
 * Словарь тегов-кандидатов: тег → ключевые слова (RU+en, lowercase).
 * @type {Record<string,string[]>}
 */
const TAG_KEYWORDS = {
  'гонки': ['гонк', 'race', 'racing', 'drift', 'дрифт', 'кар', 'машин', 'car'],
  'головоломка': ['головолом', 'puzzle', 'пазл', 'логик', 'logic', 'match'],
  'аркада': ['аркад', 'arcade'],
  '3д': ['3д', '3d', 'трёхмерн', 'трехмерн'],
  'стрелялка': ['стрел', 'shoot', 'shooter', 'gun', 'fps', 'тир'],
  'платформер': ['платформ', 'platformer', 'jump', 'прыж'],
  'раннер': ['раннер', 'runner', 'беги', 'бег ', 'endless'],
  'стратегия': ['стратег', 'strategy', 'tower defense', 'башн'],
  'симулятор': ['симулятор', 'simulator', 'sim ', 'тайкун', 'tycoon'],
  'квест': ['квест', 'quest', 'adventure', 'приключен'],
  'хоррор': ['хоррор', 'horror', 'ужас', 'страш'],
  'файтинг': ['файтинг', 'fighting', 'бой', 'fight', 'драк'],
  'спорт': ['спорт', 'sport', 'футбол', 'football', 'soccer', 'баскетбол'],
  'казуальная': ['казуал', 'casual', 'клик', 'click', 'idle', 'idle'],
  'настольная': ['настольн', 'board', 'карт', 'card', 'шахмат', 'chess'],
  'выживание': ['выжива', 'survival'],
};

/**
 * Предложить теги по названию/описанию (эвристика по словарю, без внешних API).
 * @param {string} title
 * @param {string} description
 * @returns {string[]} до 8 тегов-кандидатов.
 */
export function suggestTags(title, description) {
  const hay = `${title || ''} ${description || ''}`.toLowerCase();
  const out = [];
  for (const [tag, words] of Object.entries(TAG_KEYWORDS)) {
    if (words.some((w) => hay.includes(w))) out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Преобразовать UnpackedFile ({path,bytes}) в storage.BuildFile (base64).
 * @param {UnpackedFile} file
 * @returns {import('./storage.js').BuildFile}
 */
function toBuildFile(file) {
  return { path: file.path, contentBytes: file.bytes, encoding: 'base64' };
}

/**
 * Сгенерировать компактную версию билда из текущего времени: YYYYMMDD-HHMMSS.
 * @returns {string}
 */
function makeVersion() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * #7 Прочитать каталог games.json из CATALOG_REPO через Contents API.
 * @param {object} [opts]
 * @param {string} [opts.ref] ветка/коммит (по умолчанию default branch).
 * @returns {Promise<{games: GameMeta[], sha: string}>}
 * @throws {Error} если games.json не читается/не парсится (кроме 404 → пустой каталог).
 */
export async function readCatalog(opts = {}) {
  const q = opts.ref ? `?ref=${encodeURIComponent(opts.ref)}` : '';
  let res;
  try {
    res = await authedRequest(
      'GET',
      `${GITHUB_API_BASE}/repos/${CATALOG_REPO}/contents/${CATALOG_PATH}${q}`,
    );
  } catch (e) {
    if (/\b404\b/.test(e.message)) {
      // Каталога ещё нет — стартуем с пустого (sha=null → создание файла).
      return { games: [], sha: null };
    }
    throw new Error(`Не удалось прочитать games.json: ${e.message}`);
  }

  let games;
  let version;
  try {
    const text = res.content ? decodeBase64(res.content) : '[]';
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      games = parsed;
    } else {
      games = parsed.games;
      version = parsed.version;
    }
  } catch (e) {
    throw new Error(`games.json повреждён (не парсится): ${e.message}`);
  }
  if (!Array.isArray(games)) {
    throw new Error('games.json: ожидался массив игр.');
  }
  return { games, sha: res.sha, version };
}

/**
 * Записать games.json в CATALOG_REPO (Contents API PUT) с SHA-check.
 * @param {GameMeta[]} games
 * @param {string|null} sha текущий SHA файла (null при создании).
 * @param {string} message сообщение коммита.
 * @param {number} [version] версия обёртки каталога (сохранить существующую или 1).
 * @returns {Promise<string>} новый SHA файла.
 */
async function writeCatalog(games, sha, message, version) {
  const wrapped = { version: version || 1, games };
  const body = {
    message,
    content: encodeBase64(`${JSON.stringify(wrapped, null, 2)}\n`),
  };
  if (sha) body.sha = sha;
  const res = await authedRequest(
    'PUT',
    `${GITHUB_API_BASE}/repos/${CATALOG_REPO}/contents/${CATALOG_PATH}`,
    body,
  );
  return res.content.sha;
}

/**
 * Нормализовать meta к стабильному контракту полей (порядок/дефолты).
 * @param {GameMeta} meta
 * @param {boolean} isNew новая ли запись (для dateAdded по умолчанию).
 * @returns {GameMeta}
 */
function normalizeMeta(meta, isNew) {
  const flags = meta.flags || {};
  // categories: массив 1-2 строк. Фолбэк со старого одиночного category.
  let categories;
  if (Array.isArray(meta.categories) && meta.categories.length) {
    categories = meta.categories.filter(Boolean).slice(0, 2);
  } else if (meta.category) {
    categories = [meta.category];
  } else {
    categories = [];
  }
  return {
    id: meta.id,
    title: meta.title || '',
    description: meta.description || '',
    icon: meta.icon || '',
    coverUrl: meta.coverUrl || '',
    buildUrl: meta.buildUrl || '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    categories: categories,
    platforms: Array.isArray(meta.platforms) ? meta.platforms.filter(function (p) { return p === 'pc' || p === 'mobile'; }) : [],
    controls: {
      pc: (meta.controls && meta.controls.pc) || '',
      mobile: (meta.controls && meta.controls.mobile) || '',
    },
    dateAdded: meta.dateAdded || (isNew ? new Date().toISOString().slice(0, 10) : ''),
    flags: {
      // isNew больше не хранится — вычисляется при рендере из dateAdded (≤14 дней).
      isPopular: Boolean(flags.isPopular),
      isPublished: Boolean(flags.isPublished),
    },
    orientation: meta.orientation || 'landscape',
    author: meta.author || '',
  };
}

/**
 * #7 Добавить/обновить запись игры в games.json (read-modify-write).
 * При конфликте SHA (другой коммит обогнал) — повторно читает, сливает и пишет.
 * Чужие записи не теряются (merge по id). Валидирует slug.
 *
 * @param {GameMeta} meta запись игры (meta.id = slug).
 * @returns {Promise<{games: GameMeta[], sha: string, created: boolean}>}
 * @throws {Error} при невалидном slug.
 */
export async function upsertGame(meta) {
  if (!isValidSlug(meta.id)) {
    throw new Error(`Невалидный slug "${meta.id}": разрешены только [a-z0-9-].`);
  }

  // author проставляется из ника GitHub автоматически, если не передан явно.
  if (!meta.author) {
    try {
      const login = await getViewerLogin();
      if (login) meta = { ...meta, author: login };
    } catch {
      // Ник недоступен — оставляем author пустым, не блокируем сохранение.
    }
  }

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { games, sha, version } = await readCatalog();
    const idx = games.findIndex((g) => g.id === meta.id);
    const created = idx === -1;

    const next = games.slice();
    const merged = normalizeMeta(
      created ? meta : { ...next[idx], ...meta, flags: { ...next[idx].flags, ...meta.flags } },
      created,
    );
    if (created) next.push(merged);
    else next[idx] = merged;

    try {
      const newSha = await writeCatalog(
        next,
        sha,
        `${created ? 'Add' : 'Update'} game ${meta.id} in games.json`,
        version,
      );
      return { games: next, sha: newSha, created };
    } catch (e) {
      // 409/422 = SHA устарел: чужой коммит обогнал. Перечитываем и сливаем заново.
      const isConflict = /\b409\b|\b422\b|sha/i.test(e.message);
      if (isConflict && attempt < MAX_RETRIES - 1) continue;
      throw new Error(`Не удалось сохранить games.json: ${e.message}`);
    }
  }
  // недостижимо, но для полноты
  throw new Error('Не удалось сохранить games.json: исчерпаны попытки слияния.');
}

/**
 * #6 Опубликовать билд: обфускация → коммит в BUILDS_REPO одним коммитом.
 * Путь: builds/<gameId>/<version>/. Версия = YYYYMMDD-HHMMSS.
 *
 * @param {string} gameId slug игры.
 * @param {UnpackedFile[]} files валидные файлы билда (из unpackAndValidate).
 * @param {object} [deps]
 * @param {any} [deps.obfuscator] либа javascript-obfuscator (иначе CDN).
 * @returns {Promise<{buildUrl: string, version: string, basePath: string, commitSha: string, obfuscationLog: import('./obfuscate.js').ObfuscateLogEntry[], mayBreakGame: boolean, riskyFiles: string[]}>}
 * @throws {Error} если нет файлов или коммит не удался.
 */
export async function publishBuild(gameId, files, deps = {}) {
  if (!isValidSlug(gameId)) {
    throw new Error(`Невалидный slug "${gameId}": разрешены только [a-z0-9-].`);
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Нет файлов для публикации билда.');
  }

  let obf;
  try {
    obf = await obfuscateFiles(files, { obfuscator: deps.obfuscator });
  } catch (e) {
    throw new Error(`Шаг защиты (обфускация) упал: ${e.message}`);
  }

  const version = makeVersion();
  const basePath = `builds/${gameId}/${version}`;
  const buildFiles = obf.files.map(toBuildFile);

  let commit;
  try {
    commit = await putBuild(BUILDS_REPO, basePath, buildFiles, {
      message: `Publish build ${gameId}/${version}`,
    });
  } catch (e) {
    throw new Error(`Не удалось закоммитить билд: ${e.message}`);
  }

  return {
    buildUrl: urlFor(basePath),
    version,
    basePath,
    commitSha: commit.commitSha,
    obfuscationLog: obf.log,
    mayBreakGame: obf.mayBreakGame,
    riskyFiles: obf.riskyFiles,
  };
}

/**
 * #8 Высокоуровневый оркестратор публикации игры.
 * Шаги: распаковка+валидация zip → публикация билда → запись в games.json.
 * Каждый шаг бросает понятную для UI ошибку.
 *
 * @param {object} params
 * @param {GameMeta} params.meta метаданные игры (meta.id = slug).
 * @param {File|Blob|ArrayBuffer|Uint8Array} params.zipFile загруженный zip-билд.
 * @param {object} [params.deps]
 * @param {any} [params.deps.JSZip] конструктор JSZip (иначе CDN).
 * @param {any} [params.deps.obfuscator] либа обфускатора (иначе CDN).
 * @returns {Promise<{ok: true, buildUrl: string, version: string, created: boolean, warnings: string[]}>}
 * @throws {Error} с понятным сообщением на любом проваленном шаге.
 */
export async function publishGame({ meta, zipFile, deps = {} }) {
  if (!meta || !isValidSlug(meta.id)) {
    throw new Error(`Невалидный slug "${meta && meta.id}": разрешены только [a-z0-9-].`);
  }

  // Шаг 1: распаковка + валидация.
  const { files, errors } = await unpackAndValidate(zipFile, { JSZip: deps.JSZip });
  if (errors.length > 0) {
    throw new Error(`Билд не прошёл валидацию:\n- ${errors.join('\n- ')}`);
  }

  // Шаг 2: публикация билда (обфускация + коммит).
  const build = await publishBuild(meta.id, files, { obfuscator: deps.obfuscator });

  // Шаг 3: обновить мету и записать в каталог.
  const flags = meta.flags || {};
  const enriched = {
    ...meta,
    buildUrl: build.buildUrl,
    flags: {
      ...flags,
      // По умолчанию публикуем; если форма явно передала isPublished — уважаем её.
      isPublished: flags.isPublished !== undefined ? flags.isPublished : true,
    },
  };
  const { created } = await upsertGame(enriched);

  const warnings = [];
  if (build.mayBreakGame) {
    warnings.push(
      `Обфускация могла затронуть ${build.riskyFiles.length} JS-файл(ов) — ` +
        'требуется проверка живости игры.',
    );
  }

  return { ok: true, buildUrl: build.buildUrl, version: build.version, created, warnings };
}
