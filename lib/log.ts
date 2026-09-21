/**
 * Application logging.
 *
 * Deliberately narrow: a message and a bag of scalars. There is no way to pass an object
 * through this that might carry an image, a raw OCR string, or a free-text note, because
 * the type will not allow it. That is the enforcement — not a review convention.
 *
 * If you find yourself wanting to log what the model read, log its LENGTH.
 */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

/** Never logged under any name. */
const CREDENTIAL = /password|secret|token|apikey|authorization/i;

/** Content-bearing names: the value could be evidence or free text. */
const CONTENT = /text|image|photo|body|prompt|note|comment|transcript|reason|message/i;

/**
 * A measurement OF content rather than the content itself. `rawTextLength` and
 * `imageKey` are exactly the fields that make a bad read debuggable without ever putting
 * what the model read into a log line.
 */
const MEASUREMENT = /(length|bytes|count|size|key|id|code)$/i;

export function redactKey(key: string): boolean {
  // Strip separators first, so API_KEY and apiKey are the same name to this check.
  const flat = key.replace(/[^a-z0-9]/gi, '');
  if (CREDENTIAL.test(flat)) return true;
  if (!CONTENT.test(flat)) return false;
  return !MEASUREMENT.test(flat);
}

function safeFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = redactKey(key) ? '[redacted]' : value;
  }
  return out;
}

function emit(level: 'info' | 'warn' | 'error', message: string, fields: LogFields): void {
  const line = { level, message, ...safeFields(fields), at: new Date().toISOString() };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export const log = {
  info: (message: string, fields: LogFields = {}) => emit('info', message, fields),
  warn: (message: string, fields: LogFields = {}) => emit('warn', message, fields),
  error: (message: string, fields: LogFields = {}) => emit('error', message, fields),
};
