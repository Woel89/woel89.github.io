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
import { putBuild, putFile, getFile, urlFor, deletePath, deleteTree, getRefSha } from './storage.js';
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
 * @property {string} updatedAt ISO-timestamp последнего upsert (для cache-busting иконок/обложек).
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
 * @typedef {Object} GameEntry Обёртка v2: один slug — два необязательных слоя.
 * @property {string} id slug игры.
 * @property {GameMeta|null} published Опубликованный слой; null/отсутствует — не публиковалась.
 * @property {GameMeta|null} draft Черновик; null/отсутствует — нет pending-правок.
 */

/**
 * Нормализовать верхнеуровневую запись каталога к формату v2.
 * Legacy v1 (плоская GameMeta) автоматически оборачивается: published = meta, draft = null.
 * @param {GameEntry|GameMeta} entry
 * @returns {GameEntry}
 */
export function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return { id: '', published: null, draft: null };
  // Если у записи нет полей published/draft — это legacy v1 плоская GameMeta.
  if (!Object.prototype.hasOwnProperty.call(entry, 'published') &&
      !Object.prototype.hasOwnProperty.call(entry, 'draft')) {
    const meta = normalizeMeta(entry, false);
    return { id: meta.id, published: meta, draft: null };
  }
  return {
    id: entry.id || '',
    published: entry.published ? normalizeMeta(entry.published, false) : null,
    draft: entry.draft ? normalizeMeta(entry.draft, false) : null,
  };
}

/**
 * Получить published-слой из entry; null если не опубликована.
 * @param {GameEntry} entry
 * @returns {GameMeta|null}
 */
export function getPublished(entry) {
  return (entry && entry.published) ? entry.published : null;
}

/**
 * Получить draft-слой из entry; null если нет черновика.
 * @param {GameEntry} entry
 * @returns {GameMeta|null}
 */
export function getDraft(entry) {
  return (entry && entry.draft) ? entry.draft : null;
}

/**
 * #7 Прочитать каталог games.json из CATALOG_REPO через Contents API.
 * Поддерживает legacy v1 (плоские GameMeta) и новый v2 ({id, published, draft}).
 * @param {object} [opts]
 * @param {string} [opts.ref] ветка/коммит (по умолчанию default branch).
 * @returns {Promise<{games: GameEntry[], sha: string, version: number}>}
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
      return { games: [], sha: null, version: 2 };
    }
    throw new Error(`Не удалось прочитать games.json: ${e.message}`);
  }

  let rawGames;
  let version;
  try {
    const text = res.content ? decodeBase64(res.content) : '[]';
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      rawGames = parsed;
      version = 1;
    } else {
      rawGames = parsed.games;
      version = parsed.version || 1;
    }
  } catch (e) {
    throw new Error(`games.json повреждён (не парсится): ${e.message}`);
  }
  if (!Array.isArray(rawGames)) {
    throw new Error('games.json: ожидался массив игр.');
  }

  // Нормализовать все записи в v2-формат (legacy v1 entries оборачиваются автоматически).
  const games = rawGames.map(normalizeEntry);
  return { games, sha: res.sha, version };
}

/**
 * Записать games.json в CATALOG_REPO (Contents API PUT) с SHA-check.
 * Всегда пишет формат v2 ({version:2, games:[GameEntry]}).
 * @param {GameEntry[]} games массив записей v2.
 * @param {string|null} sha текущий SHA файла (null при создании).
 * @param {string} message сообщение коммита.
 * @returns {Promise<string>} новый SHA файла.
 */
async function writeCatalog(games, sha, message) {
  const wrapped = { version: 2, games };
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
    // updatedAt НЕ проставляется здесь — только при реальном upsert (в upsertGame).
    // Это предотвращает мутацию таймстемпов при readCatalog (read-only вызовы).
    ...(meta.updatedAt !== undefined ? { updatedAt: meta.updatedAt } : {}),
    flags: {
      // isNew больше не хранится — вычисляется при рендере из dateAdded (≤14 дней).
      isPopular: Boolean(flags.isPopular),
      isPublished: Boolean(flags.isPublished),
    },
    orientation: meta.orientation || 'landscape',
    author: meta.author || '',
    owner_id: meta.owner_id || 'woel89',
    // Пробрасываем поля, которые проставляются GitHub Actions (автоперевод/популярность).
    // upsert из кабинета не должен затирать их при отсутствии в форме.
    ...(meta.i18n !== undefined ? { i18n: meta.i18n } : {}),
    ...(meta.i18nSourceHash !== undefined ? { i18nSourceHash: meta.i18nSourceHash } : {}),
    ...(meta.popularityScore !== undefined ? { popularityScore: meta.popularityScore } : {}),
    ...(meta.statsUpdatedAt !== undefined ? { statsUpdatedAt: meta.statsUpdatedAt } : {}),
  };
}

/**
 * #7 Добавить/обновить запись игры в games.json (read-modify-write), формат v2.
 * При конфликте SHA (другой коммит обогнал) — повторно читает, сливает и пишет.
 * Чужие записи не теряются (merge по id). Валидирует slug.
 *
 * По умолчанию пишет в draft-слой (сохранение черновика).
 * Передайте opts.layer = 'published' для записи в published-слой (при promote).
 *
 * @param {GameMeta} meta метаданные игры (meta.id = slug).
 * @param {object} [opts]
 * @param {'draft'|'published'} [opts.layer='draft'] слой для записи.
 * @returns {Promise<{games: GameEntry[], sha: string, created: boolean}>}
 * @throws {Error} при невалидном slug.
 */
export async function upsertGame(meta, opts = {}) {
  const layer = opts.layer === 'published' ? 'published' : 'draft';

  if (!isValidSlug(meta.id)) {
    throw new Error(`Невалидный slug "${meta.id}": разрешены только [a-z0-9-].`);
  }

  // author и owner_id проставляются из ника GitHub автоматически, если не переданы явно.
  if (!meta.author || !meta.owner_id) {
    try {
      const login = await getViewerLogin();
      if (login) {
        meta = {
          ...meta,
          ...(!meta.author && { author: login }),
          ...(!meta.owner_id && { owner_id: login }),
        };
      }
    } catch {
      // Ник недоступен — оставляем поля пустыми, не блокируем сохранение.
    }
  }

  const MAX_RETRIES = 6;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt));
    const { games, sha } = await readCatalog();
    const idx = games.findIndex((e) => e.id === meta.id);
    const created = idx === -1;

    const next = games.slice();
    const nowIso = new Date().toISOString();
    if (created) {
      // Новая запись — создать entry с нужным слоем.
      const normalized = { ...normalizeMeta(meta, true), updatedAt: nowIso };
      const entry = { id: meta.id, published: null, draft: null };
      entry[layer] = normalized;
      next.push(entry);
    } else {
      // Существующая entry — обновить нужный слой, остальное не трогать.
      const existing = next[idx];
      const prevLayerMeta = existing[layer];
      const merged = {
        ...normalizeMeta(
          prevLayerMeta
            ? { ...prevLayerMeta, ...meta, flags: { ...prevLayerMeta.flags, ...meta.flags } }
            : meta,
          false,
        ),
        updatedAt: nowIso,
      };
      next[idx] = { ...existing, [layer]: merged };
    }

    try {
      const newSha = await writeCatalog(
        next,
        sha,
        `${created ? 'Add' : 'Update'} game ${meta.id} in games.json`,
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
 * Удалить папку целиком одним коммитом через storage.deleteTree.
 * Пустая папка / 404 не валят операцию. Ошибки не всплывают наружу.
 * @param {string} repo
 * @param {string} dirPath
 * @param {string} [message] сообщение коммита.
 * @returns {Promise<void>}
 */
async function deleteDirSilent(repo, dirPath, message) {
  try {
    await deleteTree(repo, dirPath, { message: message || `Delete ${dirPath}` });
  } catch (_) {
    // Молча игнорируем ошибки подчистки (не должны валить основную операцию).
  }
}

/**
 * Удалить один файл без ошибки при его отсутствии (404 игнорируется).
 * @param {string} repo
 * @param {string} filePath
 * @param {string} [message]
 * @returns {Promise<void>}
 */
async function deleteFileSilent(repo, filePath, message) {
  try {
    await deletePath(repo, filePath, { message: message || `Delete ${filePath}` });
  } catch (e) {
    if (!/\b404\b/.test(e.message)) {
      // Молча игнорируем (не должно валить основную операцию).
    }
  }
}

/**
 * Проверить, является ли путь относительным путём репозитория (не http-URL).
 * @param {string} p
 * @returns {boolean}
 */
function isRepoPath(p) {
  return typeof p === 'string' && p.length > 0 && !/^https?:\/\//i.test(p);
}

/**
 * Перечитать список версий билда (поддиректорий builds/<slug>/) из BUILDS_REPO.
 * Возвращает массив строк вида 'builds/<slug>/<version>' отсортированных по имени (ASC).
 * Используется для cleanup ≤2 старых версий при promote.
 * @param {string} slug
 * @returns {Promise<string[]>} пути папок версий, от старой к новой.
 */
async function listBuildVersions(slug) {
  try {
    const ref = `heads/main`;
    const baseCommitSha = await getRefSha(BUILDS_REPO, ref);
    const baseCommit = await authedRequest(
      'GET',
      `${GITHUB_API_BASE}/repos/${BUILDS_REPO}/git/commits/${baseCommitSha}`,
    );
    const treeData = await authedRequest(
      'GET',
      `${GITHUB_API_BASE}/repos/${BUILDS_REPO}/git/trees/${baseCommit.tree.sha}?recursive=1`,
    );
    const prefix = `builds/${slug}/`;
    // Собрать уникальные имена папок второго уровня (builds/<slug>/<version>)
    const versions = new Set();
    for (const item of treeData.tree || []) {
      if (!item.path.startsWith(prefix)) continue;
      // item.path = 'builds/<slug>/<version>/...' → извлечь '<version>'
      const rest = item.path.slice(prefix.length);
      const slash = rest.indexOf('/');
      const ver = slash === -1 ? rest : rest.slice(0, slash);
      if (ver) versions.add(ver);
    }
    return Array.from(versions).sort().map((v) => `builds/${slug}/${v}`);
  } catch (_) {
    return [];
  }
}

/**
 * Удалить старые билды игры, оставив не более maxKeep последних версий.
 * Удаляет по одной (deleteTree) от самой старой; ошибки подчисток игнорируются.
 * @param {string} slug
 * @param {number} maxKeep количество версий, которые ОСТАВИТЬ (не удалять).
 */
async function pruneOldBuilds(slug, maxKeep) {
  const versions = await listBuildVersions(slug);
  // versions отсортированы ASC — старые в начале
  const toDelete = versions.slice(0, Math.max(0, versions.length - maxKeep));
  for (const versionPath of toDelete) {
    await deleteDirSilent(BUILDS_REPO, versionPath, `Prune old build ${versionPath}`);
  }
}

/**
 * NGF-017: Перенести draft-ассеты (иконка/обложка с суффиксом -draft) в published-пути.
 *
 * Логика (по дизайн-доке §E):
 *  1. Если draft.icon отличается от published.icon и является путём с суффиксом -draft —
 *     перезаписать published-путь (assets/icons/<slug>.<ext>) содержимым draft-ассета через putFile.
 *     Затем удалить draft-файл.
 *     Обновить draftMeta.icon → published-путь (чтобы writeCatalog записал правильный URL).
 *  2. То же для coverUrl.
 *  3. Если draft.icon совпадает с published.icon (или published отсутствует, т.е. draft-only)
 *     — никаких переносов, возвращаем draftMeta как есть.
 *
 * Идемпотентность: если draft-файл уже удалён (предыдущий частичный promote) — deletePath
 * вернёт 404, которая молча игнорируется deleteFileSilent.
 * Если published-файл уже перезаписан — putFile перезапишет ещё раз (безвредно).
 *
 * putFile использует Git Data API (blobs→tree→commit) — SHA не требуется для записи.
 * Для чтения байт перед перезаписью используем getFile из storage.js.
 *
 * @param {string} slug
 * @param {GameMeta} draftMeta — черновик (будет мутирован: icon/coverUrl → published-пути).
 * @param {GameMeta|null} publishedMeta — текущий published-слой (null при draft-only).
 * @returns {Promise<GameMeta>} draftMeta с обновлёнными путями ассетов.
 */
async function promoteDraftAssets(slug, draftMeta, publishedMeta) {
  // Вспомогательная: получить байты файла из репо (через getFile → atob).
  async function fetchBytes(path) {
    const { raw } = await getFile(CATALOG_REPO, path);
    // raw.content — base64 с переносами строк (Contents API)
    const b64 = (raw.content || '').replace(/\n/g, '');
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  // Суффикс -draft в пути означает, что это черновой файл, отдельный от published.
  function isDraftPath(p) {
    return typeof p === 'string' && /\-draft\.[^./]+$/.test(p);
  }

  // Извлечь published-путь из draft-пути: assets/icons/<slug>-draft.ext → assets/icons/<slug>.ext
  function publishedPathFrom(draftPath) {
    return draftPath.replace(/-draft(\.[^./]+)$/, '$1');
  }

  let { icon, coverUrl } = draftMeta;

  // --- Иконка ---
  if (icon && isRepoPath(icon) && isDraftPath(icon)) {
    const targetPath = publishedPathFrom(icon);
    try {
      const bytes = await fetchBytes(icon);
      await putFile(CATALOG_REPO, targetPath, bytes, {
        message: `Promote draft icon to published for ${slug}`,
      });
    } catch (e) {
      // Если draft-файл уже не существует (предыдущий частичный promote) — продолжаем,
      // published-путь может быть уже перезаписан.
      if (!/\b404\b/.test(e.message)) throw e;
    }
    await deleteFileSilent(CATALOG_REPO, icon, `Delete draft icon for ${slug}`);
    icon = targetPath;
  }

  // --- Обложка ---
  if (coverUrl && isRepoPath(coverUrl) && isDraftPath(coverUrl)) {
    const targetPath = publishedPathFrom(coverUrl);
    try {
      const bytes = await fetchBytes(coverUrl);
      await putFile(CATALOG_REPO, targetPath, bytes, {
        message: `Promote draft cover to published for ${slug}`,
      });
    } catch (e) {
      if (!/\b404\b/.test(e.message)) throw e;
    }
    await deleteFileSilent(CATALOG_REPO, coverUrl, `Delete draft cover for ${slug}`);
    coverUrl = targetPath;
  }

  return { ...draftMeta, icon, coverUrl };
}

/**
 * Перевести draft → published для существующей записи каталога.
 *
 * Порядок операций (по дизайн-доке §F, атомарность через idempotency):
 *  Шаг 1. (NGF-017) promoteDraftAssets: перенести draft-ассеты (-draft суффикс)
 *          в published-пути; обновить пути в draftMeta перед writeCatalog.
 *  Шаг 2. upsertEntry: published = draft (с обновлёнными путями ассетов), draft = null.
 *          Retry на 409/422.
 *  Шаг 3. Чистка старых билдов: оставить текущий + ≤2 предыдущих (итого ≤3).
 *
 * Если draft отсутствует — бросает ошибку (нечего промоутить).
 * Если published отсутствует — первичная публикация (draft-only → published).
 *
 * @param {string} slug id игры ([a-z0-9-]).
 * @returns {Promise<{entry: GameEntry, buildUrl: string|null}>}
 * @throws {Error} при невалидном slug, отсутствии draft или конфликте games.json.
 */
export async function promoteGame(slug) {
  if (!isValidSlug(slug)) {
    throw new Error(`Невалидный slug "${slug}": разрешены только [a-z0-9-].`);
  }

  const MAX_RETRIES = 6;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    const { games, sha } = await readCatalog();
    const idx = games.findIndex((e) => e.id === slug);
    if (idx === -1) throw new Error(`Игра "${slug}" не найдена в каталоге.`);

    const entry = games[idx];
    if (!entry.draft) throw new Error(`У игры "${slug}" нет черновика для публикации.`);

    // Шаг 1 (NGF-017): перенести draft-ассеты в published-пути и получить обновлённый draftMeta.
    // Это идемпотентная операция: при повторном promote после сбоя — безопасно повторится.
    const promotedDraft = await promoteDraftAssets(slug, entry.draft, entry.published);

    const newPublished = normalizeMeta(
      {
        ...promotedDraft,
        // Проставить dateAdded если ещё не задан (первичная публикация)
        dateAdded: promotedDraft.dateAdded || new Date().toISOString().slice(0, 10),
      },
      false,
    );
    // Установить isPublished = true в published-слое
    newPublished.flags = { ...newPublished.flags, isPublished: true };

    const updatedEntry = { ...entry, published: newPublished, draft: null };
    const next = games.slice();
    next[idx] = updatedEntry;

    try {
      await writeCatalog(
        next,
        sha,
        `Promote draft to published for ${slug}`,
      );

      // Шаг 3: оставить текущий + 2 предыдущих = 3 версии.
      // Текущая версия уже закоммичена в BUILDS_REPO при publishGame/publishBuild ранее.
      // Здесь чистим лишние версии (от самых старых).
      await pruneOldBuilds(slug, 3);

      return { entry: updatedEntry, buildUrl: newPublished.buildUrl || null };
    } catch (e) {
      const isConflict = /\b409\b|\b422\b|sha/i.test(e.message);
      if (isConflict && attempt < MAX_RETRIES - 1) continue;
      throw new Error(`Не удалось опубликовать "${slug}": ${e.message}`);
    }
  }
  throw new Error('promoteGame: исчерпаны попытки слияния.');
}

/**
 * Отменить черновик игры: удалить draft-слой и его ассеты.
 *
 * Порядок операций:
 *  Шаг 1. upsertEntry: draft = null (published не трогается). Retry на 409/422.
 *  Шаг 2. Удалить draft-ассеты (icon и coverUrl из draft-слоя), если они отличаются
 *          от published-путей (т.е. это реальные -draft.* файлы, не унаследованные пути).
 *  Шаг 3. Удалить draft-билд папку (builds/<slug>/<draftVersion>/) если buildUrl
 *          из draft отличается от published.buildUrl.
 *
 * Если draft отсутствует — нечего отменять; возвращает без ошибки (идемпотентно).
 *
 * @param {string} slug id игры ([a-z0-9-]).
 * @returns {Promise<{entry: GameEntry, discarded: boolean}>}
 *   discarded=false если draft и так отсутствовал (уже чисто).
 * @throws {Error} при невалидном slug или конфликте games.json.
 */
export async function discardDraft(slug) {
  if (!isValidSlug(slug)) {
    throw new Error(`Невалидный slug "${slug}": разрешены только [a-z0-9-].`);
  }

  let draftMeta = null;
  let pubMeta = null;
  let updatedEntry = null;

  const MAX_RETRIES = 6;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    const { games, sha } = await readCatalog();
    const idx = games.findIndex((e) => e.id === slug);
    if (idx === -1) throw new Error(`Игра "${slug}" не найдена в каталоге.`);

    const entry = games[idx];
    if (!entry.draft) {
      // Черновика нет — идемпотентно, возвращаем как есть.
      return { entry, discarded: false };
    }

    draftMeta = entry.draft;
    pubMeta = entry.published;
    updatedEntry = { ...entry, draft: null };
    const next = games.slice();
    next[idx] = updatedEntry;

    try {
      await writeCatalog(
        next,
        sha,
        `Discard draft for ${slug}`,
      );
      break;
    } catch (e) {
      const isConflict = /\b409\b|\b422\b|sha/i.test(e.message);
      if (isConflict && attempt < MAX_RETRIES - 1) continue;
      throw new Error(`Не удалось отменить черновик "${slug}": ${e.message}`);
    }
  }

  // Шаг 2: удалить draft-ассеты только если они отличаются от published-путей.
  // (если путь совпадает — это унаследованный путь, не отдельный draft-файл)
  const pubIcon = pubMeta && pubMeta.icon;
  const pubCover = pubMeta && pubMeta.coverUrl;
  if (draftMeta.icon && draftMeta.icon !== pubIcon && isRepoPath(draftMeta.icon)) {
    await deleteFileSilent(CATALOG_REPO, draftMeta.icon, `Delete draft icon for ${slug}`);
  }
  if (draftMeta.coverUrl && draftMeta.coverUrl !== pubCover && isRepoPath(draftMeta.coverUrl)) {
    await deleteFileSilent(CATALOG_REPO, draftMeta.coverUrl, `Delete draft cover for ${slug}`);
  }

  // Шаг 3: удалить draft-билд папку если buildUrl отличается от published.
  const pubBuildUrl = pubMeta && pubMeta.buildUrl;
  if (draftMeta.buildUrl && draftMeta.buildUrl !== pubBuildUrl) {
    // Извлечь basePath из buildUrl (убрать origin и trailing slash).
    // buildUrl вида 'https://host/builds/<slug>/<version>/'
    const match = draftMeta.buildUrl.match(/\/(builds\/[^/]+\/[^/]+)\/?$/);
    if (match) {
      await deleteDirSilent(BUILDS_REPO, match[1], `Delete draft build for ${slug}`);
    }
  }

  return { entry: updatedEntry, discarded: true };
}

/**
 * Удалить игру из каталога и подчистить связанные ассеты/билд.
 *
 * Порядок операций:
 * 1. Read-modify-write games.json (retry на 409/422) — убрать запись по slug.
 *    Если запись не найдена в каталоге — продолжаем подчистку (осиротевшие файлы).
 * 2. Удалить страницу `games/<slug>/` в CATALOG_REPO.
 * 3. Удалить иконку и обложку из CATALOG_REPO (только относительные пути репо).
 * 4. Удалить `builds/<slug>/` из BUILDS_REPO.
 * Шаги 2-4 не валят всю операцию при 404 или ошибке — оборачиваются в try/catch.
 *
 * @param {string} slug id игры ([a-z0-9-]).
 * @param {object} [opts]
 * @param {string} [opts.branch='main'] ветка (для ассетов/билда).
 * @returns {Promise<{deleted: boolean, game: GameMeta|null}>}
 *   deleted=true если запись была в games.json; game — удалённая мета или null.
 * @throws {Error} при невалидном slug или неустранимом конфликте games.json.
 */
export async function deleteGame(slug, opts = {}) {
  if (!isValidSlug(slug)) {
    throw new Error(`Невалидный slug "${slug}": разрешены только [a-z0-9-].`);
  }

  // Шаг 1: убрать запись из games.json (read-modify-write с retry на 409/422).
  let deletedEntry = null;
  let wasInCatalog = false;

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { games, sha } = await readCatalog();
    const idx = games.findIndex((e) => e.id === slug);
    wasInCatalog = idx !== -1;

    if (!wasInCatalog) {
      // Записи нет в каталоге — подчистим осиротевшие файлы и выйдем.
      break;
    }

    deletedEntry = games[idx];
    const next = games.filter((e) => e.id !== slug);

    try {
      await writeCatalog(
        next,
        sha,
        `Delete game ${slug} from games.json`,
      );
      break;
    } catch (e) {
      const isConflict = /\b409\b|\b422\b|sha/i.test(e.message);
      if (isConflict && attempt < MAX_RETRIES - 1) continue;
      throw new Error(`Не удалось удалить из games.json: ${e.message}`);
    }
  }

  // Шаги 2-4: подчистка ассетов и билда. Ошибки не должны валить операцию.

  // 2. Страница игры в каталог-репо: games/<slug>/
  await deleteDirSilent(CATALOG_REPO, `games/${slug}`, `Delete game page ${slug}`);

  // 3. Иконка и обложка из каталог-репо (только если это относительные пути репо).
  // Проверяем оба слоя (published и draft) чтобы не оставлять осиротевших файлов.
  const pubMeta = deletedEntry && deletedEntry.published;
  const draftMeta = deletedEntry && deletedEntry.draft;
  const icon = (pubMeta && pubMeta.icon) || (draftMeta && draftMeta.icon);
  const cover = (pubMeta && pubMeta.coverUrl) || (draftMeta && draftMeta.coverUrl);
  const draftIcon = draftMeta && draftMeta.icon !== (pubMeta && pubMeta.icon) ? draftMeta.icon : null;
  const draftCover = draftMeta && draftMeta.coverUrl !== (pubMeta && pubMeta.coverUrl) ? draftMeta.coverUrl : null;
  if (icon && isRepoPath(icon)) {
    await deleteFileSilent(CATALOG_REPO, icon, `Delete icon for ${slug}`);
  }
  if (cover && isRepoPath(cover)) {
    await deleteFileSilent(CATALOG_REPO, cover, `Delete cover for ${slug}`);
  }
  if (draftIcon && isRepoPath(draftIcon)) {
    await deleteFileSilent(CATALOG_REPO, draftIcon, `Delete draft icon for ${slug}`);
  }
  if (draftCover && isRepoPath(draftCover)) {
    await deleteFileSilent(CATALOG_REPO, draftCover, `Delete draft cover for ${slug}`);
  }

  // 4. Билд-папка: builds/<slug>/ в BUILDS_REPO.
  await deleteDirSilent(BUILDS_REPO, `builds/${slug}`, `Delete build ${slug}`);

  return { deleted: wasInCatalog, game: deletedEntry };
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
    skippedReasons: obf.skippedReasons || [],
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
export async function publishGame({ meta, zipFile, deps = {}, layer: layerOpt } = {}) {
  if (!meta || !isValidSlug(meta.id)) {
    throw new Error(`Невалидный slug "${meta && meta.id}": разрешены только [a-z0-9-].`);
  }
  // layer: 'published' по умолчанию (прямая публикация); 'draft' для saveDraft-с-билдом.
  const layer = layerOpt === 'draft' ? 'draft' : 'published';

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
      isPublished: layer === 'published'
        ? (flags.isPublished !== undefined ? flags.isPublished : true)
        : false,
    },
  };
  const { created } = await upsertGame(enriched, { layer });

  const warnings = [];
  if (build.skippedReasons && build.skippedReasons.length > 0) {
    for (const reason of build.skippedReasons) {
      warnings.push(`Обфускация пропущена (риск поломки игры): ${reason}`);
    }
  } else if (build.mayBreakGame) {
    warnings.push(
      `Обфускация могла затронуть ${build.riskyFiles.length} JS-файл(ов) — ` +
        'требуется проверка живости игры.',
    );
  }

  return { ok: true, buildUrl: build.buildUrl, version: build.version, created, warnings };
}
