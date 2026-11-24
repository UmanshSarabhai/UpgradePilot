export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function isLogLevel(value: string): value is LogLevel {
  return value in LEVEL_ORDER;
}

/** Errors serialise to `{}` with JSON.stringify, so flatten them first. */
function serialise(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? { name: value.name, message: value.message } : value;
  }
  return out;
}

/** Structured JSON logs, one object per line, picked up by Workers observability. */
export function createLogger(level: string = 'info', base: LogFields = {}): Logger {
  const minLevel = isLogLevel(level) ? level : 'info';

  const write = (logLevel: LogLevel, message: string, fields: LogFields = {}) => {
    if (LEVEL_ORDER[logLevel] < LEVEL_ORDER[minLevel]) return;
    const line = JSON.stringify({
      level: logLevel,
      message,
      time: new Date().toISOString(),
      ...base,
      ...serialise(fields),
    });
    if (logLevel === 'error') console.error(line);
    else if (logLevel === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createLogger(minLevel, { ...base, ...fields }),
  };
}
