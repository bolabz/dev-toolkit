/**
 * Gmail Toolkit — Custom Error Classes
 *
 * Two error types cover the entire surface area:
 *
 *   GmailApiError        — Layer 1 boundary: wraps raw googleapis / GaxiosError failures.
 *                          Carries an HTTP code, the operation name, and a `retryable` flag.
 *
 *   GmailValidationError — Layer 2: bad caller input (label not found, invalid ID, etc.).
 *                          These are programmer/user errors, not transient API failures.
 *
 * Usage
 *   Layer 1 (client/*):   execute() wraps all unrecognised throws → GmailApiError.
 *   Layer 2 (composed/*): throw GmailValidationError for invalid inputs; let GmailApiError
 *                         bubble unless the operation uses result-as-value semantics.
 *   Layer 3 (mcp-server): catch both types → serialise as GmailToolkitError DTO (see types.ts).
 */

// ---------------------------------------------------------------------------
// Known retryable network error codes (Node.js / libuv system errors)
// ---------------------------------------------------------------------------

/** Node.js system error codes that indicate transient network failures. */
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/** HTTP status codes that are safe to retry. */
const RETRYABLE_HTTP_CODES = new Set([429, 500, 502, 503]);

// ---------------------------------------------------------------------------
// GmailApiError
// ---------------------------------------------------------------------------

/**
 * Thrown by Layer 1 client methods when a Gmail API call fails.
 * Wraps the raw googleapis / GaxiosError into a stable, typed interface.
 *
 * Uses the native ES2022 `Error.cause` (via the options bag passed to `super`)
 * so standard tooling (stack trace formatters, `util.inspect`, Sentry) can
 * automatically chain and display the original error.
 */
export class GmailApiError extends Error {
  /** HTTP status code returned by the Gmail API (0 if unavailable). */
  readonly code: number;
  /** The Layer 1 operation that failed, e.g. `'messages.list'`. */
  readonly operation: string;
  /** True when the error is safe to retry (transient HTTP codes or network errors). */
  readonly retryable: boolean;

  /**
   * Creates a new GmailApiError wrapping the original googleapis/gaxios failure.
   * @param operation - The Gmail API operation that failed
   * @param cause - The underlying error from googleapis/gaxios
   */
  constructor(operation: string, cause: unknown) {
    const code = extractHttpCode(cause);
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`Gmail API error during ${operation}: ${msg}`, { cause });
    this.name = 'GmailApiError';
    this.code = code;
    this.operation = operation;
    this.retryable = RETRYABLE_HTTP_CODES.has(code) || isNetworkError(cause);
  }
}

// ---------------------------------------------------------------------------
// GmailValidationError
// ---------------------------------------------------------------------------

/**
 * Thrown by Layer 2 composed operations when caller-supplied input is invalid.
 * Examples: label name not found in the account, empty message ID array.
 */
export class GmailValidationError extends Error {
  /** The Layer 2 operation that rejected the input, e.g. `'modifyMessages'`. */
  readonly operation: string;
  /** The specific field or parameter that failed validation, if applicable. */
  readonly field: string | undefined;

  /**
   * Creates a new GmailValidationError describing a bad caller input.
   * @param message - Human-readable description of the validation failure
   * @param operation - The composed operation that failed validation
   * @param field - The field or parameter that failed (optional)
   */
  constructor(message: string, operation: string, field?: string) {
    super(message);
    this.name = 'GmailValidationError';
    this.operation = operation;
    this.field = field;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract an HTTP status code from an unknown thrown value.
 * GaxiosError exposes `.status` (number); some googleapis errors use `.code` (number).
 * Returns the first truthy numeric value found, or 0 if none is detectable.
 * @param err - The unknown error to inspect
 * @returns The HTTP status code, or 0 if none is detectable
 */
function extractHttpCode(err: unknown): number {
  if (err == null || typeof err !== 'object') return 0;
  const e = err as Record<string, unknown>;
  if (typeof e.status === 'number' && e.status !== 0) return e.status;
  if (typeof e.code === 'number' && e.code !== 0) return e.code;
  return 0;
}

/**
 * Detect whether the original error is a transient network failure.
 * Node.js system errors carry a string `.code` (e.g. `'ECONNRESET'`).
 * @param err - The unknown error to inspect
 * @returns True if the error represents a transient network failure
 */
function isNetworkError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const code = (err as Record<string, unknown>).code;
  return typeof code === 'string' && RETRYABLE_NETWORK_CODES.has(code);
}
