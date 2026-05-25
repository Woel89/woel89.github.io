/**
 * Шаг защиты (дизайн §4.3 / §4a): минификация+обфускация .js билда ПЕРЕД публикацией.
 * В public ngf-builds уходит только мангленный код, не читаемый исходник.
 *
 * Зависимость (javascript-obfuscator или terser) НЕ хардкодится глобально —
 * передаётся как параметр либо подгружается динамически с CDN (jsDelivr).
 * Обработка per-file в try/catch: если файл не обфусцируется — возвращаем
 * оригинал и помечаем в логе (безопасный фолбэк), не падаем.
 *
 * ВАЖНО: обфускация может ломать игру (eval-зависимый код, строгие имена,
 * Function.prototype.toString и т.п.). Реальная проверка живости — отдельный
 * шаг (Playwright, тикет 5b). Этот модуль только обрабатывает + фолбэчит и
 * возвращает список потенциально рискованных файлов.
 * @module obfuscate
 */

const OBFUSCATOR_CDN =
  'https://cdn.jsdelivr.net/npm/javascript-obfuscator@4.1.0/+esm';

/**
 * @typedef {import('./zip.js').UnpackedFile} UnpackedFile
 */

/**
 * @typedef {Object} ObfuscateLogEntry
 * @property {string} path путь файла.
 * @property {'obfuscated'|'fallback'|'skipped'} status результат обработки.
 * @property {string} [reason] причина фолбэка/пропуска.
 */

/**
 * @typedef {Object} ObfuscateResult
 * @property {UnpackedFile[]} files файлы билда (обработанные .js + остальные as-is).
 * @property {ObfuscateLogEntry[]} log журнал по каждому затронутому файлу.
 * @property {boolean} mayBreakGame true, если был хотя бы один фолбэк или
 *   обфускация применялась — сигнал, что нужна Playwright-проверка живости.
 * @property {string[]} riskyFiles пути .js, требующие проверки (обфусцированные + фолбэки).
 */

/**
 * Умеренные настройки обфускации — НЕ максимально-агрессивные,
 * чтобы снизить риск поломки игр.
 * @type {object}
 */
const MODERATE_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'mangled',
  numbersToExpressions: false,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayThreshold: 0.5,
  unicodeEscapeSequence: false,
};

/**
 * Получить либу обфускатора: переданную явно или динамический import с CDN.
 * @param {any} [obfuscatorLib] объект javascript-obfuscator (с методом obfuscate).
 * @returns {Promise<any>}
 */
async function resolveObfuscator(obfuscatorLib) {
  if (obfuscatorLib) return obfuscatorLib;
  const mod = await import(/* @vite-ignore */ OBFUSCATOR_CDN);
  return mod.default || mod;
}

/**
 * Декодировать байты в utf-8 строку.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function decode(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Закодировать строку в utf-8 байты.
 * @param {string} str
 * @returns {Uint8Array}
 */
function encode(str) {
  return new TextEncoder().encode(str);
}

/**
 * Решить, является ли <script>-тег обычным inline-JS (подлежащим обфускации).
 * Пропускаем внешние (src=...) и не-JS типы (JSON-LD, шаблоны и т.п.).
 * @param {string} attrs строка атрибутов открывающего тега.
 * @returns {boolean}
 */
function isInlineJsScript(attrs) {
  if (/\bsrc\s*=/i.test(attrs)) return false;
  const typeMatch = attrs.match(/\btype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!typeMatch) return true; // нет type → обычный JS
  const type = (typeMatch[2] || typeMatch[3] || typeMatch[4] || '').trim().toLowerCase();
  return type === '' || type === 'text/javascript' || type === 'module' || type === 'application/javascript';
}

/**
 * Обфусцировать inline <script>-блоки внутри HTML-строки.
 * Внешние (src) и не-JS типы пропускаются. Per-block try/catch с фолбэком на
 * оригинал блока — не падаем.
 * @param {string} html исходный HTML.
 * @param {any} obfuscator либа обфускатора.
 * @param {object} options настройки обфускации.
 * @returns {{html: string, obfuscated: boolean, fallback: boolean}}
 */
function obfuscateInlineScripts(html, obfuscator, options) {
  let obfuscated = false;
  let fallback = false;
  const re = /(<script\b([^>]*)>)([\s\S]*?)(<\/script\s*>)/gi;
  const result = html.replace(re, (match, open, attrs, body, close) => {
    if (!isInlineJsScript(attrs) || !body.trim()) return match;
    try {
      const r = obfuscator.obfuscate(body, options);
      const code = typeof r.getObfuscatedCode === 'function'
        ? r.getObfuscatedCode()
        : String(r);
      if (!code || !code.trim()) throw new Error('пустой результат обфускации');
      obfuscated = true;
      return `${open}${code}${close}`;
    } catch (e) {
      fallback = true;
      return match;
    }
  });
  return { html: result, obfuscated, fallback };
}

/**
 * Обфусцировать .js-файлы билда. Остальные файлы возвращаются без изменений.
 *
 * @param {UnpackedFile[]} files файлы билда (из zip.unpackAndValidate).
 * @param {object} [opts]
 * @param {any} [opts.obfuscator] либа javascript-obfuscator (иначе грузится с CDN).
 * @param {object} [opts.options] переопределение настроек обфускации.
 * @returns {Promise<ObfuscateResult>}
 */
export async function obfuscateFiles(files, opts = {}) {
  const obfuscator = await resolveObfuscator(opts.obfuscator);
  const options = { ...MODERATE_OPTIONS, ...(opts.options || {}) };

  /** @type {UnpackedFile[]} */
  const out = [];
  /** @type {ObfuscateLogEntry[]} */
  const log = [];
  /** @type {string[]} */
  const riskyFiles = [];
  let didObfuscate = false;
  let hadFallback = false;

  for (const file of files) {
    const lowerPath = file.path.toLowerCase();
    const isJs = lowerPath.endsWith('.js');
    const isHtml = lowerPath.endsWith('.html') || lowerPath.endsWith('.htm');

    if (isHtml) {
      try {
        const html = decode(file.bytes);
        const { html: outHtml, obfuscated, fallback } = obfuscateInlineScripts(
          html,
          obfuscator,
          options,
        );
        if (obfuscated || fallback) {
          const bytes = encode(outHtml);
          out.push({ ...file, bytes, size: bytes.length });
          log.push({
            path: file.path,
            status: fallback ? 'fallback' : 'obfuscated',
            ...(fallback ? { reason: 'часть inline-блоков не обфусцировалась' } : {}),
          });
          riskyFiles.push(file.path);
          if (obfuscated) didObfuscate = true;
          if (fallback) hadFallback = true;
        } else {
          out.push(file);
        }
      } catch (e) {
        out.push(file);
        log.push({ path: file.path, status: 'fallback', reason: e.message });
        riskyFiles.push(file.path);
        hadFallback = true;
      }
      continue;
    }

    if (!isJs) {
      out.push(file);
      continue;
    }

    try {
      const source = decode(file.bytes);
      const result = obfuscator.obfuscate(source, options);
      const code = typeof result.getObfuscatedCode === 'function'
        ? result.getObfuscatedCode()
        : String(result);

      if (!code || !code.trim()) {
        throw new Error('пустой результат обфускации');
      }

      const bytes = encode(code);
      out.push({ ...file, bytes, size: bytes.length });
      log.push({ path: file.path, status: 'obfuscated' });
      riskyFiles.push(file.path);
      didObfuscate = true;
    } catch (e) {
      // Безопасный фолбэк: оригинал as-is, помечаем в логе, не падаем.
      out.push(file);
      log.push({ path: file.path, status: 'fallback', reason: e.message });
      riskyFiles.push(file.path);
      hadFallback = true;
    }
  }

  return {
    files: out,
    log,
    mayBreakGame: didObfuscate || hadFallback,
    riskyFiles,
  };
}
