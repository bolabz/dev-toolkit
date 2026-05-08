/**
 * Gmail Toolkit — Logger
 *
 * Lightweight singleton logger that writes exclusively to stderr,
 * ensuring MCP protocol traffic on stdout is never corrupted.
 *
 * Modeled after pino's child-logger pattern and debug's env-var control:
 *   - Root singleton created at module load
 *   - Child loggers via logger.child('component') — linked to root level
 *   - GMAIL_LOG_LEVEL env var controls verbosity (default: 'info')
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported log verbosity levels, from most to least verbose. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const LEVEL_LABELS: Record<Exclude<LogLevel, 'silent'>, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Lightweight logger that writes exclusively to stderr.
 * Use the module-level `logger` singleton or create children via `.child()`.
 */
export class Logger {
  private readonly root: Logger;
  private readonly prefix: string;
  private level: LogLevel; // only meaningful on root instance

  /**
   * Create a Logger instance. Prefer using the module-level `logger` singleton
   * or `.child()` rather than calling this directly.
   * @param options - Optional configuration for prefix, level, and root reference
   * @param options.prefix - The log line prefix (defaults to 'gmail-toolkit')
   * @param options.level - The minimum log level (defaults to env var or 'info')
   * @param options.root - Parent logger reference for child loggers
   * @internal
   */
  constructor(options?: { prefix?: string; level?: LogLevel; root?: Logger }) {
    this.prefix = options?.prefix ?? 'gmail-toolkit';
    this.root = options?.root ?? this;
    this.level = options?.root
      ? options.root.level // child inherits (but delegates at log time)
      : (options?.level ?? resolveLogLevel());
  }

  // -------------------------------------------------------------------------
  // Log methods
  // -------------------------------------------------------------------------

  /**
   * Emit a debug-level message to stderr.
   * @param message - The log message text
   * @param args - Additional values to log alongside the message
   */
  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, args);
  }

  /**
   * Emit an info-level message to stderr.
   * @param message - The log message text
   * @param args - Additional values to log alongside the message
   */
  info(message: string, ...args: unknown[]): void {
    this.log('info', message, args);
  }

  /**
   * Emit a warn-level message to stderr.
   * @param message - The log message text
   * @param args - Additional values to log alongside the message
   */
  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, args);
  }

  /**
   * Emit an error-level message to stderr.
   * @param message - The log message text
   * @param args - Additional values to log alongside the message
   */
  error(message: string, ...args: unknown[]): void {
    this.log('error', message, args);
  }

  // -------------------------------------------------------------------------
  // Child loggers
  // -------------------------------------------------------------------------

  /**
   * Create a child logger with an extended prefix.
   * Children delegate level checks to the root — changing the root level
   * immediately affects all children.
   * @param name - The component name appended to the prefix (e.g. 'auth' → 'gmail-toolkit:auth')
   * @returns A new Logger instance with the extended prefix
   */
  child(name: string): Logger {
    return new Logger({
      prefix: `${this.prefix}:${name}`,
      root: this.root,
    });
  }

  // -------------------------------------------------------------------------
  // Level control
  // -------------------------------------------------------------------------

  /**
   * Change the log level at runtime. Affects root and all children.
   * @param level - The new minimum log level
   */
  setLevel(level: LogLevel): void {
    this.root.level = level;
  }

  /**
   * Retrieve the current log level from the root logger.
   * @returns The active log level
   */
  getLevel(): LogLevel {
    return this.root.level;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private log(level: Exclude<LogLevel, 'silent'>, message: string, args: unknown[]): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.root.level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const label = LEVEL_LABELS[level];
    const prefix = `${timestamp} [${this.prefix}] ${label}`;

    console.error(prefix, message, ...args);
  }
}

// ---------------------------------------------------------------------------
// Env var resolution
// ---------------------------------------------------------------------------

function resolveLogLevel(): LogLevel {
  const env = process.env.GMAIL_LOG_LEVEL?.toLowerCase();
  if (env != null && env in LEVEL_PRIORITY) {
    return env as LogLevel;
  }
  return 'info';
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** Root logger singleton — import and use directly or create children via `.child()`. */
export const logger = new Logger();
