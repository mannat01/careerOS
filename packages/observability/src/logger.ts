/**
 * Structured JSON logger with PII redaction (coding-standards.md §6: "no PII in logs").
 * Redaction is defense-in-depth: keys with sensitive names are masked and email-shaped
 * strings are scrubbed from values, recursively.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  msg: string;
  time: string;
  [key: string]: unknown;
}

export interface LogSink {
  write(entry: LogEntry): void;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN =
  /(^|_|\b)(email|e-mail|phone|password|secret|token|authorization|api[-_]?key|auth[-_]?provider[-_]?id|ssn|full[-_]?name|first[-_]?name|last[-_]?name|address|salary)(s)?($|_|\b)/i;

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED; // fail closed on absurd nesting
  if (typeof value === 'string') return value.replace(EMAIL_PATTERN, REDACTED);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Default sink: single-line JSON to stdout. */
export const stdoutSink: LogSink = {
  write(entry: LogEntry): void {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  },
};

export function createLogger(opts?: {
  sink?: LogSink;
  base?: Record<string, unknown>;
  clock?: () => Date;
}): Logger {
  const sink = opts?.sink ?? stdoutSink;
  const base = opts?.base ?? {};
  const clock = opts?.clock ?? ((): Date => new Date());

  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    const safe = redact({ ...base, ...fields }) as Record<string, unknown>;
    sink.write({ ...safe, level, msg: redact(msg) as string, time: clock().toISOString() });
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (bindings) => createLogger({ sink, base: { ...base, ...bindings }, clock }),
  };
}
