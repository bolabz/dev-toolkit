/**
 * Gmail Toolkit — Authentication Module
 *
 * Provides seamless OAuth 2.0 authentication for the Gmail API.
 * Handles all auth states transparently: load existing token, auto-refresh,
 * or launch interactive browser consent flow.
 *
 * Works identically in library mode and MCP server mode.
 */

import { OAuth2Client } from 'google-auth-library';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import open from 'open';
import { logger } from './logger.js';

const log = logger.child('auth');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.settings.basic',
];

// ---------------------------------------------------------------------------
// Default Paths — resolved from environment variables
// ---------------------------------------------------------------------------

const DEFAULT_CREDENTIALS_PATH = process.env.GMAIL_CREDENTIALS_PATH ?? './credentials.json';
const DEFAULT_TOKEN_PATH = process.env.GMAIL_TOKEN_PATH ?? './token.json';

/** Fallback OAuth loopback port, used when GMAIL_OAUTH_PORT is unset or invalid. */
const DEFAULT_REDIRECT_PORT = 3000;

const REDIRECT_PORT = resolveRedirectPort();
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;
const AUTH_TIMEOUT_MS = 120_000; // 2 minutes to complete browser consent

/**
 * Resolve the OAuth loopback redirect port from the `GMAIL_OAUTH_PORT`
 * environment variable, falling back to the default (3000) when it is unset or
 * not a valid TCP port (an integer in the range 1–65535).
 *
 * The callback server always binds to loopback (127.0.0.1) regardless of this
 * value, so overriding the port never widens network exposure — it only avoids
 * collisions when the default port is already in use by another process.
 * @returns A valid TCP port number to bind the OAuth callback server to
 */
function resolveRedirectPort(): number {
  const raw = process.env.GMAIL_OAUTH_PORT?.trim();
  if (raw === undefined || raw === '') {
    return DEFAULT_REDIRECT_PORT;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    log.warn(
      `Invalid GMAIL_OAUTH_PORT="${raw}" — expected an integer in 1–65535. ` +
        `Falling back to port ${DEFAULT_REDIRECT_PORT}.`,
    );
    return DEFAULT_REDIRECT_PORT;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Credentials file shape (downloaded from Google Cloud Console)
// ---------------------------------------------------------------------------

interface InstalledCredentials {
  installed: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
    project_id?: string;
    auth_uri?: string;
    token_uri?: string;
  };
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options for `ensureAuthenticated`.
 * @public
 */
export interface AuthOptions {
  /**
   * Allow interactive browser-based OAuth consent flow.
   * When `false` (default), throws `AuthenticationRequiredError` if no valid
   * token is available. When `true`, opens a browser for Google sign-in.
   *
   * Only `setup-auth` should set this to `true`.
   */
  interactive?: boolean;
}

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/**
 * Result of `beginAuthFlow` — provides the OAuth URL for the user and
 * a promise that resolves when the user completes browser consent.
 * @public
 */
export interface PendingAuth {
  /** Google OAuth consent URL for the user to visit. */
  readonly url: string;
  /** Resolves when the user completes consent and the token is saved to disk. */
  readonly completed: Promise<void>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensures we have a valid, authenticated OAuth2 client.
 *
 * Auth state machine:
 *   1. No credentials.json → throw with step-by-step setup instructions
 *   2. Token exists, refresh valid → silent auto-refresh (invisible, ~100ms)
 *   3. Token exists, refresh invalid → throw (or launch browser if interactive)
 *   4. No token.json → throw (or launch browser if interactive)
 * @param credentialsPath - Path to Google OAuth credentials.json (default: GMAIL_CREDENTIALS_PATH env var or ./credentials.json)
 * @param tokenPath - Path to stored token.json (default: GMAIL_TOKEN_PATH env var or ./token.json)
 * @param options - Authentication options (interactive mode, etc.)
 * @returns Authenticated OAuth2Client ready for Gmail API calls
 * @public
 */
export async function ensureAuthenticated(
  credentialsPath: string = DEFAULT_CREDENTIALS_PATH,
  tokenPath: string = DEFAULT_TOKEN_PATH,
  options: AuthOptions = {},
): Promise<OAuth2Client> {
  const { interactive = false } = options;

  // 1. credentials.json MUST exist — cannot be auto-generated
  const resolvedCredPath = path.resolve(credentialsPath);
  if (!fs.existsSync(resolvedCredPath)) {
    if (interactive) {
      await openCredentialsConsole();
    }
    throw new MissingCredentialsError(resolvedCredPath);
  }

  const oauth2 = createOAuth2Client(resolvedCredPath);
  const resolvedTokenPath = path.resolve(tokenPath);

  // 2. Try loading existing token
  if (fs.existsSync(resolvedTokenPath)) {
    try {
      const tokenData = JSON.parse(fs.readFileSync(resolvedTokenPath, 'utf-8')) as Record<
        string,
        unknown
      >;
      oauth2.setCredentials(tokenData);
      await oauth2.getAccessToken(); // forces refresh if expired
      return oauth2;
    } catch (err: unknown) {
      if (isInvalidGrant(err)) {
        if (!interactive) {
          throw new AuthenticationRequiredError(resolvedTokenPath, true);
        }
        log.warn('Saved authorization has expired. Re-authenticating...');
        // Fall through to browser flow
      } else {
        throw err;
      }
    }
  }

  // 3. No valid token — require interactive mode for browser flow
  if (!interactive) {
    throw new AuthenticationRequiredError(resolvedTokenPath, false);
  }

  return await browserAuthFlow(oauth2, resolvedTokenPath);
}

/**
 * Start a headless OAuth flow without opening a browser.
 *
 * Returns the consent URL immediately (for the caller to surface to the user)
 * and a promise that resolves once the user completes browser consent and the
 * token is persisted to disk. Used by the MCP server to provide self-service
 * authentication through tool responses.
 * @param credentialsPath - Path to Google OAuth credentials.json (default: GMAIL_CREDENTIALS_PATH env var or ./credentials.json)
 * @param tokenPath - Path where the OAuth token will be stored (default: GMAIL_TOKEN_PATH env var or ./token.json)
 * @returns The OAuth URL and a completion promise
 * @public
 */
export function beginAuthFlow(
  credentialsPath: string = DEFAULT_CREDENTIALS_PATH,
  tokenPath: string = DEFAULT_TOKEN_PATH,
): PendingAuth {
  const resolvedCredPath = path.resolve(credentialsPath);
  if (!fs.existsSync(resolvedCredPath)) {
    throw new MissingCredentialsError(resolvedCredPath);
  }

  const oauth2 = createOAuth2Client(resolvedCredPath);
  const resolvedTokenPath = path.resolve(tokenPath);

  const expectedState = crypto.randomBytes(32).toString('hex');
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: expectedState,
  });

  const completed = (async () => {
    const code = await waitForRedirect(expectedState);
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    const tokenDir = path.dirname(resolvedTokenPath);
    if (!fs.existsSync(tokenDir)) {
      fs.mkdirSync(tokenDir, { recursive: true });
    }
    writeTokenFile(resolvedTokenPath, tokens);
    log.info('Authentication successful. Token saved.');
  })();

  return { url, completed };
}

// ---------------------------------------------------------------------------
// OAuth2 Client Factory
// ---------------------------------------------------------------------------

function createOAuth2Client(credentialsPath: string): OAuth2Client {
  const raw = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8')) as InstalledCredentials;

  const { client_id, client_secret } = raw.installed;
  return new OAuth2Client(client_id, client_secret, REDIRECT_URI);
}

// ---------------------------------------------------------------------------
// Browser Auth Flow
// ---------------------------------------------------------------------------

async function browserAuthFlow(oauth2: OAuth2Client, tokenPath: string): Promise<OAuth2Client> {
  const expectedState = crypto.randomBytes(32).toString('hex');
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // ensures we always get a refresh token
    state: expectedState,
  });

  log.info('Authentication required. Opening browser for Google sign-in...');
  log.info(`If browser doesn't open, visit:\n${authUrl}`);

  // Open browser (cross-platform via 'open' package)
  await open(authUrl);

  // Wait for OAuth redirect on localhost (validates state to prevent CSRF)
  const code = await waitForRedirect(expectedState);

  // Exchange code for tokens
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  // Persist token for future use
  const tokenDir = path.dirname(tokenPath);
  if (!fs.existsSync(tokenDir)) {
    fs.mkdirSync(tokenDir, { recursive: true });
  }
  writeTokenFile(tokenPath, tokens);
  log.info('Authentication successful. Token saved.');

  return oauth2;
}

/**
 * Persist the OAuth token JSON with restrictive (0600) file permissions.
 *
 * The token contains a long-lived refresh token that grants full Gmail access.
 * Setting both the create-mode and an explicit chmod handles the case where
 * the file already exists (writeFileSync's `mode` option only applies on
 * creation), guaranteeing other local users on the machine cannot read it.
 * @param tokenPath - Absolute filesystem path where the token JSON is written
 * @param tokens - OAuth token payload (access/refresh tokens) to serialize
 */
function writeTokenFile(tokenPath: string, tokens: unknown): void {
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  fs.chmodSync(tokenPath, 0o600);
}

// ---------------------------------------------------------------------------
// Localhost Redirect Server
// ---------------------------------------------------------------------------

/**
 * Starts a temporary HTTP server on the loopback interface to capture the
 * OAuth redirect. The server is bound to 127.0.0.1 so it cannot be reached
 * from other devices on the local network, and the redirect's `state`
 * parameter is validated against `expectedState` (constant-time comparison)
 * to prevent CSRF and code-injection from a phished link.
 *
 * The server automatically shuts down after a successful capture or timeout.
 * @param expectedState - Random state value generated when the auth URL was created
 * @returns The authorization code from the OAuth redirect
 */
function waitForRedirect(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${REDIRECT_PORT}`);

      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const receivedState = url.searchParams.get('state') ?? '';
      if (!safeEqual(receivedState, expectedState)) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(authResultPage(false, 'OAuth state mismatch — request rejected for your safety.'));
        cleanup();
        reject(new Error('OAuth state mismatch — possible CSRF, request rejected'));
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error != null) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(authResultPage(false, `Authorization denied: ${error}`));
        cleanup();
        reject(new Error(`OAuth authorization denied: ${error}`));
        return;
      }

      if (code == null) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(authResultPage(false, 'No authorization code received.'));
        cleanup();
        reject(new Error('No authorization code in OAuth redirect'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        authResultPage(true, 'Gmail Toolkit authorized successfully! You can close this tab.'),
      );
      cleanup();
      resolve(code);
    });

    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `OAuth authorization timed out after ${AUTH_TIMEOUT_MS / 1000}s. ` + 'Please try again.',
        ),
      );
    }, AUTH_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeout);
      server.close();
    }

    // Bind to loopback only — never listen on 0.0.0.0/:: so other devices on
    // the LAN cannot race the OAuth callback with an injected code.
    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      // Server ready — browser should redirect here
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${REDIRECT_PORT} is in use. Close the application using it and try again.`,
          ),
        );
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Constant-time string comparison to prevent timing-based state oracle attacks.
 * Falls back to false on length mismatch (Buffer.from + timingSafeEqual requires
 * equal-length buffers).
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns True iff the strings are byte-for-byte equal
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Auth Result Page (shown in browser after consent)
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function authResultPage(success: boolean, message: string): string {
  const color = success ? '#1a7f37' : '#cf222e';
  const icon = success ? '&#10003;' : '&#10007;';
  const safeMessage = escapeHtml(message);
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head><title>Gmail Toolkit — Authorization</title></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #fafbfc;">
      <div style="text-align: center; padding: 2rem;">
        <div style="font-size: 3rem; color: ${color};">${icon}</div>
        <h1 style="color: ${color}; margin: 0.5rem 0;">${success ? 'Authorized' : 'Authorization Failed'}</h1>
        <p style="color: #57606a; font-size: 1.1rem;">${safeMessage}</p>
      </div>
    </body>
    </html>
  `;
}

// ---------------------------------------------------------------------------
// Auth Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when credentials.json is not found at the expected path.
 * @public
 */
export class MissingCredentialsError extends Error {
  /**
   * Create a MissingCredentialsError with setup instructions.
   * @param resolvedPath - The absolute path where credentials.json was expected
   */
  constructor(resolvedPath: string) {
    super(
      `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  Gmail Toolkit: OAuth credentials not found\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `\n` +
        `  Expected at: ${resolvedPath}\n` +
        `\n` +
        `  To set up credentials (one-time, ~5 minutes):\n` +
        `\n` +
        `  1. Create or select a Google Cloud project:\n` +
        `     https://console.cloud.google.com/projectcreate\n` +
        `\n` +
        `  2. Enable the Gmail API:\n` +
        `     https://console.cloud.google.com/apis/library/gmail.googleapis.com\n` +
        `\n` +
        `  3. Configure the OAuth consent screen:\n` +
        `     https://console.cloud.google.com/apis/credentials/consent\n` +
        `\n` +
        `  4. Create an OAuth Client ID (select "Desktop app"):\n` +
        `     https://console.cloud.google.com/apis/credentials/oauthclient\n` +
        `\n` +
        `  5. Download the JSON and save it to:\n` +
        `     ${resolvedPath}\n` +
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
    );
    this.name = 'MissingCredentialsError';
  }
}

/**
 * Thrown when a valid OAuth token is required but not available (missing or expired).
 * @public
 */
export class AuthenticationRequiredError extends Error {
  /**
   * Create an AuthenticationRequiredError with setup instructions.
   * @param tokenPath - The absolute path where token.json was expected
   * @param expired - Whether an existing token was found but is expired/revoked
   */
  constructor(tokenPath: string, expired: boolean) {
    const reason = expired
      ? 'Saved authorization has expired or been revoked.'
      : `No OAuth token found at: ${tokenPath}`;
    super(
      `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  Gmail Toolkit: Authentication required\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `\n` +
        `  ${reason}\n` +
        `\n` +
        `  Run the setup script to ${expired ? 're-' : ''}authenticate:\n` +
        `\n` +
        `    npm run setup-auth\n` +
        `\n` +
        `  This opens your browser for Google sign-in and saves\n` +
        `  the token for future use.\n` +
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
    );
    this.name = 'AuthenticationRequiredError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openCredentialsConsole(): Promise<void> {
  try {
    await open('https://console.cloud.google.com/apis/credentials/oauthclient');
  } catch (err) {
    log.debug('Failed to open credentials console in browser (non-fatal)', err);
  }
}

function isInvalidGrant(err: unknown): boolean {
  if (err instanceof Error) {
    return /invalid_grant|Token has been expired or revoked/.test(err.message);
  }
  return false;
}
