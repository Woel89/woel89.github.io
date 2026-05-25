/**
 * Распаковка и валидация загруженного zip-билда (дизайн §4.1–4.2).
 * Зависит от JSZip; либа НЕ хардкодится глобально — передаётся как параметр
 * либо подгружается динамически с CDN (jsDelivr).
 * @module zip
 */

import {
  MAX_UNPACKED_BYTES,
  MAX_FILES,
  ALLOWED_EXTENSIONS,
  BLOCKED_EXTENSIONS,
  MAX_COMPRESSION_RATIO,
} from './config.js';

const JSZIP_CDN = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

/**
 * @typedef {Object} UnpackedFile
 * @property {string} path путь относительно корня билда (forward slashes).
 * @property {Uint8Array} bytes содержимое файла.
 * @property {number} size размер распакованного файла в байтах.
 */

/**
 * @typedef {Object} UnpackResult
 * @property {UnpackedFile[]} files валидные файлы билда (готовы к публикации).
 * @property {string[]} errors список ошибок валидации; непустой = билд отклонён.
 */

/**
 * Получить экземпляр JSZip: переданный явно или динамический import с CDN.
 * @param {any} [JSZipLib] конструктор JSZip (если уже подключён страницей).
 * @returns {Promise<any>}
 */
async function resolveJSZip(JSZipLib) {
  if (JSZipLib) return JSZipLib;
  const mod = await import(/* @vite-ignore */ JSZIP_CDN);
  return mod.default || mod;
}

/**
 * Расширение файла в lowercase без точки.
 * @param {string} path
 * @returns {string}
 */
function extOf(path) {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i + 1).toLowerCase() : '';
}

/**
 * Опасен ли путь (zip-slip): '..', абсолютный, бэкслэши.
 * @param {string} path
 * @returns {boolean}
 */
function isUnsafePath(path) {
  if (path.includes('\\')) return true;
  if (path.startsWith('/')) return true;
  if (/^[a-zA-Z]:/.test(path)) return true; // C:\...
  const parts = path.split('/');
  return parts.some((p) => p === '..');
}

/**
 * Заблокировано ли имя/расширение (php/exe/sh/bat/.htaccess/.git*).
 * @param {string} path
 * @returns {boolean}
 */
function isBlockedName(path) {
  const name = path.split('/').pop().toLowerCase();
  if (name === '.htaccess') return true;
  if (name.startsWith('.git')) return true;
  if (BLOCKED_EXTENSIONS.includes(extOf(name))) return true;
  return false;
}

/**
 * Распаковать и провалидировать zip-билд.
 * Валидация: zip-slip, zip-bomb (размер/число файлов/ratio), whitelist
 * расширений, блок опасных файлов, обязательный index.html в корне
 * (единственная верхняя папка разворачивается в корень).
 *
 * @param {File|Blob|ArrayBuffer|Uint8Array} file загруженный zip.
 * @param {object} [opts]
 * @param {any} [opts.JSZip] конструктор JSZip (иначе грузится с CDN).
 * @returns {Promise<UnpackResult>}
 */
export async function unpackAndValidate(file, opts = {}) {
  const errors = [];
  const JSZip = await resolveJSZip(opts.JSZip);

  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    return { files: [], errors: [`Не удалось прочитать zip: ${e.message}`] };
  }

  /** @type {Array<{path: string, entry: any}>} */
  const entries = [];
  zip.forEach((relPath, entry) => {
    if (!entry.dir) entries.push({ path: relPath, entry });
  });

  if (entries.length === 0) {
    return { files: [], errors: ['Архив пуст.'] };
  }
  if (entries.length > MAX_FILES) {
    errors.push(`Слишком много файлов: ${entries.length} > ${MAX_FILES}.`);
  }

  // Определить единственную верхнюю папку для разворачивания в корень.
  const topSegments = new Set(
    entries.map((e) => (e.path.includes('/') ? e.path.split('/')[0] : '')),
  );
  const onlyTopFolder =
    topSegments.size === 1 && !topSegments.has('') ? [...topSegments][0] : null;

  /** @type {UnpackedFile[]} */
  const files = [];
  let totalBytes = 0;

  for (const { path, entry } of entries) {
    if (isUnsafePath(path)) {
      errors.push(`Небезопасный путь (zip-slip): ${path}`);
      continue;
    }
    if (isBlockedName(path)) {
      errors.push(`Запрещённый файл: ${path}`);
      continue;
    }
    const ext = extOf(path);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      errors.push(`Расширение вне whitelist: ${path}`);
      continue;
    }

    const bytes = await entry.async('uint8array');
    const size = bytes.length;
    totalBytes += size;

    if (totalBytes > MAX_UNPACKED_BYTES) {
      errors.push(
        `Превышен лимит распакованного размера (${MAX_UNPACKED_BYTES} байт).`,
      );
      break;
    }

    // zip-bomb ratio: распакованный/сжатый для конкретной записи.
    const compressed =
      entry._data && typeof entry._data.compressedSize === 'number'
        ? entry._data.compressedSize
        : 0;
    if (compressed > 0 && size / compressed > MAX_COMPRESSION_RATIO) {
      errors.push(
        `Подозрительный коэффициент сжатия (zip-bomb): ${path} (${Math.round(
          size / compressed,
        )}x).`,
      );
      continue;
    }

    let normPath = path;
    if (onlyTopFolder) {
      normPath = path.slice(onlyTopFolder.length + 1); // срезать 'folder/'
    }

    files.push({ path: normPath, bytes, size });
  }

  // Обязателен index.html в корне (после разворачивания папки).
  const hasRootIndex = files.some((f) => f.path === 'index.html');
  if (!hasRootIndex && errors.length === 0) {
    errors.push('Нет index.html в корне билда.');
  }

  return { files, errors };
}
