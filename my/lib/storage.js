/**
 * Storage-адаптер кабинета поверх GitHub Git Data API (дизайн §7: put/get/url/delete).
 * Один публикуемый билд = один атомарный коммит (blobs → tree → commit → ref).
 * В Фазе 2 интерфейс остаётся, реализация уезжает на S3/ФС.
 * @module storage
 */

import { authedRequest } from './auth.js';
import { BUILDS_REPO, BUILDS_BASE_URL, GITHUB_API_BASE } from './config.js';

/**
 * @typedef {Object} BuildFile
 * @property {string} path путь файла относительно basePath (например 'index.html', 'assets/x.png').
 * @property {Uint8Array} [contentBytes] бинарное содержимое (для encoding 'base64').
 * @property {string}     [contentText]  текстовое содержимое (для encoding 'utf-8').
 * @property {'utf-8'|'base64'} encoding способ кодирования при создании blob.
 */

/**
 * Закодировать Uint8Array в base64 (без зависимости от Buffer, браузерный путь).
 * @param {Uint8Array} bytes
 * @returns {string} base64-строка.
 */
function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Создать blob в репозитории.
 * @param {string} repo 'owner/name'.
 * @param {BuildFile} file
 * @returns {Promise<string>} SHA созданного blob.
 */
async function createBlob(repo, file) {
  let content;
  let encoding;
  if (file.encoding === 'base64') {
    content = bytesToBase64(file.contentBytes);
    encoding = 'base64';
  } else {
    content = file.contentText;
    encoding = 'utf-8';
  }
  const res = await authedRequest(
    'POST',
    `${GITHUB_API_BASE}/repos/${repo}/git/blobs`,
    { content, encoding },
  );
  return res.sha;
}

/**
 * Получить SHA, на который указывает ref ветки.
 * @param {string} repo
 * @param {string} ref например 'heads/main'.
 * @returns {Promise<string>}
 */
async function getRefSha(repo, ref) {
  const res = await authedRequest('GET', `${GITHUB_API_BASE}/repos/${repo}/git/ref/${ref}`);
  return res.object.sha;
}

/**
 * Закоммитить набор файлов билда ОДНИМ коммитом через Git Data API.
 * Шаги: blobs → tree (на базе HEAD) → commit → update ref.
 *
 * @param {string} repo репозиторий билдов ('owner/name'); по умолчанию BUILDS_REPO.
 * @param {string} basePath префикс пути в репо, напр. 'builds/<gameId>/<version>'.
 * @param {BuildFile[]} files файлы билда (пути относительны basePath).
 * @param {object} [opts]
 * @param {string} [opts.branch='main'] целевая ветка.
 * @param {string} [opts.message] сообщение коммита.
 * @returns {Promise<{commitSha: string, url: string}>} SHA коммита и публичный URL билда.
 */
export async function putBuild(repo = BUILDS_REPO, basePath, files, opts = {}) {
  const branch = opts.branch || 'main';
  const ref = `heads/${branch}`;
  const message = opts.message || `Publish build ${basePath}`;

  // Блобы контент-адресные (sha по содержимому) — создаём один раз вне ретрая.
  const tree = [];
  for (const file of files) {
    const sha = await createBlob(repo, file);
    const cleanBase = basePath.replace(/\/+$/, '');
    const cleanPath = file.path.replace(/^\/+/, '');
    tree.push({
      path: `${cleanBase}/${cleanPath}`,
      mode: '100644',
      type: 'blob',
      sha,
    });
  }

  // Tree → commit → update ref на текущем HEAD. Если ветку обогнал чужой коммит
  // (Actions build-catalog/translate в этом же репо) → 422 "not a fast forward":
  // перечитываем HEAD и пересобираем коммит на свежей базе.
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const baseCommitSha = await getRefSha(repo, ref);
    const baseCommit = await authedRequest(
      'GET',
      `${GITHUB_API_BASE}/repos/${repo}/git/commits/${baseCommitSha}`,
    );

    const newTree = await authedRequest(
      'POST',
      `${GITHUB_API_BASE}/repos/${repo}/git/trees`,
      { base_tree: baseCommit.tree.sha, tree },
    );

    const commit = await authedRequest(
      'POST',
      `${GITHUB_API_BASE}/repos/${repo}/git/commits`,
      { message, tree: newTree.sha, parents: [baseCommitSha] },
    );

    try {
      await authedRequest(
        'PATCH',
        `${GITHUB_API_BASE}/repos/${repo}/git/refs/${ref}`,
        { sha: commit.sha, force: false },
      );
      return { commitSha: commit.sha, url: urlFor(basePath) };
    } catch (e) {
      // 422/fast forward = HEAD сместился между чтением и обновлением ref.
      const moved = /\b422\b|fast.?forward/i.test(e.message);
      if (moved && attempt < MAX_RETRIES - 1) continue;
      throw e;
    }
  }
  // недостижимо
  throw new Error('putBuild: исчерпаны попытки обновления ветки.');
}

/**
 * Записать ОДИН бинарный файл по полному пути одним коммитом (Git Data API).
 * Обёртка над putBuild: basePath = директория, файл = имя.
 * @param {string} repo 'owner/name'.
 * @param {string} path полный путь в репо, напр. 'assets/icons/foo.webp'.
 * @param {Uint8Array} bytes бинарное содержимое.
 * @param {object} [opts]
 * @param {string} [opts.branch='main']
 * @param {string} [opts.message]
 * @returns {Promise<{commitSha: string, url: string}>}
 */
export async function putFile(repo, path, bytes, opts = {}) {
  const clean = path.replace(/^\/+/, '');
  const slash = clean.lastIndexOf('/');
  const dir = slash === -1 ? '' : clean.slice(0, slash);
  const name = slash === -1 ? clean : clean.slice(slash + 1);
  return putBuild(
    repo,
    dir,
    [{ path: name, contentBytes: bytes, encoding: 'base64' }],
    { branch: opts.branch, message: opts.message || `Add ${clean}` },
  );
}

/**
 * Прочитать файл из репозитория (Contents API). Текст декодируется из base64.
 * @param {string} repo
 * @param {string} path полный путь в репо.
 * @param {object} [opts]
 * @param {string} [opts.ref] ветка/коммит/тег.
 * @returns {Promise<{sha: string, text: string, raw: object}>}
 */
export async function getFile(repo = BUILDS_REPO, path, opts = {}) {
  const q = opts.ref ? `?ref=${encodeURIComponent(opts.ref)}` : '';
  const res = await authedRequest(
    'GET',
    `${GITHUB_API_BASE}/repos/${repo}/contents/${path}${q}`,
  );
  const text = res.content ? atob(res.content.replace(/\n/g, '')) : '';
  return { sha: res.sha, text, raw: res };
}

/**
 * Удалить один файл по пути (Contents API; требует его SHA).
 * Для удаления целой папки одним коммитом используйте putBuild с новым tree.
 * @param {string} repo
 * @param {string} path полный путь в репо.
 * @param {object} [opts]
 * @param {string} [opts.branch='main']
 * @param {string} [opts.message]
 * @returns {Promise<any>}
 */
export async function deletePath(repo = BUILDS_REPO, path, opts = {}) {
  const branch = opts.branch || 'main';
  const { sha } = await getFile(repo, path, { ref: branch });
  return authedRequest(
    'DELETE',
    `${GITHUB_API_BASE}/repos/${repo}/contents/${path}`,
    { message: opts.message || `Delete ${path}`, sha, branch },
  );
}

/**
 * Публичный URL билда по его basePath.
 * Origin берётся из config.BUILDS_BASE_URL (абстрактный хост).
 * @param {string} basePath напр. 'builds/<gameId>/<version>'.
 * @returns {string} напр. 'https://netgameforge.com/ngf-builds/builds/<id>/<ver>/'.
 */
export function urlFor(basePath) {
  const base = BUILDS_BASE_URL.replace(/\/+$/, '');
  const rel = basePath.replace(/^\/+|\/+$/g, '');
  return `${base}/${rel}/`;
}
