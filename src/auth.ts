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

const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;
const AUTH_TIMEOUT_MS = 120_000; // 2 minutes to complete browser consent

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
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensures we have a valid, authenticated OAuth2 client.
 *
 * Auth state machine:
 *   1. No credentials.json → throw with step-by-step setup instructions + open browser
 *   2. Token exists, refresh valid → silent auto-refresh (invisible, ~100ms)
 *   3. Token exists, refresh invalid → launch browser flow
 *   4. No token.json → launch browser flow
 * @param credentialsPath - Path to Google OAuth credentials.json
 * @param tokenPath - Path to stored token.json (created automatically on first auth)
 * @returns Authenticated OAuth2Client ready for Gmail API calls
 */
export async function ensureAuthenticated(
  credentialsPath: string,
  tokenPath: string,
): Promise<OAuth2Client> {
  // 1. credentials.json MUST exist — cannot be auto-generated
  const resolvedCredPath = path.resolve(credentialsPath);
  if (!fs.existsSync(resolvedCredPath)) {
    await openCredentialsConsole();
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
        log.warn('Saved authorization has expired. Re-authenticating...');
        // Fall through to browser flow
      } else {
        throw err;
      }
    }
  }

  // 3. No valid token — launch interactive browser flow
  return await browserAuthFlow(oauth2, resolvedTokenPath);
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
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // ensures we always get a refresh token
  });

  log.info('Authentication required. Opening browser for Google sign-in...');
  log.info(`If browser doesn't open, visit:\n${authUrl}`);

  // Open browser (cross-platform via 'open' package)
  await open(authUrl);

  // Wait for OAuth redirect on localhost
  const code = await waitForRedirect();

  // Exchange code for tokens
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  // Persist token for future use
  const tokenDir = path.dirname(tokenPath);
  if (!fs.existsSync(tokenDir)) {
    fs.mkdirSync(tokenDir, { recursive: true });
  }
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  log.info('Authentication successful. Token saved.');

  return oauth2;
}

// ---------------------------------------------------------------------------
// Localhost Redirect Server
// ---------------------------------------------------------------------------

/**
 * Starts a temporary HTTP server on localhost to capture the OAuth redirect.
 * Automatically shuts down after receiving the authorization code or timing out.
 * @returns The authorization code from the OAuth redirect
 */
function waitForRedirect(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end('Not found');
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

    server.listen(REDIRECT_PORT, () => {
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

// ---------------------------------------------------------------------------
// Auth Result Page (shown in browser after consent)
// ---------------------------------------------------------------------------

function authResultPage(success: boolean, message: string): string {
  const color = success ? '#1a7f37' : '#cf222e';
  const icon = success ? '&#10003;' : '&#10007;';
  return `
    <!DOCTYPE html>
    <html>
    <head><title>Gmail Toolkit — Authorization</title></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #fafbfc;">
      <div style="text-align: center; padding: 2rem;">
        <div style="font-size: 3rem; color: ${color};">${icon}</div>
        <h1 style="color: ${color}; margin: 0.5rem 0;">${success ? 'Authorized' : 'Authorization Failed'}</h1>
        <p style="color: #57606a; font-size: 1.1rem;">${message}</p>
      </div>
    </body>
    </html>
  `;
}

// ---------------------------------------------------------------------------
// Missing Credentials Error
// ---------------------------------------------------------------------------

class MissingCredentialsError extends Error {
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
